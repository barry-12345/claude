# Tester 实测证据报告 — Integration V2 Round 1（Court 2K V2）

## 1. 运行环境与版本核对
- **实际测试版本**：分支 `integration/v2` @ `3a71240ae817560df809f6c4943e6f720ebae0c3`（与简报一致：是，`git status --short` 仅含新增报告与证据目录，未改动任何产品或既有测试代码）
- **运行环境**：
  - OS：Windows（本地工作区 `wt-int/tennis-2k`）
  - 浏览器与视口：Microsoft Edge Headless（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）+ `playwright-core@1.51.1`，所有双人联机场景均使用两个独立 `browser.newContext({ viewport: { width: 1280, height: 720 } })`
  - WebGL 渲染器（本机 GPU 实测）：`WebGL 2.0 (OpenGL ES 3.0 Chromium)` / `ANGLE (Intel, Intel(R) Arc(TM) 130T GPU (16GB) (0x00007D51) Direct3D11 vs_5_0 ps_5_0, D3D11)`
  - 端口分配与服务 PID（全部已在测试结束后按 PID 精准 `Stop-Process` 终止）：
    - 正常入口（无 `?test=1`、无 `ENABLE_TEST_HOOKS`）：后端 `127.0.0.1:4521`（PID `44972`）、Vite `127.0.0.1:4522`（PID `15492`）
    - 受控钩子入口（`?test=1`、`ENABLE_TEST_HOOKS=1`）：后端 `127.0.0.1:4525`（PID `50040`）、Vite `127.0.0.1:4526`（PID `55808`）
    - `/tennis/` 子路径生产构建与本地反代入口：后端 `127.0.0.1:4523`（PID `33660`，`WS_PATH=/tennis/ws`）、Node 反代 `127.0.0.1:4524`（PID `52324`，映射 `dist-tennis` 至 `/tennis/*`）
- **实际调用模型与档位**：Swarm Worker `tester-integration`（简报委派为 `Gemini 4 Hydrogen High`，平台未向 worker 上下文暴露底层模型 ID 字符串）

