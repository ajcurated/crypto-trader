const PERIODS_PER_YEAR = 365;

/** Annualized realized volatility of a daily return series (sample stdev × √365). */
export function realizedVol(returns: number[]): number {
  const n = returns.length;
  if (n < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance) * Math.sqrt(PERIODS_PER_YEAR);
}

/**
 * Exposure scale to hold realized volatility near `volTarget`: shrink gross when
 * recent vol runs hot, grow it (up to `maxScale`) when calm. Returns 1 (neutral)
 * until there's enough history to estimate vol, and clamps to (0, maxScale].
 */
export function volTargetScale(returns: number[], volTarget: number, maxScale: number, minObs = 5): number {
  if (returns.length < minObs) return 1;
  const rv = realizedVol(returns);
  if (rv <= 0) return maxScale;
  return Math.min(maxScale, volTarget / rv);
}
