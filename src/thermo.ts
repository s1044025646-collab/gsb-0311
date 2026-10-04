// 理想气体分段过程与循环功热核算核心模块。
// 约定：气体对外做功 W 为正；外界向气体传热 Q 为正；Q = ΔU + W。
// 定比热理想气体：Cv = R / (gamma - 1)，ΔU = n·Cv·ΔT。

export const R = 8.31446261815324; // J/(mol·K)，CODATA 公布值
export const CONSTANTS_VERSION = "R=8.31446261815324(CODATA2018)";

export interface GasState {
  P: number; // Pa
  V: number; // m^3
  T: number; // K
}

export type ProcessType = "isothermal" | "isobaric" | "isochoric" | "adiabatic";

export interface ProcessSpec {
  type: ProcessType;
  // 等温/等压/绝热：目标体积 V2；等容：目标温度 T2
  V2?: number;
  T2?: number;
}

export interface Limits {
  maxSegments: number;
  maxSamples: number;
  maxAmount: number; // mol
  maxVolume: number; // m^3
  maxTemperature: number; // K
}

export const DEFAULT_LIMITS: Limits = {
  maxSegments: 64,
  maxSamples: 200,
  maxAmount: 1e6,
  maxVolume: 1e9,
  maxTemperature: 1e6,
};

export class ThermoError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function err(code: string, message: string): never {
  throw new ThermoError(code, message);
}

function isFiniteNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

export function validateParams(n: number, gamma: number, limits: Limits): void {
  if (!isFiniteNum(n)) err("NOT_FINITE", "物质的量 n 必须为有限数");
  if (!isFiniteNum(gamma)) err("NOT_FINITE", "比热比 gamma 必须为有限数");
  if (n <= 0) err("INVALID_INPUT", "物质的量 n 必须大于 0");
  if (gamma <= 1) err("INVALID_INPUT", "比热比 gamma 必须大于 1");
  if (n > limits.maxAmount) err("LIMIT_EXCEEDED", `n 超过上限 ${limits.maxAmount} mol`);
}

export function validateState(s: GasState, limits: Limits, label: string): void {
  if (!isFiniteNum(s.T) || !isFiniteNum(s.V) || !isFiniteNum(s.P))
    err("NOT_FINITE", `${label} 状态量必须为有限数`);
  if (s.T <= 0) err("INVALID_INPUT", `${label} 温度必须为正`);
  if (s.V <= 0) err("INVALID_INPUT", `${label} 体积必须为正`);
  if (s.P <= 0) err("INVALID_INPUT", `${label} 压力必须为正`);
  if (s.T > limits.maxTemperature) err("LIMIT_EXCEEDED", `${label} 温度超过上限`);
  if (s.V > limits.maxVolume) err("LIMIT_EXCEEDED", `${label} 体积超过上限`);
}

export function stateFromTV(T: number, V: number, n: number): GasState {
  return { T, V, P: (n * R * T) / V };
}

export function cv(n: number, gamma: number): number {
  return (n * R) / (gamma - 1);
}

export interface SegmentResult {
  index: number;
  type: ProcessType;
  start: GasState;
  end: GasState;
  W: number; // 气体对外做功 (J)
  dU: number; // 内能变化 (J)
  Q: number; // 吸热 (J)
  invariant: string; // 该段守恒关系说明
  samples: GasState[]; // 过程路径上的少量状态点（仅用于解释）
}

