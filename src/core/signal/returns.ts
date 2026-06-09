/** Simple period-over-period returns: r_t = (c_t - c_{t-1}) / c_{t-1}. */
export function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    out.push((closes[i]! - prev) / prev);
  }
  return out;
}

/** Point-to-point return over the last `lookback` periods: c_now / c_{now-lookback} - 1. */
export function totalReturn(closes: number[], lookback: number): number {
  if (closes.length < lookback + 1) {
    throw new Error(`insufficient closes: need ${lookback + 1}, got ${closes.length}`);
  }
  const now = closes[closes.length - 1]!;
  const past = closes[closes.length - 1 - lookback]!;
  return now / past - 1;
}

/** Sample standard deviation (÷ n-1) of a series of returns. */
export function volatility(returns: number[]): number {
  const n = returns.length;
  if (n < 2) throw new Error(`insufficient returns for volatility: need 2, got ${n}`);
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

/**
 * Risk-adjusted momentum over `lookback` periods: the total return over the
 * window divided by the volatility of that window's daily returns. Uses only
 * the last `lookback + 1` closes.
 */
export function riskAdjustedMomentum(closes: number[], lookback: number): number {
  if (closes.length < lookback + 1) {
    throw new Error(`insufficient closes: need ${lookback + 1}, got ${closes.length}`);
  }
  const window = closes.slice(closes.length - (lookback + 1));
  return totalReturn(window, lookback) / volatility(dailyReturns(window));
}
