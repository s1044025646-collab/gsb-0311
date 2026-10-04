// CLI 入口：compute / history / show / explain / closure / compare / export / demo / serve
import * as fs from "node:fs";
import * as path from "node:path";
import { analyze, AnalysisInput, ThermoError } from "./thermo";
import { Store } from "./db";
import { renderReport, renderSegment } from "./format";
import { compareReports } from "./compare";
import { startServer } from "./api";
import { runDemo } from "./demo";

function usage(): void {
  console.log(`理想气体分段过程与循环功热核算 CLI

用法: node dist/cli.js <命令> [参数]

命令:
  compute <input.json> [--name 名称] [--no-save]   导入过程并计算（默认保存为新分析）
  history [limit]                                   列出历史分析
  show <id>                                         查看分析报告
  explain <id> <段号>                               查看某段解释（含取样状态点）
  closure <id>                                      核对闭合
  compare <idA> <idB>                               比较两个参数版本
  export <id> [输出文件.json]                        JSON 导出
  demo                                              运行内置演示
  serve [--port N]                                  启动 HTTP API（默认自动选空闲端口）
`);
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function requireRow(store: Store, id: number) {
  const row = store.get(id);
  if (!row) throw new ThermoError("NOT_FOUND", `分析 #${id} 不存在`);
  return row;
}

export async function main(argv: string[]): Promise<void> {
  const [cmd, ...args] = argv;
  const store = new Store();
  try {
    switch (cmd) {
      case "compute": {
        const file = args[0];
        if (!file) throw new ThermoError("INVALID_INPUT", "缺少输入文件路径");
        const input = JSON.parse(fs.readFileSync(file, "utf8")) as AnalysisInput;
        const report = analyze(input);
        const noSave = args.includes("--no-save");
        const id = noSave ? undefined : store.save(input, report, argValue(args, "--name"));
        console.log(renderReport(report, id));
        break;
      }
      case "history": {
        const rows = store.list(Number(args[0] ?? 50));
        for (const r of rows)
          console.log(
            `#${r.id}\t${r.createdAt}\t${r.name ?? "-"}\t段数=${r.report.segments.length}\t闭合=${r.report.closure.closed ? "是" : "否"}\tη=${r.report.efficiency ?? "不适用"}`
          );
        break;
      }
      case "show": {
        const row = requireRow(store, Number(args[0]));
        console.log(renderReport(row.report, row.id));
        break;
      }
      case "explain": {
        const row = requireRow(store, Number(args[0]));
        console.log(renderSegment(row.report, Number(args[1])));
        break;
      }
      case "closure": {
        const row = requireRow(store, Number(args[0]));
        console.log(JSON.stringify(row.report.closure, null, 2));
        break;
      }
      case "compare": {
        const a = requireRow(store, Number(args[0]));
        const b = requireRow(store, Number(args[1]));
        console.log(JSON.stringify(compareReports(a, b), null, 2));
        break;
      }
      case "export": {
        const row = requireRow(store, Number(args[0]));
        const out = args[1] ?? path.join(process.cwd(), `analysis-${row.id}.json`);
        fs.writeFileSync(out, JSON.stringify(row, null, 2), "utf8");
        console.log(`已导出: ${out}`);
        break;
      }
      case "demo": {
        runDemo(store);
        break;
      }
      case "serve": {
        const portArg = argValue(args, "--port");
        const envPort = process.env.PORT ? Number(process.env.PORT) : undefined;
        const port = portArg ? Number(portArg) : envPort ?? 0; // 0 = 自动选空闲端口
        const { port: actual } = await startServer(store, port);
        console.log(`API 已启动: http://127.0.0.1:${actual}/api （Ctrl+C 退出）`);
        return; // 保持进程运行，不关闭 store
      }
      default:
        usage();
        if (cmd) process.exitCode = 1;
    }
  } finally {
    if (argv[0] !== "serve") store.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    if (e instanceof ThermoError) {
      console.error(`错误 [${e.code}]: ${e.message}`);
    } else {
      console.error(e);
    }
    process.exitCode = 1;
  });
}
