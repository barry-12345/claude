# Builder 交付报告 — Round 1（Candy TD Battle V2.1）

## 0. 快速索引
- **候选版本**：`v2.1-candy-td-battle` @ 待提交（将在本报告落盘后执行规范 `git commit`，commit hash 以消息板回传为准；基点 `46f605fd4ca03907d4e0ada2be5abaeeec10d54a`）
- **本轮相对基线变化**：严格按 [docs/SPEC.md](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/docs/SPEC.md) 完成 V2.1 专项 Bug 修复与全链路性能优化（零新增第三方依赖，V2 玩法与数值零漂移）：
  - Bug 1：[public/index.html](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/index.html)、[public/js/ui.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/ui.js)
  - Bug 2 传输层与重连：[server/index.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/server/index.js)、[server/room-manager.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/server/room-manager.js)、[public/js/net-client.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/net-client.js)、[public/js/main.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/main.js)
  - Bug 2 渲染与音效：[public/js/renderer.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/renderer.js)、[public/js/audio.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/audio.js)
  - Bug 2 仿真热路径与钩子：[server/simulation.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/server/simulation.js)
  - 自动化与浏览器脚本：[tests/sim-unit.test.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/tests/sim-unit.test.js)、[tests/ws-protocol.test.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/tests/ws-protocol.test.js)、[tests/v2.1-browser-verify.mjs](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/tests/v2.1-browser-verify.mjs)
- **启动方式与 Reviewer/Tester 复用脚本**：
  - 正常生产入口：`cd "G:\我的云端硬盘\游戏\candy-td-battle"` 后运行 `$env:PORT=4500; npm start`，访问 `http://127.0.0.1:4500/`
  - 受控测试入口：`$env:PORT=4500; npm run start:test`，访问 `http://127.0.0.1:4500/?test=1&netdebug=1`
  - **可复用浏览器验证脚本**：[tests/v2.1-browser-verify.mjs](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/tests/v2.1-browser-verify.mjs)（基于原生 Node + `ws` + 本机 Edge CDP，无需第三方浏览器依赖）：
    - 用法：`node tests/v2.1-browser-verify.mjs --port <起始端口，占用 port 与 port+1> --out <证据输出目录>`
    - 示例（Tester 端口段 `4500–4599`）：`node tests/v2.1-browser-verify.mjs --port 4505 --out docs/review/v2.1/evidence/tester-r1`
    - 可选参数：`--edge <msedge.exe 路径>`（默认 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）
  - 清理方式：正常 `Ctrl+C` 停止自启 Node 进程即可；脚本内置 `finally` 自动关闭 Edge 与测试服务器，严禁使用 `pkill` / `killall`。
- **自测命令与证据索引**：
  - 单测与协议回归：`npm test`（**20/20 通过**）
  - 浏览器交互与压测实操：`node tests/v2.1-browser-verify.mjs --port 3105 --out docs/review/v2.1/evidence/round-1`（全绿，`consoleErrors: []`，`pageErrors: []`）
  - 证据目录：[docs/review/v2.1/evidence/round-1/](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/docs/review/v2.1/evidence/round-1/)（`metrics.json` 及 7 张关键 PNG 截图）
- **环境未验证缺口**：
  - **真实公网云主机带宽环境**：本机为环回 `127.0.0.1` 链路，公网弱网与跨区反代场景通过 `perMessageDeflate` 压缩字节统计（`-95.8%`）及 `bufferedAmount = 128KB > 64KB` 背压注入验证替代，真实云主机实玩待上线后抽检。
  - **Mac 真机 Retina 体感**：本机为 Windows 11 + Edge Headless，通过 CDP `Emulation.setDeviceMetricsOverride({ width: 1280, height: 720, deviceScaleFactor: 2 })` 仿真验证 `DPR=2` 渲染性能。
  - **物理扬声器听音**：无头环境未接物理扬声器，通过 `CandyAudio.eventLog` 与 65ms 节流单测覆盖验证。

---

## 1. 实现概述与接口说明

