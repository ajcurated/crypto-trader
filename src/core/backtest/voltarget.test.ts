import { describe, it, expect } from "vitest";
import { realizedVol, volTargetScale } from "./voltarget.js";

describe("realizedVol", () => {
  it("annualizes the sample stdev of returns", () => {
    // returns [0.01, -0.01]: sample stdev sqrt(0.0002) -> *sqrt(365)
    expect(realizedVol([0.01, -0.01])).toBeCloseTo(Math.sqrt(0.0002) * Math.sqrt(365), 6);
  });
  it("is zero for fewer than 2 returns", () => {
    expect(realizedVol([0.01])).toBe(0);
  });
});

describe("volTargetScale", () => {
  it("is neutral (1) until enough observations", () => {
    expect(volTargetScale([0.01, -0.01], 0.2, 2)).toBe(1);
  });
  it("scales down when realized vol exceeds target", () => {
    const hot = [0.05, -0.05, 0.05, -0.05, 0.05, -0.05]; // very high vol
    const s = volTargetScale(hot, 0.2, 2);
    expect(s).toBeLessThan(1);
    expect(s).toBeGreaterThan(0);
  });
  it("scales up (capped at maxScale) when realized vol is below target", () => {
    const calm = [0.0001, -0.0001, 0.0001, -0.0001, 0.0001, -0.0001]; // tiny vol
    expect(volTargetScale(calm, 0.5, 2)).toBe(2); // hits the cap
  });
});
