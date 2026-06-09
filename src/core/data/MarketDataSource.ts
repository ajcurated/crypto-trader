import type {
  AssetContext,
  Candle,
  FundingPoint,
  WatchHandlers,
  WatchHandle,
} from "./types.js";

/**
 * The only data abstraction the rest of the system depends on. Implementations
 * (HyperLiquid now, others later) live behind this; signal/paper/runner code
 * never imports a venue SDK or `ws`.
 */
export interface MarketDataSource {
  /** Top `topN` perps by 24h notional volume, already sorted desc. */
  getUniverse(topN: number): Promise<AssetContext[]>;

  /** Most recent `days` daily candles for `coin`, oldest-first. */
  getDailyCandles(coin: string, days: number): Promise<Candle[]>;

  /** Funding observations for `coin` at/after `sinceMs`, oldest-first. */
  getFundingHistory(coin: string, sinceMs: number): Promise<FundingPoint[]>;

  /** Open a streaming feed of asset-context updates for `coins`. */
  watch(coins: string[], handlers: WatchHandlers): WatchHandle;
}
