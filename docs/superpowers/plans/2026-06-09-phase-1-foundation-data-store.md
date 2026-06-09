# Phase 1: Foundation + Data Adapter + Store — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the TypeScript project and the bottom layer of the crypto RS spread system — a `MarketDataSource` that fetches HyperLiquid market data over raw REST/WS, and a `Datastore` (SQLite) that persists market snapshots — both fully unit-tested against recorded fixtures with no live network.

**Architecture:** A single TypeScript package with an environment-agnostic `core`. This phase builds `core/data` (`MarketDataSource` interface + HyperLiquid adapter: universe-by-volume, daily candles, funding history, and a reconnecting WS feed) and `core/store` (`Datastore` interface + SQLite impl for market snapshots). Everything sits behind interfaces so later phases (signal, paper, runner) never import HyperLiquid, `ws`, or `better-sqlite3`. The HL adapter takes injectable `fetchFn` and `wsFactory` so tests drive it with recorded JSON and a fake socket — no network, deterministic.

**Tech Stack:** TypeScript (ESM), pnpm, Vitest, tsx, `ws` (WebSocket client), `better-sqlite3`. Node 22+.

---

## File Structure (Phase 1)

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | Project scaffold, ESM + strict TS, test runner |
| `src/core/data/types.ts` | Domain types: `PerpInfo`, `AssetContext`, `Candle`, `FundingPoint`, plus WS handler/handle types |
| `src/core/data/MarketDataSource.ts` | The `MarketDataSource` interface — the only thing later phases depend on |
| `src/core/data/hyperliquid/http.ts` | Tiny POST-to-`/info` helper + numeric parsing utilities |
| `src/core/data/hyperliquid/parse.ts` | Pure functions: raw HL JSON → domain types (universe, candles, funding, ctx) |
| `src/core/data/hyperliquid/ws.ts` | Reconnecting WS client with exponential backoff + ping keepalive |
| `src/core/data/hyperliquid/HyperLiquidDataSource.ts` | `MarketDataSource` impl wiring http + parse + ws together |
| `src/core/data/__fixtures__/*.json` | Recorded HL API responses for deterministic tests |
| `src/core/store/Datastore.ts` | The `Datastore` interface + `MarketSnapshot` type |
| `src/core/store/sqlite/schema.ts` | SQL DDL + migration runner |
| `src/core/store/sqlite/SqliteDatastore.ts` | `Datastore` impl over `better-sqlite3` |

Tests live next to their subjects as `*.test.ts`.

> **HL API reference (for fixtures).** All REST calls are `POST https://api.hyperliquid.xyz/info` with a JSON body. WS is `wss://api.hyperliquid.xyz/ws`. Response shapes used below are modeled on HL's documented `info` and `subscriptions` APIs. Treat the fixtures in this plan as representative; if a field name differs when you first hit the live API, update the fixture **and** the parser together (the parser is the single translation point).

---

### Task 0: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Modify: `.gitignore`
- Create: `src/index.ts` (placeholder so `tsc` has something)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "crypto-markets",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.0",
    "@types/ws": "^8.5.13",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create `src/index.ts` placeholder**

```ts
export const VERSION = "0.1.0";
```

- [ ] **Step 5: Update `.gitignore`**

Append these lines to the existing `.gitignore`:

```
node_modules/
dist/
*.sqlite
*.sqlite-journal
.env
```

- [ ] **Step 6: Install and verify the toolchain**

Run: `pnpm install`
Expected: installs without error; `pnpm-lock.yaml` created.

Run: `pnpm test`
Expected: Vitest runs and reports "No test files found" (exit 0 is fine; there are no tests yet).

Run: `pnpm typecheck`
Expected: PASS, no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts src/index.ts .gitignore
git commit -m "chore: scaffold TypeScript project (pnpm, vitest, tsx)"
```

---

### Task 1: Domain types

**Files:**
- Create: `src/core/data/types.ts`

No test — these are type declarations only. They are exercised by every later task.

- [ ] **Step 1: Write `src/core/data/types.ts`**

```ts
/** Static per-perp metadata from HL `meta.universe`. */
export interface PerpInfo {
  name: string;
  szDecimals: number;
  maxLeverage: number;
}

/**
 * Live context for one perp. Numbers are parsed from HL's string fields.
 * `dayNtlVlm` is 24h notional (USD) volume — our universe ranking key.
 * `funding` is the current hourly funding rate (e.g. 0.0000125 = 0.00125%/hr).
 */
export interface AssetContext {
  name: string;
  dayNtlVlm: number;
  funding: number;
  markPx: number;
  midPx: number | null;
  oraclePx: number;
  prevDayPx: number;
  openInterest: number;
}

/** One daily OHLCV candle. Times are epoch ms. */
export interface Candle {
  coin: string;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

/** One funding observation. `rate` is the hourly rate; `time` is epoch ms. */
export interface FundingPoint {
  coin: string;
  rate: number;
  time: number;
}

/** Connection lifecycle states surfaced by the WS feed. */
export type WatchStatus = "connecting" | "connected" | "reconnecting" | "closed";

/** Callbacks the risk loop (a later phase) registers on the WS feed. */
export interface WatchHandlers {
  onCtx: (ctx: AssetContext) => void;
  onStatus?: (status: WatchStatus) => void;
  onError?: (err: Error) => void;
}

/** Control handle returned by `MarketDataSource.watch`. */
export interface WatchHandle {
  status: () => WatchStatus;
  close: () => void;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/core/data/types.ts
git commit -m "feat(data): add core market-data domain types"
```

---

### Task 2: MarketDataSource interface

**Files:**
- Create: `src/core/data/MarketDataSource.ts`

- [ ] **Step 1: Write `src/core/data/MarketDataSource.ts`**

```ts
import type {
  AssetContext,
  Candle,
  FundingPoint,
  WatchHandlers,
  WatchHandle,
} from "./types.js";

/**
 * The only data abstraction the rest of the system depends on. Implementations
 * (HyperLiquid now, others later) live behind this; signal/paper/runner code
 * never imports a venue SDK or `ws`.
 */
export interface MarketDataSource {
  /** Top `topN` perps by 24h notional volume, already sorted desc. */
  getUniverse(topN: number): Promise<AssetContext[]>;

