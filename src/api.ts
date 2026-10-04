import http from "node:http";
import { AddressInfo } from "node:net";
import { ApiError } from "./errors.js";
import { Store, AnalysisInput } from "./db.js";

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError("BAD_REQUEST", "请求体不是合法 JSON");
  }
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(text);
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);

      if (req.method === "POST" && url.pathname === "/api/analyses") {
        const body = (await readBody(req)) as AnalysisInput;
        const { id, report } = store.createAnalysis(body);
        return send(res, 201, { id, report });
      }
      if (req.method === "GET" && url.pathname === "/api/analyses") {
        return send(res, 200, { analyses: store.list() });
      }
      if (req.method === "GET" && url.pathname === "/api/compare") {
        const ids = (url.searchParams.get("ids") ?? "")
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((x) => Number.isInteger(x));
        if (ids.length < 2) throw new ApiError("BAD_REQUEST", "compare 需要至少两个 id，如 ?ids=1,2");
        return send(res, 200, store.compare(ids));
      }
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "analyses" && parts[2]) {
        const id = Number(parts[2]);
        if (!Number.isInteger(id)) throw new ApiError("BAD_REQUEST", "id 必须是整数");
        const { row, report } = store.get(id);
        if (parts[3] === "segments" && parts[4] !== undefined) {
          const k = Number(parts[4]);
          const seg = report.segments[k];
          if (!seg) throw new ApiError("NOT_FOUND", `段 ${k} 不存在`, 404);
          return send(res, 200, { id, segment: seg });
        }
        if (parts[3] === "closure") return send(res, 200, { id, closure: report.closure });
        if (parts[3] === "export") {
          return send(res, 200, {
            id,
            created_at: row.created_at,
            constants_version: row.constants_version,
            input: JSON.parse(row.input),
            report,
          });
        }
        if (parts.length === 3) return send(res, 200, { id, report });
      }
      throw new ApiError("NOT_FOUND", `未知路由 ${req.method} ${url.pathname}`, 404);
    } catch (err) {
      if (err instanceof ApiError) {
        return send(res, err.status, { error: { code: err.code, message: err.message } });
      }
      return send(res, 500, {
        error: { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) },
      });
    }
  });
}

export async function startServer(
  store: Store,
  preferredPort?: number,
): Promise<{ server: http.Server; port: number }> {
  const server = createServer(store);
  const tryListen = (port: number): Promise<number> =>
    new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, () => resolve((server.address() as AddressInfo).port));
    });
  let port: number;
  if (preferredPort) {
    try {
      port = await tryListen(preferredPort);
    } catch {
      port = await tryListen(0); // 端口被占用时回退到空闲端口
    }
  } else {
    port = await tryListen(0);
  }
  return { server, port };
}
