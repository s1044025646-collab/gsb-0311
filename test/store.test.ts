import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../src/db.js";
import { demoCycle } from "../src/demo.js";

test("报告持久化: 重开数据库后原报告可读", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gasdb-"));
  const dbPath = path.join(dir, "t.db");
  try {
    const s1 = new Store(dbPath);
    const { id, report } = s1.createAnalysis(demoCycle());
    s1.close();
    const s2 = new Store(dbPath);
    const { report: loaded } = s2.get(id);
    assert.deepEqual(loaded.totals, report.totals);
    assert.equal(loaded.closure.closed, true);
    const list = s2.list();
    assert.equal(list.length, 1);
    const cmp = s2.compare([id, id]);
    assert.equal((cmp as { analyses: unknown[] }).analyses.length, 2);
    s2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
