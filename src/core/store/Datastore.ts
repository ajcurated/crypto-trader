import type { AssetContext } from "../data/types.js";
import type { EquityPoint, AccountState } from "../paper/index.js";
import type { CoinScore } from "../signal/index.js";

/** Runner bookkeeping: when we last marked and last rebalanced (epoch ms). */
export interface RunnerState {
  lastMarkAt: number;
  lastRebalanceAt: number;
}

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
  /** Append an equity-curve point. */
  saveEquityPoint(point: EquityPoint): void;
  /** The full equity curve, oldest first. */
  getEquityCurve(): EquityPoint[];
  /** Persist (replace) the latest account state. */
  saveAccountState(state: AccountState): void;
  /** The latest account state, or null. */
  getAccountState(): AccountState | null;
  /** Persist (replace) runner bookkeeping. */
  saveRunnerState(state: RunnerState): void;
  /** The latest runner bookkeeping, or null. */
  getRunnerState(): RunnerState | null;
  /** Persist the ranked signal scores captured at `capturedAt`. */
  saveSignal(capturedAt: number, scores: CoinScore[]): void;
  /** The most recently captured signal, or null. */
  getLatestSignal(): { capturedAt: number; scores: CoinScore[] } | null;
  /** Release underlying resources. */
  close(): void;
}
