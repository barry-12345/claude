# Tester 实测证据报告 — V2 Round 1（WP2 `@court2k/client`）

## 1. 运行环境与版本核对
- **实际测试版本**：`feat/v2-wp2` @ `0a7bfd4e32afb745d589c8285a5906ff65970a15`（与简报一致：是）
- **运行环境**：Windows + Microsoft Edge（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，headless）+ `playwright-core ^1.51.1`；独立 `browser.newContext({ viewport: { width: 1280, height: 720 } })`
- **WebGL 与渲染模式**：`WebGL 2.0 (OpenGL ES 3.0 Chromium)`，`unmaskedRenderer` 为 `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`（**软件渲染**）；实测大厅 `10.9 FPS`、实战 `8–16.6 FPS`
- **本地服务与端口**：
  - `4511`：`npm run preview -w @court2k/client -- --host 127.0.0.1 --port 4511 --strictPort`（记录并已 `Stop-Process` 清理的 PID：`13916`, `19580`, `41696`, `22936`）
  - `4512`：临时 Node 静态 HTTP 服务挂载 `/tennis/` 指向临时构建目录（测完已关闭监听并删除临时目录）
- **实际调用模型与档位**：当前会话宿主未显式向模型暴露模型 ID / effort 字符串（以实际执行结果为准）

## 2. 用例执行总表
| 用例编号 | 对应 SPEC | 入口方式 | 执行步骤摘要 | 客观结果 | 关键数字 / 错误摘录 | 精选证据路径 |
| --- | --- | --- | --- | --- | --- | --- |
| T-01 | AC-01, AC-03, AC-04, AC-17 | 正常入口 `http://127.0.0.1:4511/`（无 `?test=1`） | 验证无测试钩子/调试面板；遍历 4 流派与 3 场地预览；纯键盘打完 1 局 Fast4；赛中 `Esc` 暂停/恢复后立即按 `WASD` | 通过 | `hasTestHook=false`，`netDebugVisible=false`；4 流派均含 `CTL` 无 `TIM`；局分 `0-1`（用时 `35.92s`）；恢复后移动像素变化 `true`；0 error / 0 404 | `docs/review/wp2/evidence/v2-round-1-tester/t01-lobby-power.png`, `t01-lobby-allcourt.png`, `t01-lobby-serve_volley.png`, `t01-lobby-defender.png`, `t01-rally.png`, `t01-pause.png`, `t01-game-finished.png` |
| T-02 | AC-02, AC-11 | 钩子 `?test=1&netdebug=1` | 分别进入 `hard`/`clay`/`grass` 实战查 `getState()` 与 `.netdebug-panel`；红土急跑急停截屏；统计 3 场地截图上空 35% 与全帧亮度 | 通过 | 3 场地均 `avatarLoaded=true`, `avatarSource='glb'`, `avatarTriangles=4640`, `drawCalls=78–81`；上空 35% 均亮度 `153.87 / 156.59 / 157.94`，全帧均亮度 `144.36 / 146.23 / 131.99`；0 error | `docs/review/wp2/evidence/v2-round-1-tester/t02-hard.png`, `t02-clay.png`, `t02-grass.png` |
| T-03 | AC-05, AC-06, AC-04 | 钩子 `?test=1`（硬地实战） | 注入来球验证不按键不挥拍；提前按 `J` / `K` 验证预选环与自动击球类型/落点；长按 `J` `0.30s` 入圈前松手验证取消 | 通过 | 不按键 0 次自动挥拍；`J` 琥珀环 `#f59e0b` 打出 `topspin` 落 `z=-9.928`；`K` 青环 `#06b6d4` 打出 `dropshot` 落 `z=-2.953`；长按 `0.30s` 松手 `armedAction='none'` 且不挥拍；0 error | `docs/review/wp2/evidence/v2-round-1-tester/t03-no-key-miss.png`, `t03-ring-j.png`, `t03-ring-k.png` |
| T-04 | AC-07 | 钩子 `?test=1`（`serve_ready` 态） | `serve_ready` 按 `L` 验证静默忽略；分别用 `A+J`、`D+J`、`A+K`、`D+K` 单按发球（抛球期松手验证不取消） | 通过 | `L` 保持 `serve_ready`；`A+J`/`D+J` 均 `serve_flat`（`197`/`195 km/h`，落点 `x=-3.903 / -0.220`）；`A+K`/`D+K` 均 `serve_kick`（`146`/`148 km/h`，落点 `x=-3.914 / -0.178`）；全进区；0 error | 见第 4 节实测记录 |
| T-05 | AC-08 | 钩子 `?test=1` | 依次调用 `triggerHawkeyeShot`：`8cm`（IN sideline）、`10cm`（OUT baseline）、`25cm`（IN sideline）；结束后立即按 `D/A` 查 `inputDiagnostics` | 通过 | `8cm` 判 `IN · 界内`（横幅 `7.3 cm`）；`10cm` 判 `OUT · 出界`（横幅 `7.2 cm`，`durationSec=1.8`）；`25cm` 未触发；`lastResetReason='HAWKEYE_END'`，立即移动 `movedX=+0.327m`；0 error | `docs/review/wp2/evidence/v2-round-1-tester/t05-hawkeye-in.png`, `t05-hawkeye-out.png` |
| T-06 | AC-09, AC-04, AC-15 | 钩子 `?test=1` | 选「超级抢十」验证横幅；赛中点击 `#btn-hud-mute` 切换开关；`setScore({ points:[9,6] })` 后完赛核对 6 项统计表 | 通过 | 横幅显示 `SUPER TIEBREAK · 超级抢十`；静音切换 `🔊 音效 ↔ 🔇 静音` 即时生效且 0 AudioContext 报错；`10-7` 完赛第 6 项为 `CLEAN 甜点率` 且 0 处 `Perfect`/`绿条`/`Takeover` | `docs/review/wp2/evidence/v2-round-1-tester/t06-super-tiebreak.png`, `t06-post-match.png` |
| T-07 | AC-14 | 钩子 `?test=1&netdebug=1` | 调用 `simulateRefreshRate(90/100/120/144)` 与 `simulatePerfSpike(30, 2600)` 观测指标 | 通过 | `90/100Hz` `fpsCapEnabled=false`；`120/144Hz` `fpsCapEnabled=true`；压测后 `HIGH -> MEDIUM -> LOW`，`activeDpr=1.00 <= 2.0`，`upgradeCount=0 <= 1`；0 error | `docs/review/wp2/evidence/v2-round-1-tester/t07-netdebug.png` |
| T-08 | AC-16 | 子路径 `/tennis/` 静态服务（`4512`） | `VITE_BASE_PATH=/tennis/` 构建至临时目录并在 `127.0.0.1:4512` 挂载 `/tennis/`，访问 `/tennis/?test=1` | 通过 | `/tennis/?test=1`、2 个 JS、1 个 CSS 及 `/tennis/assets/models/tennis_player.glb` 全部 HTTP `200`（0 个 `404`）；`avatarLoaded=true`, `avatarSource='glb'`, `avatarTriangles=4640`；0 error | 见第 4 节网络请求清单 |

