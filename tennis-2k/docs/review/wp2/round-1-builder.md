# Builder 交付报告 — Round 1（WP2 `@court2k/client`）

## 0. 快速索引
- **候选版本**：`wp2/client`（代码与证据提交：`903a6bc8cec9ef7ab0b4d617e59cabd971c48094`，本报告随后以文档提交落盘，最终 HEAD 见调度板回报）
- **本轮相对上轮变化**：首次交付，完整实现 `@court2k/client`（Three.js 3D 球场与大满贯场馆、C2 风格化 3D 角色与 `PlayerAvatarController` 接口、2K 弧形绿条甜区表、Takeover 金色光环、3D 贴地鹰眼特写、Web Audio 程序化音效、`InputController.resetAndRebind()` 自愈、`PerfManager` DPR/降档/高刷限帧、WS 联机客户端与 `VITE_BASE_PATH` 子路径兼容）。
- **启动方式与 Tester 前置条件**：
  - 启动命令 / 入口：
    - 开发模式（含 WS/health 代理）：在 `D:\court2k-work\wt-wp2\tennis-2k\client` 运行 `npx vite --host 127.0.0.1 --port 3201 --strictPort`（可设 `$env:VITE_WS_PROXY_TARGET='http://127.0.0.1:3301'` 与 `$env:VITE_BASE_PATH='/tennis/'`）
    - 生产预览（需先 `npm run build --workspace=@court2k/client`）：`npx vite preview --host 127.0.0.1 --port 3201 --strictPort`
    - 访问 URL：`http://127.0.0.1:3201/`（正常入口）或 `http://127.0.0.1:3201/?netdebug=1`（含性能/网络面板）
  - 测试账号 / 种子 / 样本：无外部账号需求；单人模式默认 RNG 种子 `42`（可在 `?test=1` 下通过 `setSeed(seed)` 覆盖）。
  - 受控测试钩子用法：
    - 严格隔离：仅当 URL 携带 `?test=1` 时挂载 `window.__COURT2K_TEST__`；正常 URL 下 `window.__COURT2K_TEST__ === undefined`，且默认不渲染 `?netdebug=1` 调试面板。
    - 可用方法（`Court2KTestHook`）：
      - `getState()`：返回 `TestStateSnapshot`（含当前本地视图深拷贝 `matchState`、`qualityTier`、`activeDpr`、`estHz`、`fpsCapEnabled`、`upgradeCount`、`drawCalls`、`inputDiagnostics` 等）
      - `setSeed(seed)`
      - `setScore({ games?, points?, isTiebreak?, server?, serveNumber? })`
      - `setTakeover(playerIndex, value)`（`0 | 1`，`0..100`）
      - `triggerHawkeyeShot({ inBounds, distCm, line? })`（经真实物理发射测试球并走 `<= 15 cm` 阈值判定）
      - `fastForwardPause(seconds)`
      - `simulatePerfSpike(frameMs, durationMs)`
      - `simulateRefreshRate(hz)`
      - `simulateDisconnect(reconnectAfterMs)`（联机模式有效，`-1` 表示保持断开）
  - 清理方式：停止 Vite 进程（记录启动 PID 并仅终止该 PID）；联机退出大厅自动清除 `sessionStorage` 中的 `court2k_online_session`。
- **自测命令与证据索引**：
  - 一键测试命令：
    - `npm run typecheck --workspace=@court2k/client`（结果：0 errors）
    - `npm run test --workspace=@court2k/client`（结果：3 文件 / 9 项用例全部通过）
    - `npm run build --workspace=@court2k/client`（结果：gzip 总包体 `163.41 KB` = `0.48 + 2.86 + 36.10 + 123.97 KB`，`<= 600 KB`）
    - `$env:VITE_BASE_PATH='/tennis/'; npm run build --workspace=@court2k/client`（结果：HTML 资源全部正确前缀 `/tennis/assets/...`）
  - 关键截图/日志路径：`tennis-2k/docs/review/wp2/evidence/round-1/`（`01-lobby-hard.png` ~ `11-hawkeye-out.png` 与 `e2e-results.json`）
