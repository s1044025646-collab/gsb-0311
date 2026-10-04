import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { CONSTANTS_VERSION, DEFAULT_LIMITS, Limits } from "./constants.js";
import { ApiError } from "./errors.js";
import { buildReport, Report } from "./analysis.js";
import { GasParams, ProcessSpec, parseProcess } from "./physics.js";

export interface AnalysisInput {
  gas: GasParams;
  initial: { T: number; V: number };
  processes: unknown[];
  sampleCount?: number;
  limits?: Partial<Limits>;
}

export interface AnalysisRow {
  id: number;
  created_at: string;
  constants_version: string;
  input: string;
  report: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        constants_version TEXT NOT NULL,
        input TEXT NOT NULL,
        report TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  createAnalysis(input: AnalysisInput): { id: number; report: Report } {
    const limits: Limits = { ...DEFAULT_LIMITS, ...(input.limits ?? {}) };
    const gas: GasParams = {
      n: Number(input.gas?.n),
      gamma: Number(input.gas?.gamma),
    };
    const initial = { T: Number(input.initial?.T), V: Number(input.initial?.V) };
    if (!Array.isArray(input.processes))
      throw new ApiError("INVALID_INPUT", "processes 必须是数组");
    const processes: ProcessSpec[] = input.processes.map((p, i) => parseProcess(p, i));
    const sampleCount = input.sampleCount ?? 5;

    const report = buildReport(gas, initial, processes, limits, sampleCount);
    const frozenInput = JSON.stringify({ gas, initial, processes, sampleCount, limits });
    const stmt = this.db.prepare(
      "INSERT INTO analyses (constants_version, input, report) VALUES (?, ?, ?)",
    );
    const result = stmt.run(CONSTANTS_VERSION, frozenInput, JSON.stringify(report));
    return { id: Number(result.lastInsertRowid), report };
  }

  list(): Array<Omit<AnalysisRow, "report"> & { summary: unknown }> {
    const rows = this.db
      .prepare("SELECT id, created_at, constants_version, input, report FROM analyses ORDER BY id")
      .all() as unknown as AnalysisRow[];
    return rows.map((r) => {
      const report = JSON.parse(r.report) as Report;
      return {
        id: r.id,
        created_at: r.created_at,
        constants_version: r.constants_version,
        input: JSON.parse(r.input),
        summary: {
          segments: report.segments.length,
          closed: report.closure.closed,
          W: report.totals.W,
          Q: report.totals.Q,
          efficiency: report.efficiency,
        },
      };
    });
  }

  get(id: number): { row: AnalysisRow; report: Report } {
    const row = this.db
      .prepare("SELECT * FROM analyses WHERE id = ?")
      .get(id) as unknown as AnalysisRow | undefined;
    if (!row) throw new ApiError("NOT_FOUND", `分析 ${id} 不存在`, 404);
    return { row, report: JSON.parse(row.report) as Report };
  }

  compare(ids: number[]): unknown {
    const entries = ids.map((id) => {
      const { row, report } = this.get(id);
      return {
        id,
        created_at: row.created_at,
        constants_version: row.constants_version,
        gas: report.gas,
        initial: report.initial,
        processes: report.segments.map((s) => ({ type: s.type, end: s.end })),
        totals: report.totals,
        closed: report.closure.closed,
        efficiency: report.efficiency,
      };
    });
    const deltas: Record<string, number> = {};
    if (entries.length === 2) {
      const [a, b] = entries;
      deltas.dW = b.totals.W - a.totals.W;
      deltas.dQ = b.totals.Q - a.totals.Q;
      const ea = a.efficiency.value;
      const eb = b.efficiency.value;
      if (ea !== null && eb !== null) deltas.dEfficiency = eb - ea;
    }
    return { analyses: entries, deltas };
  }
}
