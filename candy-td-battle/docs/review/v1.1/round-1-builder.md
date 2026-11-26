# Candy TD Battle V1.1 — Round 1 Builder 交付报告

## 0. 快速索引

- **候选版本**：分支 `v1-candy-td-battle`（基于基点 `82544cf562a3f64296b23a7887c65cc234b499ee` 提交）
- **改动模块**：
  - `server/index.js`（静态资源与 `/healthz` 显式 `Content-Length` + `node:zlib` gzip 预压缩与 `Vary: Accept-Encoding`）
  - `public/js/net-client.js`（`CONNECTING` 态并发 `connect()` 复用 `_connectPromise`、默认 `6000ms` 超时 `WS_CONNECT_TIMEOUT`、提前 `close`/`error` 状态清理与重试）
  - `public/js/main.js`、`public/js/ui.js`、`public/index.html`、`public/css/style.css`（`onCreateRoom`/`onJoinRoom` `try/catch/finally` 防重入禁用态、中文错误 Toast 恢复、`location.protocol === 'file:'` 显式提示）
  - `public/js/audio.js`（`sessionStorage` 读写 `try/catch` 安全降级为内存状态）
  - `tests/ws-protocol.test.js`（新增 `AC-15`、`AC-16`、`AC-18` 自动化回归测试）
- **启动方式**：
  - 日常生产启动：`npm start`（默认 `http://127.0.0.1:3000`）
  - 隔离测试启动：`PORT=3101 node server/index.js`（本次 Builder 冒烟验证端口 `3101`，已停止 PID `26080`）
- **测试命令与结果**：
  - `npm test`（`node --test tests/sim-unit.test.js tests/ws-protocol.test.js`）：**15/15 通过，0 失败**（含原有 12 项 + V1.1 新增 3 项 `AC-15`/`AC-16`/`AC-18`）
  - 本地服务冒烟验证（`PORT=3101`）：`/healthz` 返回 `200`（`Content-Length: 54`，无 `Transfer-Encoding`）；`/js/main.js`（`Accept-Encoding: gzip`）返回 `200`（`Content-Encoding: gzip`，`Content-Length: 3080`，`Vary: Accept-Encoding`）；`/ws` 建房返回 `room_state (COUNTDOWN)`
- **未验证缺口**：
  - `AC-17`（真实桌面浏览器 UI 交互、按钮禁用态视觉、断连中文 Toast 与截图）尚未在真实浏览器上下文执行，需交由 Tester/Reviewer 实操验收。

---

## 1. 实现概述

1. **服务端定长响应与 gzip 预压缩（`server/index.js`）**：
   - 新增 `sendFixedResponse()` 与 `acceptsGzip()` 辅助函数。
   - 对所有 HTTP 响应（静态资源、`/healthz`、403/404/500）均显式设置精确 `Content-Length`，避免 Node.js 退化为 `Transfer-Encoding: chunked`。
   - 对 `.html`、`.css`、`.js`、`.json`、`.svg` 及 `/healthz`，当请求头 `Accept-Encoding` 含 `gzip` 时使用 `zlib.gzipSync()` 返回 `Content-Encoding: gzip`、`Content-Length: gzBuf.length` 与 `Vary: Accept-Encoding`；非 gzip 请求返回原始 Buffer 与精确 `Content-Length`。
2. **WebSocket 建连竞态与超时治理（`public/js/net-client.js`）**：
   - 新增 `this._connectPromise` 跟踪进行中的握手；当 `ws.readyState === WebSocket.CONNECTING` 时并发调用 `connect()` 直接复用同一 Promise，直至真正触发 `open` 才 resolve。
   - 支持 `connect({ timeoutMs = 6000 } = {})`，超时主动关闭并 reject `Error('WS_CONNECT_TIMEOUT')`；`close` 或 `error` 先于 `open` 触发时同样 reject 并清空 `this.ws` 与 `this._connectPromise`，支持失败后再次点击重连。
3. **大厅按钮反馈、防重入与 `file://` 提示（`public/js/main.js`、`public/js/ui.js`、`public/index.html`、`public/css/style.css`）**：
   - `onCreateRoom` 与 `onJoinRoom` 全程包裹 `try / catch / finally`，点击后通过 `lobbyConnecting` 与 `ui.setLobbyConnecting(true, '连接中...')` 禁用大厅 4 个入口按钮防止重入；连接失败或超时立即弹出可读中文 Toast，并在 `finally` 中恢复按钮文案与可点击状态。
   - 新增 `#file-protocol-warning` 提示条，当 `location.protocol === 'file:'` 时在 `bootstrap()` 显式展示「请通过 HTTP 服务（如 `npm start`）打开，不支持直接双击本地 HTML 文件。」并跳过自动 WS 重连。
4. **音频模块存储容错（`public/js/audio.js`）**：
   - 构造函数读取 `sessionStorage` 与 `setMuted()` 写入 `sessionStorage` 均包裹 `try / catch`，在受限上下文（如 `SecurityError`）安全降级为内存静音状态，不阻塞 `CandyUI` 事件绑定。

---

## 2. AC-15 ~ AC-18 及回归自测表

| 编号 | 验证方式 | 验证结果 | 关键实测输出摘要 |
| --- | --- | --- | --- |
| **AC-15** | `npm test` 自动化测试 + 端口 `3101` 实测 | **PASS** | `/`、`/css/style.css`、`/js/main.js`、`/js/renderer.js`、`/healthz` 在 raw 与 gzip 模式下均返回 `200`、精确 `Content-Length`、无 `Transfer-Encoding: chunked`、gzip 解压与源文件逐字节一致 |
| **AC-16** | `npm test` 自动化测试 | **PASS** | 慢握手并发 `connect()` 复用同一 Promise 并等到 `OPEN` 后 `send()` 成功；挂起端口 `80ms` 超时 reject `WS_CONNECT_TIMEOUT`；提前关闭 reject `WS_CONNECT_CLOSED`；恢复后重连成功 |
| **AC-17** | 代码自查 + 端口 `3101` WS 建房冒烟 | **待 Tester 实操** | `onCreateRoom`/`onJoinRoom` 已实现禁用态、中文 Toast 与恢复；浏览器 UI 交互待 Tester 实测 |
| **AC-18** | `npm test` 自动化测试 | **PASS** | `sessionStorage.getItem/setItem` 抛出 `SecurityError` 时 `CandyAudio` 正常初始化、`toggleMute()` 在内存正确切换；`npm test` 15/15 全部通过 |
| **原有 V1 回归** | `npm test` | **PASS** | 原有 12 项仿真与 WS 协议测试（`AC-01`~`AC-13`、Round-2 回归）全部通过 |

---

## 3. 改动影响面

- **核心玩法与数值**：未改动 `server/simulation.js`、`server/room-manager.js`、`server/ai-bot.js`、`public/js/shared/constants.js`、`public/js/renderer.js`、`public/js/input.js`，塔防玩法、数值与假动作防泄密契约完全保持不变。
- **前端启动与联机链路**：仅增强静态传输头（`Content-Length` + `gzip`）、WS 握手Promise复用/超时保护、大厅按钮防重入与错误 Toast、`sessionStorage` 异常降级；不影响现有 WS 消息格式与子路径反向代理兼容。
