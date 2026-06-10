# Deploying the paper-trading app

One container runs everything: the **daily cycle**, the **streaming risk loop**
(spread-stop / per-leg circuit breaker / funding alerts), and a **live web
dashboard** (real-time NAV + per-position unrealized P&L from the WS feed).

## Quick start (Docker)

```bash
docker build -t crypto-trader .

docker run -d --name trader \
  -p 8080:8080 \
  -v $HOME/trader-data:/data \              # persists the SQLite track record
  -e INITIAL_CAPITAL=100000 \
  -e DASHBOARD_USER=me -e DASHBOARD_PASS=changeme \   # basic-auth the dashboard
  -e TELEGRAM_BOT_TOKEN=... -e TELEGRAM_CHAT_ID=... \  # optional alerts
  --restart unless-stopped \
  crypto-trader
```

Open `http://YOUR_SERVER:8080` → log in with the basic-auth creds. The dashboard
refreshes every 5s and shows the live NAV/P&L when the risk feed is connected.

## docker compose

```yaml
services:
  trader:
    build: .
    ports: ["8080:8080"]
    volumes: ["./trader-data:/data"]
    environment:
      INITIAL_CAPITAL: "100000"
      DASHBOARD_USER: "me"
      DASHBOARD_PASS: "changeme"
      # TELEGRAM_BOT_TOKEN: "..."
      # TELEGRAM_CHAT_ID: "..."
    restart: unless-stopped
```

## Configuration (env vars)

| Var | Default | Meaning |
|---|---|---|
| `INITIAL_CAPITAL` | 100000 | Paper starting capital (keep constant once started) |
| `PORT` | 8080 | Dashboard port |
| `DB_PATH` | /data/crypto-markets.sqlite | SQLite file (must be on the volume) |
| `DASHBOARD_USER` / `DASHBOARD_PASS` | — | Enables HTTP basic auth (set both) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | — | Real-time stop/funding alerts |
| `UNIVERSE_SIZE` | 20 | Top-N perps by volume |
| `REBALANCE_INTERVAL_DAYS` | 7 | Rebalance cadence |
| `VOL_TARGET` | 0.25 | Annualized vol target (0 disables risk scaling) |
| `MAX_LEVERAGE` | 1.5 | Cap on vol-target exposure |
| `SPREAD_STOP_PCT` | 0.08 | Book-level flatten threshold |
| `CIRCUIT_BREAKER_BAND` | 0.15 | Per-leg flatten threshold |

## Notes

- **Always set auth** (`DASHBOARD_USER`/`DASHBOARD_PASS`) before exposing the port,
  and front it with a reverse proxy (Caddy/nginx/Cloudflare) for HTTPS.
- The container is **paper-trading only** — it never places real orders.
- It's idempotent per UTC day and resumable: restarts are safe and pick up the
  persisted state from the volume.
- Without Docker: `pnpm install && pnpm app` (needs Node 22 + pnpm).
