import { loadConfig } from "./config.js";
import { SqliteDatastore } from "./core/store/index.js";
import { HyperLiquidDataSource } from "./core/data/index.js";
import { runDailyCycle } from "./runner/runner.js";
import { formatReport } from "./runner/report.js";
import { RiskLoop } from "./runner/riskLoop.js";
import { Daemon } from "./runner/daemon.js";
import { runBacktest, bucketFundingByDay } from "./core/backtest/index.js";
import { startDashboardServer } from "./dashboard/index.js";
import { ConsoleNotifier, MultiNotifier, TelegramNotifier, type Notifier } from "./core/notify/index.js";

/** Page through HL funding history (500-point cap) until the window is covered. */
async function fetchFundingFull(
  data: HyperLiquidDataSource,
  coin: string,
  since: number,
  until: number,
): Promise<import("./core/data/index.js").FundingPoint[]> {
  const all: import("./core/data/index.js").FundingPoint[] = [];
  let cursor = since;
  for (let page = 0; page < 30; page++) {
    const batch = await data.getFundingHistory(coin, cursor);
    if (batch.length === 0) break;
    all.push(...batch);
    const lastTime = batch[batch.length - 1]!.time;
    if (batch.length < 500 || lastTime >= until) break;
    cursor = lastTime + 1;
  }
  return all;
}

/** Build a notifier from env: always console, plus Telegram if creds are set. */
function buildNotifier(env: Record<string, string | undefined>): Notifier {
  const notifiers: Notifier[] = [new ConsoleNotifier()];
  const token = env["TELEGRAM_BOT_TOKEN"];
  const chat = env["TELEGRAM_CHAT_ID"];
  if (token && chat) notifiers.push(new TelegramNotifier(token, chat));
  return new MultiNotifier(notifiers);
}

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
    } else if (command === "watch") {
      const data = new HyperLiquidDataSource();
      const notify = buildNotifier(process.env);
      const loop = new RiskLoop({ data, store, notify, paper: config.paper, risk: config.risk });
      loop.start();
      console.log("risk loop watching… (ctrl-c to stop)");
      await new Promise<void>((resolve) => {
        process.on("SIGINT", () => { loop.stop(); resolve(); });
      });
    } else if (command === "daemon") {
      const data = new HyperLiquidDataSource();
      const notify = buildNotifier(process.env);
      const daemon = new Daemon({ data, store, config, notify, now: () => Date.now(), schedule: (fn, ms) => void setInterval(fn, ms) });
      await daemon.start();
      console.log("daemon running (daily cycle + risk loop)… (ctrl-c to stop)");
      await new Promise<void>((resolve) => {
        process.on("SIGINT", () => { daemon.stop(); resolve(); });
      });
    } else if (command === "backtest") {
      const data = new HyperLiquidDataSource();
      const universe = await data.getUniverse(config.universeSize);
      const volumeByCoin = new Map(universe.map((c) => [c.name, c.dayNtlVlm]));

      const rawCloses = new Map<string, number[]>();
      const rawCloseTimes = new Map<string, number[]>();
      for (const c of universe) {
        try {
          const candles = await data.getDailyCandles(c.name, config.candleHistoryDays);
          if (candles.length > 0) {
            rawCloses.set(c.name, candles.map((k) => k.close));
            rawCloseTimes.set(c.name, candles.map((k) => k.closeTime));
          }
        } catch { /* skip flaky coin */ }
      }
      if (rawCloses.size === 0) {
        console.error("backtest: no candle data fetched (all coins failed) — aborting.");
        process.exitCode = 1;
        return;
      }
      const L = Math.min(...[...rawCloses.values()].map((a) => a.length));
      const coins = [...rawCloses.keys()];
      const closesByCoin = new Map(coins.map((c) => [c, rawCloses.get(c)!.slice(-L)]));
      const dayTimestamps = rawCloseTimes.get(coins[0]!)!.slice(-L);

      // HL fundingHistory caps at 500 points (~21 days), so paginate forward to
      // cover the whole window — otherwise the recent (backtested) days get none.
      const fundingByDayByCoin = new Map<string, number[]>();
      const since = dayTimestamps[0]! - 86_400_000;
      const until = dayTimestamps[L - 1]!;
      for (const c of coins) {
        try {
          fundingByDayByCoin.set(c, bucketFundingByDay(await fetchFundingFull(data, c, since, until), dayTimestamps));
        } catch { /* no funding for this coin */ }
      }

      const result = runBacktest({
        closesByCoin, volumeByCoin, dayTimestamps, fundingByDayByCoin,
        signal: config.signal, paper: config.paper,
        rebalanceEveryDays: config.rebalanceIntervalDays,
        warmupDays: Math.max(...config.signal.lookbacks) + 1,
        initialCapital: config.initialCapital,
      });

      const m = result.metrics;
      const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
      console.log("=== backtest ===");
      console.log(`days: ${result.equityCurve.length}, rebalances: ${result.rebalances}, fills: ${result.fills}`);
      console.log(`total return: ${pct(m.totalReturn)}   CAGR: ${pct(m.cagr)}`);
      console.log(`Sharpe: ${m.sharpe.toFixed(2)}   ann.vol: ${pct(m.annualizedVol)}   maxDD: ${pct(m.maxDrawdown)}`);
      console.log(`funding P&L: $${result.fundingPnl.toFixed(2)}`);
      console.log(`final book: ${result.finalPositions.map((p) => `${p.side === "long" ? "+" : "-"}${p.coin}`).join(" ")}`);
    } else if (command === "serve") {
      const port = Number(process.env["PORT"] ?? 8080);
      startDashboardServer(store, port);
      console.log(`dashboard on http://localhost:${port} … (ctrl-c to stop)`);
      await new Promise<void>((resolve) => {
        process.on("SIGINT", () => resolve());
      });
    } else {
      console.error(`unknown command: ${command}\nusage: cli.ts [run|report|watch|daemon|backtest|serve]`);
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
