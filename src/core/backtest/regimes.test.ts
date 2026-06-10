import { describe, it, expect } from "vitest";
import { analyzeRegimes } from "./regimes.js";
import type { PreparedBacktest } from "./prepare.js";
import type { Strategy } from "./strategy.js";

const DAY = 86_400_000;
const CFG = { paper: { feeRate: 0.00045, slippageCoeff: 0.1, maxSlippage: 0.02 }, initialCapital: 100_000 };
const FAST: Strategy = { name: "fast", description: "", signal: { lookbacks: [7, 14], quintileFraction: 0.2, grossExposure: 1, hysteresisBuffer: 1 }, rebalanceEveryDays: 3 };

// BTC rises the whole time; a spread of other coins for cross-section.
function prep(L = 150): PreparedBacktest {
  const slopes: Record<string, number> = { BTC: 1, UP2: 0.7, MIDA: 0.1, MIDB: -0.1, DN1: -0.4, DN2: -1 };
  const closesByCoin = new Map<string, number[]>();
  const volumeByCoin = new Map<string, number>();
  const fundingByDayByCoin = new Map<string, number[]>();
  for (const [coin, slope] of Object.entries(slopes)) {
    closesByCoin.set(coin, Array.from({ length: L }, (_, i) => 100 + slope * i));
    volumeByCoin.set(coin, 1e12);
    fundingByDayByCoin.set(coin, Array.from({ length: L }, () => 0));
  }
  return { closesByCoin, volumeByCoin, dayTimestamps: Array.from({ length: L }, (_, i) => i * DAY), fundingByDayByCoin };
}

describe("analyzeRegimes", () => {
  it("splits history into blocks with market + strategy stats", () => {
    const blocks = analyzeRegimes(prep(), FAST, CFG, { blockLen: 40 });
    // warmup 15, L 150, blockLen 40 -> [15,55),[55,95),[95,135) = 3 blocks
    expect(blocks).toHaveLength(3);
    for (const b of blocks) {
      expect(b.btcReturn).toBeGreaterThan(0); // BTC rises every block
      expect(b.pctUp).toBeGreaterThanOrEqual(0);
      expect(b.pctUp).toBeLessThanOrEqual(1);
      expect(Number.isFinite(b.stratSharpe)).toBe(true);
      expect(b.toTs).toBeGreaterThan(b.fromTs);
    }
  });

  it("returns no blocks when history is shorter than warmup + blockLen", () => {
    expect(analyzeRegimes(prep(20), FAST, CFG, { blockLen: 40 })).toEqual([]);
  });
});
