# Candy TD Battle V1.1 — Round 2 Builder 返工报告

## 0. 快速索引

- **候选版本**：分支 `v1-candy-td-battle`（基于 Round 1 提交 `4e442b65ce4a047a61caab99530d465736e3cca5` 返工提交）
- **改动模块**：
  - `public/css/style.css`（`.toast-container` 层级 `z-index: 40 -> 100`，高于 `.modal-overlay` 的 `50`）
  - `public/index.html`（新增非模块内联 `<script>` 在 `file://` 下立即显示 `#file-protocol-warning` 并禁用大厅入口按钮；`<head>` 新增内联 SVG `data:` URI `<link rel="icon">` 消除 `/favicon.ico` 404）
  - `public/js/net-client.js`（先声明 `let promise` 修复 `new WebSocket()` 同步抛错 TDZ `ReferenceError`；`close` 事件仅在 `this.ws === ws` 时清理状态与触发 `onConnectionChange(false)`，防止已超时旧连接延迟关闭污染新连接）
  - `tests/ws-protocol.test.js`（在 `AC-16` 用例中补充 `new WebSocket` 同步抛错与旧连接延迟 `close` 不破坏新连接的自动化断言）
- **启动方式**：
  - 日常生产启动：`npm start`（默认 `http://127.0.0.1:3000`）
- **测试命令与结果**：
  - `npm test`（`node --test tests/sim-unit.test.js tests/ws-protocol.test.js`）：**15/15 通过，0 失败**（未修改任何既有测试断言，仅在 `AC-16` 中追加 2 项边界断言）
- **未验证缺口**：
  - 真实浏览器 UI 视觉核验（Toast 置于 `#lobby-overlay` 之上的清晰度、`file://` 直开提示条可见性、`console.error === 0`）需由 Reviewer/Tester 在浏览器中复测确认。

---

## 1. 返工修复概述

1. **修复问题 1（必须）：大厅毛玻璃遮罩遮挡 Toast（`public/css/style.css`）**
   - 根因：`.toast-container` 原为 `z-index: 40`，低于 `.modal-overlay` 的 `z-index: 50`（带 `backdrop-filter: blur(6px)`），导致大厅、等待室、断线与结算弹窗开启时 Toast 渲染在遮罩之下被模糊。
   - 修复：将 `.toast-container` 的 `z-index` 提升至 `100`，确保所有弹窗状态下错误/提示 Toast 均清晰显示于最顶层。
2. **修复问题 2（必须）：`file://` 直开 ES Module 被 CORS 拦截致提示条未显示（`public/index.html`）**
   - 根因：依赖 `<script type="module" src="./js/main.js">` 执行 `location.protocol === 'file:'` 检测，而 Chromium 在 `file://` 下直接拦截 ES Module 加载，`main.js` 不会运行。
   - 修复：在 `public/index.html` 底部新增普通非模块内联 `<script>`，在 `location.protocol === 'file:'` 时立即移除 `#file-protocol-warning` 的 `hidden` 类并禁用 4 个大厅入口按钮；同时保留 `main.js` 中的兜底逻辑。
3. **修复问题 3（建议）：`NetClient.connect()` TDZ/旧连接保护与 `/favicon.ico` 404（`public/js/net-client.js`、`public/index.html`）**
   - 改为 `let promise; promise = new Promise(...)` 消除同步抛错时的 TDZ `ReferenceError`。
   - `close` 回调通过 `const isCurrentWs = this.ws === ws;` 门控 `connected`、`pingTimer`、`this.ws` 与 `onConnectionChange(false)`，避免超时旧 socket 延迟关闭污染新连接。
   - 在 `public/index.html` `<head>` 添加内联 SVG `data:` URI `<link rel="icon">` 消除浏览器默认 `/favicon.ico` 404 控制台报错。

---

## 2. 自测与回归结果

| 编号 | 验证方式 | 验证结果 | 说明 |
| --- | --- | --- | --- |
| **AC-15 ~ AC-18 + V1 全量** | `npm test` | **PASS (15/15)** | 含 `AC-16` 新增 `WS_SYNC_CONSTRUCT_ERROR` 与旧连接延迟 `close` 保护断言，0 失败 |

---

## 3. 改动影响面与旧证据失效评估

- **改动模块**：`public/css/style.css`（仅 `.toast-container` `z-index`）、`public/index.html`（`<link rel="icon">` 与 `file://` 普通内联脚本）、`public/js/net-client.js`（`connect()` 内部 Promise 声明与 `close` 回调归属校验）、`tests/ws-protocol.test.js`（追加断言）。
- **触及的公共状态与邻近流程**：
  - `NetClient` 的 `connected`、`ws`、`onConnectionChange` 状态流转（覆盖建连超时、同步建连异常与断线重连）。
  - `#toast-container` 与所有 `.modal-overlay`（大厅、等待室、断线等待、结算、玩法说明）的层叠关系。
  - `public/index.html` 在 `http://` 与 `file://` 两种协议下的入口初始化表现与控制台网络请求。
- **已失效的旧证据**：
  - `docs/review/v1.1/evidence/round-1/t01-empty-code-toast.png`、`t03-ws-fail-toast.png`、`t04-file-protocol.png` 及 `round-1/tester-results.json` 中关于 `.toast-container` 层级、`#file-protocol-warning` 可见性及 `/favicon.ico` 404 的记录已过时，需在 Round 2 复测重新取证。
  - 服务端 `server/index.js`、`public/js/audio.js`、`public/js/main.js`、`public/js/ui.js` 本轮未改动，Round 1 对应的 `AC-15`、`AC-18` 与核心玩法回归结论继续有效。
