# 独立评审报告 — Round 1（《糖果塔防对战》Candy TD Battle V1）

结论：FAIL
候选版本：`v1-candy-td-battle @ 90e537864e6c0bb275e000495da22ea516aabdda`（`git rev-parse HEAD` 核对一致，`git status --short` 干净）
本轮核验方式：第 1–2 步全量核心代码审计 + `npm test`（`11/11` 通过，779.8ms） + 确定性无头探针脚本（端口 `4101`） + Builder 自测截图目视抽检；已证实存在 5 项阻断性「必须」级缺陷，触发 **Fast-Fail 门禁（跳过本轮 Tester 交互取证，留待 Round 2 统一实机验收）**。

---

## 达标项（代码审与确定性脚本已核实）

- **[数值与地图几何 / AC-04 / AC-05 / AC-06]**：`public/js/shared/constants.js` 与 `server/simulation.js` 精确对齐 `SPEC 3.1–3.3`（18×9 棋盘、1748px 路径、31 路径格、4 甜品障碍、127 可建格、60px 偷看隔离带；4 塔 Lv1–Lv3 数值、出售 70% 返还 `$207`、薄荷 35%/55% 减速与 Lv3 `+15%` 易伤、爆米花群体溅射与硬甲 `0.6×`、柠檬 `104/189` 破甲及 Lv3 `50%` 穿透、草莓 Lv3 每 4 发 `1.6×` 暴击、多层马卡龙半血破壳提速至 `96 px/s`、120 ticks 精确发薪与低防卫赏金防互刷），`npm test` 与独立探针均通过。
- **[快递前 3 秒防泄密契约 / AC-07 协议层]**：`server/simulation.js` 的 `_serializePlayerForViewer` 与 `express_started` 事件严格裁剪防守方 `incomingAlerts`，前 60 ticks 仅含 `{ id, arriveTick, totalTicks }`，零泄露 `isFake`/`sendType`；在途上限 2 辆并返回 `EXPRESS_QUEUE_FULL`。
- **[波次与加时赛逻辑 / AC-08 逻辑层]**：`getWaveConfig` 与 `jumpWave` 正确支持 15 波主线与第 16 波起狂暴彩虹糖加时缩放（`+35%` HP、`+6%` 移速）。
- **[子路径反代与测试钩子双门控 / AC-11 / AC-12 代码层]**：`public/index.html` 全相对路径，`net-client.js` 动态推导子路径 `ws` URL，`server/index.js` 实测 `/candy-td/` 与 `/candy-td/js/main.js` 均 `200 OK`、目录穿越 `..%2Fpackage.json` 拦截返回 `404`；生产模式下 `CANDY_ALLOW_TEST_HOOKS` 未开启拒绝 `test_command`（`TEST_HOOKS_DISABLED`），无 `?test=1` 不挂载 `window.__CANDY_TEST__`。
- **[马卡龙基础画风]**：目视审查 Builder 提供的 8 张截图（`01-lobby-home.png`–`08-feint-unbox-bubble.png`），整体马卡龙色板清晰柔和、无外部 CDN 依赖、大厅与底部双区操作台排版可读性良好。

---

## 返工项（FAIL）

