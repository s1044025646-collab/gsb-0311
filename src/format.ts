// 终端表格化展示：状态表与功热收支表。
import { AnalysisReport, GasState, SegmentResult } from "./thermo";

function num(x: number, digits = 6): string {
  if (!Number.isFinite(x)) return String(x);
  const a = Math.abs(x);
  if (a !== 0 && (a >= 1e6 || a < 1e-4)) return x.toExponential(4);
  return Number(x.toFixed(digits)).toString();
}

function stateStr(s: GasState): string {
  return `P=${num(s.P)} Pa, V=${num(s.V)} m^3, T=${num(s.T)} K`;
}

export function renderReport(r: AnalysisReport, id?: number): string {
  const lines: string[] = [];
  lines.push(`=== 分析报告${id !== undefined ? " #" + id : ""} ===`);
  lines.push(`常数版本: ${r.constantsVersion}`);
  lines.push(`n=${r.n} mol, gamma=${r.gamma}, Cv=${num(r.Cv)} J/K`);
  lines.push(`初态: ${stateStr(r.initial)}`);
  lines.push("");
  lines.push("段 | 类型       | 终点状态                                       | W (J)      | ΔU (J)     | Q (J)");
  lines.push("-".repeat(120));
  for (const s of r.segments) {
    lines.push(
      `${String(s.index).padEnd(3)}| ${s.type.padEnd(11)}| ${stateStr(s.end).padEnd(46)}| ${num(s.W).padStart(10)} | ${num(s.dU).padStart(10)} | ${num(s.Q).padStart(10)}`
    );
  }
  lines.push("-".repeat(120));
  lines.push(
    `合计: W=${num(r.totals.W)} J, ΔU=${num(r.totals.dU)} J, Q=${num(r.totals.Q)} J, 吸热 Q_in=${num(r.totals.Qin)} J, 放热 Q_out=${num(r.totals.Qout)} J`
  );
  lines.push(
    `闭合: ${r.closure.closed ? "是" : "否"} (ΔP=${num(r.closure.dP)}, ΔV=${num(r.closure.dV)}, ΔT=${num(r.closure.dT)}; 容差 abs=${r.closure.absTol}, rel=${r.closure.relTol})`
  );
  lines.push(
    r.efficiency !== null
      ? `热机效率 η = ${num(r.efficiency)}（${r.efficiencyNote}）`
      : `热机效率: 不适用（${r.efficiencyNote}）`
  );
  return lines.join("\n");
}

export function renderSegment(r: AnalysisReport, index: number): string {
  const s: SegmentResult | undefined = r.segments[index - 1];
  if (!s) return `段 ${index} 不存在（共 ${r.segments.length} 段）`;
  const lines: string[] = [];
  lines.push(`=== 第 ${s.index} 段：${s.type} ===`);
  lines.push(`守恒关系: ${s.invariant}`);
  lines.push(`起点: ${stateStr(s.start)}`);
  for (const [i, p] of s.samples.entries())
    lines.push(`  样本${i + 1}: ${stateStr(p)}`);
  lines.push(`终点: ${stateStr(s.end)}`);
  lines.push(`W=${num(s.W)} J, ΔU=${num(s.dU)} J, Q=${num(s.Q)} J（Q=ΔU+W 核验: ${num(s.dU + s.W)}）`);
  return lines.join("\n");
}
