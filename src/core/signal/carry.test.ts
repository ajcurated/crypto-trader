import { describe, it, expect } from "vitest";
import { buildCarryBook } from "./carry.js";
import type { SignalParams } from "./signalEngine.js";

const PARAMS: SignalParams = { lookbacks: [3], quintileFraction: 0.2, grossExposure: 1.0, hysteresisBuffer: 1, mode: "carry" };

describe("buildCarryBook", () => {
  it("longs the most-negative-funding coin and shorts the most-positive", () => {
    // funding: NEG most negative (best to be long), POS most positive (best to be short)
    const funding = new Map<string, number>([
      ["POS", 0.0010], ["A", 0.0003], ["B", -0.0001], ["C", -0.0004], ["NEG", -0.0020],
    ]);
    const { book } = buildCarryBook(funding, PARAMS);
    const longs = book.positions.filter((p) => p.side === "long").map((p) => p.coin);
    const shorts = book.positions.filter((p) => p.side === "short").map((p) => p.coin);
    expect(longs).toEqual(["NEG"]); // n=5, k=1 -> long the most-negative-funding
    expect(shorts).toEqual(["POS"]); // short the most-positive-funding
  });

  it("ignores coins with non-finite funding", () => {
    const funding = new Map<string, number>([["A", 0.001], ["B", NaN], ["C", -0.001], ["D", -0.002]]);
    const { scores } = buildCarryBook(funding, PARAMS);
    expect(scores.map((s) => s.coin)).not.toContain("B");
  });
});
