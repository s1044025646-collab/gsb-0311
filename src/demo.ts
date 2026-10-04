import { AnalysisInput } from "./db.js";

// 演示 1: 1 mol、300 K、1 L 起始，等温体积加倍再反向压缩回原体积。
export function demoIsothermal(): AnalysisInput {
  return {
    gas: { n: 1, gamma: 1.4 },
    initial: { T: 300, V: 0.001 },
    processes: [
      { type: "isothermal", V2: 0.002 },
      { type: "isothermal", V2: 0.001 },
    ],
    sampleCount: 3,
  };
}

// 演示 2: 两段等温 + 两段等容组成闭合过程。
export function demoCycle(): AnalysisInput {
  return {
    gas: { n: 1, gamma: 1.4 },
    initial: { T: 600, V: 0.001 },
    processes: [
      { type: "isothermal", V2: 0.002 },
      { type: "isochoric", T2: 300 },
      { type: "isothermal", V2: 0.001 },
      { type: "isochoric", T2: 600 },
    ],
    sampleCount: 2,
  };
}
