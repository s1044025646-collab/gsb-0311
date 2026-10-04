import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { analyze, R, ThermoError, cv } from "../src/thermo";
import { Store } from "../src/db";

const GAMMA = 1.4;

function nearly(a: number, b: number, rel = 1e-9): void {
  assert.ok(
    Math.abs(a - b) <= 1e-6 + rel * Math.max(Math.abs(a), Math.abs(b)),
    `${a} != ${b}`
  );
}

test("等温膨胀：W = nRT ln(V2/V1)，Q = W，ΔU = 0", () => {
  const r = analyze({
    n: 1, gamma: GAMMA, T1: 300, V1: 0.01,
    processes: [{ type: "isothermal", V2: 0.02 }],
  });
  const W = 1 * R * 300 * Math.LN2;
  nearly(r.segments[0].W, W);
  nearly(r.segments[0].Q, W);
  nearly(r.segments[0].dU, 0);
  nearly(r.segments[0].end.P, (1 * R * 300) / 0.02);
});

test("等温压缩取相反符号", () => {
  const r = analyze({
    n: 1, gamma: GAMMA, T1: 300, V1: 0.02,
    processes: [{ type: "isothermal", V2: 0.01 }],
  });
  nearly(r.segments[0].W, -1 * R * 300 * Math.LN2);
  assert.ok(r.segments[0].Q < 0);
});

test("等压过程：W = P(V2-V1)，手算核对", () => {
  const r = analyze({
    n: 2, gamma: GAMMA, T1: 300, V1: 0.05,
    processes: [{ type: "isobaric", V2: 0.08 }],
  });
  const P = (2 * R * 300) / 0.05;
  nearly(r.segments[0].W, P * 0.03);
  nearly(r.segments[0].end.T, 300 * (0.08 / 0.05));
  const Cv = cv(2, GAMMA);
  nearly(r.segments[0].dU, Cv * (r.segments[0].end.T - 300));
  nearly(r.segments[0].Q, r.segments[0].dU + r.segments[0].W);
});

test("等容过程：W = 0，Q = ΔU", () => {
  const r = analyze({
    n: 1, gamma: GAMMA, T1: 300, V1: 0.01,
    processes: [{ type: "isochoric", T2: 450 }],
  });
  assert.equal(r.segments[0].W, 0);
  nearly(r.segments[0].Q, cv(1, GAMMA) * 150);
  nearly(r.segments[0].end.P, (1 * R * 450) / 0.01);
});

test("绝热过程：T·V^(γ-1) 恒定，Q = 0，W = -ΔU", () => {
  const r = analyze({
    n: 1, gamma: GAMMA, T1: 300, V1: 0.01,
    processes: [{ type: "adiabatic", V2: 0.02 }],
  });
  const T2 = 300 * Math.pow(0.01 / 0.02, GAMMA - 1);
  nearly(r.segments[0].end.T, T2);
  assert.equal(r.segments[0].Q, 0);
  nearly(r.segments[0].W, -cv(1, GAMMA) * (T2 - 300));
  // 绝热恒量核对
  const k1 = r.segments[0].start.T * Math.pow(r.segments[0].start.V, GAMMA - 1);
  const k2 = r.segments[0].end.T * Math.pow(r.segments[0].end.V, GAMMA - 1);
  nearly(k1, k2);
  // 取样点也满足恒量
  for (const p of r.segments[0].samples) nearly(p.T * Math.pow(p.V, GAMMA - 1), k1, 1e-9);
});

test("零变化过程：等温到相同体积 W=0", () => {
  const r = analyze({
    n: 1, gamma: GAMMA, T1: 300, V1: 0.01,
    processes: [{ type: "isothermal", V2: 0.01 }],
  });
  nearly(r.segments[0].W, 0);
  nearly(r.segments[0].Q, 0);
});

test("连续段衔接：每段起点等于前段终点，不重用最初温度", () => {
  const r = analyze({
    n: 1, gamma: GAMMA, T1: 300, V1: 0.01,
    processes: [
      { type: "isobaric", V2: 0.02 }, // 升温到 600 K
      { type: "isothermal", V2: 0.04 }, // 必须在 600 K 下等温
    ],
  });
  assert.deepEqual(r.segments[1].start, r.segments[0].end);
  nearly(r.segments[1].start.T, 600);
  nearly(r.segments[1].W, 1 * R * 600 * Math.log(2));
});

