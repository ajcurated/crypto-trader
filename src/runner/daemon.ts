import type { MarketDataSource } from "../core/data/index.js";
import type { Datastore } from "../core/store/index.js";
import type { Notifier } from "../core/notify/index.js";
import type { Config } from "../config.js";
import { runDailyCycle } from "./runner.js";
import { RiskLoop } from "./riskLoop.js";

export interface DaemonDeps {
  data: MarketDataSource;
  store: Datastore;
  config: Config;
  notify: Notifier;
  /** Wall clock (injected for tests). */
  now: () => number;
  /** Register a recurring callback every `ms` (injected; e.g. setInterval). */
  schedule: (fn: () => void, ms: number) => void;
}

const HOUR = 3_600_000;

/**
 * Always-on daemon: the slow clock (idempotent daily cycle on a coarse interval)
 * and the fast clock (the streaming risk loop). After each daily cycle the risk
 * loop is (re)started so coins opened by a rebalance get watched.
 */
export class Daemon {
  private readonly risk: RiskLoop;

  constructor(private readonly deps: DaemonDeps) {
    this.risk = new RiskLoop({
      data: deps.data,
      store: deps.store,
      notify: deps.notify,
      paper: deps.config.paper,
      risk: deps.config.risk,
    });
  }

  /** Run one daily cycle, then refresh the risk loop's watched coin-set. */
  async runOnce(): Promise<void> {
    await runDailyCycle({ data: this.deps.data, store: this.deps.store, config: this.deps.config, now: this.deps.now() });
    this.risk.start();
  }

  /** Run immediately, then schedule recurring cycles (hourly; cycle is per-day idempotent). */
  async start(): Promise<void> {
    await this.runOnce();
    this.deps.schedule(() => { void this.runOnce().catch((err) => console.error("daemon cycle failed:", err)); }, HOUR);
  }

  stop(): void {
    this.risk.stop();
  }
}