## 2. 用例执行总表
| 用例编号 | 对应 SPEC | 入口方式 | 执行步骤摘要 | 客观结果 | 关键数字 / 错误摘录 | 精选证据路径 |
| --- | --- | --- | --- | --- | --- | --- |
| E2E-01 | AC-02, AC-04, AC-09, AC-11, AC-12, AC-15, AC-17 | 正常入口 `http://127.0.0.1:4522/`（无 `?test=1`，服务端 `ENABLE_TEST_HOOKS=0`） | 核查无测试钩子、双 Context 红土 Fast4 (`power` vs `defender`) 联机、日场亮度与 180° 镜像视角、V2 键盘实操与 `Esc` 暂停/恢复、打完 4-3(7-2) 完赛核查 6 项统计并双方 `Rematch`，另开 `super_tiebreak` 核查横幅与静音按钮 | 通过 | `window.__COURT2K_TEST__ === undefined`；双方 `/assets/models/tennis_player.glb` HTTP `200`；0 console error / 0 page error / 0 HTTP ≥400；P0 截图上 35% 亮度均值 `172.30` / 全帧 `151.77`，P1 上 35% `171.76` / 全帧 `151.36`；暂停剩余次数 `[2, 3]`，3s 倒计时后即时发球响应 `CLEAN · 216 km/h`；完赛结算 `4-3 (7-2)` 含 6 项统计（含 `CLEAN 甜点率` `81%` vs `100%`）；Rematch 后同房清零、暂停恢复 `[3, 3]`；`super_tiebreak` 横幅精确为 `SUPER TIEBREAK · 超级抢十`，静音切换 `🔇 静音` / `🔊 音效` 无 AudioContext 报错 | `docs/review/integration/evidence/v2-round-1-tester/e2e01-p0-rally.png`, `docs/review/integration/evidence/v2-round-1-tester/e2e01-p1-rally.png`, `docs/review/integration/evidence/v2-round-1-tester/e2e01-rematch.png`, `docs/review/integration/evidence/v2-round-1-tester/e2e01-super-tb.png`, `docs/review/integration/evidence/v2-round-1-tester/e2e01-log.json` |
| E2E-02 | AC-05, AC-06, AC-11 | 受控钩子 `http://127.0.0.1:4526/?test=1`（`ENABLE_TEST_HOOKS=1`） | 双 Context 建房开赛记录 Avatar 状态；① 经 `spawnIncomingBall` 注入近身来球，P1 不按键放球；② 再次注入来球，P1 提前短按 `K` + 按住 `A` 截青色预选环帧并核查 `dropshot` 落点与 180° 镜像同步 | 通过 | P0/P1 `avatarLoaded=true`、`avatarSource='glb'`、`avatarTriangles=4640`；① P1 `totalShots=0`，P0 得分 `[1, 0]`；② P1 武装 `armedAction='K'`，触发 `dropshot`（`CLEAN`），P1 本地 `predictedLanding=(-3.780, 0.0335, -2.854)`（`\|Z\|=2.85 m ∈ [1.8, 3.9] m`），P0 本地同步为 `(+3.780, 0.0335, +2.854)`（严格 180° 镜像）；0 console error / 0 HTTP ≥400 | `docs/review/integration/evidence/v2-round-1-tester/e2e02-p1-armed-ring.png`, `docs/review/integration/evidence/v2-round-1-tester/e2e02-p0-mirrored.png`, `docs/review/integration/evidence/v2-round-1-tester/e2e02-log.json` |
| E2E-03 | AC-08, AC-12 | 受控钩子 `http://127.0.0.1:4526/?test=1`（`ENABLE_TEST_HOOKS=1`） | 联机依次调用 `triggerHawkeyeShot`：① `inBounds:true, distCm:8`；② `inBounds:false, distCm:10`；③ `inBounds:false, distCm:25`，核查双端 3D 鹰眼特写、镜像落点、`HAWKEYE_END` 重置与 25 cm 不触发鹰眼 | 通过 | ① 双端同判 `IN`（`distanceToLineCm=7.27`），`bouncePos` P0 `(4.042, 0.0335, -7.536)` 与 P1 `(-4.042, 0.0335, 7.536)` 互为 `(-x,y,-z)` 镜像，结束后 `lastResetReason='HAWKEYE_END'` 且 P0 `D` (`-1.45 -> -0.609`) / P1 `A` (`-2.15 -> -2.902`) 即时移动；② 双端同判 `OUT`（`distanceToLineCm=10.77`），`bouncePos` `(4.223, 0.0335, -7.537)` vs `(-4.223, 0.0335, 7.537)`，结束后 `HAWKEYE_END` 且 P0 `D` (`1.45 -> 2.481`) / P1 `A` (`2.15 -> 1.216`) 正常；③ `25 cm` `sawHawkeye=false`，直接得分 `[1,1] -> [1,2]`；0 console error | `docs/review/integration/evidence/v2-round-1-tester/e2e03-p0-hawkeye-in.png`, `docs/review/integration/evidence/v2-round-1-tester/e2e03-p1-hawkeye-in.png`, `docs/review/integration/evidence/v2-round-1-tester/e2e03-p0-hawkeye-out.png`, `docs/review/integration/evidence/v2-round-1-tester/e2e03-p1-hawkeye-out.png`, `docs/review/integration/evidence/v2-round-1-tester/e2e03-log.json` |
| E2E-04 | AC-13 | 受控钩子 `http://127.0.0.1:4526/?test=1`（`ENABLE_TEST_HOOKS=1`） | ① `setScore([1,0],[2,1])` 后 P1 `simulateDisconnect(4000)` 核查 `FULL_SYNC`+3s 倒计时保分恢复及即时操作；② P1 `simulateDisconnect(-1)` + `fastForwardPause(14.5)` 核查弃权结算；③ `waiting` 房 P1 `page.reload()` 核查大厅保持与 READY 开赛 | 通过 | ① `paused_disconnect` -> `resuming` -> `serve_ready`，`reconnectCount=1`、比分保留 `games=[1,0], points=[2,1]`，恢复瞬间 P1 `D` 移动 `x: -2.15 -> -0.933` 且 `J` 响应；② P0 仅弹出唯一 `MATCH_OVER(forfeit)` 弹窗（`modalCards=1`），0 个 `ERROR` Toast；③ `waiting` 房 `BYDR` P1 刷新后 `mode='lobby'`、房间号可见、`hudHidden=true`，随后双方 READY 顺利开赛（`mode='online', phase='serve_ready'`）；0 console error | `docs/review/integration/evidence/v2-round-1-tester/e2e04-p1-reconnected.png`, `docs/review/integration/evidence/v2-round-1-tester/e2e04-p0-forfeit.png`, `docs/review/integration/evidence/v2-round-1-tester/e2e04-p1-waiting-reload.png`, `docs/review/integration/evidence/v2-round-1-tester/e2e04-log.json` |
| E2E-05 | AC-11, AC-14, AC-16 | 反代生产构建 `http://127.0.0.1:4524/tennis/?netdebug=1`（后端 `4523`，反代 `4524`） | 核查非 `/tennis/` 路径返回 404；在 `/tennis/?netdebug=1` 跑通单机开赛与双 Context 1v1 联机开赛；核查静态资源、`/tennis/assets/models/tennis_player.glb`、`/tennis/ws` 与 `.netdebug-panel` 指标 | 通过 | `/`, `/assets/models/tennis_player.glb`, `/health`, `/ws` 均返回 HTTP `404`，`/tennis/health` 返回 `200`；单机与双端 `/tennis/assets/models/tennis_player.glb` 均 HTTP `200`，0 个 404，0 console error；`/tennis/ws` 握手成功；`.netdebug-panel` 完整输出：单机 `FPS:46, ActiveDPR:1.00, Tier:HIGH, DrawCalls:78, EstHz:120Hz`；联机 P0 `FPS:60, ActiveDPR:1.00, Tier:HIGH, DrawCalls:78, EstHz:120Hz, RTT:0ms, Reconn:0`，P1 `FPS:60, DrawCalls:78, EstHz:119Hz`（全场景 DrawCalls `78 ≤ 150`，ActiveDPR `1.00 ≤ 2.0`） | `docs/review/integration/evidence/v2-round-1-tester/e2e05-subpath-single.png`, `docs/review/integration/evidence/v2-round-1-tester/e2e05-subpath-online-netdebug.png`, `docs/review/integration/evidence/v2-round-1-tester/e2e05-log.json` |

