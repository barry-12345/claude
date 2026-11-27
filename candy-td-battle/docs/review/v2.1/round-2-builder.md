# Builder 交付报告 — Round 2（Candy TD Battle V2.1 局部返工修复）

## 0. 快速索引
- **候选版本**：`v2.1-candy-td-battle` @ 待提交（将在本报告落盘后执行规范 `git commit`，commit hash 以消息板回传为准；基于 Round 1 `3c10efcea566090821b04ade98f2b9e983d28c84`）
- **本轮相对上轮变化**：针对 [docs/review/v2.1/round-1.md](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/docs/review/v2.1/round-1.md) 全部 3 项返工（1 项必须 + 2 项建议）完成定点修复并补齐回归断言：
  - [server/room-manager.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/server/room-manager.js)
  - [public/js/main.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/main.js)
  - [public/js/ui.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/ui.js)
  - [tests/ws-protocol.test.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/tests/ws-protocol.test.js)
- **启动方式与 Reviewer/Tester 复用脚本**：
  - 正常生产入口：`cd "G:\我的云端硬盘\游戏\candy-td-battle"` 后运行 `$env:PORT=4500; npm start`，访问 `http://127.0.0.1:4500/`
  - 受控测试入口：`$env:PORT=4500; npm run start:test`，访问 `http://127.0.0.1:4500/?test=1&netdebug=1`
  - **可复用浏览器验证脚本**：[tests/v2.1-browser-verify.mjs](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/tests/v2.1-browser-verify.mjs)
    - 用法：`node tests/v2.1-browser-verify.mjs --port <起始端口，占用 port 与 port+1> --out <证据输出目录>`
    - Tester 示例：`node tests/v2.1-browser-verify.mjs --port 4505 --out docs/review/v2.1/evidence/round-2/tester`
  - 清理方式：正常 `Ctrl+C` 停止自启 Node 进程即可；脚本内置 `finally` 自动关闭 Edge 与测试服务器，严禁使用 `pkill` / `killall`。
- **自测命令与证据索引**：
  - 一键测试命令：`npm test`（结果：**20/20 通过**）
  - 浏览器交互与压测实操：`node tests/v2.1-browser-verify.mjs --port 3107 --out docs/review/v2.1/evidence/round-2`（全绿，`consoleErrors: []`，`pageErrors: []`）
  - 本轮证据目录：[docs/review/v2.1/evidence/round-2/](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/docs/review/v2.1/evidence/round-2/)（`metrics.json` 及 7 张 PNG 截图）
- **环境未验证缺口**：同 Round 1（真实公网 3–5 Mbps 云主机实玩、Mac 真机 Retina 体感、物理扬声器听音）。

---

## 1. 修复详情

1. **【问题 1（必须）】高背压下终局 `ENDED` 快照绝不跳过 + 客户端 `match_ended` 兜底渲染（[room-manager.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/server/room-manager.js), [ui.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/ui.js), [main.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/main.js), [ws-protocol.test.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/tests/ws-protocol.test.js)）**：
   - 服务端 `_tickAllRooms()` 改为 `{ isPeriodic: room.phase === 'PLAYING' }`，同时 `_sendSnapshotToPlayer()` 严格限定仅 `isPeriodic && room.phase === 'PLAYING'` 时才触发 `bufferedAmount > 65536` 背压跳过，确保 `ENDED` 终局快照与 `endedResult` 绝不因背压丢弃。
   - `CandyUI` 暴露带幂等脏检查的 `renderEndedResult(res)`；`main.js` 处理 `match_ended` 事件时同步兜底调用 `ui.renderEndedResult(ev.endedResult)`，杜绝无终局快照路径（含 `reconnect_timeout`）漏渲染结算卡片。
   - 在 `tests/ws-protocol.test.js` 的 `V2.1 AC-03 & AC-07` 用例中补充 `bufferedAmount = 131072`（128KB）高背压下 P0 漏怪战败终局回归断言，验证 `room_state(ENDED)`、`game_snapshot(ENDED)`（`endedResult.winnerSlot === 1`）与 `match_ended` 100% 全部送达。
2. **【问题 2（建议）】自动重连 `await net.connect()` 二次守卫与 `finally` 复位（[main.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/main.js)）**：
   - `scheduleReconnect()` 在 `await net.connect({ timeoutMs: 3500 })` 返回后先复查 `canAutoReconnect()` 再读取最新 `net.session` 发送 `join_room`（若已退回大厅或已结束则直接 `stopReconnectLoop()`）；使用 `try / catch / finally` 保证 `reconnectInFlight` 必定安全复位后再调度下一次退避。
