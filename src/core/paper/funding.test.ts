import { describe, it, expect } from "vitest";
import { fundingPayment } from "./funding.js";

describe("fundingPayment", () => {
  it("a long pays when funding is positive (negative cashflow)", () => {
    expect(fundingPayment(10, 0.0001, 100)).toBeCloseTo(-0.1, 10);
  });
  it("a short receives when funding is positive", () => {
    expect(fundingPayment(-10, 0.0001, 100)).toBeCloseTo(0.1, 10);
  });
  it("a long receives when funding is negative", () => {
    expect(fundingPayment(10, -0.0001, 100)).toBeCloseTo(0.1, 10);
  });
  it("is zero for a flat position", () => {
    expect(fundingPayment(0, 0.0001, 100)).toBe(0);
  });
});
