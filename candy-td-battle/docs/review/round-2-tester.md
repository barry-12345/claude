# Tester 实测证据报告 — Round 2（《糖果塔防对战》Candy TD Battle V1）

## 1. 运行环境与版本核对
- **实际测试版本**：`v1-candy-td-battle @ 7c8a7aa1f42e258f0e8fc620295bda156c1b6e45`（`git rev-parse HEAD` 核对一致：**是**）
- **运行环境**：Windows 11 + Microsoft Edge Headless（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）via Node `ws` CDP，视口 `1280×720`，`deviceScaleFactor: 2`，双人联机采用独立 `Target.createBrowserContext` 会话隔离；端口：正常生产模式 `4500`、测试钩子模式 `4501`、Edge CDP `4510` / `4511`（临时脚本与浏览器配置均置于系统 `$env:TEMP\candy-tester`，结束已按 PID 逐一清理）。
- **实际调用模型与档位**：按平台分配的 Tester 会话执行（工具输出未暴露外部模型版本号）。

## 2. 用例执行总表
| 用例编号 | 对应 SPEC | 入口方式 | 执行步骤摘要 | 客观结果 | 关键数字 / 错误摘录 | 精选证据路径 |
| --- | --- | --- | --- | --- | --- | --- |
| **T-01** | AC-01, AC-12, AC-14 | **正常入口** `http://127.0.0.1:4500/`（无 `?test=1`） | 核对钩子未挂载与 0 外链 -> 点「🌸 休闲甜心 AI」走真实 3s 倒计时 -> 建草莓炮/薄荷冰并升级草莓至 Lv.2 -> 派软糖×4(`$50,+5 Eco`)等 Eco 发薪 -> 偷看 AI 并回防 -> 切换静音开关核查 `sessionStorage` | 通过 | `typeof __CANDY_TEST__ === 'undefined'`；外链 `0`；0 console error / 0 exception；金币 `$320→$240→$130→$55→$5`，`tick=120` 实测 `eco_payout(+$30)` 后 `$42`（含击杀 `+$7`，实测耗时 `7453ms`）；`data-peeking` `1↔0`；静音 `1↔0` | `docs/review/evidence/round-2/tester-t01-lobby.png`, `docs/review/evidence/round-2/tester-t01-combat.png` |
| **T-02** | AC-02 + Round1 修复#1/#4 | **正常入口** 双独立上下文 `http://127.0.0.1:4500/` | Ctx-A 建房获码 `N2N3` -> Ctx-B `?room=N2N3` 自动预填并加入 -> 反例：Ctx-A 点「返回大厅」后核对 Ctx-B 变单人且房主移交 -> 重建 `WS97` 双人就绪 3s 倒计时开战 -> A 建草莓塔、B(P2) 建柠檬狙并互偷看 | 通过 | 房码 `N2N3` 合法无 `0/O/1/I`；退房后 Ctx-B 立即收 `room_state`（`players=1, hostSlot=1`, P1 显示「空位」）；A/B 0 console error；互偷看同步且 P2 战场正常无串屏 | `docs/review/evidence/round-2/tester-t02-pvp-p1.png`, `docs/review/evidence/round-2/tester-t02-pvp-p2.png` |
| **T-03** | AC-03 + Round1 修复#2/#3 | 测试入口 `http://127.0.0.1:4501/?test=1` | 量测 `#peek-zone` 与棋盘隔离带 -> 最右列 `(17,3)` 建塔 -> 反例 A：点塔开浮卡后悬停热区最右边缘 `(1275,350)` 保持 `1.25s`（25 帧轮询）期间点击 `(600,300)` -> 反例 B：划出右沿 `(1278,350)`、下沿 `(1240,560)` -> `Space` 按住/点图/松开 | 通过 | `#peek-zone` `left=1204, right=1276`，与 `1144` 间距 `60px`；`(17,3)` 建塔成功且 `data-peeking='0'`；偷看 `1.25s` 浮卡重弹=`false`、金币与塔数不变；右沿退出 `24ms`、下沿退出 `26ms`、`Space` 退出 `4ms`（均 `≤300ms`），0 error | `docs/review/evidence/round-2/tester-t03-peek-protected.png` |
| **T-04** | AC-07 + Round1 修复#1/#6 | 测试入口 双独立上下文 `http://127.0.0.1:4501/?test=1` | P1 授权 `$2000` 连发 `express_party`+`express_feint` -> 第 3 辆点 `express_boss` 核查拦截 -> 前 3s 检查 P2 WS 帧与横幅 -> 清队列后单发 `express_feint` 推进 `60` ticks（P1 不偷看）分别截 P2/P1 画面并核对 HP/Eco/冷却 | 通过 | 第 3 辆拦截 `EXPRESS_QUEUE_FULL` 且金币不变（`1695→1695`）；前 3s P2 WS 报文含 `isFake`/`sendType` 字段=`0`；P2 横幅显示 `共 2 辆排队` 与双粉车；孤立假动作到点 P2 HP `20→20`（0 伤）、P1 `+5 Eco`、冷却 `17.8s`；彩带与「骗到你啦~」气泡仅见于 P2 入口，P1 画面干净 | `docs/review/evidence/round-2/tester-t04-p2-incoming.png`, `docs/review/evidence/round-2/tester-t04-p2-feint.png`, `docs/review/evidence/round-2/tester-t04-p1-clean.png` |
| **T-05** | AC-08 + Round1 修复#6 | 测试入口 `http://127.0.0.1:4501/?test=1` | `jumpWave(15)` + `fastForwardTicks(40)` 核对蛋糕王 -> `jumpWave(16)` + `fastForwardTicks(35)` 核对加时横幅与彩虹怪 -> 放行漏怪核对扣血与城堡飘字 | 通过 | W15 生成 `giant_cake`；W16 弹出「🌈 糖果狂热加时赛！第 16 波彩虹大军来袭！」与彩虹光环怪；漏怪 HP `50→38`；P2 城堡同时在 T-04 截图可见 `-1 ❤️` 漏怪红字飘字 | `docs/review/evidence/round-2/tester-t05-wave16-overtime.png` |
| **T-06** | AC-09 | 测试入口 `http://127.0.0.1:4501/?test=1&netdebug=1` | `spawnStress({ towers: 15, creeps: 45 })` -> 预热 1s -> 连续 5s 每 500ms 读 `#netdebug-panel`（期间零截图） -> 采样后截图并核对外链/粒子上限 | 通过 | 10 组采样：`FPS=[60,58,56,60,60,60,60,60,60,60]`（最小 `56`，均值 `59.4`）；`Render=0.4–0.8 ms`；`DPR=2`；粒子峰值 `138`（`≤220`）；外部 CDN 请求 `0` | `docs/review/evidence/round-2/tester-t06-stress-netdebug.png` |
| **T-07** | AC-10, AC-02, AC-14 + Round1 修复#5 | 测试入口 双独立上下文 `http://127.0.0.1:4501/?test=1` | P2 建 1 塔后执行真实 `Page.reload()` -> 核对 P1 收到 `PAUSED_RECONNECT` 与 P2 自动重连恢复 -> P1 切换静音 -> 降 P2 HP 至 1 + W15 快进结算 -> 核对音频日志 -> 双方点「🔄 再来一局」待倒计时完进入新局 | 通过 | 重连前后 P2 状态无损 `{towers:1, gold:240, eco:25}`；P1 WS 帧先后记录 `PAUSED_RECONNECT` 与 `PLAYING`；P1/P2 `AudioContext.state==='running'`，分别精确触发 1 次 `win` / 1 次 `lose`；再来一局倒计时后双方 `tick=5, towers=0, hp=20, gold=320`，P1 静音 `candy_td_muted==='1'` 与界面 `🔇` 跨局保持 | `docs/review/evidence/round-2/tester-t07-result.png`, `docs/review/evidence/round-2/tester-t07-rematch.png` |

