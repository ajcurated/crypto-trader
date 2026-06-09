export interface EquityCurvePoint {
  timestamp: number;
  equity: number;
}

export interface EquityMetrics {
  totalReturn: number;
  cagr: number;
  sharpe: number;
  annualizedVol: number;
  maxDrawdown: number;
}

const YEAR_MS = 365 * 86_400_000;
const ZERO: EquityMetrics = { totalReturn: 0, cagr: 0, sharpe: 0, annualizedVol: 0, maxDrawdown: 0 };

/** Performance statistics for an equity curve (oldest-first). Risk-free = 0. */
export function equityMetrics(curve: EquityCurvePoint[], periodsPerYear = 365): EquityMetrics {
  if (curve.length < 2) return ZERO;
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;

  const returns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    returns.push(curve[i]!.equity / curve[i - 1]!.equity - 1);
  }

  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const annualizedVol = sd * Math.sqrt(periodsPerYear);
  const sharpe = sd === 0 ? 0 : (mean * Math.sqrt(periodsPerYear)) / sd;

  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - p.equity) / peak);
  }

  const totalReturn = last.equity / first.equity - 1;
  const years = (last.timestamp - first.timestamp) / YEAR_MS;
  const cagr = years > 0 ? (last.equity / first.equity) ** (1 / years) - 1 : totalReturn;

  return { totalReturn, cagr, sharpe, annualizedVol, maxDrawdown };
}
