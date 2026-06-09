import { describe, it, expect } from "vitest";
import { PaperAccount } from "./account.js";
import type { PaperParams } from "./types.js";

const PARAMS: PaperParams = { feeRate: 0.00045, slippageCoeff: 0, maxSlippage: 0.02 };
const prices = (p: Record<string, number>) => new Map(Object.entries(p));
const vols = (p: Record<string, number>) => new Map(Object.entries(p));

describe("PaperAccount.flatten", () => {
  it("closes the named positions and leaves others open", () => {
    const a = new PaperAccount(100_000, PARAMS);
    a.rebalance(new Map([["BTC", 0.5], ["ETH", -0.5]]), prices({ BTC: 100, ETH: 50 }), vols({ BTC: 1e12, ETH: 1e12 }));
    a.flatten(["ETH"], prices({ BTC: 100, ETH: 50 }), vols({ BTC: 1e12, ETH: 1e12 }));
    expect(a.positions().map((p) => p.coin)).toEqual(["BTC"]);
  });

  it("flattening all held coins returns the book to cash-only and preserves the P&L identity", () => {
    const a = new PaperAccount(100_000, PARAMS);
    a.rebalance(new Map([["BTC", 0.5], ["ETH", -0.5]]), prices({ BTC: 100, ETH: 50 }), vols({ BTC: 1e12, ETH: 1e12 }));
    a.flatten(["BTC", "ETH"], prices({ BTC: 110, ETH: 55 }), vols({ BTC: 1e12, ETH: 1e12 }));
    expect(a.positions()).toEqual([]);
    const point = a.mark(prices({ BTC: 110, ETH: 55 }), 1);
    expect(point.equity).toBeCloseTo(100_000 + point.pricePnl + point.fundingPnl - point.fees, 6);
  });

  it("ignores coins that are not held or not priced", () => {
    const a = new PaperAccount(100_000, PARAMS);
    a.rebalance(new Map([["BTC", 0.5], ["ETH", -0.5]]), prices({ BTC: 100, ETH: 50 }), vols({ BTC: 1e12, ETH: 1e12 }));
    const fills = a.flatten(["SOL"], prices({ BTC: 100, ETH: 50 }), vols({ BTC: 1e12, ETH: 1e12 }));
    expect(fills).toEqual([]);
    expect(a.positions().map((p) => p.coin).sort()).toEqual(["BTC", "ETH"]);
  });
});
