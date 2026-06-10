import { describe, it, expect } from "vitest";
import { runComparison, formatComparison, type Strategy } from "./compare.js";
import { DEFAULT_CONFIG } from "../config.js";
import type { PreparedBacktest } from "../core/backtest/index.js";

const DAY = 86_400_000;

// Eight coins, linear up/down trends over 120 days.
function prep(): PreparedBacktest {
  const slopes: Record<string, number> = { UP1: 1, UP2: 0.7, UP3: 0.4, MIDA: 0.1, MIDB: -0.1, DN1: -0.4, DN2: -0.7, DN3: -1 };
  const L = 120;
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

const STRATS: Strategy[] = [
  { name: "fast", description: "short", signal: { lookbacks: [7, 14], quintileFraction: 0.2, grossExposure: 1, hysteresisBuffer: 1 }, rebalanceEveryDays: 3 },
  { name: "slow", description: "long", signal: { lookbacks: [60, 90], quintileFraction: 0.2, grossExposure: 1, hysteresisBuffer: 1 }, rebalanceEveryDays: 30 },
];

describe("runComparison", () => {
  it("runs every strategy over the same window (equal day counts) and returns finite metrics", () => {
    const results = runComparison(prep(), STRATS, { paper: DEFAULT_CONFIG.paper, initialCapital: 100_000 });
    expect(results.map((r) => r.name).sort()).toEqual(["fast", "slow"]);
    // common warmup = max(90)+1 = 91, L = 120 -> 29 days for BOTH strategies
    expect(results[0]!.days).toBe(29);
    expect(results[1]!.days).toBe(29);
    for (const r of results) {
      expect(Number.isFinite(r.sharpe)).toBe(true);
      expect(Number.isFinite(r.totalReturn)).toBe(true);
      expect(r.rebalances).toBeGreaterThan(0);
    }
  });

  it("formats a table sorted by Sharpe with all strategy names", () => {
    const results = runComparison(prep(), STRATS, { paper: DEFAULT_CONFIG.paper, initialCapital: 100_000 });
    const out = formatComparison(results, 8);
    expect(out).toContain("strategy comparison");
    expect(out).toContain("fast");
    expect(out).toContain("slow");
    expect(out).toContain("Sharpe");
  });
});