export function computeSegment(
  start: GasState,
  proc: ProcessSpec,
  n: number,
  gamma: number,
  samples: number,
  limits: Limits
): SegmentResult {
  const Cv = cv(n, gamma);
  let end: GasState;
  let W: number;
  let invariant: string;
  const sampleStates: GasState[] = [];

  switch (proc.type) {
    case "isothermal": {
      if (!isFiniteNum(proc.V2)) err("FIELD_CONFLICT", "等温过程需要目标体积 V2");
      end = stateFromTV(start.T, proc.V2, n);
      validateState(end, limits, "等温终点");
      W = n * R * start.T * Math.log(end.V / start.V);
      invariant = "T 恒定，PV = nRT = 常数";
      for (let i = 1; i <= samples; i++) {
        const f = i / (samples + 1);
        const V = start.V * Math.pow(end.V / start.V, f);
        sampleStates.push(stateFromTV(start.T, V, n));
      }
      break;
    }
    case "isobaric": {
      if (!isFiniteNum(proc.V2)) err("FIELD_CONFLICT", "等压过程需要目标体积 V2");
      const T2 = (start.T * proc.V2) / start.V; // P 恒定 => T/V 恒定
      end = stateFromTV(T2, proc.V2, n);
      validateState(end, limits, "等压终点");
      W = start.P * (end.V - start.V);
      invariant = "P 恒定，T/V = 常数";
      for (let i = 1; i <= samples; i++) {
        const f = i / (samples + 1);
        const V = start.V + (end.V - start.V) * f;
        sampleStates.push(stateFromTV((start.T * V) / start.V, V, n));
      }
      break;
    }
    case "isochoric": {
      if (!isFiniteNum(proc.T2)) err("FIELD_CONFLICT", "等容过程需要目标温度 T2");
      end = stateFromTV(proc.T2, start.V, n);
      validateState(end, limits, "等容终点");
      W = 0;
      invariant = "V 恒定，P/T = 常数，W = 0";
      for (let i = 1; i <= samples; i++) {
        const f = i / (samples + 1);
        const T = start.T + (end.T - start.T) * f;
        sampleStates.push(stateFromTV(T, start.V, n));
      }
      break;
    }
    case "adiabatic": {
      if (!isFiniteNum(proc.V2)) err("FIELD_CONFLICT", "绝热过程需要目标体积 V2");
      const g1 = gamma - 1;
      const T2 = start.T * Math.pow(start.V / proc.V2, g1); // T·V^(γ-1) 不变
      end = stateFromTV(T2, proc.V2, n);
      validateState(end, limits, "绝热终点");
      const dU0 = Cv * (end.T - start.T);
      W = -dU0; // Q = 0 => W = -ΔU
      invariant = `Q = 0，T·V^(γ-1) = ${(start.T * Math.pow(start.V, g1)).toExponential(6)} 恒定`;
      for (let i = 1; i <= samples; i++) {
        const f = i / (samples + 1);
        const V = start.V * Math.pow(end.V / start.V, f);
        const T = start.T * Math.pow(start.V / V, g1);
        sampleStates.push(stateFromTV(T, V, n));
      }
      break;
    }
    default:
      err("UNKNOWN_PROCESS_TYPE", `未知过程类型: ${String((proc as ProcessSpec).type)}`);
  }

  const dU = Cv * (end.T - start.T);
  const Q = proc.type === "adiabatic" ? 0 : dU + W;
  for (const x of [W, dU, Q])
    if (!Number.isFinite(x)) err("NOT_FINITE", "计算结果出现非有限值");

  return { index: -1, type: proc.type, start, end, W, dU, Q, invariant, samples: sampleStates };
}

export interface AnalysisInput {
  n: number;
  gamma: number;
  T1: number;
  V1: number;
  processes: ProcessSpec[];
  samples?: number;
  limits?: Partial<Limits>;
}

export interface ClosureReport {
  closed: boolean;
  absTol: number;
  relTol: number;
  dP: number;
  dV: number;
  dT: number;
  totalDUNearZero: boolean;
}

export interface AnalysisReport {
  constantsVersion: string;
  n: number;
  gamma: number;
  Cv: number;
  initial: GasState;
  segments: SegmentResult[];
  totals: { W: number; dU: number; Q: number; Qin: number; Qout: number };
  closure: ClosureReport;
  efficiency: number | null; // 仅闭合、净功为正、吸热为正时给出
  efficiencyNote: string;
}

