import type { Datastore } from "../core/store/index.js";
import { buildDashboardState } from "./state.js";
import type { LiveSnapshot } from "../runner/riskLoop.js";

export interface DashboardResponse {
  status: number;
  contentType: string;
  body: string;
  headers?: Record<string, string>;
}

/** Static strategy configuration surfaced to the dashboard (the "why"). */
export interface StrategyMeta {
  mode: string;
  lookbacks: number[];
  quintileFraction: number;
  grossExposure: number;
  hysteresisBuffer: number;
  rebalanceIntervalDays: number;
  volTarget: number;
  volWindow: number;
  maxLeverage: number;
}

export interface DashboardOpts {
  /** Live mark-to-market provider (the running risk loop). */
  live?: () => LiveSnapshot | null;
  /** Static strategy params (rendered in the "strategy state" panel). */
  strategy?: StrategyMeta;
  /** If set, require HTTP Basic auth matching these creds. */
  auth?: { user: string; pass: string };
  /** The request's Authorization header (for the auth check). */
  authHeader?: string;
}

const DAY = 86_400_000;

function authorized(opts: DashboardOpts): boolean {
  if (!opts.auth) return true;
  const h = opts.authHeader ?? "";
  if (!h.startsWith("Basic ")) return false;
  const [user, pass] = Buffer.from(h.slice(6), "base64").toString().split(":");
  return user === opts.auth.user && pass === opts.auth.pass;
}

