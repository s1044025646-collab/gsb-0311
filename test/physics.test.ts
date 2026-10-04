import { test } from "node:test";
import assert from "node:assert/strict";
import { R, DEFAULT_LIMITS } from "../src/constants.js";
import { buildReport } from "../src/analysis.js";
import {
  GasParams,
  ProcessSpec,
  runProcessChain,
  parseProcess,
} from "../src/physics.js";
import { ApiError } from "../src/errors.js";

const gas: GasParams = { n: 1, gamma: 1.4 };
const Cv = R / (gas.gamma - 1);

function chain(processes: ProcessSpec[], T = 300, V = 0.001, g = gas) {
  return runProcessChain(g, { T, V }, processes, DEFAULT_LIMITS, 0);
}

test("等温膨胀手算值: W = nRT ln2", () => {
  const [seg] = chain([{ type: "isothermal", V2: 0.002 }]);
  assert.ok(Math.abs(seg.W - gas.n * R * 300 * Math.log(2)) < 1e-9);
  assert.equal(seg.dU, 0);
  assert.ok(Math.abs(seg.Q - seg.W) < 1e-9);
  assert.equal(seg.end.T, 300);
  assert.ok(Math.abs(seg.end.P - (gas.n * R * 300) / 0.002) < 1e-6);
});

test("等温反向压缩符号相反", () => {
  const [a] = chain([{ type: "isothermal", V2: 0.002 }]);
  const [b] = chain([{ type: "isothermal", V2: 0.0005 }]);
  assert.ok(a.W > 0);
  assert.ok(b.W < 0);
  assert.ok(Math.abs(a.W + b.W) < 1e-9); // 对称压缩功互为相反数
});

test("等压膨胀手算值: W = P(V2-V1)", () => {
  const [seg] = chain([{ type: "isobaric", V2: 0.003 }]);
  const P = (gas.n * R * 300) / 0.001;
  assert.ok(Math.abs(seg.W - P * 0.002) < 1e-6);
  assert.equal(seg.end.T, 900);
  assert.ok(Math.abs(seg.dU - gas.n * Cv * 600) < 1e-6);
  assert.ok(Math.abs(seg.Q - (seg.dU + seg.W)) < 1e-9);
});

test("等容过程 W=0, Q=dU", () => {
  const [seg] = chain([{ type: "isochoric", T2: 450 }]);
  assert.equal(seg.W, 0);
  assert.ok(Math.abs(seg.Q - gas.n * Cv * 150) < 1e-9);
  assert.equal(seg.end.V, 0.001);
});

test("绝热过程: T*V^(g-1) 不变, Q=0, W=-dU", () => {
  const [seg] = chain([{ type: "adiabatic", V2: 0.002 }]);
  const g = gas.gamma;
  const c0 = 300 * Math.pow(0.001, g - 1);
  const c1 = seg.end.T * Math.pow(seg.end.V, g - 1);
  assert.ok(Math.abs(c0 - c1) < 1e-12);
  assert.equal(seg.Q, 0);
  assert.ok(Math.abs(seg.W + seg.dU) < 1e-9);
  assert.ok(seg.W > 0); // 绝热膨胀对外做正功
  const [comp] = chain([{ type: "adiabatic", V2: 0.0005 }]);
  assert.ok(comp.W < 0); // 绝热压缩功为负
});

test("零变化过程各量为零", () => {
  const [iso] = chain([{ type: "isothermal", V2: 0.001 }]);
  assert.equal(iso.W, 0);
  assert.equal(iso.dU, 0);
  assert.equal(iso.Q, 0);
  const [ich] = chain([{ type: "isochoric", T2: 300 }]);
  assert.equal(ich.W, 0);
  assert.equal(ich.Q, 0);
});

test("连续段衔接: 后段起点等于前段终点", () => {
  const segs = chain([
    { type: "isobaric", V2: 0.002 },
    { type: "isochoric", T2: 500 },
    { type: "adiabatic", V2: 0.004 },
  ]);
  for (let i = 1; i < segs.length; i++) {
    assert.deepEqual(segs[i].start, segs[i - 1].end);
  }
  // 等压后接等容：第二段温度从 600K 降到 500K，不得误用最初 300K
  assert.equal(segs[1].start.T, 600);
});

