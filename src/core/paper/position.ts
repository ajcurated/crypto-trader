/** A signed position: size > 0 long, < 0 short, 0 flat. */
export interface SignedPosition {
  size: number;
  entry: number;
}

export interface TradeResult {
  position: SignedPosition;
  realized: number;
}

/**
 * Apply a signed trade `dq` at `fill` to a signed position. Adding in the same
 * direction recomputes a size-weighted entry (no realized PnL); reducing
 * realizes `sign(size) * (fill - entry) * closedQty`; a flip closes fully then
 * opens the remainder at `fill`.
 */
export function applyTrade(pos: SignedPosition, dq: number, fill: number): TradeResult {
  if (dq === 0) return { position: pos, realized: 0 }; // no-op trade; keep total/NaN-free
  const q = pos.size;

  // Opening from flat, or adding in the same direction.
  if (q === 0 || Math.sign(dq) === Math.sign(q)) {
    const newSize = q + dq;
    const entry = (Math.abs(q) * pos.entry + Math.abs(dq) * fill) / Math.abs(newSize);
    return { position: { size: newSize, entry }, realized: 0 };
  }

  // Opposite direction: reduce / close / flip.
  const closedQty = Math.min(Math.abs(dq), Math.abs(q));
  const realized = Math.sign(q) * (fill - pos.entry) * closedQty;
  const newSize = q + dq;

  if (newSize === 0) return { position: { size: 0, entry: 0 }, realized };
  if (Math.sign(newSize) === Math.sign(q)) {
    // Reduced but not closed: entry unchanged.
    return { position: { size: newSize, entry: pos.entry }, realized };
  }
  // Flipped past zero: remainder opens fresh at the fill price.
  return { position: { size: newSize, entry: fill }, realized };
}