### 【问题 1（必须）：双端战斗特效/飘字严重串屏，且 PvP 二号玩家炮塔特效硬编码 `slot === 0` 失效】
- **现象与证据**：
  1. 代码审 `public/js/renderer.js:978` 与 `1004`：`_updateAndRenderTransientEffects` 中柠檬激光与薄荷/爆米花溅射圈的平移偏移硬编码为 `l.slot === 0 ? viewShift : (1 - easedPeek) * CANVAS_WIDTH` 与 `s.slot === 0 ? viewShift : (1 - easedPeek) * CANVAS_WIDTH`。`CandyRenderer` 从未记录本地玩家的 `playerSlot`。在双人 PvP 中，**P2（`playerSlot === 1`）完全看不到自己柠檬狙的激光和薄荷/爆米花溅射圈**（被画到了右侧 `+1280px` 屏幕外），反而会看到 P1（`slot === 0`）的激光和爆炸圈直接刷在 P2 自己的棋盘上。
  2. 代码审 `public/js/renderer.js:387-447` 与 `server/simulation.js:427-465, 668, 829, 884`：`creep_pop`、`crit_hit`、`mint_splash`、`popcorn_boom`、`macaron_cracked`、`tower_shot`、`express_arrived_real`、`express_arrived_feint` 均以 `viewerScope: 'all'` 广播给双方，但 `renderer.handleEvents` **完全未按 `ev.slot` / `ev.targetSlot` 与本地 `mySlot` 区分归属战场**，也未将粒子、跳字与假动作开箱气泡绑定到对应战场坐标系（`selfShift` / `oppShift`）：
     - 单人 AI 局与 PvP 局中，对手/AI 击杀小怪时，`+$7` 金币飘字和爆炸粒子会凭空刷在**玩家自己的空路径上**；
     - 进攻方派出 `🎩 假动作`（`express_feint`）或真快递 3 秒到点时，`express_arrived_feint` 触发的 34 颗彩带粒子与巨大气泡 `「😜 空快递盒！骗到你啦~」` 会直接弹出在**进攻方自己的入口门上**（即便进攻方并未偷看对手）；
     - 偷看对手时，己方屏幕空间飘字会残留叠在对手地图上（Builder 自测图 `docs/review/evidence/round-1/03-peek-opponent.png` 中已可见 `+$30 Eco 💰` 浮在 AI 地图上方并与紫色偷看提示条贴叠）。
- **影响**：严重破坏双人实时对战（`AC-02`）、假动作心理战（`AC-07`）与单人 AI 局（`AC-01`）的画面清晰度与战况理解，P2 玩家在 PvP 中体验直接错乱。
- **修改方向**：
  - 让 `CandyRenderer` 同步维护当前玩家的 `mySlot`（由 `room_state.playerSlot` 更新）。
  - 所有激光、溅射圈、粒子、飘字（`creep_pop` / `crit_hit` / `tower_built` 等）与 `feintBubbles` 均记录所属 `slot`（或 `side: 'self' | 'opponent'`），渲染时严格按 `side === 'self' ? selfShift : oppShift` 随对应战场平移（并在对应视口可见时才绘制，不跨越到另一战场）；`eco_payout` 等己方全局飘字仅在己方视野或与战场绑定显示，避免压住偷看横幅。
  - `express_arrived_feint` / `express_arrived_real` 的彩带与气泡仅绑定到 `ev.targetSlot` 对应的防守方战场（进攻方仅在偷看对手时于对手战场入口看到，绝不出现在进攻方自家入口）。
- **下轮验收标准**：PvP 双端联机中 P1/P2 各自看到且仅看到自家战场的激光、溅射、粒子与击杀跳字；A 发假动作给 B 且 A 不偷看时，彩带与「骗到你啦」气泡仅出现在 B 的自家地图入口、不出现在 A 的自家地图；偷看对手时，对手战场的实时特效与假动作开箱气泡随对手画面平滑滑入，无跨屏残留。

### 【问题 2（必须）：偷看态防误触漏网——选中己方塔后进入偷看，升级/出售浮卡在 50ms 后重新弹出并可误点】
- **现象与证据**：
  - 代码审 `public/js/ui.js:243-248`：`setPeekBanner(active)` 在 `active === true` 时仅隐藏 `this.elTowerPopover`，但**未清空 `this.selectedTowerId`**，且 `updateSnapshot`（`ui.js:471-478`）未检查偷看保护态。
  - 玩家若在选中己方任意塔（打开升级/出售卡片）的状态下移入右侧偷看热区或按住 `Space`，至多 `50ms` 后下一帧 `game_snapshot` 到达，`updateSnapshot` 调用 `this._renderTowerPopover(sel)`（`ui.js:294` 移除 `hidden`），将己方塔的升级/出售/索敌卡片**重新弹在对手地图正上方**，玩家在偷看态仍可误触点击「升级」或「出售」。
