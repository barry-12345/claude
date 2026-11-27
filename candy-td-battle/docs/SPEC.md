---
title: "糖果塔防对战 V2.1 规格与版本记录"
type: "document"
category: "Plan"
description: "《糖果塔防对战》（Candy TD Battle）V2.1 正式规格说明书与版本记录（SSOT 主本）：修复 Lv3 双分支升级按钮点击失效、治理云端部署 W20+ 卡顿与建塔无反应问题。"
created: 2026-11-27
updated: 2026-11-27
tags: ["game", "candy-td-battle", "spec", "v2.1"]
---

# 《糖果塔防对战》（Candy TD Battle）V2.1 正式规格说明书（SPEC）

> **SSOT 主本**：Obsidian（本页 `99_System/Data/Documents/糖果塔防对战 V2.1 规格与版本记录.md`） | **仓库执行副本**：`G:\我的云端硬盘\游戏\candy-td-battle\docs\SPEC.md`（同步日期 `2026-11-27`） | **状态**：已获用户批准 SPEC（`2026-11-27`） | **版本**：`V2.1` | **已确认决策**：开启 WebSocket `perMessageDeflate: { threshold: 1024 }` | **任务分档**：中任务（单 Builder 顺序修复 + 独立 Reviewer/Tester 验收）
>
> **批准范围**：V2.1 全量本地代码修复、单测/协议集成测、浏览器交互验收与本地 Git 规范提交（**不含**远端 `git push` 及云端生产服务器部署）。
> **前序基线**：[[糖果塔防对战 V2 规格与版本记录]]（V2 `PASS` @ `4d2cc39`，仓库存档 `docs/SPEC-v2.md`）

---

## 1. 定位、交付形式与技术选型（简洁优先 / YAGNI）

- **目标**：在不改动 V2 核心玩法、数值与美术的前提下，根治两项线上实测暴露的体验缺陷：
  1. Lv2 → Lv3 双分支升级按钮仅局部可点（主因：`updateSnapshot` 20Hz 周期内无条件覆写 `btnA/btnB.innerHTML`，点击期间销毁子 `<span>` 导致浏览器取消 `click`）；
  2. 云端部署单人 AI 对局打到 W20+ 后卡顿、地图有红绿预览框但点格子建塔无反应（主因：20Hz 全量未压缩双边快照 + 无节流事件洪峰打满云主机带宽且无 `ws.bufferedAmount` 背压控制；客户端单次重连失败后离线静默丢指令；前端无上限特效数组 + 20Hz 全量 DOM 刷写 + 高频音频节点；后端弹道 $O(P \times C)$ 线性查找）。
- **技术选型**：严格沿用 V2 零构建架构（Node.js `http` + `ws` + 原生 Canvas 2D + Web Audio），**零新增第三方依赖**，仅做高杠杆定向优化，不引入二进制协议或重型渲染框架。
- **范围边界**：
  - **In Scope**：Lv3 分支浮卡 DOM 稳定性修复；WS 快照按视角瘦身 + 压缩 + 事件去重与背压保护；客户端退避重连与离线操作显性提示；Canvas 特效上限与渲染热路径优化；UI 脏检查；音效节流；仿真 $O(P+C)$ 与平方距离优化；配套单测/协议测/浏览器实操验收。
  - **Out of Scope**：玩法数值/波次平衡调整、新塔新怪、远端 `git push` 或云端生产服务器部署（需另行批准）。

---

## 2. 需求清单（五件套）