export const ABS_TOL = 1e-6;
export const REL_TOL = 1e-9;

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= ABS_TOL + REL_TOL * Math.max(Math.abs(a), Math.abs(b));
}

export function analyze(input: AnalysisInput): AnalysisReport {
  const limits: Limits = { ...DEFAULT_LIMITS, ...(input.limits ?? {}) };
  const { n, gamma } = input;
  validateParams(n, gamma, limits);
  if (!Array.isArray(input.processes) || input.processes.length === 0)
    err("INVALID_INPUT", "过程序列不能为空");
  if (input.processes.length > limits.maxSegments)
    err("LIMIT_EXCEEDED", `段数超过上限 ${limits.maxSegments}`);
  const samples = input.samples ?? 4;
  if (!Number.isInteger(samples) || samples < 0 || samples > limits.maxSamples)
    err("LIMIT_EXCEEDED", `取样数须为 0..${limits.maxSamples} 的整数`);

  const initial = stateFromTV(input.T1, input.V1, n);
  validateState(initial, limits, "初态");

  const Cv = cv(n, gamma);
  const segments: SegmentResult[] = [];
  let cur = initial;
  input.processes.forEach((proc, i) => {
    if (!proc || typeof proc !== "object") err("INVALID_INPUT", `第 ${i + 1} 段过程定义无效`);
    if (proc.V2 !== undefined && proc.T2 !== undefined)
      err("FIELD_CONFLICT", `第 ${i + 1} 段同时指定了 V2 与 T2`);
    if (proc.V2 === undefined && proc.T2 === undefined)
      err("FIELD_CONFLICT", `第 ${i + 1} 段缺少目标量（V2 或 T2）`);
    const seg = computeSegment(cur, proc, n, gamma, samples, limits);
    seg.index = i + 1;
    segments.push(seg);
    cur = seg.end; // 下一段起点必须为本段终点
  });

  const W = segments.reduce((s, x) => s + x.W, 0);
  const Q = segments.reduce((s, x) => s + x.Q, 0);
  // 内能变化独立用起终温度核对：ΔU = n·Cv·(T_end - T_start)
  const dU = Cv * (cur.T - initial.T);
  const Qin = segments.reduce((s, x) => s + (x.Q > 0 ? x.Q : 0), 0);
  const Qout = segments.reduce((s, x) => s + (x.Q < 0 ? -x.Q : 0), 0);

  const last = cur;
  const closed =
    closeEnough(last.P, initial.P) &&
    closeEnough(last.V, initial.V) &&
    closeEnough(last.T, initial.T);
  const closure: ClosureReport = {
    closed,
    absTol: ABS_TOL,
    relTol: REL_TOL,
    dP: last.P - initial.P,
    dV: last.V - initial.V,
    dT: last.T - initial.T,
    totalDUNearZero: Math.abs(dU) <= ABS_TOL + REL_TOL * Math.max(1, Math.abs(Cv * initial.T)),
  };

  let efficiency: number | null = null;
  let efficiencyNote: string;
  if (closed && W > 0 && Qin > 0) {
    efficiency = W / Qin;
    efficiencyNote = "闭合循环且净输出功与吸热总量均为正，η = W_net / Q_in";
  } else {
    const reasons: string[] = [];
    if (!closed) reasons.push("路径未闭合");
    if (W <= 0) reasons.push("净输出功非正");
    if (Qin <= 0) reasons.push("吸热总量非正");
    efficiencyNote = `不适用：${reasons.join("、")}，不报告循环效率`;
  }

  return {
    constantsVersion: CONSTANTS_VERSION,
    n,
    gamma,
    Cv,
    initial,
    segments,
    totals: { W, dU, Q, Qin, Qout },
    closure,
    efficiency,
    efficiencyNote,
  };
}
