# Tester 实测证据报告 — Round 1（Integration V1）

## 1. 运行环境与版本核对
- **实际测试版本**：分支 `integration/v1`，提交 `270b3eff62bb07edda9cc5e90a8e4ce4d48d49f0`（与简报一致：是）
- **运行环境**：Windows + Microsoft Edge（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，headless + SwiftShader WebGL）+ `playwright-core ^1.51.1` + Node `v26.13.0`；双独立 `browser.newContext({ viewport: { width: 1280, height: 720 } })`；端口分配：
  - `E2E-01`（正常入口）：服务端 `127.0.0.1:4522`（无 `ENABLE_TEST_HOOKS`）+ Vite `127.0.0.1:4521`
  - `E2E-02` / `E2E-03`（受控钩子）：服务端 `127.0.0.1:4526`（`ENABLE_TEST_HOOKS=1`）+ Vite `127.0.0.1:4525`（`?test=1`）
  - `E2E-04`（子路径反代）：服务端 `127.0.0.1:4524`（`WS_PATH=/tennis/ws`，无 `ENABLE_TEST_HOOKS`）+ 临时 Node HTTP/WS 反代 `127.0.0.1:4523`
- **实际调用模型与档位**：当前会话平台未向执行端暴露具体模型 ID 与 effort 档位（如实留空，不臆测）

## 2. 用例执行总表
| 用例编号 | 对应 SPEC | 入口方式 | 执行步骤摘要 | 客观结果 | 关键数字 / 错误摘录 | 精选证据路径 |
| --- | --- | --- | --- | --- | --- | --- |
| **E2E-01** | `AC-10`, `AC-16` | 正常入口（无 `?test=1`、无 `ENABLE_TEST_HOOKS`） | 核对无测试钩子与隐藏 `.netdebug-panel`；Fast4 建房（`Q9GX`）选 `power`/`defender` 开赛并核对近端镜像视角；P0 `Esc` 暂停、P1 `#btn-modal-resume` 恢复后立即 `A`/`D`/`J` 击球；完结 Fast4 第 1 局（`1-0`）；另开超级抢十（`EZC5`）打完 `10-2` 并双端点击 `#btn-modal-rematch` 重开新局 | 通过 | `hasTestHook: false`，Fast4 局分 `1-0` 双端一致；抢十 `10-2` 后 Rematch 比分归 `0-0`、暂停恢复 `[3, 3]`；0 console/page error、0 4xx/5xx | `docs/review/integration/evidence/round-1-tester/e2e01-p0-mirror.png`, `e2e01-p1-mirror.png`, `e2e01-pause-modal.png`, `e2e01-game-done.png`, `e2e01-rematch-started.png`, `e2e01-log.json` |
| **E2E-02** | `AC-07`, `AC-10` | 钩子 `?test=1` + `ENABLE_TEST_HOOKS=1` | 双端入房（`CGQ4`）开赛；分别调用 `triggerHawkeyeShot` 测 `8 cm` 边线球（界内）、`10 cm` 底线球（出界）与 `25 cm` 反例，核对双端时序、横幅、`bouncePos` 镜像及 `HAWKEYE_END` 后立即按 `KeyD` 位移 | 通过 | `8 cm` 持续 `1882 ms` 判 `IN`（`7.27 cm`），P0 `(4.0423, 0.0335, -7.5363)` / P1 `(-4.0423, 0.0335, 7.5363)`；`HAWKEYE_END` 后 `KeyD` 位移 P0 `-1.45 -> -0.6088`、P1 `-2.15 -> -0.3477`；`10 cm` 判 `OUT`（`7.17 cm`）；`25 cm` 未触发；0 报错 | `docs/review/integration/evidence/round-1-tester/e2e02-p0-hawkeye-in.png`, `e2e02-p1-hawkeye-in.png`, `e2e02-p0-hawkeye-out.png`, `e2e02-p1-hawkeye-out.png`, `e2e02-log.json` |
| **E2E-03** | `AC-11`, `AC-10` | 钩子 `?test=1` + `ENABLE_TEST_HOOKS=1` | ① 房 `LQRC` 打出 `15-0` 后 P1 跳 `about:blank` 约 4s 后返回 `?test=1` 自动 `RECONNECT` + `FULL_SYNC` + 3s 恢复后立即按 `W/A/S/D` + `K`；② 房 `TKCU` 测 `fastForwardPause(59.5)` 自动恢复及 3 次暂停后第 4 次 `PAUSE_LIMIT_REACHED`；③ 房 `RFZM` 测 P1 `simulateDisconnect(-1)` 实等超 15s 弃权结算 | 通过 | ① `15-0` 保留，`lastResetReason: "MATCH_RESUMED"`，P1 立即位移 `x: -2.15 -> -0.4212` 且 `KeyK` 绿条激活 `progress: 0.459`；② 第 4 次暂停 Toast「本场暂停次数（3次）已用尽」；③ 约 15.4s 后 P0 唯一弹出 `MATCH_OVER(forfeit)`，0 `ERROR` Toast；0 报错 | `docs/review/integration/evidence/round-1-tester/e2e03-p0-disconnect-15s.png`, `e2e03-p1-after-reconnect.png`, `e2e03-p0-forfeit-win.png`, `e2e03-log.json` |
| **E2E-04** | `AC-12`, `AC-15` | `/tennis/` 生产构建 + 本地反代（`4523->4524`，无 `ENABLE_TEST_HOOKS`） | 访问 `http://127.0.0.1:4523/tennis/?netdebug=1` 跑通单机开赛并返回大厅；双独立 Context 联机（`MX5Y`）建房/加入/READY/击球；核对非 `/tennis/` 404、WS 地址与 `.netdebug-panel` 全部指标 | 通过 | 非 `/tennis/` `/` 返回 `404`；`/tennis/health` `200`；双端 WS 连 `ws://127.0.0.1:4523/tennis/ws`；0 个 404，0 console/page error；`.netdebug-panel` 含实时 `RTT: 1ms`/`8ms` 等全部 10 项指标 | `docs/review/integration/evidence/round-1-tester/e2e04-subpath-netdebug-p0.png`, `e2e04-subpath-netdebug-p1.png`, `e2e04-log.json` |

