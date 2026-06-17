import { describe, it, expect } from "vitest";
import { neutralizeWeights } from "./neutralize.js";
import type { Position } from "../paper/index.js";

const pos = (coin: string, side: "long" | "short", size: number, entryPrice = 1): Position => ({ coin, side, size, entryPrice });

describe("neutralizeWeights", () => {
  it("trims the heavier side down to the lighter side's gross", () => {
    // longs gross = 100+100 = 200; short gross = 120. Target = 120.
    const positions = [pos("A", "long", 100), pos("B", "long", 100), pos("C", "short", 120)];
    const marks = new Map([["A", 1], ["B", 1], ["C", 1]]);
    const w = neutralizeWeights(positions, marks, 1000);
    // Each long trimmed to 60 (120/2); short unchanged at 120. Weights = notional/nav.
    expect(w.get("A")).toBeCloseTo(60 / 1000, 9);
    expect(w.get("B")).toBeCloseTo(60 / 1000, 9);
    expect(w.get("C")).toBeCloseTo(-120 / 1000, 9);
    // Resulting book is dollar-neutral: long gross == short gross.
    const longGross = (w.get("A")! + w.get("B")!) * 1000;
    expect(longGross).toBeCloseTo(-w.get("C")! * 1000, 9);
  });

  it("uses current marks (not entry) to measure each side's gross", () => {
    const positions = [pos("A", "long", 100, 1), pos("C", "short", 50, 1)];
    const marks = new Map([["A", 2], ["C", 1]]); // long now worth 200, short 50
    const w = neutralizeWeights(positions, marks, 1000);
    // Target = min(200, 50) = 50; long trimmed to notional 50 -> weight 50/1000.
    expect(w.get("A")).toBeCloseTo(50 / 1000, 9);
    expect(w.get("C")).toBeCloseTo(-50 / 1000, 9);
  });

  it("targets flat when one side is empty (one-sided book is pure direction)", () => {
    const positions = [pos("A", "long", 100), pos("B", "long", 100)];
    const marks = new Map([["A", 1], ["B", 1]]);
    const w = neutralizeWeights(positions, marks, 1000);
    expect(w.get("A")).toBe(0);
    expect(w.get("B")).toBe(0);
  });

  it("skips positions without a mark", () => {
    const positions = [pos("A", "long", 100), pos("B", "short", 100)];
    const marks = new Map([["A", 1]]); // B unpriced
    const w = neutralizeWeights(positions, marks, 1000);
    expect(w.has("B")).toBe(false);
    // With no priced short, the short gross is 0 -> long target flat.
    expect(w.get("A")).toBe(0);
  });

  it("returns no weights when NAV is non-positive", () => {
    const positions = [pos("A", "long", 100), pos("B", "short", 100)];
    expect(neutralizeWeights(positions, new Map([["A", 1], ["B", 1]]), 0).size).toBe(0);
  });
});
