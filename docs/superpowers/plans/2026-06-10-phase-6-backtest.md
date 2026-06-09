# Phase 6: Backtesting Harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A proper, tested backtesting harness that walks the **same** signal + paper engine used live over historical candles, models funding from historical rates, and reports real performance metrics (total return, CAGR, annualized Sharpe, annualized vol, max drawdown, turnover) — replacing the throwaway `scripts/backtest.ts` demo.

**Architecture:** Three pure modules under `src/core/backtest/` — `metrics.ts` (equity-curve statistics), `fundingByDay.ts` (bucket hourly funding points into per-day rates), and `engine.ts` (`runBacktest`, which drives `buildTargetBook` + `PaperAccount` forward over per-coin close series, rebalancing on a cadence, accruing daily funding, marking daily). A thin CLI `backtest` command fetches real HyperLiquid candles + funding, prepares the inputs, runs the engine, and prints the report. The engine is pure (inputs in, results out) so it is fully unit-tested with deterministic fixtures.

**Tech Stack:** TypeScript (ESM, strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Vitest. No new dependencies.

---

## Locked decisions

- **Reuse the live engine:** the backtest calls the exact `buildTargetBook` and `PaperAccount` the daemon uses, so results reflect live behavior (fees, slippage, hysteresis, funding).
- **Inputs to `runBacktest`:** `closesByCoin: Map<coin, number[]>` (aligned, same length `L`), `volumeByCoin: Map<coin, number>` (flat daily volume for slippage), `fundingByDayByCoin: Map<coin, number[]>` (per-day summed funding rate, length `L`, optional — absent ⇒ no funding), `dayTimestamps: number[]` (length `L`, epoch ms per day), and params (`signal`, `paper`, `rebalanceEveryDays`, `warmupDays`, `initialCapital`).
- **Walk:** day `t` from `warmupDays` to `L-1`. Prices at day `t` are each coin's `close[t]`. On a rebalance day (`(t - warmupDays) % rebalanceEveryDays === 0`), build the target book from closes `[0..t]` and rebalance. Every day: accrue that day's funding (if provided), mark, record the equity point.
- **Metrics:** daily simple returns from the equity curve; `periodsPerYear` default 365; Sharpe at risk-free 0; max drawdown = worst peak-to-trough; CAGR over the curve's wall-clock span. Turnover = total traded notional / average equity, reported separately from fills.
- **`scripts/backtest.ts` is removed** — the CLI `backtest` command (with funding + metrics) supersedes it.

## File Structure (Phase 6)

| File | Responsibility |
|---|---|
| `src/core/backtest/metrics.ts` | `equityMetrics(curve, periodsPerYear?)` → return/CAGR/Sharpe/vol/maxDD |
| `src/core/backtest/fundingByDay.ts` | `bucketFundingByDay(points, dayTimestamps)` → per-day summed rates |
| `src/core/backtest/engine.ts` | `runBacktest(input)` → equity curve, metrics, counts, final book |
| `src/core/backtest/index.ts` | barrel |
| `src/cli.ts` (modify) | `backtest` command |
| `scripts/backtest.ts` | **deleted** |

Tests next to each module as `*.test.ts`.

---

### Task 1: Equity metrics (`metrics.ts`)

**Files:**
- Create: `src/core/backtest/metrics.ts`
- Test: `src/core/backtest/metrics.test.ts`

- [ ] **Step 1: Write the failing test `src/core/backtest/metrics.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { equityMetrics, type EquityCurvePoint } from "./metrics.js";

const DAY = 86_400_000;
const curve = (equities: number[]): EquityCurvePoint[] =>
  equities.map((equity, i) => ({ timestamp: i * DAY, equity }));

describe("equityMetrics", () => {
  it("computes total return and max drawdown", () => {
    // [100, 110, 99]: daily returns [0.1, -0.1]
    const m = equityMetrics(curve([100, 110, 99]));
    expect(m.totalReturn).toBeCloseTo(-0.01, 10);      // 99/100 - 1
    expect(m.maxDrawdown).toBeCloseTo(0.1, 10);         // peak 110 -> 99
    expect(m.annualizedVol).toBeCloseTo(Math.sqrt(0.02) * Math.sqrt(365), 6);
    expect(m.sharpe).toBeCloseTo(0, 10);                // mean daily return is 0
    expect(m.cagr).toBeLessThan(0);                     // negative over the span
  });

  it("reports a positive Sharpe for an upward-drifting curve", () => {
    const m = equityMetrics(curve([100, 101, 103, 104]));
    expect(m.sharpe).toBeGreaterThan(0);
    expect(m.totalReturn).toBeCloseTo(0.04, 10);
    expect(m.maxDrawdown).toBeCloseTo(0, 10);
  });

  it("returns zeros for a degenerate (<2 point) curve", () => {
    expect(equityMetrics(curve([100]))).toEqual({
      totalReturn: 0, cagr: 0, sharpe: 0, annualizedVol: 0, maxDrawdown: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/backtest/metrics.test.ts`
Expected: FAIL — cannot find module `./metrics.js`.

- [ ] **Step 3: Write `src/core/backtest/metrics.ts`**

```ts
export interface EquityCurvePoint {
  timestamp: number;
  equity: number;
}

export interface EquityMetrics {
  totalReturn: number;
  cagr: number;
  sharpe: number;
  annualizedVol: number;
  maxDrawdown: number;
}

const YEAR_MS = 365 * 86_400_000;
const ZERO: EquityMetrics = { totalReturn: 0, cagr: 0, sharpe: 0, annualizedVol: 0, maxDrawdown: 0 };

/** Performance statistics for an equity curve (oldest-first). Risk-free = 0. */
export function equityMetrics(curve: EquityCurvePoint[], periodsPerYear = 365): EquityMetrics {
  if (curve.length < 2) return ZERO;
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;

  const returns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    returns.push(curve[i]!.equity / curve[i - 1]!.equity - 1);
  }

  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const annualizedVol = sd * Math.sqrt(periodsPerYear);
  const sharpe = sd === 0 ? 0 : (mean * Math.sqrt(periodsPerYear)) / sd;

  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - p.equity) / peak);
  }

  const totalReturn = last.equity / first.equity - 1;
  const years = (last.timestamp - first.timestamp) / YEAR_MS;
  const cagr = years > 0 ? (last.equity / first.equity) ** (1 / years) - 1 : totalReturn;

  return { totalReturn, cagr, sharpe, annualizedVol, maxDrawdown };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/backtest/metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/backtest/metrics.ts src/core/backtest/metrics.test.ts
git commit -m "feat(backtest): equity-curve metrics (return, CAGR, Sharpe, vol, maxDD)"
```

---

### Task 2: Funding bucketing (`fundingByDay.ts`)

**Files:**
- Create: `src/core/backtest/fundingByDay.ts`
- Test: `src/core/backtest/fundingByDay.test.ts`

- [ ] **Step 1: Write the failing test `src/core/backtest/fundingByDay.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { bucketFundingByDay } from "./fundingByDay.js";
import type { FundingPoint } from "../data/index.js";

const DAY = 86_400_000;

describe("bucketFundingByDay", () => {
  it("sums each day's funding rates into a per-day array aligned to dayTimestamps", () => {
    const dayTimestamps = [0, DAY, 2 * DAY];
    const points: FundingPoint[] = [
      { coin: "BTC", rate: 0.0001, time: 100 },          // day 0
      { coin: "BTC", rate: 0.0002, time: DAY / 2 },       // day 0
      { coin: "BTC", rate: 0.0003, time: DAY + 100 },     // day 1
      // day 2 has none
    ];
    expect(bucketFundingByDay(points, dayTimestamps)).toEqual([0.0003, 0.0003, 0]);
  });

  it("returns all-zero for no points", () => {
    expect(bucketFundingByDay([], [0, DAY])).toEqual([0, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/backtest/fundingByDay.test.ts`
Expected: FAIL — cannot find module `./fundingByDay.js`.

- [ ] **Step 3: Write `src/core/backtest/fundingByDay.ts`**

```ts
import type { FundingPoint } from "../data/index.js";

const DAY = 86_400_000;

/**
 * Bucket funding points into a per-day summed rate aligned to `dayTimestamps`
 * (one entry per day). A point at time `t` belongs to day index `floor(t/DAY)`;
 * the result index is that day's position in `dayTimestamps`. Points outside the
 * covered days are ignored.
 */
export function bucketFundingByDay(points: FundingPoint[], dayTimestamps: number[]): number[] {
  const dayIndexOf = new Map<number, number>();
  dayTimestamps.forEach((ts, i) => dayIndexOf.set(Math.floor(ts / DAY), i));

  const out = new Array<number>(dayTimestamps.length).fill(0);
  for (const p of points) {
    const slot = dayIndexOf.get(Math.floor(p.time / DAY));
    if (slot !== undefined) out[slot]! += p.rate;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/backtest/fundingByDay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/backtest/fundingByDay.ts src/core/backtest/fundingByDay.test.ts
git commit -m "feat(backtest): bucket hourly funding points into per-day rates"
```

---

### Task 3: The backtest engine (`engine.ts`)

**Files:**
- Create: `src/core/backtest/engine.ts`
- Create: `src/core/backtest/index.ts`
- Test: `src/core/backtest/engine.test.ts`

- [ ] **Step 1: Write the failing test `src/core/backtest/engine.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { runBacktest, type BacktestInput } from "./engine.js";
import { DEFAULT_CONFIG } from "../../config.js";

const DAY = 86_400_000;

// Six coins with monotonic trends over 70 days; UP* rise, DN* fall.
function input(): BacktestInput {
  const names = ["UP1", "UP2", "MID", "DN1", "DN2", "DN3"];
  const slope: Record<string, number> = { UP1: 1, UP2: 0.6, MID: 0, DN1: -0.4, DN2: -0.7, DN3: -0.85 };
  const L = 70;
  const closesByCoin = new Map<string, number[]>();
  const volumeByCoin = new Map<string, number>();
  for (const n of names) {
    closesByCoin.set(n, Array.from({ length: L }, (_, i) => 100 + slope[n]! * i));
    volumeByCoin.set(n, 1e12);
  }
  const dayTimestamps = Array.from({ length: L }, (_, i) => i * DAY);
  return {
    closesByCoin,
    volumeByCoin,
    dayTimestamps,
    fundingByDayByCoin: new Map(),
    signal: { ...DEFAULT_CONFIG.signal, quintileFraction: 0.34 }, // 2 per side for n=6
    paper: DEFAULT_CONFIG.paper,
    rebalanceEveryDays: 7,
    warmupDays: 61,
    initialCapital: 100_000,
  };
}

describe("runBacktest", () => {
  it("produces an equity curve, rebalances on cadence, and longs the up-trenders", () => {
    const r = runBacktest(input());
    expect(r.equityCurve.length).toBe(70 - 61); // days 61..69
    expect(r.rebalances).toBeGreaterThanOrEqual(1);
    expect(r.metrics.totalReturn).toBeGreaterThan(0); // up-trenders long, down-trenders short
    const longs = r.finalPositions.filter((p) => p.side === "long").map((p) => p.coin);
    expect(longs).toContain("UP1");
  });

  it("applies funding when provided (reduces equity vs no funding for a net-paying book)", () => {
    const withFunding = input();
    // Charge positive funding on every coin every day: longs pay, shorts receive;
    // with equal notionals this nets ~0, so instead charge only the longs' coins.
    const fundedCoins = ["UP1", "UP2"];
    for (const [coin] of withFunding.closesByCoin) {
      withFunding.fundingByDayByCoin.set(
        coin,
        withFunding.dayTimestamps.map(() => (fundedCoins.includes(coin) ? 0.001 : 0)),
      );
    }
    const base = runBacktest(input());
    const funded = runBacktest(withFunding);
    // Longs paying funding drags equity below the no-funding run.
    expect(funded.equityCurve.at(-1)!.equity).toBeLessThan(base.equityCurve.at(-1)!.equity);
    expect(funded.fundingPnl).toBeLessThan(0);
  });

  it("returns an empty-ish result when warmup exceeds the series length", () => {
    const i = input();
    i.warmupDays = 100;
    const r = runBacktest(i);
    expect(r.equityCurve).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/backtest/engine.test.ts`
Expected: FAIL — cannot find module `./engine.js`.

- [ ] **Step 3: Write `src/core/backtest/engine.ts`**

```ts
import type { SignalParams, CurrentBook } from "../signal/index.js";
import type { PaperParams, Position } from "../paper/index.js";
import { buildTargetBook } from "../signal/index.js";
import { PaperAccount } from "../paper/index.js";
import { weightsFromBook, currentBookFromPositions } from "../../runner/adapters.js";
import { equityMetrics, type EquityCurvePoint, type EquityMetrics } from "./metrics.js";

export interface BacktestInput {
  closesByCoin: Map<string, number[]>;
  volumeByCoin: Map<string, number>;
  dayTimestamps: number[];
  /** Per-coin per-day funding rate (length = dayTimestamps.length). Empty ⇒ none. */
  fundingByDayByCoin: Map<string, number[]>;
  signal: SignalParams;
  paper: PaperParams;
  rebalanceEveryDays: number;
  warmupDays: number;
  initialCapital: number;
}

export interface BacktestResult {
  equityCurve: EquityCurvePoint[];
  metrics: EquityMetrics;
  rebalances: number;
  fills: number;
  fundingPnl: number;
  finalPositions: Position[];
}

/** Walk the live signal + paper engine forward over historical closes. */
export function runBacktest(input: BacktestInput): BacktestResult {
  const coins = [...input.closesByCoin.keys()];
  const L = input.dayTimestamps.length;
  const account = new PaperAccount(input.initialCapital, input.paper);
  const equityCurve: EquityCurvePoint[] = [];
  let current: CurrentBook = { longs: [], shorts: [] };
  let rebalances = 0;
  let fills = 0;

  for (let t = input.warmupDays; t < L; t++) {
    const prices = new Map<string, number>();
    for (const c of coins) {
      const series = input.closesByCoin.get(c)!;
      if (t < series.length) prices.set(c, series[t]!);
    }

    // Accrue this day's funding on the held book (before any rebalance).
    const rates = new Map<string, number>();
    for (const p of account.positions()) {
      const byDay = input.fundingByDayByCoin.get(p.coin);
      if (byDay && t < byDay.length) rates.set(p.coin, byDay[t]!);
    }
    if (rates.size > 0) account.accrueFunding(rates, prices);

    if ((t - input.warmupDays) % input.rebalanceEveryDays === 0) {
      const history = new Map<string, number[]>();
      for (const c of coins) history.set(c, input.closesByCoin.get(c)!.slice(0, t + 1));
      const { book } = buildTargetBook(history, input.signal, current);
      const f = account.rebalance(weightsFromBook(book), prices, input.volumeByCoin);
      fills += f.length;
      rebalances += 1;
      current = currentBookFromPositions(account.positions());
    }

    const point = account.mark(prices, input.dayTimestamps[t]!);
    equityCurve.push({ timestamp: point.timestamp, equity: point.equity });
  }

  const lastMark = equityCurve.length > 0 ? account.mark(lastPrices(input, coins, L), input.dayTimestamps[L - 1]!) : null;
  return {
    equityCurve,
    metrics: equityMetrics(equityCurve),
    rebalances,
    fills,
    fundingPnl: lastMark ? lastMark.fundingPnl : 0,
    finalPositions: account.positions(),
  };
}

function lastPrices(input: BacktestInput, coins: string[], L: number): Map<string, number> {
  const prices = new Map<string, number>();
  for (const c of coins) {
    const series = input.closesByCoin.get(c)!;
    if (L - 1 < series.length) prices.set(c, series[L - 1]!);
  }
  return prices;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/backtest/engine.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Write `src/core/backtest/index.ts`**

```ts
export type { EquityCurvePoint, EquityMetrics } from "./metrics.js";
export { equityMetrics } from "./metrics.js";
export { bucketFundingByDay } from "./fundingByDay.js";
export type { BacktestInput, BacktestResult } from "./engine.js";
export { runBacktest } from "./engine.js";
```

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/backtest/engine.ts src/core/backtest/index.ts src/core/backtest/engine.test.ts
git commit -m "feat(backtest): walk-forward engine reusing the live signal + paper engine"
```

---

### Task 4: CLI `backtest` command (+ remove the old script)

**Files:**
- Modify: `src/cli.ts`
- Delete: `scripts/backtest.ts`
- Modify: `package.json`

- [ ] **Step 1: Add a `backtest` command to `src/cli.ts`**

Add imports:

```ts
import { runBacktest, bucketFundingByDay } from "./core/backtest/index.js";
```

Add a `backtest` branch (before the unknown-command `else`). It fetches the universe + candles + funding, aligns them, and runs the engine:

```ts
    } else if (command === "backtest") {
      const data = new HyperLiquidDataSource();
      const universe = await data.getUniverse(config.universeSize);
      const volumeByCoin = new Map(universe.map((c) => [c.name, c.dayNtlVlm]));

      const rawCloses = new Map<string, number[]>();
      const rawCandles = new Map<string, { closeTime: number }[]>();
      for (const c of universe) {
        try {
          const candles = await data.getDailyCandles(c.name, config.candleHistoryDays);
          if (candles.length > 0) {
            rawCloses.set(c.name, candles.map((k) => k.close));
            rawCandles.set(c.name, candles);
          }
        } catch { /* skip flaky coin */ }
      }
      const L = Math.min(...[...rawCloses.values()].map((a) => a.length));
      const coins = [...rawCloses.keys()];
      const closesByCoin = new Map(coins.map((c) => [c, rawCloses.get(c)!.slice(-L)]));
      const dayTimestamps = rawCandles.get(coins[0]!)!.slice(-L).map((k) => k.closeTime);

      const fundingByDayByCoin = new Map<string, number[]>();
      const since = dayTimestamps[0]! - 86_400_000;
      for (const c of coins) {
        try {
          const pts = await data.getFundingHistory(c, since);
          fundingByDayByCoin.set(c, bucketFundingByDay(pts, dayTimestamps));
        } catch { /* no funding for this coin */ }
      }

      const result = runBacktest({
        closesByCoin, volumeByCoin, dayTimestamps, fundingByDayByCoin,
        signal: config.signal, paper: config.paper,
        rebalanceEveryDays: config.rebalanceIntervalDays,
        warmupDays: Math.max(...config.signal.lookbacks) + 1,
        initialCapital: config.initialCapital,
      });

      const m = result.metrics;
      const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
      console.log("=== backtest ===");
      console.log(`days: ${result.equityCurve.length}, rebalances: ${result.rebalances}, fills: ${result.fills}`);
      console.log(`total return: ${pct(m.totalReturn)}   CAGR: ${pct(m.cagr)}`);
      console.log(`Sharpe: ${m.sharpe.toFixed(2)}   ann.vol: ${pct(m.annualizedVol)}   maxDD: ${pct(m.maxDrawdown)}`);
      console.log(`funding P&L: $${result.fundingPnl.toFixed(2)}`);
      console.log(`final book: ${result.finalPositions.map((p) => `${p.side === "long" ? "+" : "-"}${p.coin}`).join(" ")}`);
```

Update the usage string to `usage: cli.ts [run|report|watch|daemon|backtest]`.

- [ ] **Step 2: Delete the old script and add the npm script**

```bash
git rm scripts/backtest.ts
```

In `package.json` `"scripts"`, add:

```json
    "backtest": "tsx src/cli.ts backtest",
```

- [ ] **Step 3: Full verification**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: ALL pass (Phases 1–5 suite + metrics/fundingByDay/engine).

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts package.json
git commit -m "feat(cli): backtest command with funding + metrics; remove demo script"
```

---

## Self-Review

**Spec coverage:**
- §12 "Backtesting harness over persisted snapshots" → Tasks 1–4 (a forward backtest over fetched candles; reuses the live engine) ✔ — note this backtests over *fetched* candles rather than the persisted snapshot store; that's a deliberate simplification (the snapshot store holds only recent snapshots, not a deep history), and is honest because it uses the same signal/paper engine as live.
- Honest funding in evaluation (addresses the Phase 3 backtest's omission) → Tasks 2–3 ✔
- Performance metrics for strategy evaluation → Task 1 ✔

**Out of scope (deferred):** parameter sweeps / optimization, multiple-window walk-forward validation, transaction-cost sensitivity, persisting backtest runs. The engine being pure makes a sweep a trivial later add (call `runBacktest` in a loop).

**Placeholder scan:** none — every code step is complete. The engine's `lastPrices` helper and the `fundingPnl` extraction via a final `mark` are concrete.

**Type consistency:** `EquityCurvePoint`/`EquityMetrics` from `metrics.ts` flow into `engine.ts` and the barrel. `BacktestInput`/`BacktestResult` are consistent between `engine.ts`, its test, and the CLI call. The engine reuses `buildTargetBook`, `PaperAccount`, `weightsFromBook`, `currentBookFromPositions` with their existing signatures. `bucketFundingByDay(points, dayTimestamps)` argument order matches across module, test, and CLI. The CLI builds `BacktestInput` with exactly the fields the engine destructures.
