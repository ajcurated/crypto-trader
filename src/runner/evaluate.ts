import type { RobustnessRow, WalkForwardEval, RegimeBlock, PlaybookRegime, RegimeNow } from "../core/backtest/index.js";

const pad = (s: string, n: number) => s.padEnd(n);
const padN = (s: string, n: number) => s.padStart(n);
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const date = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** Label a block's market regime from BTC + breadth. */
function regimeLabel(b: RegimeBlock): string {
  const btc = b.btcReturn ?? b.medianCoinReturn;
  if (btc > 0.12) return "bull";
  if (btc < -0.12) return "bear";
  return "chop";
}

/** Per-period (regime-by-regime) view: market context next to strategy result. */
export function formatRegimes(blocks: RegimeBlock[]): string {
  const lines: string[] = [];
  lines.push("=== regime-by-regime (each block: market context vs strategy) ===");
  lines.push(`${pad("period", 24)} ${padN("regime", 6)} ${padN("BTC", 7)} ${padN("medCoin", 8)} ${padN("%up", 5)} ${padN("strat", 8)} ${padN("Sharpe", 7)} ${padN("DD", 7)}`);
  lines.push("-".repeat(78));
  for (const b of blocks) {
    lines.push(
      `${pad(date(b.fromTs) + ".." + date(b.toTs), 24)} ${padN(regimeLabel(b), 6)} ${padN(b.btcReturn === null ? "—" : pct(b.btcReturn), 7)} ${padN(pct(b.medianCoinReturn), 8)} ${padN((b.pctUp * 100).toFixed(0) + "%", 5)} ${padN(pct(b.stratReturn), 8)} ${padN(b.stratSharpe.toFixed(2), 7)} ${padN(pct(-b.stratMaxDrawdown), 7)}`,
    );
  }
  // Aggregate by regime.
  const byRegime = new Map<string, number[]>();
  for (const b of blocks) {
    const k = regimeLabel(b);
    if (!byRegime.has(k)) byRegime.set(k, []);
    byRegime.get(k)!.push(b.stratReturn);
  }
  lines.push("");
  lines.push("strategy avg block return by regime:");
  for (const [k, rs] of byRegime) {
    const avg = rs.reduce((a, x) => a + x, 0) / rs.length;
    const wins = rs.filter((r) => r > 0).length;
    lines.push(`  ${pad(k, 6)} ${rs.length} blocks   avg ${pct(avg)}   ${wins}/${rs.length} positive`);
  }
  return lines.join("\n");
}

/** Per-strategy consistency across rolling windows, sorted by median Sharpe. */
export function formatRobustness(rows: RobustnessRow[]): string {
  const sorted = [...rows].sort((a, b) => b.medianSharpe - a.medianSharpe);
  const lines: string[] = [];
  lines.push(`=== robustness across ${sorted[0]?.windows ?? 0} rolling windows (median / worst) ===`);
  lines.push(`${pad("strategy", 14)} ${padN("med.ret", 8)} ${padN("med.Shrp", 9)} ${padN("worst.Shrp", 11)} ${padN("worst.DD", 9)} ${padN("%win+", 7)}`);
  lines.push("-".repeat(62));
  for (const r of sorted) {
    lines.push(
      `${pad(r.name, 14)} ${padN(pct(r.medianReturn), 8)} ${padN(r.medianSharpe.toFixed(2), 9)} ${padN(r.worstSharpe.toFixed(2), 11)} ${padN(pct(-r.worstDrawdown), 9)} ${padN((r.pctPositive * 100).toFixed(0) + "%", 7)}`,
    );
  }
  return lines.join("\n");
}

/** Walk-forward: adaptive (recency-selected) vs each fixed strategy, out-of-sample. */
export function formatWalkForward(wf: WalkForwardEval): string {
  const rows = [
    { name: "ADAPTIVE", metrics: wf.adaptive },
    ...wf.perStrategy,
  ].sort((a, b) => b.metrics.sharpe - a.metrics.sharpe);

  const lines: string[] = [];
  lines.push(`=== walk-forward out-of-sample (${wf.steps.length} blocks; "ADAPTIVE" = pick recent best, then trade next) ===`);
  lines.push(`${pad("strategy", 14)} ${padN("OOS ret", 9)} ${padN("Sharpe", 7)} ${padN("maxDD", 8)}`);
  lines.push("-".repeat(42));
  for (const r of rows) {
    const tag = r.name === "ADAPTIVE" ? " <-- recency selection" : "";
    lines.push(`${pad(r.name, 14)} ${padN(pct(r.metrics.totalReturn), 9)} ${padN(r.metrics.sharpe.toFixed(2), 7)} ${padN(pct(-r.metrics.maxDrawdown), 8)}${tag}`);
  }
  lines.push("");
  lines.push("picks per block: " + wf.steps.map((s) => s.chosen).join(" -> "));
  return lines.join("\n");
}

/** The current-regime read: market state today + which strategy it favours. */
export function formatRegimeNow(r: RegimeNow): string {
  const lines: string[] = [];
  lines.push(`=== current regime read (last ${r.lookbackDays} days) ===`);
  lines.push(`  BTC return:        ${pct(r.btcReturn)}`);
  lines.push(`  median coin:       ${pct(r.medianCoinReturn)}`);
  lines.push(`  breadth (% up):    ${(r.breadthUp * 100).toFixed(0)}%`);
  lines.push(`  dispersion (sd):   ${pct(r.dispersion)}`);
  lines.push(`  BTC ann. vol:      ${pct(r.annualizedVol)}`);
  lines.push(`  trend persistence: ${r.trendPersistence.toFixed(2)}  (>0 trends persist→momentum; <0 reverses→mean-reversion)`);
  lines.push(`  -> ${r.suggestion}`);
  return lines.join("\n");
}

/** Strategy × regime matrix: avg block return (win-rate) per regime. */
export function formatPlaybook(rows: PlaybookRegime[]): string {
  const strategies = rows[0]?.cells.map((c) => c.strategy) ?? [];
  const lines: string[] = [];
  lines.push(`=== strategy x regime playbook (avg block return, win-rate) ===`);
  lines.push(`${pad("regime", 8)} ${pad("blocks", 7)} ${strategies.map((s) => padN(s, 16)).join(" ")}`);
  lines.push("-".repeat(8 + 8 + strategies.length * 17));
  for (const r of rows) {
    const cells = r.cells.map((c) => padN(`${pct(c.avgReturn)} (${(c.winRate * 100).toFixed(0)}%)`, 16)).join(" ");
    lines.push(`${pad(r.regime, 8)} ${pad(String(r.blocks), 7)} ${cells}`);
  }
  lines.push("");
  lines.push("read: pick the strategy with the strongest avg return + win-rate for the regime you judge we're in.");
  return lines.join("\n");
}
