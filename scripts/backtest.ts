/**
 * End-to-end paper-trading backtest over real HyperLiquid daily candles.
 * Wires Phase 1 (data) -> Phase 2 (signal) -> Phase 3 (paper engine):
 * walk forward day by day, rebalance weekly into the momentum target book,
 * mark to market daily, and report the simulated equity curve and P&L.
 *
 * Fees + slippage are modeled. Funding is NOT modeled here (it is implemented
 * and tested in the paper engine, but wiring historical per-coin funding is a
 * Phase 4 runner task) — so this is a price/fees/slippage backtest. Read it as
 * directional, not a final P&L.
 *
 * Run: pnpm exec tsx scripts/backtest.ts
 */
import { HyperLiquidDataSource } from "../src/core/data/index.js";
import { buildTargetBook, type SignalParams, type CurrentBook } from "../src/core/signal/index.js";
import { PaperAccount, type PaperParams } from "../src/core/paper/index.js";

const UNIVERSE_N = 12;
const HISTORY_DAYS = 150;
const REBALANCE_EVERY = 7; // days
const INITIAL_CAPITAL = 100_000;

const SIGNAL: SignalParams = { lookbacks: [30, 60], quintileFraction: 0.2, grossExposure: 1.0, hysteresisBuffer: 1 };
const PAPER: PaperParams = { feeRate: 0.00045, slippageCoeff: 0.1, maxSlippage: 0.02 };

function fmt(n: number, dp = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

async function main() {
  const ds = new HyperLiquidDataSource();

  console.log(`\nFetching top ${UNIVERSE_N} HL perps + ${HISTORY_DAYS}d of daily candles...\n`);
  const universe = await ds.getUniverse(UNIVERSE_N);
  const volumes = new Map(universe.map((c) => [c.name, c.dayNtlVlm]));

  // Fetch candles per coin and align all series to a common length from the end.
  const closesByCoinFull = new Map<string, number[]>();
  for (const c of universe) {
    const candles = await ds.getDailyCandles(c.name, HISTORY_DAYS);
    if (candles.length > 0) closesByCoinFull.set(c.name, candles.map((k) => k.close));
  }
  const L = Math.min(...[...closesByCoinFull.values()].map((a) => a.length));
  const coins = [...closesByCoinFull.keys()];
  const closes = new Map(coins.map((c) => [c, closesByCoinFull.get(c)!.slice(-L)]));
  console.log(`Aligned ${coins.length} coins to ${L} common daily closes.\n`);

  const acct = new PaperAccount(INITIAL_CAPITAL, PAPER);
  let current: CurrentBook = { longs: [], shorts: [] };
  let rebalances = 0;
  const equityCurve: { day: number; equity: number }[] = [];

  // Walk forward. Day t uses closes[0..t]; we need >= 61 closes for the 60d lookback.
  for (let t = 60; t < L; t++) {
    const pricesAtT = new Map(coins.map((c) => [c, closes.get(c)![t]!]));

    if ((t - 60) % REBALANCE_EVERY === 0) {
      const history = new Map(coins.map((c) => [c, closes.get(c)!.slice(0, t + 1)]));
      const { book } = buildTargetBook(history, SIGNAL, current);
      const weights = new Map<string, number>();
      for (const p of book.positions) weights.set(p.coin, p.side === "long" ? p.weight : -p.weight);
      acct.rebalance(weights, pricesAtT, volumes);
      current = {
        longs: book.positions.filter((p) => p.side === "long").map((p) => p.coin),
        shorts: book.positions.filter((p) => p.side === "short").map((p) => p.coin),
      };
      rebalances++;
    }

    equityCurve.push({ day: t, equity: acct.equity(pricesAtT) });
  }

  // Final mark + report.
  const lastPrices = new Map(coins.map((c) => [c, closes.get(c)![L - 1]!]));
  const point = acct.mark(lastPrices, L - 1);
  const totalReturn = (point.equity / INITIAL_CAPITAL - 1) * 100;

  let peak = -Infinity;
  let maxDD = 0;
  for (const e of equityCurve) {
    peak = Math.max(peak, e.equity);
    maxDD = Math.max(maxDD, (peak - e.equity) / peak);
  }

  console.log("=== Paper-trading backtest result ===");
  console.log(`window:        ${equityCurve.length} trading days, ${rebalances} weekly rebalances`);
  console.log(`start equity:  $${fmt(INITIAL_CAPITAL)}`);
  console.log(`final equity:  $${fmt(point.equity)}`);
  console.log(`total return:  ${totalReturn >= 0 ? "+" : ""}${fmt(totalReturn)}%`);
  console.log(`max drawdown:  ${fmt(maxDD * 100)}%`);
  console.log(`--- P&L decomposition ---`);
  console.log(`price P&L:     $${fmt(point.pricePnl)}`);
  console.log(`funding P&L:   $${fmt(point.fundingPnl)}  (not modeled in this backtest)`);
  console.log(`fees paid:     $${fmt(point.fees)}`);

  // Sparkline-ish samples of the equity curve.
  console.log(`--- equity curve (sampled) ---`);
  const step = Math.max(1, Math.floor(equityCurve.length / 10));
  for (let i = 0; i < equityCurve.length; i += step) {
    const e = equityCurve[i]!;
    console.log(`  day ${String(e.day).padStart(3)}:  $${fmt(e.equity)}`);
  }

  console.log(`\n--- final book ---`);
  for (const p of acct.positions()) {
    console.log(`  ${p.side.padEnd(5)} ${p.coin.padEnd(6)} size ${fmt(p.size, 4)} @ entry ${fmt(p.entryPrice, 2)}`);
  }
  console.log();
}

main().catch((err) => {
  console.error("\nBacktest FAILED:", err);
  process.exit(1);
});
