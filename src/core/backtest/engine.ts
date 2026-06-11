import type { SignalParams, CurrentBook } from "../signal/index.js";
import type { PaperParams, Position } from "../paper/index.js";
import { buildTargetBook, buildCarryBook } from "../signal/index.js";
import { PaperAccount } from "../paper/index.js";
import { weightsFromBook, currentBookFromPositions } from "../../runner/adapters.js";
import { equityMetrics, type EquityCurvePoint, type EquityMetrics } from "./metrics.js";
import { volTargetScale } from "./voltarget.js";

export interface BacktestInput {
  closesByCoin: Map<string, number[]>;
  volumeByCoin: Map<string, number>;
  dayTimestamps: number[];
  /** Per-coin per-day funding rate (length = dayTimestamps.length). Empty ⇒ none. */
  fundingByDayByCoin: Map<string, number[]>;
  signal: SignalParams;
  paper: PaperParams;
  rebalanceEveryDays: number;
  warmupDays: number;
  initialCapital: number;
  /** Annualized volatility target; when set, gross is scaled to hold this vol. */
  volTarget?: number;
  /** Trailing window (days) for the realized-vol estimate (default 20). */
  volWindow?: number;
  /** Max exposure multiple when vol-targeting (default 2). */
  maxLeverage?: number;
}

export interface BacktestResult {
  equityCurve: EquityCurvePoint[];
  metrics: EquityMetrics;
  rebalances: number;
  fills: number;
  fundingPnl: number;
  /** Cumulative fees paid over the run (turnover cost). */
  fees: number;
  finalPositions: Position[];
}

/** Walk the live signal + paper engine forward over historical closes. */
export function runBacktest(input: BacktestInput): BacktestResult {
  const coins = [...input.closesByCoin.keys()];
  const L = input.dayTimestamps.length;
  const account = new PaperAccount(input.initialCapital, input.paper);
  const equityCurve: EquityCurvePoint[] = [];
  let current: CurrentBook = { longs: [], shorts: [] };
  let rebalances = 0;
  let fills = 0;

  for (let t = input.warmupDays; t < L; t++) {
    const prices = new Map<string, number>();
    for (const c of coins) {
      const series = input.closesByCoin.get(c)!;
      if (t < series.length) prices.set(c, series[t]!);
    }

    const rates = new Map<string, number>();
    for (const p of account.positions()) {
      const byDay = input.fundingByDayByCoin.get(p.coin);
      if (byDay && t < byDay.length) rates.set(p.coin, byDay[t]!);
    }
    if (rates.size > 0) account.accrueFunding(rates, prices);

    if ((t - input.warmupDays) % input.rebalanceEveryDays === 0) {
      let book;
      if (input.signal.mode === "carry") {
        // Rank by trailing-average funding (window = lookbacks[0], default 3d).
        const window = input.signal.lookbacks[0] ?? 3;
        const avgFunding = new Map<string, number>();
        for (const c of coins) {
          const fb = input.fundingByDayByCoin.get(c);
          if (!fb) continue;
          const slice = fb.slice(Math.max(0, t - window + 1), t + 1);
          if (slice.length > 0) avgFunding.set(c, slice.reduce((a, b) => a + b, 0) / slice.length);
        }
        book = buildCarryBook(avgFunding, input.signal, current).book;
      } else {
        const history = new Map<string, number[]>();
        for (const c of coins) history.set(c, input.closesByCoin.get(c)!.slice(0, t + 1));
        book = buildTargetBook(history, input.signal, current).book;
      }
      let weights = weightsFromBook(book);
      if (input.volTarget !== undefined) {
        const window = equityCurve.slice(-(input.volWindow ?? 20));
        const recent: number[] = [];
        for (let i = 1; i < window.length; i++) recent.push(window[i]!.equity / window[i - 1]!.equity - 1);
        const scale = volTargetScale(recent, input.volTarget, input.maxLeverage ?? 2);
        weights = new Map([...weights].map(([c, w]) => [c, w * scale]));
      }
      const f = account.rebalance(weights, prices, input.volumeByCoin);
      fills += f.length;
      rebalances += 1;
      current = currentBookFromPositions(account.positions());
    }

    const point = account.mark(prices, input.dayTimestamps[t]!);
    equityCurve.push({ timestamp: point.timestamp, equity: point.equity });
  }

  const lastMark = equityCurve.length > 0 ? account.mark(lastPrices(input, coins, L), input.dayTimestamps[L - 1]!) : null;
  return {
    equityCurve,
    metrics: equityMetrics(equityCurve),
    rebalances,
    fills,
    fundingPnl: lastMark ? lastMark.fundingPnl : 0,
    fees: lastMark ? lastMark.fees : 0,
    finalPositions: account.positions(),
  };
}

function lastPrices(input: BacktestInput, coins: string[], L: number): Map<string, number> {
  const prices = new Map<string, number>();
  for (const c of coins) {
    const series = input.closesByCoin.get(c)!;
    if (L - 1 < series.length) prices.set(c, series[L - 1]!);
  }
  return prices;
}
