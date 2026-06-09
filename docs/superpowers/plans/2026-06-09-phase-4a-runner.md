# Phase 4a: Paper-Trading Runner + CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the three pure subsystems into a runnable, resumable forward paper-trading daemon: a daily cycle that fetches HyperLiquid data, runs the signal, rebalances/marks the paper account with funding, persists everything to SQLite (idempotent per day), plus a CLI to run a tick and report the equity curve.

**Architecture:** A new `src/runner/` orchestration layer + `src/config.ts` + `src/cli.ts`. The runner's `runDailyCycle` is pure orchestration over injected dependencies (`MarketDataSource`, `Datastore`, config, a clock), so it is fully testable with a fake data source and an in-memory store — no live network. The `Datastore` interface is extended with equity-curve, account-state, runner-state, and signal persistence. `PaperAccount` gains state serialization so the daemon resumes across restarts. The streaming WS risk loop and notifications are deliberately **Phase 4b**.

**Tech Stack:** TypeScript (ESM, strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Vitest, better-sqlite3, tsx (CLI entry). No new dependencies.

---

## Design decisions (locked)

- **Daily cycle (spec §8):** fetch top-N universe → persist snapshot → candles→closes → build signal (saved every tick for reporting) → rebalance **only on a rebalance day** → accrue funding → mark → persist equity point + account state + runner state.
- **Resume:** the account is reconstructed each tick from a persisted `AccountState` (cash, signed positions, the three P&L accumulators); fresh at `initialCapital` if none.
- **Idempotency (spec §10):** keyed by UTC day index (`floor(ts / 86_400_000)`). A second `runDailyCycle` on the same day is a no-op that returns the existing latest equity point.
- **Rebalance cadence:** rebalance when there is no prior rebalance, or when `now − lastRebalanceAt ≥ rebalanceIntervalDays` (in ms). Otherwise the tick only marks (and accrues funding).
- **Prices / volumes:** mark price and 24h volume come from the universe `AssetContext` (`markPx`, `dayNtlVlm`).
- **Funding:** for each held coin, sum HL `fundingHistory` rates since the last mark into a per-coin rate, then `accrueFunding`. First tick (no prior mark) accrues nothing.
- **Persistence couples the store to the domain types it stores** (`EquityPoint`, `CoinScore`, `AccountState`). That is acceptable: the store is the persistence boundary for those outputs.

## File Structure (Phase 4a)

| File | Responsibility |
|---|---|
| `src/config.ts` | `Config` type + `loadConfig(env)` (defaults + env overrides) |
| `src/core/paper/account.ts` (modify) | add `AccountState` type + `toState()` / `static fromState()` |
| `src/core/store/Datastore.ts` (modify) | extend interface: equity/account/runner/signal persistence |
| `src/core/store/sqlite/schema.ts` (modify) | new tables |
| `src/core/store/sqlite/SqliteDatastore.ts` (modify) | implement new methods |
| `src/runner/adapters.ts` | pure: `weightsFromBook`, `closesFromCandles`, `currentBookFromPositions`, `sumFundingSince` |
| `src/runner/runner.ts` | `runDailyCycle(deps, now)` orchestration + `RunnerDeps` |
| `src/runner/report.ts` | `formatReport(store)` → human-readable equity/P&L/book string |
| `src/cli.ts` | arg parse → `run` / `report` |

Tests next to each file as `*.test.ts`.

---

### Task 1: Config (`src/config.ts`)

**Files:**
- Create: `src/config.ts`
- Test: `src/config.test.ts`

- [ ] **Step 1: Write the failing test `src/config.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { loadConfig, DEFAULT_CONFIG } from "./config.js";

describe("loadConfig", () => {
  it("returns defaults when env is empty", () => {
    expect(loadConfig({})).toEqual(DEFAULT_CONFIG);
  });
  it("overrides numeric fields from env", () => {
    const cfg = loadConfig({ UNIVERSE_SIZE: "30", INITIAL_CAPITAL: "50000", DB_PATH: "/tmp/x.sqlite" });
    expect(cfg.universeSize).toBe(30);
    expect(cfg.initialCapital).toBe(50_000);
    expect(cfg.dbPath).toBe("/tmp/x.sqlite");
    // untouched fields keep defaults
    expect(cfg.signal).toEqual(DEFAULT_CONFIG.signal);
  });
  it("ignores non-numeric overrides and keeps the default", () => {
    expect(loadConfig({ UNIVERSE_SIZE: "abc" }).universeSize).toBe(DEFAULT_CONFIG.universeSize);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/config.test.ts`
Expected: FAIL — cannot find module `./config.js`.

- [ ] **Step 3: Write `src/config.ts`**

```ts
import type { SignalParams } from "./core/signal/index.js";
import type { PaperParams } from "./core/paper/index.js";

export interface Config {
  universeSize: number;
  candleHistoryDays: number;
  rebalanceIntervalDays: number;
  initialCapital: number;
  dbPath: string;
  signal: SignalParams;
  paper: PaperParams;
}

export const DEFAULT_CONFIG: Config = {
  universeSize: 20,
  candleHistoryDays: 90,
  rebalanceIntervalDays: 7,
  initialCapital: 100_000,
  dbPath: "crypto-markets.sqlite",
  signal: { lookbacks: [30, 60], quintileFraction: 0.2, grossExposure: 1.0, hysteresisBuffer: 1 },
  paper: { feeRate: 0.00045, slippageCoeff: 0.1, maxSlippage: 0.02 },
};

/** Read an optional positive number from env, falling back to a default. */
function numFromEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Build config from defaults, overriding top-level fields from env vars. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  return {
    ...DEFAULT_CONFIG,
    universeSize: numFromEnv(env["UNIVERSE_SIZE"], DEFAULT_CONFIG.universeSize),
    candleHistoryDays: numFromEnv(env["CANDLE_HISTORY_DAYS"], DEFAULT_CONFIG.candleHistoryDays),
    rebalanceIntervalDays: numFromEnv(env["REBALANCE_INTERVAL_DAYS"], DEFAULT_CONFIG.rebalanceIntervalDays),
    initialCapital: numFromEnv(env["INITIAL_CAPITAL"], DEFAULT_CONFIG.initialCapital),
    dbPath: env["DB_PATH"] ?? DEFAULT_CONFIG.dbPath,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat(config): typed Config with env overrides and defaults"
```

---

### Task 2: PaperAccount state serialization

**Files:**
- Modify: `src/core/paper/account.ts`
- Modify: `src/core/paper/types.ts`
- Modify: `src/core/paper/index.ts`
- Test: `src/core/paper/accountState.test.ts`

- [ ] **Step 1: Add `AccountState` to `src/core/paper/types.ts`** (append):

```ts
/** Serializable snapshot of a PaperAccount, for persistence and resume. */
export interface AccountState {
  initialCapital: number;
  cash: number;
  /** Signed positions (size > 0 long, < 0 short). */
  positions: { coin: string; size: number; entry: number }[];
  realizedPricePnl: number;
  feesPaid: number;
  fundingPnl: number;
}
```

- [ ] **Step 2: Write the failing test `src/core/paper/accountState.test.ts`**

```ts
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

    // identical marks after restore
    const pa = a.mark(prices({ BTC: 110, ETH: 55 }), 1);
    const pb = b.mark(prices({ BTC: 110, ETH: 55 }), 1);
    expect(pb).toEqual(pa);
    expect(b.positions()).toEqual(a.positions());
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/core/paper/accountState.test.ts`
Expected: FAIL — `toState`/`fromState` do not exist.

- [ ] **Step 4: Add serialization to `src/core/paper/account.ts`**

Add `AccountState` to the type import at the top of the file (change the existing `./types.js` import to include it):

```ts
import type { Fill, EquityPoint, PaperParams, Position, Side, AccountState } from "./types.js";
```

Add these two methods to the `PaperAccount` class (e.g. after `mark`):

```ts
  /** Serialize the full account state for persistence. */
  toState(): AccountState {
    const positions: { coin: string; size: number; entry: number }[] = [];
    for (const [coin, pos] of this.positionsByCoin) {
      if (pos.size !== 0) positions.push({ coin, size: pos.size, entry: pos.entry });
    }
    return {
      initialCapital: this.initialCapital,
      cash: this.cash,
      positions,
      realizedPricePnl: this.realizedPricePnl,
      feesPaid: this.feesPaid,
      fundingPnl: this.fundingPnl,
    };
  }

  /** Reconstruct an account from a persisted state. */
  static fromState(state: AccountState, params: PaperParams): PaperAccount {
    const acct = new PaperAccount(state.initialCapital, params);
    acct.cash = state.cash;
    acct.realizedPricePnl = state.realizedPricePnl;
    acct.feesPaid = state.feesPaid;
    acct.fundingPnl = state.fundingPnl;
    for (const p of state.positions) acct.positionsByCoin.set(p.coin, { size: p.size, entry: p.entry });
    return acct;
  }
```

Note: `cash`, `realizedPricePnl`, `feesPaid`, `fundingPnl` are currently `private`. `static fromState` is part of the same class, so it may assign them. Confirm the fields are declared `private` (not `private readonly`) — they are reassigned during normal operation, so they already are mutable.

- [ ] **Step 5: Export `AccountState` from `src/core/paper/index.ts`**

Change the types export line to include it:

```ts
export type { Side, Position, Fill, EquityPoint, PaperParams, AccountState } from "./types.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run src/core/paper/accountState.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/paper/account.ts src/core/paper/types.ts src/core/paper/index.ts src/core/paper/accountState.test.ts
git commit -m "feat(paper): AccountState serialization for resume"
```

---

### Task 3: Datastore extension (equity / account / runner / signal)

**Files:**
- Modify: `src/core/store/Datastore.ts`
- Modify: `src/core/store/sqlite/schema.ts`
- Modify: `src/core/store/sqlite/SqliteDatastore.ts`
- Test: `src/core/store/sqlite/SqliteDatastore.persist.test.ts`

- [ ] **Step 1: Extend the interface in `src/core/store/Datastore.ts`**

Add imports at the top (below the existing `AssetContext` import):

```ts
import type { EquityPoint, AccountState } from "../paper/index.js";
import type { CoinScore } from "../signal/index.js";

/** Runner bookkeeping: when we last marked and last rebalanced (epoch ms). */
export interface RunnerState {
  lastMarkAt: number;
  lastRebalanceAt: number;
}
```

Add these methods to the `Datastore` interface (before `close()`):

```ts
  /** Append an equity-curve point. */
  saveEquityPoint(point: EquityPoint): void;
  /** The full equity curve, oldest first. */
  getEquityCurve(): EquityPoint[];
  /** Persist (replace) the latest account state. */
  saveAccountState(state: AccountState): void;
  /** The latest account state, or null. */
  getAccountState(): AccountState | null;
  /** Persist (replace) runner bookkeeping. */
  saveRunnerState(state: RunnerState): void;
  /** The latest runner bookkeeping, or null. */
  getRunnerState(): RunnerState | null;
  /** Persist the ranked signal scores captured at `capturedAt`. */
  saveSignal(capturedAt: number, scores: CoinScore[]): void;
  /** The most recently captured signal, or null. */
  getLatestSignal(): { capturedAt: number; scores: CoinScore[] } | null;
```

- [ ] **Step 2: Extend the schema in `src/core/store/sqlite/schema.ts`**

Replace the `migrate` body's `db.exec(...)` with one that also creates the new tables (keep `market_snapshots`):

```ts
export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_snapshots (
      captured_at INTEGER PRIMARY KEY,
      payload     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS equity_points (
      timestamp   INTEGER PRIMARY KEY,
      payload     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS account_state (
      id      INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runner_state (
      id      INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS signals (
      captured_at INTEGER PRIMARY KEY,
      payload     TEXT NOT NULL
    );
  `);
}
```

- [ ] **Step 3: Write the failing test `src/core/store/sqlite/SqliteDatastore.persist.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { SqliteDatastore } from "./SqliteDatastore.js";
import type { EquityPoint, AccountState } from "../../paper/index.js";
import type { CoinScore } from "../../signal/index.js";

