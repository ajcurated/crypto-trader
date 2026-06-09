# Phase 3: Paper-Trading Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic paper-trading engine that takes a target book (signed weights) and simulates execution with honest accounting — fee- and slippage-adjusted fills, weighted-average entry / realized-PnL position math, perp funding accrual, and mark-to-market equity points with P&L decomposed into price / funding / fees.

**Architecture:** A new `src/core/paper/` module. Pure helper functions (`fills`, `position`, `funding`, `orders`) plus one stateful `PaperAccount` that holds cash + positions and exposes `rebalance`, `accrueFunding`, `mark`. The engine consumes plain **signed target weights** (`Map<coin, fraction-of-NAV>`, + = long, − = short) and plain price/volume maps — it imports nothing from `signal`, `data`, or `store`, so the runner (Phase 4) is the integrator that converts the signal's `TargetBook` into weights and persists results. Every unit is tested against hand-computed fixtures (spec §6, §11).

**Tech Stack:** TypeScript (ESM, strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Vitest. No new dependencies.

---

## Accounting model (design spec §6) — locked decisions

These choices are fixed here so every task is consistent. They make the simulated P&L honest and the math hand-checkable.

- **Position (internal):** per coin, a **signed** base size `q` (long > 0, short < 0) and an `entry` price. The public `Position` view exposes `{ coin, side, size: |q|, entryPrice }`.
- **Cash:** USD balance that starts at `initialCapital` and absorbs realized price PnL, fees (−), and funding (±). Perp positions tie up no cash beyond fees/funding (margin is not modelled in v1).
- **Equity (NAV):** `cash + Σ unrealizedPnl(pos, mark)`, where `unrealizedPnl = q * (mark − entry)` (works for both signs).
- **Fees:** `feeRate × |tradeNotional|` per fill, charged to cash. Default `feeRate = 0.00045` (HL taker).
- **Slippage:** captured in the **fill price** (not a separate line). `slipFrac = min(maxSlippage, slippageCoeff × |orderNotional| / recentVolume)`. A buy fills at `price × (1 + slipFrac)`, a sell at `price × (1 − slipFrac)`. Worse fills flow into entry/realized PnL — i.e. slippage shows up inside the **price** component of P&L. Defaults: `slippageCoeff = 0.1`, `maxSlippage = 0.02`.
- **Funding:** per position per accrual, `payment = −sign(q) × rate × |q| × mark`. Positive funding ⇒ longs pay / shorts receive. `rate` is the funding for the elapsed interval (the runner sums HL hourly rates between marks). Applied to cash; tracked cumulatively as `fundingPnl`.
- **Realized price PnL** on a reduction/close of `closedQty` at `fill`: `sign(q) × (fill − entry) × closedQty`. Adding to a position recomputes a size-weighted-average `entry` (no realized PnL). A flip closes fully (realizes) then opens the remainder at `fill`.
- **P&L decomposition** at a mark: `pricePnl = realizedPricePnl + Σ unrealizedPnl`, `fundingPnl` (cumulative), `fees` (cumulative, ≥0). Identity that every test relies on: **`equity = initialCapital + pricePnl + fundingPnl − fees`**.

## File Structure (Phase 3)

| File | Responsibility |
|---|---|
| `src/core/paper/types.ts` | `Side`, `Position`, `Fill`, `EquityPoint`, `PaperParams` |
| `src/core/paper/fills.ts` | `feeFor`, `slippageFraction`, `fillPrice` (pure execution math) |
| `src/core/paper/position.ts` | `applyTrade` — signed position update (open/add/reduce/close/flip) + realized PnL |
| `src/core/paper/funding.ts` | `fundingPayment` (per-position funding accrual) |
| `src/core/paper/orders.ts` | `targetSignedSize`, `ordersToReach` (diff current vs target → trades) |
| `src/core/paper/account.ts` | `PaperAccount` — stateful engine: `rebalance`, `accrueFunding`, `mark`, `equity`, `positions` |
| `src/core/paper/index.ts` | Barrel: public surface |

Tests live next to each file as `*.test.ts`.

---

### Task 1: Types + execution math (`types.ts`, `fills.ts`)

**Files:**
- Create: `src/core/paper/types.ts`
- Create: `src/core/paper/fills.ts`
- Test: `src/core/paper/fills.test.ts`

- [ ] **Step 1: Write `src/core/paper/types.ts`**

```ts
export type Side = "long" | "short";

/** Public view of an open position (size is the absolute base quantity). */
export interface Position {
  coin: string;
  side: Side;
  size: number;
  entryPrice: number;
}

/** A simulated execution of one order. `deltaSize` is signed (+ buy, − sell). */
export interface Fill {
  coin: string;
  deltaSize: number;
  fillPrice: number;
  fee: number;
  notional: number;
}

/** A mark-to-market point with P&L decomposed into its drivers. */
export interface EquityPoint {
  timestamp: number;
  equity: number;
  pricePnl: number;
  fundingPnl: number;
  fees: number;
}

/** Execution-cost parameters. */
export interface PaperParams {
  /** Per-fill fee as a fraction of notional (HL taker default 0.00045). */
  feeRate: number;
  /** Slippage fraction per 1× of recent volume traded. */
  slippageCoeff: number;
  /** Hard cap on the slippage fraction for a single fill. */
  maxSlippage: number;
}
```

- [ ] **Step 2: Write the failing test `src/core/paper/fills.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { feeFor, slippageFraction, fillPrice } from "./fills.js";

describe("feeFor", () => {
  it("is feeRate times absolute notional", () => {
    expect(feeFor(10_000, 0.00045)).toBeCloseTo(4.5, 10);
    expect(feeFor(-10_000, 0.00045)).toBeCloseTo(4.5, 10); // magnitude
  });
});

describe("slippageFraction", () => {
  it("scales with order size vs recent volume", () => {
    expect(slippageFraction(10_000, 1_000_000, 0.1, 0.02)).toBeCloseTo(0.001, 10);
  });
  it("is capped at maxSlippage", () => {
    expect(slippageFraction(1_000_000_000, 1_000_000, 0.1, 0.02)).toBe(0.02);
  });
  it("is zero when recent volume is unknown (<=0)", () => {
    expect(slippageFraction(10_000, 0, 0.1, 0.02)).toBe(0);
  });
});

describe("fillPrice", () => {
  it("buys fill above mid, sells fill below mid", () => {
    expect(fillPrice(100, +5, 0.001)).toBeCloseTo(100.1, 10);
    expect(fillPrice(100, -5, 0.001)).toBeCloseTo(99.9, 10);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/core/paper/fills.test.ts`
Expected: FAIL — cannot find module `./fills.js`.

- [ ] **Step 4: Write `src/core/paper/fills.ts`**

```ts
/** Fee charged for a fill: feeRate × |notional|. */
export function feeFor(notional: number, feeRate: number): number {
  return Math.abs(notional) * feeRate;
}

/**
 * Slippage fraction for an order: slippageCoeff × |orderNotional| / recentVolume,
 * capped at maxSlippage. Returns 0 when recentVolume is unknown (<= 0).
 */
export function slippageFraction(
  orderNotional: number,
  recentVolume: number,
  slippageCoeff: number,
  maxSlippage: number,
): number {
  if (recentVolume <= 0) return 0;
  const raw = slippageCoeff * (Math.abs(orderNotional) / recentVolume);
  return Math.min(maxSlippage, raw);
}

/** Fill price: buys (deltaSize > 0) pay up, sells (deltaSize < 0) receive less. */
export function fillPrice(midPrice: number, deltaSize: number, slipFrac: number): number {
  const dir = deltaSize >= 0 ? 1 : -1;
  return midPrice * (1 + dir * slipFrac);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/core/paper/fills.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/paper/types.ts src/core/paper/fills.ts src/core/paper/fills.test.ts
git commit -m "feat(paper): execution math — fees, slippage, fill price"
```

---

### Task 2: Position update math (`position.ts`)

**Files:**
- Create: `src/core/paper/position.ts`
- Test: `src/core/paper/position.test.ts`

This is the most intricate math: opening, adding (weighted-avg entry), reducing (realize PnL), closing, and flipping a signed position.

- [ ] **Step 1: Write the failing test `src/core/paper/position.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { applyTrade } from "./position.js";

describe("applyTrade", () => {
  it("opens a new position from flat", () => {
    expect(applyTrade({ size: 0, entry: 0 }, 10, 100)).toEqual({
      position: { size: 10, entry: 100 },
      realized: 0,
    });
  });

  it("adds in the same direction with a weighted-average entry", () => {
    // 10 @ 100 then +10 @ 110 -> 20 @ 105
    expect(applyTrade({ size: 10, entry: 100 }, 10, 110)).toEqual({
      position: { size: 20, entry: 105 },
      realized: 0,
    });
  });

  it("reduces a long and realizes PnL at the fill price", () => {
    // close 4 of a 10-long entered @100, fill @120 -> realized 4*(120-100)=80
    expect(applyTrade({ size: 10, entry: 100 }, -4, 120)).toEqual({
      position: { size: 6, entry: 100 },
      realized: 80,
    });
  });

  it("fully closes a position", () => {
    expect(applyTrade({ size: 10, entry: 100 }, -10, 120)).toEqual({
      position: { size: 0, entry: 0 },
      realized: 200,
    });
  });

  it("flips long to short: closes fully then opens the remainder at the fill", () => {
    // -15 on a 10-long @100, fill @120: realize 10*(120-100)=200, open -5 @120
    expect(applyTrade({ size: 10, entry: 100 }, -15, 120)).toEqual({
      position: { size: -5, entry: 120 },
      realized: 200,
    });
  });

  it("reduces a short and realizes PnL (mirror of long)", () => {
    // short 10 @100, buy back 4 @80 -> realized 4*(100-80)=80, size -6
    expect(applyTrade({ size: -10, entry: 100 }, 4, 80)).toEqual({
      position: { size: -6, entry: 100 },
      realized: 80,
    });
  });

  it("adds to a short with weighted-average entry", () => {
    // short 10 @100 then short 5 more @90 -> -15 @ (10*100+5*90)/15 = 96.6667
    const out = applyTrade({ size: -10, entry: 100 }, -5, 90);
    expect(out.position.size).toBe(-15);
    expect(out.position.entry).toBeCloseTo(96.6666667, 6);
    expect(out.realized).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/paper/position.test.ts`
Expected: FAIL — cannot find module `./position.js`.

- [ ] **Step 3: Write `src/core/paper/position.ts`**

```ts
/** A signed position: size > 0 long, < 0 short, 0 flat. */
export interface SignedPosition {
  size: number;
  entry: number;
}

export interface TradeResult {
  position: SignedPosition;
  realized: number;
}

/**
 * Apply a signed trade `dq` at `fill` to a signed position. Adding in the same
 * direction recomputes a size-weighted entry (no realized PnL); reducing
 * realizes `sign(size) * (fill - entry) * closedQty`; a flip closes fully then
 * opens the remainder at `fill`.
 */
export function applyTrade(pos: SignedPosition, dq: number, fill: number): TradeResult {
  const q = pos.size;

  // Opening from flat, or adding in the same direction.
  if (q === 0 || Math.sign(dq) === Math.sign(q)) {
    const newSize = q + dq;
    const entry = (Math.abs(q) * pos.entry + Math.abs(dq) * fill) / Math.abs(newSize);
    return { position: { size: newSize, entry }, realized: 0 };
  }

  // Opposite direction: reduce / close / flip.
  const closedQty = Math.min(Math.abs(dq), Math.abs(q));
  const realized = Math.sign(q) * (fill - pos.entry) * closedQty;
  const newSize = q + dq;

  if (newSize === 0) return { position: { size: 0, entry: 0 }, realized };
  if (Math.sign(newSize) === Math.sign(q)) {
    // Reduced but not closed: entry unchanged.
    return { position: { size: newSize, entry: pos.entry }, realized };
  }
  // Flipped past zero: remainder opens fresh at the fill price.
  return { position: { size: newSize, entry: fill }, realized };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/paper/position.test.ts`
Expected: PASS (7 cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/paper/position.ts src/core/paper/position.test.ts
git commit -m "feat(paper): signed position update with weighted entry and realized PnL"
```

---

### Task 3: Funding accrual (`funding.ts`)

**Files:**
- Create: `src/core/paper/funding.ts`
- Test: `src/core/paper/funding.test.ts`

- [ ] **Step 1: Write the failing test `src/core/paper/funding.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fundingPayment } from "./funding.js";

describe("fundingPayment", () => {
  it("a long pays when funding is positive (negative cashflow)", () => {
    // size +10 @ mark 100 -> notional 1000; rate 0.0001 -> -0.1
    expect(fundingPayment(10, 0.0001, 100)).toBeCloseTo(-0.1, 10);
  });
  it("a short receives when funding is positive", () => {
    expect(fundingPayment(-10, 0.0001, 100)).toBeCloseTo(0.1, 10);
  });
  it("a long receives when funding is negative", () => {
    expect(fundingPayment(10, -0.0001, 100)).toBeCloseTo(0.1, 10);
  });
  it("is zero for a flat position", () => {
    expect(fundingPayment(0, 0.0001, 100)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/paper/funding.test.ts`
Expected: FAIL — cannot find module `./funding.js`.

- [ ] **Step 3: Write `src/core/paper/funding.ts`**

```ts
/**
 * Funding cashflow for a signed position over one interval at the given rate.
 * Positive funding rate means longs pay shorts, so the payment is
 * `-sign(size) * rate * |size| * mark`.
 */
export function fundingPayment(size: number, rate: number, mark: number): number {
  return -Math.sign(size) * rate * Math.abs(size) * mark;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/paper/funding.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/paper/funding.ts src/core/paper/funding.test.ts
git commit -m "feat(paper): perp funding accrual per position"
```

---

### Task 4: Order generation (`orders.ts`)

**Files:**
- Create: `src/core/paper/orders.ts`
- Test: `src/core/paper/orders.test.ts`

- [ ] **Step 1: Write the failing test `src/core/paper/orders.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { targetSignedSize, ordersToReach } from "./orders.js";

describe("targetSignedSize", () => {
  it("converts a signed weight + equity + price into a signed base size", () => {
    expect(targetSignedSize(0.25, 100_000, 100)).toBeCloseTo(250, 10);  // long
    expect(targetSignedSize(-0.25, 100_000, 200)).toBeCloseTo(-125, 10); // short
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/paper/orders.test.ts`
Expected: FAIL — cannot find module `./orders.js`.

- [ ] **Step 3: Write `src/core/paper/orders.ts`**

```ts
/** Signed target base size from a signed NAV weight: weight * equity / price. */
export function targetSignedSize(weight: number, equity: number, price: number): number {
  return (weight * equity) / price;
}

export interface Order {
  coin: string;
  deltaSize: number;
}

/**
 * Signed deltas to move from `current` signed sizes to `target` signed sizes.
 * Coins in `target` are visited first (in iteration order), then any coins held
 * in `current` but absent from `target` are closed. Zero-delta coins are omitted.
 */
export function ordersToReach(
  current: Map<string, number>,
  target: Map<string, number>,
): Order[] {
  const orders: Order[] = [];
  for (const [coin, want] of target) {
    const have = current.get(coin) ?? 0;
    const delta = want - have;
    if (delta !== 0) orders.push({ coin, deltaSize: delta });
  }
  for (const [coin, have] of current) {
    if (!target.has(coin) && have !== 0) orders.push({ coin, deltaSize: -have });
  }
  return orders;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/paper/orders.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/paper/orders.ts src/core/paper/orders.test.ts
git commit -m "feat(paper): target sizing and order diff generation"
```

---

### Task 5: The stateful engine (`account.ts`)

**Files:**
- Create: `src/core/paper/account.ts`
- Test: `src/core/paper/account.test.ts`

- [ ] **Step 1: Write the failing test `src/core/paper/account.test.ts`**

```ts
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
    // target: +0.5 BTC @100, -0.5 ETH @50; equity 100k
    const fills = acct.rebalance(
      new Map([["BTC", 0.5], ["ETH", -0.5]]),
      prices({ BTC: 100, ETH: 50 }),
      new Map([["BTC", 1e12], ["ETH", 1e12]]),
    );
    // BTC: 0.5*100000/100 = 500 units; ETH: -0.5*100000/50 = -1000 units
    const byCoin = Object.fromEntries(fills.map((f) => [f.coin, f]));
    expect(byCoin["BTC"]!.deltaSize).toBeCloseTo(500, 6);
    expect(byCoin["ETH"]!.deltaSize).toBeCloseTo(-1000, 6);
    // fees: 0.00045 * (50000 + 50000) = 45
    // no price move yet -> equity = 100000 - 45
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
    // BTC +10% to 110 (long 500 -> +5000); ETH +10% to 55 (short 1000 -> -5000)
    const point = acct.mark(prices({ BTC: 110, ETH: 55 }), 1_000);
    expect(point.timestamp).toBe(1_000);
    expect(point.pricePnl).toBeCloseTo(0, 6);     // market-neutral: +5000 - 5000
    expect(point.fees).toBeCloseTo(45, 6);
    expect(point.fundingPnl).toBeCloseTo(0, 6);
    expect(point.equity).toBeCloseTo(99_955, 6);  // 100000 + 0 + 0 - 45
    // identity: equity == initial + price + funding - fees
    expect(point.equity).toBeCloseTo(100_000 + point.pricePnl + point.fundingPnl - point.fees, 6);
  });

  it("accrues funding into cash and the funding P&L component", () => {
    const acct = new PaperAccount(100_000, PARAMS);
    acct.rebalance(
      new Map([["BTC", 0.5], ["ETH", -0.5]]),
      prices({ BTC: 100, ETH: 50 }),
      new Map([["BTC", 1e12], ["ETH", 1e12]]),
    );
    // funding: BTC long 500 @100 notional 50000, rate +0.0001 -> -5
    //          ETH short 1000 @50 notional 50000, rate +0.0001 -> +5
    const f = acct.accrueFunding(new Map([["BTC", 0.0001], ["ETH", 0.0001]]), prices({ BTC: 100, ETH: 50 }));
    expect(f).toBeCloseTo(0, 6); // -5 + 5
    // now make funding asymmetric: only BTC pays
    const f2 = acct.accrueFunding(new Map([["BTC", 0.0002]]), prices({ BTC: 100, ETH: 50 }));
    expect(f2).toBeCloseTo(-10, 6); // 500*100*0.0002 = 10, long pays
    const point = acct.mark(prices({ BTC: 100, ETH: 50 }), 2_000);
    expect(point.fundingPnl).toBeCloseTo(-10, 6);
    expect(point.equity).toBeCloseTo(99_945, 6); // 100000 + 0 - 10 - 45
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/paper/account.test.ts`
Expected: FAIL — cannot find module `./account.js`.

- [ ] **Step 3: Write `src/core/paper/account.ts`**

```ts
import type { Fill, EquityPoint, PaperParams, Position, Side } from "./types.js";
import { feeFor, slippageFraction, fillPrice } from "./fills.js";
import { applyTrade, type SignedPosition } from "./position.js";
import { fundingPayment } from "./funding.js";
import { targetSignedSize, ordersToReach } from "./orders.js";

/** A deterministic paper-trading account: positions, cash, and P&L accounting. */
export class PaperAccount {
  private cash: number;
  private readonly positionsByCoin = new Map<string, SignedPosition>();
  private realizedPricePnl = 0;
  private feesPaid = 0;
  private fundingPnl = 0;

  constructor(
    private readonly initialCapital: number,
    private readonly params: PaperParams,
  ) {
    this.cash = initialCapital;
  }

  /** Current signed sizes keyed by coin (open positions only). */
  private signedSizes(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [coin, pos] of this.positionsByCoin) {
      if (pos.size !== 0) out.set(coin, pos.size);
    }
    return out;
  }

  /** NAV: cash plus unrealized PnL on open positions at the given prices. */
  equity(prices: Map<string, number>): number {
    let unrealized = 0;
    for (const [coin, pos] of this.positionsByCoin) {
      if (pos.size === 0) continue;
      const mark = prices.get(coin);
      if (mark === undefined) continue;
      unrealized += pos.size * (mark - pos.entry);
    }
    return this.cash + unrealized;
  }

  /** Public snapshot of open positions. */
  positions(): Position[] {
    const out: Position[] = [];
    for (const [coin, pos] of this.positionsByCoin) {
      if (pos.size === 0) continue;
      const side: Side = pos.size > 0 ? "long" : "short";
      out.push({ coin, side, size: Math.abs(pos.size), entryPrice: pos.entry });
    }
    return out;
  }

  /**
   * Move the book to `targetWeights` (signed fractions of current NAV) at the
   * given prices, simulating fee- and slippage-adjusted fills. Returns the fills.
   */
  rebalance(
    targetWeights: Map<string, number>,
    prices: Map<string, number>,
    recentVolumes: Map<string, number>,
  ): Fill[] {
    const equity = this.equity(prices);
    const target = new Map<string, number>();
    for (const [coin, weight] of targetWeights) {
      const price = prices.get(coin);
      if (price === undefined) continue;
      target.set(coin, targetSignedSize(weight, equity, price));
    }

    const fills: Fill[] = [];
    for (const order of ordersToReach(this.signedSizes(), target)) {
      const mark = prices.get(order.coin)!; // present: orders only cover priced coins
      const slip = slippageFraction(
        order.deltaSize * mark,
        recentVolumes.get(order.coin) ?? 0,
        this.params.slippageCoeff,
        this.params.maxSlippage,
      );
      const price = fillPrice(mark, order.deltaSize, slip);
      const notional = order.deltaSize * price;
      const fee = feeFor(notional, this.params.feeRate);

      const prev = this.positionsByCoin.get(order.coin) ?? { size: 0, entry: 0 };
      const { position, realized } = applyTrade(prev, order.deltaSize, price);
      this.positionsByCoin.set(order.coin, position);
      this.realizedPricePnl += realized;
      this.feesPaid += fee;
      this.cash += realized - fee;

      fills.push({ coin: order.coin, deltaSize: order.deltaSize, fillPrice: price, fee, notional });
    }
    return fills;
  }

  /**
   * Accrue one funding interval at the given per-coin rates. Returns the total
   * funding cashflow (positive = received). Coins without a rate accrue nothing.
   */
  accrueFunding(rates: Map<string, number>, prices: Map<string, number>): number {
    let total = 0;
    for (const [coin, pos] of this.positionsByCoin) {
      if (pos.size === 0) continue;
      const rate = rates.get(coin);
      const mark = prices.get(coin);
      if (rate === undefined || mark === undefined) continue;
      total += fundingPayment(pos.size, rate, mark);
    }
    this.cash += total;
    this.fundingPnl += total;
    return total;
  }

  /** Mark to market: an equity point with P&L decomposed into its drivers. */
  mark(prices: Map<string, number>, timestamp: number): EquityPoint {
    const equity = this.equity(prices);
    let unrealized = 0;
    for (const [coin, pos] of this.positionsByCoin) {
      if (pos.size === 0) continue;
      const mark = prices.get(coin);
      if (mark === undefined) continue;
      unrealized += pos.size * (mark - pos.entry);
    }
    return {
      timestamp,
      equity,
      pricePnl: this.realizedPricePnl + unrealized,
      fundingPnl: this.fundingPnl,
      fees: this.feesPaid,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/paper/account.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/paper/account.ts src/core/paper/account.test.ts
git commit -m "feat(paper): PaperAccount engine — rebalance, funding, mark-to-market"
```

---

### Task 6: Barrel + module wiring (`index.ts`, `src/index.ts`)

**Files:**
- Create: `src/core/paper/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write `src/core/paper/index.ts`**

```ts
export type { Side, Position, Fill, EquityPoint, PaperParams } from "./types.js";
export { PaperAccount } from "./account.js";
```

- [ ] **Step 2: Add the paper module to `src/index.ts`**

The file currently ends with the signal export. Change it to:

```ts
export const VERSION = "0.1.0";
export * as data from "./core/data/index.js";
export * as store from "./core/store/index.js";
export * as signal from "./core/signal/index.js";
export * as paper from "./core/paper/index.js";
```

- [ ] **Step 3: Full verification**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: ALL test files PASS (Phases 1–2 suite + the five new paper files).

- [ ] **Step 4: Commit**

```bash
git add src/core/paper/index.ts src/index.ts
git commit -m "feat(paper): module barrel + top-level export"
```

---

## Self-Review

**Spec coverage (design spec §6 + §11 paper portions):**
- §6 fills at latest price minus fee + slippage scaled to order size vs volume → Task 1 (`feeFor`, `slippageFraction`, `fillPrice`), applied in Task 5 `rebalance` ✔
- §6 funding accrued on every open position, added/subtracted by sign → Task 3 (`fundingPayment`), Task 5 `accrueFunding` ✔
- §6 mark-to-market → equity point; P&L decomposed into price/funding/fees → Task 5 `mark` returning `EquityPoint` with the `equity = initial + price + funding − fees` identity ✔
- §11 paper engine: known fills + funding → known equity; decomposition verified → Task 5 integration tests assert exact equity and each component ✔
- Position correctness (weighted entry, realized PnL, flips) → Task 2 ✔

**Out of Phase 3 scope (deferred, by design — do not add here):** risk guards / stops / circuit breakers (spec §7 → Phase 4 risk loop); persistence of trades/positions/equity to the `Datastore` (spec §8 step 7 → Phase 4 wiring, extending the store); reading params from `config.ts` and converting the signal's `TargetBook` → signed weights and `Candle`s → prices (→ Phase 4 runner). The engine stays pure of `signal`/`data`/`store` imports; the runner integrates them.

**Placeholder scan:** none — every code step is complete and runnable. `slippageCoeff: 0` is used in the Task 5 fixtures intentionally (documented inline) so fills sit at mid and the equity arithmetic is exact; `slippageFraction` itself is independently tested with a non-zero coefficient in Task 1.

**Type consistency:** `Side`/`Position`/`Fill`/`EquityPoint`/`PaperParams` defined in `types.ts`, imported consistently by `account.ts` and re-exported by `index.ts`. `SignedPosition`/`TradeResult` defined in `position.ts` and consumed by `account.ts`. `Order` from `orders.ts` consumed by `account.ts`. Function names (`feeFor`, `slippageFraction`, `fillPrice`, `applyTrade`, `fundingPayment`, `targetSignedSize`, `ordersToReach`) and the `PaperAccount` methods (`equity`, `positions`, `rebalance`, `accrueFunding`, `mark`) are referenced identically across tasks. The `rebalance → mark` equity identity is consistent with the cash bookkeeping (`cash += realized − fee`; `cash += funding`).