  /** Most recent `days` daily candles for `coin`, oldest-first. */
  getDailyCandles(coin: string, days: number): Promise<Candle[]>;

  /** Funding observations for `coin` at/after `sinceMs`, oldest-first. */
  getFundingHistory(coin: string, sinceMs: number): Promise<FundingPoint[]>;

  /** Open a streaming feed of asset-context updates for `coins`. */
  watch(coins: string[], handlers: WatchHandlers): WatchHandle;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/core/data/MarketDataSource.ts
git commit -m "feat(data): define MarketDataSource interface"
```

---

### Task 3: HTTP helper + numeric parsing

**Files:**
- Create: `src/core/data/hyperliquid/http.ts`
- Test: `src/core/data/hyperliquid/http.test.ts`

HL returns numbers as strings. We need one strict parser that fails loudly on garbage, and one POST helper that accepts an injectable `fetch`.

- [ ] **Step 1: Write the failing test `src/core/data/hyperliquid/http.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { num, postInfo } from "./http.js";

describe("num", () => {
  it("parses numeric strings", () => {
    expect(num("65000.5")).toBe(65000.5);
    expect(num("0")).toBe(0);
  });
  it("throws on non-numeric input", () => {
    expect(() => num("abc")).toThrow(/not a number/);
    expect(() => num(undefined)).toThrow(/not a number/);
  });
});

describe("postInfo", () => {
  it("POSTs the body as JSON to <baseUrl>/info and returns parsed JSON", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const out = await postInfo({ baseUrl: "https://x", fetchFn }, { type: "meta" });

    expect(out).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledWith("https://x/info", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "meta" }),
    });
  });

