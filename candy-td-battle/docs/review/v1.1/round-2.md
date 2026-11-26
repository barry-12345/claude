结论：PASS
候选版本：v1-candy-td-battle @ cb5e2f1a1626f0235d146a0ddd99f892a224bb49
本轮核验方式：代码审（核对 `4e442b65..cb5e2f1a` diff） + 全套 `npm test`（15/15 通过）与端口 `4101` 静态定长/gzip 复检（`docs/review/v1.1/evidence/round-2/reviewer-fast-check.json`） + 已委派 `tester-2` 定向浏览器实操取证（`docs/review/v1.1/round-2-tester.md`）。
复测范围与理由（按 `evaluator.md` 第 6 步分级）：本轮采用「全套自动化测试回归 + 浏览器定点复测（Round 1 返工项 1/2/3 + 受影响的 `NetClient` 断连重连邻近路径）」。理由是 Round 2 仅改动 `public/css/style.css`（1 行 `.toast-container` `z-index`）、`public/index.html`（内联 SVG favicon 与 `file://` 普通内联脚本）及 `public/js/net-client.js`（`let promise` 声明与 `close` 回调 `this.ws === ws` 归属判断），未触及 `server/`、`simulation.js`、`room-manager.js`、`audio.js`、`main.js`、`ui.js` 等服务端逻辑与核心玩法状态；对被触及的 `NetClient` `close` 邻近链路额外加测了页面刷新重连与主动断 WS 自动重连。

达标项：
- [AC-15] 静态资源与 `/healthz` 定长响应及 gzip 预压缩达标：全套 `npm test` 及端口 `4101` 复检确认，更新后的 `/`（`public/index.html` raw `11775`B / gzip `4122`B）、`/css/style.css`（gzip `4137`B）、全部前端模块、`/candytd/*` 子路径与 `/healthz`（raw `34`B / gzip `54`B）均返回精确 `Content-Length`、`Transfer-Encoding` 为 `null`（无 `chunked`），gzip 响应含 `Content-Encoding: gzip` 与 `Vary: Accept-Encoding` 且解压逐字节一致。证据：`docs/review/v1.1/evidence/round-2/reviewer-fast-check.json`、`docs/review/v1.1/evidence/round-1/reviewer-fast-check.json`。
- [AC-16 & Round 1 问题 3 闭环] WebSocket 并发握手复用、超时中断、重连恢复及同步抛错/旧连接延迟关闭保护全部达标：`npm test`（15/15 通过，耗时 `1882.55ms`）新增断言验证 `new WebSocket()` 同步抛错正常 reject `WS_SYNC_CONSTRUCT_ERROR`（无 TDZ `ReferenceError`），且已超时旧 socket 延迟触发 `close` 不影响当前活跃连接（`disconnectCount === 0`、`net.connected === true`）；`R2-T02` 实测 `/ws` 挂起期连点 3 次仅触发 `1` 次升级请求。证据：`docs/review/v1.1/evidence/round-2/reviewer-fast-check.json`、`docs/review/v1.1/evidence/round-2/tester-results.json`。
- [AC-17 & SPEC 8.1.3 & Round 1 问题 1/2/3 闭环] 大厅按钮防重入、清晰可读中文 Toast、`file://` 直开警告与控制台 0 报错全部达标：
  1) `R2-T01`（正常入口 `http://127.0.0.1:4501/`，无 `?test=1`、`typeof window.__CANDY_TEST__ === 'undefined'`）：空房码点击「加入房间」弹出「请输入 4 位房间码」，`.toast-container` 计算 `zIndex: "100"` 高于 `#lobby-overlay`（`zIndex: "50"`），截图确认深色胶囊白字锐利清晰、无任何毛玻璃模糊遮挡；内联 SVG favicon 生效，`console.error: 0`、`pageerror: 0`。
  2) `R2-T02`（故障与恢复闭环）：`/ws` 挂起期 4 个大厅入口按钮全部进入 `disabled: true`（文案 `连接中...`），6000ms 超时后顶层清晰弹出「连接对战服务器超时，请检查服务状态、网络或代理设置后重试」中文 Toast，4 按钮完整恢复原名且 `disabled: false`；恢复 `/ws` 后不刷新页面原地进入「🌸 休闲甜心 AI」`PLAYING`，全程 `console.error: 0`、`pageerror: 0`。
  3) `R2-T03`（`file://` 直开 `public/index.html`）：普通内联脚本绕过 ES Module CORS 限制立即生效，`#file-protocol-warning` 计算样式 `display: "block"`（无 `hidden` 类），截图清晰展示「⚠️ 请通过 HTTP 服务（如 `npm start`）打开，不支持直接双击本地 HTML 文件。」且 4 个大厅入口按钮均为 `disabled: true`，`pageerror: 0`。
  证据：`docs/review/v1.1/round-2-tester.md`、`docs/review/v1.1/evidence/round-2/r2-t01-empty-code-toast.png`、`docs/review/v1.1/evidence/round-2/r2-t02-ws-fail-toast.png`、`docs/review/v1.1/evidence/round-2/r2-t03-file-protocol.png`、`docs/review/v1.1/evidence/round-2/tester-results.json`。
