# 独立评审报告 — Round 2（《糖果塔防对战》Candy TD Battle V1）

结论：PASS
候选版本：`v1-candy-td-battle @ 7c8a7aa1f42e258f0e8fc620295bda156c1b6e45`（`git rev-parse HEAD` 核对一致）
本轮核验方式：Round 2 全量 diff 代码审 + `npm test`（`12/12` 通过，908.1ms） + 已委派独立 Tester（`gemini-4-hydrogen-high`，报告路径 `docs/review/round-2-tester.md`）完成双独立 Edge CDP 会话（`1280×720`, `DPR=2`）全量 7 大场景实机验收 + Reviewer 亲自目视精选核查 11 张关键帧截图。

---

## 复测范围与理由

因 Round 2 修复触及公共联机状态机（`leave_room` 与 `COUNTDOWN` 重连）、双端 `slot → side` 特效渲染管线与偷看镜头保护，且 Round 1 触发 Fast-Fail 跳过了 Tester，本轮按 `references/evaluator.md` 第 6 步执行**全量回归**（代码全 diff 审计 + 自动化测试全套 + Tester 端到端全场景交互与性能取证）。Round 1 全部 5 项「必须」级缺陷与 2 项「建议」项均已验证根因修复完毕。

---

## 达标项

- **[AC-01] 纯正常入口单人 AI 全流程**：无 `?test=1` 正常入口启动 `casual` AI，走完真实 3s 倒计时，建草莓炮/薄荷冰、升级 Lv2、派软糖并实测 `tick=120` 精确触发 `eco_payout(+$30)`，偷看 AI 布局并回防，全程 `0` console error、`0` 外部 CDN 请求（`docs/review/round-2-tester.md` `T-01`、`docs/review/evidence/round-2/tester-t01-combat.png`）。
- **[AC-02] 双独立会话实时 PvP、邀请直达、退房移交与再来一局**：双独立 Edge BrowserContext 实测建房（4 位无易混字符房码 `N2N3`/`WS97`）→ `?room=` 自动预填加入 → 退房「返回大厅」立即清理旧房并移交 `hostSlot=1` → 真实 3s 倒计时开战 → P1/P2 互偷看布局同步且 P2（`slot=1`）战场渲染完全独立无串屏 → 结算与「再来一局」清零重置（`tick=5, towers=0, hp=20, gold=320`）（`T-02`、`T-07`、`tester-t02-pvp-p1.png`、`tester-t02-pvp-p2.png`、`tester-t07-result.png`、`tester-t07-rematch.png`）。
- **[AC-03] 无分屏主视野与 60px 防误触偷看（含 Round 1 反例回归）**：实测无左右分屏，`#peek-zone`（`x=1204..1276`）距棋盘右沿（`x=1144`）精确 `60px`；最右列 `(col=17, row=3)` 建塔不误触偷看；选中塔打开浮卡后悬停热区最右沿 `x=1275` 保持 `1.25s`（25 帧）浮卡持续隐藏不重弹、点击棋盘零建塔零扣费；划出右沿（`24ms`）、下沿（`26ms`）及松开 `Space`（`4ms`）均在 `≤300ms` 内稳定回防零卡死（`T-03`、`tester-t03-peek-protected.png`）。
- **[AC-04 / AC-05 / AC-06] 塔防机制、数值克制与 Eco 经济闭环**：`npm test`（`12/12` 全绿）及独立无头探针核实合法/非法格校验、Lv1→Lv3 升级与 70% 精确返还（`$207`）、薄荷 35%/55% 减速与 Lv3 `+15%` 易伤、爆米花溅射与硬甲 `0.6×`、柠檬 `104/189` 破甲及 Lv3 穿透、草莓 Lv3 每 4 发 `1.6×` 暴击、多层马卡龙半血破壳提速、`120 ticks` 精确发薪与低防卫赏金防互刷（`tests/sim-unit.test.js`、`T-01`）。
- **[AC-07] 3 秒快递预警防泄密、双车排队与假动作零串屏**：双端 WS 实测前 60 ticks 防守方报文含 `isFake`/`sendType` 字段数为 `0`；第 3 辆排队触发 `EXPRESS_QUEUE_FULL` 且不扣费；P2 顶部居中展示「共 2 辆排队」与入口双粉车；孤立假动作到点后五彩纸屑与「😜 空快递盒！骗到你啦~」气泡**仅出现在防守方 P2 入口**、进攻方 P1 自家画面完全干净，防守方 `0` 伤害、攻方 `+5 Eco` 及 `18s` 冷却（`T-04`、`tester-t04-p2-incoming.png`、`tester-t04-p2-feint.png`、`tester-t04-p1-clean.png`）。
- **[AC-08] 第 15 波 Boss 与第 16+ 波狂暴彩虹加时赛**：`jumpWave(15)` 正常刷出 `giant_cake`，`jumpWave(16)` 触发彩虹加时横幅与彩虹光环怪群，漏怪扣血并呈现城堡 `-X ❤️` 红字与粒子反馈（`T-05`、`tester-t05-wave16-overtime.png`、`tester-t04-p2-feint.png`）。
- **[AC-09] Retina 2x 性能底线与 `?netdebug=1` 稳态采样**：`1280×720`、`DPR=2` 下执行 `spawnStress({ towers: 15, creeps: 45 })`，无截图干扰连续 5 秒 10 组采样实测 `FPS = 56–60`（均值 `59.4 ≥ 55`）、`Render = 0.4–0.8 ms`（`≤ 8 ms`）、`DPR = 2`、峰值粒子 `138`（`≤ 220`）、外部 CDN 请求 `0`（`T-06`、`tester-t06-stress-netdebug.png`）。
- **[AC-10] 20 秒断线重连宽限与倒计时重连恢复**：双端实测 P2 真实 `Page.reload()`（F5）后 P1 即时进入 `PAUSED_RECONNECT`，P2 凭 `sessionStorage` 自动重连并无损恢复 `{ towers: 1, gold: 240, eco: 25 }`；`tests/ws-protocol.test.js` 覆盖 20s 超时判胜及 `COUNTDOWN` 断线重连正常重启仿真（`T-07`、`tests/ws-protocol.test.js`）。
- **[AC-11 / AC-12 / AC-13] 子路径反代、双门控测试钩子与协议异常边界**：`/candy-td/*` 静态与 WS 代理握手全通且拦截目录穿越；生产模式 `window.__CANDY_TEST__ === undefined` 且服务端拒收 `test_command`（`TEST_HOOKS_DISABLED`）；畸形 JSON、满房、越界/路径建塔、满级再升、冷却连点均平稳返回规范错误码（`tests/ws-protocol.test.js`、`T-01`）。
- **[AC-14] Web Audio 交互解锁、胜负单次音效与跨局静音保持**：`AudioContext.state === 'running'`，终局双方精确记录 1 次 `win` / 1 次 `lose`，右上角静音开关同步写入 `sessionStorage` 并在「再来一局」后持久保持 `🔇` 状态（`T-01`、`T-07`、`tester-t07-rematch.png`）。
- **[画面美观度与布局目视审查]**：亲自审查 11 张 Tester 关键帧截图，马卡龙淡彩草坪、香草焦糖路径、4 处甜品装饰、糖果高光质感与 Q 弹造型表现优秀；大厅弹窗、顶部 HUD、底部双区操作台、居中快递横幅、偷看紫框及结算卡片无任何文字重叠或按钮裁切。

