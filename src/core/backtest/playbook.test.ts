import { describe, it, expect } from "vitest";
import { regimePlaybook, regimeNow } from "./playbook.js";
import type { PreparedBacktest } from "./prepare.js";
import type { Strategy } from "./strategy.js";

const DAY = 86_400_000;
const CFG = { paper: { feeRate: 0.00045, slippageCoeff: 0.1, maxSlippage: 0.02 }, initialCapital: 100_000 };
const STRATS: Strategy[] = [
  { name: "mom", description: "", signal: { lookbacks: [10, 20], quintileFraction: 0.2, grossExposure: 1, hysteresisBuffer: 1 }, rebalanceEveryDays: 7 },
  { name: "rev", description: "", signal: { lookbacks: [3, 5], quintileFraction: 0.2, grossExposure: 1, hysteresisBuffer: 1, mode: "reversion" }, rebalanceEveryDays: 3 },
];

function prep(L = 200): PreparedBacktest {
  const slopes: Record<string, number> = { BTC: 0.5, UP2: 0.7, MID: 0.1, DN1: -0.4, DN2: -0.7, DN3: -1 };
  const closesByCoin = new Map<string, number[]>(), volumeByCoin = new Map<string, number>(), fundingByDayByCoin = new Map<string, number[]>();
  for (const [c, s] of Object.entries(slopes)) {
    closesByCoin.set(c, Array.from({ length: L }, (_, i) => 100 + s * i));
    volumeByCoin.set(c, 1e12);
    fundingByDayByCoin.set(c, Array.from({ length: L }, () => 0));
  }
  return { closesByCoin, volumeByCoin, dayTimestamps: Array.from({ length: L }, (_, i) => i * DAY), fundingByDayByCoin };
}

describe("regimePlaybook", () => {
  it("returns a regime row with a cell per strategy", () => {
    const rows = regimePlaybook(prep(), STRATS, CFG, { blockLen: 40 });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.cells.map((c) => c.strategy).sort()).toEqual(["mom", "rev"]);
      for (const c of r.cells) {
        expect(c.winRate).toBeGreaterThanOrEqual(0);
        expect(c.winRate).toBeLessThanOrEqual(1);
        expect(Number.isFinite(c.avgReturn)).toBe(true);
      }
    }
  });
});

describe("regimeNow", () => {
  it("characterizes the current window with finite, in-range stats", () => {
    const r = regimeNow(prep(), 30);
    expect(r.lookbackDays).toBe(30);
    expect(r.btcReturn).toBeGreaterThan(0); // BTC rising
    expect(r.breadthUp).toBeGreaterThanOrEqual(0);
    expect(r.breadthUp).toBeLessThanOrEqual(1);
    expect(Number.isFinite(r.trendPersistence)).toBe(true);
    expect(Number.isFinite(r.annualizedVol)).toBe(true);
    expect(typeof r.suggestion).toBe("string");
  });
});
