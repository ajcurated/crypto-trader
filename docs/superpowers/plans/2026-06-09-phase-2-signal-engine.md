# Phase 2: Signal Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, deterministic signal engine that turns daily-candle close prices into a market-neutral target book — risk-adjusted cross-sectional momentum scoring, ranking, top/bottom-quintile long/short selection with a churn-damping hysteresis buffer, and dollar-neutral equal weighting.

**Architecture:** A new `src/core/signal/` module of pure functions (no I/O, no venue/db imports). Input is per-coin close-price arrays (`Map<string, number[]>`); the runner (Phase 4) will extract `closes = candles.map(c => c.close)` from the Phase 1 `Candle[]`, keeping the signal engine decoupled from the `Candle` type. Output is a `TargetBook` of signed-by-side equal weights. Every function is unit-tested against hand-computed fixtures (spec §11).

**Tech Stack:** TypeScript (ESM, strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Vitest. No new dependencies.

---

## Strategy recap (design spec §5)

- **Momentum score per coin** = `return_over_lookback / volatility_over_lookback` (risk-adjusted, Sharpe-like).
- Blend a **30-day and 60-day** lookback: z-score each lookback's raw momentum across the cross-section, then average the two z-scores.
- **Book**: rank by composite score; long the top quintile, short the bottom quintile; equal-weight within each side; dollar-neutral (long notional ≈ short notional); gross ≈ 1× NAV (≈0.5× per side).
- **Hysteresis**: an incumbent must leave the top/bottom quintile *by a margin* (buffer ranks) before being dropped, damping turnover near the rank boundary.

## File Structure (Phase 2)

| File | Responsibility |
|---|---|
| `src/core/signal/returns.ts` | Pure price math: daily returns, total return over a window, volatility, risk-adjusted momentum |
| `src/core/signal/score.ts` | `CoinScore` type, cross-sectional `zscore`, `compositeScores` (blend lookbacks) |
| `src/core/signal/book.ts` | Book types (`Side`, `TargetPosition`, `TargetBook`, `CurrentBook`), `perSideCount`, `applyHysteresis`, `weightBook` |
| `src/core/signal/signalEngine.ts` | `SignalParams` + `buildTargetBook` orchestrator (scores → rank → select → weight) |
| `src/core/signal/index.ts` | Barrel: public surface (types + `buildTargetBook`) |

Tests live next to each file as `*.test.ts`.

### Key design decisions (locked here so tasks stay consistent)

- **Returns**: simple returns `r_t = (c_t − c_{t−1}) / c_{t−1}`.
- **Total return over lookback L**: point-to-point `c_now / c_{now−L} − 1` (needs `L+1` closes).
- **Volatility**: **sample** stdev (÷ `n−1`) of the L daily returns (time-series convention).
- **z-score**: **population** stdev (÷ `n`) across the cross-section (standard z-score; well-behaved for small N). A zero-stdev cross-section yields all-zero z-scores.
- **Composite score** = mean of the per-lookback z-scores.
- **Hysteresis (simplified, dollar-neutral-preserving)**: the book may hold **between k and k+buffer** names per side. Longs = (top-k by rank) ∪ (incumbent longs still within top-(k+buffer)); symmetric for shorts. Each side is equal-weighted to sum to `grossExposure/2`, so **dollar-neutrality holds even when long/short counts differ**. With an empty current book this degenerates to plain top-k/bottom-k. Precondition: `n ≥ 2·(k+buffer)` so long/short hold-zones don't overlap (the engine filters to this regime; see Task 5).
- **Insufficient history**: coins with fewer than `max(lookbacks)+1` closes are **excluded** for that run (spec §10), before scoring.

---

### Task 1: Price math (`returns.ts`)

**Files:**
- Create: `src/core/signal/returns.ts`
- Test: `src/core/signal/returns.test.ts`

- [ ] **Step 1: Write the failing test `src/core/signal/returns.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { dailyReturns, totalReturn, volatility, riskAdjustedMomentum } from "./returns.js";

describe("dailyReturns", () => {
  it("computes simple period-over-period returns", () => {
    expect(dailyReturns([100, 110, 99])).toEqual([0.1, -0.1]);
  });
  it("returns empty for fewer than 2 closes", () => {
    expect(dailyReturns([100])).toEqual([]);
  });
});

describe("totalReturn", () => {
  it("is the point-to-point return over the last `lookback` periods", () => {
    expect(totalReturn([50, 55, 60, 66], 3)).toBeCloseTo(0.32, 10); // 66/50 - 1
  });
  it("throws when there aren't lookback+1 closes", () => {
    expect(() => totalReturn([50, 55, 60], 3)).toThrow(/insufficient/);
  });
});

describe("volatility", () => {
  it("is the sample stdev of the returns", () => {
    // returns [0.1, -0.1]: mean 0, sample var = (0.01+0.01)/1 = 0.02
    expect(volatility([0.1, -0.1])).toBeCloseTo(0.1414214, 6);
  });
  it("throws on fewer than 2 returns (sample stdev undefined)", () => {
    expect(() => volatility([0.1])).toThrow(/insufficient/);
  });
});

describe("riskAdjustedMomentum", () => {
  it("is total return over the window divided by volatility of its daily returns", () => {
    // closes [100,120,108], lookback 2:
    //   totalReturn = 108/100 - 1 = 0.08
    //   dailyReturns = [0.2, -0.1]; sample stdev = 0.2121320
    //   momentum = 0.08 / 0.2121320 = 0.3771236
    expect(riskAdjustedMomentum([100, 120, 108], 2)).toBeCloseTo(0.3771236, 6);
  });
  it("uses only the last lookback+1 closes from a longer series", () => {
    // leading values are ignored; same window as above
    expect(riskAdjustedMomentum([999, 1, 100, 120, 108], 2)).toBeCloseTo(0.3771236, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/signal/returns.test.ts`
Expected: FAIL — cannot find module `./returns.js`.

- [ ] **Step 3: Write `src/core/signal/returns.ts`**

```ts
/** Simple period-over-period returns: r_t = (c_t - c_{t-1}) / c_{t-1}. */
export function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    out.push((closes[i]! - prev) / prev);
  }
  return out;
}

/** Point-to-point return over the last `lookback` periods: c_now / c_{now-lookback} - 1. */
export function totalReturn(closes: number[], lookback: number): number {
  if (closes.length < lookback + 1) {
    throw new Error(`insufficient closes: need ${lookback + 1}, got ${closes.length}`);
  }
  const now = closes[closes.length - 1]!;
  const past = closes[closes.length - 1 - lookback]!;
  return now / past - 1;
}

/** Sample standard deviation (÷ n-1) of a series of returns. */
export function volatility(returns: number[]): number {
  const n = returns.length;
  if (n < 2) throw new Error(`insufficient returns for volatility: need 2, got ${n}`);
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

/**
 * Risk-adjusted momentum over `lookback` periods: the total return over the
 * window divided by the volatility of that window's daily returns. Uses only
 * the last `lookback + 1` closes.
 */
export function riskAdjustedMomentum(closes: number[], lookback: number): number {
  if (closes.length < lookback + 1) {
    throw new Error(`insufficient closes: need ${lookback + 1}, got ${closes.length}`);
  }
  const window = closes.slice(closes.length - (lookback + 1));
  return totalReturn(window, lookback) / volatility(dailyReturns(window));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/signal/returns.test.ts`
Expected: PASS (8 assertions across the describes).

- [ ] **Step 5: Commit**

```bash
git add src/core/signal/returns.ts src/core/signal/returns.test.ts
git commit -m "feat(signal): price math — returns, volatility, risk-adjusted momentum"
```

---

### Task 2: Cross-sectional scoring (`score.ts`)

**Files:**
- Create: `src/core/signal/score.ts`
- Test: `src/core/signal/score.test.ts`

- [ ] **Step 1: Write the failing test `src/core/signal/score.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { zscore, compositeScores } from "./score.js";

describe("zscore", () => {
  it("standardizes using population stdev (÷ n)", () => {
    // [1,2,3]: mean 2, pop stdev sqrt(2/3)=0.8164966
    const z = zscore([1, 2, 3]);
    expect(z[0]!).toBeCloseTo(-1.2247449, 6);
    expect(z[1]!).toBeCloseTo(0, 6);
    expect(z[2]!).toBeCloseTo(1.2247449, 6);
  });
  it("returns all zeros when every value is equal (zero stdev)", () => {
    expect(zscore([5, 5, 5])).toEqual([0, 0, 0]);
  });
});

describe("compositeScores", () => {
  it("z-scores risk-adjusted momentum across coins and averages lookbacks", () => {
    // One lookback [2], so composite = zscore of the per-coin raw momentums.
    const closes = new Map<string, number[]>([
      ["STRONG", [100, 120, 132]], // mom2 = 0.32 / 0.0707107 = 4.5255
      ["MID", [100, 110, 99]],     // mom2 = -0.01 / 0.1414214 = -0.0707107
      ["WEAK", [100, 80, 72]],     // mom2 = -0.28 / 0.0707107 = -3.9598
    ]);
    const scores = compositeScores(closes, [2]);

    // z-scores sum to ~0 across the cross-section
    expect(scores.reduce((a, s) => a + s.score, 0)).toBeCloseTo(0, 6);
    // ranking is STRONG > MID > WEAK
    const byCoin = Object.fromEntries(scores.map((s) => [s.coin, s.score]));
    expect(byCoin["STRONG"]!).toBeGreaterThan(byCoin["MID"]!);
    expect(byCoin["MID"]!).toBeGreaterThan(byCoin["WEAK"]!);
    expect(byCoin["STRONG"]!).toBeCloseTo(1.2572, 3);
  });

  it("preserves coin identity and returns one score per input coin", () => {
    const closes = new Map<string, number[]>([
      ["A", [100, 120, 132]],
      ["B", [100, 80, 72]],
    ]);
    const scores = compositeScores(closes, [2]);
    expect(scores.map((s) => s.coin).sort()).toEqual(["A", "B"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/signal/score.test.ts`
Expected: FAIL — cannot find module `./score.js`.

- [ ] **Step 3: Write `src/core/signal/score.ts`**

```ts
import { riskAdjustedMomentum } from "./returns.js";

/** A coin and its composite momentum score (higher = stronger). */
export interface CoinScore {
  coin: string;
  score: number;
}

/** Cross-sectional z-score using population stdev (÷ n). All-equal input -> zeros. */
export function zscore(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  if (sd === 0) return values.map(() => 0);
  return values.map((v) => (v - mean) / sd);
}

/**
 * Composite momentum score per coin: for each lookback, compute risk-adjusted
 * momentum for every coin and z-score it across the cross-section; the score is
 * the mean of those per-lookback z-scores. Coin order in the result follows the
 * Map's iteration order.
 */
export function compositeScores(
  closesByCoin: Map<string, number[]>,
  lookbacks: number[],
): CoinScore[] {
  const coins = [...closesByCoin.keys()];
  const zByLookback = lookbacks.map((lb) => {
    const raws = coins.map((c) => riskAdjustedMomentum(closesByCoin.get(c)!, lb));
    return zscore(raws);
  });
  return coins.map((coin, i) => ({
    coin,
    score: zByLookback.reduce((sum, z) => sum + z[i]!, 0) / lookbacks.length,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/signal/score.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/signal/score.ts src/core/signal/score.test.ts
git commit -m "feat(signal): cross-sectional z-scoring and composite momentum scores"
```

---

### Task 3: Book types + sizing (`book.ts` part 1)

**Files:**
- Create: `src/core/signal/book.ts`
- Test: `src/core/signal/book.test.ts`

- [ ] **Step 1: Write the failing test `src/core/signal/book.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { perSideCount, weightBook } from "./book.js";
import type { CurrentBook } from "./book.js";

describe("perSideCount", () => {
  it("is floor(n * quintileFraction), at least 1", () => {
    expect(perSideCount(20, 0.2)).toBe(4);
    expect(perSideCount(10, 0.2)).toBe(2);
    expect(perSideCount(3, 0.2)).toBe(1); // floor(0.6) -> 0, clamped to 1
  });
});

describe("weightBook", () => {
  it("equal-weights each side to sum to grossExposure/2 (dollar-neutral)", () => {
    const sides: CurrentBook = { longs: ["A", "B"], shorts: ["C", "D"] };
    const book = weightBook(sides, 1.0);

    const longs = book.positions.filter((p) => p.side === "long");
    const shorts = book.positions.filter((p) => p.side === "short");
    expect(longs.map((p) => p.weight)).toEqual([0.25, 0.25]);
    expect(shorts.map((p) => p.weight)).toEqual([0.25, 0.25]);
    expect(longs.reduce((a, p) => a + p.weight, 0)).toBeCloseTo(0.5, 10);
    expect(shorts.reduce((a, p) => a + p.weight, 0)).toBeCloseTo(0.5, 10);
  });

  it("stays dollar-neutral when the two sides have unequal counts", () => {
    const sides: CurrentBook = { longs: ["A", "B", "C"], shorts: ["D", "E"] };
    const book = weightBook(sides, 1.0);
    const longSum = book.positions.filter((p) => p.side === "long").reduce((a, p) => a + p.weight, 0);
    const shortSum = book.positions.filter((p) => p.side === "short").reduce((a, p) => a + p.weight, 0);
    expect(longSum).toBeCloseTo(0.5, 10);
    expect(shortSum).toBeCloseTo(0.5, 10);
  });

  it("labels positions with the right coin and side", () => {
    const book = weightBook({ longs: ["A"], shorts: ["Z"] }, 1.0);
    expect(book.positions).toEqual([
      { coin: "A", side: "long", weight: 0.5 },
      { coin: "Z", side: "short", weight: 0.5 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/signal/book.test.ts`
Expected: FAIL — cannot find module `./book.js`.

- [ ] **Step 3: Write `src/core/signal/book.ts`**

```ts
export type Side = "long" | "short";

/** One target position: a coin, a side, and its weight as a fraction of NAV. */
export interface TargetPosition {
  coin: string;
  side: Side;
  weight: number;
}

/** The target portfolio: equal-weighted longs and shorts. */
export interface TargetBook {
  positions: TargetPosition[];
}

/** The set of currently-held long/short coins (used for hysteresis). */
export interface CurrentBook {
  longs: string[];
  shorts: string[];
}

/** Names per side for a quintile-style selection: floor(n * fraction), min 1. */
export function perSideCount(n: number, quintileFraction: number): number {
  return Math.max(1, Math.floor(n * quintileFraction));
}

/**
 * Equal-weight each side so it sums to `grossExposure / 2` of NAV. Long and
 * short sides each sum to the same gross, keeping the book dollar-neutral even
 * when the two sides hold different numbers of names.
 */
export function weightBook(sides: CurrentBook, grossExposure: number): TargetBook {
  const perSide = grossExposure / 2;
  const longWeight = perSide / sides.longs.length;
  const shortWeight = perSide / sides.shorts.length;
  return {
    positions: [
      ...sides.longs.map((coin) => ({ coin, side: "long" as const, weight: longWeight })),
      ...sides.shorts.map((coin) => ({ coin, side: "short" as const, weight: shortWeight })),
    ],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/signal/book.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/signal/book.ts src/core/signal/book.test.ts
git commit -m "feat(signal): target-book types, per-side sizing, equal-weighting"
```

---

### Task 4: Hysteresis selection (`book.ts` part 2)

**Files:**
- Modify: `src/core/signal/book.ts`
- Modify: `src/core/signal/book.test.ts`

- [ ] **Step 1: Add the failing tests to `src/core/signal/book.test.ts`**

Append these imports/tests (add `applyHysteresis` to the existing `./book.js` import):

```ts
import { applyHysteresis } from "./book.js";
import type { CoinScore } from "./score.js";

// helper: build a ranked (desc) score list from coin names best->worst
function ranked(names: string[]): CoinScore[] {
  return names.map((coin, i) => ({ coin, score: names.length - i }));
}

describe("applyHysteresis", () => {
  it("with an empty current book selects plain top-k and bottom-k", () => {
    const r = ranked(["A", "B", "C", "D", "E", "F"]); // A best ... F worst
    const sides = applyHysteresis(r, 2, 1, { longs: [], shorts: [] });
    expect(sides.longs).toEqual(["A", "B"]);
    expect(sides.shorts).toEqual(["E", "F"]);
  });

  it("retains an incumbent that slipped within the buffer zone", () => {
    // B slipped from rank 2 to rank 3; buffer 1 keeps the hold-zone = top 3.
    const r = ranked(["A", "C", "B", "D", "E", "F"]);
    const sides = applyHysteresis(r, 2, 1, { longs: ["A", "B"], shorts: ["E", "F"] });
    // longs = top-2 {A,C} plus retained incumbent B (still within top 3)
    expect(sides.longs).toEqual(["A", "C", "B"]);
    expect(sides.shorts).toEqual(["E", "F"]);
  });

  it("drops an incumbent that fell past the buffer zone", () => {
    // B at rank 4 is outside top-3 hold-zone (k=2, buffer=1) -> dropped.
    const r = ranked(["A", "C", "D", "B", "E", "F"]);
    const sides = applyHysteresis(r, 2, 1, { longs: ["A", "B"], shorts: ["E", "F"] });
    expect(sides.longs).toEqual(["A", "C"]);
    expect(sides.shorts).toEqual(["E", "F"]);
  });

  it("retains a short incumbent that drifted up within the buffer zone", () => {
    // E moved from worst-2 to rank 4 (index 3); bottom hold-zone (k=2,buf=1) = ranks D,E,F.
    const r = ranked(["A", "B", "C", "E", "D", "F"]);
    const sides = applyHysteresis(r, 2, 1, { longs: ["A", "B"], shorts: ["E", "F"] });
    // shorts = bottom-2 {D,F} plus retained incumbent E
    expect(sides.shorts).toEqual(["E", "D", "F"]);
    expect(sides.longs).toEqual(["A", "B"]);
  });
});
```

- [ ] **Step 2: Run test to verify the new tests fail**

Run: `pnpm vitest run src/core/signal/book.test.ts`
Expected: FAIL — `applyHysteresis` is not exported.

- [ ] **Step 3: Add `applyHysteresis` to `src/core/signal/book.ts`**

Add the import at the top of the file:

```ts
import type { CoinScore } from "./score.js";
```

Append:

```ts
/**
 * Churn-damped side selection. Longs = the top-k by rank PLUS any incumbent
 * longs still within the top (k + buffer); symmetric for shorts. The result is
 * rank-ordered and holds between k and k+buffer names per side. With an empty
 * current book this is exactly top-k / bottom-k. Assumes n >= 2*(k+buffer) so
 * the long and short hold-zones do not overlap.
 */
export function applyHysteresis(
  ranked: CoinScore[],
  k: number,
  buffer: number,
  current: CurrentBook,
): CurrentBook {
  const order = ranked.map((s) => s.coin); // index 0 = best
  const n = order.length;

  const topHold = new Set(order.slice(0, k + buffer));
  const longSet = new Set<string>(order.slice(0, k));
  for (const coin of current.longs) if (topHold.has(coin)) longSet.add(coin);

  const botHold = new Set(order.slice(n - (k + buffer)));
  const shortSet = new Set<string>(order.slice(n - k));
  for (const coin of current.shorts) if (botHold.has(coin)) shortSet.add(coin);

  return {
    longs: order.filter((c) => longSet.has(c)),
    shorts: order.filter((c) => shortSet.has(c)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/signal/book.test.ts`
Expected: PASS (all book tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/signal/book.ts src/core/signal/book.test.ts
git commit -m "feat(signal): hysteresis buffer to damp rebalance turnover"
```

---

### Task 5: Engine orchestration + barrel (`signalEngine.ts`, `index.ts`)

**Files:**
- Create: `src/core/signal/signalEngine.ts`
- Create: `src/core/signal/index.ts`
- Test: `src/core/signal/signalEngine.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the failing test `src/core/signal/signalEngine.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildTargetBook } from "./signalEngine.js";
import type { SignalParams } from "./signalEngine.js";

const PARAMS: SignalParams = {
  lookbacks: [2],
  quintileFraction: 0.2,
  grossExposure: 1.0,
  hysteresisBuffer: 1,
};

// Six coins with monotonic up/down trends so the ranking is unambiguous.
function closes(): Map<string, number[]> {
  return new Map<string, number[]>([
    ["UP1", [100, 130, 170]],   // strong up
    ["UP2", [100, 120, 140]],   // up
    ["MIDA", [100, 105, 104]],  // ~flat
    ["MIDB", [100, 98, 99]],    // ~flat
    ["DN1", [100, 85, 75]],     // down
    ["DN2", [100, 70, 50]],     // strong down
  ]);
}

describe("buildTargetBook", () => {
  it("longs the strongest quintile and shorts the weakest, dollar-neutral", () => {
    const { book } = buildTargetBook(closes(), PARAMS);
    const longs = book.positions.filter((p) => p.side === "long").map((p) => p.coin);
    const shorts = book.positions.filter((p) => p.side === "short").map((p) => p.coin);

    expect(longs).toEqual(["UP1"]); // n=6, k=floor(6*0.2)=1 -> one name per side
    expect(shorts).toEqual(["DN2"]);
  });

  it("excludes coins with insufficient price history", () => {
    const c = closes();
    c.set("NEW", [100, 101]); // only 2 closes; lookback 2 needs 3 -> excluded
    const { scores } = buildTargetBook(c, PARAMS);
    expect(scores.map((s) => s.coin)).not.toContain("NEW");
  });

  it("returns scores ranked descending", () => {
    const { scores } = buildTargetBook(closes(), PARAMS);
    const vals = scores.map((s) => s.score);
    const sorted = [...vals].sort((a, b) => b - a);
    expect(vals).toEqual(sorted);
    expect(scores[0]!.coin).toBe("UP1");
  });

  it("applies hysteresis against the supplied current book", () => {
    // With k=1 the plain longs would be just UP1; an incumbent UP2 within the
    // top (k+buffer)=2 is retained, giving two longs.
    const { book } = buildTargetBook(closes(), PARAMS, { longs: ["UP1", "UP2"], shorts: ["DN1", "DN2"] });
    const longs = book.positions.filter((p) => p.side === "long").map((p) => p.coin);
    const shorts = book.positions.filter((p) => p.side === "short").map((p) => p.coin);
    expect(longs).toEqual(["UP1", "UP2"]);
    expect(shorts).toEqual(["DN1", "DN2"]); // rank order (DN1 ranks above DN2)
  });
});
```

> **Note:** with `n=6` and `quintileFraction=0.2`, `perSideCount = floor(1.2) = 1` — one name per side in the cold-start case (`longs=["UP1"]`, `shorts=["DN2"]`); the hysteresis test exercises the two-per-side retention path. The risk-adjusted-momentum ranking of the fixture is `UP1 > UP2 > MIDA > MIDB > DN1 > DN2`; only the endpoints (UP1 / DN2) are asserted for longs/shorts so the middle ordering isn't brittle. Hysteresis outputs are rank-ordered, so the warm-book shorts come back as `["DN1","DN2"]`, not `["DN2","DN1"]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/signal/signalEngine.test.ts`
Expected: FAIL — cannot find module `./signalEngine.js`.

- [ ] **Step 3: Write `src/core/signal/signalEngine.ts`**

```ts
import { compositeScores, type CoinScore } from "./score.js";
import { perSideCount, applyHysteresis, weightBook, type CurrentBook, type TargetBook } from "./book.js";

/** Strategy parameters for one signal run. */
export interface SignalParams {
  /** Lookback windows (days) to blend, e.g. [30, 60]. */
  lookbacks: number[];
  /** Fraction of the universe taken per side, e.g. 0.2 (top/bottom quintile). */
  quintileFraction: number;
  /** Gross exposure as a multiple of NAV, e.g. 1.0 (~0.5 long / ~0.5 short). */
  grossExposure: number;
  /** Extra ranks of tolerance before an incumbent is dropped. */
  hysteresisBuffer: number;
}

const EMPTY_BOOK: CurrentBook = { longs: [], shorts: [] };

/**
 * Build the target book from per-coin close-price series. Coins without enough
 * history for the longest lookback are excluded. Returns the descending-ranked
 * scores (for inspection/persistence) and the dollar-neutral target book.
 */
export function buildTargetBook(
  closesByCoin: Map<string, number[]>,
  params: SignalParams,
  current: CurrentBook = EMPTY_BOOK,
): { scores: CoinScore[]; book: TargetBook } {
  const minCloses = Math.max(...params.lookbacks) + 1;
  const eligible = new Map<string, number[]>();
  for (const [coin, closes] of closesByCoin) {
    if (closes.length >= minCloses) eligible.set(coin, closes);
  }

  const scores = compositeScores(eligible, params.lookbacks);
  const ranked = [...scores].sort((a, b) => b.score - a.score);
  if (ranked.length < 2) return { scores: ranked, book: { positions: [] } };

  const k = perSideCount(ranked.length, params.quintileFraction);
  // Clamp the hysteresis buffer so the long/short hold-zones never overlap
  // (needs k + buffer <= floor(n/2)); on a small universe this shrinks the
  // buffer rather than letting a coin be selected both long and short.
  const maxBuffer = Math.max(0, Math.floor(ranked.length / 2) - k);
  const buffer = Math.min(params.hysteresisBuffer, maxBuffer);
  const sides = applyHysteresis(ranked, k, buffer, current);
  const book = weightBook(sides, params.grossExposure);
  return { scores: ranked, book };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/signal/signalEngine.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `src/core/signal/index.ts`**

```ts
export type { CoinScore } from "./score.js";
export type { Side, TargetPosition, TargetBook, CurrentBook } from "./book.js";
export type { SignalParams } from "./signalEngine.js";
export { buildTargetBook } from "./signalEngine.js";
```

- [ ] **Step 6: Add the signal module to `src/index.ts`**

Change `src/index.ts` to:

```ts
export const VERSION = "0.1.0";
export * as data from "./core/data/index.js";
export * as store from "./core/store/index.js";
export * as signal from "./core/signal/index.js";
```

- [ ] **Step 7: Full verification**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: ALL test files PASS (Phase 1 suite + the four new signal files).

- [ ] **Step 8: Commit**

```bash
git add src/core/signal/signalEngine.ts src/core/signal/index.ts src/core/signal/signalEngine.test.ts src/index.ts
git commit -m "feat(signal): buildTargetBook orchestrator + module barrel"
```

---

## Self-Review

**Spec coverage (design spec §5 + §11 signal portions):**
- §5 momentum score `return/volatility` → Task 1 (`riskAdjustedMomentum`) ✔
- §5 blend 30d + 60d via averaged z-scores → Task 2 (`compositeScores`, `zscore`) ✔
- §5 rank, long top quintile / short bottom quintile → Tasks 3–5 (`perSideCount`, `applyHysteresis`, `buildTargetBook`) ✔
- §5 equal-weight, dollar-neutral, gross ≈1× → Task 3 (`weightBook`) ✔
- §5 hysteresis buffer → Task 4 (`applyHysteresis`) ✔
- §10 exclude coins with missing/insufficient candles → Task 5 (`buildTargetBook` eligibility filter) ✔
- §11 pure/deterministic, hand-computed fixtures → every task is pure with numeric fixtures ✔

**Out of Phase 2 scope (deferred, by design — do not add here):** the rebalance *diff* against actual paper positions and order generation (needs the paper engine's position state → Phase 3/4); reading params from `config.ts` (the engine takes explicit `SignalParams`; config wiring → Phase 4); converting `Candle[]` → `closes` (trivial runner adapter → Phase 4). The signal engine intentionally stays decoupled from the `Candle` type.

**Placeholder scan:** none — every code step is complete and runnable. The one judgement call (the `n=6, fraction=0.2` per-side count) is flagged explicitly in Task 5's note with the exact resolution to apply.

**Type consistency:** `CoinScore` defined in `score.ts`, imported by `book.ts` and `signalEngine.ts` — consistent. `CurrentBook`/`TargetBook`/`Side`/`TargetPosition` defined in `book.ts`, used consistently in `signalEngine.ts` and re-exported from `index.ts`. `SignalParams` field names (`lookbacks`, `quintileFraction`, `grossExposure`, `hysteresisBuffer`) match between definition and the test's `PARAMS`. Function names (`dailyReturns`, `totalReturn`, `volatility`, `riskAdjustedMomentum`, `zscore`, `compositeScores`, `perSideCount`, `weightBook`, `applyHysteresis`, `buildTargetBook`) are referenced identically across tasks.
