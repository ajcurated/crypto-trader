import type { Position } from "../paper/index.js";

export interface RiskParams {
  /** Flatten the book if total unrealized loss exceeds this fraction of NAV. */
  spreadStopPct: number;
  /** Flatten a single leg if its adverse move from entry exceeds this fraction. */
  circuitBreakerBand: number;
  /** Alert if a leg's annualized funding magnitude exceeds this fraction. */
  fundingAlertAnnualized: number;
}

export interface RiskAction {
  flattenAll: boolean;
  flattenLegs: string[];
  alerts: string[];
}

const HOURS_PER_YEAR = 24 * 365;
const sideSign = (side: Position["side"]): number => (side === "long" ? 1 : -1);

/**
 * Decide risk actions from open positions, current marks, and funding rates.
 * Book-level spread stop flattens everything; per-leg circuit breaker flattens
 * a single gapped leg; funding spikes only alert. Legs without a mark are skipped.
 */
export function evaluateRisk(
  positions: Position[],
  marks: Map<string, number>,
  fundingRates: Map<string, number>,
  nav: number,
  params: RiskParams,
): RiskAction {
  let totalUnrealized = 0;
  const flattenLegs: string[] = [];
  const alerts: string[] = [];

  for (const p of positions) {
    const mark = marks.get(p.coin);
    if (mark === undefined) continue;
    const sign = sideSign(p.side);
    totalUnrealized += sign * (mark - p.entryPrice) * p.size;

    const legReturn = (sign * (mark - p.entryPrice)) / p.entryPrice;
    if (legReturn <= -params.circuitBreakerBand) {
      flattenLegs.push(p.coin);
      alerts.push(`circuit breaker: ${p.coin} moved ${(legReturn * 100).toFixed(1)}% against the book`);
    }

    const rate = fundingRates.get(p.coin);
    if (rate !== undefined) {
      const annualized = rate * HOURS_PER_YEAR;
      if (Math.abs(annualized) > params.fundingAlertAnnualized) {
        alerts.push(`funding spike: ${p.coin} annualized ${(annualized * 100).toFixed(0)}%`);
      }
    }
  }

  const flattenAll = totalUnrealized <= -params.spreadStopPct * nav;
  if (flattenAll) alerts.push(`spread stop: book unrealized ${totalUnrealized.toFixed(2)} exceeds ${(params.spreadStopPct * 100).toFixed(0)}% of NAV`);

  return { flattenAll, flattenLegs, alerts };
}
