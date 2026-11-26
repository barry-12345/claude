# Candy TD Battle V1.1 — Round 1 Tester 实操取证报告

## 0. 执行摘要与环境基线

- **待验版本**：分支 `v1-candy-td-battle`，提交号 `4e442b65ce4a047a61caab99530d465736e3cca5`（经 `git rev-parse HEAD` 核对一致）
- **本地服务**：`PORT=4501 node server/index.js`（未开启 `CANDY_ALLOW_TEST_HOOKS`，`/healthz` 返回 `{"ok":true,"allowTestHooks":false}`，PID `52088`，测试结束后已终止并核实端口无残留监听）
- **辅助代理（仅 T-03）**：测试脚本内建本地代理 `127.0.0.1:4502`（HTTP 转发至 `4501`，`/ws` 升级握手按阶段切换挂起与透传，测试结束后已关闭）
- **浏览器与视口**：Windows 11 本机 Microsoft Edge Headless（Chromium 内核，Playwright `1.65.1` 驱动），视口严格固定为 `1280×720`，每个用例使用独立 BrowserContext
- **源码洁净度**：测试前后仓库产品代码与既有测试代码零改动（仅新增本报告与 `docs/review/v1.1/evidence/round-1/` 证据文件）

---

## 1. 用例实测明细

### T-01：空房间码提示与 Toast 层级遮挡核查（AC-17(1)）

- **入口**：`http://127.0.0.1:4501/`（无 `?test=1`）
- **实测步骤与现象**：
  1. 页面加载后核验 `typeof window.__CANDY_TEST__ === "undefined"`。
  2. 昵称输入 `barry`，房间码留空，点击 `#btn-join-pvp`（「加入房间」）。
  3. DOM `.toast-container .toast-item` 出现，文本为 `"请输入 4 位房间码"`，样式 `opacity: "1"`、`backgroundColor: "rgba(74, 53, 72, 0.9)"`、`color: "rgb(255, 255, 255)"`，位置矩形 `x: 570.27, y: 68, width: 139.47, height: 32`。
  4. **层级与遮挡实测**：
     - `.toast-container` 计算样式：`zIndex: "40"`、`position: "absolute"`。
     - `#lobby-overlay.modal-overlay` 计算样式：`zIndex: "50"`、`backdropFilter: "blur(6px)"`、`backgroundColor: "rgba(255, 238, 245, 0.72)"`、`display: "flex"`，覆盖全画幅 `0..1280 × 0..720`。
     - 在 Toast 中心点调用 `document.elementFromPoint(cx, cy)`，命中元素为 `DIV#lobby-overlay.modal-overlay`，表明 `#lobby-overlay` 位于 `.toast-container` 之上。
     - 肉眼核查截图 `t01-empty-code-toast.png`：画幅上方中央（`y: 68..100`）仅可见一团被毛玻璃严重模糊的暗灰色色块，中文提示文字在视觉上完全不可辨认。
- **Console 记录**：`pageerror` 0 条；`console.error` 1 条（浏览器默认请求 `/favicon.ico` 返回 `404 (Not Found)`）。
- **证据**：[t01-empty-code-toast.png](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/docs/review/v1.1/evidence/round-1/t01-empty-code-toast.png)、[tester-results.json](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/docs/review/v1.1/evidence/round-1/tester-results.json)

### T-02：建房、AI 对战、建塔、静音与刷新重连回归（AC-17(2) + AC-01/10/14）

- **入口**：`http://127.0.0.1:4501/`
- **实测步骤与现象**：
  1. 昵称输入 `barry`，点击「创建双人房间」，进入 `#lobby-room` 等待室，房间码显示 `MXV6`，P1 槽位 `#slot-name-0` 显示 `barry (我)`，P2 槽位 `#slot-name-1` 显示 `等待好友加入...`。
  2. 点击「返回大厅」（`#btn-back-home`）正常退回 `#lobby-entry` 首页。
  3. 点击「🌸 休闲甜心 AI」，经 3s `COUNTDOWN` 自动进入 `PLAYING`（`#lobby-overlay` 隐藏，`#top-bar` 显示），初始金币 `$320`，右上角静音按钮为 `🔊`。
  4. 选中草莓豆豆炮（`#tower-cards button[data-tower-type="strawberry"]`）并点击合法草地格 `(col=2, row=3)` 对应坐标 `(214, 268)`，金币扣减为 `$240`；点击 `#btn-mute` 后图标切换为 `🔇`，`sessionStorage.candy_td_muted === "1"`，且 `sessionStorage` 存有 `candy_td_session_v1`。
  5. 在 `PLAYING` 状态执行 `page.reload()`：页面自动重连恢复回原 AI 对局（对手 `休闲甜心 AI`），`#hud-self-gold` 保持 `$240`、地图上草莓塔保留、`#btn-mute` 保持 `🔇`、`#hud-wave-text` 显示 `开战准备 · 3s`。
- **Console 记录**：全程无 JS 运行时错误与 `pageerror`（仅浏览器默认请求 `/favicon.ico` 返回 `404 (Not Found)` 1 条）。
- **证据**：[t02-pvp-room.png](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/docs/review/v1.1/evidence/round-1/t02-pvp-room.png)、[t02-ai-playing-reconnected.png](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/docs/review/v1.1/evidence/round-1/t02-ai-playing-reconnected.png)、[tester-results.json](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/docs/review/v1.1/evidence/round-1/tester-results.json)

### T-03：WS 慢握手防重入、超时中文 Toast 与原地恢复（AC-17(3)）

