# Builder 交付报告 — Round 2（《糖果塔防对战》Candy TD Battle V1）

## 0. 快速索引
- **候选版本**：`v1-candy-td-battle @ d0c11198667a35220ff074ff8086fa5bfe311628`（紧随其后的文档提交含本报告；最终分支 `HEAD` 以消息板回传为准）
- **本轮相对上轮变化**：针对 `docs/review/round-1.md` 全部 **5 项必须缺陷 + 2 项建议优化** 完成根因修复并补齐自动化回归用例，改动模块：`public/js/renderer.js`、`public/js/input.js`、`public/js/ui.js`、`public/js/main.js`、`public/js/audio.js`、`public/css/style.css`、`server/room-manager.js`、`server/index.js`、`tests/ws-protocol.test.js`
- **启动方式与 Tester 前置条件**：
  - 正常生产启动：`PORT=4500 node server/index.js`（访问 `http://127.0.0.1:4500/`）
  - 测试钩子模式：`CANDY_ALLOW_TEST_HOOKS=1 PORT=4500 node server/index.js`（访问 `http://127.0.0.1:4500/?test=1&netdebug=1`）
  - 测试账号 / 种子 / 样本：免登录；仿真固定种子示例 `seed=42`
  - 受控测试钩子用法：`window.__CANDY_TEST__` 仅在服务端 `CANDY_ALLOW_TEST_HOOKS=1` 且浏览器 `?test=1` 双门控时挂载（`getSnapshot`, `setSeed`, `grantResources`, `jumpWave`, `spawnStress`, `fastForwardTicks`, `simulateDisconnect`, `getAudioState`）
  - 清理方式：记录服务与浏览器 PID，结束时按 PID 单独终止，严禁 `pkill` / `killall`
- **自测命令与证据索引**：
  - 一键测试命令：`npm test`（结果：`12/12` 通过，耗时 `914.9072 ms`）
  - Round 2 新增截图与实测数据：
    - `docs/review/evidence/round-2/01-p2-peek-popover-hidden.png`（P2 选塔打开浮卡后悬停热区最右边缘 `x=1275` 偷看 `1.2s`，浮卡持续保持隐藏）
    - `docs/review/evidence/round-2/02-two-express-trucks.png`（双快递排队 `共 2 辆排队` 横幅 + 双粉车入口渲染，且横幅居中不与 `?netdebug=1` 叠层）
    - `docs/review/evidence/round-2/03-p2-feint-unbox.png`（P2 防守端入口假动作开箱彩带与鬼脸气泡，仅渲染在目标方战场）
    - `docs/review/evidence/round-2/04-result-screen.png`（终局结算弹窗，`winLoseEventsCount: 1`）
    - `docs/review/evidence/round-2/05-rematch-clean.png`（「再来一局」清零新局状态，`tick: 5, towers: 0, hp: 20`）
    - `docs/review/evidence/round-2/metrics.json`（Edge CDP `DPR=2` 实测指标）
- **环境未验证缺口**：
  1. 本机无真机 Mac Retina / Safari 硬件，使用 Edge CDP `deviceScaleFactor: 2` 仿真验证 `DPR=2` 渲染性能。
  2. 无物理扬声器录音设备，`AC-14` 通过 `AudioContext` 节点调用逻辑、`window.__CANDY_TEST__.getAudioState().events` 及 `sessionStorage` 静音状态验证。

---

## 1. 实现概述与 Round 1 问题逐项根因修复

1. **【问题 1（必须）已修复】双端战斗特效/飘字/假动作气泡严格按 `slot -> side` 隔离**：
   - `CandyRenderer` 新增 `mySlot`（由 `room_state.playerSlot` 实时同步）与 `_sideForSlot(slot)`。
   - `particles`、`floatTexts`、`lasers`、`splashRings`、`feintBubbles` 全部绑定 `side: 'self' | 'opponent'`；`render()` 先单次推进物理生命周期 `_stepPoolsAndEffects(dtSec)`，再在 `selfShift` 坐标系中仅绘制 `side === 'self'`、在 `oppShift` 坐标系中仅绘制 `side === 'opponent'`。
   - 进攻方发出的真/假快递 `express_arrived_*` 绑定 `ev.targetSlot`，仅出现在防守方战场入口（进攻方不偷看绝不刷在自己门口）。

2. **【问题 2（必须）已修复】偷看态彻底关闭并拦截升级/出售浮卡**：
   - `ui.js` 的 `setPeekBanner(active)` 在进入偷看时清空 `this.selectedTowerId` 与 `this.renderer.selectedTowerId` 并隐藏浮卡。
   - `_renderTowerPopover`、`updateSnapshot` 及 `#tp-upgrade`/`#tp-sell`/`.tgt-btn` 点击回调全部增加 `this.renderer.isPeekingProtected()` 硬保护，确保连续 20+ 快照帧内绝不重弹或误点。

3. **【问题 3（必须）已修复】消除右侧热区边缘偷看卡死缺陷**：
   - `style.css` 移除 `.peek-zone:hover, .peek-zone.active` 的 `transform: translateX(-3px)` 位移，确保视觉热区与 `PEEK_ZONE`（`x ∈ [1204, 1276], y ∈ [180, 540]`）几何严丝合缝。
   - `input.js` 改用 `#stage` 级统一坐标指针跟踪（`this.hoverPeekZone = this.enabled && isPointInPeekZone(pt.x, pt.y)`），任意划出热区四边（含 `x=1275 → 1278` 与 `y=560`）均实时复位。

