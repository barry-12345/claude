# Builder 交付报告 — Round 2（WP2 `@court2k/client`）

## 0. 快速索引
- **候选版本**：`wp2/client`（代码与证据提交：`9a26fa65a2a24ca9eb45d2a41797fbc854f3e4e4`，本报告随后以文档提交落盘，最终 HEAD 见调度板回报）
- **本轮相对上轮变化**：全部修复 Round 1 评审（`round-1.md`）指出的 **4 项必须修复缺陷与 3 项建议项**：
  1. 缓存 `lastAppliedDpr` 避免每帧重复调用 `renderer.setPixelRatio()` 重建画布；修正 144Hz 60fps 截止期累加节流（避免落入 48fps/`20.83ms` 误降档）并分离 `PerfManager` 的 VSync 呈现间隔与帧耗时指标使 60Hz 降档后可正常回升 1 次；
  2. 新增 `onlineSync.applyOnlineMatchOver()` 并在 `GameApp.processLocalEvent('MATCH_OVER')` 同步更新 `onlineState` 与 `SnapshotBuffer`，杜绝 15s 弃权无尾快照卡死弹窗；
  3. `WsClient.simulateDisconnect()` 调用 `close()` 前解绑旧 socket 回调且 `onclose` 校验 `this.ws !== socket`，彻底消除异步 `onclose` 覆盖延时为 `1200ms` 的竞态；
  4. `HudView.formatPostMatchScoreSummary()` 修复 `super_tiebreak` 赛后弹窗比分（显示抢十真实点数如 `11 - 9` 而非 `1 - 0`，Fast4 抢七附带小分），并封顶 `GameApp.stepOnlineInputs` 低帧累加器防恢复突发送帧触发限流；
  5. 落实全部 3 项建议优化（缓存 2K 绿条甜区几何仅变化时重建 + 加粗金黄黑边指针、`CourtScene.avatars` 显式标注 `[PlayerAvatarController, PlayerAvatarController]`、大厅 `window_focus` 保留输入框焦点）。
  - 改动模块：`PerfManager.ts`、`GameApp.ts`、`CourtScene.ts`、`WsClient.ts`、`onlineSync.ts`（新增）、`HudView.ts`、`InputController.ts` 及 4 个测试文件。
- **启动方式与 Tester 前置条件**：
  - 启动命令 / 入口：
    - 开发模式（含 WS/health 代理）：在 `D:\court2k-work\wt-wp2\tennis-2k\client` 运行 `npx vite --host 127.0.0.1 --port 3201 --strictPort`
    - 生产预览（需先 `npm run build --workspace=@court2k/client`）：`npx vite preview --host 127.0.0.1 --port 3201 --strictPort`
    - URL：`http://127.0.0.1:3201/`（正常入口）或 `http://127.0.0.1:3201/?test=1&netdebug=1`
  - 测试账号 / 种子 / 样本：无外部账号需求；单人模式默认 RNG 种子 `42`。
  - 受控测试钩子用法：仅当 URL 带 `?test=1` 挂载 `window.__COURT2K_TEST__`（正常入口为 `undefined`）；方法列表同 Round 1（`getState / setSeed / setScore / setTakeover / triggerHawkeyeShot / fastForwardPause / simulatePerfSpike / simulateRefreshRate / simulateDisconnect`）。
  - 清理方式：停止 Vite 进程（记录启动 PID 并仅终止该 PID）；联机退出大厅自动清理 `sessionStorage`。
- **自测命令与证据索引**：
  - 一键测试命令：
    - `npm run typecheck --workspace=@court2k/client`（结果：0 errors）
    - `npm run test --workspace=@court2k/client`（结果：4 文件 / 16 项全部通过）
    - `npm run build --workspace=@court2k/client`（结果：gzip 总包体 `163.87 KB` = `0.48 + 2.86 + 36.56 + 123.97 KB`，`<= 600 KB`）
    - `$env:VITE_BASE_PATH='/tennis/'; npm run build --workspace=@court2k/client`（结果：`dist/index.html` 资源前缀全部为 `/tennis/assets/...`）
  - 关键截图/日志路径：`tennis-2k/docs/review/wp2/evidence/round-2/`（`01-lobby-hard.png` ~ `12-super-tiebreak-postmatch.png` 与 `e2e-results.json`）
- **环境未验证缺口**：
  - 真实双浏览器联机闭环（P0/P1 跨进程 WS 同步与真实断线重连）将在整合阶段 `E2E-01 ~ E2E-04` 联调验证；
  - 无头 Edge 使用 SwiftShader 软件 WebGL 渲染，硬件 GPU 高帧率与 Mac Retina / 120Hz 真机实屏观感需真机或整合环境验证。

---

## 1. 返工项逐条修复说明与回归测试

