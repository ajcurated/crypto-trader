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
    // the rebalance fills were persisted to the trade log
    expect(store.getRecentTrades(100).length).toBeGreaterThan(0);
    expect(store.getRecentTrades(100)[0]!.timestamp).toBe(10 * DAY);
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

  it("accrues funding on the next tick against the held book", async () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    // Data source that charges funding (longs pay more than shorts receive).
    const base = fakeData();
    const data = {
      ...base,
      async getFundingHistory(coin: string, sinceMs: number): Promise<FundingPoint[]> {
        const rate = coin.startsWith("UP") ? 0.0002 : 0.0001;
        return [{ coin, rate, time: sinceMs + DAY / 2 }];
      },
    };
    const cfg: Config = { ...DEFAULT_CONFIG, universeSize: 6, candleHistoryDays: 70, rebalanceIntervalDays: 7 };

    await runDailyCycle({ data, store, config: cfg, now: 10 * DAY }); // opens book, no funding
    expect(store.getEquityCurve()[0]!.fundingPnl).toBe(0);
    const point = await runDailyCycle({ data, store, config: cfg, now: 11 * DAY });
    // Long pays 0.0002, short receives 0.0001 on equal notionals -> net negative.
    expect(point.fundingPnl).toBeLessThan(0);
    store.close();
  });

  it("tolerates a per-coin candle fetch failure without aborting the tick", async () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    const base = fakeData();
    const data = {
      ...base,
      async getDailyCandles(coin: string, days: number): Promise<Candle[]> {
        if (coin === "DN3") throw new Error("flaky fetch");
        return base.getDailyCandles(coin, days);
      },
    };
    const cfg: Config = { ...DEFAULT_CONFIG, universeSize: 6, candleHistoryDays: 70, rebalanceIntervalDays: 7, minUniverseForRebalance: 1 };
    const point = await runDailyCycle({ data, store, config: cfg, now: 10 * DAY });
    expect(point.timestamp).toBe(10 * DAY);
    expect(store.getLatestSignal()!.scores.map((s) => s.coin)).not.toContain("DN3");
    store.close();
  });

  it("skips the rebalance (keeps marking) when too few coins have usable history", async () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    const cfg: Config = { ...DEFAULT_CONFIG, universeSize: 6, candleHistoryDays: 70, rebalanceIntervalDays: 7, minUniverseForRebalance: 999 };
    await runDailyCycle({ data: fakeData(), store, config: cfg, now: 10 * DAY });
    expect(store.getAccountState()!.positions).toEqual([]);
    expect(store.getEquityCurve()).toHaveLength(1);
    expect(store.getRunnerState()!.lastRebalanceAt).toBe(0);
    store.close();
  });

  it("flattens a held position that has dropped out of the universe on rebalance", async () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    const cfg: Config = { ...DEFAULT_CONFIG, universeSize: 6, candleHistoryDays: 70, rebalanceIntervalDays: 7, minUniverseForRebalance: 1 };

    // Tick 1: open the book with the full universe.
    await runDailyCycle({ data: fakeData(), store, config: cfg, now: 10 * DAY });
    const held = store.getAccountState()!.positions.map((p) => p.coin);
    expect(held.length).toBeGreaterThan(0);
    const dropped = held[0]!;

    // Tick 2 (rebalance due): `dropped` has fallen out of the universe, but its
    // candles are still served so it can be priced and exited.
    const base = fakeData();
    const shrunk: MarketDataSource = {
      ...base,
      async getUniverse(size: number): Promise<AssetContext[]> {
        return (await base.getUniverse(size)).filter((c) => c.name !== dropped);
      },
    };
    await runDailyCycle({ data: shrunk, store, config: cfg, now: 17 * DAY });

    const after = store.getAccountState()!.positions.map((p) => p.coin);
    expect(after).not.toContain(dropped);
    const exits = store.getRecentTrades(100).filter((t) => t.timestamp === 17 * DAY && t.coin === dropped);
    expect(exits.length).toBeGreaterThan(0);
    store.close();
  });

  it("vol-targets the live rebalance: turbulent equity history shrinks gross exposure", async () => {
    const marks: Record<string, number> = { UP1: 170, UP2: 140, MID: 104, DN1: 75, DN2: 50, DN3: 40 };
    const gross = (store: SqliteDatastore) =>
      store.getAccountState()!.positions.reduce((s, p) => s + Math.abs(p.size) * marks[p.coin]!, 0);

    function seeded() {
      const store = new SqliteDatastore(":memory:");
      store.init();
      // A volatile equity history (huge swings) -> high realized vol -> de-risk.
      [100_000, 80_000, 120_000, 75_000, 110_000, 90_000].forEach((eq, i) =>
        store.saveEquityPoint({ timestamp: i * DAY, equity: eq, pricePnl: 0, fundingPnl: 0, fees: 0 }));
      store.saveAccountState({ initialCapital: 100_000, cash: 100_000, positions: [], realizedPricePnl: 0, feesPaid: 0, fundingPnl: 0 });
      store.saveRunnerState({ lastMarkAt: 5 * DAY, lastRebalanceAt: 0 });
      return store;
    }
    const base: Config = { ...DEFAULT_CONFIG, universeSize: 6, candleHistoryDays: 70, rebalanceIntervalDays: 7, minUniverseForRebalance: 1 };

    const on = seeded();
    await runDailyCycle({ data: fakeData(), store: on, config: { ...base, volTarget: 0.25, maxLeverage: 1.5 }, now: 20 * DAY });
    const off = seeded();
    await runDailyCycle({ data: fakeData(), store: off, config: { ...base, volTarget: 0 }, now: 20 * DAY });

    // With vol-targeting the gross is scaled far below ~1x NAV; without it ~1x.
    expect(gross(on)).toBeLessThan(0.5 * gross(off));
    expect(gross(off)).toBeGreaterThan(80_000); // ~1x of the ~100k NAV
    on.close();
    off.close();
  });
});