- [AC-18] `CandyAudio` 受限存储容错与全套自动化测试达标：`sessionStorage` 抛出 `SecurityError` 时安全降级为内存静音状态，`npm test` 15/15 全绿通过。证据：`docs/review/v1.1/evidence/round-2/reviewer-fast-check.json`。
- [AC-01 / AC-10 / AC-11 / AC-14 回归] 既有建房、AI 对局、静音持久化、断线重连与子路径代理兼容无退化：`R2-T02` 实测建塔（`$320 -> $240`）、`page.reload()` 刷新重连恢复以及主动断开活跃 WS 连接后弹出断线提示并自动重连（WS 升级计数 `3 -> 4`，保留 `$240` 与在场塔）均正常，叠加 Round 1 `T-02` 双人建房（`MXV6`）与静音持久化证据完整闭环。证据：`docs/review/v1.1/evidence/round-2/r2-t02-ai-reconnected.png`、`docs/review/v1.1/evidence/round-1/t02-pvp-room.png`。

返工项（FAIL 时填写）：
- 无

阻塞项（BLOCKED 时必填）：
- 无

规格层面问题（如有）：
- 无

未验证项（非门槛 / 环境限制）：
- 物理 macOS / Safari 真机环境（本轮在 Windows 11 本机 Edge Chromium Headless `1280×720` 下完成验证）。
- 线上生产地址 `http://43.143.38.16:8080/candytd/`（尚未获用户部署授权；按 `SPEC 8.1` 与 `8.2` 约定，远端 `git push` 与腾讯云服务器部署须在本轮本地验收 `PASS` 后另行请示用户确认，属交付后效果验证项，非本轮交付门禁）。

给用户的摘要：V1.1 第 2 轮复验已通过（PASS）。上一轮发现的大厅毛玻璃遮罩模糊错误提示 Toast、`file://` 本地直开因 ES Module 拦截未显示警告条以及 `NetClient` 边界与图标 404 问题均已修复并经真实浏览器截图确认：空房间码与服务器连接超时中文提示现已清晰置顶显示，直接双击本地 HTML 会立即弹出 HTTP 启动引导并禁用无效按钮，静态资源定长/gzip 响应、慢握手防重入与断线自动重连全部正常且全套 15 项测试与浏览器控制台零报错。当前本地版本已具备交付与上线条件，如需推送 GitHub 或部署至腾讯云服务器可进一步确认。
Notion 一行摘要：PASS（V1.1 Round 2，commit cb5e2f1） / 静态定长+gzip、WS 防重入超时与旧连接保护、大厅置顶清晰中文 Toast、file:// 直开警告及 Audio 存储容错全部验证达标（15/15 单测 + 浏览器 0 console.error） / 本地验收通过，待向用户汇报并请示远端推送与线上部署