| 编号 | 需求主题 | 用户是谁 | 时机与操作 | 看到什么 | 验收标准（本轮交付门槛） | 成功指标（交付后效果验证） |
| --- | --- | --- | --- | --- | --- | --- |
| **R-01** | **Lv3 双分支按钮全区域稳定可点** | PC 桌面玩家 | 选中任意 Lv2 塔后，点击分支 A / B 按钮任意区域（图标、名称、价格、描述文字及边缘），正常按住 80–150ms 后松开 | 点击任意位置一次即完成转职，金币扣除、塔升级为对应 Lv3 分支并刷新浮卡，不丢点击 | 4 种塔 A/B 分支在 20Hz 快照持续推送下，点击文字中心（`mousedown`→保持 `120ms`→`mouseup`）100% 触发升级；浮卡节点不发生无意义重建 | 玩家在云端实战升级 Lv3 时零误点/无响应反馈（真人试玩，非门禁） |
| **R-02** | **云端 W20+ 低带宽高响应传输** | 云端部署玩家（单人 AI / PvP） | 对局进入 W20+ 双方高密度塔/怪/弹道交火时，点击地图空地建塔、升级或切视角 | 画面不因网络排队冻结，点绿框空地立即建塔（或点红框即时弹错误 Toast），切对手视角立即看到对手实时战况 | 1) W20 压测单连接快照+事件下行字节率较 V2 基线下降 **≥ 60%**；2) 模拟慢连接 `bufferedAmount > 64KB` 时自动跳过冗余周期快照且 `place_tower` 仍在 ≤ 300ms 内完成权威反馈；3) 断线后客户端按退避持续重试重连，离线点建塔必弹清晰提示不静默 | 3–5 Mbps 云主机实战打到 W20+ 建塔手感与前期一致（云端实玩，非门禁） |
| **R-03** | **前端 W20+ 渲染/DOM/音效稳定帧率** | PC 桌面玩家（含 2x Retina 屏） | W20+ 高压交火（大量怪、Lv3 分支塔、岩浆池、弹跳弹道）持续运行并连续建塔 | 画面顺滑、操作跟手、音效清脆不爆音、控制台 0 报错 | `DPR=2` 下 25 塔 + 80 怪压测 `FPS ≥ 55`、`Render ≤ 8ms`；`lasers ≤ 32`、`splashRings ≤ 40`、`particles ≤ 220`、`floatTexts ≤ 60`；UI DOM 脏检查生效；音频同类音效节流 | 长时间 W20+ 游玩风扇/掉帧体感明显改善（真机观察，非门禁） |
| **R-04** | **后端仿真热路径提速与 V2 零回归** | 服务端权威仿真 | 高压波次（双方大量塔/怪/弹道）每 50ms 执行 `step()` | 服务端 tick 耗时稳定远低于 50ms 预算，所有 V2 玩法/协议完全兼容 | 高压 `ServerTick ≤ 8ms`；V2 既有 `sim-unit.test.js` 与 `ws-protocol.test.js` 全量断言 100% 零回归 | 云端多房间并发 CPU 占用稳定（上线观察，非门禁） |

---

## 3. 关键机制与精确修复设计

### 3.1 修复 Bug 1：Lv3 分支浮卡零 DOM 重建（`public/js/ui.js`）
- 在 `CandyUI` 缓存全部高频 HUD/浮卡 DOM 引用，避免每 50ms 反复 `getElementById`。
- 拆分 `_renderTowerPopover(tower)` 为**结构更新**与**状态更新**：
  - 记录上次渲染的 `popoverKey = ${tower.id}:${tower.type}:${tower.level}:${tower.branch || ''}`；仅当 `popoverKey` 变化时才写入分支按钮文案/结构（或使用固定静态子 `<span>` 只更新 `textContent`），**彻底禁止 20Hz 快照下对 `#tp-branch-a` / `#tp-branch-b` 执行 `innerHTML = ...`**。
  - 每帧仅做轻量脏检查更新 `disabled`（金币变化）、`tp-sell`（`invested` 变化）、`tgt-btn.active`（索敌变化）与位置坐标。
- 为 `updateSnapshot(snap)` 增加状态缓存（`hp/gold/eco/wave/nextSec/alerts/cooldowns`），仅在值实际变化时写入 DOM。

### 3.2 修复 Bug 2：四层全链路性能与云端建塔响应保障

