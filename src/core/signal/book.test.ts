import { describe, it, expect } from "vitest";
import { perSideCount, weightBook, applyHysteresis } from "./book.js";
import type { CurrentBook } from "./book.js";
import type { CoinScore } from "./score.js";

describe("perSideCount", () => {
  it("is floor(n * quintileFraction), at least 1", () => {
    expect(perSideCount(20, 0.2)).toBe(4);
    expect(perSideCount(10, 0.2)).toBe(2);
    expect(perSideCount(3, 0.2)).toBe(1); // floor(0.6) -> 0, clamped to 1
  });
});

describe("weightBook", () => {
  it("equal-weights each side to sum to grossExposure/2 (dollar-neutral)", () => {
    const sides: CurrentBook = { longs: ["A", "B"], shorts: ["C", "D"] };
    const book = weightBook(sides, 1.0);

    const longs = book.positions.filter((p) => p.side === "long");
    const shorts = book.positions.filter((p) => p.side === "short");
    expect(longs.map((p) => p.weight)).toEqual([0.25, 0.25]);
    expect(shorts.map((p) => p.weight)).toEqual([0.25, 0.25]);
    expect(longs.reduce((a, p) => a + p.weight, 0)).toBeCloseTo(0.5, 10);
    expect(shorts.reduce((a, p) => a + p.weight, 0)).toBeCloseTo(0.5, 10);
  });

  it("stays dollar-neutral when the two sides have unequal counts", () => {
    const sides: CurrentBook = { longs: ["A", "B", "C"], shorts: ["D", "E"] };
    const book = weightBook(sides, 1.0);
    const longSum = book.positions.filter((p) => p.side === "long").reduce((a, p) => a + p.weight, 0);
    const shortSum = book.positions.filter((p) => p.side === "short").reduce((a, p) => a + p.weight, 0);
    expect(longSum).toBeCloseTo(0.5, 10);
    expect(shortSum).toBeCloseTo(0.5, 10);
  });

  it("labels positions with the right coin and side", () => {
    const book = weightBook({ longs: ["A"], shorts: ["Z"] }, 1.0);
    expect(book.positions).toEqual([
      { coin: "A", side: "long", weight: 0.5 },
      { coin: "Z", side: "short", weight: 0.5 },
    ]);
  });
});

// helper: build a ranked (desc) score list from coin names best->worst
function ranked(names: string[]): CoinScore[] {
  return names.map((coin, i) => ({ coin, score: names.length - i }));
}

describe("applyHysteresis", () => {
  it("with an empty current book selects plain top-k and bottom-k", () => {
    const r = ranked(["A", "B", "C", "D", "E", "F"]); // A best ... F worst
    const sides = applyHysteresis(r, 2, 1, { longs: [], shorts: [] });
    expect(sides.longs).toEqual(["A", "B"]);
    expect(sides.shorts).toEqual(["E", "F"]);
  });

  it("retains an incumbent that slipped within the buffer zone", () => {
    const r = ranked(["A", "C", "B", "D", "E", "F"]);
    const sides = applyHysteresis(r, 2, 1, { longs: ["A", "B"], shorts: ["E", "F"] });
    expect(sides.longs).toEqual(["A", "C", "B"]);
    expect(sides.shorts).toEqual(["E", "F"]);
  });

  it("drops an incumbent that fell past the buffer zone", () => {
    const r = ranked(["A", "C", "D", "B", "E", "F"]);
    const sides = applyHysteresis(r, 2, 1, { longs: ["A", "B"], shorts: ["E", "F"] });
    expect(sides.longs).toEqual(["A", "C"]);
    expect(sides.shorts).toEqual(["E", "F"]);
  });

  it("retains a short incumbent that drifted up within the buffer zone", () => {
    const r = ranked(["A", "B", "C", "E", "D", "F"]);
    const sides = applyHysteresis(r, 2, 1, { longs: ["A", "B"], shorts: ["E", "F"] });
    expect(sides.shorts).toEqual(["E", "D", "F"]);
    expect(sides.longs).toEqual(["A", "B"]);
  });
});
