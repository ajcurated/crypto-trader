import { describe, it, expect } from "vitest";
import { loadConfig, DEFAULT_CONFIG } from "./config.js";

describe("loadConfig", () => {
  it("returns defaults when env is empty", () => {
    expect(loadConfig({})).toEqual(DEFAULT_CONFIG);
  });
  it("overrides numeric fields from env", () => {
    const cfg = loadConfig({ UNIVERSE_SIZE: "30", INITIAL_CAPITAL: "50000", DB_PATH: "/tmp/x.sqlite" });
    expect(cfg.universeSize).toBe(30);
    expect(cfg.initialCapital).toBe(50_000);
    expect(cfg.dbPath).toBe("/tmp/x.sqlite");
    expect(cfg.signal).toEqual(DEFAULT_CONFIG.signal);
  });
  it("ignores non-numeric overrides and keeps the default", () => {
    expect(loadConfig({ UNIVERSE_SIZE: "abc" }).universeSize).toBe(DEFAULT_CONFIG.universeSize);
  });
  it("includes risk defaults", () => {
    expect(loadConfig({}).risk).toEqual({ spreadStopPct: 0.08, circuitBreakerBand: 0.15, fundingAlertAnnualized: 0.5 });
  });
  it("defaults minUniverseForRebalance to 6", () => {
    expect(loadConfig({}).minUniverseForRebalance).toBe(6);
  });
  it("overrides risk thresholds and the rebalance floor from env", () => {
    const cfg = loadConfig({
      SPREAD_STOP_PCT: "0.05",
      CIRCUIT_BREAKER_BAND: "0.2",
      FUNDING_ALERT_ANNUALIZED: "1",
      MIN_UNIVERSE_FOR_REBALANCE: "10",
    });
    expect(cfg.risk).toEqual({ spreadStopPct: 0.05, circuitBreakerBand: 0.2, fundingAlertAnnualized: 1 });
    expect(cfg.minUniverseForRebalance).toBe(10);
  });
});