| 缺陷编号 | 根因与修复内容 | 新增/更新自动化回归测试 |
| --- | --- | --- |
| **问题 1**（DPR 每帧重设与 60/144Hz 失准） | `CourtScene.applyPerfPreset` 缓存 `lastAppliedDpr`，仅变更时调用 `setPixelRatio`；`GameApp.loop` 对 `estHz > 105` 采用 `nextRenderAtMs += 1000/60` 截止期节流（144Hz 稳定 ~60fps）；`PerfManager.recordFrame(frameWorkMs, realDeltaMs, renderIntervalMs)` 分离呈现间隔与实际帧耗时，60Hz/144Hz 正常满帧不误降档且 60Hz 降档后稳态可回升 1 次 | `tests/perf.test.ts` 新增 2 项：60Hz VSync 稳态回升 `upgradeCount === 1`、144Hz 节流 10s 模拟保持 `HIGH` 且 `58 <= fps <= 62` |
| **问题 2**（联机 `MATCH_OVER` 状态同步） | 新增 `client/src/net/onlineSync.ts`（`applyOnlineMatchOver`），`GameApp.processLocalEvent` 收到 `MATCH_OVER` 时在 `online` 模式更新 `phase = 'match_over'`、`score`、`stats` 并调用 `snapshots.reset(next)` | `tests/net.test.ts` 新增：`仅收到 GAME_EVENT(MATCH_OVER) 无后续快照时 onlineState 与 SnapshotBuffer 正确切入 match_over` |
| **问题 3**（`simulateDisconnect` 异步竞态） | `WsClient.simulateDisconnect` 先置空旧 socket 所有回调再 `close()`，且 `onclose` 增加 `if (this.ws !== socket) return` 防护 | `tests/net.test.ts` 改为异步 5ms `close()` 并新增回归测试：验证 `simulateDisconnect(4000)` 在 1500ms/3900ms 不重连、4000ms 重连，以及 `-1` 永不重连 |
| **问题 4**（超级抢十比分与输入累加器封顶） | 新增 `formatPostMatchScoreSummary` 在 `super_tiebreak` 显示真实点数（如 `11 - 9`），`fast4` 抢七显示 `4 - 3 (7-5)`；`GameApp.stepOnlineInputs` 封顶 `onlineInputAccumSec <= fixedDt * 2` | `tests/hud.test.ts` 新增 2 项单测 + Edge E2E `12-super-tiebreak-postmatch.png` 验证 `11 - 9` 弹窗显示 |
| **问题 5**（3 项建议优化） | `CourtScene` 缓存 `lastMeterHalfWidth`/`lastMeterSweetCenter` 仅变化时重建绿条几何、指针加粗为金黄黑边；`avatars` 显式标注 `[PlayerAvatarController, PlayerAvatarController]`；`InputController.resetAndRebind` 在大厅 `window_focus` 时跳过 `blur()` | `tests/input.test.ts` 新增大厅 `window_focus` 不 blur 输入框用例 + Edge 截图 `05-serve-meter.png` / `08-takeover-clay-netdebug.png` 目视确认指针清晰度 |

---

## 2. 验收项逐条自测结果（Round 2 复测）

| 编号 | 验证方式 | 实测结果与关键数字 | 原始证据路径 |
| --- | --- | --- | --- |
| `AC-01`~`AC-08` | Vitest + Playwright Edge E2E | `16/16` 单测全过；正常入口无钩子、暂停恢复、3 场地、4 流派、绿条金针、Takeover、鹰眼 IN(`7.27 cm`)/OUT(`7.17 cm`)及后置立即移动(`pressedMoved: true`)、`super_tiebreak` `11 - 9` 赛后统计全部通过；0 Console Error / 0 Page Error / 0 404 | `evidence/round-2/01~12*.png`, `e2e-results.json` |
| `AC-12`~`AC-16` | Vitest + `vite build` + Edge | `PerfManager` 60Hz 回升 & 144Hz 60fps 稳态全绿；包体 `163.87 KB` gzip；Draw Calls `94–107`；`/tennis/` 子路径构建正常；`window.__COURT2K_TEST__ === undefined`（正常入口） | `tests/perf.test.ts`, `tests/net.test.ts`, `evidence/round-2/e2e-results.json` |

---

## 3. 改动影响面与失效旧证据（返工轮必填）

- **修改的模块 / 文件**：
  - 修改：`client/src/core/PerfManager.ts`、`client/src/game/GameApp.ts`、`client/src/render/CourtScene.ts`、`client/src/net/WsClient.ts`、`client/src/ui/HudView.ts`、`client/src/input/InputController.ts`
  - 新增：`client/src/net/onlineSync.ts`、`client/tests/hud.test.ts`
  - 更新测试：`client/tests/perf.test.ts`、`client/tests/net.test.ts`、`client/tests/input.test.ts`
- **触及的公共状态 / 存档 / 权限 / 契约 / 邻近流程**：
  - 仅客户端内部渲染循环、状态同步与本地 UI 展示；**未改动任何 `@court2k/shared` 导出、`CONTRACT.md` 协议或 `sessionStorage` 键结构**；`InputController.resetAndRebind` 仅在非游戏态的 `window_focus` 保留输入框焦点，对局内 `blur/focus/visibilitychange/FULL_SYNC/MATCH_RESUMED/HAWKEYE_END` 仍强制清空并 blur。
- **已失效的旧证据与建议复测范围**：
  - `docs/review/wp2/evidence/round-1/` 下旧构建与截图（`a5204e2` 基点）已由 `evidence/round-2/` 全量替代；
  - 建议 Reviewer 重点复审 `a5204e2..HEAD` diff 中的 4 项修复及 `16/16` Vitest 用例，并由 Tester 执行完整浏览器端交互实测与视觉核验。
