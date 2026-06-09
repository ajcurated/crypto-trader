/** Fee charged for a fill: feeRate × |notional|. */
export function feeFor(notional: number, feeRate: number): number {
  return Math.abs(notional) * feeRate;
}

/**
 * Slippage fraction for an order: slippageCoeff × |orderNotional| / recentVolume,
 * capped at maxSlippage. Returns 0 when recentVolume is unknown (<= 0).
 */
export function slippageFraction(
  orderNotional: number,
  recentVolume: number,
  slippageCoeff: number,
  maxSlippage: number,
): number {
  if (recentVolume <= 0) return 0;
  const raw = slippageCoeff * (Math.abs(orderNotional) / recentVolume);
  return Math.min(maxSlippage, raw);
}

/** Fill price: buys (deltaSize > 0) pay up, sells (deltaSize < 0) receive less. */
export function fillPrice(midPrice: number, deltaSize: number, slipFrac: number): number {
  const dir = deltaSize >= 0 ? 1 : -1;
  return midPrice * (1 + dir * slipFrac);
}