- **影响**：直接违反 `SPEC 3.5`（“一旦 `peekActive === true || peekProgress > 0.05`：自动隐藏己方建塔虚影预览、禁用地图网格点击建塔/选塔/升级/出售操作”）与 `AC-03` 防误触核心底线。
- **修改方向**：进入偷看时同步清除选中塔（或隐藏浮卡并在 `updateSnapshot` / `_renderTowerPopover` 中严格判断 `if (this.renderer.isPeekingProtected())` 拒绝显示浮卡，且升级/出售/索敌按钮回调也加 `isPeekingProtected()` 兜底拦截）。
- **下轮验收标准**：选中己方塔打开浮卡后悬停热区或按住 `Space` 偷看并持续 `≥1s`（覆盖 20+ 个快照帧），浮卡始终保持隐藏不重弹，期间无法触发任何己方建塔/升级/出售扣费。

### 【问题 3（必须）：右侧偷看热区存在永久卡死偷看态的边界缺陷】
- **现象与证据**：
  - 代码审 `public/js/input.js:69-77`：`canvas.mousemove` 判断 `if (isPointInPeekZone(pt.x, pt.y))` 时将 `this.hoverPeekZone = true`，但**缺少 `else` 复位分支**。
  - 叠加 `public/css/style.css:266-286`：`#peek-zone` 定位 `left: 1204px; width: 72px`（覆盖 `1204..1276`），悬停/激活态施加 `transform: translateX(-3px)` 使其左移至 `1201..1273`，露出右侧 `3px` 画布缝隙 `x ∈ (1273, 1276]`——该缝隙仍满足 `isPointInPeekZone(x, y)`！
  - 当玩家鼠标滑到热区右侧边缘（`x = 1274..1276`）再滑出到画布其他位置（例如下方 `y > 540` 或快速左移）时，`peekZone.mouseleave` 先将 `hoverPeekZone` 置 `false`，随后缝隙处的 `canvas.mousemove` 立刻将其重新置 `true`，之后鼠标回到棋盘区时因未再经过 `#peek-zone` 的 `mouseleave`，`hoverPeekZone` **永久卡死为 `true`**，画面锁在对手战场且所有己方地图点击被禁用。
- **影响**：玩家实战中容易卡在偷看界面无法回防建塔，直接导致漏怪输局，违反 `AC-03` 退出偷看 `≤300ms` 顺畅回防要求。
- **修改方向**：在 `canvas.mousemove` 中补齐 `else if (this.hoverPeekZone) { this.hoverPeekZone = false; this._syncPeek(); }`（并在 `canvas.mouseleave` 与未命中的指针移动时正确复位），同时避免 `#peek-zone` hover/active 的水平位移把热区右边缘移离 `PEEK_ZONE` 几何范围（或统一以 `stage` 级 `pointermove` 坐标判定热区，彻底消除 DOM 与 Canvas 状态撕裂）。
- **下轮验收标准**：鼠标在热区四个边缘（含最右侧 `x=1275`）反复进出并移回棋盘任意位置，100% 在 `≤300ms` 内稳定回防，绝不卡死偷看态；同时最右列 `(col=17, row=3)` 建塔与热区之间保持严格 `60px` 隔离带零误触。

### 【问题 4（必须）：「返回大厅」未通知服务端退房留幽灵房主，且 3 秒倒计时期间断线重连会导致房间永久僵死】
- **现象与证据**：
  1. **「返回大厅」幽灵连接**：代码审 `public/js/main.js:58-62` 的 `onReturnHome()` 仅清空本地 `sessionStorage` 并切回首页 UI，**既未发送退房消息也未关闭旧 WS**；且服务端 `server/room-manager.js:271-282` 的 `_detachCurrentSocket(ws)` 仅将 `p.ws = null; p.connected = false`，既不移除 `LOBBY` 槽位、也不移交 `hostSlot` 或广播 `room_state`。独立探针脚本（端口 `4101`）实测：P1 离开旧 PvP 房间改建新房后，旧房仍残留 `players: [{ slot: 0, connected: false }, { slot: 1, connected: true }], hostSlot: 0`；若 P1 点「返回大厅」后停留在首页，旧房 P2 点击准备/离开时，服务端仍推送 `room_state` 强行将 P1 拉回旧房间界面。
  2. **倒计时断线重连僵死**：代码审 `server/room-manager.js:669-675` 与 `376-382`：玩家在 `COUNTDOWN` 阶段（此时 `room.sim === null`）断线，房间转入 `PAUSED_RECONNECT`；玩家 20s 内重连后，第 379 行直接把 `room.phase` 置为 `'PLAYING'` 而**未初始化 `room.sim`**。独立探针脚本实测复现：`After reconnect -> phase: PLAYING, simNull: true`，此后 `_tickAllRooms` 永远跳过该房间，双方卡在空地图无法开战。
