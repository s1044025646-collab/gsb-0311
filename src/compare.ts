// 比较两个参数版本的核算结果。
import { AnalysisRow } from "./db";

export function compareReports(a: AnalysisRow, b: AnalysisRow) {
  const diffNum = (x: number, y: number) => ({ a: x, b: y, diff: y - x });
  return {
    a: { id: a.id, createdAt: a.createdAt, input: a.input },
    b: { id: b.id, createdAt: b.createdAt, input: b.input },
    totals: {
      W: diffNum(a.report.totals.W, b.report.totals.W),
      Q: diffNum(a.report.totals.Q, b.report.totals.Q),
      dU: diffNum(a.report.totals.dU, b.report.totals.dU),
      Qin: diffNum(a.report.totals.Qin, b.report.totals.Qin),
    },
    closed: { a: a.report.closure.closed, b: b.report.closure.closed },
    efficiency: { a: a.report.efficiency, b: b.report.efficiency },
    constantsVersion: { a: a.constantsVersion, b: b.constantsVersion },
  };
}
