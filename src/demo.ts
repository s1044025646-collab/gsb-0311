// 内置演示：
// 1) 1 mol、300 K 等温体积加倍，W = nRT ln2；反向压缩取相反符号。
// 2) 两段等温 + 两段等容组成闭合循环，展示各段吸放热与净功。
import { analyze, R } from "./thermo";
import { Store } from "./db";
import { renderReport } from "./format";

export function runDemo(store: Store): void {
  console.log("【演示 1】1 mol 理想气体，300 K 等温膨胀体积加倍");
  const r1 = analyze({
    n: 1,
    gamma: 1.4,
    T1: 300,
    V1: 0.01,
    processes: [{ type: "isothermal", V2: 0.02 }],
  });
  console.log(renderReport(r1));
  console.log(`理论值 nRT·ln2 = ${(1 * R * 300 * Math.LN2).toFixed(6)} J`);
  store.save({ n: 1, gamma: 1.4, T1: 300, V1: 0.01, processes: [{ type: "isothermal", V2: 0.02 }] }, r1, "demo-等温膨胀");

  console.log("\n【演示 1b】反向等温压缩（符号应相反）");
  const r1b = analyze({
    n: 1,
    gamma: 1.4,
    T1: 300,
    V1: 0.02,
    processes: [{ type: "isothermal", V2: 0.01 }],
  });
  console.log(renderReport(r1b));

  console.log("\n【演示 2】闭合循环：等温膨胀 → 等容降温 → 等温压缩 → 等容升温");
  const input2 = {
    n: 1,
    gamma: 1.4,
    T1: 600,
    V1: 0.01,
    processes: [
      { type: "isothermal" as const, V2: 0.02 }, // 高温等温膨胀，吸热
      { type: "isochoric" as const, T2: 300 }, // 等容降温，放热
      { type: "isothermal" as const, V2: 0.01 }, // 低温等温压缩，放热
      { type: "isochoric" as const, T2: 600 }, // 等容升温，吸热
    ],
  };
  const r2 = analyze(input2);
  const id2 = store.save(input2, r2, "demo-闭合循环");
  console.log(renderReport(r2, id2));
  console.log("\n演示完成，报告已写入 SQLite（data/igcycle.db），可用 history/show/explain 查看。");
}
