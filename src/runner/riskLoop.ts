import type { MarketDataSource, AssetContext, WatchHandle } from "../core/data/index.js";
import type { Datastore } from "../core/store/index.js";
import type { PaperParams } from "../core/paper/index.js";
import type { Notifier } from "../core/notify/index.js";
import type { RiskParams } from "../core/risk/index.js";
import { PaperAccount } from "../core/paper/index.js";
import { evaluateRisk } from "../core/risk/index.js";

export interface RiskLoopDeps {
  data: MarketDataSource;
  store: Datastore;
  notify: Notifier;
  paper: PaperParams;
  risk: RiskParams;
}

/**
 * Streaming risk watch. Holds live marks/funding from the WS feed, evaluates
 * book-level and per-leg risk on every tick, and flattens against the latest
 * persisted account the instant a stop trips — independent of the daily cycle.
 */
export class RiskLoop {
  private readonly marks = new Map<string, number>();
  private readonly funding = new Map<string, number>();
  private handle: WatchHandle | null = null;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly deps: RiskLoopDeps) {}

  start(): void {
    const state = this.deps.store.getAccountState();
    const coins = state ? state.positions.map((p) => p.coin) : [];
    this.handle = this.deps.data.watch(coins, {
      onCtx: (ctx) => this.onTick(ctx),
      onError: (err) => void this.deps.notify.send(`risk feed error: ${err.message}`).catch(() => {}),
    });
  }

  stop(): void {
    this.handle?.close();
    this.handle = null;
  }

  /** Resolve once any in-flight tick handling has settled (test hook). */
  async idle(): Promise<void> {
    await this.pending;
  }

  private onTick(ctx: AssetContext): void {
    this.marks.set(ctx.name, ctx.midPx !== null ? ctx.midPx : ctx.markPx);
    this.funding.set(ctx.name, ctx.funding);
    this.pending = this.pending.then(() => this.evaluate());
  }

  private async evaluate(): Promise<void> {
    const state = this.deps.store.getAccountState();
    if (!state || state.positions.length === 0) return;

    const account = PaperAccount.fromState(state, this.deps.paper);
    const positions = account.positions();
    const nav = account.equity(this.marks);
    const action = evaluateRisk(positions, this.marks, this.funding, nav, this.deps.risk);

    for (const a of action.alerts) await this.deps.notify.send(a).catch(() => {});

    const toFlatten = action.flattenAll ? positions.map((p) => p.coin) : action.flattenLegs;
    if (toFlatten.length === 0) return;

    const volumes = new Map<string, number>(); // unknown live; slippage falls back to 0
    account.flatten(toFlatten, this.marks, volumes);
    this.deps.store.transaction(() => {
      this.deps.store.saveAccountState(account.toState());
    });
    await this.deps.notify.send(`flattened ${toFlatten.join(", ")}`).catch(() => {});
  }
}
