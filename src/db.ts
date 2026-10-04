// SQLite 持久化：冻结气体参数、初态、过程序列、常数版本与完整报告。
// 任何参数或过程变更都产生一条新分析记录，历史不可变。
import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";
import * as fs from "node:fs";
import { AnalysisInput, AnalysisReport, CONSTANTS_VERSION } from "./thermo";

export interface AnalysisRow {
  id: number;
  createdAt: string;
  name: string | null;
  constantsVersion: string;
  input: AnalysisInput;
  report: AnalysisReport;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const p = dbPath ?? path.join(process.cwd(), "data", "igcycle.db");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    this.db = new DatabaseSync(p);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        name TEXT,
        constants_version TEXT NOT NULL,
        input_json TEXT NOT NULL,
        report_json TEXT NOT NULL
      );
    `);
  }

  save(input: AnalysisInput, report: AnalysisReport, name?: string): number {
    const stmt = this.db.prepare(
      "INSERT INTO analyses (created_at, name, constants_version, input_json, report_json) VALUES (?, ?, ?, ?, ?)"
    );
    const res = stmt.run(
      new Date().toISOString(),
      name ?? null,
      CONSTANTS_VERSION,
      JSON.stringify(input),
      JSON.stringify(report)
    );
    return Number(res.lastInsertRowid);
  }

  get(id: number): AnalysisRow | null {
    const row = this.db
      .prepare("SELECT * FROM analyses WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.toRow(row) : null;
  }

  list(limit = 50): AnalysisRow[] {
    const rows = this.db
      .prepare("SELECT * FROM analyses ORDER BY id DESC LIMIT ?")
      .all(limit) as unknown as Record<string, unknown>[];
    return rows.map((r) => this.toRow(r));
  }

  private toRow(row: Record<string, unknown>): AnalysisRow {
    return {
      id: row.id as number,
      createdAt: row.created_at as string,
      name: (row.name as string) ?? null,
      constantsVersion: row.constants_version as string,
      input: JSON.parse(row.input_json as string) as AnalysisInput,
      report: JSON.parse(row.report_json as string) as AnalysisReport,
    };
  }

  close(): void {
    this.db.close();
  }
}
