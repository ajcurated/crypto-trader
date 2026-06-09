import type { CoinScore } from "./score.js";

export type Side = "long" | "short";

/** One target position: a coin, a side, and its weight as a fraction of NAV. */
export interface TargetPosition {
  coin: string;
  side: Side;
  weight: number;
}

/** The target portfolio: equal-weighted longs and shorts. */
export interface TargetBook {
  positions: TargetPosition[];
}

/** The set of currently-held long/short coins (used for hysteresis). */
export interface CurrentBook {
  longs: string[];
  shorts: string[];
}

/** Names per side for a quintile-style selection: floor(n * fraction), min 1. */
export function perSideCount(n: number, quintileFraction: number): number {
  return Math.max(1, Math.floor(n * quintileFraction));
}

/**
 * Churn-damped side selection. Longs = the top-k by rank PLUS any incumbent
 * longs still within the top (k + buffer); symmetric for shorts. The result is
 * rank-ordered and holds between k and k+buffer names per side. With an empty
 * current book this is exactly top-k / bottom-k. Assumes n >= 2*(k+buffer) so
 * the long and short hold-zones do not overlap.
 */
export function applyHysteresis(
  ranked: CoinScore[],
  k: number,
  buffer: number,
  current: CurrentBook,
): CurrentBook {
  const order = ranked.map((s) => s.coin); // index 0 = best
  const n = order.length;

  const topHold = new Set(order.slice(0, k + buffer));
  const longSet = new Set<string>(order.slice(0, k));
  for (const coin of current.longs) if (topHold.has(coin)) longSet.add(coin);

  const botHold = new Set(order.slice(n - (k + buffer)));
  const shortSet = new Set<string>(order.slice(n - k));
  for (const coin of current.shorts) if (botHold.has(coin)) shortSet.add(coin);

  return {
    longs: order.filter((c) => longSet.has(c)),
    shorts: order.filter((c) => shortSet.has(c)),
  };
}

/**
 * Equal-weight each side so it sums to `grossExposure / 2` of NAV. Long and
 * short sides each sum to the same gross, keeping the book dollar-neutral even
 * when the two sides hold different numbers of names.
 */
export function weightBook(sides: CurrentBook, grossExposure: number): TargetBook {
  const perSide = grossExposure / 2;
  const longWeight = perSide / sides.longs.length;
  const shortWeight = perSide / sides.shorts.length;
  return {
    positions: [
      ...sides.longs.map((coin) => ({ coin, side: "long" as const, weight: longWeight })),
      ...sides.shorts.map((coin) => ({ coin, side: "short" as const, weight: shortWeight })),
    ],
  };
}
