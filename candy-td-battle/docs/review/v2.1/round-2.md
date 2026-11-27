结论：PASS
候选版本：v2.1-candy-td-battle @ `d586e28b560e40b1205a96984d57f26a8f500c82`（基点 `46f605fd4ca03907d4e0ada2be5abaeeec10d54a`，基于 Round 1 `3c10efcea566090821b04ade98f2b9e983d28c84` 局部修复，工作区干净）
本轮核验方式：Round 2 增量 diff 审计（`3c10efc..d586e28`）+ 简洁度复核 + 全量 `npm test`（20/20）+ 独立委派 Tester（`gemini-4-hydrogen-high`，独立端口 `4502–4505` 与独立临时 Edge Profile，报告 `docs/review/v2.1/round-2-tester.md`）全量浏览器交互实操与反例取证 + Reviewer 亲自核验 5 张关键截图。

---

## Round 1 返工项闭环核验（复测范围：全量回归 + 返工定点实操）

因 Round 1 触发 Fast-Fail 跳过了 Tester，本轮按「改动影响面 + 全量浏览器验收」执行完整复验：
1. **【问题 1（必须）已闭环】高背压终局 `ENDED` 快照送达与结算页渲染**：
   - 代码审计确认 `server/room-manager.js:171,362` 严格限定仅 `isPeriodic && room.phase === 'PLAYING'` 才触发 `bufferedAmount > 65536` 背压跳帧；`public/js/ui.js:1146-1151` 封装幂等 `renderEndedResult(res)`；`public/js/main.js:364` 在 `match_ended` 事件中同步兜底调用 `ui.renderEndedResult(ev.endedResult)`。
   - 协议回归（`tests/ws-protocol.test.js`）与浏览器实操（Tester `T-03`，128KB 背压且累计 `serverSkippedSnapshots=100` 下触发 P0 战败）双重证实：结算弹窗正确显示「🍬 惜败一局 / 糖果城堡被攻破啦！」及双方完整战绩卡片（证据：`docs/review/v2.1/evidence/round-2/tester/t03-backpressure-defeat.png`）。
2. **【问题 2（建议）已闭环】自动重连二次守卫与 `finally` 复位**：
   - `public/js/main.js:89-115` 在 `await net.connect({ timeoutMs: 3500 })` 返回后先校验 `canAutoReconnect()` 再读最新 `net.session` 发送 `join_room`，并用 `try / catch / finally` 释放 `reconnectInFlight`，杜绝回大厅/终局后的幽灵重连与状态卡死。
3. **【问题 3（建议）已闭环】切对手视角同步重置浮卡脏检查缓存**：
   - `public/js/ui.js:619-628` 在 `setViewMode('opponent')` 时同步调用 `this._resetPopoverCache()` 并重置 `this._obsState`，消除缓存与可见态隐式耦合。
4. **结构简洁度（YAGNI）复核**：Round 2 仅改动 4 个文件（3 个源码文件净增不足 25 行 + 1 个协议回归断言），零新增依赖，架构简洁清晰。

---

## 达标项