1. **Bug 1 修复 — Lv3 双分支浮卡零 DOM 重建与 HUD 脏检查（[index.html](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/index.html), [ui.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/ui.js)）**：
   - 将 `#tp-branch-a` / `#tp-branch-b` 内部子结构固化为静态 `<span>`（`#tp-branch-{a,b}-{name,cost,desc}`），在 `CandyUI._cacheElements()` 中统一缓存高频 HUD 与浮卡 DOM 引用，彻底移除 20Hz 快照路径中的 `innerHTML` 覆写与高频 `getElementById`。
   - 拆分 `_renderTowerPopover(tower)` 为结构更新（仅当 `popoverKey = ${tower.id}:${tower.type}:${tower.level}:${tower.branch || ''}` 变化时写入标题、数值、分支文案与定位）与轻量状态更新（按脏检查仅在变化时更新 `disabled`、索敌 `.active`、出售退费）。
   - `updateSnapshot(snap)` 引入 `this._hudCache`，仅当 `hp/gold/eco/wave/nextSec/alerts/cooldowns` 实际变化时才写 DOM。

2. **Bug 2 修复 — WS 传输瘦身、背压保护与断线反馈（[server/index.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/server/index.js), [room-manager.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/server/room-manager.js), [net-client.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/net-client.js), [main.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/main.js)）**：
   - `WebSocketServer` 开启 `perMessageDeflate: { threshold: 1024 }`。
   - 新增客户端消息 `{ type: 'set_view_mode', mode: 'self' | 'opponent' }`：`main.js` 切换视角时同步发送至服务端；`'self'` 视角常规周期帧（非 `tick % 10 === 0` 且非玩家行动即时回包）跳过序列化 `opponent.creeps/projectiles/lavaZones` 并标记 `opponentLite: true`，客户端 `renderer.pushSnapshot` 保留上一帧对手动态实体；切至 `'opponent'` 立即推送全量快照并恢复 20Hz 全量同步。
   - 11 类战斗视觉/音效事件按 `watchedSlot` 过滤，同 tick 同玩家非柠檬 `tower_shot` 按 `towerType` 去重为最多 1 条，单 tick 非关键战斗事件硬上限 `24` 条，关键事件永不丢弃。
   - 周期广播前检查 `ws.bufferedAmount > 65536`（64KB），超限跳过周期快照与非关键战斗事件并累计 `player.skippedSnapshots`（经快照与 `pong` 同步至 `?netdebug=1`）；`room_state`、`action_error`、`test_command_result`、`match_ended` 及 `_handleGameplayAction` 玩家操作回包绝不跳过。
   - `main.js` 实现指数退避自动重连循环（`600ms → 1200ms → 2400ms → 4000ms`），`sendGameplayAction` 覆盖建塔/升级/卖塔/改索敌/拆迁/派怪，离线时立即弹 Toast（1.5s 防刷屏）并触发重连。

3. **Bug 2 修复 — 前端渲染与音效节流（[renderer.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/renderer.js), [audio.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/audio.js)）**：
   - `lasers` 上限 `32`、`splashRings` 上限 `40`（超限淘汰最旧）；`pushSnapshot` 缓存 `_selfClearedSet`/`_oppClearedSet`；复用单一 `_prevCreepMap`。
   - 预烘焙 1–16 层护盾角标精灵（向量菱盾 + 纯数字）替代每帧 Emoji `🛡` 光栅化；移除飘字每帧 `ctx.strokeText`（改用高对比双层 `fillText`）；精简岩浆/弹道/激光/溅射环热循环内 `ctx.save/restore`。
   - `CandyAudio.play()` 对 `pop/frost/boom/laser/shield_hit/heal_pulse` 增加 `65ms` 同类冷却节流。

4. **Bug 2 修复 — 后端仿真热路径与可观测钩子（[simulation.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/server/simulation.js), [ui.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/ui.js), [main.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/main.js)）**：
   - `_stepProjectiles` 构建单帧 `creepById` `Map` 实现 $O(1)$ 查找；热循环改用平方距离替代 `Math.hypot`，保持 V2 数值 100% 精确等价。
   - 双重门控 `spawnStress({ towers, creeps, bothSides, oppTowers, oppCreeps })` 支持双边铺设 Lv3 分支塔与大量怪；`?netdebug=1` 面板追加展示 `WS KB/s` 与 `SkipSnap`，并在 `__CANDY_TEST__.getViewState()` 暴露相应指标。

---

## 2. 验收项逐条自测结果

