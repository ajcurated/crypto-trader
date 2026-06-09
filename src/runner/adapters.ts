import type { TargetBook, CurrentBook } from "../core/signal/index.js";
import type { Candle, FundingPoint } from "../core/data/index.js";
import type { Position } from "../core/paper/index.js";

/** Convert a target book into signed NAV weights (+ long, − short). */
export function weightsFromBook(book: TargetBook): Map<string, number> {
  const weights = new Map<string, number>();
  for (const p of book.positions) weights.set(p.coin, p.side === "long" ? p.weight : -p.weight);
  return weights;
}

/** Close prices from a candle series, in order. */
export function closesFromCandles(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

/** Split held positions into the long/short coin lists hysteresis needs. */
export function currentBookFromPositions(positions: Position[]): CurrentBook {
  return {
    longs: positions.filter((p) => p.side === "long").map((p) => p.coin),
    shorts: positions.filter((p) => p.side === "short").map((p) => p.coin),
  };
}

/** Sum funding rates strictly after `cutoff` (epoch ms) into a single rate. */
export function sumFundingSince(points: FundingPoint[], cutoff: number): number {
  return points.reduce((sum, p) => (p.time > cutoff ? sum + p.rate : sum), 0);
}
