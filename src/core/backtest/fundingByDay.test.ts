import { describe, it, expect } from "vitest";
import { bucketFundingByDay } from "./fundingByDay.js";
import type { FundingPoint } from "../data/index.js";

const DAY = 86_400_000;

describe("bucketFundingByDay", () => {
  it("sums each day's funding rates into a per-day array aligned to dayTimestamps", () => {
    const dayTimestamps = [0, DAY, 2 * DAY];
    const points: FundingPoint[] = [
      { coin: "BTC", rate: 0.0001, time: 100 },
      { coin: "BTC", rate: 0.0002, time: DAY / 2 },
      { coin: "BTC", rate: 0.0003, time: DAY + 100 },
    ];
    const out = bucketFundingByDay(points, dayTimestamps);
    expect(out).toHaveLength(3);
    expect(out[0]!).toBeCloseTo(0.0003, 12); // 0.0001 + 0.0002 (float-tolerant)
    expect(out[1]!).toBeCloseTo(0.0003, 12);
    expect(out[2]!).toBe(0);
  });

  it("returns all-zero for no points", () => {
    expect(bucketFundingByDay([], [0, DAY])).toEqual([0, 0]);
  });
});
