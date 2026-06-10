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
  const tradeRows = (d.recentTrades || []).map((t) => "<tr><td>" + new Date(t.timestamp).toISOString().slice(0, 10) + "</td><td>" + (t.side === "buy" ? '<span class="pos">buy</span>' : '<span class="neg">sell</span>') + "</td><td>" + t.coin + "</td><td>" + fmt(t.size, 4) + "</td><td>$" + fmt(t.fillPrice) + "</td><td>$" + fmt(t.fee) + "</td></tr>").join("");
  const sig = d.latestSignal ? "strongest <b>" + d.latestSignal.strongest.coin + "</b> (" + fmt(d.latestSignal.strongest.score) + "), weakest <b>" + d.latestSignal.weakest.coin + "</b> (" + fmt(d.latestSignal.weakest.score) + ")" : "—";
  document.getElementById("app").innerHTML =
    chart(d.equityCurve) +
    '<div class="grid">' + cards.map((c) => '<div class="card"><div class="label">' + c[0] + '</div><div class="val">' + c[1] + "</div></div>").join("") + "</div>" +
    '<div class="card"><div class="label">current book</div>' + (d.positions.length ? '<table><tr><th>side</th><th>coin</th><th>size</th><th>entry</th></tr>' + posRows + "</table>" : '<p class="muted">flat</p>') + "</div>" +
    '<div class="card" style="margin-top:12px"><div class="label">recent trades</div>' + ((d.recentTrades && d.recentTrades.length) ? '<table><tr><th>date</th><th>side</th><th>coin</th><th>size</th><th>fill</th><th>fee</th></tr>' + tradeRows + "</table>" : '<p class="muted">none yet</p>') + "</div>" +
    '<p class="muted" style="margin-top:16px">latest signal: ' + sig + "</p>";
}
load().catch((e) => { document.getElementById("app").textContent = "error: " + e.message; });
setInterval(load, 30000);
</script>
</body>
</html>`;
