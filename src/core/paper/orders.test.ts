import { describe, it, expect } from "vitest";
import { targetSignedSize, ordersToReach } from "./orders.js";

describe("targetSignedSize", () => {
  it("converts a signed weight + equity + price into a signed base size", () => {
    expect(targetSignedSize(0.25, 100_000, 100)).toBeCloseTo(250, 10);
    expect(targetSignedSize(-0.25, 100_000, 200)).toBeCloseTo(-125, 10);
  });
});

describe("ordersToReach", () => {
  it("emits the signed deltas that move current positions to target", () => {
    const current = new Map<string, number>([["BTC", 100]]);
    const target = new Map<string, number>([["BTC", 250], ["ETH", -125]]);
    const orders = ordersToReach(current, target);
    expect(orders).toEqual([
      { coin: "BTC", deltaSize: 150 },
      { coin: "ETH", deltaSize: -125 },
    ]);
  });

  it("closes positions absent from the target", () => {
    const current = new Map<string, number>([["BTC", 100], ["SOL", 50]]);
    const target = new Map<string, number>([["BTC", 100]]);
    expect(ordersToReach(current, target)).toEqual([{ coin: "SOL", deltaSize: -50 }]);
  });

  it("emits nothing when already at target", () => {
    const current = new Map<string, number>([["BTC", 100]]);
    const target = new Map<string, number>([["BTC", 100]]);
    expect(ordersToReach(current, target)).toEqual([]);
  });
});