- **影响**：双人建房反悔返回、结算后回大厅重新开房，或开战倒计时瞬间误刷新 F5 均会直接卡死或错乱房间，破坏 `AC-02` 与 `AC-10` 联机健壮性。
- **修改方向**：
  - 增加客户端 `leave_room` 消息（或在 `onReturnHome` 主动发送 `leave_room` 并重置 `latestRoomState` 与 `renderer`），服务端 `leave_room` 与 `_detachCurrentSocket` 复用统一的离房清理逻辑（`LOBBY` 移槽+移交房主+广播或销毁空房；`ENDED` 通知/销毁）。
  - 在 `PAUSED_RECONNECT` 全员重连恢复时，若 `!room.sim` 则调用 `this._startCountdown(room)`（或 `this._beginPlaying(room)`）确保仿真必然启动，绝不进入 `phase === 'PLAYING' && !room.sim` 的非法状态。
- **下轮验收标准**：新增自动化回归用例并实测通过：① P1 点「返回大厅」后 P2 立即收到房主移交与空位更新，且 P1 不再受旧房消息干扰；② 在 `COUNTDOWN` 阶段断开并重连后，房间正常进入 `PLAYING` 且 `tick` 持续递增、可正常建塔开火。

### 【问题 5（必须）：终局胜负音效（`win`/`lose`）恒不触发，且「再来一局」未清理旧局渲染残留状态】
- **现象与证据**：
  1. 代码审 `server/room-manager.js:187-190, 204-209` 与 `public/js/main.js:95-103`：对局结束（`hp_zero` 或 `reconnect_timeout`）时，服务端**先**调用 `_broadcastRoomState(room)`（发出 `phase: 'ENDED'`），**后**调用 `_broadcastSnapshot(room, events)`（发出含 `endedResult` 的快照与 `match_ended` 事件）。因此前端 `net.handlers.onRoomState` 执行第 99 行 `if (state.phase === 'ENDED' && renderer.currSnapshot?.endedResult)` 时，`currSnapshot.endedResult` **恒为 `null`**，导致 `audio.play('win')` 与 `audio.play('lose')` 永远不会触发（且 `onEvents` 未处理 `match_ended`）。
  2. 代码审 `public/js/renderer.js:381-385` 与 `public/js/ui.js:347-356`：点击「再来一局」重新开局时，`renderer` 未清空上一局的 `prevSnapshot`、`lasers`、`splashRings`、`feintBubbles`、`particles`、`floatTexts`、`selectedBuildType`、`selectedTowerId`，`ui` 也未重置建塔选中高亮与旧的 `incoming/outgoing` 横幅。
- **影响**：违反 `SPEC 3.8` / `AC-14` 胜负音效要求，以及 `AC-02`「再来一局完全清零开新局」的干净体验。
- **修改方向**：在 `match_ended` 事件（或首次收到 `snap.phase === 'ENDED' && snap.endedResult` 时）去重触发一次 `audio.play(isWin ? 'win' : 'lose')`；在进入新局（`COUNTDOWN` 或 `snap.tick === 0`）时提供 `renderer.resetMatchState()` 与 UI 选中态复位方法，彻底清空上一局残影。
- **下轮验收标准**：对局结算瞬间 `window.__CANDY_TEST__.getAudioState().events` 可观测到准确的 `win` 或 `lose` 触发记录（仅 1 次，不重复）；点击「再来一局」开新局后画面零旧局粒子/激光/弹窗残影且选中态归零。

