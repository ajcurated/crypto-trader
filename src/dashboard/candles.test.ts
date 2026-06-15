import { describe, it, expect } from "vitest";
import { toDailyCandles } from "./candles.js";

const DAY = 86_400_000;

describe("toDailyCandles", () => {
  it("returns no candles for an empty curve", () => {
    expect(toDailyCandles([])).toEqual([]);
  });

  it("makes one flat candle from a single point", () => {
    const [c] = toDailyCandles([{ timestamp: 0, equity: 100 }]);
    expect(c).toEqual({ time: 0, open: 100, high: 100, low: 100, close: 100 });
  });

  it("opens each day at the previous day's close (gap-continuous)", () => {
    const cs = toDailyCandles([
      { timestamp: 0, equity: 100 },
      { timestamp: DAY, equity: 110 },
      { timestamp: 2 * DAY, equity: 105 },
    ]);
    expect(cs.map((c) => [c.open, c.close])).toEqual([[100, 100], [100, 110], [110, 105]]);
  });

  it("captures intraday range across multiple points in one day", () => {
    const cs = toDailyCandles([
      { timestamp: 0, equity: 100 },
      { timestamp: DAY, equity: 102 }, // open 100
      { timestamp: DAY + 3600_000, equity: 108 }, // high
      { timestamp: DAY + 7200_000, equity: 101 }, // close
    ]);
    expect(cs[1]).toEqual({ time: DAY, open: 100, high: 108, low: 100, close: 101 });
  });
});