/** Route a dashboard request to a JSON or HTML response (optionally live + authed). */
export function handleDashboardRequest(store: Datastore, path: string, opts: DashboardOpts = {}): DashboardResponse {
  const route = path.split("?")[0];
  if (opts.auth && !authorized(opts)) {
    return { status: 401, contentType: "text/plain", body: "auth required", headers: { "www-authenticate": 'Basic realm="crypto-markets"' } };
  }
  if (route === "/api/state") {
    const runner = store.getRunnerState();
    const rebalance = runner
      ? {
          lastRebalanceAt: runner.lastRebalanceAt,
          nextRebalanceAt: opts.strategy ? runner.lastRebalanceAt + opts.strategy.rebalanceIntervalDays * DAY : null,
        }
      : null;
    const state = {
      ...buildDashboardState(store),
      live: opts.live ? opts.live() : null,
      strategy: opts.strategy ?? null,
      rebalance,
    };
    return { status: 200, contentType: "application/json", body: JSON.stringify(state) };
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
  svg { width: 100%; height: 240px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; }
  .muted { color: #8b949e; }
  .sub { color: #8b949e; font-size: 12px; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .badge { font-size: 11px; padding: 1px 7px; border-radius: 10px; font-weight: 600; }
  .badge.long { background: rgba(63,185,80,.15); color: #3fb950; }
  .badge.short { background: rgba(248,81,73,.15); color: #f85149; }
  .badge.flat { background: #21262d; color: #8b949e; }
  tr.held td { background: rgba(110,118,129,.06); }
  .bar { height: 7px; border-radius: 3px; display: inline-block; vertical-align: middle; }
  .params { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 8px; }
  .params span { color: #8b949e; font-size: 12px; }
  .params b { color: #e6edf3; font-weight: 600; }
  h2 { font-size: 13px; color: #8b949e; font-weight: 600; margin: 18px 0 4px; text-transform: uppercase; letter-spacing: .04em; }
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

function candleChart(candles) {
  if (!candles || candles.length < 1) return '<p class="muted">no equity history yet — run a cycle.</p>';
  const W = 880, H = 240, padX = 8, padTop = 14, padBot = 22;
  const lo = Math.min(...candles.map((c) => c.low)), hi = Math.max(...candles.map((c) => c.high));
  const span = hi - lo || 1;
  const n = candles.length;
  const slot = (W - 2 * padX) / n;
  const bw = Math.max(1, Math.min(14, slot * 0.6));
  const y = (v) => padTop + (1 - (v - lo) / span) * (H - padTop - padBot);
  let svg = "";
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const cx = padX + slot * (i + 0.5);
    const up = c.close >= c.open;
    const col = up ? "#3fb950" : "#f85149";
    const yo = y(c.open), yc = y(c.close);
    const top = Math.min(yo, yc), bh = Math.max(1, Math.abs(yc - yo));
    svg += '<line x1="' + cx.toFixed(1) + '" y1="' + y(c.high).toFixed(1) + '" x2="' + cx.toFixed(1) + '" y2="' + y(c.low).toFixed(1) + '" stroke="' + col + '" stroke-width="1"/>';
    svg += '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="' + col + '"/>';
  }
  const lbl = (v, yy) => '<text x="' + (W - padX) + '" y="' + yy + '" fill="#8b949e" font-size="10" text-anchor="end">$' + fmt(v, 0) + "</text>";
  return '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none">' + svg + lbl(hi, padTop + 8) + lbl(lo, H - padBot) + "</svg>" +
    '<div class="sub" style="margin:4px 2px 0">daily NAV candles · ' + n + " day" + (n === 1 ? "" : "s") + " · green = up day, red = down</div>";
}

const annPct = (hourly) => hourly == null ? null : hourly * 24 * 365; // hourly funding → annualized

const sideBadge = (s) => '<span class="badge ' + s + '">' + s + "</span>";

function countdown(ms) {
  if (ms == null) return "—";
  if (ms <= 0) return "due (next daily cycle)";
  const h = Math.floor(ms / 3600000), days = Math.floor(h / 24);
  return days >= 1 ? days + "d " + (h % 24) + "h" : h + "h " + Math.floor((ms % 3600000) / 60000) + "m";
}

function strategyPanel(d, grossUsd, navNow) {
  const s = d.strategy;
  if (!s) return "";
  const lev = navNow ? grossUsd / navNow : 0;
  const scale = s.grossExposure ? lev / s.grossExposure : lev;
  const rb = d.rebalance || {};
  const params =
    "<span>signal <b>" + (s.mode || "momentum") + "</b></span>" +
    "<span>lookbacks <b>" + s.lookbacks.join("/") + "d</b></span>" +
    "<span>longs/shorts <b>top/bottom " + Math.round(s.quintileFraction * 100) + "%</b></span>" +
    "<span>hysteresis <b>±" + s.hysteresisBuffer + "</b></span>" +
    "<span>rebalance <b>every " + s.rebalanceIntervalDays + "d</b></span>" +
    "<span>vol target <b>" + fmt(s.volTarget * 100, 0) + "%</b> (×" + fmt(s.maxLeverage, 1) + " cap)</span>";
  const exposure = grossUsd
    ? '<div style="margin-top:10px">gross exposure <b>$' + fmt(grossUsd, 0) + "</b> · <b>" + fmt(lev * 100, 0) + "%</b> of NAV " +
      '<span class="sub">(vol-scaled ≈ ' + fmt(scale, 2) + "× of " + fmt(s.grossExposure, 0) + "× target)</span></div>"
    : "";
  const clock =
    '<div style="margin-top:8px" class="sub">last rebalance ' + (rb.lastRebalanceAt ? new Date(rb.lastRebalanceAt).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—") +
    " · next in <b style=\\"color:#e6edf3\\">" + countdown(rb.nextRebalanceAt != null ? rb.nextRebalanceAt - Date.now() : null) + "</b></div>";
  return '<div class="card"><div class="label">strategy state</div><div class="params">' + params + "</div>" + exposure + clock + "</div>";
}

function bookTable(d) {
  // Prefer live marks (current USD value); fall back to entry-based notional.
  const nav = d.live ? d.live.equity : d.latestEquity;
  const rows = (d.live ? d.live.positions : d.positions).map((p) => {
    const mark = d.live ? p.mark : null;
    const usd = d.live ? p.size * p.mark : p.notional;
    const pctNav = nav ? usd / nav : 0;
    const u = d.live ? '<td class="num ' + cls(p.unrealizedPnl) + '">' + (p.unrealizedPnl >= 0 ? "+" : "") + "$" + fmt(p.unrealizedPnl) + "</td>" : "<td></td>";
    return "<tr><td>" + sideBadge(p.side) + "</td><td><b>" + p.coin + "</b></td>" +
      '<td class="num">' + fmt(p.size, 2) + "</td>" +
      '<td class="num">$' + fmt(p.entryPrice) + "</td>" +
      '<td class="num">' + (mark != null ? "$" + fmt(mark) : "—") + "</td>" +
      '<td class="num"><b>$' + fmt(usd, 0) + "</b></td>" +
      '<td class="num">' + fmt(pctNav * 100, 1) + "%</td>" + u + "</tr>";
  }).join("");
  return d.positions.length || (d.live && d.live.positions.length)
    ? '<table><tr><th>side</th><th>coin</th><th class="num">size</th><th class="num">entry</th><th class="num">mark</th><th class="num">USD value</th><th class="num">% NAV</th><th class="num">uPnL</th></tr>' + rows + "</table>"
    : '<p class="muted">flat</p>';
}

function driversTable(d) {
  const rows = d.signalRanking || [];
  if (!rows.length) return '<p class="muted">no signal captured yet.</p>';
  const maxAbs = Math.max(1e-9, ...rows.filter((r) => r.score != null).map((r) => Math.abs(r.score)));
  return '<table><tr><th class="num">#</th><th>coin</th><th>held</th><th>momentum score</th><th class="num">funding (ann.)</th></tr>' +
    rows.map((r, i) => {
      const badge = r.held ? sideBadge(r.held) : '<span class="badge flat">—</span>';
      const f = annPct(r.funding);
      const fc = f == null ? "—" : '<span class="' + cls(-f) + '">' + (f >= 0 ? "+" : "") + fmt(f * 100, 1) + "%</span>";
      let rank, scoreCell;
      if (r.score == null) {
        // Held leg that has dropped out of the ranked universe — exits next rebalance.
        rank = '<span class="sub">—</span>';
        scoreCell = '<span class="sub">⚠ left universe · exits next rebalance</span>';
      } else {
        rank = String(i + 1);
        const w = Math.round((Math.abs(r.score) / maxAbs) * 90);
        const col = r.score >= 0 ? "#3fb950" : "#f85149";
        scoreCell = '<span class="bar" style="width:' + w + "px;background:" + col + '"></span> ' + fmt(r.score, 2);
      }
      return '<tr class="' + (r.held ? "held" : "") + '"><td class="num sub">' + rank + "</td><td><b>" + r.coin + "</b></td><td>" + badge + "</td><td>" + scoreCell + '</td><td class="num">' + fc + "</td></tr>";
    }).join("") + "</table>" +
    '<div class="sub" style="margin-top:6px">longs = strongest risk-adjusted momentum, shorts = weakest. funding shown as cost to the held side (red = we pay).</div>';
}

async function load() {
  const d = await (await fetch("/api/state")).json();
  const m = d.metrics;
  const pnl = d.pnl || { price: 0, funding: 0, fees: 0 };
  const grossUsd = d.live ? d.live.positions.reduce((s, p) => s + Math.abs(p.size) * p.mark, 0) : d.grossAtEntry;
  const navNow = d.live ? d.live.equity : d.latestEquity;
  const cards = [
    ["equity", "$" + fmt(navNow)],
    ["total return", '<span class="' + cls(d.totalReturn) + '">' + pct(d.totalReturn) + "</span>"],
    ["Sharpe", fmt(m.sharpe)],
    ["max drawdown", pct(-m.maxDrawdown)],
    ["price P&L", '<span class="' + cls(pnl.price) + '">$' + fmt(pnl.price) + "</span>"],
    ["funding P&L", '<span class="' + cls(pnl.funding) + '">$' + fmt(pnl.funding) + "</span>"],
    ["fees", "$" + fmt(pnl.fees)],
  ];
  const tradeRows = (d.recentTrades || []).map((t) => "<tr><td>" + new Date(t.timestamp).toISOString().slice(0, 10) + "</td><td>" + (t.side === "buy" ? '<span class="pos">buy</span>' : '<span class="neg">sell</span>') + "</td><td>" + t.coin + "</td><td class=\\"num\\">" + fmt(t.size, 2) + "</td><td class=\\"num\\">$" + fmt(t.fillPrice) + "</td><td class=\\"num\\">$" + fmt(t.fee) + "</td></tr>").join("");
  let liveBlock = "";
  if (d.live) {
    const uTot = d.live.positions.reduce((s, p) => s + p.unrealizedPnl, 0);
    liveBlock =
      '<div class="card" style="border-color:#3fb950"><div class="label">live NAV <span style="color:#3fb950">● ' + d.live.feed + '</span> · ' + new Date(d.live.asOf).toLocaleTimeString() + '</div>' +
      '<div class="val">$' + fmt(d.live.equity) + '  <span class="' + cls(uTot) + '" style="font-size:14px">(' + (uTot >= 0 ? "+" : "") + '$' + fmt(uTot) + ' unrealized)</span></div></div>';
  }
  document.getElementById("app").innerHTML =
    liveBlock +
    candleChart(d.candles) +
    '<div class="grid">' + cards.map((c) => '<div class="card"><div class="label">' + c[0] + '</div><div class="val">' + c[1] + "</div></div>").join("") + "</div>" +
    strategyPanel(d, grossUsd, navNow) +
    '<h2>current book</h2><div class="card">' + bookTable(d) + "</div>" +
    '<h2>what\\'s driving it — ranked signal</h2><div class="card">' + driversTable(d) + "</div>" +
    '<h2>recent trades</h2><div class="card">' + ((d.recentTrades && d.recentTrades.length) ? '<table><tr><th>date</th><th>side</th><th>coin</th><th class="num">size</th><th class="num">fill</th><th class="num">fee</th></tr>' + tradeRows + "</table>" : '<p class="muted">none yet</p>') + "</div>";
}
load().catch((e) => { document.getElementById("app").textContent = "error: " + e.message; });
setInterval(() => load().catch(() => {}), 5000);
</script>
</body>
</html>`;