1. **传输层瘦身与背压保护（`server/index.js`, `server/room-manager.js`, `public/js/net-client.js`, `public/js/main.js`）**
   - **WS 压缩**：`WebSocketServer` 开启 `perMessageDeflate: { threshold: 1024 }`（仅对 >1KB 的快照帧压缩，小包指令零开销，兼容反代）。
   - **视角感知对手快照降频**：新增轻量客户端消息 `{ type: 'set_view_mode', mode: 'self' | 'opponent' }`（服务端记录 `player.viewMode`，默认 `'self'`）。处于 `'self'` 视角且为常规周期帧（非 `tick % 10 === 0` 且非行动即时回包）时，跳过序列化 `opponent.creeps` / `opponent.projectiles` / `opponent.lavaZones` 并标记 `opponentLite: true`（保留 `hp/gold/eco/towers/clearedObstacles/incomingAlerts`）；客户端 `renderer.pushSnapshot` 收到 `opponentLite: true` 时保留上一帧对手动态实体，切入对手视角时服务端立刻下发全量 20Hz 快照（零白屏/零空帧，且对现有 `ws-protocol.test.js` 100% 兼容）。
   - **事件过滤与去重**：
     - 战斗视觉/音效事件（`tower_shot`、`mint_splash`、`popcorn_boom`、`shield_hit`、`shield_break`、`creep_pop`、`frost_nova`、`brittle_shatter`、`healer_pulse`、`execute_hit`、`macaron_cracked`）仅向正在观看对应战场的玩家发送；
     - 同 tick 同玩家内，非柠檬塔的 `tower_shot`（客户端仅用于每批次播放一次音效）按 `towerType` 去重为最多 1 条；
     - 单 tick 非关键战斗事件硬上限 `24` 条（关键事件 `match_ended`、`wave_started`、`express_*`、`life_lost`、`eco_payout`、`tower_built/upgraded/sold`、`obstacle_demolished` 永不丢弃）。
   - **背压保护（核心防卡死）**：`RoomManager._broadcastSnapshot` 周期广播前检查 `ws.bufferedAmount > 65536`（64 KB）；超限时跳过本 tick 周期快照与非关键战斗事件（并计入 `skippedSnapshots` 供 `?netdebug=1` 展示），**绝不跳过** `room_state`、`action_error`、`test_command_result`、`match_ended` 及 `_handleGameplayAction` 的玩家操作回包。
   - **客户端退避重连与非静默建塔反馈**：
     - `main.js` 将单次 600ms 重连升级为指数退避重连循环（`600ms → 1200ms → 2400ms → 4000ms`，覆盖 20s 宽限期，重连成功或返回大厅自动停止）；
     - `onPlaceTower` / `onUpgradeTower` / `onDemolishObstacle` / `onSendWave` 检查 `net.send()` 返回值，若连接未就绪立即弹 Toast 提示（带 1.5s 防刷屏节流），并立即触发重连尝试，彻底消除“有绿框但点完毫无反应”的黑盒现象。

2. **前端渲染与音效优化（`public/js/renderer.js`, `public/js/audio.js`）**
   - `lasers` 上限 `32`、`splashRings` 上限 `40`（超限淘汰最旧）；
   - `pushSnapshot` 时一次性构建 `selfClearedSet` / `oppClearedSet` 缓存，复用单一 `this._prevCreepMap`（清零重用而非每帧 `new Map()`）；
   - 护盾层数角标预烘焙或使用纯数字文本替代每帧 Emoji `🛡` 光栅化；移除飘字每帧昂贵的 `ctx.strokeText`（改用清晰高对比底色胶囊或轻量投影）并简化弹道循环内的 `ctx.save/restore`；
   - `CandyAudio.play()` 对高频战斗音效（`pop/frost/boom/laser/shield_hit/heal_pulse`）增加 `65ms` 同类冷却节流，控制并发振荡器数量。

3. **后端仿真热路径优化（`server/simulation.js`）**
   - `_stepProjectiles` 每 tick 构建 `creepById` Map（$O(1)$ 查找替代 $O(P \times C)$ `.find()`）；
   - `_acquireTarget`、`_resolveProjectileHit`、`lavaZones`、`healer_pulse`、`brittleMark`、`Strawberry-B` 分裂统一改用平方距离 `dx*dx + dy*dy <= r*r` 替代 `Math.hypot`；
   - 保持全部伤害、护盾、易伤、破甲、减速与随机序列 100% 数值等价。

