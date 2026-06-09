import { describe, it, expect } from "vitest";
import { feeFor, slippageFraction, fillPrice } from "./fills.js";

describe("feeFor", () => {
  it("is feeRate times absolute notional", () => {
    expect(feeFor(10_000, 0.00045)).toBeCloseTo(4.5, 10);
    expect(feeFor(-10_000, 0.00045)).toBeCloseTo(4.5, 10); // magnitude
  });
});

describe("slippageFraction", () => {
  it("scales with order size vs recent volume", () => {
    expect(slippageFraction(10_000, 1_000_000, 0.1, 0.02)).toBeCloseTo(0.001, 10);
  });
  it("is capped at maxSlippage", () => {
    expect(slippageFraction(1_000_000_000, 1_000_000, 0.1, 0.02)).toBe(0.02);
  });
  it("is zero when recent volume is unknown (<=0)", () => {
    expect(slippageFraction(10_000, 0, 0.1, 0.02)).toBe(0);
  });
});

describe("fillPrice", () => {
  it("buys fill above mid, sells fill below mid", () => {
    expect(fillPrice(100, +5, 0.001)).toBeCloseTo(100.1, 10);
    expect(fillPrice(100, -5, 0.001)).toBeCloseTo(99.9, 10);
  });
});
