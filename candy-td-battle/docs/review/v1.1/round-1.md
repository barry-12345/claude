结论：FAIL
候选版本：v1-candy-td-battle @ 4e442b65ce4a047a61caab99530d465736e3cca5
本轮核验方式：代码审 + 独立确定性 HTTP/WS 探针脚本（端口 4101–4103，证据 `docs/review/v1.1/evidence/round-1/reviewer-fast-check.json`） + 已委派 Tester 浏览器实操取证（`docs/review/v1.1/round-1-tester.md`）

达标项：
- [AC-15] 静态资源与 `/healthz` 定长响应及 gzip 预压缩达标：`npm test` 及端口 `4101` 独立探针实测 `/`、`/css/style.css`、`public/js/` 全部 7 个模块、`/candytd/*` 子路径与 `/healthz`（含 `GET` / `HEAD`），在带与不带 `Accept-Encoding: gzip` 下均返回 HTTP `200`、精确 `Content-Length`（如 `/js/main.js` raw `9667`B / gzip `3080`B，`/js/renderer.js` raw `34649`B / gzip `8740`B，`/healthz` raw `34`B / gzip `54`B），`Transfer-Encoding` 均为 `undefined`（无 `chunked`），gzip 响应含 `Content-Encoding: gzip` 与 `Vary: Accept-Encoding` 且解压后与磁盘源文件逐字节一致。证据：`docs/review/v1.1/evidence/round-1/reviewer-fast-check.json`。
- [AC-16] WebSocket 并发握手复用、超时中断与重连恢复达标：原生 WHATWG `WebSocket` 探针（端口 `4101–4103`）与 Tester `T-03`（端口 `4502`）实测确认，`CONNECTING` 阶段连续快速点击 3 次仅向服务端发起 `1` 次 `/ws` 升级请求，大厅 4 个入口按钮全部进入 `disabled=true`（文案 `连接中...`）；挂起超时准确 reject `WS_CONNECT_TIMEOUT`（探针 `150ms` / 浏览器默认 `6000ms`），HTTP `502` 握手拒绝准确 reject `WS_CONNECT_ERROR`；失败后 4 按钮恢复原始中文文案与可点击状态，服务恢复后无需刷新页面即可原地建房成功（房间码 `QHV4`）。证据：`docs/review/v1.1/evidence/round-1/reviewer-fast-check.json`、`docs/review/v1.1/evidence/round-1/tester-results.json`。
- [AC-18] `CandyAudio` 受限存储容错与全量自动化测试达标：`sessionStorage.getItem/setItem` 抛出 `SecurityError` 时 `CandyAudio` 正常初始化且 `toggleMute()` 在内存中正确切换（`false -> true -> false`）；全套 `npm test` 共 `15/15` 通过、`0` 失败（耗时 `1422.21ms`）。证据：`docs/review/v1.1/evidence/round-1/reviewer-fast-check.json`。
- [AC-01 / AC-10 / AC-11 / AC-14 回归] 既有核心流程与子路径兼容无退化：Tester `T-02` 从无 `?test=1` 正常入口（`typeof window.__CANDY_TEST__ === 'undefined'`）实测创建双人房（`MXV6`）并返回大厅、进入休闲甜心 AI 局建塔扣费（`$320 -> $240`）、切换静音（`🔊 -> 🔇`）及 `PLAYING` 态刷新页面后经 `sessionStorage` 自动重连回原局保留塔与金币，全程 `0` 条 `pageerror`；`/candy-td/*` 与 `/candytd/*` 子路径 HTTP/WS 均正常。证据：`docs/review/v1.1/round-1-tester.md`、`docs/review/v1.1/evidence/round-1/t02-pvp-room.png`、`docs/review/v1.1/evidence/round-1/t02-ai-playing-reconnected.png`。

