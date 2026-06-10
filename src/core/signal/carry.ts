import type { CoinScore } from "./score.js";
import type { CurrentBook, TargetBook } from "./book.js";
import { bookFromScores, type SignalParams } from "./signalEngine.js";

const EMPTY: CurrentBook = { longs: [], shorts: [] };

/**
 * Funding-carry book: long the most-negative-funding coins and short the
 * most-positive ones, so funding is collected on BOTH legs (negative funding ⇒
 * shorts pay longs ⇒ a long receives; positive ⇒ a short receives). The carry
 * score is simply `-funding`, so ranking descending puts the best carry first.
 * The price risk (negative funding usually means the crowd is short the name)
 * is left to the caller's risk controls (e.g. vol-targeting).
 */
export function buildCarryBook(
  avgFundingByCoin: Map<string, number>,
  params: SignalParams,
  current: CurrentBook = EMPTY,
): { scores: CoinScore[]; book: TargetBook } {
  const scores: CoinScore[] = [];
  for (const [coin, funding] of avgFundingByCoin) {
    if (Number.isFinite(funding)) scores.push({ coin, score: -funding });
  }
  return bookFromScores(scores, params, current);
}
