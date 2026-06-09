import { num } from "./http.js";
import type { AssetContext, Candle, FundingPoint } from "../types.js";

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

/** Single translation point for raw HL context fields -> AssetContext. */
function ctxToAssetContext(name: string, ctx: RawCtx): AssetContext {
  return {
    name,
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
  if (meta.universe.length !== ctxs.length) {
    throw new Error(
      `HL metaAndAssetCtxs length mismatch: ${meta.universe.length} universe vs ${ctxs.length} contexts`,
    );
  }
  const out = meta.universe.map((info, i) => ctxToAssetContext(info.name, ctxs[i]!));
  out.sort((a, b) => b.dayNtlVlm - a.dayNtlVlm);
  return out.slice(0, topN);
}

interface RawCandle {
  t: number; T: number; s: string;
  o: string; h: string; l: string; c: string; v: string; n: number;
}

/** Parse a `candleSnapshot` response, oldest-first (as HL returns it). */
export function parseCandles(raw: unknown): Candle[] {
  return (raw as RawCandle[]).map((k) => ({
    coin: k.s,
    openTime: k.t,
    closeTime: k.T,
    open: num(k.o),
    high: num(k.h),
    low: num(k.l),
    close: num(k.c),
    volume: num(k.v),
    trades: k.n,
  }));
}

interface RawFunding { coin: string; fundingRate: string; premium: string; time: number }

/** Parse a `fundingHistory` response into FundingPoints, oldest-first. */
export function parseFunding(raw: unknown): FundingPoint[] {
  return (raw as RawFunding[]).map((f) => ({
    coin: f.coin,
    rate: num(f.fundingRate),
    time: f.time,
  }));
}

interface WsCtxMessage {
  channel: string;
  data?: { coin: string; ctx: RawCtx };
}

/** Parse a WS message; return an AssetContext for `activeAssetCtx`, else null. */
export function parseWsCtx(msg: unknown): AssetContext | null {
  const m = msg as WsCtxMessage;
  if (m.channel !== "activeAssetCtx" || !m.data) return null;
  return ctxToAssetContext(m.data.coin, m.data.ctx);
}
