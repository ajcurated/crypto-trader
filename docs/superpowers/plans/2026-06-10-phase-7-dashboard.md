# Phase 7: Local-First Web Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A zero-dependency, local-first web dashboard that reads the existing SQLite datastore and serves the paper-trading state — equity curve (inline SVG chart), P&L decomposition + performance metrics, current book, and the latest signal ranking — over a tiny built-in HTTP server.

**Architecture:** Three small units under `src/dashboard/`. `state.ts` (pure) aggregates the persisted store into a `DashboardState` (equity curve, metrics via the Phase 6 `equityMetrics`, positions, P&L, latest signal). `handler.ts` (pure) routes a URL path to a JSON or HTML response — `GET /api/state` → JSON, `GET /` → a self-contained HTML page that fetches the JSON and renders an inline SVG chart + tables with no external assets. `server.ts` is a thin `node:http` wrapper. A CLI `serve` command starts it. The pure state-builder and handler are fully unit-tested with an in-memory store; only the thin server is untested.

**Tech Stack:** TypeScript (ESM, strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Vitest, `node:http` (built in). **No new dependencies** — the chart is hand-rendered SVG in the browser.

---

## File Structure (Phase 7)

| File | Responsibility |
|---|---|
| `src/dashboard/state.ts` | `buildDashboardState(store)` → `DashboardState` |
| `src/dashboard/handler.ts` | `handleDashboardRequest(store, path)` + the embedded HTML page |
| `src/dashboard/server.ts` | `startDashboardServer(store, port)` (node:http) |
| `src/dashboard/index.ts` | barrel |
| `src/cli.ts` (modify) | `serve` command |

Tests next to the pure modules.

---

### Task 1: Dashboard state (`state.ts`)

**Files:**
- Create: `src/dashboard/state.ts`
- Test: `src/dashboard/state.test.ts`

- [ ] **Step 1: Write the failing test `src/dashboard/state.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildDashboardState } from "./state.js";
import { SqliteDatastore } from "../core/store/index.js";

function seeded() {
  const s = new SqliteDatastore(":memory:");
  s.init();
  s.saveEquityPoint({ timestamp: 0, equity: 100_000, pricePnl: 0, fundingPnl: 0, fees: 0 });
  s.saveEquityPoint({ timestamp: 86_400_000, equity: 104_000, pricePnl: 4_300, fundingPnl: -50, fees: 250 });
  s.saveAccountState({ initialCapital: 100_000, cash: 100_000, positions: [{ coin: "BTC", size: 1, entry: 100 }, { coin: "ETH", size: -2, entry: 50 }], realizedPricePnl: 0, feesPaid: 250, fundingPnl: -50 });
  s.saveSignal(86_400_000, [{ coin: "BTC", score: 1.5 }, { coin: "ETH", score: -0.8 }]);
  return s;
}

describe("buildDashboardState", () => {
  it("aggregates equity, metrics, positions, P&L, and the latest signal", () => {
    const s = seeded();
    const d = buildDashboardState(s);

    expect(d.equityCurve).toHaveLength(2);
    expect(d.latestEquity).toBeCloseTo(104_000, 6);
    expect(d.totalReturn).toBeCloseTo(0.04, 6);           // 104000/100000 - 1
    expect(d.metrics.maxDrawdown).toBeCloseTo(0, 6);
    expect(d.pnl).toEqual({ price: 4_300, funding: -50, fees: 250 });
    expect(d.positions.map((p) => [p.coin, p.side])).toEqual([["BTC", "long"], ["ETH", "short"]]);
    expect(d.latestSignal!.strongest.coin).toBe("BTC");
    expect(d.latestSignal!.weakest.coin).toBe("ETH");
    s.close();
  });

  it("is empty-safe on a fresh store", () => {
    const s = new SqliteDatastore(":memory:");
    s.init();
    const d = buildDashboardState(s);
    expect(d.equityCurve).toEqual([]);
    expect(d.latestEquity).toBe(0);
    expect(d.positions).toEqual([]);
    expect(d.pnl).toBeNull();
    expect(d.latestSignal).toBeNull();
    s.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/dashboard/state.test.ts`
Expected: FAIL — cannot find module `./state.js`.

- [ ] **Step 3: Write `src/dashboard/state.ts`**

```ts
import type { Datastore } from "../core/store/index.js";
import { equityMetrics, type EquityMetrics } from "../core/backtest/index.js";

export interface DashboardPosition {
  coin: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
}

export interface DashboardState {
  equityCurve: { timestamp: number; equity: number }[];
  latestEquity: number;
  totalReturn: number;
  metrics: EquityMetrics;
  pnl: { price: number; funding: number; fees: number } | null;
  positions: DashboardPosition[];
  latestSignal: { capturedAt: number; strongest: { coin: string; score: number }; weakest: { coin: string; score: number } } | null;
}

/** Aggregate the persisted paper-trading state for the dashboard. */
export function buildDashboardState(store: Datastore): DashboardState {
  const full = store.getEquityCurve();
  const equityCurve = full.map((p) => ({ timestamp: p.timestamp, equity: p.equity }));
  const first = full[0];
  const last = full[full.length - 1];
  const latestEquity = last ? last.equity : 0;
  const totalReturn = first && last && first.equity !== 0 ? last.equity / first.equity - 1 : 0;
  const metrics = equityMetrics(equityCurve);
  const pnl = last ? { price: last.pricePnl, funding: last.fundingPnl, fees: last.fees } : null;

  const account = store.getAccountState();
  const positions: DashboardPosition[] = account
    ? account.positions
        .filter((p) => p.size !== 0)
        .map((p) => ({ coin: p.coin, side: p.size > 0 ? "long" : "short", size: Math.abs(p.size), entryPrice: p.entry }))
    : [];

  const sig = store.getLatestSignal();
  const latestSignal =
    sig && sig.scores.length > 0
      ? { capturedAt: sig.capturedAt, strongest: sig.scores[0]!, weakest: sig.scores[sig.scores.length - 1]! }
      : null;

  return { equityCurve, latestEquity, totalReturn, metrics, pnl, positions, latestSignal };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/dashboard/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/state.ts src/dashboard/state.test.ts
git commit -m "feat(dashboard): aggregate persisted state for the dashboard"
```

---

### Task 2: Request handler + HTML page (`handler.ts`)

**Files:**
- Create: `src/dashboard/handler.ts`
- Test: `src/dashboard/handler.test.ts`

- [ ] **Step 1: Write the failing test `src/dashboard/handler.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { handleDashboardRequest } from "./handler.js";
import { SqliteDatastore } from "../core/store/index.js";

function store() {
  const s = new SqliteDatastore(":memory:");
  s.init();
  s.saveEquityPoint({ timestamp: 0, equity: 100_000, pricePnl: 0, fundingPnl: 0, fees: 0 });
  return s;
}

describe("handleDashboardRequest", () => {
  it("serves the dashboard state as JSON at /api/state", () => {
    const s = store();
    const res = handleDashboardRequest(s, "/api/state");
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("application/json");
    const body = JSON.parse(res.body);
    expect(body.latestEquity).toBe(100_000);
    s.close();
  });

  it("serves the HTML page at /", () => {
    const s = store();
    const res = handleDashboardRequest(s, "/");
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("text/html");
    expect(res.body).toContain("<!doctype html>");
    expect(res.body).toContain("/api/state");
    s.close();
  });

  it("404s unknown paths", () => {
    const s = store();
    const res = handleDashboardRequest(s, "/nope");
    expect(res.status).toBe(404);
    s.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/dashboard/handler.test.ts`
Expected: FAIL — cannot find module `./handler.js`.

- [ ] **Step 3: Write `src/dashboard/handler.ts`**

```ts
import type { Datastore } from "../core/store/index.js";
import { buildDashboardState } from "./state.js";

export interface DashboardResponse {
  status: number;
  contentType: string;
  body: string;
}

/** Route a dashboard request path to a JSON or HTML response. */
export function handleDashboardRequest(store: Datastore, path: string): DashboardResponse {
  const route = path.split("?")[0];
  if (route === "/api/state") {
    return { status: 200, contentType: "application/json", body: JSON.stringify(buildDashboardState(store)) };
  }
  if (route === "/" || route === "/index.html") {
    return { status: 200, contentType: "text/html", body: DASHBOARD_HTML };
  }
  return { status: 404, contentType: "text/plain", body: "not found" };
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>crypto-markets — paper trading</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: #0d1117; color: #e6edf3; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 18px; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 16px 0; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 14px; }
  .card .label { color: #8b949e; font-size: 12px; }
  .card .val { font-size: 20px; font-weight: 600; margin-top: 4px; }
  .pos { color: #3fb950; } .neg { color: #f85149; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #21262d; }
  th { color: #8b949e; font-weight: 500; }
  svg { width: 100%; height: 220px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; }
  .muted { color: #8b949e; }
</style>
</head>
<body>
<div class="wrap">
  <h1>crypto-markets · paper trading</h1>
  <div id="app" class="muted">loading…</div>
</div>
<script>
const fmt = (n, dp = 2) => Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (x) => (x >= 0 ? "+" : "") + fmt(x * 100) + "%";
const cls = (x) => (x >= 0 ? "pos" : "neg");

function chart(curve) {
  if (curve.length < 2) return '<p class="muted">no equity history yet — run a cycle.</p>';
  const W = 880, H = 220, pad = 8;
  const eq = curve.map((p) => p.equity);
  const min = Math.min(...eq), max = Math.max(...eq), span = max - min || 1;
  const x = (i) => pad + (i / (curve.length - 1)) * (W - 2 * pad);
  const y = (v) => H - pad - ((v - min) / span) * (H - 2 * pad);
  const d = curve.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.equity).toFixed(1)).join(" ");
  const up = eq[eq.length - 1] >= eq[0];
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none"><path d="' + d + '" fill="none" stroke="' + (up ? "#3fb950" : "#f85149") + '" stroke-width="2"/></svg>';
}

async function load() {
  const d = await (await fetch("/api/state")).json();
  const m = d.metrics;
  const pnl = d.pnl || { price: 0, funding: 0, fees: 0 };
  const cards = [
    ["equity", "$" + fmt(d.latestEquity)],
    ["total return", '<span class="' + cls(d.totalReturn) + '">' + pct(d.totalReturn) + "</span>"],
    ["Sharpe", fmt(m.sharpe)],
    ["max drawdown", pct(-m.maxDrawdown)],
    ["price P&L", '<span class="' + cls(pnl.price) + '">$' + fmt(pnl.price) + "</span>"],
    ["funding P&L", '<span class="' + cls(pnl.funding) + '">$' + fmt(pnl.funding) + "</span>"],
    ["fees", "$" + fmt(pnl.fees)],
  ];
  const posRows = d.positions.map((p) => "<tr><td>" + (p.side === "long" ? '<span class="pos">long</span>' : '<span class="neg">short</span>') + "</td><td>" + p.coin + "</td><td>" + fmt(p.size, 4) + "</td><td>$" + fmt(p.entryPrice) + "</td></tr>").join("");
  const sig = d.latestSignal ? "strongest <b>" + d.latestSignal.strongest.coin + "</b> (" + fmt(d.latestSignal.strongest.score) + "), weakest <b>" + d.latestSignal.weakest.coin + "</b> (" + fmt(d.latestSignal.weakest.score) + ")" : "—";
  document.getElementById("app").innerHTML =
    chart(d.equityCurve) +
    '<div class="grid">' + cards.map((c) => '<div class="card"><div class="label">' + c[0] + '</div><div class="val">' + c[1] + "</div></div>").join("") + "</div>" +
    '<div class="card"><div class="label">current book</div>' + (d.positions.length ? '<table><tr><th>side</th><th>coin</th><th>size</th><th>entry</th></tr>' + posRows + "</table>" : '<p class="muted">flat</p>') + "</div>" +
    '<p class="muted" style="margin-top:16px">latest signal: ' + sig + "</p>";
}
load().catch((e) => { document.getElementById("app").textContent = "error: " + e.message; });
setInterval(load, 30000);
</script>
</body>
</html>`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/dashboard/handler.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/handler.ts src/dashboard/handler.test.ts
git commit -m "feat(dashboard): request router + self-contained HTML page (inline SVG chart)"
```

---

### Task 3: Server + CLI `serve` (+ barrel)

**Files:**
- Create: `src/dashboard/server.ts`
- Create: `src/dashboard/index.ts`
- Modify: `src/cli.ts`
- Modify: `package.json`

- [ ] **Step 1: Write `src/dashboard/server.ts`** (thin node:http wrapper; not unit-tested)

```ts
import { createServer, type Server } from "node:http";
import type { Datastore } from "../core/store/index.js";
import { handleDashboardRequest } from "./handler.js";

/** Start a local HTTP dashboard server backed by `store`. Returns the server. */
export function startDashboardServer(store: Datastore, port: number): Server {
  const server = createServer((req, res) => {
    const { status, contentType, body } = handleDashboardRequest(store, req.url ?? "/");
    res.writeHead(status, { "content-type": contentType });
    res.end(body);
  });
  server.listen(port);
  return server;
}
```

- [ ] **Step 2: Write `src/dashboard/index.ts`**

```ts
export type { DashboardState, DashboardPosition } from "./state.js";
export { buildDashboardState } from "./state.js";
export type { DashboardResponse } from "./handler.js";
export { handleDashboardRequest } from "./handler.js";
export { startDashboardServer } from "./server.js";
```

- [ ] **Step 3: Add a `serve` command to `src/cli.ts`**

Add the import:

```ts
import { startDashboardServer } from "./dashboard/index.js";
```

Add a `serve` branch (before the unknown-command `else`):

```ts
    } else if (command === "serve") {
      const port = Number(process.env["PORT"] ?? 8080);
      startDashboardServer(store, port);
      console.log(`dashboard on http://localhost:${port} … (ctrl-c to stop)`);
      await new Promise<void>((resolve) => {
        process.on("SIGINT", () => resolve());
      });
```

Update the usage string to `usage: cli.ts [run|report|watch|daemon|backtest|serve]`.

Note: the `serve` branch keeps the store open for the server's lifetime; the `finally { store.close() }` runs on SIGINT exit. That is correct — the handler reads the store on each request.

- [ ] **Step 4: Add the `serve` script to `package.json`**

Add to `"scripts"`:

```json
    "serve": "tsx src/cli.ts serve",
```

- [ ] **Step 5: Full verification**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: ALL pass (Phases 1–6 suite + dashboard state/handler).

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/server.ts src/dashboard/index.ts src/cli.ts package.json
git commit -m "feat(dashboard): node:http server + serve CLI command"
```

---

## Self-Review

**Spec coverage:**
- §12 "Web dashboard reading the datastore" → Tasks 1–3 ✔ — delivered local-first (no Next.js/Vercel/Postgres) by serving the existing SQLite store over `node:http` with an inline-SVG chart. The spec notes the datastore "is designed to feed one"; this reads exactly that.
- §2 non-goal "a built web dashboard (UI is later)" → this is the "later" UI, kept minimal and dependency-free.

**Out of scope (deferred):** cloud deployment (needs the Postgres adapter), authentication (it's a localhost read-only view), websockets/live-push (a 30s client poll is enough for a daily-cadence strategy), historical trade-by-trade drill-down.

**Placeholder scan:** none — the HTML page is complete and self-contained; the handler/state are fully implemented.

**Type consistency:** `DashboardState`/`DashboardPosition` defined in `state.ts`, consumed by `handler.ts` (via `buildDashboardState`) and re-exported. `DashboardResponse` from `handler.ts` used by `server.ts`. `equityMetrics`/`EquityMetrics` reused from the Phase 6 `core/backtest` barrel. The store reads (`getEquityCurve`, `getAccountState`, `getLatestSignal`) match the `Datastore` interface. The CLI `serve` branch uses `startDashboardServer(store, port)` with the exported signature.
