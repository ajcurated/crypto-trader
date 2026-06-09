import type { MarketDataSource } from "../core/data/index.js";
import type { Datastore } from "../core/store/index.js";
import type { EquityPoint } from "../core/paper/index.js";
import type { Config } from "../config.js";
import { buildTargetBook } from "../core/signal/index.js";
import { PaperAccount } from "../core/paper/index.js";
import { weightsFromBook, closesFromCandles, currentBookFromPositions, sumFundingSince } from "./adapters.js";

const DAY = 86_400_000;

export interface RunnerDeps {
  data: MarketDataSource;
  store: Datastore;
  config: Config;
  now: number;
}

const dayIndex = (ts: number): number => Math.floor(ts / DAY);

/**
 * One daily paper-trading cycle: fetch -> snapshot -> signal -> (rebalance on
 * cadence) -> accrue funding -> mark -> persist. Idempotent per UTC day: a
 * second call on the same day returns the existing latest equity point.
 */
export async function runDailyCycle(deps: RunnerDeps): Promise<EquityPoint> {
  const { data, store, config, now } = deps;

  const runner = store.getRunnerState();
  const curve = store.getEquityCurve();
  // Idempotent + monotonic: skip if we've already marked today OR `now` is an
  // earlier day than the last mark (clock skew / out-of-order). The curve guard
  // keeps the `!` safe even if a prior tick's writes were somehow torn.
  if (runner && curve.length > 0 && dayIndex(now) <= dayIndex(runner.lastMarkAt)) {
    return curve[curve.length - 1]!;
  }

  // 1. Fetch universe + persist snapshot.
  const universe = await data.getUniverse(config.universeSize);
  store.saveMarketSnapshot({ capturedAt: now, universe });
  const prices = new Map(universe.map((c) => [c.name, c.markPx]));
  const volumes = new Map(universe.map((c) => [c.name, c.dayNtlVlm]));

  // 2. Candles -> closes (tolerate a per-coin fetch failure).
  const closesByCoin = new Map<string, number[]>();
  for (const c of universe) {
    try {
      const candles = await data.getDailyCandles(c.name, config.candleHistoryDays);
      closesByCoin.set(c.name, closesFromCandles(candles));
    } catch {
      // skip this coin for the run; it'll be excluded from the signal
    }
  }

  // 3. Restore account + current book.
  const prevState = store.getAccountState();
  const account = prevState ? PaperAccount.fromState(prevState, config.paper) : new PaperAccount(config.initialCapital, config.paper);
  const current = currentBookFromPositions(account.positions());

  // 4. Accrue funding on the PRE-rebalance book (the positions actually held
  //    over the interval since the last mark). None on the first tick.
  if (runner) {
    const rates = new Map<string, number>();
    for (const p of account.positions()) {
      const history = await data.getFundingHistory(p.coin, runner.lastMarkAt);
      rates.set(p.coin, sumFundingSince(history, runner.lastMarkAt));
    }
    account.accrueFunding(rates, prices);
  }

  // 5. Signal (saved every tick for reporting).
  const { scores, book } = buildTargetBook(closesByCoin, config.signal, current);

  // 6. Rebalance on cadence — but skip on stale/incomplete data (spec §10):
  //    only trade when enough coins have usable history (scores covers eligible
  //    coins only). On a skip we keep the existing book and just mark.
  const dueToRebalance = !runner || runner.lastRebalanceAt === 0 || now - runner.lastRebalanceAt >= config.rebalanceIntervalDays * DAY;
  const dataFresh = scores.length >= config.minUniverseForRebalance;
  const shouldRebalance = dueToRebalance && dataFresh;
  if (shouldRebalance) account.rebalance(weightsFromBook(book), prices, volumes);

  // 7. Mark + persist atomically (equity, account, runner, signal commit together).
  const point = account.mark(prices, now);
  store.transaction(() => {
    store.saveSignal(now, scores);
    store.saveEquityPoint(point);
    store.saveAccountState(account.toState());
    store.saveRunnerState({
      lastMarkAt: now,
      lastRebalanceAt: shouldRebalance ? now : (runner?.lastRebalanceAt ?? 0),
    });
  });
  return point;
}
