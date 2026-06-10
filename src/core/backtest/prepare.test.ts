import { describe, it, expect } from "vitest";
import { prepareBacktestData } from "./prepare.js";
import type { MarketDataSource, AssetContext, Candle, FundingPoint, WatchHandle } from "../data/index.js";

const DAY = 86_400_000;

function ctx(name: string, vol: number): AssetContext {
  return { name, dayNtlVlm: vol, funding: 0, markPx: 1, midPx: 1, oraclePx: 1, prevDayPx: 1, openInterest: 1 };
}

// BTC has 4 daily candles, ETH has 3 — they should align to the common length 3.
function fakeData(): MarketDataSource {
  const series: Record<string, { close: number; closeTime: number }[]> = {
    BTC: [0, 1, 2, 3].map((d) => ({ close: 100 + d, closeTime: d * DAY })),
    ETH: [1, 2, 3].map((d) => ({ close: 50 + d, closeTime: d * DAY })),
  };
  return {
    async getUniverse() { return [ctx("BTC", 1e9), ctx("ETH", 5e8)]; },
    async getDailyCandles(coin: string): Promise<Candle[]> {
      return (series[coin] ?? []).map((s) => ({ coin, openTime: s.closeTime, closeTime: s.closeTime, open: s.close, high: s.close, low: s.close, close: s.close, volume: 1, trades: 1 }));
    },
    async getFundingHistory(coin: string): Promise<FundingPoint[]> {
      return [{ coin, rate: 0.0001, time: 2 * DAY + 100 }]; // lands on day 2
    },
    watch(): WatchHandle { return { status: () => "closed", close: () => {} }; },
  };
}

describe("prepareBacktestData", () => {
  it("aligns coins to the common length and buckets funding per day", async () => {
    const p = await prepareBacktestData(fakeData(), { universeSize: 2, candleHistoryDays: 10 });

    expect(p.closesByCoin.get("BTC")).toEqual([101, 102, 103]); // trimmed to last 3 (ETH's length)
    expect(p.closesByCoin.get("ETH")).toEqual([51, 52, 53]);
    expect(p.dayTimestamps).toEqual([DAY, 2 * DAY, 3 * DAY]);
    expect(p.volumeByCoin.get("BTC")).toBe(1e9);
    // funding point at day 2 lands in the day-2 slot (index of 2*DAY in dayTimestamps = 1)
    expect(p.fundingByDayByCoin.get("BTC")).toEqual([0, 0.0001, 0]);
  });

  it("returns empty inputs when no candle data is available", async () => {
    const data = { ...fakeData(), async getDailyCandles(): Promise<Candle[]> { return []; } };
    const p = await prepareBacktestData(data, { universeSize: 2, candleHistoryDays: 10 });
    expect(p.closesByCoin.size).toBe(0);
    expect(p.dayTimestamps).toEqual([]);
  });
});
