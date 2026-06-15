const DAY = 86_400_000;

/** A daily OHLC candle of the equity curve. */
export interface EquityCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Bucket an equity curve into daily (UTC) OHLC candles. `open` is the previous
 * day's close so candles are gap-continuous and directional even with one point
 * per day; `high`/`low` include the open plus every point that day, so intraday
 * marks (e.g. a manual rotate) show as real range. `close` is the day's last point.
 */
export function toDailyCandles(curve: { timestamp: number; equity: number }[]): EquityCandle[] {
  const byDay = new Map<number, number[]>();
  const order: number[] = [];
  for (const p of curve) {
    const day = Math.floor(p.timestamp / DAY);
    let bucket = byDay.get(day);
    if (!bucket) {
      bucket = [];
      byDay.set(day, bucket);
      order.push(day);
    }
    bucket.push(p.equity);
  }

  const candles: EquityCandle[] = [];
  let prevClose: number | undefined;
  for (const day of order) {
    const eqs = byDay.get(day)!;
    const close = eqs[eqs.length - 1]!;
    const open = prevClose ?? eqs[0]!;
    candles.push({ time: day * DAY, open, high: Math.max(open, ...eqs), low: Math.min(open, ...eqs), close });
    prevClose = close;
  }
  return candles;
}
