import { describe, it, expect } from "vitest";
import { parseCandles } from "./parse.js";
import raw from "../__fixtures__/candleSnapshot.json" with { type: "json" };

describe("parseCandles", () => {
  it("maps HL candle fields to domain Candle, preserving order", () => {
    const out = parseCandles(raw as unknown);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      coin: "BTC",
      openTime: 1717200000000,
      closeTime: 1717286399999,
      open: 64000,
      high: 66000,
      low: 63500,
      close: 65000,
      volume: 1234.5,
      trades: 9001,
    });
    expect(out[1]!.close).toBe(64200);
  });
});
