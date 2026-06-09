/**
 * Funding cashflow for a signed position over one interval at the given rate.
 * Positive funding rate means longs pay shorts, so the payment is
 * `-sign(size) * rate * |size| * mark`. A flat position pays nothing (the
 * explicit guard also avoids returning IEEE -0).
 */
export function fundingPayment(size: number, rate: number, mark: number): number {
  if (size === 0) return 0;
  return -Math.sign(size) * rate * Math.abs(size) * mark;
}
