import { describe, it, expect } from "vitest";
import { zscore, compositeScores } from "./score.js";

describe("zscore", () => {
  it("standardizes using population stdev (÷ n)", () => {
    const z = zscore([1, 2, 3]);
    expect(z[0]!).toBeCloseTo(-1.2247449, 6);
    expect(z[1]!).toBeCloseTo(0, 6);
    expect(z[2]!).toBeCloseTo(1.2247449, 6);
  });
  it("returns all zeros when every value is equal (zero stdev)", () => {
    expect(zscore([5, 5, 5])).toEqual([0, 0, 0]);
  });
});

describe("compositeScores", () => {
  it("z-scores risk-adjusted momentum across coins and averages lookbacks", () => {
    const closes = new Map<string, number[]>([
      ["STRONG", [100, 120, 132]],
      ["MID", [100, 110, 99]],
      ["WEAK", [100, 80, 72]],
    ]);
    const scores = compositeScores(closes, [2]);

    expect(scores.reduce((a, s) => a + s.score, 0)).toBeCloseTo(0, 6);
    const byCoin = Object.fromEntries(scores.map((s) => [s.coin, s.score]));
    expect(byCoin["STRONG"]!).toBeGreaterThan(byCoin["MID"]!);
    expect(byCoin["MID"]!).toBeGreaterThan(byCoin["WEAK"]!);
    expect(byCoin["STRONG"]!).toBeCloseTo(1.2572, 3);
  });

  it("preserves coin identity and returns one score per input coin", () => {
    const closes = new Map<string, number[]>([
      ["A", [100, 120, 132]],
      ["B", [100, 80, 72]],
    ]);
    const scores = compositeScores(closes, [2]);
    expect(scores.map((s) => s.coin).sort()).toEqual(["A", "B"]);
  });
});
