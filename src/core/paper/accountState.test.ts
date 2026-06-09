import { describe, it, expect } from "vitest";
import { PaperAccount } from "./account.js";
import type { PaperParams } from "./types.js";

const PARAMS: PaperParams = { feeRate: 0.00045, slippageCoeff: 0, maxSlippage: 0.02 };
const prices = (p: Record<string, number>) => new Map(Object.entries(p));

describe("PaperAccount state round-trip", () => {
  it("restores cash, positions, and P&L accumulators exactly", () => {
    const a = new PaperAccount(100_000, PARAMS);
    a.rebalance(new Map([["BTC", 0.5], ["ETH", -0.5]]), prices({ BTC: 100, ETH: 50 }), new Map([["BTC", 1e12], ["ETH", 1e12]]));
    a.accrueFunding(new Map([["BTC", 0.0002]]), prices({ BTC: 100, ETH: 50 }));

    const state = a.toState();
    const b = PaperAccount.fromState(state, PARAMS);

    const pa = a.mark(prices({ BTC: 110, ETH: 55 }), 1);
    const pb = b.mark(prices({ BTC: 110, ETH: 55 }), 1);
    expect(pb).toEqual(pa);
    expect(b.positions()).toEqual(a.positions());
  });
});