## 3. 失败 / 异常详述（仅列失败与阻塞项）
无（本次 5 项必测场景全部跑通，0 失败、0 阻塞）。

## 4. 客观体验观察（纯事实，非裁决）
- 1280×720 视口下，正常入口与 `/tennis/` 反代入口的大厅界面、计分板、V2 底部操作提示条、鹰眼特写横幅、暂停/弃权/赛后统计弹窗及 `.netdebug-panel` 均无元素裁切或文本重叠。
- E2E-01 早期以“P0 与 P1 各自仅发球不回球”推进 Fast4 赛程时，双方各保发球局至 `3-3` 抢七并拉锯至 `15-14`（因抢七需净胜 2 分且双方互不接发）；改为 P0 在 P1 发球局按 `J` 接发球后于约 113 秒内以 `4-3 (7-2)` 正常完赛。
- `e2e02-p1-armed-ring.png` 捕获于按住 `K` 后约 45 ms（`holdDurationSec ≈ 0.033s`），人物脚下已出现青色预选圆环，但底部 HUD 的 `预选 K 小球/削球` 徽标尚未刷新到该截图帧（而 `e2e01-p1-rally.png` 中同一预选动作的青色圆环与底部 `预选 K 小球/削球` 徽标均清晰可见）。

## 5. 未测项与止损记录
- 以下硬件与网络边界因当前本地测试环境限制未实测（与简报“暂测不了的边界”一致）：
  1. 真机 Mac Retina 2x 设备像素比渲染与 `ActiveDPR` 缩放表现；
  2. 真 120Hz / 144Hz 物理显示器刷新率（本机 Headless Edge `EstHz` 实测约 `119–120Hz` 并触发 `60fps Cap`，但非真实外接高刷物理屏人眼观感验证）；
  3. 真实公网高丢包 / 高抖动网络环境（本次联机 RTT 实测 `0ms`）。
- 止损记录：无（各用例均在预算内完成）。