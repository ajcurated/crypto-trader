import type { SignalParams } from "./core/signal/index.js";
import type { PaperParams } from "./core/paper/index.js";
import type { RiskParams } from "./core/risk/index.js";

export interface Config {
  universeSize: number;
  candleHistoryDays: number;
  rebalanceIntervalDays: number;
  initialCapital: number;
  dbPath: string;
  minUniverseForRebalance: number;
  /** Annualized vol target (0 disables). Scales live gross to hold risk constant. */
  volTarget: number;
  /** Trailing equity-return window (days) for the realized-vol estimate. */
  volWindow: number;
  /** Max exposure multiple when vol-targeting. */
  maxLeverage: number;
  signal: SignalParams;
  paper: PaperParams;
  risk: RiskParams;
}

export const DEFAULT_CONFIG: Config = {
  universeSize: 20,
  candleHistoryDays: 90,
  rebalanceIntervalDays: 7,
  initialCapital: 100_000,
  dbPath: "crypto-markets.sqlite",
  minUniverseForRebalance: 6,
  volTarget: 0.25,
  volWindow: 20,
  maxLeverage: 1.5,
  signal: { lookbacks: [30, 60], quintileFraction: 0.2, grossExposure: 1.0, hysteresisBuffer: 1 },
  paper: { feeRate: 0.00045, slippageCoeff: 0.1, maxSlippage: 0.02 },
  risk: { spreadStopPct: 0.08, circuitBreakerBand: 0.15, fundingAlertAnnualized: 0.5 },
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
    minUniverseForRebalance: numFromEnv(env["MIN_UNIVERSE_FOR_REBALANCE"], DEFAULT_CONFIG.minUniverseForRebalance),
    volTarget: numFromEnv(env["VOL_TARGET"], DEFAULT_CONFIG.volTarget),
    volWindow: numFromEnv(env["VOL_WINDOW"], DEFAULT_CONFIG.volWindow),
    maxLeverage: numFromEnv(env["MAX_LEVERAGE"], DEFAULT_CONFIG.maxLeverage),
    dbPath: env["DB_PATH"] ?? DEFAULT_CONFIG.dbPath,
    risk: {
      spreadStopPct: numFromEnv(env["SPREAD_STOP_PCT"], DEFAULT_CONFIG.risk.spreadStopPct),
      circuitBreakerBand: numFromEnv(env["CIRCUIT_BREAKER_BAND"], DEFAULT_CONFIG.risk.circuitBreakerBand),
      fundingAlertAnnualized: numFromEnv(env["FUNDING_ALERT_ANNUALIZED"], DEFAULT_CONFIG.risk.fundingAlertAnnualized),
    },
  };
}
