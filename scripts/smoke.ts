/**
 * Live, read-only smoke test for the Phase 1 foundation.
 * Hits real HyperLiquid REST endpoints, prints what it found, and round-trips
 * a market snapshot through SQLite. No trading, no orders — just proves the
 * data adapter + store work end-to-end against the real venue.
 *
 * Run: pnpm exec tsx scripts/smoke.ts
 */
import { HyperLiquidDataSource } from "../src/core/data/index.js";
import { SqliteDatastore } from "../src/core/store/index.js";

const TOP_N = 10;

function fmt(n: number, dp = 2): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: dp });
}

async function main() {
  const ds = new HyperLiquidDataSource();

  console.log(`\nFetching top ${TOP_N} HyperLiquid perps by 24h volume...\n`);
  const universe = await ds.getUniverse(TOP_N);

  console.log("rank  coin     24h vol ($)        mark px        funding/hr");
  console.log("----  -------  -----------------  -------------  ----------");
  universe.forEach((c, i) => {
    const rank = String(i + 1).padEnd(4);
    const coin = c.name.padEnd(7);
    const vol = fmt(c.dayNtlVlm, 0).padStart(17);
    const mark = fmt(c.markPx, 4).padStart(13);
    const funding = `${(c.funding * 100).toFixed(4)}%`.padStart(10);
    console.log(`${rank}  ${coin}  ${vol}  ${mark}  ${funding}`);
  });

  // Pull daily candles for the top two coins to prove the candle path works.
  const sample = universe.slice(0, 2).map((c) => c.name);
  console.log(`\nDaily candles (last 30d) for ${sample.join(", ")}:`);
  for (const coin of sample) {
    const candles = await ds.getDailyCandles(coin, 30);
    if (candles.length === 0) {
      console.log(`  ${coin}: no candles returned`);
      continue;
    }
    const first = candles[0]!;
    const last = candles[candles.length - 1]!;
    const pct = ((last.close - first.close) / first.close) * 100;
    console.log(
      `  ${coin.padEnd(6)} ${candles.length} candles | ` +
        `first close ${fmt(first.close, 2)} -> last close ${fmt(last.close, 2)} ` +
        `(${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% over window) [raw, not a signal]`,
    );
  }

  // Persist a snapshot, then read it straight back to prove the store works.
  const dbPath = "scripts/smoke.sqlite";
  const store = new SqliteDatastore(dbPath);
  store.init();
  const capturedAt = universe.length > 0 ? Date.parse("2026-06-09T00:00:00Z") : 0;
  store.saveMarketSnapshot({ capturedAt, universe });
  const back = store.getLatestSnapshot();
  store.close();

  console.log(
    `\nPersisted snapshot of ${universe.length} coins to ${dbPath}, ` +
      `read back ${back?.universe.length ?? 0} coins. ` +
      `Round-trip ${back?.universe.length === universe.length ? "OK" : "MISMATCH"}.`,
  );
  console.log("\nFoundation smoke test complete.\n");
}

main().catch((err) => {
  console.error("\nSmoke test FAILED:", err);
  process.exit(1);
});
