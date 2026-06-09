import { describe, it, expect } from "vitest";
import { SqliteDatastore } from "./SqliteDatastore.js";
import type { EquityPoint, AccountState } from "../../paper/index.js";
import type { CoinScore } from "../../signal/index.js";

function store() {
  const s = new SqliteDatastore(":memory:");
  s.init();
  return s;
}

const eq = (timestamp: number, equity: number): EquityPoint => ({ timestamp, equity, pricePnl: 0, fundingPnl: 0, fees: 0 });

describe("SqliteDatastore Phase 4 persistence", () => {
  it("appends and returns the equity curve oldest-first", () => {
    const s = store();
    s.saveEquityPoint(eq(200, 101));
    s.saveEquityPoint(eq(100, 100));
    expect(s.getEquityCurve().map((p) => p.timestamp)).toEqual([100, 200]);
    s.close();
  });

  it("round-trips account state (replacing the single row)", () => {
    const s = store();
    const a: AccountState = { initialCapital: 100, cash: 90, positions: [{ coin: "BTC", size: 1, entry: 100 }], realizedPricePnl: 1, feesPaid: 2, fundingPnl: 3 };
    s.saveAccountState(a);
    s.saveAccountState({ ...a, cash: 80 });
    expect(s.getAccountState()).toEqual({ ...a, cash: 80 });
    s.close();
  });

  it("round-trips runner state and returns null when empty", () => {
    const s = store();
    expect(s.getRunnerState()).toBeNull();
    s.saveRunnerState({ lastMarkAt: 10, lastRebalanceAt: 5 });
    expect(s.getRunnerState()).toEqual({ lastMarkAt: 10, lastRebalanceAt: 5 });
    s.close();
  });

  it("stores the latest signal", () => {
    const s = store();
    const scores: CoinScore[] = [{ coin: "BTC", score: 1.2 }, { coin: "ETH", score: -0.3 }];
    s.saveSignal(100, scores);
    s.saveSignal(200, [{ coin: "SOL", score: 0.5 }]);
    expect(s.getLatestSignal()).toEqual({ capturedAt: 200, scores: [{ coin: "SOL", score: 0.5 }] });
    s.close();
  });
});
