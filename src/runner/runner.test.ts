import { describe, it, expect } from "vitest";
import { runDailyCycle, type RunnerDeps } from "./runner.js";
import { SqliteDatastore } from "../core/store/index.js";
import { DEFAULT_CONFIG, type Config } from "../config.js";
import type { MarketDataSource, AssetContext, Candle, FundingPoint, WatchHandle } from "../core/data/index.js";

const DAY = 86_400_000;

function ctx(name: string, vol: number, mark: number): AssetContext {
  return { name, dayNtlVlm: vol, funding: 0, markPx: mark, midPx: mark, oraclePx: mark, prevDayPx: mark, openInterest: 1 };
}

function fakeData(): MarketDataSource {
  const universe = [
    ctx("UP1", 1e9, 170), ctx("UP2", 9e8, 140), ctx("MID", 8e8, 104),
    ctx("DN1", 7e8, 75), ctx("DN2", 6e8, 50), ctx("DN3", 5e8, 40),
  ];
  const paths: Record<string, number[]> = { UP1: [], UP2: [], MID: [], DN1: [], DN2: [], DN3: [] };
  for (let i = 0; i < 70; i++) {
    paths["UP1"]!.push(100 + i); paths["UP2"]!.push(100 + i * 0.6);
    paths["MID"]!.push(100 + Math.sin(i) * 2); paths["DN1"]!.push(100 - i * 0.4);
    paths["DN2"]!.push(100 - i * 0.7); paths["DN3"]!.push(100 - i * 0.85);
  }
  return {
    async getUniverse() { return universe; },
    async getDailyCandles(coin: string, days: number): Promise<Candle[]> {
      const closes = paths[coin] ?? [];
      return closes.slice(-days).map((close, i) => ({ coin, openTime: i, closeTime: i, open: close, high: close, low: close, close, volume: 1, trades: 1 }));
    },
    async getFundingHistory(): Promise<FundingPoint[]> { return []; },
    watch(): WatchHandle { return { status: () => "closed", close: () => {} }; },
  };
}

function deps(store: SqliteDatastore, now: number): RunnerDeps {
  const cfg: Config = { ...DEFAULT_CONFIG, universeSize: 6, candleHistoryDays: 70, rebalanceIntervalDays: 7 };
  return { data: fakeData(), store, config: cfg, now };
}

describe("runDailyCycle", () => {
  it("rebalances on the first tick and writes an equity point + state", async () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    const point = await runDailyCycle(deps(store, 10 * DAY));
    expect(point.timestamp).toBe(10 * DAY);
    expect(store.getEquityCurve()).toHaveLength(1);
    expect(store.getAccountState()).not.toBeNull();
    // Risk-adjusted momentum ranks UP2 above UP1 (gentler slope -> higher
    // return/volatility), so the strongest persisted signal is UP2.
    expect(store.getLatestSignal()?.scores[0]?.coin).toBe("UP2");
    expect(store.getAccountState()!.positions.length).toBeGreaterThan(0);
    store.close();
  });

  it("is idempotent within the same UTC day", async () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    await runDailyCycle(deps(store, 10 * DAY));
    const again = await runDailyCycle(deps(store, 10 * DAY + 3600_000));
    expect(store.getEquityCurve()).toHaveLength(1);
    expect(again.timestamp).toBe(10 * DAY);
    store.close();
  });

  it("marks again the next day without rebalancing before the interval", async () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    await runDailyCycle(deps(store, 10 * DAY));
    const rebAt1 = store.getRunnerState()!.lastRebalanceAt;
    await runDailyCycle(deps(store, 11 * DAY));
    expect(store.getEquityCurve()).toHaveLength(2);
    expect(store.getRunnerState()!.lastRebalanceAt).toBe(rebAt1);
    store.close();
  });
});
