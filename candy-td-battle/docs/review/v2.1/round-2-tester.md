# Tester 实测证据报告 — Round 2（Candy TD Battle V2.1 · 单片）

## 1. 运行环境与版本核对
- **实际测试版本**：`v2.1-candy-td-battle` @ `d586e28b560e40b1205a96984d57f26a8f500c82`（与简报一致：是）
- **运行环境与隔离配置**：Windows 11 + Node v26.13.0 + Microsoft Edge Headless（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`），每次运行使用独立 `os.tmpdir()` 临时 `--user-data-dir`，视口 `1280×720`（T-01 为 `DPR=2`，T-02 / T-03 为 `DPR=1`）；端口：`4502–4503`（T-01）、`4504`（T-02）、`4505`（T-03）
- **实际调用模型与档位**：Tester（`Gemini 4 Hydrogen, High`）；复用 Builder 脚本：`是（T-01 直接执行 tests/v2.1-browser-verify.mjs；T-02/T-03 临时脚本置于 $env:TEMP 执行完毕后已删除）`

## 2. 用例执行总表
| 用例编号 | 对应 SPEC | 入口方式 | 执行步骤摘要 | 客观结果 | 关键数字 / 错误摘录 | 精选证据路径 |
| --- | --- | --- | --- | --- | --- | --- |
| T-01 | AC-01, AC-02, AC-04, AC-05, AC-08 | 复用脚本（`?test=1` 钩子 + 无 `?test=1` 生产入口） | 执行 `node tests/v2.1-browser-verify.mjs --port 4502 --out docs/review/v2.1/evidence/round-2/tester`，校验 AC-01/02/04/05/08 | 通过 | AC-01: 8/8 `sameNodeAfter125msHold: true` 且升级 Lv3；AC-02 (`DPR=2`): `avgFps=59.9`, `minFps=58`, `avgRenderMs=1.23ms`, `maxRenderMs=1.8ms`, `maxServerTickMs=0.41ms`, `avgWsKbps=496.5`, 3 连建塔延迟 `[105, 49, 67]ms`；AC-04: 断线弹 2 条提示 Toast 并自动重连恢复建塔；AC-05: `maxLasers=3`, `maxSplashRings=17`, `maxParticles=220`, `maxFloatTexts=18`；AC-08: `__CANDY_TEST__===undefined`, 升至 `草莓豆豆炮 Lv.3 · 🔥加特林` 并完成视角切换；0 console/page error | `docs/review/v2.1/evidence/round-2/tester/metrics.json`, `docs/review/v2.1/evidence/round-2/tester/ac01-lv2-branch-popover.png`, `docs/review/v2.1/evidence/round-2/tester/ac02-w20-stress-netdebug-dpr2.png`, `docs/review/v2.1/evidence/round-2/tester/ac04-offline-toast.png`, `docs/review/v2.1/evidence/round-2/tester/ac08-normal-entry.png` |
| T-02 | AC-01（多子区域与全浮卡稳定性反例） | 钩子 `?test=1`（`$env:TEMP\t02_verify.mjs`，端口 `4504`） | 20Hz 快照持续推送下，在 4 座 Lv2 草莓塔浮卡分别对 `#tp-branch-a-name`、`#tp-branch-a-cost`、`#tp-branch-b-desc`、`#tp-branch-b` 右下角内缩 4px `(774, 255.9)` 执行 125ms 慢点击；同局单次点击测试索敌切换（`血厚`）、Lv1→Lv2 升级、出售及障碍物 `(3,4)` 拆迁 | 通过 | 4/4 子区域 `sameNodeAfterHold: true` 且全部升级对应 Lv3 分支；索敌 `strong`、Lv1→Lv2 升级、出售、障碍物 `(3,4)` 拆迁均单次点击生效；0 console/page error | `docs/review/v2.1/evidence/round-2/tester/t02-subregions.png` |
| T-03 | AC-07 & 问题 1 回归反例（W20 切视角零空帧 + 高背压战败结算页） | 钩子 `?test=1&netdebug=1`（`$env:TEMP\t03_verify.mjs`，端口 `4505`） | 1) W20 双边重压（25 塔 80 怪 vs 14 塔 60 怪）下，`'self'` 视角渲染稳定后按 `Space` 切入 `'opponent'`，通过 CDP 抓包与 `#netdebug-panel` 检查零空帧与 550ms 刷新，再按 `Space` 回防并在 `(17,8)` 建塔；2) 注入服务端 WS `bufferedAmount=131072` 并令 P0 `hp=1` 漏怪战败，核对 `#result-overlay` | 通过 | 1) 切入对手视角 550ms 内收到 11 帧快照（含 10 帧完整对手快照），首帧完整对手怪 `55`（550ms 内最少 `50`、`distinctOppProgressSums=10` 持续刷新），截图可见对手 14 塔与怪群、无闪烁、`FPS: 60` / `Render: 1.30 ms`，回防 `(17,8)` 建塔成功；2) 高背压期间 `serverSkippedSnapshots=100`，战败后 `#result-overlay` 弹出、`#result-badge` 为 `🍬 惜败一局`、`#result-stats-grid` 渲染 2 张战绩卡片；0 console/page error | `docs/review/v2.1/evidence/round-2/tester/t03-w20-opp-view.png`, `docs/review/v2.1/evidence/round-2/tester/t03-backpressure-defeat.png` |

## 3. 失败 / 异常详述（仅列失败与阻塞项）
无

## 4. 客观体验观察（纯事实，非裁决）
- 在 T-01 的 `AC-08` 正常生产入口截图 `ac08-normal-entry.png` 中，页面将草莓塔升至 Lv3 后剩余金币 `$3`，随后脚本按热键 `2` 并点击 `(3,1)` 尝试建造 `$100` 薄荷塔，画面顶部如期弹出 `"金币不足"` Toast。
- 在 T-03 Part 1 中，与 T-02 并行启动刚进入 W20 重压窗口时，`selfViewFpsBefore` 采集为 `38`，切入对手视角后截图 `t03-w20-opp-view.png` 面板实测恢复为 `FPS: 60`、`Render: 1.30 ms`、`WS KB/s: 747.4`；在 T-01 单独运行的 `DPR=2` W20 重压采样中，20 次采样 `avgFps=59.9`（`minFps=58`）、`avgRenderMs=1.23 ms`。

## 5. 未测项与止损记录
无
