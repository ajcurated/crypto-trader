import type { SignalParams } from "./core/signal/index.js";
import type { PaperParams } from "./core/paper/index.js";

export interface Config {
  universeSize: number;
  candleHistoryDays: number;
  rebalanceIntervalDays: number;
  initialCapital: number;
  dbPath: string;
  signal: SignalParams;
  paper: PaperParams;
}

export const DEFAULT_CONFIG: Config = {
  universeSize: 20,
  candleHistoryDays: 90,
  rebalanceIntervalDays: 7,
  initialCapital: 100_000,
  dbPath: "crypto-markets.sqlite",
  signal: { lookbacks: [30, 60], quintileFraction: 0.2, grossExposure: 1.0, hysteresisBuffer: 1 },
  paper: { feeRate: 0.00045, slippageCoeff: 0.1, maxSlippage: 0.02 },
};

/** Read an optional positive number from env, falling back to a default. */
function numFromEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Build config from defaults, overriding top-level fields from env vars. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  return {
    ...DEFAULT_CONFIG,
    universeSize: numFromEnv(env["UNIVERSE_SIZE"], DEFAULT_CONFIG.universeSize),
    candleHistoryDays: numFromEnv(env["CANDLE_HISTORY_DAYS"], DEFAULT_CONFIG.candleHistoryDays),
    rebalanceIntervalDays: numFromEnv(env["REBALANCE_INTERVAL_DAYS"], DEFAULT_CONFIG.rebalanceIntervalDays),
    initialCapital: numFromEnv(env["INITIAL_CAPITAL"], DEFAULT_CONFIG.initialCapital),
    dbPath: env["DB_PATH"] ?? DEFAULT_CONFIG.dbPath,
  };
}
