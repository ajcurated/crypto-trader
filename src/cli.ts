import { loadConfig } from "./config.js";
import { SqliteDatastore } from "./core/store/index.js";
import { HyperLiquidDataSource } from "./core/data/index.js";
import { runDailyCycle } from "./runner/runner.js";
import { formatReport } from "./runner/report.js";
import { RiskLoop } from "./runner/riskLoop.js";
import { Daemon } from "./runner/daemon.js";
import { runBacktest, prepareBacktestData } from "./core/backtest/index.js";
import { STRATEGIES, runComparison, formatComparison } from "./runner/compare.js";
import { startDashboardServer } from "./dashboard/index.js";
import { ConsoleNotifier, MultiNotifier, TelegramNotifier, type Notifier } from "./core/notify/index.js";

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
      const prep = await prepareBacktestData(data, { universeSize: config.universeSize, candleHistoryDays: config.candleHistoryDays });
      if (prep.closesByCoin.size === 0) {
        console.error("backtest: no candle data fetched — aborting.");
        process.exitCode = 1;
        return;
      }
      const result = runBacktest({
        ...prep,
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
    } else if (command === "compare") {
      const data = new HyperLiquidDataSource();
      // Fetch a long window and keep only coins with enough history, so the
      // long-horizon strategies (90-day lookback) have runway to trade.
      const days = Number(process.env["COMPARE_DAYS"] ?? 365);
      const minHistory = Number(process.env["COMPARE_MIN_HISTORY"] ?? 150);
      console.log(`fetching up to ${days}d of history (coins with >= ${minHistory}d kept)…`);
      const prep = await prepareBacktestData(data, { universeSize: config.universeSize, candleHistoryDays: days, minHistoryDays: minHistory });
      if (prep.closesByCoin.size === 0) {
        console.error("compare: no candle data with enough history — try lowering COMPARE_MIN_HISTORY.");
        process.exitCode = 1;
        return;
      }
      const results = runComparison(prep, STRATEGIES, config);
      console.log(formatComparison(results, prep.closesByCoin.size));
    } else if (command === "serve") {
      const port = Number(process.env["PORT"] ?? 8080);
      startDashboardServer(store, port);
      console.log(`dashboard on http://localhost:${port} … (ctrl-c to stop)`);
      await new Promise<void>((resolve) => {
        process.on("SIGINT", () => resolve());
      });
    } else {
      console.error(`unknown command: ${command}\nusage: cli.ts [run|report|watch|daemon|backtest|compare|serve]`);
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
