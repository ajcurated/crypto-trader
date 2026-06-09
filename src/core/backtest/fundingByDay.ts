import type { FundingPoint } from "../data/index.js";

const DAY = 86_400_000;

/**
 * Bucket funding points into a per-day summed rate aligned to `dayTimestamps`
 * (one entry per day). A point at time `t` belongs to day index `floor(t/DAY)`;
 * the result index is that day's position in `dayTimestamps`. Points outside the
 * covered days are ignored.
 */
export function bucketFundingByDay(points: FundingPoint[], dayTimestamps: number[]): number[] {
  const dayIndexOf = new Map<number, number>();
  dayTimestamps.forEach((ts, i) => dayIndexOf.set(Math.floor(ts / DAY), i));

  const out = new Array<number>(dayTimestamps.length).fill(0);
  for (const p of points) {
    const slot = dayIndexOf.get(Math.floor(p.time / DAY));
    if (slot !== undefined) out[slot]! += p.rate;
  }
  return out;
}
