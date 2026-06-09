import { describe, it, expect } from "vitest";
import { buildTargetBook } from "./signalEngine.js";
import type { SignalParams } from "./signalEngine.js";

const PARAMS: SignalParams = {
  lookbacks: [2],
  quintileFraction: 0.2,
  grossExposure: 1.0,
  hysteresisBuffer: 1,
};

// Six coins with monotonic up/down trends so the ranking is unambiguous.
// Risk-adjusted-momentum ranking: UP1 > UP2 > MIDA > MIDB > DN1 > DN2.
function closes(): Map<string, number[]> {
  return new Map<string, number[]>([
    ["UP1", [100, 130, 170]],
    ["UP2", [100, 120, 140]],
    ["MIDA", [100, 105, 104]],
    ["MIDB", [100, 98, 99]],
    ["DN1", [100, 85, 75]],
    ["DN2", [100, 70, 50]],
  ]);
}

describe("buildTargetBook", () => {
  it("longs the strongest and shorts the weakest, dollar-neutral", () => {
    const { book } = buildTargetBook(closes(), PARAMS);
    const longs = book.positions.filter((p) => p.side === "long").map((p) => p.coin);
    const shorts = book.positions.filter((p) => p.side === "short").map((p) => p.coin);
    expect(longs).toEqual(["UP1"]); // n=6, k=floor(6*0.2)=1 -> one name per side
    expect(shorts).toEqual(["DN2"]);
  });

  it("excludes coins with insufficient price history", () => {
    const c = closes();
    c.set("NEW", [100, 101]); // only 2 closes; lookback 2 needs 3 -> excluded
    const { scores } = buildTargetBook(c, PARAMS);
    expect(scores.map((s) => s.coin)).not.toContain("NEW");
  });

  it("returns scores ranked descending", () => {
    const { scores } = buildTargetBook(closes(), PARAMS);
    const vals = scores.map((s) => s.score);
    const sorted = [...vals].sort((a, b) => b - a);
    expect(vals).toEqual(sorted);
    expect(scores[0]!.coin).toBe("UP1");
  });

  it("applies hysteresis against the supplied current book", () => {
    const { book } = buildTargetBook(closes(), PARAMS, { longs: ["UP1", "UP2"], shorts: ["DN1", "DN2"] });
    const longs = book.positions.filter((p) => p.side === "long").map((p) => p.coin);
    const shorts = book.positions.filter((p) => p.side === "short").map((p) => p.coin);
    expect(longs).toEqual(["UP1", "UP2"]);     // incumbent UP2 retained within top (k+buffer)=2
    expect(shorts).toEqual(["DN1", "DN2"]);    // rank-ordered (DN1 ranks above DN2)
  });

  it("returns an empty book when fewer than 2 coins are eligible", () => {
    const c = new Map<string, number[]>([["ONLY", [100, 120, 108]]]);
    const { book } = buildTargetBook(c, PARAMS);
    expect(book.positions).toEqual([]);
  });
});
