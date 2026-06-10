import { describe, it, expect } from "vitest";
import { rollingWindows, robustness, walkForward } from "./walkforward.js";
import type { PreparedBacktest } from "./prepare.js";
import type { Strategy } from "./strategy.js";

const DAY = 86_400_000;

function prep(L = 200): PreparedBacktest {
  const slopes: Record<string, number> = { UP1: 1, UP2: 0.7, UP3: 0.4, MIDA: 0.1, MIDB: -0.1, DN1: -0.4, DN2: -0.7, DN3: -1 };
  const closesByCoin = new Map<string, number[]>();
  const volumeByCoin = new Map<string, number>();
  const fundingByDayByCoin = new Map<string, number[]>();
  for (const [coin, slope] of Object.entries(slopes)) {
    closesByCoin.set(coin, Array.from({ length: L }, (_, i) => 100 + slope * i));
    volumeByCoin.set(coin, 1e12);
    fundingByDayByCoin.set(coin, Array.from({ length: L }, () => 0));
  }
  return { closesByCoin, volumeByCoin, dayTimestamps: Array.from({ length: L }, (_, i) => i * DAY), fundingByDayByCoin };
}

const CFG = { paper: { feeRate: 0.00045, slippageCoeff: 0.1, maxSlippage: 0.02 }, initialCapital: 100_000 };
const STRATS: Strategy[] = [
  { name: "fast", description: "", signal: { lookbacks: [7, 14], quintileFraction: 0.2, grossExposure: 1, hysteresisBuffer: 1 }, rebalanceEveryDays: 3 },
  { name: "base", description: "", signal: { lookbacks: [30, 60], quintileFraction: 0.2, grossExposure: 1, hysteresisBuffer: 1 }, rebalanceEveryDays: 7 },
];

describe("rollingWindows", () => {
  it("produces fixed-length windows stepping across the range", () => {
    expect(rollingWindows(61, 200, 45, 30)).toEqual([
      { start: 61, end: 106 }, { start: 91, end: 136 }, { start: 121, end: 166 }, { start: 151, end: 196 },
    ]);
  });
  it("falls back to a single window when none fit", () => {
    expect(rollingWindows(61, 100, 50, 30)).toEqual([{ start: 61, end: 100 }]);
  });
});

describe("robustness", () => {
  it("reports a row per strategy with finite, in-range stats across windows", () => {
    const rows = robustness(prep(), STRATS, CFG, { winLen: 45, step: 30 });
    expect(rows.map((r) => r.name).sort()).toEqual(["base", "fast"]);
    for (const r of rows) {
      expect(r.windows).toBe(4); // warmup 61, L 200, winLen 45 step 30
      expect(Number.isFinite(r.medianSharpe)).toBe(true);
      expect(Number.isFinite(r.worstDrawdown)).toBe(true);
      expect(r.pctPositive).toBeGreaterThanOrEqual(0);
      expect(r.pctPositive).toBeLessThanOrEqual(1);
    }
  });
});

describe("walkForward", () => {
  it("selects an in-sample winner each step and reports OOS metrics for adaptive + each fixed strategy", () => {
    const wf = walkForward(prep(), STRATS, CFG, { inLen: 60, outLen: 30 });
    expect(wf.steps.length).toBeGreaterThanOrEqual(1);
    for (const s of wf.steps) {
      expect(["fast", "base"]).toContain(s.chosen);
      expect(s.outEnd).toBeGreaterThan(s.inEnd);
      expect(s.inEnd).toBeGreaterThan(s.inStart);
    }
    expect(Number.isFinite(wf.adaptive.sharpe)).toBe(true);
    expect(wf.perStrategy.map((p) => p.name).sort()).toEqual(["base", "fast"]);
    for (const p of wf.perStrategy) expect(Number.isFinite(p.metrics.totalReturn)).toBe(true);
  });
});
