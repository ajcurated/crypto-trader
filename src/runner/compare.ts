import type { SignalParams } from "../core/signal/index.js";
import type { PaperParams } from "../core/paper/index.js";
import { runBacktest, type PreparedBacktest } from "../core/backtest/index.js";

/** A named strategy variant: signal params + how often it rebalances. */
export interface Strategy {
  name: string;
  description: string;
  signal: SignalParams;
  rebalanceEveryDays: number;
}

export interface StrategyResult {
  name: string;
  description: string;
  days: number;
  totalReturn: number;
  cagr: number;
  sharpe: number;
  annualizedVol: number;
  maxDrawdown: number;
  fundingPnl: number;
  rebalances: number;
  fills: number;
}

/**
 * A spread of strategy variants, each isolating one design knob:
 * lookback horizon, rebalance cadence, book concentration, and leverage.
 */
export const STRATEGIES: Strategy[] = [
  {
    name: "baseline",
    description: "30/60-day momentum, top/bottom quintile (20%), 1x gross, weekly",
    signal: { lookbacks: [30, 60], quintileFraction: 0.2, grossExposure: 1.0, hysteresisBuffer: 1 },
    rebalanceEveryDays: 7,
  },
  {
    name: "fast",
    description: "7/14-day (short-horizon) momentum, rebalanced every 3 days",
    signal: { lookbacks: [7, 14], quintileFraction: 0.2, grossExposure: 1.0, hysteresisBuffer: 1 },
    rebalanceEveryDays: 3,
  },
  {
    name: "slow",
    description: "60/90-day (long-horizon) momentum, monthly rebalance",
    signal: { lookbacks: [60, 90], quintileFraction: 0.2, grossExposure: 1.0, hysteresisBuffer: 1 },
    rebalanceEveryDays: 30,
  },
  {
    name: "concentrated",
    description: "top/bottom decile (10%) — fewer, larger bets",
    signal: { lookbacks: [30, 60], quintileFraction: 0.1, grossExposure: 1.0, hysteresisBuffer: 1 },
    rebalanceEveryDays: 7,
  },
  {
    name: "diversified",
    description: "top/bottom third (34%) — broad, smoother book",
    signal: { lookbacks: [30, 60], quintileFraction: 0.34, grossExposure: 1.0, hysteresisBuffer: 1 },
    rebalanceEveryDays: 7,
  },
  {
    name: "levered-2x",
    description: "baseline at 2x gross exposure (amplified return AND risk)",
    signal: { lookbacks: [30, 60], quintileFraction: 0.2, grossExposure: 2.0, hysteresisBuffer: 1 },
    rebalanceEveryDays: 7,
  },
];

/**
 * Run every strategy over the SAME prepared data and the SAME window — the
 * window starts at the longest warmup across strategies, so all results are
 * directly comparable (identical days, identical universe).
 */
export function runComparison(
  prep: PreparedBacktest,
  strategies: Strategy[],
  cfg: { paper: PaperParams; initialCapital: number },
): StrategyResult[] {
  const commonWarmup = Math.max(...strategies.map((s) => Math.max(...s.signal.lookbacks) + 1));
  return strategies.map((s) => {
    const r = runBacktest({
      ...prep,
      signal: s.signal,
      paper: cfg.paper,
      rebalanceEveryDays: s.rebalanceEveryDays,
      warmupDays: commonWarmup,
      initialCapital: cfg.initialCapital,
    });
    return {
      name: s.name,
      description: s.description,
      days: r.equityCurve.length,
      totalReturn: r.metrics.totalReturn,
      cagr: r.metrics.cagr,
      sharpe: r.metrics.sharpe,
      annualizedVol: r.metrics.annualizedVol,
      maxDrawdown: r.metrics.maxDrawdown,
      fundingPnl: r.fundingPnl,
      rebalances: r.rebalances,
      fills: r.fills,
    };
  });
}

const pad = (s: string, n: number) => s.padEnd(n);
const padN = (s: string, n: number) => s.padStart(n);
const pct = (x: number) => `${(x * 100 >= 0 ? "+" : "")}${(x * 100).toFixed(1)}%`;

/** Render a comparison table, sorted by Sharpe (best risk-adjusted first). */
export function formatComparison(results: StrategyResult[], universeSize: number): string {
  const sorted = [...results].sort((a, b) => b.sharpe - a.sharpe);
  const lines: string[] = [];
  lines.push(`=== strategy comparison (${universeSize} coins, ${sorted[0]?.days ?? 0} trading days, identical window) ===`);
  lines.push(`${pad("strategy", 14)} ${padN("return", 8)} ${padN("CAGR", 9)} ${padN("Sharpe", 7)} ${padN("vol", 8)} ${padN("maxDD", 7)} ${padN("funding", 9)} ${padN("rebal", 6)}`);
  lines.push("-".repeat(78));
  for (const r of sorted) {
    lines.push(
      `${pad(r.name, 14)} ${padN(pct(r.totalReturn), 8)} ${padN(pct(r.cagr), 9)} ${padN(r.sharpe.toFixed(2), 7)} ${padN(pct(r.annualizedVol), 8)} ${padN(pct(-r.maxDrawdown), 7)} ${padN("$" + r.fundingPnl.toFixed(0), 9)} ${padN(String(r.rebalances), 6)}`,
    );
  }
  lines.push("");
  for (const r of sorted) lines.push(`  ${pad(r.name, 14)} ${r.description}`);
  return lines.join("\n");
}
