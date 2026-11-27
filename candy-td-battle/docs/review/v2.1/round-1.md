结论：FAIL
候选版本：v2.1-candy-td-battle @ `3c10efcea566090821b04ade98f2b9e983d28c84`（基点 `46f605fd4ca03907d4e0ada2be5abaeeec10d54a`，工作区干净）
本轮核验方式：代码全量 diff 审计 + 简洁度（YAGNI）审计 + 测试断言审计 + 廉价确定性检查（`npm test` 20/20 与独立端口 `4105` 背压终局复现脚本）；因第 2 步已实证 1 项「必须」级 V2.1 回归缺陷，触发 **Fast-Fail 门禁**，本轮跳过 Tester 交互试玩，待修复后于 Round 2 委派 Tester 执行全量浏览器实操验收。

---

## 代码与简洁度（YAGNI）审计结论

- **结构简洁度（通过）**：零新增第三方依赖，未引入重型抽象或过度封装；`public/index.html` 固化静态子 `<span>`、`public/js/ui.js` 缓存高频 DOM 并以 `popoverKey`/`_hudCache` 做脏检查、`server/room-manager.js` 拆出 `_filterEventsForPlayer` / `_sendSnapshotToPlayer`、`server/simulation.js` 用 `creepById` Map + 平方距离并抽出 `_populateStressSide` 消除重复、`public/js/renderer.js` 预烘焙护盾精灵与上限淘汰、`public/js/audio.js` 65ms 节流，整体实现克制清晰，无死代码或架构臃肿。
- **核心机制静态核验**：
  - **Bug 1（`public/index.html`、`public/js/ui.js`）**：20Hz 快照下彻底移除 `#tp-branch-a` / `#tp-branch-b` 的 `innerHTML` 覆写，Lv1→Lv2、Lv2→Lv3 A/B、出售、索敌与障碍拆迁浮卡均改为状态脏检查，子节点无重建；静态 `<button>` 包裹 `<span>` 冒泡链路完整（下轮交 Tester 补齐标题/图标/价格/描述/边缘多子区域 120ms 慢点击实测）。
  - **Bug 2 渲染/音频/仿真**：`lasers ≤ 32`、`splashRings ≤ 40`、`particles ≤ 220`、`floatTexts ≤ 60` 边界清晰；Canvas 热循环去除 `save/restore` 后无 `globalAlpha`/`lineWidth`/变换状态泄漏；护盾角标 1–16 预烘焙并随 `resize()` 响应 DPR 变化；仿真 `creepById` Map 与平方距离改写与 V2 数值保持等价；`spawnStress({ bothSides })` 严格受 `CANDY_ALLOW_TEST_HOOKS=1` + `?test=1` 双门控隔离。
  - **测试断言审计**：`tests/sim-unit.test.js`（AC-06 双边 25 塔 + 80 怪 200 ticks 实测 `avg=0.079ms, p95=0.208ms`）与 `tests/ws-protocol.test.js`（真实 TCP `sock.bytesRead` 测得 `-95.7%` 压缩降幅、128KB 背压、65ms 音效节流、离线返回 `false` 与重连恢复）断言真实有效，但 **AC-03 背压用例漏测了高背压下 `match_ended` 终局帧送达**，导致问题 1 漏出。

---

## 达标项（本轮已直接核实部分）

- **[AC-06]** 无头仿真回归与 W20 双边重压基准通过：`npm test` 全量 `20/20` 通过，双边 25 Lv3 塔 + 80 怪连跑 200 ticks 实测 `avg=0.079ms`（`≤ 4ms`）、`p95=0.208ms`（`≤ 8ms`），V2 全部数值与 8 图 AI 断言零回归（证据：`tests/sim-unit.test.js` 本地实跑输出）。
- **[AC-03 / AC-07 协议基础部分]** 真实 `ws` 压缩链路与视角协议验证通过：W20 1s 下行线速从 `966,928 B` 降至 `41,220 B`（降幅 `95.7% ≥ 60%`），非 `%10` 帧 `opponentLite` 生效、事件按 `watchedSlot` 过滤且非关键战斗事件 `≤ 24`、`set_view_mode: 'opponent'` 立即下发完整对手状态并维持 20Hz 同步、128KB 背压下 `place_tower` 仍在 `≤ 300ms` 回包（证据：`tests/ws-protocol.test.js` 本地实跑输出；注：高背压终局帧存在问题 1，AC-03 整体待修后复验）。
- **[AC-05 音效节流部分]** 6 类高频战斗音效（`pop/frost/boom/laser/shield_hit/heal_pulse`）65ms 冷却内 10 连发均节流至 1 次，80ms 后恢复，非节流音效不受影响（证据：`tests/ws-protocol.test.js` 本地实跑输出；渲染池上限待 Round 2 由 Tester 独立采样复核）。

