import type { SignalParams } from "../signal/index.js";

/** A named strategy variant: signal params + how often it rebalances. */
export interface Strategy {
  name: string;
  description: string;
  signal: SignalParams;
  rebalanceEveryDays: number;
}
