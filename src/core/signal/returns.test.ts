import { describe, it, expect } from "vitest";
import { dailyReturns, totalReturn, volatility, riskAdjustedMomentum } from "./returns.js";

describe("dailyReturns", () => {
  it("computes simple period-over-period returns", () => {
    expect(dailyReturns([100, 110, 99])).toEqual([0.1, -0.1]);
  });
  it("returns empty for fewer than 2 closes", () => {
    expect(dailyReturns([100])).toEqual([]);
  });
});

describe("totalReturn", () => {
  it("is the point-to-point return over the last `lookback` periods", () => {
    expect(totalReturn([50, 55, 60, 66], 3)).toBeCloseTo(0.32, 10); // 66/50 - 1
  });
  it("throws when there aren't lookback+1 closes", () => {
    expect(() => totalReturn([50, 55, 60], 3)).toThrow(/insufficient/);
  });
});

describe("volatility", () => {
  it("is the sample stdev of the returns", () => {
    expect(volatility([0.1, -0.1])).toBeCloseTo(0.1414214, 6);
  });
  it("throws on fewer than 2 returns (sample stdev undefined)", () => {
    expect(() => volatility([0.1])).toThrow(/insufficient/);
  });
});

describe("riskAdjustedMomentum", () => {
  it("is total return over the window divided by volatility of its daily returns", () => {
    expect(riskAdjustedMomentum([100, 120, 108], 2)).toBeCloseTo(0.3771236, 6);
  });
  it("uses only the last lookback+1 closes from a longer series", () => {
    expect(riskAdjustedMomentum([999, 1, 100, 120, 108], 2)).toBeCloseTo(0.3771236, 6);
  });
});
