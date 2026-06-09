# Phase 4b: Streaming Risk Loop + Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the fast, streaming risk loop — a WebSocket watch that evaluates book-level and per-leg risk on every price tick and flattens positions the instant a stop trips — plus a `Notifier` abstraction (console + Telegram) that surfaces stops and funding alerts.

**Architecture:** A pure `src/core/risk/evaluate.ts` (decide what to flatten / alert from positions + marks + funding), a `Notifier` interface with `console`/`telegram`/`multi` implementations in `src/core/notify/`, a `PaperAccount.flatten` method (refactored to share order execution with `rebalance`), and a stateful `src/runner/riskLoop.ts` that subscribes to the Phase 1 reconnecting WS feed, maintains live marks, evaluates risk per tick, executes flattens atomically against the persisted account, and notifies. The risk evaluator and notifiers are pure/injectable so everything is unit-tested with fake sockets and fake `fetch` — no live network.

**Tech Stack:** TypeScript (ESM, strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Vitest. No new dependencies (Telegram is a plain HTTPS POST via injectable `fetch`).

---

## Risk model (design spec §7, mapped to the basket) — locked decisions

The book is a leaders-vs-laggards **basket**, not literal pairs, so §7 maps as:

- **Spread stop (book-level):** treat the whole long/short basket as one spread. If total **unrealized loss** exceeds `spreadStopPct` of NAV → **flatten the entire book**. (`totalUnrealized <= -spreadStopPct * nav`.)
- **Per-leg circuit breaker:** a single leg whose adverse move from entry exceeds `circuitBreakerBand` → **flatten that leg** immediately (targets idiosyncratic single-leg tail risk: halts, delistings, exploits, depegs). Leg return = `sign(side) * (mark − entry) / entry`; trips when `legReturn <= -circuitBreakerBand`.
- **Funding alert:** if a leg's **annualized** funding (`hourlyRate * 24 * 365`) magnitude exceeds `fundingAlertAnnualized` → **alert only** (no auto-close, low leverage).
- Precedence: if the book-level spread stop fires, it flattens everything (per-leg becomes moot). Funding alerts are independent of flattening.
- **Flatten semantics (paper):** close the named positions at the current WS mark via the existing fee/slippage fill path; persist the new account state atomically; notify.

Defaults (spec §9): `spreadStopPct = 0.08`, `circuitBreakerBand = 0.15`, `fundingAlertAnnualized = 0.5`.

## File Structure (Phase 4b)

| File | Responsibility |
|---|---|
| `src/config.ts` (modify) | add `risk` params + env overrides |
| `src/core/risk/evaluate.ts` | pure `evaluateRisk(...)` → `{ flattenAll, flattenLegs, alerts }` |
| `src/core/risk/index.ts` | barrel |
| `src/core/paper/account.ts` (modify) | `flatten(coins, prices, volumes)` + shared `executeOrders` |
| `src/core/notify/Notifier.ts` | `Notifier` interface |
| `src/core/notify/console.ts` | `ConsoleNotifier` |
| `src/core/notify/multi.ts` | `MultiNotifier` (fan-out, failures non-fatal) |
| `src/core/notify/telegram.ts` | `TelegramNotifier` (injectable fetch) |
| `src/core/notify/index.ts` | barrel |
| `src/runner/riskLoop.ts` | `RiskLoop` — subscribe, evaluate, flatten, persist, notify |
| `src/cli.ts` (modify) | `watch` command starts the risk loop |

Tests next to each file as `*.test.ts`.

---

### Task 1: Risk evaluation (`src/core/risk/evaluate.ts`)

**Files:**
- Create: `src/core/risk/evaluate.ts`
- Create: `src/core/risk/index.ts`
- Test: `src/core/risk/evaluate.test.ts`

- [ ] **Step 1: Write the failing test `src/core/risk/evaluate.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { evaluateRisk, type RiskParams } from "./evaluate.js";
import type { Position } from "../paper/index.js";

const PARAMS: RiskParams = { spreadStopPct: 0.08, circuitBreakerBand: 0.15, fundingAlertAnnualized: 0.5 };
const m = (o: Record<string, number>) => new Map(Object.entries(o));

const longBTC: Position = { coin: "BTC", side: "long", size: 10, entryPrice: 100 };
const shortETH: Position = { coin: "ETH", side: "short", size: 20, entryPrice: 50 };

describe("evaluateRisk", () => {
  it("does nothing when the book is healthy", () => {
    const r = evaluateRisk([longBTC, shortETH], m({ BTC: 101, ETH: 49 }), m({ BTC: 0, ETH: 0 }), 10_000, PARAMS);
    expect(r).toEqual({ flattenAll: false, flattenLegs: [], alerts: [] });
  });

  it("flattens the whole book when total unrealized loss exceeds the spread stop", () => {
    // BTC long 10 @100 -> 95: -50; ETH short 20 @50 -> 53: -60; total -110 on nav 1000 (11% > 8%)
    const r = evaluateRisk([longBTC, shortETH], m({ BTC: 95, ETH: 53 }), m({ BTC: 0, ETH: 0 }), 1_000, PARAMS);
    expect(r.flattenAll).toBe(true);
  });

  it("flattens a single leg that gaps beyond the circuit-breaker band", () => {
    // BTC long 10 @100 -> 80: -20% move; nav large so spread stop does NOT fire
    const r = evaluateRisk([longBTC, shortETH], m({ BTC: 80, ETH: 50 }), m({ BTC: 0, ETH: 0 }), 1_000_000, PARAMS);
    expect(r.flattenAll).toBe(false);
    expect(r.flattenLegs).toEqual(["BTC"]);
  });

  it("alerts on an annualized funding spike without flattening", () => {
    // hourly 0.0001 -> annualized 0.0001*24*365 = 0.876 > 0.5
    const r = evaluateRisk([longBTC], m({ BTC: 100 }), m({ BTC: 0.0001 }), 1_000_000, PARAMS);
    expect(r.flattenAll).toBe(false);
    expect(r.flattenLegs).toEqual([]);
    expect(r.alerts.some((a) => a.includes("BTC") && a.toLowerCase().includes("funding"))).toBe(true);
  });

  it("ignores legs with no current mark", () => {
    const r = evaluateRisk([longBTC], m({}), m({}), 1_000, PARAMS);
    expect(r).toEqual({ flattenAll: false, flattenLegs: [], alerts: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/risk/evaluate.test.ts`
Expected: FAIL — cannot find module `./evaluate.js`.

- [ ] **Step 3: Write `src/core/risk/evaluate.ts`**

```ts
import type { Position } from "../paper/index.js";

export interface RiskParams {
  /** Flatten the book if total unrealized loss exceeds this fraction of NAV. */
  spreadStopPct: number;
  /** Flatten a single leg if its adverse move from entry exceeds this fraction. */
  circuitBreakerBand: number;
  /** Alert if a leg's annualized funding magnitude exceeds this fraction. */
  fundingAlertAnnualized: number;
}

export interface RiskAction {
  flattenAll: boolean;
  flattenLegs: string[];
  alerts: string[];
}

const HOURS_PER_YEAR = 24 * 365;
const sideSign = (side: Position["side"]): number => (side === "long" ? 1 : -1);

/**
 * Decide risk actions from open positions, current marks, and funding rates.
 * Book-level spread stop flattens everything; per-leg circuit breaker flattens
 * a single gapped leg; funding spikes only alert. Legs without a mark are skipped.
 */
export function evaluateRisk(
  positions: Position[],
  marks: Map<string, number>,
  fundingRates: Map<string, number>,
  nav: number,
  params: RiskParams,
): RiskAction {
  let totalUnrealized = 0;
  const flattenLegs: string[] = [];
  const alerts: string[] = [];

  for (const p of positions) {
    const mark = marks.get(p.coin);
    if (mark === undefined) continue;
    const sign = sideSign(p.side);
    totalUnrealized += sign * (mark - p.entryPrice) * p.size;

    const legReturn = (sign * (mark - p.entryPrice)) / p.entryPrice;
    if (legReturn <= -params.circuitBreakerBand) {
      flattenLegs.push(p.coin);
      alerts.push(`circuit breaker: ${p.coin} moved ${(legReturn * 100).toFixed(1)}% against the book`);
    }

    const rate = fundingRates.get(p.coin);
    if (rate !== undefined) {
      const annualized = rate * HOURS_PER_YEAR;
      if (Math.abs(annualized) > params.fundingAlertAnnualized) {
        alerts.push(`funding spike: ${p.coin} annualized ${(annualized * 100).toFixed(0)}%`);
      }
    }
  }

  const flattenAll = totalUnrealized <= -params.spreadStopPct * nav;
  if (flattenAll) alerts.push(`spread stop: book unrealized ${totalUnrealized.toFixed(2)} exceeds ${(params.spreadStopPct * 100).toFixed(0)}% of NAV`);

  return { flattenAll, flattenLegs, alerts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/risk/evaluate.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `src/core/risk/index.ts`**

```ts
export type { RiskParams, RiskAction } from "./evaluate.js";
export { evaluateRisk } from "./evaluate.js";
```

- [ ] **Step 6: Commit**

```bash
git add src/core/risk/evaluate.ts src/core/risk/index.ts src/core/risk/evaluate.test.ts
git commit -m "feat(risk): pure risk evaluation — spread stop, circuit breaker, funding alert"
```

---

### Task 2: PaperAccount.flatten (+ shared order execution)

**Files:**
- Modify: `src/core/paper/account.ts`
- Test: `src/core/paper/flatten.test.ts`

- [ ] **Step 1: Write the failing test `src/core/paper/flatten.test.ts`**

```ts
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
    // price move then flatten everything
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/paper/flatten.test.ts`
Expected: FAIL — `flatten` does not exist.

- [ ] **Step 3: Refactor `rebalance` to share order execution and add `flatten` in `src/core/paper/account.ts`**

In `rebalance`, REPLACE the fill loop body with a call to a shared private `executeOrders`. The current `rebalance` looks like:

```ts
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
    return this.executeOrders(ordersToReach(this.signedSizes(), target), prices, recentVolumes);
  }

  /** Close the given coins (if held and priced) at the current mark. */
  flatten(coins: string[], prices: Map<string, number>, recentVolumes: Map<string, number>): Fill[] {
    const orders = [];
    for (const coin of coins) {
      const pos = this.positionsByCoin.get(coin);
      if (pos && pos.size !== 0 && prices.get(coin) !== undefined) {
        orders.push({ coin, deltaSize: -pos.size });
      }
    }
    return this.executeOrders(orders, prices, recentVolumes);
  }

  /** Apply a set of signed orders as fee/slippage-adjusted fills. */
  private executeOrders(
    orders: { coin: string; deltaSize: number }[],
    prices: Map<string, number>,
    recentVolumes: Map<string, number>,
  ): Fill[] {
    const fills: Fill[] = [];
    for (const order of orders) {
      const mark = prices.get(order.coin);
      if (mark === undefined) continue;
      const slip = slippageFraction(order.deltaSize * mark, recentVolumes.get(order.coin) ?? 0, this.params.slippageCoeff, this.params.maxSlippage);
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
```

Replace the existing `rebalance` method with the three methods above. Keep the rest of the class unchanged. The `Order` type from `./orders.js` is structurally `{ coin: string; deltaSize: number }`, which matches `executeOrders`' parameter, so no new import is needed (or import `Order` and use it if you prefer).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/paper/flatten.test.ts`
Expected: PASS.

Run: `pnpm vitest run src/core/paper/account.test.ts`
Expected: PASS (the refactor must not regress the existing engine tests).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/paper/account.ts src/core/paper/flatten.test.ts
git commit -m "feat(paper): flatten() to close named positions; share order execution"
```

---

### Task 3: Notifier interface + console + multi

**Files:**
- Create: `src/core/notify/Notifier.ts`
- Create: `src/core/notify/console.ts`
- Create: `src/core/notify/multi.ts`
- Create: `src/core/notify/index.ts`
- Test: `src/core/notify/notify.test.ts`

- [ ] **Step 1: Write the failing test `src/core/notify/notify.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import type { Notifier } from "./Notifier.js";
import { ConsoleNotifier } from "./console.js";
import { MultiNotifier } from "./multi.js";

describe("ConsoleNotifier", () => {
  it("logs the message", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await new ConsoleNotifier().send("hello");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("hello"));
    spy.mockRestore();
  });
});

