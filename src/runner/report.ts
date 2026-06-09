import type { Datastore } from "../core/store/index.js";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Build a human-readable summary of the persisted paper-trading state. */
export function formatReport(store: Datastore): string {
  const curve = store.getEquityCurve();
  if (curve.length === 0) return "no equity history yet — run a cycle first.";

  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  const ret = (last.equity / first.equity - 1) * 100;

  const lines: string[] = [];
  lines.push("=== paper-trading report ===");
  lines.push(`points:        ${curve.length}`);
  lines.push(`start equity:  $${money(first.equity)}`);
  lines.push(`latest equity: $${money(last.equity)}`);
  lines.push(`return:        ${ret >= 0 ? "+" : ""}${money(ret)}%`);
  lines.push(`price P&L:     $${money(last.pricePnl)}`);
  lines.push(`funding P&L:   $${money(last.fundingPnl)}`);
  lines.push(`fees:          $${money(last.fees)}`);

  const state = store.getAccountState();
  if (state && state.positions.length > 0) {
    lines.push("--- current book ---");
    for (const p of state.positions) {
      lines.push(`  ${p.size > 0 ? "long " : "short"} ${p.coin.padEnd(6)} size ${money(Math.abs(p.size))} @ ${money(p.entry)}`);
    }
  }

  const signal = store.getLatestSignal();
  if (signal && signal.scores.length > 0) {
    const top = signal.scores[0]!;
    const bottom = signal.scores[signal.scores.length - 1]!;
    lines.push("--- latest signal ---");
    lines.push(`  strongest: ${top.coin} (${money(top.score)})`);
    lines.push(`  weakest:   ${bottom.coin} (${money(bottom.score)})`);
  }
  return lines.join("\n");
}
