import type { PaperParams } from "../paper/index.js";
import type { PreparedBacktest } from "./prepare.js";
import type { Strategy } from "./strategy.js";
import { runBacktest } from "./engine.js";

export interface SweepRow {
  intervalDays: number;
  totalReturn: number;
  sharpe: number;
  annualizedVol: number;
  maxDrawdown: number;
  rebalances: number;
  fills: number;
  fees: number;
  fundingPnl: number;
}

/**
 * Sweep the rebalance interval while holding the signal constant — isolates the
 * effect of trading cadence on return, risk, and turnover/fees. All intervals
 * run over the same window (shared warmup), so they're directly comparable.
 */
export function sweepRebalance(
  prep: PreparedBacktest,
  base: Strategy,
  intervals: number[],
  cfg: { paper: PaperParams; initialCapital: number },
): SweepRow[] {
  const warmup = Math.max(...base.signal.lookbacks) + 1;
  return intervals.map((intervalDays) => {
    const r = runBacktest({
      ...prep,
      signal: base.signal,
      paper: cfg.paper,
      rebalanceEveryDays: intervalDays,
      warmupDays: warmup,
      initialCapital: cfg.initialCapital,
      volTarget: base.volTarget,
      maxLeverage: base.maxLeverage,
    });
    return {
      intervalDays,
      totalReturn: r.metrics.totalReturn,
      sharpe: r.metrics.sharpe,
      annualizedVol: r.metrics.annualizedVol,
      maxDrawdown: r.metrics.maxDrawdown,
      rebalances: r.rebalances,
      fills: r.fills,
      fees: r.fees,
      fundingPnl: r.fundingPnl,
    };
  });
}