3. **【问题 3（建议）】切入对手视角同步重置浮卡脏检查缓存（[ui.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/ui.js)）**：
   - 在 `setViewMode('opponent')` 清空选中态并隐藏浮卡时，同步调用 `this._resetPopoverCache()` 并将 `this._obsState` 重置为初始空态，消除隐藏态与缓存态的隐式耦合。

---

## 2. 验收项逐条自测结果

| 编号 | 验证方式 | 实测结果与关键数字 | 原始证据路径 |
| --- | --- | --- | --- |
| **问题 1（高背压终局送达）** | `ws-protocol.test.js`（128KB 背压 + 漏怪战败） | `bufferedAmount = 131,072 B` 下同时收到 `room_state(ENDED)`、`game_snapshot(ENDED, winnerSlot=1, reason='hp_zero')` 与 `match_ended` | [ws-protocol.test.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/tests/ws-protocol.test.js) |
| **问题 2 & 3（重连二次守卫 + 浮卡缓存重置）** | 代码核查 + 浏览器断线/切视角实操 | `await net.connect()` 后二次 `canAutoReconnect()` 守卫 + `finally` 复位生效；切视角回防选塔与断线重连 0 异常 | [main.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/main.js), [ui.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/ui.js) |
| **全量 `npm test` 回归** | `npm test` | **20/20 全部通过**（`AC-06` 200 ticks 双边重压 `avg=0.080ms, p95=0.224ms`；`AC-03` 1s 线速 `1,018,505B → 42,722B`，降幅 `95.8%`） | [sim-unit.test.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/tests/sim-unit.test.js), [ws-protocol.test.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/tests/ws-protocol.test.js) |
| **浏览器端到端（`AC-01/02/04/05/08`）** | Edge Headless (`port 3107/3108`) | `AC-01` 8/8 `sameNodeAfter125msHold: true`；`AC-02` `DPR=2` `avgFps=60, minFps=60, avgRenderMs=1.13ms, maxServerTickMs=0.33ms` 3 连建塔 `[71,51,49]ms`；`AC-04` 断线 Toast + 自动重连建塔；`AC-05` `lasers=3, splashRings=17, particles=220, floatTexts=18`；`AC-08` 正常入口全通、`consoleErrors: []`、`pageErrors: []` | [round-2/metrics.json](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/docs/review/v2.1/evidence/round-2/metrics.json), `ac02-w20-stress-netdebug-dpr2.png`, `ac08-normal-entry.png` |

---

## 3. 改动影响面与失效旧证据

- **修改的模块 / 文件**：
  - `server/room-manager.js`（仅调整 `_sendSnapshotToPlayer` 背压条件与 `_tickAllRooms` 终局 `isPeriodic` 标志）
  - `public/js/main.js`（仅调整 `scheduleReconnect` 异步二次校验/`finally` 复位与 `match_ended` 兜底渲染调用）
  - `public/js/ui.js`（仅新增 `renderEndedResult` 幂等入口与 `setViewMode('opponent')` 浮卡缓存重置）
  - `tests/ws-protocol.test.js`（仅在 `V2.1 AC-03 & AC-07` 用例末追加高背压 `ENDED` 终局送达断言，未放宽或改动既有断言）
- **触及的公共状态 / 邻近流程**：
  - 涉及对局终局广播路径（`PLAYING -> ENDED`）、`match_ended` 事件与 `#result-overlay` 渲染幂等性、以及断线重连定时器生命周期和视角切换时的浮卡缓存状态。
  - 未修改 `server/simulation.js`、`server/index.js`、`public/js/renderer.js`、`public/js/audio.js`、`public/js/net-client.js`、`public/index.html`、`package.json`。
- **已失效的旧证据与建议复测范围**：
  - Round 1 中 `docs/review/v2.1/evidence/round-1/` 与 `round-1.md` 记录的“高背压跳过终局快照”缺陷证据已由 Round 2 证据目录 `docs/review/v2.1/evidence/round-2/` 与 `tests/ws-protocol.test.js` 新增断言替代。
  - 建议 Round 2 Reviewer / Tester 重点复测：1) 高背压下终局 `ENDED` 快照与结算页正确性（含战败场景）；2) 断线后快速点“返回大厅”不触发幽灵重连；3) 由 Tester 按 `round-1.md` 执行完整浏览器交互验收（`AC-01` 多子区域慢点击、`AC-02`、`AC-04`、`AC-05`、`AC-07`、`AC-08`）。
