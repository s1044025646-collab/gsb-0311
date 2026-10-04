import { R, Limits } from "./constants.js";
import { ApiError } from "./errors.js";

export interface GasParams {
  n: number; // mol
  gamma: number; // 定压/定容热容比
}

export interface State {
  P: number; // Pa
  V: number; // m^3
  T: number; // K
}

export type ProcessSpec =
  | { type: "isothermal"; V2: number }
  | { type: "isobaric"; V2: number }
  | { type: "isochoric"; T2: number }
  | { type: "adiabatic"; V2: number };

export interface SegmentResult {
  index: number;
  type: ProcessSpec["type"];
  start: State;
  end: State;
  W: number; // 气体对外做功 (J)，膨胀为正
  dU: number; // 内能变化 (J)
  Q: number; // 气体吸热 (J)，Q = dU + W
  invariant: string; // 该过程保持不变的守恒关系
  samples: State[]; // 少量中间状态点，仅用于解释过程
}

export function pressureOf(gas: GasParams, T: number, V: number): number {
  return (gas.n * R * T) / V;
}

export function cvOf(gas: GasParams): number {
  return R / (gas.gamma - 1);
}

function assertFinite(value: number, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiError("NON_FINITE", `${name} 必须是有限数值，收到 ${value}`);
  }
}

export function validateGas(gas: GasParams, limits: Limits): void {
  assertFinite(gas.n, "n");
  assertFinite(gas.gamma, "gamma");
  if (gas.n <= 0) throw new ApiError("INVALID_INPUT", "n 必须大于 0");
  if (gas.gamma <= 1) throw new ApiError("INVALID_INPUT", "gamma 必须大于 1");
  if (gas.n > limits.maxAmount)
    throw new ApiError("LIMIT_EXCEEDED", `n 超过上限 ${limits.maxAmount} mol`);
}

export function validateState(state: State, limits: Limits, prefix: string): void {
  assertFinite(state.T, `${prefix}.T`);
  assertFinite(state.V, `${prefix}.V`);
  assertFinite(state.P, `${prefix}.P`);
  if (state.T <= 0) throw new ApiError("INVALID_INPUT", `${prefix} 温度必须为正`);
  if (state.V <= 0) throw new ApiError("INVALID_INPUT", `${prefix} 体积必须为正`);
  if (state.T > limits.maxTemperature)
    throw new ApiError("LIMIT_EXCEEDED", `${prefix} 温度超过上限`);
  if (state.V > limits.maxVolume)
    throw new ApiError("LIMIT_EXCEEDED", `${prefix} 体积超过上限`);
}

const PROCESS_TYPES = new Set(["isothermal", "isobaric", "isochoric", "adiabatic"]);

export function parseProcess(raw: unknown, index: number): ProcessSpec {
  if (typeof raw !== "object" || raw === null)
    throw new ApiError("INVALID_INPUT", `第 ${index} 段过程必须是对象`);
  const p = raw as Record<string, unknown>;
  if (typeof p.type !== "string" || !PROCESS_TYPES.has(p.type))
    throw new ApiError("UNKNOWN_PROCESS", `第 ${index} 段未知过程类型: ${String(p.type)}`);
  const hasV2 = p.V2 !== undefined && p.V2 !== null;
  const hasT2 = p.T2 !== undefined && p.T2 !== null;
  if (hasV2 && hasT2)
    throw new ApiError("CONTRADICTORY_FIELDS", `第 ${index} 段同时给出 V2 与 T2，字段矛盾`);
  switch (p.type) {
    case "isothermal":
    case "isobaric":
    case "adiabatic": {
      if (!hasV2)
        throw new ApiError("INVALID_INPUT", `第 ${index} 段 ${p.type} 需要目标体积 V2`);
      if (hasT2)
        throw new ApiError("CONTRADICTORY_FIELDS", `第 ${index} 段不应提供 T2`);
      const V2 = Number(p.V2);
      assertFinite(V2, `第 ${index} 段 V2`);
      if (V2 <= 0) throw new ApiError("INVALID_INPUT", `第 ${index} 段 V2 必须为正`);
      return { type: p.type, V2 };
    }
    case "isochoric": {
      if (!hasT2)
        throw new ApiError("INVALID_INPUT", `第 ${index} 段 isochoric 需要目标温度 T2`);
      const T2 = Number(p.T2);
      assertFinite(T2, `第 ${index} 段 T2`);
      if (T2 <= 0) throw new ApiError("INVALID_INPUT", `第 ${index} 段 T2 必须为正`);
      return { type: "isochoric", T2 };
    }
  }
  throw new ApiError("UNKNOWN_PROCESS", `第 ${index} 段未知过程类型`);
}

