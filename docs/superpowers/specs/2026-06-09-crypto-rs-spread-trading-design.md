# Crypto Relative-Strength Spread Trading System — Design

**Date:** 2026-06-09
**Status:** Approved (design); pending implementation plan

## 1. Purpose

Monitor major cryptocurrencies on HyperLiquid, measure relative strength between
assets, and systematically capture relative outperformance by trading
market-neutral spreads (long the strongest, short the weakest). The system runs
as a **paper-trading** engine first — generating signals, simulating fills, and
tracking hypothetical P&L — so the strategy can be validated before any capital
is risked. Live execution on the same venue is a deliberate future extension.

## 2. Goals & Non-Goals

**Goals**
- Rank a liquidity-defined universe of HyperLiquid perps by risk-adjusted momentum.
- Construct a market-neutral long/short book (leaders vs laggards) that captures
  relative outperformance independent of overall market direction.
- Paper-trade the book with honest accounting: fees, slippage, and **perp funding**.
- Manage open-position risk in near-real-time via a streaming WebSocket watch.
- Surface activity via Telegram/Discord alerts and (later) a web dashboard.
- Persist everything for reproducibility, P&L history, and future backtesting.

**Non-Goals (v1)**
- Live order execution with real capital.
- A built web dashboard (the datastore is designed to feed one; the UI is later).
- Intraday/scalping strategies; the edge is weeks-to-months relative momentum.
- Mean-reversion / regime-switching logic (possible v2).

## 3. Key Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| End goal | Signals + paper trading |
| Relative-strength concept | Cross-sectional momentum, traded as market-neutral spreads |
| Spread bet direction | Momentum / continuation (ride relative strength) |
| Pair selection | Leaders-vs-laggards basket (long top group, short bottom group) |
| Timeframe / horizon | Position trading, weeks to months |
| Universe | Top-N HyperLiquid perps by 24h volume |
| Venue & data source | HyperLiquid (data and execution venue are the same) |
| Stack | TypeScript / Node |
| Runtime | Local-first (always-on daemon), deployable later |
| Risk management | Streaming WebSocket risk watch; conservative ~1x gross leverage |
| Output | Telegram/Discord alerts + web dashboard (later); datastore persistence |

## 4. Architecture

Single TypeScript package. An environment-agnostic **core** (pure logic) sits
behind interfaces at every I/O edge, so "local now, deploy later" requires only
new adapters, never core changes.

```
src/
  core/
    data/         MarketDataSource interface + HyperLiquid adapter
                  (universe by volume, daily candles, funding rates, WS feed)
    signal/       momentum scoring -> ranking -> target book (long/short weights)
    portfolio/    paper-trading engine: positions, fills, fees, funding, P&L
    store/        Datastore interface + SQLite impl
                  (market snapshots, signals, trades, positions, equity curve)
    notify/       Notifier interface + Telegram/Discord impls
  runner/         always-on daemon: risk loop + rebalance loop + daily mark
  config.ts       strategy params + creds (env vars)
  cli.ts          `run`, `backfill`, `report` commands
  dashboard/      (later) reads the datastore; not built in v1
```

**Interface boundaries** (`MarketDataSource`, `Datastore`, `Notifier`) keep the
signal and paper engines unaware of HyperLiquid, SQLite, or Telegram. Each module
is independently unit-testable.

### Two clocks

The runner separates two intentionally different cadences:

- **Rebalance loop** (slow, weekly): recompute the signal and reconstitute the
  book. Running this faster churns the book and bleeds the momentum edge into
  fees/funding.
- **Risk loop** (fast, streaming): holds the HyperLiquid WebSocket feed,
  evaluates risk guards on every tick, and flattens a pair the instant a stop or
  circuit-breaker trips.
- **Daily mark** (once/day): write the equity-curve point and accrue funding.

## 5. Strategy

### Momentum score (per coin)
Risk-adjusted so we don't simply buy the most volatile coin:

```
score = return_over_lookback / volatility_over_lookback
```

- Default: blend a 30-day and 60-day lookback (average of the two z-scored signals).
- Volatility = stdev of daily returns over the window.
- Computed from HyperLiquid daily candles.

### Book construction
- Rank the N-coin universe by score.
- Long the top quintile, short the bottom quintile (N=20 -> 4 longs, 4 shorts).
- Equal-weight within each side; size so long notional approx= short notional
  (dollar-neutral).
- Gross exposure capped at ~1x NAV (~0.5x long / ~0.5x short).
- Middle-ranked coins are untouched.

