import { describe, it, expect } from "vitest";
import { sweepRebalance } from "./sweep.js";
import type { PreparedBacktest } from "./prepare.js";
import type { Strategy } from "./strategy.js";

const DAY = 86_400_000;
const CFG = { paper: { feeRate: 0.00045, slippageCoeff: 0.1, maxSlippage: 0.02 }, initialCapital: 100_000 };
const BASE: Strategy = { name: "m", description: "", signal: { lookbacks: [10, 20], quintileFraction: 0.2, grossExposure: 1, hysteresisBuffer: 1 }, rebalanceEveryDays: 7 };

function prep(L = 200): PreparedBacktest {
  const slopes: Record<string, number> = { UP1: 1, UP2: 0.6, MID: 0.05, DN1: -0.4, DN2: -0.7, DN3: -1 };
  const closesByCoin = new Map<string, number[]>(), volumeByCoin = new Map<string, number>(), fundingByDayByCoin = new Map<string, number[]>();
  for (const [c, s] of Object.entries(slopes)) {
    closesByCoin.set(c, Array.from({ length: L }, (_, i) => 100 + s * i));
    volumeByCoin.set(c, 1e12);
    fundingByDayByCoin.set(c, Array.from({ length: L }, () => 0));
  }
  return { closesByCoin, volumeByCoin, dayTimestamps: Array.from({ length: L }, (_, i) => i * DAY), fundingByDayByCoin };
}

describe("sweepRebalance", () => {
  it("returns a row per interval; faster cadence -> more rebalances, fills, and fees", () => {
    const rows = sweepRebalance(prep(), BASE, [2, 7, 30], CFG);
    expect(rows.map((r) => r.intervalDays)).toEqual([2, 7, 30]);
    const fast = rows[0]!, slow = rows[2]!;
    expect(fast.rebalances).toBeGreaterThan(slow.rebalances);
    expect(fast.fills).toBeGreaterThanOrEqual(slow.fills);
    expect(fast.fees).toBeGreaterThan(slow.fees);
    for (const r of rows) expect(Number.isFinite(r.sharpe)).toBe(true);
  });
});