---

## 4. 可测试验收表（`AC-01` ~ `AC-08`）

| 编号 | 风险 | 初始条件 | 操作步骤 | 预期结果 | 所需证据 | 推荐验证方式 | 缺条件处理 |
| --- | :---: | --- | --- | --- | --- | --- | --- |
| **AC-01** | 高 | `?test=1` 对局，选中 Lv2 塔，20Hz 快照持续运行 | 在 4 种塔的 Lv2 浮卡上，分别对 `#tp-branch-a` / `#tp-branch-b` **内部文字中心**执行真实慢速点击（`mousedown` → 保持 `120ms` 跨越 ≥2 次快照 → `mouseup`） | 每次均 100% 触发 Lv3 分支升级，金币扣除且塔升级生效；快照到达期间按钮子节点引用不被重建 | 浏览器自动化测试日志 + Lv2 浮卡与升级后 Lv3 截图 | **Tester 交互实操** + **Reviewer 代码审** | 无缺条件 |
| **AC-02** | 高 | `?netdebug=1&test=1`（`1280×720`, `DPR=2`），W20 压测 | 跳至 W20 并双边高压生成（己方 25 座 Lv3 分支塔 + 80 怪、对手 14 塔 + 60 怪），持续运行 5s 并在高压交火期间连续点击 3 个空地建塔 | `FPS ≥ 55`、`Render ≤ 8ms`、`ServerTick ≤ 8ms`；3 次建塔均立即成功且有明确反馈；Console 0 报错 | `?netdebug=1` 截图 + 性能与建塔延迟日志 | **Tester 交互实操** | 非 Mac 真机以 Chromium `deviceScaleFactor: 2` 仿真并注明 |
| **AC-03** | 高 | 协议自动化测试（含慢连接模拟） | 1) 统计 W20 双边高压下每秒下行字节量（`self` 视角 vs 全量基线）；2) 注入模拟 `bufferedAmount = 128KB` 后推进 10 ticks 并发送 `place_tower` | 1) 下行带宽较基线降低 ≥60% 且 `opponentLite` 生效；2) 高背压下周期快照被跳过但 `place_tower` 仍立即回传新快照成功建塔 | `ws-protocol.test.js` 带宽统计与背压用例全绿 | **脚本自动测** | 云端真实公网链路以本地背压仿真验证，公网实测留交付后抽检 |
| **AC-04** | 高 | AI 模式 `PLAYING` 态 | 1) 模拟 WS 意外断开，断线期间点击地图绿框空地建塔；2) 恢复连接后等待自动退避重连并再次建塔 | 1) 断线点建塔立即弹清晰 Toast 提示（非静默）；2) 客户端自动退避重连恢复局内状态且恢复后可正常建塔 | 协议单测 + 浏览器断线/重连实操日志与截图 | **脚本自动测** + **Tester 交互实操** | 无缺条件 |
| **AC-05** | 中 | W20 高压战斗场景 | 采样 5s 内 `renderer.lasers.length`、`splashRings.length`、粒子/飘字池、`CandyAudio` 事件节流记录 | `lasers ≤ 32`、`splashRings ≤ 40`、`particles ≤ 220`、`floatTexts ≤ 60`；高频战斗音效按冷却节流，无未捕获异常 | 压测采样 JSON + 单元测试 | **脚本自动测** + **Tester 交互实操** | 无缺条件 |
| **AC-06** | 高 | 无头仿真单测 + W20 基准脚本 | 跑全量 `tests/sim-unit.test.js` + 双边 25 塔 80 怪连跑 200 ticks 计时 | 全部 V2 数值与 8 图 AI 断言 100% 通过；平均单 tick `≤ 4ms`、P95 `≤ 8ms` | `npm test` 输出 + 仿真压测耗时日志 | **脚本自动测** | 无缺条件 |
| **AC-07** | 高 | WS 协议与视角交互回归 | 1) 验证 `set_view_mode` 切换至 `'opponent'` 立即推送完整对手状态且 20Hz 同步，切回 `'self'` 恢复轻量；2) 全量跑 `tests/ws-protocol.test.js`（含反代、gzip、`Content-Length`、双门控 `?test=1`、20s 重连） | 全部测试 100% 通过，视角切换无空帧/闪烁 | `npm test` 全绿 + 视角切换实操验证 | **脚本自动测** + **Tester 交互实操** | 无缺条件 |
| **AC-08** | 高 | 正常入口（无 `?test=1`） | 正常打开大厅选图开单人 AI → 建塔 → 升 Lv2 → 点击 Lv3 分支文字中心完成转职 → 切换对手视角看 AI → 切回继续建塔 | 全链路 0 报错、按钮一击即中、操作顺滑 | 关键帧截图 + Console 日志 | **Tester 交互实操** | 无缺条件 |

