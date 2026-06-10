export type { EquityCurvePoint, EquityMetrics } from "./metrics.js";
export { equityMetrics } from "./metrics.js";
export { bucketFundingByDay } from "./fundingByDay.js";
export type { BacktestInput, BacktestResult } from "./engine.js";
export { runBacktest } from "./engine.js";
export type { PreparedBacktest } from "./prepare.js";
export { prepareBacktestData, fetchFundingFull } from "./prepare.js";
