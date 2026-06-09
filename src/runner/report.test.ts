import { describe, it, expect } from "vitest";
import { formatReport } from "./report.js";
import { SqliteDatastore } from "../core/store/index.js";

describe("formatReport", () => {
  it("summarizes equity, return, and the latest signal", () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    store.saveEquityPoint({ timestamp: 0, equity: 100_000, pricePnl: 0, fundingPnl: 0, fees: 0 });
    store.saveEquityPoint({ timestamp: 86_400_000, equity: 105_000, pricePnl: 5_200, fundingPnl: -50, fees: 150 });
    store.saveAccountState({ initialCapital: 100_000, cash: 100_000, positions: [{ coin: "BTC", size: 1, entry: 100 }], realizedPricePnl: 0, feesPaid: 150, fundingPnl: -50 });
    store.saveSignal(86_400_000, [{ coin: "BTC", score: 1.2 }]);

    const out = formatReport(store);
    expect(out).toContain("105,000");
    expect(out).toContain("+5.00%");
    expect(out).toContain("BTC");
    store.close();
  });

  it("reports an empty store gracefully", () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    expect(formatReport(store)).toContain("no equity history");
    store.close();
  });
});