test("闭合循环: 总内能变化独立核对为零, Q=W", () => {
  const report = buildReport(gas, { T: 600, V: 0.001 }, [
    { type: "isothermal", V2: 0.002 },
    { type: "isochoric", T2: 300 },
    { type: "isothermal", V2: 0.001 },
    { type: "isochoric", T2: 600 },
  ], DEFAULT_LIMITS, 0);
  assert.ok(report.closure.closed);
  assert.ok(report.closure.dU_consistent);
  // 独立核对: dU = nCv(T末-T初)
  assert.ok(Math.abs(report.totals.dU) < 1e-9);
  // Q_net - W_net 应等于 dU = 0
  assert.ok(Math.abs(report.totals.Q - report.totals.W) < 1e-9);
  // 手算净功: nR ln2 * (600-300)
  const expected = gas.n * R * Math.log(2) * 300;
  assert.ok(Math.abs(report.totals.W - expected) < 1e-6);
  assert.ok(report.efficiency.applicable);
  // Q_in 含等温吸热与等容升温吸热；效率低于同温限卡诺效率 0.5
  const qIn = gas.n * R * 600 * Math.log(2) + gas.n * Cv * 300;
  assert.ok(Math.abs(report.totals.Q_in - qIn) < 1e-6);
  assert.ok(Math.abs(report.efficiency.value! - expected / qIn) < 1e-12);
  assert.ok(report.efficiency.value! < 0.5);
});

test("开放路径: 不闭合, 效率不适用", () => {
  const report = buildReport(gas, { T: 300, V: 0.001 }, [
    { type: "isothermal", V2: 0.002 },
  ], DEFAULT_LIMITS, 0);
  assert.equal(report.closure.closed, false);
  assert.equal(report.efficiency.applicable, false);
  assert.equal(report.efficiency.value, null);
});

test("非法输入被拒绝", () => {
  assert.throws(() => chain([{ type: "isothermal", V2: -1 }]), ApiError);
  assert.throws(() => chain([{ type: "isochoric", T2: 0 }]), ApiError);
  assert.throws(
    () => runProcessChain({ n: 0, gamma: 1.4 }, { T: 300, V: 1 }, [{ type: "isothermal", V2: 2 }], DEFAULT_LIMITS, 0),
    ApiError,
  );
  assert.throws(
    () => runProcessChain({ n: 1, gamma: 1 }, { T: 300, V: 1 }, [{ type: "isothermal", V2: 2 }], DEFAULT_LIMITS, 0),
    ApiError,
  );
  assert.throws(
    () => runProcessChain(gas, { T: -5, V: 1 }, [{ type: "isothermal", V2: 2 }], DEFAULT_LIMITS, 0),
    ApiError,
  );
  assert.throws(
    () => runProcessChain(gas, { T: 300, V: 1 }, [{ type: "isothermal", V2: Number.NaN } as ProcessSpec], DEFAULT_LIMITS, 0),
    ApiError,
  );
});

test("未知过程类型与字段矛盾", () => {
  assert.throws(() => parseProcess({ type: "isentropicX", V2: 1 }, 0), (e: unknown) => (e as ApiError).code === "UNKNOWN_PROCESS");
  assert.throws(() => parseProcess({ type: "isothermal", V2: 1, T2: 300 }, 0), (e: unknown) => (e as ApiError).code === "CONTRADICTORY_FIELDS");
  assert.throws(() => parseProcess({ type: "isobaric" }, 0), (e: unknown) => (e as ApiError).code === "INVALID_INPUT");
});

test("段数上限", () => {
  const many = Array.from({ length: DEFAULT_LIMITS.maxSegments + 1 }, () => ({ type: "isothermal", V2: 0.001 }) as ProcessSpec);
  assert.throws(() => chain(many), (e: unknown) => (e as ApiError).code === "LIMIT_EXCEEDED");
});
