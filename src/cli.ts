import { loadConfig } from "./config.js";
import { SqliteDatastore } from "./core/store/index.js";
import { HyperLiquidDataSource } from "./core/data/index.js";
import { runDailyCycle } from "./runner/runner.js";
import { formatReport } from "./runner/report.js";
import { RiskLoop } from "./runner/riskLoop.js";
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
    } else {
      console.error(`unknown command: ${command}\nusage: cli.ts [run|report|watch]`);
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
