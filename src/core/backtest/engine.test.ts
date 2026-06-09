import { describe, it, expect } from "vitest";
import { runBacktest, type BacktestInput } from "./engine.js";
import { DEFAULT_CONFIG } from "../../config.js";

const DAY = 86_400_000;

function input(): BacktestInput {
  const names = ["UP1", "UP2", "MID", "DN1", "DN2", "DN3"];
  const slope: Record<string, number> = { UP1: 1, UP2: 0.6, MID: 0, DN1: -0.4, DN2: -0.7, DN3: -0.85 };
  const L = 70;
  const closesByCoin = new Map<string, number[]>();
  const volumeByCoin = new Map<string, number>();
  for (const n of names) {
    closesByCoin.set(n, Array.from({ length: L }, (_, i) => 100 + slope[n]! * i));
    volumeByCoin.set(n, 1e12);
  }
  const dayTimestamps = Array.from({ length: L }, (_, i) => i * DAY);
  return {
    closesByCoin,
    volumeByCoin,
    dayTimestamps,
    fundingByDayByCoin: new Map(),
    signal: { ...DEFAULT_CONFIG.signal, quintileFraction: 0.34 },
    paper: DEFAULT_CONFIG.paper,
    rebalanceEveryDays: 7,
    warmupDays: 61,
    initialCapital: 100_000,
  };
}

describe("runBacktest", () => {
  it("produces an equity curve, rebalances on cadence, and longs the up-trenders", () => {
    const r = runBacktest(input());
    expect(r.equityCurve.length).toBe(70 - 61);
    expect(r.rebalances).toBeGreaterThanOrEqual(1);
    expect(r.metrics.totalReturn).toBeGreaterThan(0);
    // The book longs up-trenders and shorts down-trenders (which specific coins
    // depends on risk-adjusted momentum, so assert the trend direction, not names).
    const longs = r.finalPositions.filter((p) => p.side === "long").map((p) => p.coin);
    const shorts = r.finalPositions.filter((p) => p.side === "short").map((p) => p.coin);
    expect(longs.length).toBeGreaterThan(0);
    expect(shorts.length).toBeGreaterThan(0);
    expect(longs.every((c) => c.startsWith("UP"))).toBe(true);
    expect(shorts.every((c) => c.startsWith("DN"))).toBe(true);
  });

  it("applies funding when provided (reduces equity vs no funding for a net-paying book)", () => {
    const withFunding = input();
    const fundedCoins = ["UP1", "UP2"];
    for (const [coin] of withFunding.closesByCoin) {
      withFunding.fundingByDayByCoin.set(
        coin,
        withFunding.dayTimestamps.map(() => (fundedCoins.includes(coin) ? 0.001 : 0)),
      );
    }
    const base = runBacktest(input());
    const funded = runBacktest(withFunding);
    expect(funded.equityCurve.at(-1)!.equity).toBeLessThan(base.equityCurve.at(-1)!.equity);
    expect(funded.fundingPnl).toBeLessThan(0);
  });

  it("returns an empty-ish result when warmup exceeds the series length", () => {
    const i = input();
    i.warmupDays = 100;
    const r = runBacktest(i);
    expect(r.equityCurve).toEqual([]);
  });
});
