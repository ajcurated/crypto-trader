import type { Fill, EquityPoint, PaperParams, Position, Side, AccountState } from "./types.js";
import { feeFor, slippageFraction, fillPrice } from "./fills.js";
import { applyTrade, type SignedPosition } from "./position.js";
import { fundingPayment } from "./funding.js";
import { targetSignedSize, ordersToReach } from "./orders.js";

/** A deterministic paper-trading account: positions, cash, and P&L accounting. */
export class PaperAccount {
  private cash: number;
  private readonly positionsByCoin = new Map<string, SignedPosition>();
  private realizedPricePnl = 0;
  private feesPaid = 0;
  private fundingPnl = 0;

  constructor(
    private readonly initialCapital: number,
    private readonly params: PaperParams,
  ) {
    this.cash = initialCapital;
  }

  private signedSizes(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [coin, pos] of this.positionsByCoin) {
      if (pos.size !== 0) out.set(coin, pos.size);
    }
    return out;
  }

  /** Unrealized price PnL across open positions. Single source of truth so the
   *  `equity = initial + pricePnl + funding − fees` identity can never drift. */
  private unrealized(prices: Map<string, number>): number {
    let total = 0;
    for (const [coin, pos] of this.positionsByCoin) {
      if (pos.size === 0) continue;
      const mark = prices.get(coin);
      if (mark === undefined) continue;
      total += pos.size * (mark - pos.entry);
    }
    return total;
  }

  equity(prices: Map<string, number>): number {
    return this.cash + this.unrealized(prices);
  }

  positions(): Position[] {
    const out: Position[] = [];
    for (const [coin, pos] of this.positionsByCoin) {
      if (pos.size === 0) continue;
      const side: Side = pos.size > 0 ? "long" : "short";
      out.push({ coin, side, size: Math.abs(pos.size), entryPrice: pos.entry });
    }
    return out;
  }

  rebalance(
    targetWeights: Map<string, number>,
    prices: Map<string, number>,
    recentVolumes: Map<string, number>,
  ): Fill[] {
    const equity = this.equity(prices);
    const target = new Map<string, number>();
    for (const [coin, weight] of targetWeights) {
      const price = prices.get(coin);
      if (price === undefined) continue;
      target.set(coin, targetSignedSize(weight, equity, price));
    }

    const fills: Fill[] = [];
    for (const order of ordersToReach(this.signedSizes(), target)) {
      const mark = prices.get(order.coin);
      // A held coin that fell out of the priced universe can't be traded this
      // tick — leave the position untouched rather than fill at an undefined
      // price (which would NaN-poison cash and entry).
      if (mark === undefined) continue;
      const slip = slippageFraction(
        order.deltaSize * mark,
        recentVolumes.get(order.coin) ?? 0,
        this.params.slippageCoeff,
        this.params.maxSlippage,
      );
      const price = fillPrice(mark, order.deltaSize, slip);
      const notional = order.deltaSize * price;
      const fee = feeFor(notional, this.params.feeRate);

      const prev = this.positionsByCoin.get(order.coin) ?? { size: 0, entry: 0 };
      const { position, realized } = applyTrade(prev, order.deltaSize, price);
      this.positionsByCoin.set(order.coin, position);
      this.realizedPricePnl += realized;
      this.feesPaid += fee;
      this.cash += realized - fee;

      fills.push({ coin: order.coin, deltaSize: order.deltaSize, fillPrice: price, fee, notional });
    }
    return fills;
  }

  accrueFunding(rates: Map<string, number>, prices: Map<string, number>): number {
    let total = 0;
    for (const [coin, pos] of this.positionsByCoin) {
      if (pos.size === 0) continue;
      const rate = rates.get(coin);
      const mark = prices.get(coin);
      if (rate === undefined || mark === undefined) continue;
      total += fundingPayment(pos.size, rate, mark);
    }
    this.cash += total;
    this.fundingPnl += total;
    return total;
  }

  mark(prices: Map<string, number>, timestamp: number): EquityPoint {
    const unrealized = this.unrealized(prices);
    return {
      timestamp,
      equity: this.cash + unrealized,
      pricePnl: this.realizedPricePnl + unrealized,
      fundingPnl: this.fundingPnl,
      fees: this.feesPaid,
    };
  }

  /** Serialize the full account state for persistence. */
  toState(): AccountState {
    const positions: { coin: string; size: number; entry: number }[] = [];
    for (const [coin, pos] of this.positionsByCoin) {
      if (pos.size !== 0) positions.push({ coin, size: pos.size, entry: pos.entry });
    }
    return {
      initialCapital: this.initialCapital,
      cash: this.cash,
      positions,
      realizedPricePnl: this.realizedPricePnl,
      feesPaid: this.feesPaid,
      fundingPnl: this.fundingPnl,
    };
  }

  /** Reconstruct an account from a persisted state. */
  static fromState(state: AccountState, params: PaperParams): PaperAccount {
    const acct = new PaperAccount(state.initialCapital, params);
    acct.cash = state.cash;
    acct.realizedPricePnl = state.realizedPricePnl;
    acct.feesPaid = state.feesPaid;
    acct.fundingPnl = state.fundingPnl;
    for (const p of state.positions) acct.positionsByCoin.set(p.coin, { size: p.size, entry: p.entry });
    return acct;
  }
}
