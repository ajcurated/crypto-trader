import type { MarketDataSource, FundingPoint } from "../data/index.js";
import { bucketFundingByDay } from "./fundingByDay.js";

const DAY = 86_400_000;

/** Aligned historical inputs shared by every strategy in a backtest comparison. */
export interface PreparedBacktest {
  closesByCoin: Map<string, number[]>;
  volumeByCoin: Map<string, number>;
  dayTimestamps: number[];
  fundingByDayByCoin: Map<string, number[]>;
}

/** Page through HL funding history (500-point cap) until the window is covered. */
export async function fetchFundingFull(
  data: MarketDataSource,
  coin: string,
  since: number,
  until: number,
): Promise<FundingPoint[]> {
  const all: FundingPoint[] = [];
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

/**
 * Fetch the top-N universe, daily candles (tolerating per-coin failures), and
 * per-day funding, aligned to a common length so every coin shares one timeline.
 * Returns empty maps/arrays if no candle data is available.
 */
export async function prepareBacktestData(
  data: MarketDataSource,
  opts: { universeSize: number; candleHistoryDays: number; minHistoryDays?: number },
): Promise<PreparedBacktest> {
  const minHistory = opts.minHistoryDays ?? 0;
  const universe = await data.getUniverse(opts.universeSize);
  const volumeByCoin = new Map(universe.map((c) => [c.name, c.dayNtlVlm]));

  const rawCloses = new Map<string, number[]>();
  const rawCloseTimes = new Map<string, number[]>();
  for (const c of universe) {
    try {
      const candles = await data.getDailyCandles(c.name, opts.candleHistoryDays);
      // Drop coins with too little history so longer-lookback strategies aren't
      // truncated to the newest listing's short window.
      if (candles.length >= minHistory && candles.length > 0) {
        rawCloses.set(c.name, candles.map((k) => k.close));
        rawCloseTimes.set(c.name, candles.map((k) => k.closeTime));
      }
    } catch { /* skip flaky coin */ }
  }
  if (rawCloses.size === 0) {
    return { closesByCoin: new Map(), volumeByCoin, dayTimestamps: [], fundingByDayByCoin: new Map() };
  }

  const L = Math.min(...[...rawCloses.values()].map((a) => a.length));
  const coins = [...rawCloses.keys()];
  const closesByCoin = new Map(coins.map((c) => [c, rawCloses.get(c)!.slice(-L)]));
  const dayTimestamps = rawCloseTimes.get(coins[0]!)!.slice(-L);

  const fundingByDayByCoin = new Map<string, number[]>();
  const since = dayTimestamps[0]! - DAY;
  const until = dayTimestamps[L - 1]!;
  for (const c of coins) {
    try {
      fundingByDayByCoin.set(c, bucketFundingByDay(await fetchFundingFull(data, c, since, until), dayTimestamps));
    } catch { /* no funding for this coin */ }
  }

  return { closesByCoin, volumeByCoin, dayTimestamps, fundingByDayByCoin };
}
