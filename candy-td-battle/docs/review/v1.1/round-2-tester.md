# Tester 实测证据报告 — Round 2（Candy TD Battle V1.1）

## 1. 运行环境与版本核对
- **实际测试版本**：分支 `v1-candy-td-battle`，提交号 `cb5e2f1a1626f0235d146a0ddd99f892a224bb49`（经 `git rev-parse HEAD` 核对与简报完全一致）
- **运行环境**：Windows 11 本机；Microsoft Edge Headless（Chromium 内核，Playwright 驱动）；视口严格固定为 `1280×720`；每个用例使用独立 `BrowserContext`
- **本地服务与代理端口**：
  - 本地服务：`PORT=4501 node server/index.js`（未设置 `CANDY_ALLOW_TEST_HOOKS`，`/healthz` 返回 `{"ok":true,"allowTestHooks":false}`，PID `24444`，测试结束已精准终止，端口无 `LISTENING` 残留）
  - 辅助代理（仅 `R2-T02`）：测试脚本内建本地代理 `127.0.0.1:4502`（HTTP 转发至 `4501`，`/ws` 升级请求按阶段先挂起后透传，测试结束已关闭）
  - `R2-T03` 端口：不适用（`file://` 直开本地 HTML）
- **源码洁净度**：测试前后仓库产品代码与既有测试代码零改动（仅新增本报告与 `docs/review/v1.1/evidence/round-2/` 证据文件，临时脚本已从 `$env:TEMP` 删除）

## 2. 用例执行总表
| 用例编号 | 对应 SPEC / 问题项 | 入口方式 | 执行步骤摘要 | 客观结果 | 关键数字 / 错误摘录 | 精选证据路径 |
| --- | --- | --- | --- | --- | --- | --- |
| **R2-T01** | Round 1 问题 1 & 3（空房码 Toast 置顶可读 + 0 console.error） | 正常入口 `http://127.0.0.1:4501/`（无 `?test=1`） | 核验 `window.__CANDY_TEST__` 为 `undefined`；昵称填 `barry`、房码留空点击「加入房间」；读取样式与控制台日志并截图 | 通过 | `.toast-container` `zIndex: "100"` > `#lobby-overlay` `zIndex: "50"`；Toast 文案 `"请输入 4 位房间码"` 视觉锐利无遮挡；内联 SVG favicon 存在；`console.error: 0`、`pageerror: 0` | `docs/review/v1.1/evidence/round-2/r2-t01-empty-code-toast.png`, `docs/review/v1.1/evidence/round-2/tester-results.json` |
| **R2-T02** | Round 1 问题 1 + AC-17(2/3) + NetClient 断连重连邻近路径 | 故障代理入口 `http://127.0.0.1:4502/`（`/ws` 先挂起后透传） | `/ws` 挂起时连点 3 次「🌸 休闲甜心 AI」核对防重入；等超时中文 Toast 截图并核对按钮恢复；切换透传不刷新直接进 AI 局、建草莓塔、执行 `page.reload()` 重连，再主动销毁 WS 连接测断线重连 | 通过 | 挂起期仅 `1` 次 `/ws` 升级、4 按钮均 `disabled=true` 且文案 `"连接中..."`；超时 Toast `"连接对战服务器超时，请检查服务状态、网络或代理设置后重试"` 清晰无模糊，4 按钮全恢复；建塔 `$320 -> $240`；`page.reload()` 自动重连恢复 `PLAYING`（`$240`，对手 `休闲甜心 AI`）；主动断 WS 弹出 `"网络连接已断开，正在尝试自动重连..."` 并自动重连（WS 升级计数 `3 -> 4`），`PLAYING` 保持；`console.error: 0`、`pageerror: 0` | `docs/review/v1.1/evidence/round-2/r2-t02-ws-fail-toast.png`, `docs/review/v1.1/evidence/round-2/r2-t02-ai-reconnected.png`, `docs/review/v1.1/evidence/round-2/tester-results.json` |
| **R2-T03** | Round 1 问题 2（`file://` 直开提示条） | 本地文件入口 `file:///G:/我的云端硬盘/游戏/candy-td-battle/public/index.html` | 在独立 BrowserContext 以 `file://` 打开 `public/index.html`，读取 `#file-protocol-warning` 状态、4 按钮 `disabled` 状态并截图 | 通过 | `#file-protocol-warning` 不含 `hidden`、`display: "block"`，截图可见红粉色警告条；4 个大厅入口按钮均为 `disabled === true`；`pageerror: 0` | `docs/review/v1.1/evidence/round-2/r2-t03-file-protocol.png`, `docs/review/v1.1/evidence/round-2/tester-results.json` |

## 3. 失败 / 异常详述（仅列失败与阻塞项）
- 无（本次 3 条定向复测用例均按预期观察到目标现象，无失败或阻塞项）。

## 4. 客观体验观察（纯事实，非裁决）
- `1280×720` 视口下，`R2-T01` 与 `R2-T02` 中的深色胶囊白字 Toast（`backgroundColor: rgba(74, 53, 72, 0.9)`，`zIndex: 100`）完整悬浮于 `#lobby-overlay`（`zIndex: 50`）上方中央，文字边缘清晰，无毛玻璃遮挡。
- `R2-T02` 断开当前 WS 连接后，页面弹出 `"网络连接已断开，正在尝试自动重连..."` 提示，并在约 `2.5s` 观察窗口内完成新一次 `/ws` 建连（`wsCountBeforeDrop: 3` -> `wsCountAfterDrop: 4`）与状态恢复，地图与 `$240` 金币保持完整。
- `R2-T03` 以 `file://` 打开时，页面顶部警告条立即展示且 4 个入口按钮呈禁用态。

## 5. 未测项与止损记录
- **物理 macOS / Safari 真机**：当前测试机为 Windows 11，无 macOS/Safari 硬件环境，未在真机 Safari 上实测。
- **线上地址 `http://43.143.38.16:8080/candytd/`**：尚未获用户部署授权，属交付后验证项，本次未对线上环境执行测试。
- 止损记录：无（3 条用例均在单次执行内完成）。