describe("MultiNotifier", () => {
  it("fans out to every notifier", async () => {
    const a = { send: vi.fn(async () => {}) };
    const b = { send: vi.fn(async () => {}) };
    await new MultiNotifier([a, b]).send("x");
    expect(a.send).toHaveBeenCalledWith("x");
    expect(b.send).toHaveBeenCalledWith("x");
  });

  it("does not let one failing notifier stop the others (failures non-fatal)", async () => {
    const boom: Notifier = { send: vi.fn(async () => { throw new Error("down"); }) };
    const ok = { send: vi.fn(async () => {}) };
    await expect(new MultiNotifier([boom, ok]).send("x")).resolves.toBeUndefined();
    expect(ok.send).toHaveBeenCalledWith("x");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/notify/notify.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Write the four files**

`src/core/notify/Notifier.ts`:
```ts
/** Sends a short human-readable alert somewhere (console, Telegram, ...). */
export interface Notifier {
  send(message: string): Promise<void>;
}
```

`src/core/notify/console.ts`:
```ts
import type { Notifier } from "./Notifier.js";

/** Writes alerts to stdout. Always available, no credentials. */
export class ConsoleNotifier implements Notifier {
  async send(message: string): Promise<void> {
    console.log(`[alert] ${message}`);
  }
}
```

`src/core/notify/multi.ts`:
```ts
import type { Notifier } from "./Notifier.js";

/** Fans a message out to several notifiers; a failing one never blocks the rest. */
export class MultiNotifier implements Notifier {
  constructor(private readonly notifiers: Notifier[]) {}

  async send(message: string): Promise<void> {
    await Promise.all(
      this.notifiers.map((n) =>
        n.send(message).catch((err) => console.error("notifier failed:", err)),
      ),
    );
  }
}
```

`src/core/notify/index.ts`:
```ts
export type { Notifier } from "./Notifier.js";
export { ConsoleNotifier } from "./console.js";
export { MultiNotifier } from "./multi.js";
export { TelegramNotifier } from "./telegram.js";
```

> Note: `index.ts` references `./telegram.js`, created in Task 4. If you run a typecheck between Task 3 and Task 4 it will fail on the missing module — that is expected; it resolves once Task 4 lands. The Task 3 test imports the concrete files directly, so it passes independently.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/notify/notify.test.ts`
Expected: PASS. (Do not run the full `pnpm typecheck` yet — `index.ts` references the Task 4 file.)

- [ ] **Step 5: Commit**

```bash
git add src/core/notify/Notifier.ts src/core/notify/console.ts src/core/notify/multi.ts src/core/notify/index.ts src/core/notify/notify.test.ts
git commit -m "feat(notify): Notifier interface, console + multi (non-fatal fan-out)"
```

---

### Task 4: TelegramNotifier

**Files:**
- Create: `src/core/notify/telegram.ts`
- Test: `src/core/notify/telegram.test.ts`

- [ ] **Step 1: Write the failing test `src/core/notify/telegram.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { TelegramNotifier } from "./telegram.js";

describe("TelegramNotifier", () => {
  it("POSTs the message to the Bot API sendMessage endpoint", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await new TelegramNotifier("TOKEN", "CHAT", fetchFn).send("hi there");

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/botTOKEN/sendMessage");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ chat_id: "CHAT", text: "hi there" });
  });

  it("throws on a non-2xx response", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 400 }));
    await expect(new TelegramNotifier("T", "C", fetchFn).send("x")).rejects.toThrow(/telegram 400/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/notify/telegram.test.ts`
Expected: FAIL — cannot find module `./telegram.js`.

- [ ] **Step 3: Write `src/core/notify/telegram.ts`**

```ts
import type { Notifier } from "./Notifier.js";

type FetchFn = typeof fetch;

/** Sends alerts to a Telegram chat via the Bot API. */
export class TelegramNotifier implements Notifier {
  constructor(
    private readonly token: string,
    private readonly chatId: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async send(message: string): Promise<void> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: this.chatId, text: message }),
    });
    if (!res.ok) throw new Error(`telegram ${res.status}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/notify/telegram.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS (now that `telegram.js` exists, the Task 3 barrel resolves).

- [ ] **Step 5: Commit**

```bash
git add src/core/notify/telegram.ts src/core/notify/telegram.test.ts
git commit -m "feat(notify): TelegramNotifier over the Bot API (injectable fetch)"
```

---

### Task 5: The risk loop (`src/runner/riskLoop.ts`)

**Files:**
- Create: `src/runner/riskLoop.ts`
- Test: `src/runner/riskLoop.test.ts`

The loop subscribes to the WS feed for the held coins, updates a live marks/funding map on each `onCtx`, evaluates risk, and — when a stop trips — flattens the affected positions against the (reloaded) account, persists atomically, and notifies. It evaluates against the **latest persisted** account each tick so it composes with the daily cycle.

- [ ] **Step 1: Write the failing test `src/runner/riskLoop.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { RiskLoop, type RiskLoopDeps } from "./riskLoop.js";
import { SqliteDatastore } from "../core/store/index.js";
import { DEFAULT_CONFIG } from "../config.js";
import type { MarketDataSource, AssetContext, WatchHandlers, WatchHandle, Candle, FundingPoint } from "../core/data/index.js";

const PARAMS = DEFAULT_CONFIG.paper;

function ctx(name: string, mark: number, funding = 0): AssetContext {
  return { name, dayNtlVlm: 1e12, funding, markPx: mark, midPx: mark, oraclePx: mark, prevDayPx: mark, openInterest: 1 };
}

// A data source whose `watch` captures the handlers so the test can push ticks.
function fakeData() {
  let handlers: WatchHandlers | null = null;
  const ds: MarketDataSource = {
    async getUniverse(): Promise<AssetContext[]> { return []; },
    async getDailyCandles(): Promise<Candle[]> { return []; },
    async getFundingHistory(): Promise<FundingPoint[]> { return []; },
    watch(_coins: string[], h: WatchHandlers): WatchHandle {
      handlers = h;
      return { status: () => "connected", close: () => {} };
    },
  };
  return { ds, push: (c: AssetContext) => handlers!.onCtx(c) };
}

function seededStore() {
  const store = new SqliteDatastore(":memory:");
  store.init();
  // A book: BTC long 10 @100, ETH short 20 @50; cash so NAV ~ 1000.
  store.saveAccountState({
    initialCapital: 1_000,
    cash: 1_000,
    positions: [{ coin: "BTC", size: 10, entry: 100 }, { coin: "ETH", size: -20, entry: 50 }],
    realizedPricePnl: 0, feesPaid: 0, fundingPnl: 0,
  });
  return store;
}

function deps(store: SqliteDatastore, data: MarketDataSource, notify = { send: vi.fn(async () => {}) }): RiskLoopDeps {
  return {
    data, store, notify,
    paper: PARAMS,
    risk: { spreadStopPct: 0.08, circuitBreakerBand: 0.15, fundingAlertAnnualized: 0.5 },
  };
}

describe("RiskLoop", () => {
  it("flattens a leg and notifies when it gaps beyond the circuit-breaker band", async () => {
    const store = seededStore();
    const { ds, push } = fakeData();
    const notify = { send: vi.fn(async () => {}) };
    const loop = new RiskLoop(deps(store, ds, notify));
    loop.start();

    // Need a mark for both legs before evaluating; BTC gaps -20%.
    push(ctx("ETH", 50));
    push(ctx("BTC", 80));
    await loop.idle(); // let async flatten/persist settle

    const state = store.getAccountState()!;
    expect(state.positions.map((p) => p.coin)).toEqual(["ETH"]); // BTC flattened
    expect(notify.send).toHaveBeenCalled();
    loop.stop();
    store.close();
  });

  it("flattens the whole book on a spread stop", async () => {
    const store = seededStore();
    const { ds, push } = fakeData();
    const loop = new RiskLoop(deps(store, ds));
    loop.start();
    // BTC 100->95 (-50), ETH 50->53 (-60) => -110 on NAV 1000 (>8%)
    push(ctx("BTC", 95));
    push(ctx("ETH", 53));
    await loop.idle();

    expect(store.getAccountState()!.positions).toEqual([]);
    loop.stop();
    store.close();
  });

  it("only alerts (no flatten) on a funding spike", async () => {
    const store = seededStore();
    const { ds, push } = fakeData();
    const notify = { send: vi.fn(async () => {}) };
    const loop = new RiskLoop(deps(store, ds, notify));
    loop.start();
    push(ctx("BTC", 100, 0.0001)); // annualized 0.876 > 0.5
    push(ctx("ETH", 50));
    await loop.idle();

    expect(store.getAccountState()!.positions.map((p) => p.coin).sort()).toEqual(["BTC", "ETH"]);
    expect(notify.send).toHaveBeenCalled();
    loop.stop();
    store.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runner/riskLoop.test.ts`
Expected: FAIL — cannot find module `./riskLoop.js`.

- [ ] **Step 3: Write `src/runner/riskLoop.ts`**

```ts
import type { MarketDataSource, AssetContext, WatchHandle } from "../core/data/index.js";
import type { Datastore } from "../core/store/index.js";
import type { PaperParams } from "../core/paper/index.js";
import type { Notifier } from "../core/notify/index.js";
import type { RiskParams } from "../core/risk/index.js";
import { PaperAccount } from "../core/paper/index.js";
import { evaluateRisk } from "../core/risk/index.js";

export interface RiskLoopDeps {
  data: MarketDataSource;
  store: Datastore;
  notify: Notifier;
  paper: PaperParams;
  risk: RiskParams;
}

/**
 * Streaming risk watch. Holds live marks/funding from the WS feed, evaluates
 * book-level and per-leg risk on every tick, and flattens against the latest
 * persisted account the instant a stop trips — independent of the daily cycle.
 */
export class RiskLoop {
  private readonly marks = new Map<string, number>();
  private readonly funding = new Map<string, number>();
  private handle: WatchHandle | null = null;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly deps: RiskLoopDeps) {}

  /** Begin watching the currently-held coins. */
  start(): void {
    const state = this.deps.store.getAccountState();
    const coins = state ? state.positions.map((p) => p.coin) : [];
    this.handle = this.deps.data.watch(coins, {
      onCtx: (ctx) => this.onTick(ctx),
      onError: (err) => void this.deps.notify.send(`risk feed error: ${err.message}`).catch(() => {}),
    });
  }

  stop(): void {
    this.handle?.close();
    this.handle = null;
  }

  /** Resolve once any in-flight tick handling has settled (test hook). */
  async idle(): Promise<void> {
    await this.pending;
  }

  private onTick(ctx: AssetContext): void {
    if (ctx.midPx !== null) this.marks.set(ctx.name, ctx.midPx);
    else this.marks.set(ctx.name, ctx.markPx);
    this.funding.set(ctx.name, ctx.funding);
    this.pending = this.pending.then(() => this.evaluate());
  }

  private async evaluate(): Promise<void> {
    const state = this.deps.store.getAccountState();
    if (!state || state.positions.length === 0) return;

    const account = PaperAccount.fromState(state, this.deps.paper);
    const positions = account.positions();
    const nav = account.equity(this.marks);
    const action = evaluateRisk(positions, this.marks, this.funding, nav, this.deps.risk);

    for (const a of action.alerts) await this.deps.notify.send(a).catch(() => {});

    const toFlatten = action.flattenAll ? positions.map((p) => p.coin) : action.flattenLegs;
    if (toFlatten.length === 0) return;

    const volumes = new Map<string, number>(); // unknown live; slippage falls back to 0
    account.flatten(toFlatten, this.marks, volumes);
    this.deps.store.transaction(() => {
      this.deps.store.saveAccountState(account.toState());
    });
    await this.deps.notify.send(`flattened ${toFlatten.join(", ")}`).catch(() => {});
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/runner/riskLoop.test.ts`
Expected: PASS (3 cases).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runner/riskLoop.ts src/runner/riskLoop.test.ts
git commit -m "feat(runner): streaming risk loop — flatten on stop, alert on funding"
```

---

### Task 6: Config + CLI wiring

**Files:**
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Add risk params to `src/config.ts`**

Add the import and the `risk` field. At the top, add:

```ts
import type { RiskParams } from "./core/risk/index.js";
```

Add `risk: RiskParams;` to the `Config` interface (after `paper`). Add to `DEFAULT_CONFIG` (after `paper`):

```ts
  risk: { spreadStopPct: 0.08, circuitBreakerBand: 0.15, fundingAlertAnnualized: 0.5 },
```

- [ ] **Step 2: Extend `src/config.test.ts`**

Add this assertion inside the existing "returns defaults when env is empty" test (or as a new `it`), confirming the risk defaults are present:

```ts
  it("includes risk defaults", () => {
    expect(loadConfig({}).risk).toEqual({ spreadStopPct: 0.08, circuitBreakerBand: 0.15, fundingAlertAnnualized: 0.5 });
  });
```

Run: `pnpm vitest run src/config.test.ts` — Expected: PASS (the spread `...DEFAULT_CONFIG` already carries the new field; no loader change needed for env since risk has no env overrides in v1).

- [ ] **Step 3: Add a `watch` command to `src/cli.ts`**

Add imports:

```ts
import { RiskLoop } from "./runner/riskLoop.js";
import { ConsoleNotifier, MultiNotifier, TelegramNotifier, type Notifier } from "./core/notify/index.js";
```

Add a helper to build the notifier from env (above `main`):

```ts
function buildNotifier(env: Record<string, string | undefined>): Notifier {
  const notifiers: Notifier[] = [new ConsoleNotifier()];
  const token = env["TELEGRAM_BOT_TOKEN"];
  const chat = env["TELEGRAM_CHAT_ID"];
  if (token && chat) notifiers.push(new TelegramNotifier(token, chat));
  return new MultiNotifier(notifiers);
}
```

Add a `watch` branch in the command `if/else` (before the unknown-command `else`):

```ts
    } else if (command === "watch") {
      const data = new HyperLiquidDataSource();
      const notify = buildNotifier(process.env);
      const loop = new RiskLoop({ data, store, notify, paper: config.paper, risk: config.risk });
      loop.start();
      console.log("risk loop watching… (ctrl-c to stop)");
      await new Promise<void>((resolve) => {
        process.on("SIGINT", () => { loop.stop(); resolve(); });
      });
```

Update the usage string in the unknown-command branch to `usage: cli.ts [run|report|watch]`.

Note: the `watch` branch keeps the process alive until SIGINT, so the `finally { store.close() }` runs on exit. Leave the `finally` as-is.

- [ ] **Step 4: Add a `watch` script to `package.json`**

Add to `"scripts"`:

```json
    "watch": "tsx src/cli.ts watch",
```

- [ ] **Step 5: Full verification**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: ALL test files PASS (Phases 1–4a suite + risk/notify/riskLoop/flatten + config).

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/config.test.ts src/cli.ts package.json
git commit -m "feat(cli): wire risk params + watch command (console + Telegram alerts)"
```

---

## Self-Review

**Spec coverage (design spec §7 risk management + §9 risk config):**
- §7 spread stop (combined unrealized loss > X% → flatten) → Task 1 (`evaluateRisk` book-level), Task 2 (`flatten`), Task 5 (loop) ✔ — mapped to the basket as a book-level stop.
- §7 per-leg circuit breaker (single-leg gap → flatten that leg immediately) → Task 1 (`flattenLegs`), Task 5 ✔
- §7 funding/liquidation alert (alert, not auto-close) → Task 1 (`alerts`), Tasks 3–5 (notify) ✔
- §7 evaluated on the streaming WS loop → Task 5 (`RiskLoop` over `data.watch`) ✔
- §9 spread-stop / circuit-breaker / funding-alert thresholds → Task 6 (config defaults 8% / 15% / 50%) ✔
- §10 notifier failures logged, never fatal → Task 3 (`MultiNotifier` swallows; loop `.catch`es) ✔

**Out of scope (deferred / not in §7):** real margin/liquidation modelling (paper has no leverage/margin); the §10 stale-data rebalance guard and per-coin candle tolerance (Phase 4a follow-ups); Discord (the `Notifier` interface makes it a drop-in later). Live `recentVolumes` aren't available on the WS tick, so risk-loop flattens use slippage fallback 0 — acceptable for stop execution; noted in `riskLoop.ts`.

**Placeholder scan:** none — every code step is complete. The one intentional intermediate state (Task 3's `index.ts` references the Task 4 `telegram.js`) is called out with the exact reason and the note that the Task 3 test imports concrete files directly so it passes; the full typecheck is run in Task 4.

**Type consistency:** `RiskParams`/`RiskAction` defined in `risk/evaluate.ts`, consumed by `riskLoop.ts` and `config.ts`. `Notifier` defined in `notify/Notifier.ts`, implemented by console/multi/telegram, consumed by `riskLoop.ts` and `cli.ts`. `PaperAccount.flatten` signature `(coins, prices, recentVolumes)` matches its call in `riskLoop.ts`. `evaluateRisk(positions, marks, fundingRates, nav, params)` argument order is identical in the test, the loop, and the definition. The `RiskLoopDeps` shape matches between `riskLoop.ts`, its test, and the `cli.ts` construction.
