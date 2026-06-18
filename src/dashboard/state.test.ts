import { describe, it, expect } from "vitest";
import { buildDashboardState } from "./state.js";
import { SqliteDatastore } from "../core/store/index.js";

function seeded() {
  const s = new SqliteDatastore(":memory:");
  s.init();
  s.saveEquityPoint({ timestamp: 0, equity: 100_000, pricePnl: 0, fundingPnl: 0, fees: 0 });
  s.saveEquityPoint({ timestamp: 86_400_000, equity: 104_000, pricePnl: 4_300, fundingPnl: -50, fees: 250 });
  s.saveAccountState({ initialCapital: 100_000, cash: 100_000, positions: [{ coin: "BTC", size: 1, entry: 100 }, { coin: "ETH", size: -2, entry: 50 }], realizedPricePnl: 0, feesPaid: 250, fundingPnl: -50 });
  s.saveSignal(86_400_000, [{ coin: "BTC", score: 1.5 }, { coin: "ETH", score: -0.8 }]);
  s.saveTrades(86_400_000, [{ coin: "BTC", deltaSize: 1, fillPrice: 100, fee: 0.5, notional: 100 }]);
  return s;
}

describe("buildDashboardState", () => {
  it("aggregates equity, metrics, positions, P&L, and the latest signal", () => {
    const s = seeded();
    const d = buildDashboardState(s);
    expect(d.equityCurve).toHaveLength(2);
    expect(d.latestEquity).toBeCloseTo(104_000, 6);
    expect(d.totalReturn).toBeCloseTo(0.04, 6);
    expect(d.metrics.maxDrawdown).toBeCloseTo(0, 6);
    expect(d.pnl).toEqual({ price: 4_300, funding: -50, fees: 250 });
    expect(d.positions.map((p) => [p.coin, p.side])).toEqual([["BTC", "long"], ["ETH", "short"]]);
    // USD notional at entry: BTC 1×100, ETH 2×50; gross = sum.
    expect(d.positions.map((p) => p.notional)).toEqual([100, 100]);
    expect(d.grossAtEntry).toBe(200);
    // Daily candles from the 2 equity points (day 0 and day 1).
    expect(d.candles).toHaveLength(2);
    expect(d.candles[1]).toMatchObject({ open: 100_000, close: 104_000 });
    // Signal ranking joins scores with held side.
    expect(d.signalRanking).toEqual([
      { coin: "BTC", score: 1.5, held: "long", funding: null, inUniverse: true },
      { coin: "ETH", score: -0.8, held: "short", funding: null, inUniverse: true },
    ]);
    expect(d.latestSignal!.strongest.coin).toBe("BTC");
    expect(d.latestSignal!.weakest.coin).toBe("ETH");
    expect(d.recentTrades).toEqual([{ timestamp: 86_400_000, coin: "BTC", side: "buy", size: 1, fillPrice: 100, fee: 0.5 }]);
    s.close();
  });

  it("appends held positions that have dropped out of the ranked universe", () => {
    const s = new SqliteDatastore(":memory:");
    s.init();
    s.saveEquityPoint({ timestamp: 0, equity: 100_000, pricePnl: 0, fundingPnl: 0, fees: 0 });
    // Hold BTC (scored) + AAVE (short, NOT in the latest signal → stranded).
    s.saveAccountState({ initialCapital: 100_000, cash: 100_000, positions: [{ coin: "BTC", size: 1, entry: 100 }, { coin: "AAVE", size: -2, entry: 50 }], realizedPricePnl: 0, feesPaid: 0, fundingPnl: 0 });
    s.saveSignal(1, [{ coin: "BTC", score: 1.2 }, { coin: "SOL", score: -0.5 }]);
    const d = buildDashboardState(s);
    // Ranked rows first, then the stranded held leg flagged inUniverse:false.
    expect(d.signalRanking).toEqual([
      { coin: "BTC", score: 1.2, held: "long", funding: null, inUniverse: true },
      { coin: "SOL", score: -0.5, held: null, funding: null, inUniverse: true },
      { coin: "AAVE", score: null, held: "short", funding: null, inUniverse: false },
    ]);
    s.close();
  });

  it("is empty-safe on a fresh store", () => {
    const s = new SqliteDatastore(":memory:");
    s.init();
    const d = buildDashboardState(s);
    expect(d.equityCurve).toEqual([]);
    expect(d.candles).toEqual([]);
    expect(d.latestEquity).toBe(0);
    expect(d.positions).toEqual([]);
    expect(d.grossAtEntry).toBe(0);
    expect(d.pnl).toBeNull();
    expect(d.recentTrades).toEqual([]);
    expect(d.latestSignal).toBeNull();
    expect(d.signalRanking).toEqual([]);
    s.close();
  });
});
