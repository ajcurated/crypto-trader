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
  it("flattens a gapped leg then re-equalizes the survivors to dollar-neutral", async () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    // 2 longs (1000 each), 1 short (500). When BTC is flattened the book is left
    // long-tilted (SOL 1000 vs ETH 500); the loop must trim SOL back to neutral.
    store.saveAccountState({
      initialCapital: 10_000, cash: 10_000,
      positions: [{ coin: "BTC", size: 10, entry: 100 }, { coin: "SOL", size: 10, entry: 100 }, { coin: "ETH", size: -10, entry: 50 }],
      realizedPricePnl: 0, feesPaid: 0, fundingPnl: 0,
    });
    const { ds, push } = fakeData();
    const notify = { send: vi.fn(async () => {}) };
    // High spread-stop threshold isolates the per-leg circuit breaker.
    const risk = { spreadStopPct: 0.5, circuitBreakerBand: 0.15, fundingAlertAnnualized: 0.5 };
    const loop = new RiskLoop(deps(store, ds, notify, risk));
    loop.start();
    push(ctx("ETH", 50));
    push(ctx("SOL", 100));
    push(ctx("BTC", 80)); // -20% -> trips the leg breaker
    await loop.idle();

    const byCoin = Object.fromEntries(store.getAccountState()!.positions.map((p) => [p.coin, p.size]));
    expect(byCoin["BTC"]).toBeUndefined(); // gapped leg gone
    expect(byCoin["SOL"]).toBeCloseTo(5, 6); // long side trimmed 10 -> 5 to match the short
    expect(byCoin["ETH"]).toBeCloseTo(-10, 6); // lighter side untouched
    // Book is dollar-neutral again: |SOL|·100 == |ETH|·50.
    expect(Math.abs(byCoin["SOL"]!) * 100).toBeCloseTo(Math.abs(byCoin["ETH"]!) * 50, 6);
    expect(notify.send).toHaveBeenCalled();
    loop.stop();
    store.close();
  });

  it("neutralizes to flat when a per-leg flatten empties a side", async () => {
    const store = seededStore(); // BTC long 10@100, ETH short 20@50
    const { ds, push } = fakeData();
    const risk = { spreadStopPct: 0.5, circuitBreakerBand: 0.15, fundingAlertAnnualized: 0.5 };
    const loop = new RiskLoop(deps(store, ds, undefined, risk));
    loop.start();
    push(ctx("ETH", 50));
    push(ctx("BTC", 80)); // flattening the only long empties the long side
    await loop.idle();
    // A one-sided (short-only) book is pure direction -> neutral target is flat.
    expect(store.getAccountState()!.positions).toEqual([]);
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
    expect(store.getRecentTrades(100).length).toBeGreaterThan(0); // flatten fills logged
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

  it("liveSnapshot reports live NAV + per-position unrealized P&L from WS marks", async () => {
    const store = seededStore(); // BTC long 10 @100, ETH short 20 @50, cash 1000
    const { ds, push } = fakeData();
    const loop = new RiskLoop(deps(store, ds));
    loop.start();
    push(ctx("BTC", 110)); // long +10/unit -> +100
    push(ctx("ETH", 45));  // short, fell 5 -> +100
    await loop.idle();

    const snap = loop.liveSnapshot()!;
    expect(snap.equity).toBeCloseTo(1200, 6); // 1000 cash + 100 + 100
    const byCoin = Object.fromEntries(snap.positions.map((p) => [p.coin, p.unrealizedPnl]));
    expect(byCoin["BTC"]).toBeCloseTo(100, 6);
    expect(byCoin["ETH"]).toBeCloseTo(100, 6);
    loop.stop();
    store.close();
  });
});
