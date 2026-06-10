import type { PaperParams } from "../paper/index.js";
import type { PreparedBacktest } from "./prepare.js";
import type { Strategy } from "./strategy.js";
import { runWindow } from "./walkforward.js";
import { realizedVol } from "./voltarget.js";

type Cfg = { paper: PaperParams; initialCapital: number };

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const stdev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

export type RegimeLabel = "bull" | "bear" | "chop";
function labelOf(btcReturn: number): RegimeLabel {
  if (btcReturn > 0.12) return "bull";
  if (btcReturn < -0.12) return "bear";
  return "chop";
}

export interface PlaybookCell {
  strategy: string;
  avgReturn: number;
  winRate: number;
  blocks: number;
}
export interface PlaybookRegime {
  regime: RegimeLabel;
  blocks: number;
  cells: PlaybookCell[];
}

/**
 * Strategy × regime matrix: split history into blocks (shared across strategies
 * via a common warmup), label each block's market regime from BTC, and report
 * each strategy's average block return and win-rate within each regime.
 */
export function regimePlaybook(
  prep: PreparedBacktest,
  strategies: Strategy[],
  cfg: Cfg,
  opts: { blockLen: number },
): PlaybookRegime[] {
  const warmup = Math.max(...strategies.map((s) => Math.max(...s.signal.lookbacks) + 1));
  const L = prep.dayTimestamps.length;
  const btc = prep.closesByCoin.get("BTC");

  const blocks: { label: RegimeLabel; byStrategy: Map<string, number> }[] = [];
  for (let s = warmup; s + opts.blockLen <= L; s += opts.blockLen) {
    const e = s + opts.blockLen;
    const btcRet = btc && btc[s]! > 0 ? btc[e - 1]! / btc[s]! - 1 : 0;
    const byStrategy = new Map<string, number>();
    for (const st of strategies) byStrategy.set(st.name, runWindow(prep, st, s, e, cfg).metrics.totalReturn);
    blocks.push({ label: labelOf(btcRet), byStrategy });
  }

  const regimes: RegimeLabel[] = ["bull", "chop", "bear"];
  return regimes
    .map((regime) => {
      const inRegime = blocks.filter((b) => b.label === regime);
      return {
        regime,
        blocks: inRegime.length,
        cells: strategies.map((st) => {
          const rets = inRegime.map((b) => b.byStrategy.get(st.name)!);
          return { strategy: st.name, avgReturn: mean(rets), winRate: rets.length ? rets.filter((r) => r > 0).length / rets.length : 0, blocks: rets.length };
        }),
      };
    })
    .filter((r) => r.blocks > 0);
}

export interface RegimeNow {
  lookbackDays: number;
  btcReturn: number;
  medianCoinReturn: number;
  breadthUp: number;
  dispersion: number;
  annualizedVol: number;
  /** Cross-sectional serial correlation of returns (prior vs recent half). */
  trendPersistence: number;
  suggestion: string;
}

/**
 * Characterize the CURRENT market from the most recent `lookbackDays` so a human
 * can place the regime. `trendPersistence` < 0 means recent winners are now
 * losing (reversal → favors mean-reversion); > 0 means trends persist (momentum).
 */
export function regimeNow(prep: PreparedBacktest, lookbackDays = 30): RegimeNow {
  const L = prep.dayTimestamps.length;
  const coins = [...prep.closesByCoin.keys()];
  const ret = (a: number[], from: number, to: number) => (a[from]! > 0 ? a[to]! / a[from]! - 1 : 0);

  const coinRets: number[] = [];
  const priorHalf: number[] = [];
  const recentHalf: number[] = [];
  const half = Math.floor(lookbackDays / 2);
  for (const c of coins) {
    const a = prep.closesByCoin.get(c)!;
    if (a.length <= lookbackDays) continue;
    coinRets.push(ret(a, a.length - 1 - lookbackDays, a.length - 1));
    priorHalf.push(ret(a, a.length - 1 - lookbackDays, a.length - 1 - half));
    recentHalf.push(ret(a, a.length - 1 - half, a.length - 1));
  }

  const btc = prep.closesByCoin.get("BTC")!;
  const btcReturn = ret(btc, btc.length - 1 - lookbackDays, btc.length - 1);
  const dailyBtc: number[] = [];
  for (let i = btc.length - lookbackDays; i < btc.length; i++) dailyBtc.push(btc[i]! / btc[i - 1]! - 1);

  // cross-sectional serial correlation (prior-half vs recent-half coin returns)
  const n = priorHalf.length;
  const mp = mean(priorHalf), mr = mean(recentHalf);
  let cov = 0;
  for (let i = 0; i < n; i++) cov += (priorHalf[i]! - mp) * (recentHalf[i]! - mr);
  const sp = stdev(priorHalf), sr = stdev(recentHalf);
  const trendPersistence = sp > 0 && sr > 0 && n > 1 ? cov / (n - 1) / (sp * sr) : 0;

  const breadthUp = coinRets.length ? coinRets.filter((r) => r > 0).length / coinRets.length : 0;
  const dispersion = stdev(coinRets);
  const annualizedVol = realizedVol(dailyBtc);

  let suggestion: string;
  if (trendPersistence < -0.15) suggestion = "reversal/choppy → favor MEAN-REVERSION (or de-risk)";
  else if (trendPersistence > 0.15 && dispersion > 0.25) suggestion = "trending + dispersed → favor MOMENTUM";
  else if (annualizedVol > 0.9) suggestion = "high volatility → VOL-TARGET / reduce gross";
  else suggestion = "mixed/range-bound → MOMENTUM with vol-targeting; consider funding-carry";

  return { lookbackDays, btcReturn, medianCoinReturn: median(coinRets), breadthUp, dispersion, annualizedVol, trendPersistence, suggestion };
}