返工项（FAIL 时填写）：
【问题 1（必须）：大厅弹窗遮罩层级高于 `.toast-container`，导致空房码提示与 WS 建连失败/超时中文 Toast 被毛玻璃完全模糊不可辨认（AC-17 未达标）】
- 现象与证据：来源为代码审查（`public/css/style.css` 第 569 行 vs 第 609 行）及 Tester 用例 `T-01`、`T-03` 实测。实测 `.toast-container` 计算样式为 `z-index: 40`，而全画幅 `#lobby-overlay.modal-overlay`（`1280×720`）为 `z-index: 50` 且带 `backdrop-filter: blur(6px)` 与 `background-color: rgba(255, 238, 245, 0.72)`；在 Toast 中心坐标调用 `document.elementFromPoint` 命中 `DIV#lobby-overlay.modal-overlay`。复现步骤：正常打开首页后不填房间码点「加入房间」，或在阻断 `/ws` 后点「🌸 休闲甜心 AI」等待超时。截图清晰显示两处中文 Toast 在画幅顶部（`y: 68..100`）均被毛玻璃模糊成无法辨认的暗色团块。证据：`docs/review/v1.1/evidence/round-1/t01-empty-code-toast.png`、`docs/review/v1.1/evidence/round-1/t03-ws-fail-toast.png`、`docs/review/v1.1/evidence/round-1/tester-results.json`。
- 影响：玩家在大厅输错房间码或遇到网络/代理导致 WebSocket 连接失败、超时时，完全看不清任何错误提示文字，直接违背 V1.1「大厅建连可见中文错误反馈（AC-17）」的核心修复目标。
- 修改方向：提升 `public/css/style.css` 中 `.toast-container` 的 `z-index` 使其高于所有 `.modal-overlay`（例如设为 `z-index: 100`，高于 `.modal-overlay` 的 `50`），确保大厅、等待室、断线与结算弹窗开启时 Toast 始终清晰渲染在最顶层。
- 下轮验收标准：在 `1280×720` 真实浏览器大厅界面触发空房码 Toast 与 WS 失败/超时 Toast 时，Toast 中心 `document.elementFromPoint`（忽略 `pointer-events: none` 时按计算层级核验 `zIndex`）高于 `#lobby-overlay`，且截图中中文提示文字清晰锐利可读、无毛玻璃模糊遮挡。

【问题 2（必须）：`file://` 协议直开时 ES Module 被浏览器 CORS 拦截，`main.js` 未执行导致 `#file-protocol-warning` 保持隐藏（SPEC 8.1.3 未达标）】
- 现象与证据：来源为代码审查（`public/index.html` 第 124、242 行与 `public/js/main.js` 第 244 行）及 Tester 用例 `T-04` 实测。直接以 `file:///.../public/index.html` 打开时，Chromium 因同源策略拦截 `<script type="module" src="./js/main.js">`（控制台报错 `Access to script ... from origin 'null' has been blocked by CORS policy` + `net::ERR_FAILED`），导致 `main.js` 根本未执行，`#file-protocol-warning` 保持 `class="file-protocol-warning hidden"`（计算样式 `display: none`），界面既无提示横幅、点击任何大厅按钮也完全无反应。证据：`docs/review/v1.1/evidence/round-1/t04-file-protocol.png`、`docs/review/v1.1/evidence/round-1/tester-results.json`。
- 影响：用户直接双击本地 `public/index.html` 打开游戏时，看不到规格要求的 HTTP 启动引导提示，只看到静默无响应的大厅按钮。
- 修改方向：不要仅依赖 `type="module"` 的 `main.js` 来揭开 `file://` 警告；在 `public/index.html` 内使用不受 `file://` CORS 限制的普通非模块内联 `<script>` 检测 `location.protocol === 'file:'`，立即移除 `#file-protocol-warning` 的 `hidden` 类（并可同步禁用入口按钮防止静默无响应），同时保留 `main.js` 中的兜底判断。
- 下轮验收标准：在独立 Chromium/Edge 浏览器以 `file://` 协议直接打开 `public/index.html` 时，`#file-protocol-warning` 计算样式 `display !== 'none'`，截图中清晰可见「请通过 HTTP 服务（如 `npm start`）打开，不支持直接双击本地 HTML 文件」提示条。