### Rebalance (weekly)
- Recompute scores -> new target weights -> diff against current paper positions
  -> generate the minimum set of orders to reach target.
- **Hysteresis buffer**: a coin must leave the top/bottom quintile by a margin
  before it is dropped, damping turnover from noise near the rank boundary.

## 6. Paper-Trading Accounting

The honesty of simulated P&L depends on this section.

- **Fills**: at latest HL price, minus a configurable fee (HL taker default) and a
  slippage estimate scaled to order size vs recent volume.
- **Funding**: accrued continuously on every open position from HL funding rates —
  added when paid, subtracted when paying. Non-optional for weeks-long perp holds.
- **Mark-to-market**: daily -> equity-curve point. P&L decomposed into
  price / funding / fees so the return drivers are visible.

## 7. Risk Management

Evaluated on the WebSocket risk loop, per open **pair**. Stops are on the
**combined spread**, not each leg in isolation — that is the point of trading the
ratio.

- **Spread stop**: combined unrealized loss on the pair exceeds `X%` of its
  allocated capital -> flatten the pair.
- **Per-leg circuit breaker**: a leg is halted, or gaps beyond a band vs its pair
  leg -> flatten that pair immediately (don't wait for the spread stop). This
  targets the real tail risk: idiosyncratic, single-leg, event-driven moves
  (halts, delistings, exploits, depegs).
- **Funding / liquidation alert**: funding spike or uncomfortable margin ->
  Telegram/Discord alert (not auto-close at low leverage).

Because the book is market-neutral, broad market crashes are largely hedged; the
binding risk is single-leg idiosyncratic gaps, which is why a streaming watch
(not a daily poll) is warranted.

## 8. Daily / Continuous Data Flow

1. **Fetch** — adapter pulls top-N perps by 24h volume + daily candles + funding.
2. **Persist snapshot** — raw market state saved (reproducibility, backfill).
3. **Score & rank** — momentum score per coin, ranked.
4. **Target book** — long top group, short bottom group, market-neutral weights.
5. **Rebalance** (on rebalance day) — diff target vs current -> orders. Else mark only.
6. **Simulate** — apply orders at price (+ fee/slippage), accrue funding, mark to
   market -> new equity point.
7. **Persist & notify** — write signals/trades/positions/equity; alert on
   rebalances and a daily summary.

The risk loop runs continuously alongside, independent of this cycle.

## 9. Configuration

All in `config.ts`, with sane defaults, env vars for creds:

- Universe size `N` (default 20)
- Lookback windows (default 30d + 60d blend)
- Quintile fraction (default top/bottom 20%)
- Gross exposure (default ~1x NAV: ~0.5x long / ~0.5x short)
- Rebalance interval (default weekly)
- Fee model (default HL taker ~0.045%) + slippage scaled to order size vs recent volume
- Spread-stop (default: flatten pair at 8% combined unrealized loss of allocated capital)
- Per-leg circuit-breaker band (default: leg gaps >15% vs its pair leg, or is halted)
- Funding-spike alert threshold (default: annualized funding on a leg exceeds 50%)
- Risk-loop reconnect/backoff thresholds (default: WS reconnect with exponential
  backoff capped at 30s; REST poll fallback every 15s while disconnected)
- HyperLiquid creds (read-only/info for v1); Telegram/Discord tokens

## 10. Error Handling

- **WS disconnect** -> auto-reconnect with backoff; while disconnected, fall back
  to REST polling so risk is never blind.
- **Incomplete/stale market data on rebalance** -> skip the rebalance (keep
  existing book) rather than trade on bad data.
- **Missing candles for a coin** -> exclude it from the universe for that run.
- **Idempotent runs** -> daily marks and rebalances keyed by date; running twice
  won't double-trade.
- **Notifier failures** -> logged, never fatal.

## 11. Testing (TDD)

- **Signal engine**: pure/deterministic; unit-tested against hand-computed
  fixtures (known candles -> known scores -> known book).
- **Paper engine**: known fills + funding -> known equity; P&L decomposition
  verified.
- **Risk guards**: synthetic tick sequences (spread crosses stop -> flatten fires
  exactly once; single-leg gap -> circuit breaker fires).
- **Data adapter**: tested against *recorded* HL API fixtures — no live network in
  tests.

## 12. Future Extensions (out of scope for v1)

- Live execution via HyperLiquid order API (the data adapter already models the venue).
- Web dashboard reading the datastore (Next.js / Vercel).
- Postgres datastore adapter for cloud deployment.
- Backtesting harness over persisted snapshots.
- Regime-switching (momentum vs mean-reversion) and curated sector pairs.