- **入口**：`http://127.0.0.1:4502/`（HTTP 转发至 `4501`，`/ws` 升级请求先挂起不返回 `101` 触发 6000ms 超时，随后切换为透传）
- **实测步骤与现象**：
  1. 初始大厅 4 个按钮（`#btn-create-pvp`、`#btn-join-pvp`、`#btn-ai-casual`、`#btn-ai-clever`）均为 `disabled: false`，文案分别为「创建双人房间」「加入房间」「🌸 休闲甜心 AI」「🦊 狡黠狐狸 AI」。
  2. `/ws` 挂起期间点击「🌸 休闲甜心 AI」并快速连点 2 次（共 3 次）：
     - 连接中 4 个按钮全部处于 `disabled: true`，文案全部变为 `"连接中..."`。
     - 服务端 `/ws` 升级请求仅收到 `1` 次（`wsUpgradeAttemptsDuringHang: 1`），未触发重入并发请求。
  3. 触发 6000ms 握手超时后：
     - DOM `.toast-container .toast-item` 仅弹出 1 条中文错误 Toast：`"连接对战服务器超时，请检查服务状态、网络或代理设置后重试"`（位置 `x: 442, y: 68, width: 396, height: 32`）。
     - **层级与遮挡实测**：与 T-01 相同，`document.elementFromPoint` 在 Toast 中心命中 `DIV#lobby-overlay.modal-overlay`（`zIndex: "50"`、`backdropFilter: "blur(6px)"`），`.toast-container` 为 `zIndex: "40"`。截图 `t03-ws-fail-toast.png` 显示该错误 Toast 同样被模糊遮挡为不可辨认的灰条。
     - 4 个大厅按钮全部恢复 `disabled: false` 与原始中文文案。
  4. 解除 `/ws` 挂起后，**不刷新页面**直接点击「创建双人房间」，成功进入等待室 `#lobby-room` 并生成房间码 `QHV4`。
- **Console 记录**：`console.warning` 1 条（`WebSocket connection to 'ws://127.0.0.1:4502/ws' failed: WebSocket is closed before the connection is established.`），`console.error` 1 条（`/favicon.ico` `404`），`pageerror` 0 条。
- **证据**：[t03-ws-fail-toast.png](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/docs/review/v1.1/evidence/round-1/t03-ws-fail-toast.png)、[tester-results.json](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/docs/review/v1.1/evidence/round-1/tester-results.json)

### T-04：`file://` 协议直接打开 `public/index.html` 实测（SPEC 8.1.3 反例）

- **入口**：`file:///G:/我的云端硬盘/游戏/candy-td-battle/public/index.html`
- **实测步骤与现象**：
  1. 独立浏览器上下文直接加载 `file://` URL。
  2. `#file-protocol-warning` 元素实测状态：`className: "file-protocol-warning hidden"`、`hasHiddenClass: true`、`display: "none"`。
  3. 截图 `t04-file-protocol.png` 显示大厅正常渲染，但 `#file-protocol-warning` 黄色/提示横幅未显示。
- **Console 与网络报错摘录**：
  - `console.error` #1：`Access to script at 'file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/main.js' from origin 'null' has been blocked by CORS policy: Cross origin requests are only supported for protocol schemes: chrome-experimental-site-token-provider, chrome-extension, chrome-untrusted, data, edge, http, https, isolated-app.`
  - `console.error` #2：`Failed to load resource: net::ERR_FAILED`
  - `requestfailed`：`main.js` 请求失败（`net::ERR_FAILED`），因 `<script type="module" src="./js/main.js">` 被 Chromium `file://` ES Module CORS 策略拦截，导致 `main.js` 未执行、`#file-protocol-warning` 未能移除 `.hidden`。
- **证据**：[t04-file-protocol.png](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/docs/review/v1.1/evidence/round-1/t04-file-protocol.png)、[tester-results.json](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/docs/review/v1.1/evidence/round-1/tester-results.json)

---

## 2. 证据清单

| 文件 | 说明 |
| --- | --- |
| `docs/review/v1.1/evidence/round-1/t01-empty-code-toast.png` | T-01 空房码 Toast 截图（可见 Toast 被 `#lobby-overlay` 毛玻璃遮挡模糊） |
| `docs/review/v1.1/evidence/round-1/t02-pvp-room.png` | T-02 创建双人房间等待室截图（`MXV6`、`barry (我)`） |
| `docs/review/v1.1/evidence/round-1/t02-ai-playing-reconnected.png` | T-02 AI 对战建塔+静音+刷新重连恢复截图（`$240`、`🔇`） |
| `docs/review/v1.1/evidence/round-1/t03-ws-fail-toast.png` | T-03 WS 超时中文错误 Toast 截图（同样被 `#lobby-overlay` 遮挡模糊，4 按钮已恢复可点） |
| `docs/review/v1.1/evidence/round-1/t04-file-protocol.png` | T-04 `file://` 打开页面截图（`#file-protocol-warning` 仍为 `display: none`） |
| `docs/review/v1.1/evidence/round-1/tester-results.json` | T-01~T-04 完整 DOM/计算样式/Console/按钮状态实测记录 |

---

## 3. 暂未覆盖范围（环境限制）

- **物理 macOS / Safari 真机**：当前为 Windows 11 本机 Edge Headless 环境，未覆盖物理 macOS Safari 真机表现。
- **线上部署环境（`http://43.143.38.16:8080/candytd/`）**：尚未获用户部署授权，属交付后验证项，本轮未触碰线上服务。
