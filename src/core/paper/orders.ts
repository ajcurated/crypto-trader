/** Signed target base size from a signed NAV weight: weight * equity / price. */
export function targetSignedSize(weight: number, equity: number, price: number): number {
  return (weight * equity) / price;
}

export interface Order {
  coin: string;
  deltaSize: number;
}

/**
 * Signed deltas to move from `current` signed sizes to `target` signed sizes.
 * Coins in `target` are visited first (in iteration order), then any coins held
 * in `current` but absent from `target` are closed. Zero-delta coins are omitted.
 */
export function ordersToReach(
  current: Map<string, number>,
  target: Map<string, number>,
): Order[] {
  const orders: Order[] = [];
  for (const [coin, want] of target) {
    const have = current.get(coin) ?? 0;
    const delta = want - have;
    if (delta !== 0) orders.push({ coin, deltaSize: delta });
  }
  for (const [coin, have] of current) {
    if (!target.has(coin) && have !== 0) orders.push({ coin, deltaSize: -have });
  }
  return orders;
}
