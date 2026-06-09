import { describe, it, expect } from "vitest";
import { SqliteDatastore } from "./SqliteDatastore.js";
import type { MarketSnapshot } from "../Datastore.js";
import type { AssetContext } from "../../data/types.js";

function ctx(name: string, vol: number): AssetContext {
  return { name, dayNtlVlm: vol, funding: 0, markPx: 1, midPx: 1, oraclePx: 1, prevDayPx: 1, openInterest: 1 };
}

describe("SqliteDatastore", () => {
  it("round-trips a market snapshot", () => {
    const store = new SqliteDatastore(":memory:");
    store.init();

    const eth = ctx("ETH", 3);
    eth.midPx = null; // exercise the nullable midPx round-trip
    const snap: MarketSnapshot = { capturedAt: 1717200000000, universe: [eth, ctx("BTC", 1)] };
    store.saveMarketSnapshot(snap);

    const got = store.getLatestSnapshot();
    expect(got).toEqual(snap);
    expect(got?.universe[0]?.midPx).toBeNull();
    store.close();
  });

  it("getLatestSnapshot returns null when empty", () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    expect(store.getLatestSnapshot()).toBeNull();
    store.close();
  });

  it("returns the most recent of several snapshots", () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    store.saveMarketSnapshot({ capturedAt: 100, universe: [ctx("BTC", 1)] });
    store.saveMarketSnapshot({ capturedAt: 200, universe: [ctx("ETH", 2)] });
    expect(store.getLatestSnapshot()?.capturedAt).toBe(200);
    store.close();
  });

  it("saving the same capturedAt twice overwrites (idempotent re-run)", () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    store.saveMarketSnapshot({ capturedAt: 100, universe: [ctx("BTC", 1)] });
    store.saveMarketSnapshot({ capturedAt: 100, universe: [ctx("BTC", 9)] });
    expect(store.getLatestSnapshot()?.universe[0]!.dayNtlVlm).toBe(9);
    store.close();
  });
});
