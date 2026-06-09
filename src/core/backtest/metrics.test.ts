import { describe, it, expect } from "vitest";
import { equityMetrics, type EquityCurvePoint } from "./metrics.js";

const DAY = 86_400_000;
const curve = (equities: number[]): EquityCurvePoint[] =>
  equities.map((equity, i) => ({ timestamp: i * DAY, equity }));

describe("equityMetrics", () => {
  it("computes total return and max drawdown", () => {
    const m = equityMetrics(curve([100, 110, 99]));
    expect(m.totalReturn).toBeCloseTo(-0.01, 10);
    expect(m.maxDrawdown).toBeCloseTo(0.1, 10);
    expect(m.annualizedVol).toBeCloseTo(Math.sqrt(0.02) * Math.sqrt(365), 6);
    expect(m.sharpe).toBeCloseTo(0, 10);
    expect(m.cagr).toBeLessThan(0);
  });

  it("reports a positive Sharpe for an upward-drifting curve", () => {
    const m = equityMetrics(curve([100, 101, 103, 104]));
    expect(m.sharpe).toBeGreaterThan(0);
    expect(m.totalReturn).toBeCloseTo(0.04, 10);
    expect(m.maxDrawdown).toBeCloseTo(0, 10);
  });

  it("returns zeros for a degenerate (<2 point) curve", () => {
    expect(equityMetrics(curve([100]))).toEqual({
      totalReturn: 0, cagr: 0, sharpe: 0, annualizedVol: 0, maxDrawdown: 0,
    });
  });
});