---

## 返工项

### 【问题 1（必须）：高背压下终局 `ENDED` 快照被跳过，导致结算弹窗永久显示错误胜负与空白/陈旧统计】
- **现象与证据**：
  - **来源**：代码审计（`server/room-manager.js:357-362`、`server/room-manager.js:171-184`、`public/js/main.js:356-358`、`public/js/ui.js:966-976, 1137-1144`、`public/index.html:275-280`）+ 独立确定性复现脚本（端口 `4105`）。
  - **复现步骤**：启动测试服建立 AI 对局进入 `PLAYING`，在服务端 WS 注入 `bufferedAmount = 131072`（128KB > 64KB），令 P0 剩余 1 血被漏怪击破触发对局结束。
  - **实测结果**：`{"roomPhase":"ENDED","endedRoomStates":1,"endedSnaps":0,"endedEvents":1,"skippedSnapshots":1}`。`_tickAllRooms()` 在 `room.sim.phase === 'ENDED'` 时将 `room.phase` 置为 `'ENDED'` 并先 `_broadcastRoomState(room)`，随后仍以 `{ isPeriodic: true }` 调用 `_broadcastSnapshot()`；`_sendSnapshotToPlayer()` 因 `isPeriodic && bufferedAmount > 65536` 跳过了终局 `game_snapshot`（仅发了 `match_ended` 事件）。客户端 `ui.updateRoomState` 收到 `room_state(ENDED)` 后立即弹出 `#result-overlay`，但 `main.js` 处理 `match_ended` 仅播胜负音效、并未渲染 `endedResult`（渲染入口仅在 `ui.updateSnapshot()` 内），且 `room.phase === 'ENDED'` 后房间不再 tick，永无后续快照到达。
- **影响**：在 V2.1 重点治理的慢网/W20+ 高背压场景下，玩家即便**战败**，结算弹窗也会永久展示 `public/index.html` 的硬编码默认文案「🏆 甜蜜胜利！ / 你守住了糖果城堡！」且原因与战绩统计区完全空白（若为“再来一局”则残留上一局错误战绩），直接破坏核心对局闭环并违背 SPEC 3.2“背压跳过仅针对冗余周期帧、绝不丢弃终局关键状态”的要求。
- **修改方向**：
  1. 在 `server/room-manager.js` 的 `_tickAllRooms()` 中，终局帧不走可跳过周期快照路径（例如传递 `{ isPeriodic: room.phase === 'PLAYING' }`，或在 `_sendSnapshotToPlayer()` 中限定仅 `isPeriodic && room.phase === 'PLAYING'` 时触发背压跳过），确保 `ENDED` 终局快照与 `endedResult` 永不因背压丢弃；
  2. 在 `public/js/main.js` 处理 `match_ended` 事件时同步兜底调用 `ui` 渲染 `endedResult`（同时避免 `reconnect_timeout` 等无新快照终局路径漏渲染）；
  3. 在 `tests/ws-protocol.test.js` 的 AC-03 背压测试用例中补充高背压（`bufferedAmount > 64KB`）下触发对局结束的断言，验证客户端必同时收到 `room_state(ENDED)`、`game_snapshot(ENDED)`（含正确 `endedResult`）与 `match_ended`。
- **下轮验收标准**：`bufferedAmount = 131072`（128KB）状态下触发 P0 战败终局时，服务端 100% 下发 `game_snapshot(phase === 'ENDED')`（`endedSnaps === 1` 且 `endedResult.winnerSlot === 1`），`tests/ws-protocol.test.js` 新增断言通过且 `npm test` 全绿。

