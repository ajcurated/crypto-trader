import { describe, it, expect } from "vitest";
import { applyTrade } from "./position.js";

describe("applyTrade", () => {
  it("opens a new position from flat", () => {
    expect(applyTrade({ size: 0, entry: 0 }, 10, 100)).toEqual({
      position: { size: 10, entry: 100 },
      realized: 0,
    });
  });

  it("adds in the same direction with a weighted-average entry", () => {
    expect(applyTrade({ size: 10, entry: 100 }, 10, 110)).toEqual({
      position: { size: 20, entry: 105 },
      realized: 0,
    });
  });

  it("reduces a long and realizes PnL at the fill price", () => {
    expect(applyTrade({ size: 10, entry: 100 }, -4, 120)).toEqual({
      position: { size: 6, entry: 100 },
      realized: 80,
    });
  });

  it("fully closes a position", () => {
    expect(applyTrade({ size: 10, entry: 100 }, -10, 120)).toEqual({
      position: { size: 0, entry: 0 },
      realized: 200,
    });
  });

  it("flips long to short: closes fully then opens the remainder at the fill", () => {
    expect(applyTrade({ size: 10, entry: 100 }, -15, 120)).toEqual({
      position: { size: -5, entry: 120 },
      realized: 200,
    });
  });

  it("reduces a short and realizes PnL (mirror of long)", () => {
    expect(applyTrade({ size: -10, entry: 100 }, 4, 80)).toEqual({
      position: { size: -6, entry: 100 },
      realized: 80,
    });
  });

  it("adds to a short with weighted-average entry", () => {
    const out = applyTrade({ size: -10, entry: 100 }, -5, 90);
    expect(out.position.size).toBe(-15);
    expect(out.position.entry).toBeCloseTo(96.6666667, 6);
    expect(out.realized).toBe(0);
  });

  it("is a no-op for a zero-quantity trade (no NaN entry from flat)", () => {
    expect(applyTrade({ size: 0, entry: 0 }, 0, 100)).toEqual({
      position: { size: 0, entry: 0 },
      realized: 0,
    });
  });
});
