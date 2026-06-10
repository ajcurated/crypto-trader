import { riskAdjustedMomentum } from "./returns.js";
import { compositeScores, type CoinScore } from "./score.js";
import { perSideCount, applyHysteresis, weightBook, type CurrentBook, type TargetBook } from "./book.js";

/** Strategy parameters for one signal run. */
export interface SignalParams {
  /** Lookback windows (days) to blend, e.g. [30, 60]. */
  lookbacks: number[];
  /** Fraction of the universe taken per side, e.g. 0.2 (top/bottom quintile). */
  quintileFraction: number;
  /** Gross exposure as a multiple of NAV, e.g. 1.0 (~0.5 long / ~0.5 short). */
  grossExposure: number;
  /** Extra ranks of tolerance before an incumbent is dropped. */
  hysteresisBuffer: number;
  /**
   * "momentum" (default) longs the strongest and shorts the weakest;
   * "reversion" flips it — long the recent losers, short the recent winners
   * (profits when trends reverse / in choppy markets);
   * "carry" ranks by funding instead of price (handled by the carry engine path).
   */
  mode?: "momentum" | "reversion" | "carry";
}

const EMPTY_BOOK: CurrentBook = { longs: [], shorts: [] };

/**
 * Build the target book from per-coin close-price series. A coin is excluded if
 * it lacks enough history for the longest lookback, or if its risk-adjusted
 * momentum is undefined for any lookback (e.g. zero volatility over the window
 * gives 0/0 = NaN) — otherwise that NaN would poison the cross-sectional
 * z-scores for every coin. Returns the descending-ranked scores (for
 * inspection/persistence) and the dollar-neutral target book.
 */
export function buildTargetBook(
  closesByCoin: Map<string, number[]>,
  params: SignalParams,
  current: CurrentBook = EMPTY_BOOK,
): { scores: CoinScore[]; book: TargetBook } {
  const minCloses = Math.max(...params.lookbacks) + 1;
  const eligible = new Map<string, number[]>();
  for (const [coin, closes] of closesByCoin) {
    if (closes.length < minCloses) continue;
    const finite = params.lookbacks.every((lb) => Number.isFinite(riskAdjustedMomentum(closes, lb)));
    if (finite) eligible.set(coin, closes);
  }

  const raw = compositeScores(eligible, params.lookbacks);
  // Reversion mode flips the sign, so ranking/selection long the losers.
  const scores = params.mode === "reversion" ? raw.map((s) => ({ coin: s.coin, score: -s.score })) : raw;
  return bookFromScores(scores, params, current);
}

/**
 * Turn per-coin scores into a dollar-neutral target book: rank descending, long
 * the top quintile / short the bottom, equal-weight, with the hysteresis buffer
 * clamped so the long/short hold-zones never overlap. Shared by every strategy
 * (momentum, reversion, carry) — only the scoring differs.
 */
export function bookFromScores(
  scores: CoinScore[],
  params: SignalParams,
  current: CurrentBook = EMPTY_BOOK,
): { scores: CoinScore[]; book: TargetBook } {
  const ranked = [...scores].sort((a, b) => b.score - a.score);
  if (ranked.length < 2) return { scores: ranked, book: { positions: [] } };

  const k = perSideCount(ranked.length, params.quintileFraction);
  const maxBuffer = Math.max(0, Math.floor(ranked.length / 2) - k);
  const buffer = Math.min(params.hysteresisBuffer, maxBuffer);
  const sides = applyHysteresis(ranked, k, buffer, current);
  const book = weightBook(sides, params.grossExposure);
  return { scores: ranked, book };
}
