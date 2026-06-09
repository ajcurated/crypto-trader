/**
 * Live context for one perp. Numbers are parsed from HL's string fields.
 * `dayNtlVlm` is 24h notional (USD) volume — our universe ranking key.
 * `funding` is the current hourly funding rate (e.g. 0.0000125 = 0.00125%/hr).
 */
export interface AssetContext {
  name: string;
  dayNtlVlm: number;
  funding: number;
  markPx: number;
  midPx: number | null;
  oraclePx: number;
  prevDayPx: number;
  openInterest: number;
}

/** One daily OHLCV candle. Times are epoch ms. */
export interface Candle {
  coin: string;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

/** One funding observation. `rate` is the hourly rate; `time` is epoch ms. */
export interface FundingPoint {
  coin: string;
  rate: number;
  time: number;
}

/** Connection lifecycle states surfaced by the WS feed. */
export type WatchStatus = "connecting" | "connected" | "reconnecting" | "closed";

/** Callbacks the risk loop (a later phase) registers on the WS feed. */
export interface WatchHandlers {
  onCtx: (ctx: AssetContext) => void;
  onStatus?: (status: WatchStatus) => void;
  onError?: (err: Error) => void;
}

/** Control handle returned by `MarketDataSource.watch`. */
export interface WatchHandle {
  status: () => WatchStatus;
  close: () => void;
}
