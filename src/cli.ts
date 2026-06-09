import { loadConfig } from "./config.js";
import { SqliteDatastore } from "./core/store/index.js";
import { HyperLiquidDataSource } from "./core/data/index.js";
import { runDailyCycle } from "./runner/runner.js";
import { formatReport } from "./runner/report.js";

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
    } else {
      console.error(`unknown command: ${command}\nusage: cli.ts [run|report]`);
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
