结论：FAIL
候选版本：wp2/client @ a5204e2aeed47ba3b36ee59061d7a82de5ee3196
本轮核验方式：第 1–2 步深度代码审查 + 廉价确定性验证（git 版本与写边界核对、`typecheck`、Vitest 9/9、正常与 `/tennis/` 子路径生产构建、精选查阅 Builder 自测截图）→ 触发 Fast-Fail 门禁（已证实存在阻断级缺陷，本轮跳过 Tester，待 Round 2 修复后委派 Tester 执行完整交互取证）

达标项：
- [版本与写边界 / AC-16 部分] `git rev-parse HEAD` 精确匹配 `a5204e2aeed47ba3b36ee59061d7a82de5ee3196`；改动严格限定于 `tennis-2k/client/**` 与 `tennis-2k/docs/review/wp2/**`，零修改根 `package.json`/`package-lock.json`、`shared/**`、`server/**` 或 `gold-miner/`。正常入口代码审确认 `window.__COURT2K_TEST__` 仅在 `?test=1` 时挂载，无深路径 import `shared/src/...`，无硬编码 `localhost` 或绝对 `/ws`。
- [类型检查与现有单测] `npm run typecheck --workspace=@court2k/client` 0 errors；`npm run test --workspace=@court2k/client` 3 文件 9/9 通过（`input.test.ts`、`perf.test.ts`、`net.test.ts`）。
- [包体与子路径构建 / AC-13 & AC-15 部分] 正常生产构建总 gzip 体积 `163.41 KB`（`0.48 + 2.86 + 36.10 + 123.97 KB`，远低于 `600 KB` 门槛）；`VITE_BASE_PATH=/tennis/` 子路径构建产出 `dist/index.html` 全部资源前缀为 `/tennis/assets/...`，`deriveWsUrl('/tennis/')` 单测通过。
- [基础架构与视觉初审] 100% 消费 `@court2k/shared` 纯函数与状态机（含 `toLocalView` / `toLocalEvent`、`launchHawkeyeTestBall`、`requestManualPause/Resume` 等），`PlayerAvatarController` 接口符合 `CONTRACT.md` §4.1，`AudioManager` 为纯 Web Audio API 合成（零外部音频文件）；抽检 Builder 截图确认三场地视觉、四流派外观与头饰、鹰眼 3D 特写及 2K HUD 布局整体清晰可读。

返工项（FAIL 时填写）：

【问题 1（必须）：Retina/高刷自适应性能链路存在三处逻辑错误，导致每帧重分配画布、144Hz 必误降档且 60Hz 永无法回升】
- 现象与证据：
  1. `client/src/render/CourtScene.ts:438-439` 在 `applyPerfPreset()` 中无条件调用 `this.renderer.setPixelRatio(activeDpr)`，而 `client/src/game/GameApp.ts:608` 在**每一帧 RAF** 中都会调用 `applyPerfPreset()`。经直接查验 `node_modules/three/build/three.module.js`，`WebGLRenderer.setPixelRatio` 每次调用均无条件执行 `this.setSize(_width, _height, false)`，导致每帧都在重置 canvas 尺寸与 WebGL 渲染缓冲，在高 DPR / Retina 设备上直接制造额外 GPU 抖动与掉帧。
  2. `client/src/game/GameApp.ts:555` 在 `estHz > 105` 时以 `nowMs - this.lastRenderMs < 15.2` 节流；在 **144Hz 显示器**（RAF 周期 `6.944 ms`）下，`2 × 6.944 = 13.89 ms < 15.2 ms`，每渲染 1 帧必跳过 2 帧，导致实际 `renderDtMs = 20.83 ms`（约 48 FPS）；随后 `GameApp.ts:604` 计算 `workMs = Math.max(renderDtMs, performance.now() - frameStart) >= 20.83 ms > 20 ms`，使 `PerfManager` 在空闲高性能 GPU 上 4 秒内必然连续误降档 `HIGH → MEDIUM → LOW`。
  3. 同一行 `GameApp.ts:604` 使 **60Hz 显示器**与 **120Hz 限 60fps 模式**下的 `workMs` 恒 `>= 16.67 ms`，导致 `PerfManager.ts:165` 的回升条件 `avgMs < 13.5 && p95 < 16.5` 在真实渲染循环中数学上永远无法满足（仅靠 `simulatePerfSpike` 覆写才可触发）。