### 附：T-06 连续 5 秒 500ms 间隔 `#netdebug-panel` 采样表（无截图干扰期间）
| 采样序号 | FPS | Render (ms) | DPR | 怪 / 弹 / 粒 |
| --- | --- | --- | --- | --- |
| 1 | 60 | 0.4 | 2 | 36 / 5 / 138 |
| 2 | 58 | 0.4 | 2 | 36 / 5 / 90 |
| 3 | 56 | 0.5 | 2 | 34 / 6 / 58 |
| 4 | 60 | 0.4 | 2 | 33 / 2 / 82 |
| 5 | 60 | 0.8 | 2 | 31 / 3 / 47 |
| 6 | 60 | 0.8 | 2 | 31 / 4 / 11 |
| 7 | 60 | 0.5 | 2 | 30 / 1 / 92 |
| 8 | 60 | 0.4 | 2 | 27 / 0 / 78 |
| 9 | 60 | 0.5 | 2 | 27 / 1 / 10 |
| 10 | 60 | 0.4 | 2 | 28 / 5 / 52 |

## 3. 失败 / 异常详述
无（本轮 `T-01`–`T-07` 全部按预期观察通过，0 console error，0 未捕获异常）。

## 4. 客观体验观察（纯事实，非裁决）
- **Windows 环境下服务端 tick 节拍实测**：在 `T-01` 正常入口下，服务端仿真严格在第 `120` tick 触发首次 `eco_payout`（`+$30`），但受 Windows Node.js `setInterval(50)` 定时器粒度影响，从开局到 `tick=120` 的实测壁钟耗时为 `7453ms`（约 `7.45s`，慢于标称 `6.0s` 约 `24%`）。
- **再来一局倒计时期间 DOM 可见性**：在 `T-07` 点击「再来一局」进入 `COUNTDOWN`（3s 倒计时）时，`#lobby-overlay` 显示倒计时遮罩并正确隐藏 `#result-overlay`，同时上一局的 `#top-bar` 仍保持非 `.hidden` 状态位于半透明模糊遮罩下方，待倒计时结束进入 `PLAYING` 后刷新为 `hp=20 / $320`。
- **界面排版与双端隔离**：在 `1280×720`（`DPR=2`）下目视核查全套 12 张截图，大厅卡片、双区操作台、居中快递横幅、`?netdebug=1` 浮层、偷看横幅及终局结算弹窗均无裁切或文本重叠；PvP 双端各自视角粒子/激光/气泡均严格隔离于对应战场。

## 5. 未测项与止损记录
- **环境固有限制（未在物理设备实测，按简报如实披露）**：
  1. 本机为 Windows 环境，无真机 Mac Retina / Safari 硬件，本轮以 Microsoft Edge Headless 配合 `deviceScaleFactor: 2` 仿真验证 Retina 2x 分辨率与性能指标。
  2. 无物理扬声器录音设备，`AC-14` 通过浏览器 `AudioContext.state`（实测 `'running'`）、`window.__CANDY_TEST__.getAudioState().events` 及 `sessionStorage.getItem('candy_td_muted')` 核查，未对物理声波输出做录音验证。
  3. 真人情侣主观趣味性与复玩率属交付后线上指标，不在本轮测试范围内。
- **止损记录**：无因超时或卡死触发止损的用例。
