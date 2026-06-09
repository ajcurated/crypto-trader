import { describe, it, expect } from "vitest";
import { weightsFromBook, closesFromCandles, currentBookFromPositions, sumFundingSince } from "./adapters.js";
import type { TargetBook } from "../core/signal/index.js";
import type { Candle, FundingPoint } from "../core/data/index.js";
import type { Position } from "../core/paper/index.js";

describe("weightsFromBook", () => {
  it("maps long/short positions to signed weights", () => {
    const book: TargetBook = { positions: [
      { coin: "BTC", side: "long", weight: 0.25 },
      { coin: "ETH", side: "short", weight: 0.25 },
    ] };
    expect(weightsFromBook(book)).toEqual(new Map([["BTC", 0.25], ["ETH", -0.25]]));
  });
});

describe("closesFromCandles", () => {
  it("extracts close prices in order", () => {
    const candles = [
      { coin: "BTC", openTime: 1, closeTime: 2, open: 1, high: 1, low: 1, close: 100, volume: 1, trades: 1 },
      { coin: "BTC", openTime: 2, closeTime: 3, open: 1, high: 1, low: 1, close: 110, volume: 1, trades: 1 },
    ] as Candle[];
    expect(closesFromCandles(candles)).toEqual([100, 110]);
  });
});

describe("currentBookFromPositions", () => {
  it("splits positions into long and short coin lists", () => {
    const positions: Position[] = [
      { coin: "BTC", side: "long", size: 1, entryPrice: 100 },
      { coin: "ETH", side: "short", size: 2, entryPrice: 50 },
    ];
    expect(currentBookFromPositions(positions)).toEqual({ longs: ["BTC"], shorts: ["ETH"] });
  });
});

describe("sumFundingSince", () => {
  it("sums funding rates strictly after the cutoff", () => {
    const pts: FundingPoint[] = [
      { coin: "BTC", rate: 0.0001, time: 100 },
      { coin: "BTC", rate: 0.0002, time: 200 },
      { coin: "BTC", rate: 0.0003, time: 300 },
    ];
    expect(sumFundingSince(pts, 150)).toBeCloseTo(0.0005, 10);
  });
  it("is zero for no points after the cutoff", () => {
    expect(sumFundingSince([{ coin: "BTC", rate: 0.0001, time: 100 }], 150)).toBe(0);
  });
});
