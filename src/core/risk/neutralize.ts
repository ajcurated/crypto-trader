import type { Position } from "../paper/index.js";

/**
 * Target weights (signed NAV fractions, + long / − short) that restore a
 * dollar-neutral book across the surviving positions by trimming the heavier
 * side down to the lighter side's gross. Each name on a side is equal-weighted.
 *
 * Used after the risk loop flattens a leg: rather than leave the book
 * directionally tilted until the next scheduled rebalance, re-equalize what's
 * left. When one side is empty the neutral target is flat (all weights zero),
 * since a one-sided book is pure directional risk. Unpriced positions are
 * skipped (they can't be re-sized without a mark).
 */
export function neutralizeWeights(positions: Position[], marks: Map<string, number>, nav: number): Map<string, number> {
  const longs: Position[] = [];
  const shorts: Position[] = [];
  let longGross = 0;
  let shortGross = 0;
  for (const p of positions) {
    const mark = marks.get(p.coin);
    if (mark === undefined) continue;
    if (p.side === "long") {
      longs.push(p);
      longGross += p.size * mark;
    } else {
      shorts.push(p);
      shortGross += p.size * mark;
    }
  }

  const weights = new Map<string, number>();
  if (nav <= 0) return weights;
  const target = Math.min(longGross, shortGross);
  for (const p of longs) weights.set(p.coin, target / longs.length / nav);
  for (const p of shorts) weights.set(p.coin, -(target / shorts.length) / nav);
  return weights;
}
