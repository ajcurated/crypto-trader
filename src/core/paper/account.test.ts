import { describe, it, expect } from "vitest";
import { PaperAccount } from "./account.js";
import type { PaperParams } from "./types.js";

const PARAMS: PaperParams = { feeRate: 0.00045, slippageCoeff: 0, maxSlippage: 0.02 };
// slippageCoeff 0 keeps fills at mid so the arithmetic is hand-checkable.

function prices(p: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(p));
}

describe("PaperAccount", () => {
  it("starts at initial capital with no positions", () => {
    const acct = new PaperAccount(100_000, PARAMS);
    expect(acct.equity(prices({}))).toBe(100_000);
    expect(acct.positions()).toEqual([]);
  });

  it("rebalances into a dollar-neutral book and charges fees", () => {
    const acct = new PaperAccount(100_000, PARAMS);
    const fills = acct.rebalance(
      new Map([["BTC", 0.5], ["ETH", -0.5]]),
      prices({ BTC: 100, ETH: 50 }),
      new Map([["BTC", 1e12], ["ETH", 1e12]]),
    );
    const byCoin = Object.fromEntries(fills.map((f) => [f.coin, f]));
    expect(byCoin["BTC"]!.deltaSize).toBeCloseTo(500, 6);
    expect(byCoin["ETH"]!.deltaSize).toBeCloseTo(-1000, 6);
    expect(acct.equity(prices({ BTC: 100, ETH: 50 }))).toBeCloseTo(99_955, 6);
    const sides = acct.positions().map((p) => [p.coin, p.side]).sort();
    expect(sides).toEqual([["BTC", "long"], ["ETH", "short"]]);
  });

  it("marks to market with P&L decomposed into price / funding / fees", () => {
    const acct = new PaperAccount(100_000, PARAMS);
    acct.rebalance(
      new Map([["BTC", 0.5], ["ETH", -0.5]]),
      prices({ BTC: 100, ETH: 50 }),
      new Map([["BTC", 1e12], ["ETH", 1e12]]),
    );
    const point = acct.mark(prices({ BTC: 110, ETH: 55 }), 1_000);
    expect(point.timestamp).toBe(1_000);
    expect(point.pricePnl).toBeCloseTo(0, 6);
    expect(point.fees).toBeCloseTo(45, 6);
    expect(point.fundingPnl).toBeCloseTo(0, 6);
    expect(point.equity).toBeCloseTo(99_955, 6);
    expect(point.equity).toBeCloseTo(100_000 + point.pricePnl + point.fundingPnl - point.fees, 6);
  });

  it("accrues funding into cash and the funding P&L component", () => {
    const acct = new PaperAccount(100_000, PARAMS);
    acct.rebalance(
      new Map([["BTC", 0.5], ["ETH", -0.5]]),
      prices({ BTC: 100, ETH: 50 }),
      new Map([["BTC", 1e12], ["ETH", 1e12]]),
    );
    const f = acct.accrueFunding(new Map([["BTC", 0.0001], ["ETH", 0.0001]]), prices({ BTC: 100, ETH: 50 }));
    expect(f).toBeCloseTo(0, 6);
    const f2 = acct.accrueFunding(new Map([["BTC", 0.0002]]), prices({ BTC: 100, ETH: 50 }));
    expect(f2).toBeCloseTo(-10, 6);
    const point = acct.mark(prices({ BTC: 100, ETH: 50 }), 2_000);
    expect(point.fundingPnl).toBeCloseTo(-10, 6);
    expect(point.equity).toBeCloseTo(99_945, 6);
  });
});