## 3. 失败 / 异常详述（仅列失败与阻塞项）
无失败或阻塞项。

## 4. 客观体验观察（纯事实，非裁决）
- 在 `E2E-01` 超级抢十（`SUPER TB`）开赛画面（`e2e01-rematch-started.png`）中，左上角计分板下方横幅文案显示为 `TIEBREAK · 抢七局`（对应 `KEY_POINT_LABELS.TIEBREAK`）。
- 在无独立 GPU 的 headless SwiftShader WebGL 环境下（`E2E-04`），客户端实测帧率为 `5–8 FPS`（`Avg: 127.9–284.6ms`），`PerfManager` 触发画质降档至 `MEDIUM`/`LOW`（`ActiveDPR: 1.00`）；在该低帧率自动化发球时序下，`E2E-01` 正常入口脚本中由 P1 主动用 `W+K` 接发球挥拍未能于 3 次止损尝试内命中来球（`A`/`D`/`J`/`K`/`W+K` 按键路径本身在正常入口均已实操且无报错，`W` 与 `K` 组合逻辑及双端镜像已由 `E2E-01` 镜像截图及 `E2E-02`/`E2E-03` 实测数据交叉覆盖）。

## 5. 未测项与止损记录
- 按简报环境限制，未在真机 Mac Retina 2x、真 120Hz 物理屏及公网高丢包环境下测试；`E2E-01` 中 P1 正常入口 `W+K` 接发球实时挥拍命中的补充重试在尝试 3 次后按止损规则停止。