---

## 5. 可控测试条件与测试钩子

沿用双重门控（`CANDY_ALLOW_TEST_HOOKS=1` + `?test=1`）：
- 扩展 `spawnStress({ towers, creeps, bothSides })` 支持 `bothSides: true` 同时在双方铺设 Lv3 分支塔与大量怪，精确复现云端 W20 AI 实战压力；
- `?netdebug=1` 面板追加显示 `WS KB/s` 与 `SkipSnap`（背压跳过帧数），便于现场直观看见网络负载。

---

## 6. 已批准决策与预授权（`2026-11-27`）

- **决策 1（已确认：开启）**：`WebSocketServer` 开启 `perMessageDeflate: { threshold: 1024 }`（>1KB 快照压缩，反代不协商时自动降级无压缩）。
- **已获授权**：本地分支完成 V2.1 实现、单测/协议/浏览器验收（隔离端口段 Builder `3100–3199` / Reviewer `4100–4199` / Tester `4500–4599`）与本地 Git 规范提交；**严禁未经再次批准执行远端 `git push` 或云端生产部署**。

---

## 7. 版本构建与评审追踪表（由调度员持续更新）

| 版本号 | 任务类型 | 实际调用模型与 effort | 测试范围 | 可见用量 | 测试运行次数 | 返工轮数 | 已发现漏检 | 验收结论 |
| --- | --- | --- | --- | --- | :---: | :---: | --- | --- |
| `V2.1` (Round 1 @ `3c10efc`) | 专项 Bug 修复与后期性能优化（中任务） | Builder: `gemini-4-hydrogen-high` / Reviewer: `gemini-4-neon-high` | 代码与简洁度审计 + `npm test` 20/20 快测（Fast-Fail 跳过 Tester） | 账号剩余 88%（无法分摊单角色） | 2（Builder 自测 + Reviewer 快测） | 1（进入 Round 2） | 高背压（`bufferedAmount > 64KB`）下终局 `ENDED` 快照被误当作周期帧跳过，导致结算弹窗错显默认「甜蜜胜利」与空白统计 | `FAIL`（Round 1 Fast-Fail，交 Builder 定点修复） |
| `V2.1` (Round 2 @ `d586e28`) | 定点返工与全量验收 | Builder: `gemini-4-hydrogen-high` / Reviewer: `gemini-4-neon-high` / Tester: `gemini-4-hydrogen-high` | Round 1 返工项 + `AC-01` ~ `AC-08` 全量回归与独立 Tester 浏览器实操（含多子区域 125ms 慢点、DPR=2 W20、128KB 背压战败） | 账号剩余额度（无法分摊单角色） | 3（Builder 自测 + Reviewer 全量单测 + Tester 3 组实操） | 0 | 无（高背压终局快照缺陷与 2 项建议全部闭环；`AC-01`~`AC-08` 与 `npm test` 20/20 全绿） | **`PASS`**（2026-11-27，本地分支 `v2.1-candy-td-battle @ d586e28`，待用户批准推送/部署） |