4. **【问题 4（必须）已修复】「返回大厅」真实退房与 `COUNTDOWN` 断线重连恢复**：
   - 服务端新增 `leave_room` 协议并将 `_detachCurrentSocket` 统一接入 `_leaveCurrentRoom(ws, { intentional })`，彻底清理 `LOBBY` 残留幽灵槽位、移交 `hostSlot` 并广播 `room_state`；`onReturnHome()` 主动发送 `leave_room` 并复位本地房间与渲染状态。
   - `COUNTDOWN` 阶段断线重连后（`!room.sim`），`_handleJoinRoom` 自动调用 `_startCountdown(room)` 重新进入倒计时并正常启动 `PLAYING` 仿真；超时裁决在 `!room.sim` 时亦生成完整 `endedResult`。

5. **【问题 5（必须）已修复】终局胜负音效精确触发 1 次与「再来一局」清零重置**：
   - `main.js` 引入 `matchEndAudioPlayed` 去重标志与 `maybePlayMatchEndAudio(endedResult)`，在 `match_ended` 事件、`onSnapshot` 与 `onRoomState` 任意时序到达时均严格触发 1 次 `win` / `lose`。
   - 新局进入 `COUNTDOWN` 时调用 `renderer.resetMatchState()` 与 `ui.resetForNewMatch()`，彻底清零上一局粒子、激光、溅射圈、假动作气泡与选中状态。

6. **【问题 6 & 7（建议）已一并完成】**：
   - 消费 `life_lost` 事件在城堡处绘制 `-X ❤️` 红字、红粒子与 `hurt` 轻警报音；支持同时显示最多 `2` 辆排队快递粉车与 `共 2 辆排队` 居中横幅（避开 `?netdebug=1` 浮层）。
   - `server/index.js` 支持 `process.env.HOST || '127.0.0.1'`；`tests/ws-protocol.test.js` 补全 `leave_room`、`COUNTDOWN` 断线重连与 `AC-13` WS 越界/满级/冷却回归测试。

---

## 2. 验收项逐条自测结果

| SPEC 编号 | 验证方式 | 实测结果与关键数字 | 原始证据路径 |
| --- | --- | --- | --- |
| **AC-01 / AC-02** | `ws-protocol.test.js` + Edge CDP | `npm test` 双人全流程与 AI 陪练通过；P2（`slot=1`）建塔/偷看/结算/「再来一局」全零残影与零报错 | `tests/ws-protocol.test.js`, `04-result-screen.png`, `05-rematch-clean.png` |
| **AC-03** | Edge CDP 交互实操 | 选塔打开浮卡后移至热区最右边缘 `x=1275` 偷看 `1.2s`，`popoverHiddenDuringPeekAfter1200ms: true`；滑出 `x=1278` 后 `peekExitedCleanly: true` | `docs/review/evidence/round-2/01-p2-peek-popover-hidden.png`, `metrics.json` |
| **AC-07** | `ws-protocol.test.js` + `sim-unit.test.js` + Edge CDP | 前 60 ticks 零泄密；双快递排队显示 `🚚 糖果快递即将送达！(1.2s · 共 2 辆排队)` 与双粉车；假动作彩带气泡仅在 P2 入口弹出 | `02-two-express-trucks.png`, `03-p2-feint-unbox.png` |
| **AC-10** | `ws-protocol.test.js` 回归用例 | `PLAYING` 断线重连+超时胜出、`COUNTDOWN` 断线重连自动重开倒计时并推进 `tick >= 5` 均通过 | `tests/ws-protocol.test.js` |
| **AC-13** | `ws-protocol.test.js` 回归用例 | 覆盖畸形 JSON、空房、满房、禁钩子、`leave_room` 移交房主、WS 越界网格/路径格（`INVALID_CELL`）、满级再升（`MAX_LEVEL`）、假动作冷却连点（`COOLDOWN_ACTIVE`） | `tests/ws-protocol.test.js` |
| **AC-14** | Edge CDP + `main.js` | 结算后 `window.__CANDY_TEST__.getAudioState().events` 精确记录 `winLoseEventsCount: 1` (`"win"`)，每 tick 同类音效去重防爆音 | `metrics.json`, `public/js/main.js` |

---

## 3. 改动影响面与失效旧证据

- **修改的模块 / 文件**：
  - 前端：`public/js/renderer.js`、`public/js/input.js`、`public/js/ui.js`、`public/js/main.js`、`public/js/audio.js`、`public/css/style.css`
  - 服务端：`server/room-manager.js`、`server/index.js`
  - 测试：`tests/ws-protocol.test.js`
- **触及的公共状态 / 存档 / 契约 / 邻近流程**：
  - 新增 Client→Server 消息 `leave_room`（非破坏性扩展，旧消息契约全保留）。
  - `renderer.js` 特效/粒子/飘字渲染坐标系改由 `mySlot` 驱动（`self` 与 `opponent` 隔离），不再硬编码 `slot === 0`。
  - `#peek-zone` 与 `#stage` 指针事件合并为 `stage` 坐标统一判定，且 `express-banner` 改为居中排版以兼容 `?netdebug=1` 浮层。
- **已失效的旧证据与建议复测范围**：
  - Round 1 中 `docs/review/evidence/round-1/02-combat-active.png`（旧热区位移与右下角浮卡逻辑）、`03-peek-opponent.png`（旧全局 `+$30 Eco` 叠层视角）及 `07-express-incoming-truck.png`（旧左偏快递横幅与单车渲染）已被 Round 2 对应新证据替代。
  - **建议复测范围**：Round 2 请 Tester 重点在双独立 Edge 上下文中实机验证 `AC-01`–`AC-03`、`AC-07`（双端快递与假动作各自视角）、`AC-08`、`AC-09`（无截图干扰连续 5s `DPR=2` 稳态 FPS）、`AC-10`（含 F5 重连）及 `AC-14`（音频状态与静音持久化）。