test("闭合循环：两等温 + 两等容，ΔU≈0，η = 1 - T冷/T热", () => {
  const r = analyze({
    n: 1, gamma: GAMMA, T1: 600, V1: 0.01,
    processes: [
      { type: "isothermal", V2: 0.02 },
      { type: "isochoric", T2: 300 },
      { type: "isothermal", V2: 0.01 },
      { type: "isochoric", T2: 600 },
    ],
  });
  assert.equal(r.closure.closed, true);
  assert.ok(r.closure.totalDUNearZero);
  // 独立用起终温度核对累计内能
  nearly(r.totals.dU, cv(1, GAMMA) * (r.segments[3].end.T - 600));
  // 总 Q - 总 W 核对（第一定律）
  nearly(r.totals.Q - r.totals.W, r.totals.dU);
  const Wnet = R * 600 * Math.LN2 - R * 300 * Math.LN2;
  nearly(r.totals.W, Wnet);
  const Qin = R * 600 * Math.LN2 + cv(1, GAMMA) * 300;
  nearly(r.totals.Qin, Qin);
  nearly(r.efficiency!, Wnet / Qin);
  assert.ok(r.efficiency! > 0 && r.efficiency! < 1);
});

test("开放路径：不报告效率", () => {
  const r = analyze({
    n: 1, gamma: GAMMA, T1: 300, V1: 0.01,
    processes: [{ type: "isothermal", V2: 0.02 }],
  });
  assert.equal(r.closure.closed, false);
  assert.equal(r.efficiency, null);
  assert.match(r.efficiencyNote, /不适用/);
});

test("非法输入被拒绝", () => {
  const bad: Array<[unknown, RegExp]> = [
    [{ n: 0, gamma: 1.4, T1: 300, V1: 0.01, processes: [{ type: "isothermal", V2: 0.02 }] }, /n 必须大于 0/],
    [{ n: 1, gamma: 1, T1: 300, V1: 0.01, processes: [{ type: "isothermal", V2: 0.02 }] }, /gamma 必须大于 1/],
    [{ n: 1, gamma: 1.4, T1: -5, V1: 0.01, processes: [{ type: "isothermal", V2: 0.02 }] }, /温度必须为正/],
    [{ n: 1, gamma: 1.4, T1: 300, V1: 0.01, processes: [{ type: "isothermal", V2: -1 }] }, /体积必须为正/],
    [{ n: 1, gamma: 1.4, T1: 300, V1: 0.01, processes: [{ type: "weird", V2: 0.02 }] }, /未知过程类型/],
    [{ n: 1, gamma: 1.4, T1: 300, V1: 0.01, processes: [{ type: "isothermal", V2: 0.02, T2: 300 }] }, /同时指定/],
    [{ n: 1, gamma: 1.4, T1: 300, V1: 0.01, processes: [{ type: "isothermal" }] }, /缺少目标量/],
    [{ n: NaN, gamma: 1.4, T1: 300, V1: 0.01, processes: [{ type: "isothermal", V2: 0.02 }] }, /有限数/],
    [{ n: 1, gamma: 1.4, T1: 300, V1: 0.01, processes: [] }, /不能为空/],
  ];
  for (const [input, re] of bad) {
    assert.throws(() => analyze(input as never), (e: unknown) => {
      assert.ok(e instanceof ThermoError);
      assert.match((e as Error).message, re);
      return true;
    });
  }
});

test("段数上限", () => {
  const processes = Array.from({ length: 65 }, () => ({ type: "isochoric" as const, T2: 300 }));
  assert.throws(
    () => analyze({ n: 1, gamma: GAMMA, T1: 300, V1: 0.01, processes }),
    (e: unknown) => e instanceof ThermoError && (e as ThermoError).code === "LIMIT_EXCEEDED"
  );
});

test("SQLite 冻结与重启后可读", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "igcycle-"));
  const dbPath = path.join(dir, "test.db");
  const input = {
    n: 1, gamma: GAMMA, T1: 600, V1: 0.01,
    processes: [
      { type: "isothermal" as const, V2: 0.02 },
      { type: "isochoric" as const, T2: 300 },
      { type: "isothermal" as const, V2: 0.01 },
      { type: "isochoric" as const, T2: 600 },
    ],
  };
  const report = analyze(input);
  const s1 = new Store(dbPath);
  const id = s1.save(input, report, "t");
  s1.close();
  // 重新打开（模拟重启）
  const s2 = new Store(dbPath);
  const row = s2.get(id);
  assert.ok(row);
  assert.equal(row!.constantsVersion, report.constantsVersion);
  assert.deepEqual(row!.report.totals, report.totals);
  assert.equal(row!.report.closure.closed, true);
  assert.equal(s2.list().length, 1);
  s2.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