- **环境未验证缺口**：
  - 真实双浏览器联机闭环（P0/P1 跨进程 WS 同步、手动暂停 60s 联机互操作、断线 15s 重连与 Rematch）因 WP2 与 WP3 并行开发、本 worktree 无已构建后端交互启动，将在整合阶段 `E2E-01 ~ E2E-04` 联调验证（前端 WS 客户端状态机、缓冲复位、`lastAckSeq` 归零配合与 `sessionStorage` 重连逻辑已通过 Vitest mock socket 集成单测验证）；
  - 本机无头 Edge 使用 SwiftShader 软件 WebGL 渲染，测试态下实测 `5–15 FPS`（真机 GPU 硬件高帧率表现与 120Hz/Retina 实屏观感需在真机/整合环境复测）。

---

## 1. 实现概述与接口说明

1. **100% 消费 `@court2k/shared`**：
   - 仅从 `@court2k/shared` 顶层入口导入 `createMatchState`、`stepMatch`、`computeAIInput`、`createRng`、`toLocalView`、`toLocalEvent`、`requestManualPause`、`requestManualResume`、`applyScorePatch`、`launchHawkeyeTestBall`、`fastForwardPauseState`、`computeStatsSummary`、`COURTS`、`ARCHETYPES`、`COURT_DIM`、`PHYSICS_CONSTANTS`、`netHeightAt` 等导出，前端零重复物理或规则逻辑。
   - 本地渲染与事件处理均先经 `toLocalView(state, yourSide)` 与 `toLocalEvent(event, yourSide)` 转换，玩家索引使用动态 `playerIndex`（`0` 或 `1`），不硬编码 `players[0]`。
2. **真 3D 球场与 C2 风格化角色（`client/src/render/CourtScene.ts`、`PlayerAvatar.ts`）**：
   - 三块大满贯球场（美网蓝绿硬地、法网红土含滑步红土扬尘粒子、温网双色草地条纹）及标准 ITF 白线、随 `netHeightAt(x)` 下垂的 3D 球网与网柱、赛场围挡 LED 灯带、裁判椅、看台与 Instanced 观众席（全场景 Draw Calls 实测 `99–106 <= 150`）。
   - 抽象接口 `PlayerAvatarController`（定义于 `client/src/contracts.ts`），`ProceduralPlayerAvatar` 实现 4 流派体型比例（`shoulderScale`）、球衣配色与 4 种可辨识头饰/护具（白头带/双护腕/遮阳帽/反戴鸭舌帽）、3D 网球拍、8 态关节平滑混合、Takeover 金色光环，预留 `.glb` 替换口。
   - 脚下 2K 弧形绿条甜区表（Takeover 期自动反映 1.25× 有效半宽）、`PERFECT` 绿爆冲击波、球飞尾迹、地面阴影与落点预测环、1.8s 3D 贴地鹰眼特写（物理球印椭圆 + 发光线 + `IN / OUT` 与精确厘米边距）。
3. **输入自愈、性能自适应、Web Audio 与联机客户端**：
   - `InputController`（`client/src/input/InputController.ts`）：在 `initial_mount`、`single_match_start`、`single_pause_resumed`、`MATCH_START`、`FULL_SYNC`、`MATCH_RESUMED`、`HAWKEYE_END`、`window blur/focus`、`visibilitychange` 触发 `resetAndRebind(reason)`，清残留键位与蓄力态、重绑监听并 blur 焦点元素；支持单帧超快点按无丢失。
   - `PerfManager`（`client/src/core/PerfManager.ts`）：DPR 硬上限 `2.0`、`HIGH(2.0)/MEDIUM(1.5)/LOW(1.0)` 滑动 60 帧降档与最多 1 次回升、仅 `estHz > 105` 启用 60fps 限帧、`?netdebug=1` 面板。
   - `AudioManager`（`client/src/audio/AudioManager.ts`）：纯 Web Audio API 合成（零外部音频 404），按场地差异生成击球/弹地/`PERFECT` 甜点音/擦网/鹰眼/欢呼/倒计时提示音，首次手势自动解锁，支持一键静音。
   - `WsClient` & `SnapshotBuffer`（`client/src/net/`）：严格遵循 `CONTRACT.md` §3，`import.meta.env.BASE_URL` 推导相对 WS 路径、`sessionStorage` 存 `sessionToken` 支持 15s 重连、`MATCH_START` / `FULL_SYNC` 清插值队列并复位 `seq = 0`。

