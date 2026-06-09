import type { AssetContext } from "../data/types.js";

/** A persisted point-in-time capture of the market (for reproducibility/backfill). */
export interface MarketSnapshot {
  /** Epoch ms when this snapshot was captured. */
  capturedAt: number;
  /** The ranked universe contexts at capture time. */
  universe: AssetContext[];
}

/**
 * Persistence boundary. Phase 1 covers market snapshots only; later phases
 * extend this interface with signals/trades/positions/equity.
 */
export interface Datastore {
  /** Create tables if absent. Idempotent. */
  init(): void;
  /** Persist a market snapshot. */
  saveMarketSnapshot(snapshot: MarketSnapshot): void;
  /** Most recently captured snapshot, or null if none. */
  getLatestSnapshot(): MarketSnapshot | null;
  /** Release underlying resources. */
  close(): void;
}