## 3. 失败 / 异常详述
无失败或阻塞用例（全部 8 项均已完成客观验证，全程 0 console error、0 pageerror、0 HTTP 404）。

## 4. 关键实测数值明细与客观体验观察（纯事实，非裁决）

### T-01 大厅与赛中实测明细
- 4 流派五维核对：
  - `power`（底线重炮 / 运动头带）：`POW 94 / SPD 72 / SPN 82 / CTL 76 / NET 76`
  - `allcourt`（全能节奏 / 双护腕）：`POW 80 / SPD 80 / SPN 82 / CTL 86 / NET 72`
  - `serve_volley`（发球上网 / 运动遮阳帽）：`POW 84 / SPD 84 / SPN 74 / CTL 74 / NET 84`
  - `defender`（防守磨王 / 反戴鸭舌帽）：`POW 70 / SPD 94 / SPN 86 / CTL 82 / NET 68`
- 赛中 Fast4 得分序列（纯键盘 `WASD` + `J/K/L`）：`0-0 (0-0)` → `0-15` → `0-30` → `15-30` → `15-40` → `30-40` → `0-1 (0-0)`，总耗时 `35.92s`。
- `Esc` 暂停再按 `Esc` 恢复后立即按 `D` 键，前后整帧 PNG 字节由 `239051` 变为 `234280`（像素变化确认）。

