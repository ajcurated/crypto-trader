import type { SignalParams } from "../signal/index.js";

/** A named strategy variant: signal params + how often it rebalances. */
export interface Strategy {
  name: string;
  description: string;
  signal: SignalParams;
  rebalanceEveryDays: number;
  /** Optional annualized vol target; scales gross to hold risk constant. */
  volTarget?: number;
  /** Max exposure multiple when vol-targeting. */
  maxLeverage?: number;
  /** Also rebalance once equity rises this fraction since the last rebalance (e.g. 0.01 = +1%). */
  gainTrigger?: number;
}
