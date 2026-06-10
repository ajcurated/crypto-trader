import { describe, it, expect } from "vitest";
import { runBacktest, type BacktestInput } from "./engine.js";

const DAY = 86_400_000;

// Flat prices (so no price P&L) + persistent funding, to isolate the carry.
function carryInput(): BacktestInput {
  const funding: Record<string, number> = { NEG1: -0.001, NEG2: -0.0008, POS1: 0.001, POS2: 0.0008, Z1: 0, Z2: 0 };
  const L = 30;
  const closesByCoin = new Map<string, number[]>();
  const volumeByCoin = new Map<string, number>();
  const fundingByDayByCoin = new Map<string, number[]>();
  for (const [c, f] of Object.entries(funding)) {
    closesByCoin.set(c, Array.from({ length: L }, () => 100));
    volumeByCoin.set(c, 1e12);
    fundingByDayByCoin.set(c, Array.from({ length: L }, () => f));
  }
  return {
    closesByCoin, volumeByCoin,
    dayTimestamps: Array.from({ length: L }, (_, i) => i * DAY),
    fundingByDayByCoin,
    signal: { lookbacks: [3], quintileFraction: 0.2, grossExposure: 1, hysteresisBuffer: 1, mode: "carry" },
    paper: { feeRate: 0.00045, slippageCoeff: 0, maxSlippage: 0.02 },
    rebalanceEveryDays: 5, warmupDays: 4, initialCapital: 100_000,
  };
}

describe("backtest carry mode", () => {
  it("longs negative-funding, shorts positive-funding, and net-collects funding", () => {
    const r = runBacktest(carryInput());
    expect(r.fundingPnl).toBeGreaterThan(0); // receives funding on both legs
    const longs = r.finalPositions.filter((p) => p.side === "long").map((p) => p.coin);
    const shorts = r.finalPositions.filter((p) => p.side === "short").map((p) => p.coin);
    expect(longs).toContain("NEG1"); // most negative funding -> long
    expect(shorts).toContain("POS1"); // most positive funding -> short
  });
});
