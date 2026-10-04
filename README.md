# 理想气体分段过程与循环功热核算后端

纯后端服务（HTTP API + CLI），用 TypeScript / Node.js / SQLite 实现，Windows 本地运行，不依赖 Docker、WSL 或任何外部在线服务。

## 物理假设

- **理想气体**：状态方程 `PV = nRT`，不处理真实气体、化学反应、流体空间分布或在线物性查询。
- **定比热**：热容比 `gamma` 为常数，定容摩尔热容 `Cv = R/(gamma-1)`，内能变化 `ΔU = n·Cv·ΔT`。
- **准静态过程**：每段均可逆，支持四类过程：
  - `isothermal` 等温到目标体积 `V2`，`W = nRT·ln(V2/V1)`
  - `isobaric` 等压到目标体积 `V2`，`W = P(V2-V1)`
  - `isochoric` 等容到目标温度 `T2`，`W = 0`
  - `adiabatic` 可逆绝热到目标体积 `V2`，`T·V^(gamma-1)` 不变，`Q = 0`，`W = -ΔU`
- **符号约定**：气体对外做功为正，外界向气体传热为正，满足 `Q = ΔU + W`。压缩自然产生负功，不做任何绝对值处理。
- **单位**：开尔文、帕斯卡、立方米、焦耳。气体常数 `R = 8.31446261815324 J/(mol·K)`（CODATA 精确值），常数版本冻结在每条分析记录中。
- **段衔接**：每段起点严格等于前一段终点，由 `PV=nRT` 与过程关系求新状态。
- **闭合与效率**：末态在绝对/相对容差（默认 `1e-6` / `1e-9`）内回到初态判定闭合，闭合时核对总内能变化接近零；仅当闭合、净输出功为正且吸热总量（只累加正 Q）为正时报告热机效率 `η = W_net / Q_in`，其余情况明确标为不适用。不会静默补充闭合末段。
- 每段可附带少量中间状态点用于解释过程；累计功一律使用解析式，不用折线面积。

## 环境要求

- Node.js 22.5+（使用内置 `node:sqlite`，启动时会打印一条 ExperimentalWarning，属正常）；建议 Node 24+。
- 仅开发依赖 `typescript` 与 `@types/node`，无运行时第三方依赖。

## 构建、测试、启动、演示

```powershell
npm install
npm run build
npm test
npm start
npm run demo
```

依次为：编译到 `dist/`、构建并运行全部单元测试、启动 HTTP API（默认自动选择空闲端口）、运行内置演示（等温加倍/反向压缩 + 等温等容闭合循环）。

## CLI

```powershell
node dist/src/cli.js serve [--port N]      # 启动 API；--port 被占用时自动回退空闲端口
node dist/src/cli.js compute input.json    # 导入过程 JSON，计算并保存分析
node dist/src/cli.js list                  # 历史分析列表
node dist/src/cli.js show <id>             # 查看报告（状态表 + 收支表）
node dist/src/cli.js segment <id> <k>      # 查看第 k 段解释
node dist/src/cli.js closure <id>          # 闭合核对
node dist/src/cli.js compare <id1> <id2>   # 比较参数版本
node dist/src/cli.js export <id> [out.json]# 导出 JSON
node dist/src/cli.js demo                  # 内置演示
```

数据库默认位于项目内 `data/gas.db`，可用环境变量 `GAS_DB` 覆盖。每次计算生成新的分析记录（冻结气体参数、初态、过程序列、常数版本与报告），更改某段即建立新分析，历史报告重启后仍可读。

输入 JSON 示例见 `examples/cycle.json`。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/analyses` | 提交输入 JSON，计算并保存，返回 `{id, report}` |
| GET | `/api/analyses` | 历史列表（含摘要） |
| GET | `/api/analyses/:id` | 查看完整报告 |
| GET | `/api/analyses/:id/segments/:k` | 查看第 k 段解释 |
| GET | `/api/analyses/:id/closure` | 闭合核对 |
| GET | `/api/analyses/:id/export` | 导出（输入 + 报告 + 常数版本） |
| GET | `/api/compare?ids=1,2` | 比较参数版本 |

错误统一返回 `{"error": {"code", "message"}}`，错误码：`INVALID_INPUT`、`NON_FINITE`、`OUT_OF_RANGE`、`UNKNOWN_PROCESS`、`CONTRADICTORY_FIELDS`、`LIMIT_EXCEEDED`、`NOT_FOUND`、`BAD_REQUEST`。

## 校验与上限

- `n > 0`、`gamma > 1`、温度与体积为正、所有输入与结果有限。
- 拒绝未知过程类型、同段同时给出 `V2` 与 `T2` 的字段矛盾、缺少目标量的过程。
- 默认上限：段数 64、每段取样 200、`n <= 1e6 mol`、`T <= 1e6 K`、`V <= 1e9 m^3`，可在输入 JSON 的 `limits` 字段中调整。
- 任何一段非法即整体拒绝，不会留下貌似完整的循环报告。

## 测试覆盖

`npm test` 覆盖：四类过程手算值、零变化过程、连续段衔接（等压后接等容不复用初温）、绝热恒量 `T·V^(γ-1)`、开放路径效率不适用、非法输入与上限、闭合循环中用起终温度独立核对累计内能变化并核对 `Q_net = W_net`、报告持久化后重开数据库可读。

## 已知限制

- 仅理想气体与定比热模型，不适合高温真实气体效应。
- 取样点仅用于解释展示，沿体积线性取值（等容段沿温度取值）。
- `node:sqlite` 在部分 Node 版本仍标记为实验特性；如需完全稳定的 API 可后续替换为 `better-sqlite3`。