  it("throws on non-2xx", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(
      postInfo({ baseUrl: "https://x", fetchFn }, { type: "meta" }),
    ).rejects.toThrow(/HL info 500/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/data/hyperliquid/http.test.ts`
Expected: FAIL — cannot find module `./http.js`.

- [ ] **Step 3: Write `src/core/data/hyperliquid/http.ts`**

```ts
export type FetchFn = typeof fetch;

export interface HttpConfig {
  baseUrl: string;
  fetchFn: FetchFn;
}

/** Strictly parse an HL string-number; throw on anything non-finite. */
export function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (typeof v !== "number" && (v === undefined || v === null || v === "")) {
    throw new Error(`not a number: ${String(v)}`);
  }
  if (!Number.isFinite(n)) throw new Error(`not a number: ${String(v)}`);
  return n;
}

/** POST a request body to the HL `/info` endpoint and return parsed JSON. */
export async function postInfo<T = unknown>(
  cfg: HttpConfig,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await cfg.fetchFn(`${cfg.baseUrl}/info`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HL info ${res.status}`);
  return (await res.json()) as T;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/data/hyperliquid/http.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/core/data/hyperliquid/http.ts src/core/data/hyperliquid/http.test.ts
git commit -m "feat(data): add HL HTTP helper and strict numeric parser"
```

---

### Task 4: Parse `metaAndAssetCtxs` → universe

**Files:**
- Create: `src/core/data/hyperliquid/parse.ts`
- Create: `src/core/data/__fixtures__/metaAndAssetCtxs.json`
- Test: `src/core/data/hyperliquid/parse.universe.test.ts`

`POST /info {"type":"metaAndAssetCtxs"}` returns `[ {universe:[PerpInfo...]}, [ctx...] ]` where the two inner arrays are parallel (index-aligned).

- [ ] **Step 1: Create the fixture `src/core/data/__fixtures__/metaAndAssetCtxs.json`**

```json
[
  {
    "universe": [
      { "name": "BTC", "szDecimals": 5, "maxLeverage": 50 },
      { "name": "ETH", "szDecimals": 4, "maxLeverage": 50 },
      { "name": "SOL", "szDecimals": 2, "maxLeverage": 20 }
    ]
  },
  [
    { "dayNtlVlm": "1000000.0", "funding": "0.0000125", "markPx": "65000.0", "midPx": "65001.0", "oraclePx": "64999.0", "prevDayPx": "64000.0", "openInterest": "120.0" },
    { "dayNtlVlm": "3000000.0", "funding": "0.0000100", "markPx": "3500.0", "midPx": "3500.5", "oraclePx": "3499.0", "prevDayPx": "3400.0", "openInterest": "900.0" },
    { "dayNtlVlm": "2000000.0", "funding": "-0.0000050", "markPx": "150.0", "midPx": null, "oraclePx": "149.5", "prevDayPx": "145.0", "openInterest": "5000.0" }
  ]
]
```

- [ ] **Step 2: Write the failing test `src/core/data/hyperliquid/parse.universe.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseUniverse } from "./parse.js";
import raw from "../__fixtures__/metaAndAssetCtxs.json" with { type: "json" };

describe("parseUniverse", () => {
  it("zips universe with contexts and sorts desc by volume, capped at topN", () => {
    const out = parseUniverse(raw as unknown, 2);
    expect(out.map((c) => c.name)).toEqual(["ETH", "BTC"]);
    expect(out[0]).toMatchObject({ name: "ETH", dayNtlVlm: 3_000_000, funding: 0.00001 });
  });

  it("parses every field including a null midPx", () => {
    const all = parseUniverse(raw as unknown, 10);
    const sol = all.find((c) => c.name === "SOL")!;
    expect(sol).toEqual({
      name: "SOL",
      dayNtlVlm: 2_000_000,
      funding: -0.000005,
      markPx: 150,
      midPx: null,
      oraclePx: 149.5,
      prevDayPx: 145,
      openInterest: 5000,
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/core/data/hyperliquid/parse.universe.test.ts`
Expected: FAIL — `parseUniverse` is not exported from `./parse.js`.

- [ ] **Step 4: Write `src/core/data/hyperliquid/parse.ts`**

```ts
import { num } from "./http.js";
import type { AssetContext } from "../types.js";

interface RawPerpInfo { name: string; szDecimals: number; maxLeverage: number }
interface RawCtx {
  dayNtlVlm: string;
  funding: string;
  markPx: string;
  midPx: string | null;
  oraclePx: string;
  prevDayPx: string;
  openInterest: string;
}

function toCtx(info: RawPerpInfo, ctx: RawCtx): AssetContext {
  return {
    name: info.name,
    dayNtlVlm: num(ctx.dayNtlVlm),
    funding: num(ctx.funding),
    markPx: num(ctx.markPx),
    midPx: ctx.midPx === null ? null : num(ctx.midPx),
    oraclePx: num(ctx.oraclePx),
    prevDayPx: num(ctx.prevDayPx),
    openInterest: num(ctx.openInterest),
  };
}

/** Parse `metaAndAssetCtxs`, returning top `topN` perps sorted desc by 24h volume. */
export function parseUniverse(raw: unknown, topN: number): AssetContext[] {
  const [meta, ctxs] = raw as [{ universe: RawPerpInfo[] }, RawCtx[]];
  const out = meta.universe.map((info, i) => toCtx(info, ctxs[i]!));
  out.sort((a, b) => b.dayNtlVlm - a.dayNtlVlm);
  return out.slice(0, topN);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/core/data/hyperliquid/parse.universe.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/data/hyperliquid/parse.ts src/core/data/hyperliquid/parse.universe.test.ts src/core/data/__fixtures__/metaAndAssetCtxs.json
git commit -m "feat(data): parse HL metaAndAssetCtxs into ranked universe"
```

---

### Task 5: Parse `candleSnapshot` → candles

**Files:**
- Modify: `src/core/data/hyperliquid/parse.ts`
- Create: `src/core/data/__fixtures__/candleSnapshot.json`
- Test: `src/core/data/hyperliquid/parse.candles.test.ts`

`POST /info {"type":"candleSnapshot","req":{...}}` returns an array of candle objects with fields `t` (open ms), `T` (close ms), `s` (symbol), `o/h/l/c` (prices), `v` (volume), `n` (trade count).

- [ ] **Step 1: Create the fixture `src/core/data/__fixtures__/candleSnapshot.json`**

```json
[
  { "t": 1717200000000, "T": 1717286399999, "s": "BTC", "i": "1d", "o": "64000.0", "c": "65000.0", "h": "66000.0", "l": "63500.0", "v": "1234.5", "n": 9001 },
  { "t": 1717286400000, "T": 1717372799999, "s": "BTC", "i": "1d", "o": "65000.0", "c": "64200.0", "h": "65500.0", "l": "63900.0", "v": "1100.0", "n": 8000 }
]
```

- [ ] **Step 2: Write the failing test `src/core/data/hyperliquid/parse.candles.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseCandles } from "./parse.js";
import raw from "../__fixtures__/candleSnapshot.json" with { type: "json" };

describe("parseCandles", () => {
  it("maps HL candle fields to domain Candle, preserving order", () => {
    const out = parseCandles(raw as unknown);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      coin: "BTC",
      openTime: 1717200000000,
      closeTime: 1717286399999,
      open: 64000,
      high: 66000,
      low: 63500,
      close: 65000,
      volume: 1234.5,
      trades: 9001,
    });
    expect(out[1].close).toBe(64200);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/core/data/hyperliquid/parse.candles.test.ts`
Expected: FAIL — `parseCandles` not exported.

- [ ] **Step 4: Add `parseCandles` to `src/core/data/hyperliquid/parse.ts`**

Add this import line to the existing `types.js` import (change it to):

```ts
import type { AssetContext, Candle } from "../types.js";
```

Append to the file:

```ts
interface RawCandle {
  t: number; T: number; s: string;
  o: string; h: string; l: string; c: string; v: string; n: number;
}

/** Parse a `candleSnapshot` response, oldest-first (as HL returns it). */
export function parseCandles(raw: unknown): Candle[] {
  return (raw as RawCandle[]).map((k) => ({
    coin: k.s,
    openTime: k.t,
    closeTime: k.T,
    open: num(k.o),
    high: num(k.h),
    low: num(k.l),
    close: num(k.c),
    volume: num(k.v),
    trades: k.n,
  }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/core/data/hyperliquid/parse.candles.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/data/hyperliquid/parse.ts src/core/data/hyperliquid/parse.candles.test.ts src/core/data/__fixtures__/candleSnapshot.json
git commit -m "feat(data): parse HL candleSnapshot into daily candles"
```

---

### Task 6: Parse `fundingHistory` → funding points

**Files:**
- Modify: `src/core/data/hyperliquid/parse.ts`
- Create: `src/core/data/__fixtures__/fundingHistory.json`
- Test: `src/core/data/hyperliquid/parse.funding.test.ts`

`POST /info {"type":"fundingHistory","coin":"BTC","startTime":...}` returns `[ {coin, fundingRate, premium, time}, ... ]`.

- [ ] **Step 1: Create the fixture `src/core/data/__fixtures__/fundingHistory.json`**

```json
[
  { "coin": "BTC", "fundingRate": "0.0000125", "premium": "0.0001", "time": 1717200000000 },
  { "coin": "BTC", "fundingRate": "-0.0000030", "premium": "-0.00002", "time": 1717203600000 }
]
```

- [ ] **Step 2: Write the failing test `src/core/data/hyperliquid/parse.funding.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseFunding } from "./parse.js";
import raw from "../__fixtures__/fundingHistory.json" with { type: "json" };

describe("parseFunding", () => {
  it("maps to FundingPoint, preserving order and sign", () => {
    const out = parseFunding(raw as unknown);
    expect(out).toEqual([
      { coin: "BTC", rate: 0.0000125, time: 1717200000000 },
      { coin: "BTC", rate: -0.000003, time: 1717203600000 },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/core/data/hyperliquid/parse.funding.test.ts`
Expected: FAIL — `parseFunding` not exported.

- [ ] **Step 4: Add `parseFunding` to `src/core/data/hyperliquid/parse.ts`**

Change the `types.js` import to include `FundingPoint`:

```ts
import type { AssetContext, Candle, FundingPoint } from "../types.js";
```

Append to the file:

```ts
interface RawFunding { coin: string; fundingRate: string; premium: string; time: number }

/** Parse a `fundingHistory` response into FundingPoints, oldest-first. */
export function parseFunding(raw: unknown): FundingPoint[] {
  return (raw as RawFunding[]).map((f) => ({
    coin: f.coin,
    rate: num(f.fundingRate),
    time: f.time,
  }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/core/data/hyperliquid/parse.funding.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/data/hyperliquid/parse.ts src/core/data/hyperliquid/parse.funding.test.ts src/core/data/__fixtures__/fundingHistory.json
git commit -m "feat(data): parse HL fundingHistory into funding points"
```

---

### Task 7: Parse a WS `activeAssetCtx` message → AssetContext

**Files:**
- Modify: `src/core/data/hyperliquid/parse.ts`
- Test: `src/core/data/hyperliquid/parse.wsctx.test.ts`

WS pushes `{"channel":"activeAssetCtx","data":{"coin":"BTC","ctx":{...}}}`. The `ctx` shape matches the REST ctx minus `name`. We need a parser the WS client calls per message.

- [ ] **Step 1: Write the failing test `src/core/data/hyperliquid/parse.wsctx.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseWsCtx } from "./parse.js";

const msg = {
  channel: "activeAssetCtx",
  data: {
    coin: "BTC",
    ctx: {
      dayNtlVlm: "1000000.0",
      funding: "0.0000125",
      markPx: "65000.0",
      midPx: "65001.0",
      oraclePx: "64999.0",
      prevDayPx: "64000.0",
      openInterest: "120.0",
    },
  },
};

describe("parseWsCtx", () => {
  it("returns an AssetContext for an activeAssetCtx message", () => {
    expect(parseWsCtx(msg)).toEqual({
      name: "BTC",
      dayNtlVlm: 1_000_000,
      funding: 0.0000125,
      markPx: 65000,
      midPx: 65001,
      oraclePx: 64999,
      prevDayPx: 64000,
      openInterest: 120,
    });
  });

  it("returns null for non-ctx channels (e.g. pong)", () => {
    expect(parseWsCtx({ channel: "pong" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/data/hyperliquid/parse.wsctx.test.ts`
Expected: FAIL — `parseWsCtx` not exported.

- [ ] **Step 3: Add `parseWsCtx` to `src/core/data/hyperliquid/parse.ts`**

Append to the file:

```ts
interface WsCtxMessage {
  channel: string;
  data?: { coin: string; ctx: Omit<RawCtx, never> };
}

/** Parse a WS message; return an AssetContext for `activeAssetCtx`, else null. */
export function parseWsCtx(msg: unknown): AssetContext | null {
  const m = msg as WsCtxMessage;
  if (m.channel !== "activeAssetCtx" || !m.data) return null;
  const c = m.data.ctx;
  return {
    name: m.data.coin,
    dayNtlVlm: num(c.dayNtlVlm),
    funding: num(c.funding),
    markPx: num(c.markPx),
    midPx: c.midPx === null ? null : num(c.midPx),
    oraclePx: num(c.oraclePx),
    prevDayPx: num(c.prevDayPx),
    openInterest: num(c.openInterest),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/data/hyperliquid/parse.wsctx.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/data/hyperliquid/parse.ts src/core/data/hyperliquid/parse.wsctx.test.ts
git commit -m "feat(data): parse WS activeAssetCtx messages"
```

---

### Task 8: Reconnecting WS client

**Files:**
- Create: `src/core/data/hyperliquid/ws.ts`
- Test: `src/core/data/hyperliquid/ws.test.ts`

This is the venue-robustness core (spec §9–§10): exponential backoff capped at 30s, re-subscribe on every (re)connect, ping keepalive, clean close. We inject a **socket factory** and a **scheduler** (`setTimeout`-like) so tests are deterministic with a fake socket and fake timers — no real network, no real clock.

- [ ] **Step 1: Write the failing test `src/core/data/hyperliquid/ws.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { ReconnectingWs } from "./ws.js";
import type { SocketLike, SocketFactory } from "./ws.js";

/** Minimal fake socket we can drive from tests. */
class FakeSocket implements SocketLike {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: Error) => void) | null = null;
  closed = false;
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; this.onclose?.(); }
  fireOpen() { this.onopen?.(); }
  fireMessage(obj: unknown) { this.onmessage?.(JSON.stringify(obj)); }
  fireClose() { this.onclose?.(); }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const factory: SocketFactory = () => {
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  };
  return { sockets, factory };
}

describe("ReconnectingWs", () => {
  it("subscribes to all coins on open", () => {
    const { sockets, factory } = setup();
    const ws = new ReconnectingWs({ url: "ws://x", coins: ["BTC", "ETH"], factory });
    ws.start();
    sockets[0].fireOpen();

    expect(sockets[0].sent).toEqual([
      JSON.stringify({ method: "subscribe", subscription: { type: "activeAssetCtx", coin: "BTC" } }),
      JSON.stringify({ method: "subscribe", subscription: { type: "activeAssetCtx", coin: "ETH" } }),
    ]);
  });

  it("delivers parsed messages to onMessage", () => {
    const { sockets, factory } = setup();
    const seen: unknown[] = [];
    const ws = new ReconnectingWs({ url: "ws://x", coins: ["BTC"], factory, onMessage: (m) => seen.push(m) });
    ws.start();
    sockets[0].fireOpen();
    sockets[0].fireMessage({ channel: "activeAssetCtx", data: { coin: "BTC" } });

    expect(seen).toEqual([{ channel: "activeAssetCtx", data: { coin: "BTC" } }]);
  });

  it("reconnects with exponential backoff capped at 30s", () => {
    vi.useFakeTimers();
    const { sockets, factory } = setup();
    const statuses: string[] = [];
    const ws = new ReconnectingWs({
      url: "ws://x", coins: ["BTC"], factory,
      onStatus: (s) => statuses.push(s),
    });
    ws.start();
    sockets[0].fireOpen();

    // 1st drop -> wait 1s
    sockets[0].fireClose();
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(999); expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);   expect(sockets).toHaveLength(2);

    // 2nd drop -> wait 2s
    sockets[1].fireOpen();
    sockets[1].fireClose();
    vi.advanceTimersByTime(2000); expect(sockets).toHaveLength(3);

    expect(statuses).toContain("connected");
    expect(statuses).toContain("reconnecting");
    vi.useRealTimers();
  });

  it("caps backoff at 30s", () => {
    vi.useFakeTimers();
    const { sockets, factory } = setup();
    const ws = new ReconnectingWs({ url: "ws://x", coins: ["BTC"], factory });
    ws.start();
    // Force many consecutive failures before any open.
    for (let i = 0; i < 10; i++) {
      sockets[i].fireClose();
      vi.advanceTimersByTime(30_000);
    }
    // After 10 backoffs each <=30s, we created 11 sockets (initial + 10 retries).
    expect(sockets.length).toBe(11);
    vi.useRealTimers();
  });

  it("stop() closes the socket and prevents reconnect", () => {
    vi.useFakeTimers();
    const { sockets, factory } = setup();
    const ws = new ReconnectingWs({ url: "ws://x", coins: ["BTC"], factory });
    ws.start();
    sockets[0].fireOpen();
    ws.stop();
    expect(sockets[0].closed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1); // no reconnect after stop
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/data/hyperliquid/ws.test.ts`
Expected: FAIL — cannot find module `./ws.js`.

- [ ] **Step 3: Write `src/core/data/hyperliquid/ws.ts`**

```ts
export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: (() => void) | null;
  onerror: ((err: Error) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export interface ReconnectingWsOptions {
  url: string;
  coins: string[];
  factory: SocketFactory;
  onMessage?: (msg: unknown) => void;
  onStatus?: (status: "connecting" | "connected" | "reconnecting" | "closed") => void;
  onError?: (err: Error) => void;
  /** Injectable timer for deterministic tests (defaults to setTimeout). */
  schedule?: (fn: () => void, ms: number) => void;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

/**
 * A WebSocket wrapper that re-subscribes on every connect and reconnects with
 * exponential backoff (capped). Socket and timer are injectable for testing.
 */
export class ReconnectingWs {
  private readonly o: Required<
    Pick<ReconnectingWsOptions, "url" | "coins" | "factory" | "schedule" | "baseBackoffMs" | "maxBackoffMs">
  > &
    ReconnectingWsOptions;
  private sock: SocketLike | null = null;
  private attempt = 0;
  private stopped = false;

  constructor(opts: ReconnectingWsOptions) {
    this.o = {
      schedule: (fn, ms) => void setTimeout(fn, ms),
      baseBackoffMs: 1000,
      maxBackoffMs: 30_000,
      ...opts,
    };
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.o.onStatus?.("closed");
    this.sock?.close();
    this.sock = null;
  }

  private connect(): void {
    this.o.onStatus?.(this.attempt === 0 ? "connecting" : "reconnecting");
    const s = this.o.factory(this.o.url);
    this.sock = s;

    s.onopen = () => {
      this.attempt = 0;
      this.o.onStatus?.("connected");
      for (const coin of this.o.coins) {
        s.send(JSON.stringify({ method: "subscribe", subscription: { type: "activeAssetCtx", coin } }));
      }
    };
    s.onmessage = (data) => {
      try {
        this.o.onMessage?.(JSON.parse(data));
      } catch (err) {
        this.o.onError?.(err as Error);
      }
    };
    s.onerror = (err) => this.o.onError?.(err);
    s.onclose = () => {
      if (this.stopped) return;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    const delay = Math.min(this.o.baseBackoffMs * 2 ** this.attempt, this.o.maxBackoffMs);
    this.attempt += 1;
    this.o.onStatus?.("reconnecting");
    this.o.schedule(() => {
      if (!this.stopped) this.connect();
    }, delay);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/data/hyperliquid/ws.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/data/hyperliquid/ws.ts src/core/data/hyperliquid/ws.test.ts
git commit -m "feat(data): reconnecting WS client with capped backoff"
```

---

### Task 9: HyperLiquidDataSource (wire REST + WS into the interface)

**Files:**
- Create: `src/core/data/hyperliquid/HyperLiquidDataSource.ts`
- Test: `src/core/data/hyperliquid/HyperLiquidDataSource.test.ts`

This implements `MarketDataSource`. REST methods call `postInfo` + the parsers. `watch` adapts the `ReconnectingWs` (which speaks raw messages) to `WatchHandlers` (which speak `AssetContext`) via `parseWsCtx`. A `ws`-package adapter for the real socket lives here too, but tests inject a fake factory.

- [ ] **Step 1: Write the failing test `src/core/data/hyperliquid/HyperLiquidDataSource.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { HyperLiquidDataSource } from "./HyperLiquidDataSource.js";
import type { SocketLike, SocketFactory } from "./ws.js";
import meta from "../__fixtures__/metaAndAssetCtxs.json" with { type: "json" };
import candles from "../__fixtures__/candleSnapshot.json" with { type: "json" };

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("HyperLiquidDataSource REST", () => {
  it("getUniverse returns top-N parsed contexts", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(meta));
    const ds = new HyperLiquidDataSource({ baseUrl: "https://x", fetchFn });
    const out = await ds.getUniverse(2);
    expect(out.map((c) => c.name)).toEqual(["ETH", "BTC"]);
  });

  it("getDailyCandles posts a candleSnapshot request and parses the result", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(candles));
    const ds = new HyperLiquidDataSource({ baseUrl: "https://x", fetchFn });
    const out = await ds.getDailyCandles("BTC", 2);

    expect(out).toHaveLength(2);
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.type).toBe("candleSnapshot");
    expect(body.req.coin).toBe("BTC");
    expect(body.req.interval).toBe("1d");
  });
});

describe("HyperLiquidDataSource watch", () => {
  it("delivers AssetContext updates from WS ctx messages", () => {
    let socket: any;
    const factory: SocketFactory = () => {
      socket = {
        sent: [] as string[],
        send(d: string) { this.sent.push(d); },
        close() {},
        onopen: null, onmessage: null, onclose: null, onerror: null,
      } as SocketLike & { sent: string[] };
      return socket;
    };
    const ds = new HyperLiquidDataSource({ baseUrl: "https://x", fetchFn: vi.fn(), wsFactory: factory });

    const got: string[] = [];
    const handle = ds.watch(["BTC"], { onCtx: (c) => got.push(c.name) });
    socket.onopen();
    socket.onmessage(JSON.stringify({
      channel: "activeAssetCtx",
      data: { coin: "BTC", ctx: {
        dayNtlVlm: "1", funding: "0", markPx: "1", midPx: "1",
        oraclePx: "1", prevDayPx: "1", openInterest: "1",
      } },
    }));

    expect(got).toEqual(["BTC"]);
    expect(handle.status()).toBe("connected");
    handle.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/data/hyperliquid/HyperLiquidDataSource.test.ts`
Expected: FAIL — cannot find module `./HyperLiquidDataSource.js`.

- [ ] **Step 3: Write `src/core/data/hyperliquid/HyperLiquidDataSource.ts`**

```ts
import type { MarketDataSource } from "../MarketDataSource.js";
import type { AssetContext, Candle, FundingPoint, WatchHandlers, WatchHandle, WatchStatus } from "../types.js";
import { postInfo, type FetchFn } from "./http.js";
import { parseUniverse, parseCandles, parseFunding, parseWsCtx } from "./parse.js";
import { ReconnectingWs, type SocketFactory, type SocketLike } from "./ws.js";

const ONE_DAY_MS = 86_400_000;

export interface HyperLiquidConfig {
  baseUrl?: string;
  wsUrl?: string;
  fetchFn?: FetchFn;
  /** Inject a socket factory for tests; defaults to a real `ws` adapter. */
  wsFactory?: SocketFactory;
  /** Injectable clock for `getDailyCandles` window math; defaults to Date.now. */
  now?: () => number;
}

export class HyperLiquidDataSource implements MarketDataSource {
  private readonly baseUrl: string;
  private readonly wsUrl: string;
  private readonly fetchFn: FetchFn;
  private readonly wsFactory: SocketFactory;
  private readonly now: () => number;

  constructor(cfg: HyperLiquidConfig = {}) {
    this.baseUrl = cfg.baseUrl ?? "https://api.hyperliquid.xyz";
    this.wsUrl = cfg.wsUrl ?? "wss://api.hyperliquid.xyz/ws";
    this.fetchFn = cfg.fetchFn ?? fetch;
    this.wsFactory = cfg.wsFactory ?? defaultWsFactory;
    this.now = cfg.now ?? Date.now;
  }

  async getUniverse(topN: number): Promise<AssetContext[]> {
    const raw = await postInfo({ baseUrl: this.baseUrl, fetchFn: this.fetchFn }, { type: "metaAndAssetCtxs" });
    return parseUniverse(raw, topN);
  }

  async getDailyCandles(coin: string, days: number): Promise<Candle[]> {
    const endTime = this.now();
    const startTime = endTime - days * ONE_DAY_MS;
    const raw = await postInfo(
      { baseUrl: this.baseUrl, fetchFn: this.fetchFn },
      { type: "candleSnapshot", req: { coin, interval: "1d", startTime, endTime } },
    );
    return parseCandles(raw);
  }

  async getFundingHistory(coin: string, sinceMs: number): Promise<FundingPoint[]> {
    const raw = await postInfo(
      { baseUrl: this.baseUrl, fetchFn: this.fetchFn },
      { type: "fundingHistory", coin, startTime: sinceMs },
    );
    return parseFunding(raw);
  }

  watch(coins: string[], handlers: WatchHandlers): WatchHandle {
    let status: WatchStatus = "connecting";
    const conn = new ReconnectingWs({
      url: this.wsUrl,
      coins,
      factory: this.wsFactory,
      onStatus: (s) => { status = s; handlers.onStatus?.(s); },
      onError: (e) => handlers.onError?.(e),
      onMessage: (msg) => {
        const ctx = parseWsCtx(msg);
        if (ctx) handlers.onCtx(ctx);
      },
    });
    conn.start();
    return { status: () => status, close: () => conn.stop() };
  }
}

/** Adapt the `ws` package's WebSocket to our `SocketLike` shape. */
function defaultWsFactory(url: string): SocketLike {
  // Lazy import keeps `ws` out of test paths that inject a fake factory.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const WebSocket = require("ws") as typeof import("ws").WebSocket;
  const raw = new WebSocket(url);
  const sock: SocketLike = {
    send: (d) => raw.send(d),
    close: () => raw.close(),
    onopen: null, onmessage: null, onclose: null, onerror: null,
  };
  raw.on("open", () => sock.onopen?.());
  raw.on("message", (d: Buffer) => sock.onmessage?.(d.toString()));
  raw.on("close", () => sock.onclose?.());
  raw.on("error", (e: Error) => sock.onerror?.(e));
  return sock;
}
```

> **Note on `require` in ESM:** `verbatimModuleSyntax` + ESM means `require` is not defined. Replace the lazy import with a top-level import if the lazy form trips the typechecker:
> ```ts
> import { WebSocket } from "ws";
> ```
> and move the `new WebSocket(url)` line accordingly. The lazy form is only to keep `ws` off test paths; since tests inject `wsFactory`, a top-level import is fine. **Prefer the top-level import.** Update `defaultWsFactory` to use it and delete the `require` line.

- [ ] **Step 4: Apply the ESM import note**

Edit `defaultWsFactory` to use a top-level `import { WebSocket } from "ws";` (add it to the imports at the top of the file) and remove the `require` line.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/core/data/hyperliquid/HyperLiquidDataSource.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/data/hyperliquid/HyperLiquidDataSource.ts src/core/data/hyperliquid/HyperLiquidDataSource.test.ts
git commit -m "feat(data): HyperLiquidDataSource implements MarketDataSource"
```

---

### Task 10: Datastore interface + MarketSnapshot type

**Files:**
- Create: `src/core/store/Datastore.ts`

- [ ] **Step 1: Write `src/core/store/Datastore.ts`**

```ts
import type { AssetContext } from "../data/types.js";

/** A persisted point-in-time capture of the market (for reproducibility/backfill). */
export interface MarketSnapshot {
  /** Epoch ms when this snapshot was captured. */
  capturedAt: number;
  /** The ranked universe contexts at capture time. */
  universe: AssetContext[];
}

/**
 * Persistence boundary. Phase 1 covers market snapshots only; later phases
 * extend this interface with signals/trades/positions/equity.
 */
export interface Datastore {
  /** Create tables if absent. Idempotent. */
  init(): void;
  /** Persist a market snapshot. */
  saveMarketSnapshot(snapshot: MarketSnapshot): void;
  /** Most recently captured snapshot, or null if none. */
  getLatestSnapshot(): MarketSnapshot | null;
  /** Release underlying resources. */
  close(): void;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/core/store/Datastore.ts
git commit -m "feat(store): define Datastore interface and MarketSnapshot"
```

---

### Task 11: SQLite schema + migration runner

**Files:**
- Create: `src/core/store/sqlite/schema.ts`
- Test: `src/core/store/sqlite/schema.test.ts`

Phase 1 needs one table. We store the snapshot universe as a JSON payload keyed by `captured_at` — simple, lossless, and reproducible (YAGNI: normalized per-coin rows can come later if a query needs them).

- [ ] **Step 1: Write the failing test `src/core/store/sqlite/schema.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "./schema.js";

describe("migrate", () => {
  it("creates the market_snapshots table and is idempotent", () => {
    const db = new Database(":memory:");
    migrate(db);
    migrate(db); // second run must not throw

    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='market_snapshots'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("market_snapshots");
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/store/sqlite/schema.test.ts`
Expected: FAIL — cannot find module `./schema.js`.

- [ ] **Step 3: Write `src/core/store/sqlite/schema.ts`**

```ts
import type { Database } from "better-sqlite3";

/** Create all Phase 1 tables if they do not exist. Idempotent. */
export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_snapshots (
      captured_at INTEGER PRIMARY KEY,
      payload     TEXT NOT NULL
    );
  `);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/store/sqlite/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/store/sqlite/schema.ts src/core/store/sqlite/schema.test.ts
git commit -m "feat(store): sqlite schema + idempotent migration"
```

---

### Task 12: SqliteDatastore implementation

**Files:**
- Create: `src/core/store/sqlite/SqliteDatastore.ts`
- Test: `src/core/store/sqlite/SqliteDatastore.test.ts`

- [ ] **Step 1: Write the failing test `src/core/store/sqlite/SqliteDatastore.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { SqliteDatastore } from "./SqliteDatastore.js";
import type { MarketSnapshot } from "../Datastore.js";
import type { AssetContext } from "../../data/types.js";

function ctx(name: string, vol: number): AssetContext {
  return { name, dayNtlVlm: vol, funding: 0, markPx: 1, midPx: 1, oraclePx: 1, prevDayPx: 1, openInterest: 1 };
}

describe("SqliteDatastore", () => {
  it("round-trips a market snapshot", () => {
    const store = new SqliteDatastore(":memory:");
    store.init();

    const snap: MarketSnapshot = { capturedAt: 1717200000000, universe: [ctx("ETH", 3), ctx("BTC", 1)] };
    store.saveMarketSnapshot(snap);

    expect(store.getLatestSnapshot()).toEqual(snap);
    store.close();
  });

  it("getLatestSnapshot returns null when empty", () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    expect(store.getLatestSnapshot()).toBeNull();
    store.close();
  });

  it("returns the most recent of several snapshots", () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    store.saveMarketSnapshot({ capturedAt: 100, universe: [ctx("BTC", 1)] });
    store.saveMarketSnapshot({ capturedAt: 200, universe: [ctx("ETH", 2)] });
    expect(store.getLatestSnapshot()?.capturedAt).toBe(200);
    store.close();
  });

  it("saving the same capturedAt twice overwrites (idempotent re-run)", () => {
    const store = new SqliteDatastore(":memory:");
    store.init();
    store.saveMarketSnapshot({ capturedAt: 100, universe: [ctx("BTC", 1)] });
    store.saveMarketSnapshot({ capturedAt: 100, universe: [ctx("BTC", 9)] });
    expect(store.getLatestSnapshot()?.universe[0].dayNtlVlm).toBe(9);
    store.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/store/sqlite/SqliteDatastore.test.ts`
Expected: FAIL — cannot find module `./SqliteDatastore.js`.

- [ ] **Step 3: Write `src/core/store/sqlite/SqliteDatastore.ts`**

```ts
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import type { Datastore, MarketSnapshot } from "../Datastore.js";
import { migrate } from "./schema.js";

export class SqliteDatastore implements Datastore {
  private readonly db: DB;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
  }

  init(): void {
    migrate(this.db);
  }

  saveMarketSnapshot(snapshot: MarketSnapshot): void {
    this.db
      .prepare("INSERT OR REPLACE INTO market_snapshots (captured_at, payload) VALUES (?, ?)")
      .run(snapshot.capturedAt, JSON.stringify(snapshot.universe));
  }

  getLatestSnapshot(): MarketSnapshot | null {
    const row = this.db
      .prepare("SELECT captured_at, payload FROM market_snapshots ORDER BY captured_at DESC LIMIT 1")
      .get() as { captured_at: number; payload: string } | undefined;
    if (!row) return null;
    return { capturedAt: row.captured_at, universe: JSON.parse(row.payload) };
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/store/sqlite/SqliteDatastore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/store/sqlite/SqliteDatastore.ts src/core/store/sqlite/SqliteDatastore.test.ts
git commit -m "feat(store): SqliteDatastore persists market snapshots"
```

---

### Task 13: Phase barrel exports + full green run

**Files:**
- Create: `src/core/data/index.ts`
- Create: `src/core/store/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write `src/core/data/index.ts`**

```ts
export type {
  PerpInfo, AssetContext, Candle, FundingPoint,
  WatchStatus, WatchHandlers, WatchHandle,
} from "./types.js";
export type { MarketDataSource } from "./MarketDataSource.js";
export { HyperLiquidDataSource } from "./hyperliquid/HyperLiquidDataSource.js";
export type { HyperLiquidConfig } from "./hyperliquid/HyperLiquidDataSource.js";
```

- [ ] **Step 2: Write `src/core/store/index.ts`**

```ts
export type { Datastore, MarketSnapshot } from "./Datastore.js";
export { SqliteDatastore } from "./sqlite/SqliteDatastore.js";
```

- [ ] **Step 3: Update `src/index.ts`**

```ts
export const VERSION = "0.1.0";
export * as data from "./core/data/index.js";
export * as store from "./core/store/index.js";
```

- [ ] **Step 4: Full verification**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: ALL test files PASS (http, parse×4, ws, HyperLiquidDataSource, schema, SqliteDatastore).

- [ ] **Step 5: Commit**

```bash
git add src/core/data/index.ts src/core/store/index.ts src/index.ts
git commit -m "feat: barrel exports for data and store modules"
```

---

## Self-Review

**Spec coverage (Phase 1 portions of the design doc):**
- §4 architecture `core/data` (MarketDataSource + HL adapter) → Tasks 1–9 ✔
- §4 architecture `core/store` (Datastore + SQLite, market snapshots) → Tasks 10–12 ✔
- §8 step 1 "fetch top-N by volume + candles + funding" → Tasks 4, 5, 6, 9 ✔
- §8 step 2 "persist snapshot" → Tasks 10–12 ✔
- §9 WS reconnect/backoff capped at 30s → Task 8 ✔
- §11 "data adapter tested against recorded fixtures, no live network" → Tasks 4–9 use injected `fetchFn`/`wsFactory` + JSON fixtures ✔
- §10 "missing candles → exclude" and "stale data → skip rebalance" are **runner/signal concerns** (later phases), not data-adapter — intentionally deferred.
- Signal scoring, paper engine, notify, runner, CLI → **out of scope for Phase 1** (Phases 2–4).

**Deferred to later phases (by design):** REST-poll fallback *orchestration* while WS is disconnected (spec §10) lives in the runner/risk loop (Phase 4); the WS client here exposes status transitions the runner will react to. Signals/trades/positions/equity tables extend `Datastore` in their phases when those types exist.

**Type consistency:** `AssetContext` field set is identical across `parse.ts` (`parseUniverse`, `parseWsCtx`) and the type def. `MarketDataSource` method names (`getUniverse`, `getDailyCandles`, `getFundingHistory`, `watch`) match `HyperLiquidDataSource`. `Datastore` methods (`init`, `saveMarketSnapshot`, `getLatestSnapshot`, `close`) match `SqliteDatastore`. WS option/handle names (`ReconnectingWs`, `SocketLike`, `SocketFactory`, `WatchStatus`) are consistent across `ws.ts` and `HyperLiquidDataSource.ts`.

**Placeholder scan:** none — every code step contains complete, runnable content.
