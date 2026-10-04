# 理想气体分段过程与循环功热核算后端

纯后端项目（API + CLI），对**固定物质的量、定比热理想气体**的准静态分段过程做状态与功热核算，并判断循环闭合与热机效率。Windows 本地运行，不依赖 Docker / WSL / 外部在线服务。

## 物理假设与约定

- 理想气体：`PV = nRT`，`R = 8.31446261815324 J/(mol·K)`（CODATA 2018 公布值，冻结于 `constantsVersion`）。
- 定比热：`Cv = R / (gamma - 1)`，`ΔU = n·Cv·ΔT`，不做真实气体修正、不查在线物性。
- 符号约定：**气体对外做功 W 为正，气体吸热 Q 为正**，满足 `Q = ΔU + W`。
- 单位：K、Pa、m³、J、mol。
- 四类准静态过程：
  - `isothermal` 等温到目标体积 `V2`：`W = nRT·ln(V2/V1)`
  - `isobaric` 等压到目标体积 `V2`：`W = P·(V2 - V1)`
  - `isochoric` 等容到目标温度 `T2`：`W = 0`
  - `adiabatic` 可逆绝热到目标体积 `V2`：`T·V^(γ-1)` 不变，`Q = 0`，`W = -ΔU`
- 每段起点强制为前一段终点（链式推进，不会每段重用最初温度）。
- 闭合判定：末态与初态的 P、V、T 均在绝对容差 `1e-6` + 相对容差 `1e-9` 内；闭合时核对总 ΔU≈0。
- 热机效率仅在「闭合 且 净输出功>0 且 吸热总量>0」时报告，`η = W_net / Q_in`（`Q_in` 只累加正 Q）；其余情况明确标为不适用。
- 每段可取少量路径状态点用于解释；**累计功一律使用解析式**，不用折线面积。

## 环境要求

- Node.js ≥ 22.5（使用内置 `node:sqlite` 与 `node:http`，无原生编译依赖）
- Windows 本地即可运行

## 快速开始

```powershell
npm install        # 仅安装 TypeScript 开发依赖
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm run demo       # 内置演示（等温加倍/反向压缩 + 闭合循环）
npm start          # 启动 HTTP API（默认自动选择空闲端口）
```

## CLI

```
node dist/src/cli.js <命令>

compute <input.json> [--name 名称] [--no-save]   导入过程并计算（默认存为新分析）
history [limit]                                   历史分析列表
show <id>                                         查看报告（状态表 + 功热收支表）
explain <id> <段号>                               某段解释（守恒关系 + 取样状态点）
closure <id>                                      核对闭合
compare <idA> <idB>                               比较两个参数版本
export <id> [输出文件.json]                        JSON 导出
demo                                              内置演示
serve [--port N]                                  启动 API（默认端口 0 = 自动选空闲端口，也可用环境变量 PORT）
```

输入文件示例（见 `examples/cycle.json`）：

```json
{
  "n": 1,
  "gamma": 1.4,
  "T1": 600,
  "V1": 0.01,
  "processes": [
    { "type": "isothermal", "V2": 0.02 },
    { "type": "isochoric", "T2": 300 },
    { "type": "isothermal", "V2": 0.01 },
    { "type": "isochoric", "T2": 600 }
  ]
}
```

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/analyses` | 计算并保存（body 同上；`"save": false` 可只算不存） |
| GET | `/api/analyses` | 历史列表 |
| GET | `/api/analyses/:id` | 完整报告 |
| GET | `/api/analyses/:id/segments/:i` | 第 i 段解释（含取样点） |
| GET | `/api/analyses/:id/closure` | 闭合核对 |
| GET | `/api/analyses/compare?a=1&b=2` | 比较两个版本 |
| GET | `/api/analyses/:id/export` | JSON 导出 |
| GET | `/api/health` | 健康检查 |

错误响应统一为 `{"error": {"code": "...", "message": "..."}}`，HTTP 400。

## 错误码

- `INVALID_INPUT`：n≤0、gamma≤1、非正温度/体积、空过程序列等
- `NOT_FINITE`：NaN / Infinity 输入或计算结果
- `FIELD_CONFLICT`：同一段同时给 `V2` 与 `T2`，或缺少目标量
- `UNKNOWN_PROCESS_TYPE`：未知过程类型
- `LIMIT_EXCEEDED`：超过段数（64）、取样数（200）或参数尺度上限
- `NOT_FOUND`：分析记录或段不存在

校验失败直接拒绝，**不会**静默补一段让路径闭合，也不会留下半截报告。

## 数据存储

- SQLite 文件位于项目内 `data/igcycle.db`。
- 每次计算冻结：气体参数、初态、过程序列、常数版本与完整报告；历史不可变，修改任何参数即产生新分析记录（可用 `compare` 对比版本）。

## 测试

`npm test` 覆盖：四类过程手算值、零变化、连续段衔接（不重用初温）、绝热恒量、闭合循环（独立用起终温度核对累计 ΔU，并核对总 Q − 总 W）、开放路径不报效率、非法输入、段数上限、SQLite 重启后可读。

## 限制

- 仅理想气体、定比热；不处理真实气体、化学反应、空间分布。
- 仅准静态过程；每段由目标体积/温度唯一确定终点。
- 不做热力学图绘制，终端仅输出状态表与收支表。
