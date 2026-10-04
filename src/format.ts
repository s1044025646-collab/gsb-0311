import { Report } from "./analysis.js";
import { SegmentResult, State } from "./physics.js";

function num(x: number): string {
  if (x === 0) return "0";
  const a = Math.abs(x);
  if (a >= 1e5 || a < 1e-2) return x.toExponential(4);
  return x.toFixed(4);
}

function stateStr(s: State): string {
  return `P=${num(s.P)} Pa, V=${num(s.V)} m^3, T=${num(s.T)} K`;
}

export function formatSegment(seg: SegmentResult): string {
  const lines = [
    `段 ${seg.index} [${seg.type}] 守恒关系: ${seg.invariant}`,
    `  起点: ${stateStr(seg.start)}`,
    `  终点: ${stateStr(seg.end)}`,
    `  W(气体对外做功)=${num(seg.W)} J  dU=${num(seg.dU)} J  Q(吸热)=${num(seg.Q)} J`,
  ];
  if (seg.samples.length > 0) {
    lines.push("  中间状态点:");
    for (const s of seg.samples) lines.push(`    ${stateStr(s)}`);
  }
  return lines.join("\n");
}

export function formatReport(report: Report, id?: number): string {
  const lines: string[] = [];
  lines.push(
    `分析${id !== undefined ? " #" + id : ""}: n=${report.gas.n} mol, gamma=${report.gas.gamma}`,
  );
  lines.push(`初态: ${stateStr(report.initial)}`);
  lines.push("");
  for (const seg of report.segments) lines.push(formatSegment(seg));
  lines.push("");
  lines.push("累计收支:");
  lines.push(`  W_net=${num(report.totals.W)} J  Q_net=${num(report.totals.Q)} J  dU=${num(report.totals.dU)} J`);
  lines.push(`  Q_in(正Q合计)=${num(report.totals.Q_in)} J  Q_out(负Q合计)=${num(report.totals.Q_out)} J`);
  lines.push(`  能量收支残差 Q-dU-W = ${report.energyBalanceResidual.toExponential(3)} J`);
  lines.push("");
  const c = report.closure;
  lines.push(
    `闭合核对: ${c.closed ? "闭合" : "未闭合"} (absTol=${c.absTol}, relTol=${c.relTol})`,
  );
  lines.push(
    `  偏差 dP=${c.deviations.P.toExponential(3)} dV=${c.deviations.V.toExponential(3)} dT=${c.deviations.T.toExponential(3)}`,
  );
  lines.push(`  总内能变化 dU=${c.dU_total.toExponential(4)} J (${c.dU_consistent ? "接近零" : "非零"})`);
  lines.push("");
  if (report.efficiency.applicable) {
    lines.push(`热机效率 eta = ${(report.efficiency.value! * 100).toFixed(4)}% (${report.efficiency.reason})`);
  } else {
    lines.push(`热机效率: 不适用 (${report.efficiency.reason})`);
  }
  return lines.join("\n");
}