function sampleStates(
  gas: GasParams,
  spec: ProcessSpec,
  start: State,
  end: State,
  count: number,
): State[] {
  const pts: State[] = [];
  const g = gas.gamma;
  for (let i = 1; i <= count; i++) {
    const f = i / (count + 1);
    let V: number;
    let T: number;
    if (spec.type === "isochoric") {
      V = start.V;
      T = start.T + (end.T - start.T) * f;
    } else {
      // 沿体积均匀取样（对数与线性取样的差异对解释性展示不重要）
      V = start.V + (end.V - start.V) * f;
      if (spec.type === "isothermal") T = start.T;
      else if (spec.type === "isobaric") T = (start.T / start.V) * V;
      else T = start.T * Math.pow(start.V / V, g - 1);
    }
    pts.push({ P: pressureOf(gas, T, V), V, T });
  }
  return pts;
}

export function runSegment(
  gas: GasParams,
  spec: ProcessSpec,
  start: State,
  index: number,
  limits: Limits,
  sampleCount: number,
): SegmentResult {
  const g = gas.gamma;
  const nCv = gas.n * cvOf(gas);
  let end: State;
  let W: number;
  let invariant: string;

  switch (spec.type) {
    case "isothermal": {
      const T = start.T;
      const V2 = spec.V2;
      end = { P: pressureOf(gas, T, V2), V: V2, T };
      W = gas.n * R * T * Math.log(V2 / start.V);
      invariant = "T 不变，PV = 常量";
      break;
    }
    case "isobaric": {
      const P = start.P;
      const V2 = spec.V2;
      const T2 = (start.T * V2) / start.V;
      end = { P, V: V2, T: T2 };
      W = P * (V2 - start.V);
      invariant = "P 不变，V/T = 常量";
      break;
    }
    case "isochoric": {
      const V = start.V;
      const T2 = spec.T2;
      end = { P: pressureOf(gas, T2, V), V, T: T2 };
      W = 0;
      invariant = "V 不变，P/T = 常量";
      break;
    }
    case "adiabatic": {
      const V2 = spec.V2;
      const T2 = start.T * Math.pow(start.V / V2, g - 1);
      end = { P: pressureOf(gas, T2, V2), V: V2, T: T2 };
      // 可逆绝热 Q=0，W = -ΔU = nCv(T1 - T2)
      W = nCv * (start.T - T2);
      invariant = "T*V^(gamma-1) 不变，Q = 0";
      break;
    }
  }

  validateState(end, limits, `第 ${index} 段终点`);
  const dU = nCv * (end.T - start.T);
  const Q = spec.type === "adiabatic" ? 0 : dU + W;
  if (![W, dU, Q].every(Number.isFinite))
    throw new ApiError("NON_FINITE", `第 ${index} 段能量结果非有限`);

  const samples =
    sampleCount > 0 ? sampleStates(gas, spec, start, end, sampleCount) : [];
  for (const s of samples) validateState(s, limits, `第 ${index} 段取样点`);

  return { index, type: spec.type, start, end, W, dU, Q, invariant, samples };
}

export function runProcessChain(
  gas: GasParams,
  initial: { T: number; V: number },
  processes: ProcessSpec[],
  limits: Limits,
  sampleCount: number,
): SegmentResult[] {
  validateGas(gas, limits);
  if (!Array.isArray(processes) || processes.length === 0)
    throw new ApiError("INVALID_INPUT", "过程序列不能为空");
  if (processes.length > limits.maxSegments)
    throw new ApiError("LIMIT_EXCEEDED", `段数超过上限 ${limits.maxSegments}`);
  if (sampleCount < 0 || sampleCount > limits.maxSamples)
    throw new ApiError("LIMIT_EXCEEDED", `取样数须在 0..${limits.maxSamples}`);

  const start: State = {
    P: pressureOf(gas, initial.T, initial.V),
    V: initial.V,
    T: initial.T,
  };
  validateState(start, limits, "初态");

  const segments: SegmentResult[] = [];
  let current = start;
  processes.forEach((spec, i) => {
    const seg = runSegment(gas, spec, current, i, limits, sampleCount);
    segments.push(seg);
    current = seg.end; // 每段起点严格等于前一段终点
  });
  return segments;
}