- 影响：直接违背 `SPEC.md` §3.9 与 `AC-12` 的 Retina 防掉帧、高刷限帧与降档后最多回升 1 次核心防护目标，在真实 60Hz/144Hz 桌面设备上产生负优化。
- 修改方向：
  1. `CourtScene.applyPerfPreset` 缓存已应用的 `activeDpr`，仅当 `activeDpr` 实际变化时再调用 `renderer.setPixelRatio(activeDpr)`；
  2. 在 `PerfManager` 中将用于统计显示 FPS 的实际呈现间隔 `renderDtMs` 与用于降档/回升判定的帧耗时指标合理分离（或基于真实渲染工作耗时 + 掉帧超时判定，确保 60Hz/120Hz 正常满帧运行时稳定低于回升阈值而不被 VSync 间隔锁死），同时修正高刷 60fps 节流逻辑避免 144Hz 落入 48fps/`20.83ms` 误判区；
  3. 补充 Vitest 单测覆盖 60Hz 正常稳定回升与 144Hz 节流不误降档场景。
- 下轮验收标准：代码审确认 `setPixelRatio` 仅在 DPR 变更时调用；60Hz/120Hz/144Hz 模拟循环单测全绿（144Hz 稳定不误降档、60Hz 降档后轻负载可回升 1 次且 `upgradeCount <= 1`）；Tester 在 `?test=1&netdebug=1` 下完成 `AC-12` 完整升降档与 90/100/120/144Hz 实测取证。

【问题 2（必须）：联机收到 `GAME_EVENT(MATCH_OVER)` 时未同步更新 `onlineState` 与 `SnapshotBuffer`，导致断线 15s 弃权等终局弹窗可能永久卡死】
- 现象与证据：`docs/CONTRACT.md` §3.4（L415）明确规定 15 秒断线超时弃权的**唯一结算事件**为 `S→All GAME_EVENT(MATCH_OVER, reason:'forfeit', forfeitedBy:i)`（不再发 `ERROR`，且不承诺额外补发 `STATE_SNAPSHOT`）。但 `client/src/game/GameApp.ts:537-542` 收到 `MATCH_OVER` 时仅保存 `matchOverReason` 与 `forfeitedBy`，并未将 `ev.score`、`ev.stats` 及 `phase = 'match_over'` 写入 `this.onlineState` 与 `this.snapshots`；而 `HudView.ts:377,418` 依赖 `localView.phase === 'match_over'` 渲染结算面板。
- 影响：当 WP3 服务端严格按 `CONTRACT.md` 在 15 秒断线弃权后仅广播 `GAME_EVENT(MATCH_OVER)` 并停止快照推送时，在线客户端将永久停留在 `paused_disconnect`（“对手断线重连中 0s”）弹窗，无法看到胜利/弃权结果、2K 统计表或 Rematch 按钮，直接阻塞 `AC-11` 与 `E2E-03`。
- 修改方向：在 `GameApp.processLocalEvent` 处理 `MATCH_OVER` 时，若处于 `online` 模式且 `this.onlineState` 非空，克隆更新 `phase = 'match_over'`、`score = ev.score`、`stats = ev.stats` 并调用 `this.snapshots.reset(nextOnlineState)`；在 `tests/net.test.ts` 或新增单测中验证“仅收到 `GAME_EVENT(MATCH_OVER)` 且无后续快照时，状态正确切至 `match_over`”。
- 下轮验收标准：代码审与单测证实仅凭 `GAME_EVENT(MATCH_OVER)` 即可确定性切入 `match_over` 并保留完整 `score`/`stats`/`reason`/`forfeitedBy`。

【问题 3（必须）：`WsClient.simulateDisconnect(reconnectAfterMs)` 未解除旧 socket `onclose` 监听，导致自定义重连延迟被强制改写为 1200ms】
- 现象与证据：`client/src/net/WsClient.ts:240-258` 在 `reconnectAfterMs >= 0` 时置 `this.intentionalClose = false` 后调用 `this.ws.close()` 并 `this.scheduleAutoReconnect(reconnectAfterMs)`；但真实浏览器的 `WebSocket.close()` 会在数毫秒后异步触发旧 `socket.onclose`（`WsClient.ts:197-208`），其内 `if (!this.intentionalClose && this.session) this.scheduleAutoReconnect(1200)` 会清空并覆盖先前设置的 `reconnectAfterMs`（例如 `4000ms` 或 `20000ms` 均被篡改为 `1200ms`）。
- 影响：破坏 `SPEC.md` §5 约定的 `simulateDisconnect(reconnectAfterMs)` 受控测试钩子语义，导致后续 `AC-11` / `E2E-03` 无法准确验证 4 秒重连窗口。
- 修改方向：在 `WsClient.simulateDisconnect` 调用 `this.ws.close()` 前先解绑旧 socket 的 `onopen`/`onmessage`/`onclose`/`onerror = null`（或在 `onclose` 中校验 `if (this.ws !== socket) return`）；补充异步 `onclose` 触发的 Vitest 回归单测验证 `simulateDisconnect(4000)` 在 1200ms 时不会提前重连、在 4000ms 才发起重连。
- 下轮验收标准：Vitest 单测覆盖异步 `onclose` 场景并通过，代码审确认无竞态覆盖。

