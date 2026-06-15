import type { Datastore } from "../core/store/index.js";
import { equityMetrics, type EquityMetrics } from "../core/backtest/index.js";
import { toDailyCandles, type EquityCandle } from "./candles.js";

export interface DashboardPosition {
  coin: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  /** Position value in USD at entry (size × entryPrice). */
  notional: number;
}

/** One row of the ranked signal, annotated with whether/how it's held. */
export interface SignalRankRow {
  coin: string;
  score: number;
  held: "long" | "short" | null;
  /** Current hourly funding rate from the latest snapshot, or null if unknown. */
  funding: number | null;
}

export interface DashboardTrade {
  timestamp: number;
  coin: string;
  side: "buy" | "sell";
  size: number;
  fillPrice: number;
  fee: number;
}

export interface DashboardState {
  equityCurve: { timestamp: number; equity: number }[];
  candles: EquityCandle[];
  latestEquity: number;
  totalReturn: number;
  metrics: EquityMetrics;
  pnl: { price: number; funding: number; fees: number } | null;
  positions: DashboardPosition[];
  /** Sum of |size| × entryPrice across the book (gross exposure at entry). */
  grossAtEntry: number;
  recentTrades: DashboardTrade[];
  latestSignal: { capturedAt: number; strongest: { coin: string; score: number }; weakest: { coin: string; score: number } } | null;
  /** Full ranked signal (strongest first), annotated with held side + funding. */
  signalRanking: SignalRankRow[];
}

/** Aggregate the persisted paper-trading state for the dashboard. */
export function buildDashboardState(store: Datastore): DashboardState {
  const full = store.getEquityCurve();
  const equityCurve = full.map((p) => ({ timestamp: p.timestamp, equity: p.equity }));
  const first = full[0];
  const last = full[full.length - 1];
  const latestEquity = last ? last.equity : 0;
  const totalReturn = first && last && first.equity !== 0 ? last.equity / first.equity - 1 : 0;
  const metrics = equityMetrics(equityCurve);
  const pnl = last ? { price: last.pricePnl, funding: last.fundingPnl, fees: last.fees } : null;

  const account = store.getAccountState();
  const positions: DashboardPosition[] = account
    ? account.positions
        .filter((p) => p.size !== 0)
        .map((p) => ({ coin: p.coin, side: p.size > 0 ? "long" : "short", size: Math.abs(p.size), entryPrice: p.entry, notional: Math.abs(p.size) * p.entry }))
    : [];
  const grossAtEntry = positions.reduce((s, p) => s + p.notional, 0);

  const recentTrades: DashboardTrade[] = store.getRecentTrades(20).map((t) => ({
    timestamp: t.timestamp,
    coin: t.coin,
    side: t.deltaSize >= 0 ? "buy" : "sell",
    size: Math.abs(t.deltaSize),
    fillPrice: t.fillPrice,
    fee: t.fee,
  }));

  const sig = store.getLatestSignal();
  const latestSignal =
    sig && sig.scores.length > 0
      ? { capturedAt: sig.capturedAt, strongest: sig.scores[0]!, weakest: sig.scores[sig.scores.length - 1]! }
      : null;

  // Join the ranked signal with what we actually hold + current funding — this
  // is the "why are we in these positions" view.
  const heldSide = new Map(positions.map((p) => [p.coin, p.side]));
  const fundingByCoin = new Map((store.getLatestSnapshot()?.universe ?? []).map((c) => [c.name, c.funding]));
  const signalRanking: SignalRankRow[] = (sig?.scores ?? []).map((s) => ({
    coin: s.coin,
    score: s.score,
    held: heldSide.get(s.coin) ?? null,
    funding: fundingByCoin.get(s.coin) ?? null,
  }));

  return {
    equityCurve,
    candles: toDailyCandles(equityCurve),
    latestEquity,
    totalReturn,
    metrics,
    pnl,
    positions,
    grossAtEntry,
    recentTrades,
    latestSignal,
    signalRanking,
  };
}
