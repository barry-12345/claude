# Tester 实测证据报告 — Round 2（WP2 `@court2k/client`）

## 1. 运行环境与版本核对
- **实际测试版本**：`wp2/client @ ad467619debb9398fb64905bad64812548009579`（`git rev-parse HEAD` 核对，与简报一致：是）
- **运行环境**：Windows 11 / Microsoft Edge（`msedge.exe` headless via `playwright-core`）/ 独立无状态上下文 `1280×720` / WebGL 渲染器：`ANGLE (Intel, Intel(R) Arc(TM) 130T GPU (16GB) (0x00007D51) Direct3D11 vs_5_0 ps_5_0, D3D11)`（硬件加速，未回退 SwiftShader）；端口：`4511`（`npx vite preview --host 127.0.0.1 --port 4511 --strictPort` 生产预览，测试结束后已精准关闭启动 PID 并核实清理）
- **实际调用模型与档位**：当前会话分配模型（由协调员按 `tester-wp2` 启动，未篡改；严格遵守 `tester.md` 独立客观取证）

## 2. 用例执行总表
| 用例编号 | 对应 SPEC | 入口方式 | 执行步骤摘要 | 客观结果 | 关键数字 / 错误摘录 | 精选证据路径 |
| --- | --- | --- | --- | --- | --- | --- |
| **T-01** | `AC-01`、`AC-04`、`AC-16` | **正常入口**（`http://127.0.0.1:4511/`，无 `?test=1`） | 核对无测试钩子且 `.netdebug-panel` 隐藏；选「单人 → 硬地 → 全能节奏(`allcourt`) → Fast4 → 新手 AI」开赛；测 `WASD`/方向键无滚动；发球绿条截屏；`Esc` 暂停并恢复后立即 `KeyD`；实打 1 整局至 `1-0` | 通过 | `typeof __COURT2K_TEST__ === 'undefined'`；`.netdebug-panel.hidden` (`display: none`)；`scrollY === 0`；恢复后立即 `KeyD` 画面像素变化；真实推进 1 局至 `1 - 0`（发球方切换至 AI）；0 Console Error / 0 Page Error / 0 404 | `docs/review/wp2/evidence/round-2-tester/t01-lobby.png`, `t01-serve-meter.png`, `t01-pause.png`, `t01-game-done.png` |
| **T-02** | `AC-02`、`AC-03`、`AC-14` | **正常入口** | 大厅切换硬地/红土/草地与 4 流派检查 3D 造型（头饰/球衣/体型）与五维总分 400；入红土局 `A↔D` 急停转向观察滑步扬尘；点 `#btn-hud-mute` 切换静音并击球 | 通过 | 3 场地颜色与草皮条纹/红土质感可分，4 流派外观与五维总分（`94/72/82/76/76` 等，总和均 400）清晰；`#btn-hud-mute` 文本在 `🔊 音效` ↔ `🔇 静音` 正常切换；0 AudioContext Error / 0 音频 404 | `docs/review/wp2/evidence/round-2-tester/t02-clay-power.png`, `t02-grass-sv.png`, `t02-grass-defender.png`, `t02-clay-slide.png` |
| **T-03** | `AC-05`、`AC-06` | 钩子 `?test=1&netdebug=1` | 红土单人局按 `J` 测常态 `effectiveHalfWidth`；调用 `setTakeover(0, 100)` 后测金黄光环、HUD `激活中 (2分)` 与 Takeover 期 `effectiveHalfWidth`；打完 2 分核对逐分衰减与冷却 | 通过 | 常态半宽 `0.055924`，Takeover 半宽 `0.069905`，实测比值 **`1.25×`**；金黄黑边指针清晰；逐分快照：`2分 (1-0)` → `1分 (2-0)` → `0分 + takeoverCooldown: true / 冷却中 (2-1)`；0 Error | `docs/review/wp2/evidence/round-2-tester/t03-takeover-meter.png` |
| **T-04** | `AC-07` | 钩子 `?test=1&netdebug=1` | 依次调用 `triggerHawkeyeShot`：`8cm IN (sideline)`、`10cm OUT (baseline)` 并在结束瞬间按 `KeyD`、反例 `25cm IN (sideline)` | 通过 | `8cm` 触发 `1827 ms` 特写判 `IN · 界内 (7.3 cm)`；`10cm` 触发 `1817 ms` 特写判 `OUT · 出界 (7.2 cm)`，结束瞬间 `lastResetReason === 'HAWKEYE_END'`，立即 `KeyD` 300ms 位移 `1.45 → 2.682`（`+1.232`）；`25cm` 全程未进入 `hawkeye` 阶段 | `docs/review/wp2/evidence/round-2-tester/t04-hawkeye-in.png`, `t04-hawkeye-out.png` |
| **T-05** | `AC-08`（含 R2 超级抢十比分修复） | 钩子 `?test=1` | Fast4 下 `setScore([2,2],[3,3])` 与 `([3,3],[6,5])` 查关键分横幅；切「超级抢十」`setScore({ points:[10,9] })` 并发球制胜达 `11-9`，核对赛后弹窗与 6 项统计 | 通过 | 横幅依次显示 `DECIDING POINT · 金球决胜` 与 `MATCH POINT · 赛点`；超级抢十完赛弹窗显示 **`11 - 9`**（非 `1 - 0`），6 项数据（Ace `1/0`、双误 `0/0`、一发 `100%/0%`、制胜分 `1/0`、UE `0/0`、Perfect `100%/0%`）与 `stats` 完全一致，弹窗完整落于视口内 | `docs/review/wp2/evidence/round-2-tester/t05-keypoint.png`, `t05-super-tb-stats.png` |
| **T-06** | `AC-12`、`AC-13` | 钩子 `?test=1&netdebug=1` | 核对 `activeDpr`、`drawCalls` 与 `.netdebug-panel`；测 `simulateRefreshRate(90/100/120/144)`；执行两轮 `simulatePerfSpike(26, 2500)` + `simulatePerfSpike(10, 9000/10000)` | 通过 | 初始 `ActiveDPR=1.00`、`DrawCalls=97`、`FPS=59`、`Avg=1.8ms`、`Tier=HIGH`；`90/100Hz` `fpsCapEnabled=false`，`120/144Hz` `fpsCapEnabled=true`；降档/回升：`HIGH` → `MEDIUM (Up:0)` → `HIGH (Up:1)` → `MEDIUM (Up:1)` → 二次稳态仍 `MEDIUM (Up:1)`（不二次回升） | `docs/review/wp2/evidence/round-2-tester/tester-r2-results.json` |
| **T-07** | 代码审反例（R2 焦点保护 + 1v1 大厅） | **正常入口** | 切至「1v1 联机大厅」，点击 `#input-room-code` 输入 `AB`，触发 `window.dispatchEvent(new Event('focus'))`，检查焦点保持并继续输入 `CD`，巡检布局 | 通过 | `valAfterAB === 'AB'`；`document.activeElement.id === 'input-room-code'`；`valAfterCD === 'ABCD'`；`hasHorizontalOverflow === false`，按钮与输入框无重叠裁切；0 Error / 0 404 | `docs/review/wp2/evidence/round-2-tester/t07-online-lobby.png` |

