import type { Datastore } from "../core/store/index.js";
import { equityMetrics, type EquityMetrics } from "../core/backtest/index.js";

export interface DashboardPosition {
  coin: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
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
  latestEquity: number;
  totalReturn: number;
  metrics: EquityMetrics;
  pnl: { price: number; funding: number; fees: number } | null;
  positions: DashboardPosition[];
  recentTrades: DashboardTrade[];
  latestSignal: { capturedAt: number; strongest: { coin: string; score: number }; weakest: { coin: string; score: number } } | null;
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
        .map((p) => ({ coin: p.coin, side: p.size > 0 ? "long" : "short", size: Math.abs(p.size), entryPrice: p.entry }))
    : [];

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

  return { equityCurve, latestEquity, totalReturn, metrics, pnl, positions, recentTrades, latestSignal };
}
