import type { SignalParams, CurrentBook } from "../signal/index.js";
import type { PaperParams, Position } from "../paper/index.js";
import { buildTargetBook } from "../signal/index.js";
import { PaperAccount } from "../paper/index.js";
import { weightsFromBook, currentBookFromPositions } from "../../runner/adapters.js";
import { equityMetrics, type EquityCurvePoint, type EquityMetrics } from "./metrics.js";

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
}

export interface BacktestResult {
  equityCurve: EquityCurvePoint[];
  metrics: EquityMetrics;
  rebalances: number;
  fills: number;
  fundingPnl: number;
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
      const history = new Map<string, number[]>();
      for (const c of coins) history.set(c, input.closesByCoin.get(c)!.slice(0, t + 1));
      const { book } = buildTargetBook(history, input.signal, current);
      const f = account.rebalance(weightsFromBook(book), prices, input.volumeByCoin);
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
