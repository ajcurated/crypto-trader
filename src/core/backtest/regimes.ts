import type { PaperParams } from "../paper/index.js";
import type { PreparedBacktest } from "./prepare.js";
import type { Strategy } from "./strategy.js";
import { runWindow } from "./walkforward.js";

export interface RegimeBlock {
  fromTs: number;
  toTs: number;
  /** Market context over the block. */
  btcReturn: number | null;
  medianCoinReturn: number;
  pctUp: number;
  /** Strategy performance over the block. */
  stratReturn: number;
  stratSharpe: number;
  stratMaxDrawdown: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Walk consecutive fixed-length blocks across the history. For each block,
 * characterize the market (BTC + median-coin return, breadth) and measure the
 * strategy over the same block — so performance can be read regime-by-regime.
 */
export function analyzeRegimes(
  prep: PreparedBacktest,
  strategy: Strategy,
  cfg: { paper: PaperParams; initialCapital: number },
  opts: { blockLen: number },
): RegimeBlock[] {
  const warmup = Math.max(...strategy.signal.lookbacks) + 1;
  const L = prep.dayTimestamps.length;
  const coins = [...prep.closesByCoin.keys()];
  const out: RegimeBlock[] = [];

  for (let s = warmup; s + opts.blockLen <= L; s += opts.blockLen) {
    const e = s + opts.blockLen;
    const rets: number[] = [];
    let btc: number | null = null;
    for (const c of coins) {
      const a = prep.closesByCoin.get(c)!;
      const open = a[s]!;
      const close = a[e - 1]!;
      if (open > 0) {
        const r = close / open - 1;
        rets.push(r);
        if (c === "BTC") btc = r;
      }
    }
    const m = runWindow(prep, strategy, s, e, cfg).metrics;
    out.push({
      fromTs: prep.dayTimestamps[s]!,
      toTs: prep.dayTimestamps[e - 1]!,
      btcReturn: btc,
      medianCoinReturn: median(rets),
      pctUp: rets.length ? rets.filter((r) => r > 0).length / rets.length : 0,
      stratReturn: m.totalReturn,
      stratSharpe: m.sharpe,
      stratMaxDrawdown: m.maxDrawdown,
    });
  }
  return out;
}