| 编号 | 验证方式 | 实测结果与关键数字 | 原始证据路径 |
| --- | --- | --- | --- |
| **AC-01** | Edge Headless `?test=1` 慢速点击实测 | 4 塔 × A/B 共 8 个分支在 20Hz 快照下对其 `.bc-desc` 文字中心执行 `mousedown → 125ms → mouseup`，**8/8 全部 `sameNodeAfter125msHold: true` 且 100% 升级 Lv3** | [v2.1-browser-verify.mjs](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/tests/v2.1-browser-verify.mjs), [metrics.json](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/docs/review/v2.1/evidence/round-1/metrics.json), `ac01-lv2-branch-popover.png`, `ac01-lv3-upgraded.png` |
| **AC-02** | Edge Headless `?netdebug=1&test=1` (`1280×720, DPR=2`) W20 双边高压 | 25 Lv3 塔+80 怪 vs 14 塔+60 怪采样 5s：`avgFps: 58.6`（`≥55`）、`avgRenderMs: 1.22`（`max: 2.30 ≤ 8ms`）、`maxServerTickMs: 0.39`（`≤8ms`）；期间连续点击 3 空地建塔 **3/3 成功**（延迟 `72/50/50 ms`）；`netdebug` 正常显示 `WS KB/s: 431.9`（客户端解压缩后接收速率）与 `SkipSnap: 0`；Console 0 报错 | [metrics.json](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/docs/review/v2.1/evidence/round-1/metrics.json), `ac02-w20-stress-netdebug-dpr2.png` |
| **AC-03** | `ws-protocol.test.js` 带宽与背压集成测 | 1) W20 1s 下行线速从 V2 基线 `1,018,505 B` 降至 `42,722 B`（**降幅 95.8% ≥ 60%**）；2) 注入 `bufferedAmount = 131,072 B`（128KB > 64KB）后 320ms 内周期快照跳过 `0` 帧（`skippedSnapshots ≥ 3`），期间发送 `place_tower` 仍在 `≤ 300ms` 内立即回传新快照成功建塔 | [ws-protocol.test.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/tests/ws-protocol.test.js) |
| **AC-04** | `ws-protocol.test.js` + Edge Headless 断线/重连实测 | `NetClient.send()` 离线返回 `false`；浏览器 WS 意外断开后点击地图绿框立即弹出 Toast（`网络连接已断开，正在尝试自动重连...` 与 `连接已断开，正在自动重连，请稍候再试...`），恢复后退避重连自动恢复 `PLAYING` 并成功建塔 | [ws-protocol.test.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/tests/ws-protocol.test.js), `ac04-offline-toast.png`, `ac04-reconnected.png` |
| **AC-05** | Edge Headless 5s 采样 + `ws-protocol.test.js` | W20 高压采样上限：`maxLasers: 3`（`≤32`）、`maxSplashRings: 17`（`≤40`）、`maxParticles: 220`（`≤220`）、`maxFloatTexts: 19`（`≤60`）；6 类高频战斗音效 65ms 内同批 10 次触发均节流至 `1` 次，80ms 后恢复触发 | [metrics.json](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/docs/review/v2.1/evidence/round-1/metrics.json), [ws-protocol.test.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/tests/ws-protocol.test.js) |
| **AC-06** | `npm test` (`sim-unit.test.js`) | V2 既有全部数值/8 图 AI 断言 100% 通过；双边 25 Lv3 塔 + 80 怪连跑 200 ticks 实测 `avg=0.085ms`（`≤4ms`）、`p95=0.255ms`（`≤8ms`） | [sim-unit.test.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/tests/sim-unit.test.js) |
| **AC-07** | `npm test` (`ws-protocol.test.js` + `sim-unit.test.js`) | `set_view_mode: 'opponent'` 立即返回完整对手快照并 20Hz 同步，切回 `'self'` 恢复 `opponentLite: true`；全量 **20/20** 测试全绿（含反代、gzip、`Content-Length`、双门控、20s 重连） | [ws-protocol.test.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/tests/ws-protocol.test.js) |
| **AC-08** | Edge Headless 正常生产入口（无 `?test=1`） | `window.__CANDY_TEST__ === undefined`；选 `classic_s` 开单人 AI → 建草莓 → 升 Lv2 → 125ms 慢点击分支 A 文字中心成功转职 `草莓豆豆炮 Lv.3 · 🔥加特林` → `Space` 切对手视角看 AI → `Space` 回防操作；`consoleErrors: []`、`pageErrors: []` | [metrics.json](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/docs/review/v2.1/evidence/round-1/metrics.json), `ac08-opp-view.png`, `ac08-normal-entry.png` |