### T-02 三场地亮度脚本实测值（`1280x720`，上空 35% 为前 `251` 行）
| 场地 | `avatarLoaded` / `source` / `triangles` | `drawCalls` | `qualityTier` / `activeDpr` | 上空 35% 均亮度 (Luma / RGB) | 全帧均亮度 (Luma / RGB) | `#09111f` 暗像素占比（上空 / 全帧） |
| --- | --- | --- | --- | --- | --- | --- |
| `hard` | `true` / `glb` / `4640` | `78` | `HIGH` / `1.00` | `153.87` / `157.80` | `144.36` / `144.95` | `1.76%` / `0.65%` |
| `clay` | `true` / `glb` / `4640` | `81` | `MEDIUM` / `1.00` | `156.59` / `152.94` | `146.23` / `140.66` | `0.22%` / `0.10%` |
| `grass` | `true` / `glb` / `4640` | `78` | `HIGH` / `1.00` | `157.94` / `159.46` | `131.99` / `125.35` | `2.20%` / `2.50%` |

- 红土实测现象：角色高速横移（`vel.x = -6.36 m/s`，`isSliding: false`）时，在 `t02-clay.png` 左下方角色脚后可见浅土黄色扬尘颗粒，同时 SwiftShader 帧率波动导致红土帧 `qualityTier` 处于 `MEDIUM`。

### T-04 发球实测记录
| 按键组合 | 抛球中阶段 (`~90ms`) | 球种 (`lastShotType`) | 显示球速 (`km/h`) | 物理初速 (`m/s`) | 首次落点 `(x, z)` | 进区 (`firstBounceInBounds`) |
| --- | --- | --- | --- | --- | --- | --- |
| `L`（单按） | 保持 `serve_ready` | — | — | — | — | — |
| `A+J` | `serve_toss` | `serve_flat` | `197` | `43.23` | `(-3.903, -5.771)` | `true` |
| `D+J` | `serve_toss` | `serve_flat` | `195` | `42.87` | `(-0.220, -5.752)` | `true` |
| `A+K` | `serve_ready`（已快速完成/入发） | `serve_kick` | `146` | `31.35` | `(-3.914, -5.157)` | `true` |
| `D+K` | `serve_toss` | `serve_kick` | `148` | `29.74` | `(-0.178, -5.148)` | `true` |

### T-05 鹰眼客观观察
- 注入 `distCm: 8`（`sideline`, `inBounds: true`）与 `distCm: 10`（`baseline`, `inBounds: false`）时，实际物理落点距线分别显示为 `7.3 cm` 与 `7.2 cm`；引擎内 `hawkeye.durationSec = 1.8`，但在 SwiftShader 低帧率（`~8–16 FPS`）下，现实墙钟持续时间分别约为 `6.26s`（含飞行至落点）与 `3.51s`。

### T-07 刷新率与降档实测表
| 操作 | `estHz` | `fpsCapEnabled` | `qualityTier` | `activeDpr` | `upgradeCount` |
| --- | --- | --- | --- | --- | --- |
| `simulateRefreshRate(90)` | `90` | `false` | `HIGH` | `1.00` | `0` |
| `simulateRefreshRate(100)` | `100` | `false` | `HIGH` | `1.00` | `0` |
| `simulateRefreshRate(120)` | `120` | `true` | `HIGH` | `1.00` | `0` |
| `simulateRefreshRate(144)` | `144` | `true` | `HIGH` | `1.00` | `0` |
| `simulatePerfSpike(30, 2600)` 后 `2.9s` | `144` | `true` | `MEDIUM` | `1.00` | `0` |
| 再等待 `5.0s` 后 | `144` | `true` | `LOW` | `1.00` | `0` |

### T-08 `/tennis/` 子路径请求状态清单
- `http://127.0.0.1:4512/tennis/?test=1` → `200`
- `http://127.0.0.1:4512/tennis/assets/index-C5HR3STt.css` → `200`
- `http://127.0.0.1:4512/tennis/assets/index-BJWW6m9X.js` → `200`
- `http://127.0.0.1:4512/tennis/assets/three-CNgVlC3k.js` → `200`
- `http://127.0.0.1:4512/tennis/assets/models/tennis_player.glb` → `200`

## 5. 未测项与止损记录
- 受本地 headless 环境限制，以下简报边界项未在本轮实测：真机 Mac Retina 2x 显示效果、真 120Hz/144Hz 物理屏硬件观感及双人 1v1 联机（联机留待 `integration/v2`）。
- 其余 T-01 至 T-08 全部 8 项必测用例均已完整执行，无止损跳过项。
