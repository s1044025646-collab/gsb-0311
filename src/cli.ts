import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { Store } from "./db.js";
import { startServer } from "./api.js";
import { formatReport, formatSegment } from "./format.js";
import { demoIsothermal, demoCycle } from "./demo.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = process.env.GAS_DB ?? path.join(DATA_DIR, "gas.db");

function usage(): void {
  console.log(`理想气体分段过程与循环功热核算 CLI
用法: node dist/src/cli.js <命令> [参数]
命令:
  serve [--port N]                启动 HTTP API（默认自动选择空闲端口）
  compute <input.json>            导入过程 JSON，计算并保存分析
  list                            列出历史分析
  show <id>                       查看分析报告
  segment <id> <k>                查看第 k 段解释
  closure <id>                    核对闭合
  compare <id1> <id2> [...]       比较参数版本
  export <id> [out.json]          导出 JSON
  demo                            运行内置演示（等温加倍 + 闭合循环）
环境变量: GAS_DB 指定数据库路径（默认 ./data/gas.db）`);
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  const store = new Store(DB_PATH);
  try {
    switch (cmd) {
      case "serve": {
        const pi = args.indexOf("--port");
        const port = pi >= 0 ? Number(args[pi + 1]) : undefined;
        const { port: actual } = await startServer(store, port);
        console.log(`API 已启动: http://localhost:${actual}/api/analyses (数据库 ${DB_PATH})`);
        return;
      }
      case "compute": {
        const input = JSON.parse(readFileSync(args[0], "utf8"));
        const { id, report } = store.createAnalysis(input);
        console.log(formatReport(report, id));
        break;
      }
      case "list": {
        for (const a of store.list()) {
          const s = a.summary as { segments: number; closed: boolean; W: number };
          console.log(
            `#${a.id} ${a.created_at} [${a.constants_version}] 段数=${s.segments} 闭合=${s.closed} W=${s.W.toFixed(4)} J`,
          );
        }
        break;
      }
      case "show": {
        const { report } = store.get(Number(args[0]));
        console.log(formatReport(report, Number(args[0])));
        break;
      }
      case "segment": {
        const { report } = store.get(Number(args[0]));
        const seg = report.segments[Number(args[1])];
        if (!seg) throw new Error(`段 ${args[1]} 不存在`);
        console.log(formatSegment(seg));
        break;
      }
      case "closure": {
        const { report } = store.get(Number(args[0]));
        console.log(JSON.stringify(report.closure, null, 2));
        break;
      }
      case "compare": {
        const ids = args.map(Number);
        console.log(JSON.stringify(store.compare(ids), null, 2));
        break;
      }
      case "export": {
        const id = Number(args[0]);
        const { row, report } = store.get(id);
        const payload = JSON.stringify(
          { id, created_at: row.created_at, constants_version: row.constants_version, input: JSON.parse(row.input), report },
          null,
          2,
        );
        if (args[1]) {
          writeFileSync(args[1], payload, "utf8");
          console.log(`已导出到 ${args[1]}`);
        } else {
          console.log(payload);
        }
        break;
      }
      case "demo": {
        const a = store.createAnalysis(demoIsothermal());
        console.log("=== 演示 1: 1 mol, 300 K 等温体积加倍再反向压缩 ===");
        console.log(formatReport(a.report, a.id));
        console.log("");
        const b = store.createAnalysis(demoCycle());
        console.log("=== 演示 2: 两段等温 + 两段等容闭合循环 ===");
        console.log(formatReport(b.report, b.id));
        break;
      }
      default:
        usage();
        if (cmd) process.exitCode = 1;
    }
  } finally {
    if (cmd !== "serve") store.close();
  }
}

main().catch((err) => {
  const e = err as { code?: string; message?: string };
  console.error(`错误 [${e.code ?? "INTERNAL"}]: ${e.message ?? String(err)}`);
  process.exitCode = 1;
});