---

## 2. 验收项逐条自测结果（对应 SPEC 编号）

| 编号 | 验证方式 | 实测结果与关键数字 | 原始证据路径 |
| --- | --- | --- | --- |
| `AC-01` / `R-01~04` | Playwright + Edge（正常 URL 无 `?test=1`） | 大厅切换 3 场地与 4 流派即时预览、进入硬地单人对战、`WASD`+`J` 发球绿条、对拉与 `Esc` 暂停/恢复全部闭环，控制台 0 Error / 0 404 | `evidence/round-1/01-lobby-hard.png` ~ `07-pause-modal.png`, `e2e-results.json` |
| `AC-03` | Playwright 4 流派视觉检查 | 4 流派球衣、体型、头饰（头带/护腕/遮阳帽/反戴帽）及五维（总分 `400`）肉眼可分且无穿模 | `evidence/round-1/01-lobby-hard.png` ~ `04-lobby-defender.png` |
| `AC-04` / `AC-05` | Vitest 单测 + Edge 实测 | `InputController` `WASD`/`W+K`/`J`/`L`/快按均准确采样；2K 弧形绿条与发球抛球动画正常触发 | `client/tests/input.test.ts`, `evidence/round-1/05-serve-meter.png` |
| `AC-06` | Edge `?test=1` `setTakeover(0, 100)` | 激活后脚下亮起金色光环，HUD 显示 `激活中 (2分)`，绿条按 `effectiveHalfWidth` 放宽 | `evidence/round-1/08-takeover-clay-netdebug.png` |
| `AC-07` | Edge `?test=1` `triggerHawkeyeShot` | `8 cm` 界内（实测 `7.27 cm` `IN`）与 `10 cm` 界外（实测 `7.17 cm` `OUT`）均触发 1.8s 3D 特写；结束后 `lastResetReason === 'HAWKEYE_END'` 且按 `KeyD` 立即移动 (`pressedMoved: true`) | `evidence/round-1/09-hawkeye-in.png`, `11-hawkeye-out.png`, `e2e-results.json` |
| `AC-08` | Edge 完赛统计面板 | 赛后弹出 2K 6 项统计板，无文字截断/按钮换行 | `evidence/round-1/10-postmatch-stats.png` |
| `AC-12` | Vitest + Edge `?test=1&netdebug=1` | DPR 上限 `2.0`；`26ms` 持续 `2.5s` 降档、稳定 `9s` 回升 1 次、`upgradeCount === 1` 上限；`90Hz` 不限帧、`120Hz` 限 60fps；`?netdebug=1` 指标完整 | `client/tests/perf.test.ts`, `evidence/round-1/08-takeover-clay-netdebug.png`, `e2e-results.json` |
| `AC-13` | `vite build` + Edge `?netdebug=1` | Gzip 总包体 `163.41 KB`（`<= 600 KB`）；场景 Draw Calls `99–106`（`<= 150`）；`PlayerAvatarController` 抽象接口位于 `client/src/contracts.ts` | `vite build` 输出, `e2e-results.json` |
| `AC-14` | Edge 正常入口实测 | 点击静音按钮切换成功，控制台 0 AudioContext 报错、0 外部音频 404 | `e2e-results.json` (`muteToggled: true`, `consoleErrors: []`) |
| `AC-15` | `VITE_BASE_PATH=/tennis/` 构建 + Vitest | `dist/index.html` 全部资源走 `/tennis/assets/...`；`deriveWsUrl('/tennis/')` 产出 `wss://.../tennis/ws` | `client/tests/net.test.ts`, `vite build` 输出 |
| `AC-16` | Edge 正常入口 + `git status` | 正常入口 `window.__COURT2K_TEST__ === undefined` 且 `.netdebug-panel` 隐藏；`git status` 仅改 `tennis-2k/client/**` 与 `tennis-2k/docs/review/wp2/**` | `e2e-results.json`, `git status -s` |
