import type { PaperParams } from "../paper/index.js";
import { runBacktest, type BacktestResult } from "./engine.js";
import type { PreparedBacktest } from "./prepare.js";
import { equityMetrics, type EquityCurvePoint, type EquityMetrics } from "./metrics.js";
import type { Strategy } from "./strategy.js";

export interface WindowSpec {
  start: number;
  end: number;
}

interface EvalCfg {
  paper: PaperParams;
  initialCapital: number;
}

/** Truncate a prepared dataset to the first `end` days (history before a window). */
function sliceTo(prep: PreparedBacktest, end: number): PreparedBacktest {
  return {
    closesByCoin: new Map([...prep.closesByCoin].map(([c, a]) => [c, a.slice(0, end)])),
    volumeByCoin: prep.volumeByCoin,
    dayTimestamps: prep.dayTimestamps.slice(0, end),
    fundingByDayByCoin: new Map([...prep.fundingByDayByCoin].map(([c, a]) => [c, a.slice(0, end)])),
  };
}

/** Run one strategy over a single window [start, end): warms up on [0, start). */
export function runWindow(prep: PreparedBacktest, strategy: Strategy, start: number, end: number, cfg: EvalCfg): BacktestResult {
  return runBacktest({
    ...sliceTo(prep, end),
    signal: strategy.signal,
    paper: cfg.paper,
    rebalanceEveryDays: strategy.rebalanceEveryDays,
    warmupDays: start,
    initialCapital: cfg.initialCapital,
    volTarget: strategy.volTarget,
    maxLeverage: strategy.maxLeverage,
    gainTrigger: strategy.gainTrigger,
  });
}

/** Rolling windows of `winLen` days stepping by `step`, within [warmup, L). */
export function rollingWindows(warmup: number, L: number, winLen: number, step: number): WindowSpec[] {
  const out: WindowSpec[] = [];
  for (let s = warmup; s + winLen <= L; s += step) out.push({ start: s, end: s + winLen });
  if (out.length === 0 && L - warmup >= 2) out.push({ start: warmup, end: L });
  return out;
}

export interface RobustnessRow {
  name: string;
  windows: number;
  medianReturn: number;
  medianSharpe: number;
  worstSharpe: number;
  worstDrawdown: number;
  pctPositive: number;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** Per-strategy distribution of metrics across rolling sub-windows (consistency). */
export function robustness(
  prep: PreparedBacktest,
  strategies: Strategy[],
  cfg: EvalCfg,
  opts: { winLen: number; step: number },
): RobustnessRow[] {
  const warmup = Math.max(...strategies.map((s) => Math.max(...s.signal.lookbacks) + 1));
  const L = prep.dayTimestamps.length;
  const wins = rollingWindows(warmup, L, opts.winLen, opts.step);

  return strategies.map((strategy) => {
    const returns: number[] = [];
    const sharpes: number[] = [];
    const drawdowns: number[] = [];
    for (const w of wins) {
      const m = runWindow(prep, strategy, w.start, w.end, cfg).metrics;
      returns.push(m.totalReturn);
      sharpes.push(m.sharpe);
      drawdowns.push(m.maxDrawdown);
    }
    return {
      name: strategy.name,
      windows: wins.length,
      medianReturn: median(returns),
      medianSharpe: median(sharpes),
      worstSharpe: sharpes.length ? Math.min(...sharpes) : 0,
      worstDrawdown: drawdowns.length ? Math.max(...drawdowns) : 0,
      pctPositive: returns.length ? returns.filter((r) => r > 0).length / returns.length : 0,
    };
  });
}

export interface WalkForwardStep {
  inStart: number;
  inEnd: number;
  outEnd: number;
  chosen: string;
  chosenInSampleSharpe: number;
  oosReturn: number;
}

export interface WalkForwardEval {
  steps: WalkForwardStep[];
  /** OOS metrics for the recency-selected ("adaptive") strategy. */
  adaptive: EquityMetrics;
  /** OOS metrics for each fixed strategy held through the same OOS blocks. */
  perStrategy: { name: string; metrics: EquityMetrics }[];
}

/** Chain per-block equity curves into one continuous curve (compounding). */
function chain(blocks: EquityCurvePoint[][]): EquityCurvePoint[] {
  const out: EquityCurvePoint[] = [];
  let base = 1;
  for (const b of blocks) {
    if (b.length === 0) continue;
    const start = b[0]!.equity;
    for (const p of b) out.push({ timestamp: p.timestamp, equity: base * (p.equity / start) });
    base *= b[b.length - 1]!.equity / start;
  }
  return out;
}

/**
 * Walk-forward selection: at each step, pick the best-Sharpe strategy on the
 * in-sample block, then measure it on the next (out-of-sample) block. Compares
 * that "adaptive" track record against each fixed strategy held over the same
 * OOS blocks — the realistic test of whether picking recent winners works.
 */
export function walkForward(
  prep: PreparedBacktest,
  strategies: Strategy[],
  cfg: EvalCfg,
  opts: { inLen: number; outLen: number },
): WalkForwardEval {
  const warmup = Math.max(...strategies.map((s) => Math.max(...s.signal.lookbacks) + 1));
  const L = prep.dayTimestamps.length;

  const steps: WalkForwardStep[] = [];
  const adaptiveBlocks: EquityCurvePoint[][] = [];
  const fixedBlocks = new Map<string, EquityCurvePoint[][]>(strategies.map((s) => [s.name, []]));

  for (let pos = warmup; pos + opts.inLen + opts.outLen <= L; pos += opts.outLen) {
    const inStart = pos;
    const inEnd = pos + opts.inLen;
    const outEnd = inEnd + opts.outLen;

    // Select the best in-sample strategy by Sharpe.
    let chosen = strategies[0]!;
    let chosenSharpe = -Infinity;
    for (const s of strategies) {
      const sharpe = runWindow(prep, s, inStart, inEnd, cfg).metrics.sharpe;
      if (sharpe > chosenSharpe) {
        chosenSharpe = sharpe;
        chosen = s;
      }
    }

    // Out-of-sample: the chosen strategy, and every fixed strategy, over [inEnd, outEnd).
    const oosChosen = runWindow(prep, chosen, inEnd, outEnd, cfg);
    adaptiveBlocks.push(oosChosen.equityCurve);
    for (const s of strategies) {
      fixedBlocks.get(s.name)!.push(runWindow(prep, s, inEnd, outEnd, cfg).equityCurve);
    }

    steps.push({ inStart, inEnd, outEnd, chosen: chosen.name, chosenInSampleSharpe: chosenSharpe, oosReturn: oosChosen.metrics.totalReturn });
  }

  return {
    steps,
    adaptive: equityMetrics(chain(adaptiveBlocks)),
    perStrategy: strategies.map((s) => ({ name: s.name, metrics: equityMetrics(chain(fixedBlocks.get(s.name)!)) })),
  };
}
