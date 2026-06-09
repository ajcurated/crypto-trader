import { describe, it, expect, vi } from "vitest";
import { Daemon, type DaemonDeps } from "./daemon.js";
import { SqliteDatastore } from "../core/store/index.js";
import { DEFAULT_CONFIG, type Config } from "../config.js";
import type { MarketDataSource, AssetContext, WatchHandlers, WatchHandle, Candle, FundingPoint } from "../core/data/index.js";

const DAY = 86_400_000;

function ctx(name: string, mark: number): AssetContext {
  return { name, dayNtlVlm: 1e12, funding: 0, markPx: mark, midPx: mark, oraclePx: mark, prevDayPx: mark, openInterest: 1 };
}

function fakeData() {
  const universe = [ctx("UP1", 170), ctx("UP2", 140), ctx("MID", 104), ctx("DN1", 75), ctx("DN2", 50), ctx("DN3", 40)];
  const paths: Record<string, number[]> = { UP1: [], UP2: [], MID: [], DN1: [], DN2: [], DN3: [] };
  for (let i = 0; i < 70; i++) {
    paths["UP1"]!.push(100 + i); paths["UP2"]!.push(100 + i * 0.6); paths["MID"]!.push(100 + Math.sin(i) * 2);
    paths["DN1"]!.push(100 - i * 0.4); paths["DN2"]!.push(100 - i * 0.7); paths["DN3"]!.push(100 - i * 0.85);
  }
  const watched: string[][] = [];
  const ds: MarketDataSource = {
    async getUniverse() { return universe; },
    async getDailyCandles(coin: string, days: number): Promise<Candle[]> {
      return (paths[coin] ?? []).slice(-days).map((close, i) => ({ coin, openTime: i, closeTime: i, open: close, high: close, low: close, close, volume: 1, trades: 1 }));
    },
    async getFundingHistory(): Promise<FundingPoint[]> { return []; },
    watch(coins: string[], _h: WatchHandlers): WatchHandle { watched.push(coins); return { status: () => "connected", close: () => {} }; },
  };
  return { ds, watched };
}

function deps(store: SqliteDatastore, data: MarketDataSource, now: number): DaemonDeps {
  const config: Config = { ...DEFAULT_CONFIG, universeSize: 6, candleHistoryDays: 70, rebalanceIntervalDays: 7, minUniverseForRebalance: 1 };
  return { data, store, config, notify: { send: vi.fn(async () => {}) }, now: () => now, schedule: vi.fn() };
}

describe("Daemon", () => {
  it("runOnce runs a daily cycle and (re)subscribes the risk loop to the held coins", async () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    const { ds, watched } = fakeData();
    const daemon = new Daemon(deps(store, ds, 10 * DAY));
    await daemon.runOnce();

    expect(store.getEquityCurve()).toHaveLength(1);
    const held = store.getAccountState()!.positions.map((p) => p.coin).sort();
    expect(held.length).toBeGreaterThan(0);
    expect(watched.at(-1)!.slice().sort()).toEqual(held);
    daemon.stop();
    store.close();
  });

  it("start schedules recurring cycles via the injected scheduler", async () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    const { ds } = fakeData();
    const d = deps(store, ds, 10 * DAY);
    const daemon = new Daemon(d);
    await daemon.start();
    expect(d.schedule).toHaveBeenCalled();
    daemon.stop();
    store.close();
  });
});
