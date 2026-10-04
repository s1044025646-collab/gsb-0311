// HTTP API：导入过程并计算、查看报告/某段解释、核对闭合、比较版本、历史、JSON 导出。
import * as http from "node:http";
import { analyze, AnalysisInput, ThermoError } from "./thermo";
import { Store } from "./db";
import { compareReports } from "./compare";

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

function sendError(res: http.ServerResponse, e: unknown): void {
  if (e instanceof ThermoError) {
    send(res, 400, { error: { code: e.code, message: e.message } });
  } else {
    send(res, 500, { error: { code: "INTERNAL", message: String(e) } });
  }
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ThermoError("INVALID_INPUT", "请求体不是合法 JSON");
  }
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean); // e.g. ["api","analyses","1","segments","2"]

      if (req.method === "GET" && url.pathname === "/api/health") {
        return send(res, 200, { ok: true });
      }

      if (req.method === "POST" && url.pathname === "/api/analyses") {
        const body = (await readBody(req)) as AnalysisInput & { name?: string; save?: boolean };
        const report = analyze(body);
        const save = body.save !== false;
        const id = save ? store.save(body, report, body.name) : null;
        return send(res, 201, { id, report });
      }

      if (req.method === "GET" && parts[0] === "api" && parts[1] === "analyses") {
        if (parts.length === 2) {
          const limit = Number(url.searchParams.get("limit") ?? 50);
          return send(res, 200, {
            items: store.list(limit).map((r) => ({
              id: r.id,
              createdAt: r.createdAt,
              name: r.name,
              constantsVersion: r.constantsVersion,
              segments: r.report.segments.length,
              closed: r.report.closure.closed,
              efficiency: r.report.efficiency,
            })),
          });
        }
        if (parts[2] === "compare") {
          const a = Number(url.searchParams.get("a"));
          const b = Number(url.searchParams.get("b"));
          const ra = store.get(a);
          const rb = store.get(b);
          if (!ra || !rb)
            return send(res, 404, { error: { code: "NOT_FOUND", message: "比较的分析记录不存在" } });
          return send(res, 200, compareReports(ra, rb));
        }
        const id = Number(parts[2]);
        const row = store.get(id);
        if (!row)
          return send(res, 404, { error: { code: "NOT_FOUND", message: `分析 #${id} 不存在` } });
        if (parts.length === 3) return send(res, 200, row);
        if (parts[3] === "segments") {
          const idx = Number(parts[4]);
          const seg = row.report.segments[idx - 1];
          if (!seg)
            return send(res, 404, { error: { code: "NOT_FOUND", message: `段 ${idx} 不存在` } });
          return send(res, 200, seg);
        }
        if (parts[3] === "closure") return send(res, 200, row.report.closure);
        if (parts[3] === "export") {
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="analysis-${id}.json"`,
          });
          return res.end(JSON.stringify(row, null, 2));
        }
      }

      send(res, 404, { error: { code: "NOT_FOUND", message: "未知路由" } });
    } catch (e) {
      sendError(res, e);
    }
  });
}

export function startServer(store: Store, port = 0): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(store);
    server.listen(port, () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      resolve({ server, port: p });
    });
  });
}