### 【问题 2（建议）：自动重连 `await net.connect()` 完成后缺少 `canAutoReconnect()` 二次校验与 `finally` 复位】
- **现象与证据**：代码审计 `public/js/main.js:89-108`。`scheduleReconnect()` 在 `await net.connect({ timeoutMs: 3500 })` 之前捕获 `const s = net.session`，异步连接完成后未再次检查 `canAutoReconnect()` 即直接发送 `join_room`；且 `reconnectInFlight = false` 未放进 `finally`。
- **影响**：若自动重连连接耗时期间玩家退回大厅（`onReturnHome` 已清空 session）或房间状态切为 `ENDED`/`LOBBY`，连接 resolve 后可能误发旧房间的 `join_room` 请求，造成非预期重入或错误 Toast；同时异常分支依赖手动复位 `reconnectInFlight`。
- **修改方向**：在 `await net.connect({ timeoutMs: 3500 })` 之后先校验 `if (!canAutoReconnect()) { stopReconnectLoop(); return; }` 再读取当前 `net.session` 发送 `join_room`；用 `try / catch / finally` 确保 `reconnectInFlight` 总能安全复位后再调度下一次退避重连。
- **下轮验收标准**：代码审确认 `await net.connect()` 后存在 `canAutoReconnect()` 二次守卫且无幽灵重连请求风险。

### 【问题 3（建议）：切入对手视角时同步重置浮卡脏检查缓存】
- **现象与证据**：代码审计 `public/js/ui.js:619-626`。`setViewMode('opponent')` 清空了 `selectedTowerId` / `selectedObstacle` 并隐藏浮卡，但未同步调用 `this._resetPopoverCache()` 与重置 `this._obsState`。
- **影响**：当前路径因 DOM 未被其他逻辑篡改暂未触发错显，但状态缓存与可见态存在隐式耦合，后续维护易引入边界问题。
- **修改方向**：在 `setViewMode('opponent')` 分支中一并调用 `this._resetPopoverCache()` 并将 `this._obsState` 重置为初始空态。
- **下轮验收标准**：代码审确认状态重置一致。

---

## 未验证项（本轮 Fast-Fail 跳过 + 环境限制）

- **本轮因 Fast-Fail 跳过（Round 2 必由独立 Tester 实操补齐）**：
  - `AC-01`（4 塔 A/B 分支按钮不同子区域：标题/图标/价格/描述/边缘 120ms 慢点击实操 + 升级/出售/索敌/障碍拆迁浮卡稳定性）；
  - `AC-02`（`DPR=2` W20 双边重压 + 高压期间连续建塔实测）；
  - `AC-04`（浏览器端断线非静默 Toast + 自动退避重连恢复建塔实操）；
  - `AC-05`（前端 5s 采样 `lasers`/`splashRings`/`particles`/`floatTexts` 独立复核）；
  - `AC-07`（浏览器视角切换零空帧/即时同步实操）；
  - `AC-08`（无 `?test=1` 正常生产入口端到端试玩）。
- **环境固有限制（非交付门槛）**：真实公网 3–5 Mbps 云主机链路实玩、Mac 真机 Retina 体感、物理扬声器听音。

---

给用户的摘要：本轮代码与协议快审发现 1 项必须修复的 V2.1 回归缺陷：在慢网高背压（`bufferedAmount > 64KB`）状态下如果对局结束，服务端会把最后一张终局快照当成普通周期帧跳过，导致结算弹窗永久显示错误的默认「甜蜜胜利」文案与空白统计。其余核心修复（Lv3 分支按钮零 DOM 重建、WS 压缩与视角瘦身、渲染/音频/仿真优化）结构简洁且 `npm test` 20/20 全绿。已触发快速打回（Fast-Fail）交由 Builder 先修复该缺陷并补齐回归测试，下轮再启动完整浏览器交互实测。

Obsidian 一行摘要：FAIL（Round 1 Fast-Fail） / 代码结构简洁且 20/20 单测通过，但实证高背压下终局 `ENDED` 快照被误跳导致结算页错显胜利与空统计（另附 2 项重连/浮卡缓存小建议） / 交 Builder 定点修复并补背压终局单测后进入 Round 2 含 Tester 全量验收
