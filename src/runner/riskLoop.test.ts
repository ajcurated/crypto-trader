import { describe, it, expect, vi } from "vitest";
import { RiskLoop, type RiskLoopDeps } from "./riskLoop.js";
import { SqliteDatastore } from "../core/store/index.js";
import { DEFAULT_CONFIG } from "../config.js";
import type { MarketDataSource, AssetContext, WatchHandlers, WatchHandle, Candle, FundingPoint } from "../core/data/index.js";

const PARAMS = DEFAULT_CONFIG.paper;

function ctx(name: string, mark: number, funding = 0): AssetContext {
  return { name, dayNtlVlm: 1e12, funding, markPx: mark, midPx: mark, oraclePx: mark, prevDayPx: mark, openInterest: 1 };
}

function fakeData() {
  let handlers: WatchHandlers | null = null;
  const ds: MarketDataSource = {
    async getUniverse(): Promise<AssetContext[]> { return []; },
    async getDailyCandles(): Promise<Candle[]> { return []; },
    async getFundingHistory(): Promise<FundingPoint[]> { return []; },
    watch(_coins: string[], h: WatchHandlers): WatchHandle {
      handlers = h;
      return { status: () => "connected", close: () => {} };
    },
  };
  return { ds, push: (c: AssetContext) => handlers!.onCtx(c) };
}

function seededStore() {
  const store = new SqliteDatastore(":memory:");
  store.init();
  store.saveAccountState({
    initialCapital: 1_000,
    cash: 1_000,
    positions: [{ coin: "BTC", size: 10, entry: 100 }, { coin: "ETH", size: -20, entry: 50 }],
    realizedPricePnl: 0, feesPaid: 0, fundingPnl: 0,
  });
  return store;
}

function deps(
  store: SqliteDatastore,
  data: MarketDataSource,
  notify = { send: vi.fn(async () => {}) },
  risk = { spreadStopPct: 0.08, circuitBreakerBand: 0.15, fundingAlertAnnualized: 0.5 },
): RiskLoopDeps {
  return { data, store, notify, paper: PARAMS, risk };
}

describe("RiskLoop", () => {
  it("flattens a leg and notifies when it gaps beyond the circuit-breaker band", async () => {
    const store = seededStore();
    const { ds, push } = fakeData();
    const notify = { send: vi.fn(async () => {}) };
    // High spread-stop threshold isolates the per-leg circuit breaker: BTC's
    // -20% gap trips the leg breaker without the book-level stop also firing.
    const risk = { spreadStopPct: 0.5, circuitBreakerBand: 0.15, fundingAlertAnnualized: 0.5 };
    const loop = new RiskLoop(deps(store, ds, notify, risk));
    loop.start();
    push(ctx("ETH", 50));
    push(ctx("BTC", 80));
    await loop.idle();
    const state = store.getAccountState()!;
    expect(state.positions.map((p) => p.coin)).toEqual(["ETH"]);
    expect(notify.send).toHaveBeenCalled();
    loop.stop();
    store.close();
  });

  it("flattens the whole book on a spread stop", async () => {
    const store = seededStore();
    const { ds, push } = fakeData();
    const loop = new RiskLoop(deps(store, ds));
    loop.start();
    push(ctx("BTC", 95));
    push(ctx("ETH", 53));
    await loop.idle();
    expect(store.getAccountState()!.positions).toEqual([]);
    loop.stop();
    store.close();
  });

  it("only alerts (no flatten) on a funding spike", async () => {
    const store = seededStore();
    const { ds, push } = fakeData();
    const notify = { send: vi.fn(async () => {}) };
    const loop = new RiskLoop(deps(store, ds, notify));
    loop.start();
    push(ctx("BTC", 100, 0.0001));
    push(ctx("ETH", 50));
    await loop.idle();
    expect(store.getAccountState()!.positions.map((p) => p.coin).sort()).toEqual(["BTC", "ETH"]);
    expect(notify.send).toHaveBeenCalled();
    loop.stop();
    store.close();
  });

  it("still flattens (and idle resolves) even when the notifier keeps failing", async () => {
    const store = seededStore();
    const { ds, push } = fakeData();
    const notify = { send: vi.fn(async () => { throw new Error("down"); }) };
    const loop = new RiskLoop(deps(store, ds, notify));
    loop.start();
    push(ctx("BTC", 95));
    push(ctx("ETH", 53)); // spread stop
    await expect(loop.idle()).resolves.toBeUndefined(); // chain not poisoned
    expect(store.getAccountState()!.positions).toEqual([]); // flatten still happened
    loop.stop();
    store.close();
  });
});