【问题 3（建议）：`NetClient.connect()` 同步异常 TDZ 引用与旧连接异步 `close` 状态保护，以及 `/favicon.ico` 默认 404 控制台报错清理】
- 现象与证据：
  1) 代码审发现 `public/js/net-client.js` 第 64 与 81 行在 `const promise = new Promise(...)` 执行器内部定义了引用 `promise` 的 `failConnect`，若第 98 行 `new WebSocket(...)` 同步抛错（如非法 URL 或严格 CSP），`failConnect` 同步执行会触发 TDZ `ReferenceError: Cannot access 'promise' before initialization`（已在 Node 探针实测复现）。
  2) `public/js/net-client.js` 第 142–153 行 `close` 监听中仅对 `this.ws = null` 做了 `if (this.ws === ws)` 判断，而 `this.connected = false`、`this._stopPing()` 与 `onConnectionChange(false)` 未校验 `this.ws === ws`，若已超时的旧 socket 延迟触发 `close` 存在覆盖新连接状态的风险。
  3) Tester `T-01`~`T-03` 实测浏览器每次加载首页均产生 1 条默认 `/favicon.ico` `404 (Not Found)` 的 `console.error`（`docs/review/v1.1/evidence/round-1/tester-results.json`）。
- 影响：极端环境或慢关闭网络下可能干扰错误诊断与连接状态，且 `/favicon.ico` 404 会在浏览器控制台留下非零报错记录（影响 `AC-17(2)`「控制台 0 报错」纯度）。
- 修改方向：`NetClient.connect()` 改为先声明 `let promise; promise = new Promise(...)`，并在 `close` 回调中仅当 `this.ws === ws`（或当前无新活跃连接）时才重置 `connected`/`pingTimer` 与触发断开回调；在 `public/index.html` `<head>` 补充内联 SVG `data:` URI `<link rel="icon" ...>`（或在 `server/index.js` 处理 `/favicon.ico`），消除浏览器默认 404 报错。
- 下轮验收标准：`npm test` 补充覆盖 `new WebSocket` 同步抛错与旧连接延迟 `close` 断言并全绿通过；浏览器正常进入首页与对局时 `console.error` 与 `pageerror` 均为严格 `0` 条。

阻塞项（BLOCKED 时必填）：
- 无

规格层面问题（如有）：
- 无

未验证项（非门槛 / 环境限制）：
- 物理 macOS / Safari 真机环境（当前在 Windows 11 本机 Edge Chromium Headless `1280×720` 下完成验证）。
- 线上生产地址 `http://43.143.38.16:8080/candytd/`（尚未获用户部署授权，属 V1.1 本地验收 `PASS` 并获批部署后的效果验证项，非本轮门禁）。

给用户的摘要：V1.1 第 1 轮验收未通过（FAIL）。服务端静态资源精确 `Content-Length` 与 `gzip` 预压缩、WebSocket 慢握手防并发重入与超时恢复、`CandyAudio` 存储异常降级及全套 15 项自动化测试均已验证达标；但在真实浏览器实测中发现两项必须修复的界面问题：一是大厅弹窗毛玻璃遮罩（`z-index: 50`）盖住了错误提示层（`z-index: 40`），导致空房间码与连接超时中文 Toast 被严重模糊无法辨认；二是直接双击打开本地 `index.html`（`file://`）时浏览器会拦截 ES Module 脚本，导致新增的 HTTP 启动提示条未能显示。已给出明确修复方向交回返工。
Notion 一行摘要：FAIL（Round 1） / 静态定长+gzip、WS 防重入超时与 Audio 容错（15/15 单测）已达标，但大厅遮罩模糊遮挡错误 Toast（AC-17）且 file:// 下 ES Module 被 CORS 拦截致提示条未显示 / 交 Builder 按 2 项必改+1 项建议返工进入 Round 2