---

### 建议优化项（非阻断，建议一并修顺）
- **【问题 6（建议）：补齐城堡漏怪扣血（`life_lost`）视听反馈与多辆排队快递提示】**
  - **现象与证据**：`server/simulation.js:520-527` 已发送 `life_lost` 事件，但 `renderer.js` 与 `main.js` 均未消费，漏怪时仅顶部血量数字变化，缺乏城堡受击飘字（如 `-1 ❤️`）与轻提示音；另外在途排队 2 辆快递时，`renderer.js:652` 与 `ui.js:440` 仅展示第 1 辆。
  - **修改方向**：在 `handleEvents` 中消费己方 `life_lost` 绘制城堡红字 `-X ❤️` 与轻警报音；`incomingAlerts.length > 1` 时在横幅标注 `×2` 并在入口略作水平偏移渲染第 2 辆粉车。
- **【问题 7（建议）：补齐 `AC-13` WS 协议级异常边界回归测试】**
  - **现象与证据**：`tests/ws-protocol.test.js` 当前覆盖了畸形 JSON、空房、满房、禁钩子，但越界网格、满级再升级、冷却未满连点假动作等 `AC-13` 边界仅测了纯仿真类未走真实 WS 报文；另建议 `server/index.js` 支持 `process.env.HOST || '127.0.0.1'` 以便局域网双机联机。

---

## 未验证项（本轮触发 Fast-Fail，留待 Round 2 派 Tester 完整实测）

- 本轮因代码审查与无头探针已证实 5 项「必须」级缺陷，按 `references/evaluator.md` 第 2.4 步执行 Fast-Fail，**暂未派发 Tester**；以下交互与性能门槛将在 Round 2 返工后由 Tester 在独立 Edge CDP（`1280×720`, `deviceScaleFactor: 2`，端口 `4500–4599`）全量实操取证：
  - `AC-01`（纯正常入口单人 AI 全流程交互）、`AC-02`（双独立浏览器会话实时 PvP 联机与再来一局）、`AC-03`（右侧热区边缘与 `Space` 偷看实操防误触/防卡死）、`AC-07`（双端实时快递倒计时与假动作开箱目视核验）、`AC-08`（第 15/16 波实机界面）、`AC-09`（`DPR=2` 持续 5s 稳态压测 `FPS ≥ 55` & `Render ≤ 8ms`，注：Builder 截图 `05`/`06` 中因截图抖动出现过 `FPS: 50/54`，Round 2 须以无截图干扰的连续 5s 采样复核）、`AC-10`（双浏览器 F5 刷新 20s 断线重连实操）、`AC-14`（Web Audio 交互解锁与静音跨局持久化）。
- **环境固有限制（非代码缺陷）**：本机为 Windows 环境无真机 Mac Retina 屏与物理扬声器录音设备，Round 2 仍以 Edge `deviceScaleFactor: 2` 仿真及 `AudioContext` 状态/事件日志核验并如实披露。

---

给用户的摘要：本轮代码审查与快测通过了全部 11 项核心数值和协议单测，整体马卡龙画风与基础玩法架构也已成型，但发现了 5 个会影响双人联机与偷看体验的必修问题（包括双人特效串屏且 P2 看不到自己激光、假动作彩带气泡错弹在进攻方自家门口、偷看时塔升级弹窗会重新冒出、热区边缘可能导致卡死偷看态、返回大厅留幽灵连接以及胜负音效未触发）。为避免在带伤版本上浪费交互测试成本，本轮按规范直接签发 FAIL 并交给 Builder 一次性修净，修完后下一轮立即安排双端浏览器完整实机试玩验收。

Notion 一行摘要：FAIL / 代码审与探针检出 5 项必修缺陷（双端特效串屏与 P2 激光失效、偷看浮卡重弹、热区卡死、退房/倒计时重连状态机缺陷、胜负音效未触发），触发 Fast-Fail 跳过 Tester / 交 Builder 按 round-1.md 返工后进入 Round 2 全量实机验收。