---

## 轻微建议优化项（非阻断，可留待后续迭代）

- **Windows 定时器节拍微漂移**：Tester 在 Windows 实测 `setInterval(50)` 跑满 120 ticks 约耗时 `7.45s`（因 Windows 默认系统时钟粒度约 15.6ms，逻辑严格按 120 ticks 精确一致；若未来希望在 Windows 本地也严格贴近 6.00s 壁钟，可将 `RoomManager` 主循环升级为 `performance.now()` 固定步长累加器，Linux 云主机通常已为 1ms 粒度不受明显影响）。
- **再来一局倒计时期间顶部条隐藏**：点击「再来一局」进入 3 秒倒计时遮罩时，背景模糊层下方短暂可见上一局 `#top-bar` 数字，进入 `PLAYING` 后立即刷新归零，后续可顺手在 `COUNTDOWN` 阶段隐藏 `#top-bar` 使过渡更干净。

---

## 未验证项（环境限制 / 非交付门槛，已如实披露）

1. **物理 Mac Retina / Safari 真机**：当前验收机为 Windows 11，已通过 Edge Headless `deviceScaleFactor: 2`（`1280×720` 逻辑 / `2560×1440` 物理）完成 Retina 2x 性能与排版仿真验证，非真机 macOS/Safari 硬件。
2. **物理扬声器听感录音**：无头浏览器无物理扬声器发声采集，`AC-14` 已通过 `AudioContext.state === 'running'`、音频管理器合成触发事件日志与静音增益/持久化状态完整核查。
3. **真人情侣主观趣味与复玩率**：按 `SPEC 2.1` 属交付后成功指标，不作为本轮交付门禁。

---

给用户的摘要：《糖果塔防对战》V1 已通过 Round 2 全量代码审、12 项自动化测试与双独立浏览器实机验收，正式签发 **PASS**！Round 1 发现的 5 项联机特效串屏、偷看浮卡重弹、热区边缘卡死、退房/倒计时重连和胜负音效问题已全部从根因修净；实测双人实时联机、60px 防误触偷看、3 秒双快递零泄密与假动作开箱彩带、F5 断线重连及 Retina 2x 压测（56–60 FPS，渲染 < 1ms）均稳定流畅且画风清新可爱，无文字重叠或报错。唯一需告知的客观边界是本轮在 Windows Edge `DPR=2` 仿真环境完成，非物理 Mac 真机与实声外放测试，现已具备交付本地试玩条件。

Notion 一行摘要：PASS / Round 2 全量回归与双端 Edge CDP（DPR=2）7 大场景实测全通过（12/12 单测、0 报错、56–60 FPS，Round 1 5 项必修缺陷全部根因修复） / 交付用户本地试玩，待用户确认后再另行安排 GitHub 推送或云端部署。