function store() {
  const s = new SqliteDatastore(":memory:");
  s.init();
  return s;
}

const eq = (timestamp: number, equity: number): EquityPoint => ({ timestamp, equity, pricePnl: 0, fundingPnl: 0, fees: 0 });

describe("SqliteDatastore Phase 4 persistence", () => {
  it("appends and returns the equity curve oldest-first", () => {
    const s = store();
    s.saveEquityPoint(eq(200, 101));
    s.saveEquityPoint(eq(100, 100));
    expect(s.getEquityCurve().map((p) => p.timestamp)).toEqual([100, 200]);
    s.close();
  });

  it("round-trips account state (replacing the single row)", () => {
    const s = store();
    const a: AccountState = { initialCapital: 100, cash: 90, positions: [{ coin: "BTC", size: 1, entry: 100 }], realizedPricePnl: 1, feesPaid: 2, fundingPnl: 3 };
    s.saveAccountState(a);
    s.saveAccountState({ ...a, cash: 80 });
    expect(s.getAccountState()).toEqual({ ...a, cash: 80 });
    s.close();
  });

  it("round-trips runner state and returns null when empty", () => {
    const s = store();
    expect(s.getRunnerState()).toBeNull();
    s.saveRunnerState({ lastMarkAt: 10, lastRebalanceAt: 5 });
    expect(s.getRunnerState()).toEqual({ lastMarkAt: 10, lastRebalanceAt: 5 });
    s.close();
  });

  it("stores the latest signal", () => {
    const s = store();
    const scores: CoinScore[] = [{ coin: "BTC", score: 1.2 }, { coin: "ETH", score: -0.3 }];
    s.saveSignal(100, scores);
    s.saveSignal(200, [{ coin: "SOL", score: 0.5 }]);
    expect(s.getLatestSignal()).toEqual({ capturedAt: 200, scores: [{ coin: "SOL", score: 0.5 }] });
    s.close();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run src/core/store/sqlite/SqliteDatastore.persist.test.ts`
Expected: FAIL — the new methods don't exist.

- [ ] **Step 5: Implement the methods in `src/core/store/sqlite/SqliteDatastore.ts`**

Add imports at the top (below existing imports):

```ts
import type { Datastore, MarketSnapshot, RunnerState } from "../Datastore.js";
import type { EquityPoint, AccountState } from "../../paper/index.js";
import type { CoinScore } from "../../signal/index.js";
```

(The existing import of `Datastore, MarketSnapshot` should be merged into the line above — ensure `RunnerState` is included and there is only one import from `../Datastore.js`.)

Add these methods to the `SqliteDatastore` class (before `close()`):

```ts
  saveEquityPoint(point: EquityPoint): void {
    this.db
      .prepare("INSERT OR REPLACE INTO equity_points (timestamp, payload) VALUES (?, ?)")
      .run(point.timestamp, JSON.stringify(point));
  }

  getEquityCurve(): EquityPoint[] {
    const rows = this.db
      .prepare("SELECT payload FROM equity_points ORDER BY timestamp ASC")
      .all() as { payload: string }[];
    return rows.map((r) => JSON.parse(r.payload) as EquityPoint);
  }

  saveAccountState(state: AccountState): void {
    this.db
      .prepare("INSERT OR REPLACE INTO account_state (id, payload) VALUES (1, ?)")
      .run(JSON.stringify(state));
  }

  getAccountState(): AccountState | null {
    const row = this.db.prepare("SELECT payload FROM account_state WHERE id = 1").get() as
      | { payload: string }
      | undefined;
    return row ? (JSON.parse(row.payload) as AccountState) : null;
  }

  saveRunnerState(state: RunnerState): void {
    this.db
      .prepare("INSERT OR REPLACE INTO runner_state (id, payload) VALUES (1, ?)")
      .run(JSON.stringify(state));
  }

  getRunnerState(): RunnerState | null {
    const row = this.db.prepare("SELECT payload FROM runner_state WHERE id = 1").get() as
      | { payload: string }
      | undefined;
    return row ? (JSON.parse(row.payload) as RunnerState) : null;
  }

  saveSignal(capturedAt: number, scores: CoinScore[]): void {
    this.db
      .prepare("INSERT OR REPLACE INTO signals (captured_at, payload) VALUES (?, ?)")
      .run(capturedAt, JSON.stringify(scores));
  }

  getLatestSignal(): { capturedAt: number; scores: CoinScore[] } | null {
    const row = this.db
      .prepare("SELECT captured_at, payload FROM signals ORDER BY captured_at DESC LIMIT 1")
      .get() as { captured_at: number; payload: string } | undefined;
    if (!row) return null;
    return { capturedAt: row.captured_at, scores: JSON.parse(row.payload) as CoinScore[] };
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run src/core/store/sqlite/SqliteDatastore.persist.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/store/Datastore.ts src/core/store/sqlite/schema.ts src/core/store/sqlite/SqliteDatastore.ts src/core/store/sqlite/SqliteDatastore.persist.test.ts
git commit -m "feat(store): persist equity curve, account/runner state, signals"
```

---

### Task 4: Runner adapters (`src/runner/adapters.ts`)

**Files:**
- Create: `src/runner/adapters.ts`
- Test: `src/runner/adapters.test.ts`

- [ ] **Step 1: Write the failing test `src/runner/adapters.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { weightsFromBook, closesFromCandles, currentBookFromPositions, sumFundingSince } from "./adapters.js";
import type { TargetBook } from "../core/signal/index.js";
import type { Candle, FundingPoint } from "../core/data/index.js";
import type { Position } from "../core/paper/index.js";

describe("weightsFromBook", () => {
  it("maps long/short positions to signed weights", () => {
    const book: TargetBook = { positions: [
      { coin: "BTC", side: "long", weight: 0.25 },
      { coin: "ETH", side: "short", weight: 0.25 },
    ] };
    expect(weightsFromBook(book)).toEqual(new Map([["BTC", 0.25], ["ETH", -0.25]]));
  });
});

describe("closesFromCandles", () => {
  it("extracts close prices in order", () => {
    const candles = [
      { coin: "BTC", openTime: 1, closeTime: 2, open: 1, high: 1, low: 1, close: 100, volume: 1, trades: 1 },
      { coin: "BTC", openTime: 2, closeTime: 3, open: 1, high: 1, low: 1, close: 110, volume: 1, trades: 1 },
    ] as Candle[];
    expect(closesFromCandles(candles)).toEqual([100, 110]);
  });
});

describe("currentBookFromPositions", () => {
  it("splits positions into long and short coin lists", () => {
    const positions: Position[] = [
      { coin: "BTC", side: "long", size: 1, entryPrice: 100 },
      { coin: "ETH", side: "short", size: 2, entryPrice: 50 },
    ];
    expect(currentBookFromPositions(positions)).toEqual({ longs: ["BTC"], shorts: ["ETH"] });
  });
});

describe("sumFundingSince", () => {
  it("sums funding rates strictly after the cutoff", () => {
    const pts: FundingPoint[] = [
      { coin: "BTC", rate: 0.0001, time: 100 },
      { coin: "BTC", rate: 0.0002, time: 200 },
      { coin: "BTC", rate: 0.0003, time: 300 },
    ];
    expect(sumFundingSince(pts, 150)).toBeCloseTo(0.0005, 10); // 200 + 300
  });
  it("is zero for no points after the cutoff", () => {
    expect(sumFundingSince([{ coin: "BTC", rate: 0.0001, time: 100 }], 150)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runner/adapters.test.ts`
Expected: FAIL — cannot find module `./adapters.js`.

- [ ] **Step 3: Write `src/runner/adapters.ts`**

```ts
import type { TargetBook, CurrentBook } from "../core/signal/index.js";
import type { Candle, FundingPoint } from "../core/data/index.js";
import type { Position } from "../core/paper/index.js";

/** Convert a target book into signed NAV weights (+ long, − short). */
export function weightsFromBook(book: TargetBook): Map<string, number> {
  const weights = new Map<string, number>();
  for (const p of book.positions) weights.set(p.coin, p.side === "long" ? p.weight : -p.weight);
  return weights;
}

/** Close prices from a candle series, in order. */
export function closesFromCandles(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

/** Split held positions into the long/short coin lists hysteresis needs. */
export function currentBookFromPositions(positions: Position[]): CurrentBook {
  return {
    longs: positions.filter((p) => p.side === "long").map((p) => p.coin),
    shorts: positions.filter((p) => p.side === "short").map((p) => p.coin),
  };
}

/** Sum funding rates strictly after `cutoff` (epoch ms) into a single rate. */
export function sumFundingSince(points: FundingPoint[], cutoff: number): number {
  return points.reduce((sum, p) => (p.time > cutoff ? sum + p.rate : sum), 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/runner/adapters.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runner/adapters.ts src/runner/adapters.test.ts
git commit -m "feat(runner): adapters between data, signal, and paper layers"
```

---

### Task 5: The daily cycle (`src/runner/runner.ts`)

**Files:**
- Create: `src/runner/runner.ts`
- Test: `src/runner/runner.test.ts`

- [ ] **Step 1: Write the failing test `src/runner/runner.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { runDailyCycle, type RunnerDeps } from "./runner.js";
import { SqliteDatastore } from "../core/store/index.js";
import { DEFAULT_CONFIG, type Config } from "../config.js";
import type { MarketDataSource, AssetContext, Candle, FundingPoint, WatchHandle } from "../core/data/index.js";

const DAY = 86_400_000;

function ctx(name: string, vol: number, mark: number): AssetContext {
  return { name, dayNtlVlm: vol, funding: 0, markPx: mark, midPx: mark, oraclePx: mark, prevDayPx: mark, openInterest: 1 };
}

// Deterministic fake: a fixed universe; each coin has a linear up/down price path.
function fakeData(): MarketDataSource {
  const universe = [
    ctx("UP1", 1e9, 170), ctx("UP2", 9e8, 140), ctx("MID", 8e8, 104),
    ctx("DN1", 7e8, 75), ctx("DN2", 6e8, 50), ctx("DN3", 5e8, 40),
  ];
  const paths: Record<string, number[]> = {
    UP1: [], UP2: [], MID: [], DN1: [], DN2: [], DN3: [],
  };
  for (let i = 0; i < 70; i++) {
    paths["UP1"]!.push(100 + i); paths["UP2"]!.push(100 + i * 0.6);
    paths["MID"]!.push(100 + Math.sin(i) * 2); paths["DN1"]!.push(100 - i * 0.4);
    paths["DN2"]!.push(100 - i * 0.7); paths["DN3"]!.push(100 - i * 0.85);
  }
  return {
    async getUniverse() { return universe; },
    async getDailyCandles(coin: string, days: number): Promise<Candle[]> {
      const closes = paths[coin] ?? [];
      const slice = closes.slice(-days);
      return slice.map((close, i) => ({ coin, openTime: i, closeTime: i, open: close, high: close, low: close, close, volume: 1, trades: 1 }));
    },
    async getFundingHistory(): Promise<FundingPoint[]> { return []; },
    watch(): WatchHandle { return { status: () => "closed", close: () => {} }; },
  };
}

function deps(store: SqliteDatastore, now: number): RunnerDeps {
  const cfg: Config = { ...DEFAULT_CONFIG, universeSize: 6, candleHistoryDays: 70, rebalanceIntervalDays: 7 };
  return { data: fakeData(), store, config: cfg, now };
}

describe("runDailyCycle", () => {
  it("rebalances on the first tick and writes an equity point + state", async () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    const point = await runDailyCycle(deps(store, 10 * DAY));
    expect(point.timestamp).toBe(10 * DAY);
    expect(store.getEquityCurve()).toHaveLength(1);
    expect(store.getAccountState()).not.toBeNull();
    expect(store.getLatestSignal()?.scores[0]?.coin).toBe("UP1"); // strongest
    // a market-neutral book was opened
    const state = store.getAccountState()!;
    expect(state.positions.length).toBeGreaterThan(0);
    store.close();
  });

  it("is idempotent within the same UTC day", async () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    await runDailyCycle(deps(store, 10 * DAY));
    const again = await runDailyCycle(deps(store, 10 * DAY + 3600_000)); // same day, +1h
    expect(store.getEquityCurve()).toHaveLength(1); // no second point
    expect(again.timestamp).toBe(10 * DAY); // returns the existing point
    store.close();
  });

  it("marks again the next day without rebalancing before the interval", async () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    await runDailyCycle(deps(store, 10 * DAY));
    const rebAt1 = store.getRunnerState()!.lastRebalanceAt;
    await runDailyCycle(deps(store, 11 * DAY)); // next day, < 7d interval
    expect(store.getEquityCurve()).toHaveLength(2);
    expect(store.getRunnerState()!.lastRebalanceAt).toBe(rebAt1); // no rebalance yet
    store.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runner/runner.test.ts`
Expected: FAIL — cannot find module `./runner.js`.

- [ ] **Step 3: Write `src/runner/runner.ts`**

```ts
import type { MarketDataSource } from "../core/data/index.js";
import type { Datastore } from "../core/store/index.js";
import type { EquityPoint } from "../core/paper/index.js";
import type { Config } from "../config.js";
import { buildTargetBook } from "../core/signal/index.js";
import { PaperAccount } from "../core/paper/index.js";
import { weightsFromBook, closesFromCandles, currentBookFromPositions, sumFundingSince } from "./adapters.js";

const DAY = 86_400_000;

export interface RunnerDeps {
  data: MarketDataSource;
  store: Datastore;
  config: Config;
  now: number;
}

const dayIndex = (ts: number): number => Math.floor(ts / DAY);

/**
 * One daily paper-trading cycle: fetch -> snapshot -> signal -> (rebalance on
 * cadence) -> accrue funding -> mark -> persist. Idempotent per UTC day: a
 * second call on the same day returns the existing latest equity point.
 */
export async function runDailyCycle(deps: RunnerDeps): Promise<EquityPoint> {
  const { data, store, config, now } = deps;

  const runner = store.getRunnerState();
  const curve = store.getEquityCurve();
  if (runner && dayIndex(runner.lastMarkAt) === dayIndex(now)) {
    return curve[curve.length - 1]!; // already ran today
  }

  // 1. Fetch universe + persist snapshot.
  const universe = await data.getUniverse(config.universeSize);
  store.saveMarketSnapshot({ capturedAt: now, universe });
  const prices = new Map(universe.map((c) => [c.name, c.markPx]));
  const volumes = new Map(universe.map((c) => [c.name, c.dayNtlVlm]));

  // 2. Candles -> closes.
  const closesByCoin = new Map<string, number[]>();
  for (const c of universe) {
    const candles = await data.getDailyCandles(c.name, config.candleHistoryDays);
    closesByCoin.set(c.name, closesFromCandles(candles));
  }

  // 3. Restore account + current book.
  const prevState = store.getAccountState();
  const account = prevState ? PaperAccount.fromState(prevState, config.paper) : new PaperAccount(config.initialCapital, config.paper);
  const current = currentBookFromPositions(account.positions());

  // 4. Signal (saved every tick for reporting).
  const { scores, book } = buildTargetBook(closesByCoin, config.signal, current);
  store.saveSignal(now, scores);

  // 5. Rebalance on cadence (or first ever).
  const shouldRebalance = !runner || runner.lastRebalanceAt === 0 || now - runner.lastRebalanceAt >= config.rebalanceIntervalDays * DAY;
  if (shouldRebalance) account.rebalance(weightsFromBook(book), prices, volumes);

  // 6. Funding since last mark (none on the first tick).
  if (runner) {
    const rates = new Map<string, number>();
    for (const p of account.positions()) {
      const history = await data.getFundingHistory(p.coin, runner.lastMarkAt);
      rates.set(p.coin, sumFundingSince(history, runner.lastMarkAt));
    }
    account.accrueFunding(rates, prices);
  }

  // 7. Mark + persist.
  const point = account.mark(prices, now);
  store.saveEquityPoint(point);
  store.saveAccountState(account.toState());
  store.saveRunnerState({
    lastMarkAt: now,
    lastRebalanceAt: shouldRebalance ? now : (runner?.lastRebalanceAt ?? now),
  });
  return point;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/runner/runner.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/runner/runner.ts src/runner/runner.test.ts
git commit -m "feat(runner): idempotent daily paper-trading cycle"
```

---

### Task 6: Report + CLI (`src/runner/report.ts`, `src/cli.ts`)

**Files:**
- Create: `src/runner/report.ts`
- Create: `src/cli.ts`
- Test: `src/runner/report.test.ts`

- [ ] **Step 1: Write the failing test `src/runner/report.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { formatReport } from "./report.js";
import { SqliteDatastore } from "../core/store/index.js";

describe("formatReport", () => {
  it("summarizes equity, return, and the latest signal", () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    store.saveEquityPoint({ timestamp: 0, equity: 100_000, pricePnl: 0, fundingPnl: 0, fees: 0 });
    store.saveEquityPoint({ timestamp: 86_400_000, equity: 105_000, pricePnl: 5_200, fundingPnl: -50, fees: 150 });
    store.saveAccountState({ initialCapital: 100_000, cash: 100_000, positions: [{ coin: "BTC", size: 1, entry: 100 }], realizedPricePnl: 0, feesPaid: 150, fundingPnl: -50 });
    store.saveSignal(86_400_000, [{ coin: "BTC", score: 1.2 }]);

    const out = formatReport(store);
    expect(out).toContain("105,000");
    expect(out).toContain("+5.00%"); // (105000/100000 - 1)
    expect(out).toContain("BTC");
    store.close();
  });

  it("reports an empty store gracefully", () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    expect(formatReport(store)).toContain("no equity history");
    store.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runner/report.test.ts`
Expected: FAIL — cannot find module `./report.js`.

- [ ] **Step 3: Write `src/runner/report.ts`**

```ts
import type { Datastore } from "../core/store/index.js";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Build a human-readable summary of the persisted paper-trading state. */
export function formatReport(store: Datastore): string {
  const curve = store.getEquityCurve();
  if (curve.length === 0) return "no equity history yet — run a cycle first.";

  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  const ret = (last.equity / first.equity - 1) * 100;

  const lines: string[] = [];
  lines.push("=== paper-trading report ===");
  lines.push(`points:        ${curve.length}`);
  lines.push(`start equity:  $${money(first.equity)}`);
  lines.push(`latest equity: $${money(last.equity)}`);
  lines.push(`return:        ${ret >= 0 ? "+" : ""}${money(ret)}%`);
  lines.push(`price P&L:     $${money(last.pricePnl)}`);
  lines.push(`funding P&L:   $${money(last.fundingPnl)}`);
  lines.push(`fees:          $${money(last.fees)}`);

  const state = store.getAccountState();
  if (state && state.positions.length > 0) {
    lines.push("--- current book ---");
    for (const p of state.positions) {
      lines.push(`  ${p.size > 0 ? "long " : "short"} ${p.coin.padEnd(6)} size ${money(Math.abs(p.size))} @ ${money(p.entry)}`);
    }
  }

  const signal = store.getLatestSignal();
  if (signal && signal.scores.length > 0) {
    const top = signal.scores[0]!;
    const bottom = signal.scores[signal.scores.length - 1]!;
    lines.push("--- latest signal ---");
    lines.push(`  strongest: ${top.coin} (${money(top.score)})`);
    lines.push(`  weakest:   ${bottom.coin} (${money(bottom.score)})`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/runner/report.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `src/cli.ts`** (no unit test — thin I/O wrapper)

```ts
import { loadConfig } from "./config.js";
import { SqliteDatastore } from "./core/store/index.js";
import { HyperLiquidDataSource } from "./core/data/index.js";
import { runDailyCycle } from "./runner/runner.js";
import { formatReport } from "./runner/report.js";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "report";
  const config = loadConfig(process.env);
  const store = new SqliteDatastore(config.dbPath);
  store.init();

  try {
    if (command === "run") {
      const data = new HyperLiquidDataSource();
      const point = await runDailyCycle({ data, store, config, now: Date.now() });
      console.log(`tick done @ ${new Date(point.timestamp).toISOString()} — equity $${point.equity.toFixed(2)}`);
      console.log(formatReport(store));
    } else if (command === "report") {
      console.log(formatReport(store));
    } else {
      console.error(`unknown command: ${command}\nusage: cli.ts [run|report]`);
      process.exitCode = 1;
    }
  } finally {
    store.close();
  }
}

main().catch((err) => {
  console.error("cli failed:", err);
  process.exit(1);
});
```

- [ ] **Step 6: Add CLI scripts to `package.json`**

Add to the `"scripts"` block:

```json
    "run:tick": "tsx src/cli.ts run",
    "report": "tsx src/cli.ts report",
```

- [ ] **Step 7: Full verification**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: ALL test files PASS (Phases 1–3 suite + the new config/account-state/persistence/adapters/runner/report tests).

- [ ] **Step 8: Commit**

```bash
git add src/runner/report.ts src/cli.ts src/runner/report.test.ts package.json
git commit -m "feat(runner): report formatter + run/report CLI"
```

---

## Self-Review

**Spec coverage (design spec §8 daily flow + §9 config + §10 error handling, Phase 4a portions):**
- §8.1 fetch top-N + candles + funding → Task 5 (`runDailyCycle`) via the data source ✔
- §8.2 persist snapshot → Task 5 (`saveMarketSnapshot`) ✔
- §8.3 score & rank → Task 5 (`buildTargetBook`) + `saveSignal` ✔
- §8.4 target book → Task 5 ✔
- §8.5 rebalance on rebalance day (else mark only) → Task 5 cadence check ✔
- §8.6 simulate fills + funding + mark → Task 5 (`rebalance`/`accrueFunding`/`mark`) ✔
- §8.7 persist signals/positions/equity → Tasks 3 + 5 ✔
- §9 config (universe size, lookbacks, quintile, gross, rebalance interval, fee model) → Task 1 ✔
- §10 idempotent runs keyed by date → Task 5 (`dayIndex` guard) ✔
- §10 missing candles → excluded by `buildTargetBook` (Phase 2) ✔

**Out of Phase 4a scope (Phase 4b / deferred — do not add here):** the streaming WS risk loop and guards (spec §7 spread-stop, per-leg circuit breaker, funding alerts); Telegram/Discord notifications; the `backfill` command (a historical replay — the `scripts/backtest.ts` already covers ad-hoc backtests). `cli.ts` is a thin I/O wrapper and is intentionally not unit-tested; its logic lives in the tested `runDailyCycle` and `formatReport`.

**Placeholder scan:** none — every code step is complete and runnable.

**Type consistency:** `Config`/`DEFAULT_CONFIG` fields used identically in Tasks 1 and 5. `AccountState` defined in `paper/types.ts` (Task 2), persisted in Task 3, produced/consumed by `toState`/`fromState` and the runner. `RunnerState` defined in `Datastore.ts` (Task 3), used in Task 5. `EquityPoint`/`CoinScore` flow from paper/signal through the store and report. Runner adapter names (`weightsFromBook`, `closesFromCandles`, `currentBookFromPositions`, `sumFundingSince`) and `runDailyCycle`/`RunnerDeps`/`formatReport` are referenced identically across tasks. The `MarketDataSource` fake in Task 5 implements the full Phase 1 interface (`getUniverse`, `getDailyCandles`, `getFundingHistory`, `watch`).
