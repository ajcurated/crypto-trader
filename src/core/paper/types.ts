export type Side = "long" | "short";

/** Public view of an open position (size is the absolute base quantity). */
export interface Position {
  coin: string;
  side: Side;
  size: number;
  entryPrice: number;
}

/** A simulated execution of one order. `deltaSize` is signed (+ buy, − sell). */
export interface Fill {
  coin: string;
  deltaSize: number;
  fillPrice: number;
  fee: number;
  notional: number;
}

/** A mark-to-market point with P&L decomposed into its drivers. */
export interface EquityPoint {
  timestamp: number;
  equity: number;
  pricePnl: number;
  fundingPnl: number;
  fees: number;
}

/** Execution-cost parameters. */
export interface PaperParams {
  /** Per-fill fee as a fraction of notional (HL taker default 0.00045). */
  feeRate: number;
  /** Slippage fraction per 1× of recent volume traded. */
  slippageCoeff: number;
  /** Hard cap on the slippage fraction for a single fill. */
  maxSlippage: number;
}