- **[AC-01]** Lv3 双分支按钮全区域稳定可点与浮卡零 DOM 重建：4 塔 × A/B 共 8 个分支对 `.bc-desc` 中心执行 125ms 慢点击 **8/8** `sameNodeAfter125msHold: true` 且 100% 升级 Lv3；独立反例 `T-02` 在 20Hz 快照下对 `#tp-branch-a-name`（图标/标题）、`#tp-branch-a-cost`（价格）、`#tp-branch-b-desc`（描述）及 `#tp-branch-b` 右下边缘内缩 4px 执行 125ms 慢点击 **4/4** `sameNodeAfterHold: true` 且 100% 升级，同时索敌切换（`血厚`）、Lv1→Lv2 升级、出售与障碍拆迁均单次点击生效（证据：`docs/review/v2.1/round-2-tester.md`、`docs/review/v2.1/evidence/round-2/tester/metrics.json`、`docs/review/v2.1/evidence/round-2/tester/t02-subregions.png`）。
- **[AC-02]** `DPR=2`（`1280×720`）W20 双边重压帧率与高压连建：己方 25 座 Lv3 分支塔 + 80 怪 vs 对手 14 塔 + 60 怪采样 5s 实测 `avgFps=59.9`（`minFps=58 ≥ 55`）、`avgRenderMs=1.23ms`（`max=1.80ms ≤ 8ms`）、`maxServerTickMs=0.41ms`（`≤ 8ms`）；高压交火期间连续点击 3 处空地建塔 **3/3 成功**（延迟 `[105, 49, 67]ms`）；`?netdebug=1` 正常展示 `WS KB/s` 与 `SkipSnap`；0 Console/Page 报错（证据：`docs/review/v2.1/evidence/round-2/tester/metrics.json`、`docs/review/v2.1/evidence/round-2/tester/ac02-w20-stress-netdebug-dpr2.png`）。
- **[AC-03]** 传输层带宽降幅与 64KB 背压保护：W20 1s 真实压缩下行线速从 V2 基线 `966,928 B` 降至 `41,220 B`（**降幅 95.7% ≥ 60%**）；非 `%10` 周期帧 `opponentLite` 与事件按视角过滤/去重/24 条上限全部生效；注入 `bufferedAmount = 131,072 B`（128KB > 64KB）后跳过冗余周期快照（`skippedSnapshots ≥ 3`），期间 `place_tower` 仍在 `≤ 300ms` 内回包建塔，且高背压下终局 `ENDED` 快照与战败结算页 100% 送达（证据：`npm test` `tests/ws-protocol.test.js`、`docs/review/v2.1/evidence/round-2/tester/t03-backpressure-defeat.png`）。
- **[AC-04]** 断线非静默提示与指数退避自动重连：离线 `NetClient.send()` 返回 `false`；浏览器端 WS 意外中断期间点击绿框空地立即弹出清晰提示 Toast（`网络连接已断开，正在尝试自动重连...` 与 `连接已断开，正在自动重连，请稍候再试...`，带节流防刷屏）；恢复连接后按退避自动重连恢复 `PLAYING` 并成功建塔（证据：`tests/ws-protocol.test.js`、`docs/review/v2.1/evidence/round-2/tester/ac04-offline-toast.png`、`docs/review/v2.1/evidence/round-2/tester/metrics.json`）。
- **[AC-05]** 前端特效池硬上限与高频音效节流：W20 高压 5s 采样实测 `maxLasers=3`（`≤ 32`）、`maxSplashRings=17`（`≤ 40`）、`maxParticles=220`（`≤ 220`）、`maxFloatTexts=18`（`≤ 60`）；6 类高频战斗音效（`pop/frost/boom/laser/shield_hit/heal_pulse`）65ms 冷却内 10 连发节流至 1 次、80ms 后恢复，0 未捕获异常（证据：`docs/review/v2.1/evidence/round-2/tester/metrics.json`、`tests/ws-protocol.test.js`）。
- **[AC-06]** 后端仿真热路径提速与 V2 零回归：`npm test` 全量 `20/20` 通过，V2 全部数值与 8 图 AI 断言零回归；双边 25 Lv3 塔 + 80 怪连跑 200 ticks 实测 `avg=0.081ms`（`≤ 4ms`）、`p95=0.240ms`（`≤ 8ms`）（证据：`npm test` 本地实跑输出）。
- **[AC-07]** 视角切换零空帧与协议全量回归：协议单测验证 `set_view_mode: 'opponent'` 立即回推全量对手状态并维持 20Hz 同步、切回 `'self'` 恢复 `opponentLite: true`，且反代、gzip、`Content-Length`、双门控 `?test=1`、20s 重连宽限全部通过；浏览器 `T-03` 在 W20 双边重压下按 `Space` 切对手视角 550ms 内捕获 10 帧完整对手快照（首帧对手怪 55 只、`distinctOppProgressSums=10` 持续刷新，无空帧无闪烁、`FPS: 60` / `Render: 1.30 ms`），回防后立即成功建塔（证据：`tests/ws-protocol.test.js`、`docs/review/v2.1/round-2-tester.md`、`docs/review/v2.1/evidence/round-2/tester/t03-w20-opp-view.png`）。
- **[AC-08]** 正常生产入口（无 `?test=1`、`allowTestHooks: false`）端到端通玩：`window.__CANDY_TEST__ === undefined`，正常选图开单人 AI → 建草莓 → 升 Lv2 → 125ms 慢点击分支 A 转职 `草莓豆豆炮 Lv.3 · 🔥加特林` → `Space` 切换对手视角看 AI → `Space` 回防操作，全程 0 Console/Page 报错，视觉布局与文字清晰无遮挡（证据：`docs/review/v2.1/evidence/round-2/tester/ac08-normal-entry.png`、`docs/review/v2.1/evidence/round-2/tester/metrics.json`）。

---

## 返工项

无（Round 1 全部 1 项必须与 2 项建议均已闭环修复并验证）。

---

## 未验证项（非交付门槛 / 环境限制）

- **真实公网 3–5 Mbps 云主机实战链路**：本机环回环境通过 `perMessageDeflate` 真实 TCP 线速对比（`-95.7%`）与 `bufferedAmount = 128KB > 64KB` 背压仿真替代，公网实玩留待上线部署后抽检。
- **Mac 真机 Retina 体感**：本机为 Windows 11 + Edge Headless，已通过 CDP `deviceScaleFactor: 2`（`1280×720`）仿真验证 `DPR=2` 渲染性能。
- **物理扬声器听音**：无头环境未接物理扬声器，已通过 `CandyAudio.eventLog` 与 65ms 节流单测覆盖验证。

---

给用户的摘要：《糖果塔防对战》V2.1 已通过 Round 2 全量验收（`PASS`）。Round 1 发现的高背压下终局结算页错显缺陷及 2 项重连/浮卡缓存建议均已修复并补齐回归测试；独立浏览器实操验证 Lv3 双分支按钮各个子区域（图标、名称、价格、描述及边缘）在 20Hz 快照下 125ms 慢点击 100% 稳定触发，`DPR=2` W20 双边重压稳定 `59.9 FPS`、`1.23 ms` 渲染耗时，压缩后下行带宽降低 `95.7%`，断线提示、自动重连、视角切换与无钩子生产入口全链路零报错。本地分支 `v2.1-candy-td-battle` 已就绪，尚未推送远端或部署线上。

Obsidian 一行摘要：PASS（Round 2） / 高背压终局快照缺陷与 2 项建议均已闭环，20/20 单测与独立 Tester 全量浏览器实操（AC-01~08 含多子区域慢点、DPR=2 W20 59.9FPS、-95.7% 带宽、128KB 背压战败结算页）全绿 / 允许交付本地分支 `v2.1-candy-td-battle @ d586e28`，待用户批准后再决定是否推送与云端部署
