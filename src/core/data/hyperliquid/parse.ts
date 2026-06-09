import { num } from "./http.js";
import type { AssetContext } from "../types.js";

interface RawPerpInfo { name: string; szDecimals: number; maxLeverage: number }
interface RawCtx {
  dayNtlVlm: string;
  funding: string;
  markPx: string;
  midPx: string | null;
  oraclePx: string;
  prevDayPx: string;
  openInterest: string;
}

function toCtx(info: RawPerpInfo, ctx: RawCtx): AssetContext {
  return {
    name: info.name,
    dayNtlVlm: num(ctx.dayNtlVlm),
    funding: num(ctx.funding),
    markPx: num(ctx.markPx),
    midPx: ctx.midPx === null ? null : num(ctx.midPx),
    oraclePx: num(ctx.oraclePx),
    prevDayPx: num(ctx.prevDayPx),
    openInterest: num(ctx.openInterest),
  };
}

/** Parse `metaAndAssetCtxs`, returning top `topN` perps sorted desc by 24h volume. */
export function parseUniverse(raw: unknown, topN: number): AssetContext[] {
  const [meta, ctxs] = raw as [{ universe: RawPerpInfo[] }, RawCtx[]];
  const out = meta.universe.map((info, i) => toCtx(info, ctxs[i]!));
  out.sort((a, b) => b.dayNtlVlm - a.dayNtlVlm);
  return out.slice(0, topN);
}