【问题 4（必须）：超级抢十（`super_tiebreak`）赛后弹窗比分显示错误（显示 `1 - 0` 而非实际抢十分数），且联机低帧率下输入累加器存在无界增长风险】
- 现象与证据：
  1. `shared/src/rules.ts:148-150` 在 `super_tiebreak` 完赛时将 `games[winner]` 置为 `1`，真实比分保存在 `score.points`（如 `10 - 8` / `11 - 9`）。但 `client/src/ui/HudView.ts:434` 在完赛面板固定输出 `${state.score.games[localIdx]} - ${state.score.games[oppIdx]}`，导致超级抢十完赛错误显示 `1 - 0`。
  2. `client/src/game/GameApp.ts:643-652` 的 `stepOnlineInputs` 在低帧率（`< 30 FPS`，`dtSec = 0.05`）下每次循环受 `steps < 2` 限制最多消耗 `2 * fixedDt`，未对残留的 `this.onlineInputAccumSec` 封顶，长期低帧率后会无限累积并在帧率恢复时突发送帧触发服务端 `RATE_LIMITED`。
- 影响：超级抢十完赛比分展示与真实赛果不符（影响 `AC-08`）；低帧率联机恢复后可能触发限流丢输入。
- 修改方向：
  1. `HudView.ts:434` 当 `state.score.format === 'super_tiebreak'` 时展示 `${state.score.points[localIdx]} - ${state.score.points[oppIdx]}`（Fast4 保持 `games` 比分，若 4-3 抢七可附带抢七小分更佳）；
  2. `GameApp.ts:643` 将 `this.onlineInputAccumSec` 封顶（如 `Math.min(this.onlineInputAccumSec + dtSec, fixedDt * 2)`）。
- 下轮验收标准：代码审确认上述两处修正；Tester 在 Round 2 实测超级抢十完赛弹窗显示正确比分（如 `11 - 9`）。

【问题 5（建议）：体验与渲染细节微调（非阻断，建议本轮一并优化）】
- 现象与证据：
  1. `client/src/render/CourtScene.ts:594-602` 在 `meter.active` 期间每帧 `dispose()` 并重新 `new THREE.RingGeometry(...)`，仅在 `effectiveHalfWidth` 或 `sweetCenter` 变化时重建即可；且 2K 弧形绿条的白色指针（宽 `0.06`）在底线白线背景下偏细，适当加粗/提高对比度可提升击球甜区辨识度。
  2. `client/src/render/CourtScene.ts:124` 将 `avatars` 字段类型显式标注为 `[PlayerAvatarController, PlayerAvatarController]`，强化抽象替换接口边界。
  3. `client/src/input/InputController.ts:114-116` 在大厅态（`captureActive === false`）收到 `window_focus` 时可跳过 `activeEl.blur()`，避免用户切窗复制房间码回来时输入框失焦。
- 影响：优化手感可读性与渲染微开销，无阻断影响。
- 修改方向：按上述 3 点做局部清理即可。
- 下轮验收标准：代码审确认（不作为阻断门槛）。

未验证项（非门槛 / 环境限制）：
- 本轮因第 2 步代码审已触发 Fast-Fail 门禁，跳过 Tester 实机交互取证；`AC-01` ~ `AC-08`、`AC-12` ~ `AC-14`、`AC-16` 的浏览器端独立交互验收将于 Round 2 修复完成后一次性委派 `tester-wp2` 执行。
- 真实双浏览器 1v1 联机闭环（`AC-10`、`AC-11`、`E2E-01 ~ E2E-04`）依赖 WP3 联调，将在整合阶段验收；Mac Retina 2x 物理屏与 120Hz/144Hz 真机观感属硬件限制，届时标为非门槛待用户真机自测。

给用户的摘要：
WP2（`@court2k/client`）Round 1 整体完成度很高，3D 球场、C2 风格化角色、2K HUD、Web Audio 与 163KB 轻量化构建均已成型，但代码审查发现 4 处必须修复的缺陷（Retina 每帧重设 DPR 与 60Hz/144Hz 帧率自适应失准、联机 15 秒断线弃权 `MATCH_OVER` 可能卡弹窗、`simulateDisconnect` 异步覆盖重连延时、超级抢十完赛比分显示为 `1-0`）。本轮已触发 Fast-Fail 退回 Builder 一次性修复，修复后进入 Round 2 由独立 Tester 实机全量取证。

Notion 一行摘要：
FAIL / WP2 R1 代码审触发 Fast-Fail（4 项必修：DPR 每帧重建与 60/144Hz 误判、联机 MATCH_OVER 状态同步、simulateDisconnect 竞态、超级抢十完赛比分） / 交 Builder R2 修复后派 Tester 实机复验
