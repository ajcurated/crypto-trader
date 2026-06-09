# Phase 5: Robustness & Operability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daemon production-worthy: tolerate per-coin data failures, skip rebalances on stale/incomplete data (spec §10), make risk thresholds env-tunable, and add an always-on `daemon` mode that runs the daily cycle on a schedule and keeps the risk loop's watched coin-set fresh after each rebalance.

**Architecture:** Three changes. (1) `runDailyCycle` gains per-coin candle-fetch tolerance and a stale-data guard that skips the rebalance (keeps marking) when too few coins have usable history. (2) `loadConfig` gains env overrides for the risk thresholds + a `minUniverseForRebalance` knob. (3) A new `src/runner/daemon.ts` `Daemon` orchestrates the slow clock (scheduled idempotent daily cycles) and the fast clock (the risk loop), restarting the risk loop after each cycle so newly-opened coins get watched. The scheduler and clock are injected, so the daemon is unit-tested deterministically.

**Tech Stack:** TypeScript (ESM, strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Vitest. No new dependencies.

---

## Locked decisions

- **Per-coin candle tolerance:** a `getDailyCandles` rejection for one coin is caught and that coin is skipped (it's then naturally excluded from the signal). One flaky coin never aborts the tick.
- **Stale-data rebalance guard (§10):** after building the signal, if the number of coins with usable history (`scores.length`) is below `config.minUniverseForRebalance`, **skip the rebalance** (keep the existing book) but still mark + persist. Default `minUniverseForRebalance = 6`.
- **Env-tunable risk:** `SPREAD_STOP_PCT`, `CIRCUIT_BREAKER_BAND`, `FUNDING_ALERT_ANNUALIZED`, `MIN_UNIVERSE_FOR_REBALANCE` override the defaults.
- **Daemon refresh:** after every daily cycle the daemon calls `riskLoop.start()` (idempotent — it closes the old subscription and re-subscribes to the currently-held coins), so coins opened by a rebalance become monitored.
- **Daemon cadence:** the daily cycle is idempotent per UTC day, so the daemon can tick it on a coarse interval (default hourly) and it no-ops until the day rolls over.

## File Structure (Phase 5)

| File | Responsibility |
|---|---|
| `src/config.ts` (modify) | `minUniverseForRebalance` + risk/threshold env overrides |
| `src/config.test.ts` (modify) | cover the new env overrides |
| `src/runner/runner.ts` (modify) | per-coin candle tolerance + stale-data rebalance skip |
| `src/runner/runner.test.ts` (modify) | tolerance + skip tests |
| `src/runner/daemon.ts` | `Daemon` — scheduled daily cycle + risk loop refresh |
| `src/runner/daemon.test.ts` | daemon tests (injected scheduler/clock) |
| `src/cli.ts` (modify) | `daemon` command |

---

### Task 1: Config — env-tunable risk + stale-data threshold

**Files:**
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`

- [ ] **Step 1: Add the failing test cases to `src/config.test.ts`**

Append inside the existing `describe("loadConfig", ...)` block:

```ts
  it("defaults minUniverseForRebalance to 6", () => {
    expect(loadConfig({}).minUniverseForRebalance).toBe(6);
  });

  it("overrides risk thresholds and the rebalance floor from env", () => {
    const cfg = loadConfig({
      SPREAD_STOP_PCT: "0.05",
      CIRCUIT_BREAKER_BAND: "0.2",
      FUNDING_ALERT_ANNUALIZED: "1",
      MIN_UNIVERSE_FOR_REBALANCE: "10",
    });
    expect(cfg.risk).toEqual({ spreadStopPct: 0.05, circuitBreakerBand: 0.2, fundingAlertAnnualized: 1 });
    expect(cfg.minUniverseForRebalance).toBe(10);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/config.test.ts`
Expected: FAIL — `minUniverseForRebalance` undefined; risk env overrides absent.

- [ ] **Step 3: Update `src/config.ts`**

Add `minUniverseForRebalance: number;` to the `Config` interface (after `dbPath`). Add `minUniverseForRebalance: 6,` to `DEFAULT_CONFIG` (after `dbPath`). Replace the `loadConfig` return with one that also overrides the risk block and the new field:

```ts
export function loadConfig(env: Record<string, string | undefined>): Config {
  return {
    ...DEFAULT_CONFIG,
    universeSize: numFromEnv(env["UNIVERSE_SIZE"], DEFAULT_CONFIG.universeSize),
    candleHistoryDays: numFromEnv(env["CANDLE_HISTORY_DAYS"], DEFAULT_CONFIG.candleHistoryDays),
    rebalanceIntervalDays: numFromEnv(env["REBALANCE_INTERVAL_DAYS"], DEFAULT_CONFIG.rebalanceIntervalDays),
    initialCapital: numFromEnv(env["INITIAL_CAPITAL"], DEFAULT_CONFIG.initialCapital),
    minUniverseForRebalance: numFromEnv(env["MIN_UNIVERSE_FOR_REBALANCE"], DEFAULT_CONFIG.minUniverseForRebalance),
    dbPath: env["DB_PATH"] ?? DEFAULT_CONFIG.dbPath,
    risk: {
      spreadStopPct: numFromEnv(env["SPREAD_STOP_PCT"], DEFAULT_CONFIG.risk.spreadStopPct),
      circuitBreakerBand: numFromEnv(env["CIRCUIT_BREAKER_BAND"], DEFAULT_CONFIG.risk.circuitBreakerBand),
      fundingAlertAnnualized: numFromEnv(env["FUNDING_ALERT_ANNUALIZED"], DEFAULT_CONFIG.risk.fundingAlertAnnualized),
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/config.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat(config): env-tunable risk thresholds + minUniverseForRebalance"
```

---

### Task 2: Runner — candle tolerance + stale-data rebalance skip

**Files:**
- Modify: `src/runner/runner.ts`
- Modify: `src/runner/runner.test.ts`

- [ ] **Step 1: Add failing tests to `src/runner/runner.test.ts`**

Append inside the `describe("runDailyCycle", ...)` block:

```ts
  it("tolerates a per-coin candle fetch failure without aborting the tick", async () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    const base = fakeData();
    const data = {
      ...base,
      async getDailyCandles(coin: string, days: number): Promise<Candle[]> {
        if (coin === "DN3") throw new Error("flaky fetch");
        return base.getDailyCandles(coin, days);
      },
    };
    const cfg: Config = { ...DEFAULT_CONFIG, universeSize: 6, candleHistoryDays: 70, rebalanceIntervalDays: 7, minUniverseForRebalance: 1 };
    const point = await runDailyCycle({ data, store, config: cfg, now: 10 * DAY });
    expect(point.timestamp).toBe(10 * DAY); // tick completed
    expect(store.getLatestSignal()!.scores.map((s) => s.coin)).not.toContain("DN3"); // excluded
    store.close();
  });

  it("skips the rebalance (keeps marking) when too few coins have usable history", async () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    // Require an impossibly high universe so the rebalance is always skipped.
    const cfg: Config = { ...DEFAULT_CONFIG, universeSize: 6, candleHistoryDays: 70, rebalanceIntervalDays: 7, minUniverseForRebalance: 999 };
    await runDailyCycle({ data: fakeData(), store, config: cfg, now: 10 * DAY });
    // No rebalance happened -> no positions opened, but an equity point was still written.
    expect(store.getAccountState()!.positions).toEqual([]);
    expect(store.getEquityCurve()).toHaveLength(1);
    expect(store.getRunnerState()!.lastRebalanceAt).toBe(0); // never rebalanced
    store.close();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runner/runner.test.ts`
Expected: FAIL — the candle loop currently rejects on a throwing coin; the stale-data test fails because a rebalance currently happens regardless of eligible count (and `lastRebalanceAt` would be set to `now`).

- [ ] **Step 3: Update `src/runner/runner.ts`**

Replace the candle loop (step "2. Candles -> closes.") with a per-coin tolerant version:

```ts
  // 2. Candles -> closes (tolerate a per-coin fetch failure).
  const closesByCoin = new Map<string, number[]>();
  for (const c of universe) {
    try {
      const candles = await data.getDailyCandles(c.name, config.candleHistoryDays);
      closesByCoin.set(c.name, closesFromCandles(candles));
    } catch {
      // skip this coin for the run; it'll be excluded from the signal
    }
  }
```

Replace the rebalance-cadence decision (step "6.") so it also requires enough usable history. The current code is:

```ts
  const shouldRebalance = !runner || runner.lastRebalanceAt === 0 || now - runner.lastRebalanceAt >= config.rebalanceIntervalDays * DAY;
  if (shouldRebalance) account.rebalance(weightsFromBook(book), prices, volumes);
```

Change it to gate on the stale-data guard (`scores.length` is the count of coins with usable history, since `buildTargetBook` only scores eligible coins):

```ts
  const dueToRebalance = !runner || runner.lastRebalanceAt === 0 || now - runner.lastRebalanceAt >= config.rebalanceIntervalDays * DAY;
  const dataFresh = scores.length >= config.minUniverseForRebalance;
  const shouldRebalance = dueToRebalance && dataFresh;
  if (shouldRebalance) account.rebalance(weightsFromBook(book), prices, volumes);
```

The rest (funding, mark, atomic persist with `lastRebalanceAt: shouldRebalance ? now : (runner?.lastRebalanceAt ?? now)`) is unchanged — on a skipped rebalance, `lastRebalanceAt` correctly stays at its prior value (or `now` only on the first-ever tick where `runner` is null; note the first-tick-with-stale-data case keeps `lastRebalanceAt` at the `?? now` fallback `now`, which is acceptable — but the test uses `minUniverseForRebalance: 999` on the first tick, so confirm: with `runner` null, `shouldRebalance` is false (dataFresh false), and the persisted `lastRebalanceAt` is `runner?.lastRebalanceAt ?? now` = `now`).

> **Implementer note — fix the persisted `lastRebalanceAt` for the skip case.** With the test asserting `lastRebalanceAt === 0` after a first-tick skip, the `?? now` fallback gives `now`, not `0`, which fails. Change the persisted value to not advance `lastRebalanceAt` when not rebalancing:
> ```ts
>   store.saveRunnerState({
>     lastMarkAt: now,
>     lastRebalanceAt: shouldRebalance ? now : (runner?.lastRebalanceAt ?? 0),
>   });
> ```
> i.e. fall back to `0` (never-rebalanced) rather than `now`. Apply this change in the persist block.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/runner/runner.test.ts`
Expected: PASS (all runner tests, old + new).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runner/runner.ts src/runner/runner.test.ts
git commit -m "feat(runner): per-coin candle tolerance + skip rebalance on stale data"
```

---

### Task 3: Daemon — scheduled daily cycle + risk-loop refresh

**Files:**
- Create: `src/runner/daemon.ts`
- Test: `src/runner/daemon.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write the failing test `src/runner/daemon.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { Daemon, type DaemonDeps } from "./daemon.js";
import { SqliteDatastore } from "../core/store/index.js";
import { DEFAULT_CONFIG, type Config } from "../config.js";
import type { MarketDataSource, AssetContext, WatchHandlers, WatchHandle, Candle, FundingPoint } from "../core/data/index.js";

const DAY = 86_400_000;

function ctx(name: string, mark: number): AssetContext {
  return { name, dayNtlVlm: 1e12, funding: 0, markPx: mark, midPx: mark, oraclePx: mark, prevDayPx: mark, openInterest: 1 };
}

function fakeData() {
  const universe = [ctx("UP1", 170), ctx("UP2", 140), ctx("MID", 104), ctx("DN1", 75), ctx("DN2", 50), ctx("DN3", 40)];
  const paths: Record<string, number[]> = { UP1: [], UP2: [], MID: [], DN1: [], DN2: [], DN3: [] };
  for (let i = 0; i < 70; i++) {
    paths["UP1"]!.push(100 + i); paths["UP2"]!.push(100 + i * 0.6); paths["MID"]!.push(100 + Math.sin(i) * 2);
    paths["DN1"]!.push(100 - i * 0.4); paths["DN2"]!.push(100 - i * 0.7); paths["DN3"]!.push(100 - i * 0.85);
  }
  const watched: string[][] = [];
  const ds: MarketDataSource = {
    async getUniverse() { return universe; },
    async getDailyCandles(coin: string, days: number): Promise<Candle[]> {
      return (paths[coin] ?? []).slice(-days).map((close, i) => ({ coin, openTime: i, closeTime: i, open: close, high: close, low: close, close, volume: 1, trades: 1 }));
    },
    async getFundingHistory(): Promise<FundingPoint[]> { return []; },
    watch(coins: string[], _h: WatchHandlers): WatchHandle { watched.push(coins); return { status: () => "connected", close: () => {} }; },
  };
  return { ds, watched };
}

function deps(store: SqliteDatastore, data: MarketDataSource, now: number): DaemonDeps {
  const config: Config = { ...DEFAULT_CONFIG, universeSize: 6, candleHistoryDays: 70, rebalanceIntervalDays: 7, minUniverseForRebalance: 1 };
  return { data, store, config, notify: { send: vi.fn(async () => {}) }, now: () => now, schedule: vi.fn() };
}

describe("Daemon", () => {
  it("runOnce runs a daily cycle and (re)subscribes the risk loop to the held coins", async () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    const { ds, watched } = fakeData();
    const daemon = new Daemon(deps(store, ds, 10 * DAY));
    await daemon.runOnce();

    // a daily cycle persisted an equity point and opened a book
    expect(store.getEquityCurve()).toHaveLength(1);
    const held = store.getAccountState()!.positions.map((p) => p.coin).sort();
    expect(held.length).toBeGreaterThan(0);
    // the risk loop subscribed to exactly the held coins
    expect(watched.at(-1)!.slice().sort()).toEqual(held);
    daemon.stop();
    store.close();
  });

  it("start schedules recurring cycles via the injected scheduler", async () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    const { ds } = fakeData();
    const d = deps(store, ds, 10 * DAY);
    const daemon = new Daemon(d);
    await daemon.start();
    expect(d.schedule).toHaveBeenCalled(); // a recurring tick was registered
    daemon.stop();
    store.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runner/daemon.test.ts`
Expected: FAIL — cannot find module `./daemon.js`.

- [ ] **Step 3: Write `src/runner/daemon.ts`**

```ts
import type { MarketDataSource } from "../core/data/index.js";
import type { Datastore } from "../core/store/index.js";
import type { Notifier } from "../core/notify/index.js";
import type { Config } from "../config.js";
import { runDailyCycle } from "./runner.js";
import { RiskLoop } from "./riskLoop.js";

export interface DaemonDeps {
  data: MarketDataSource;
  store: Datastore;
  config: Config;
  notify: Notifier;
  /** Wall clock (injected for tests). */
  now: () => number;
  /** Register a recurring callback every `ms` (injected; e.g. setInterval). */
  schedule: (fn: () => void, ms: number) => void;
}

const HOUR = 3_600_000;

/**
 * Always-on daemon: the slow clock (idempotent daily cycle on a coarse interval)
 * and the fast clock (the streaming risk loop). After each daily cycle the risk
 * loop is (re)started so coins opened by a rebalance get watched.
 */
export class Daemon {
  private readonly risk: RiskLoop;

  constructor(private readonly deps: DaemonDeps) {
    this.risk = new RiskLoop({
      data: deps.data,
      store: deps.store,
      notify: deps.notify,
      paper: deps.config.paper,
      risk: deps.config.risk,
    });
  }

  /** Run one daily cycle, then refresh the risk loop's watched coin-set. */
  async runOnce(): Promise<void> {
    await runDailyCycle({ data: this.deps.data, store: this.deps.store, config: this.deps.config, now: this.deps.now() });
    this.risk.start(); // idempotent: closes the prior subscription, re-subscribes to held coins
  }

  /** Run immediately, then schedule recurring cycles (hourly; the cycle is per-day idempotent). */
  async start(): Promise<void> {
    await this.runOnce();
    this.deps.schedule(() => { void this.runOnce().catch((err) => console.error("daemon cycle failed:", err)); }, HOUR);
  }

  stop(): void {
    this.risk.stop();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/runner/daemon.test.ts`
Expected: PASS (2 cases).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Add a `daemon` command to `src/cli.ts`**

Add the import:

```ts
import { Daemon } from "./runner/daemon.js";
```

Add a `daemon` branch (before the unknown-command `else`):

```ts
    } else if (command === "daemon") {
      const data = new HyperLiquidDataSource();
      const notify = buildNotifier(process.env);
      const daemon = new Daemon({ data, store, config, notify, now: () => Date.now(), schedule: (fn, ms) => void setInterval(fn, ms) });
      await daemon.start();
      console.log("daemon running (daily cycle + risk loop)… (ctrl-c to stop)");
      await new Promise<void>((resolve) => {
        process.on("SIGINT", () => { daemon.stop(); resolve(); });
      });
```

Update the usage string to `usage: cli.ts [run|report|watch|daemon]`.

- [ ] **Step 6: Add the `daemon` script to `package.json`**

Add to `"scripts"`:

```json
    "daemon": "tsx src/cli.ts daemon",
```

- [ ] **Step 7: Full verification**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: ALL test files PASS.

- [ ] **Step 8: Commit**

```bash
git add src/runner/daemon.ts src/runner/daemon.test.ts src/cli.ts package.json
git commit -m "feat(runner): always-on daemon (scheduled daily cycle + risk loop refresh)"
```

---

## Self-Review

**Spec coverage:**
- §10 "incomplete/stale market data on rebalance → skip the rebalance (keep existing book)" → Task 2 stale-data guard ✔
- §10 "missing candles for a coin → exclude it" → Task 2 per-coin tolerance (plus existing signal exclusion) ✔
- §9 configurable risk thresholds (operator-tunable) → Task 1 env overrides ✔
- §4 "always-on daemon: risk loop + rebalance loop + daily mark" → Task 3 `Daemon` ✔ — the slow and fast clocks running together, finally wired.
- Risk-loop watched-coin-set staleness (Phase 4b known limitation) → Task 3 (daemon restarts the loop after each cycle) ✔

**Out of scope (deferred):** live execution (§12), web dashboard (§12), Postgres adapter (§12), backtesting harness (planned as a separate phase), regime-switching (§12). Real OS-signal/daemonization concerns (pidfiles, log rotation) are out of scope; the CLI `daemon` command is a foreground process.

**Placeholder scan:** none. The one subtlety (the `lastRebalanceAt` fallback on a skipped first tick) is called out explicitly with the exact fix in Task 2.

**Type consistency:** `minUniverseForRebalance` added to `Config` (Task 1), consumed in `runDailyCycle` (Task 2). `DaemonDeps` (`data`/`store`/`config`/`notify`/`now`/`schedule`) is consistent between `daemon.ts`, its test, and the `cli.ts` construction. `Daemon` composes `runDailyCycle` and `RiskLoop` with their existing signatures. The `now: () => number` (daemon) vs `now: number` (runDailyCycle deps) distinction is handled by calling `this.deps.now()` when constructing the cycle deps.
