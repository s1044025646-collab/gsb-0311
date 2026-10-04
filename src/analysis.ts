import { Limits } from "./constants.js";
import {
  GasParams,
  ProcessSpec,
  SegmentResult,
  State,
  cvOf,
  runProcessChain,
} from "./physics.js";

export interface ClosureCheck {
  closed: boolean;
  absTol: number;
  relTol: number;
  deviations: { P: number; V: number; T: number };
  dU_total: number;
  dU_consistent: boolean;
}

export interface Report {
  gas: GasParams;
  initial: State;
  final: State;
  segments: SegmentResult[];
  totals: {
    W: number;
    Q: number;
    dU: number;
    Q_in: number;
    Q_out: number;
  };
  energyBalanceResidual: number;
  closure: ClosureCheck;
  efficiency: { applicable: boolean; value: number | null; reason: string };
}

function withinTol(a: number, b: number, absTol: number, relTol: number): boolean {
  return Math.abs(a - b) <= absTol + relTol * Math.abs(b);
}

export function buildReport(
  gas: GasParams,
  initial: { T: number; V: number },
  processes: ProcessSpec[],
  limits: Limits,
  sampleCount: number,
  absTol = 1e-6,
  relTol = 1e-9,
): Report {
  const segments = runProcessChain(gas, initial, processes, limits, sampleCount);
  const first = segments[0].start;
  const last = segments[segments.length - 1].end;

  const W = segments.reduce((s, x) => s + x.W, 0);
  const Q = segments.reduce((s, x) => s + x.Q, 0);
  const Q_in = segments.reduce((s, x) => s + (x.Q > 0 ? x.Q : 0), 0);
  const Q_out = segments.reduce((s, x) => s + (x.Q < 0 ? x.Q : 0), 0);
  // 独立用起终温度核对累计内能变化，而非复用逐段明细
  const dU = gas.n * cvOf(gas) * (last.T - first.T);

  const deviations = {
    P: Math.abs(last.P - first.P),
    V: Math.abs(last.V - first.V),
    T: Math.abs(last.T - first.T),
  };
  const closed =
    withinTol(last.P, first.P, absTol, relTol) &&
    withinTol(last.V, first.V, absTol, relTol) &&
    withinTol(last.T, first.T, absTol, relTol);
  const dU_consistent = Math.abs(dU) <= absTol + relTol * Math.abs(Q_in || 1);

  let efficiency: Report["efficiency"];
  if (!closed) {
    efficiency = { applicable: false, value: null, reason: "路径未闭合，非循环，效率不适用" };
  } else if (W <= 0) {
    efficiency = { applicable: false, value: null, reason: "净输出功非正，不是热机循环" };
  } else if (Q_in <= 0) {
    efficiency = { applicable: false, value: null, reason: "吸热总量非正，效率不适用" };
  } else {
    efficiency = { applicable: true, value: W / Q_in, reason: "闭合热机循环：eta = W_net / Q_in" };
  }

  return {
    gas,
    initial: first,
    final: last,
    segments,
    totals: { W, Q, dU, Q_in, Q_out },
    energyBalanceResidual: Q - dU - W,
    closure: { closed, absTol, relTol, deviations, dU_total: dU, dU_consistent },
    efficiency,
  };
}
