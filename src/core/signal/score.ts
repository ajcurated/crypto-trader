import { riskAdjustedMomentum } from "./returns.js";

/** A coin and its composite momentum score (higher = stronger). */
export interface CoinScore {
  coin: string;
  score: number;
}

/** Cross-sectional z-score using population stdev (÷ n). All-equal input -> zeros. */
export function zscore(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  if (sd === 0) return values.map(() => 0);
  return values.map((v) => (v - mean) / sd);
}

/**
 * Composite momentum score per coin: for each lookback, compute risk-adjusted
 * momentum for every coin and z-score it across the cross-section; the score is
 * the mean of those per-lookback z-scores. Coin order in the result follows the
 * Map's iteration order.
 */
export function compositeScores(
  closesByCoin: Map<string, number[]>,
  lookbacks: number[],
): CoinScore[] {
  const coins = [...closesByCoin.keys()];
  const zByLookback = lookbacks.map((lb) => {
    const raws = coins.map((c) => riskAdjustedMomentum(closesByCoin.get(c)!, lb));
    return zscore(raws);
  });
  return coins.map((coin, i) => ({
    coin,
    score: zByLookback.reduce((sum, z) => sum + z[i]!, 0) / lookbacks.length,
  }));
}
