import type { RobustnessRow, WalkForwardEval } from "../core/backtest/index.js";

const pad = (s: string, n: number) => s.padEnd(n);
const padN = (s: string, n: number) => s.padStart(n);
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

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