## 3. 失败 / 异常详述（仅列失败与阻塞项）
无（全部 7 项用例实机运行结果均为“通过”，全流程 0 Console Error、0 Page Error、0 404）。

## 4. 客观体验观察（纯事实，非裁决）
- **性能与渲染**：本机 Edge 启用了 Intel Arc 130T D3D11 硬件 WebGL，在 `1280×720` 下对局 FPS 稳定 `59–60`，平均帧耗时 `1.2–1.8 ms`，DrawCalls 为 `97–105`（鹰眼特写期间 `40–54`），`ActiveDPR` 为 `1.00`。
- **绿条手感与视觉反馈**：按住 `KeyJ` 约 `535 ms` 释放稳定命中 `PERFECT`（如 `222 km/h`），过早释放（约 `300 ms`）会触发 `VERY_EARLY` 失误/双误；Takeover 激活时脚下金色光环、HUD `激活中 (2分)` 边框高亮及绿条金黄黑边指针均清晰可辨；红土场地急停转向时脚下可见扬尘粒子。
- **数据与输入细节**：`T-01` 真实输入序列包含 `WASD`、方向键、`KeyJ`、`KeyK`、`W+K`、`KeyL`、`Esc`；`T-06` 完整日志与 `T-01`~`T-07` 结构化断言数据均保存在 `docs/review/wp2/evidence/round-2-tester/tester-r2-results.json`。

## 5. 未测项与止损记录
- **环境限制未测项**：
  1. **真机 Mac Retina 2x 物理屏与真 120Hz/144Hz 刷新率**：当前 Windows 无头 Edge 视口 `ActiveDPR` 为 `1.00`，120Hz/144Hz 限帧分支通过 `?test=1` 钩子 `simulateRefreshRate` 验证，未在物理高刷/2x Retina 屏实屏核对；
  2. **真实双端 1v1 联机闭环**：依赖 WP3 联机服务端整合，本轮仅覆盖 1v1 大厅 UI 布局、房间码输入框焦点保护及客户端单端能力。
- **脚本修正与止损说明**：首次执行测试脚本时因自编选择器误写 `data-arch` 为 `all_rounder`/`power_baseliner`（实际 DOM 为 `allcourt`/`power`）及发球按住 `300 ms` 过早导致 `T-05` 连续双误，修正脚本选择器与 `535 ms` 绿区松手节奏后全部 7 项一次跑通，未发生应用白屏/卡死/崩溃止损。
