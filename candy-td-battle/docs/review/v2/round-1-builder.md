# Builder 交付报告 — Round 1（Candy TD Battle V2）

## 0. 快速索引
- **候选版本**：`v2-candy-td-battle` @ 待提交（将在本报告落盘后统一 `git commit`，commit hash 以回传为准）
- **本轮相对上轮变化**：首次 V2 交付 — 按 `docs/SPEC.md` 3 层顺序完整实现 V2 全部特性：
  - Layer 1：`public/js/shared/constants.js`、`server/simulation.js`、`tests/sim-unit.test.js`
  - Layer 2：`server/room-manager.js`、`server/ai-bot.js`、`tests/ws-protocol.test.js`
  - Layer 3：`public/index.html`、`public/css/style.css`、`public/js/{audio,renderer,input,ui,main}.js`、`README.md`
- **启动方式与 Tester 前置条件**：
  - 正常生产模式：`cd "G:\我的云端硬盘\游戏\candy-td-battle"` 后运行 `$env:PORT=4500; npm start`，访问 `http://127.0.0.1:4500/`（Tester 隔离端口段 `4500–4599`）。
  - 受控测试模式：`$env:PORT=4500; npm run start:test`，访问 `http://127.0.0.1:4500/?test=1`（需同时加 `?netdebug=1` 查看 FPS / Render(ms) / DPR / Entities）。
  - 测试账号 / 种子 / 样本：无需账号；仿真固定种子默认 `20261125`（测试钩子 `setSeed(seed)` 可切换，单测采用 `seed=42`）。
  - 受控测试钩子用法（仅 `CANDY_ALLOW_TEST_HOOKS=1` + `?test=1` 双重门控时挂载 `window.__CANDY_TEST__`，生产模式为 `undefined` 且服务端返回 `TEST_HOOKS_DISABLED`）：
    - `await window.__CANDY_TEST__.getSnapshot()` — 获取含 `mapId`、`clearedObstacles`、`lavaZones`、塔 `branch`/`buffTile`、怪护盾/冰冻/碎甲的完整快照
    - `await window.__CANDY_TEST__.setSeed(42)`
    - `await window.__CANDY_TEST__.grantResources({ target: 'self'|'opponent', gold?, eco?, hp? })`
    - `await window.__CANDY_TEST__.jumpWave(15)`
    - `await window.__CANDY_TEST__.spawnStress({ towers: 15, creeps: 45 })` — 铺设覆盖 8 种 Lv3 分支的 15 座塔 + 45 只自然/暗袭混合怪 + 2 处焦糖岩浆池
    - `await window.__CANDY_TEST__.fastForwardTicks(ticks)`
    - `await window.__CANDY_TEST__.simulateDisconnect('opponent', remainMs)`
    - `window.__CANDY_TEST__.getAudioState()`
    - `window.__CANDY_TEST__.getViewState()` — 返回 `{ viewMode, peekProgress, selectedBuildType, selectedTowerId, hoverOpponentTowerId, tooltipVisible, helpOpen }`
  - 清理方式：正常 `Ctrl+C` 停止自启 Node 进程即可；禁止使用 `pkill` / `killall`。
- **自测命令与证据索引**：
  - 一键测试命令：`npm test`（结果：**16/16 通过**）
  - 关键截图/日志路径：[`docs/review/v2/evidence/round-1/`](./evidence/round-1/)（`01-lobby-map-picker.png` ~ `09-express-2a-alert.png`、`metrics.json`）
- **环境未验证缺口**：
  - 真人扬声器物理听音未在本无头环境中验证（已通过 `CandyAudio` 事件日志 `getAudioState()` 与 `sessionStorage SecurityError` 降级单测覆盖 `AC-17`/`AC-18` 逻辑路径）。
  - 非 Mac Retina 真机，使用 Windows 11 本机 Edge Headless `deviceScaleFactor: 2` 仿真验证 `DPR=2` 渲染性能。

---

## 1. 实现概述与接口说明

1. **共享规格与 8 张地图（[constants.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/shared/constants.js)）**：
   - 重构 `MAP_DEFS`（8 张预计算路径/障碍字典）及 `getMapDef`、`isValidMapSelection`、`getObstacleAt`、`getBuffAt`、`isBuildableCell`、`getPositionAtProgress`、`getTowerLevelDef`。
   - 棋盘居中为 `GRID_X0 = 100`（`x ∈ [100, 1180]`），左右热区 `PEEK_LEFT_ZONE`（`[4..64, 180..540]`）与 `PEEK_RIGHT_ZONE`（`[1216..1276, 180..540]`）均保留 `36px` 安全隔离带，键盘切换防抖 `180ms`。
   - 初始金币调整为 `$190`；4 塔 Lv1/Lv2 与 8 种 Lv3 分支属性按 SPEC §3.3 精确配置；5 种自然怪（蛋糕王基础 HP `800`）与 5 种独立 ID 暗黑霓虹派怪（防卫赏金 `$0`）；平滑波次表 W1–W15 及温和加时 W16+（间隔 `20s→18s→16s`）；彻底删除 `express_feint` / `isFake`。
2. **权威仿真与 AI（[simulation.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/server/simulation.js)、[room-manager.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/server/room-manager.js)、[ai-bot.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/server/ai-bot.js)）**：
   - 实现 `$60` 障碍拆迁 `demolish_obstacle`（4 种增益格生效，卖塔保留）、`upgrade_tower` Lv2→Lv3 双分支校验（缺/错 `branch` 返回 `INVALID_BRANCH`）、次数盾先于扣血拦截、焦糖岩浆池穿盾 `50%` DoT、草莓 A/B、薄荷 Lv1 易伤 + A/B、爆米花 A/B、柠檬 A/B、奶妈 `135px` 群回血与铁王八重甲+6 盾+减抗；修复 `_stepProjectiles` 吞掉同帧生成分裂/弹跳弹道的问题。
   - `RoomManager` 支持 `create_room.mapId`、`select_map`（PvP `LOBBY` 房主专用）与随机模式开局/再来一局重抽。
   - `CandyAIBot` 废除硬编码点位，改为全图路径覆盖率与增益格动态评分选点，支持 `$190` 开荒、拆迁、分支选择与 5 种暗袭部队反制。
3. **前端渲染、锁定视角、1B/2A 与 Tooltip/图鉴（[renderer.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/renderer.js)、[input.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/input.js)、[ui.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/ui.js)、[audio.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/audio.js)、[main.js](file:///G:/%E6%88%91%E7%9A%84%E4%BA%91%E7%AB%AF%E7%A1%AC%E7%9B%98/%E6%B8%B8%E6%88%8F/candy-td-battle/public/js/main.js)）**：
   - `1B`：未拆障碍物精灵右下角直接渲染增益徽章（🎯/⚡/🔥/💰），拆迁浮卡明牌展示解锁增益名称与数值。
   - `2A`：`R`/`T` 3 秒预警横幅与入口快递车同步显示 `💚 暗黑奶妈车` / `🛡️ 终极铁王八` 图标与倒计时。
   - 对称双侧锁定视角切换（方案 A）：右进锁定、对手塔悬停只读面板+淡紫射程圈、棋盘零误建、左回/`Space`/`Esc`/`1-4` 回防。
   - 底栏 9 张卡统一复用不遮挡按钮的 `#action-tooltip`；顶部 `❓` 改造为 3 Tab 简洁图鉴；保留 V1.1 全部稳定性与降级修复。

---

## 2. 验收项逐条自测结果（对应 SPEC 编号）

| SPEC 编号 | 验证方式 | 实测结果与关键数字 | 原始证据路径 |
| --- | --- | --- | --- |
| **AC-01** | 浏览器实操（Edge 无 `?test=1`）+ 单测 | 选 `rainbow_m` 开 AI 局，`$190` 建草莓+薄荷剩 `$10`，1B 明牌预览、Eco 发放、AI 正常建塔均通过，0 报错 | `01-lobby-map-picker.png`, `03-obstacle-1b-preview.png`, `05-self-right-hotzone.png`, `metrics.json` |
| **AC-02** | `ws-protocol.test.js` + 浏览器双端实操 | PvP 选图 `crown_peaks` 同步、`select_map` 权限校验、拆障碍独立、2A 快递同步、再来一局通过 | `ws-protocol.test.js`, `09-express-2a-alert.png` |
| **AC-03** | `sim-unit.test.js` + 浏览器 Lv3 分支浮卡 | 4 塔 Lv1/2、8 种 Lv3 分支机制、缺失 `branch` 报 `INVALID_BRANCH`、70% 退费（$210）全绿 | `tests/sim-unit.test.js`, `07-lv3-branch-popover.png` |
| **AC-04** | `sim-unit.test.js` + `ws-protocol.test.js` + grep + 截图 | 全仓 `public/server/README` 0 假动作残留；`express_feint` 报 `INVALID_SEND_TYPE`；5 暗袭怪 W10 缩放、`0` 赏金、护盾/免控/回血/重甲与 2A 图标预警全绿 | `tests/sim-unit.test.js`, `09-express-2a-alert.png` |
| **AC-05** | `sim-unit.test.js` | W2–W15 环比 EHP 均在 `[22.0%, 28.0%]`；W10 单 Boss、W15 双 Boss；W16+ `1.20^ot` 与 `440/400/360/320t` 精确 | `tests/sim-unit.test.js` |
| **AC-06** | `sim-unit.test.js` | 8 张 `MAP_DEFS` 几何不变量 100% 通过；AI 在全部 8 图 400 ticks 内均建 `>=2` 合法塔并涨 Eco | `tests/sim-unit.test.js` |
| **AC-07** | `sim-unit.test.js` + 浏览器截图 | 1B 角标/浮卡预览明确；`$60` 拆迁仅改己方；4 增益格精确生效（`1.2x`、`1.2x`、`1.15x`、`+$3` 自然/`$0` 暗袭）；卖塔后增益保留 | `tests/sim-unit.test.js`, `03-obstacle-1b-preview.png`, `07-lv3-branch-popover.png` |
| **AC-08** | 浏览器交互实操 + `getViewState()` | 右热区/`Space` 进入锁定 `opponent`；点击对手棋盘保持锁定且不建塔；悬停 AI 塔显示只读卡片与射程圈；左热区/`Space`/`Esc`/`1` 平滑回防 | `06-locked-opponent-hover.png`, `metrics.json` |
| **AC-09** | 浏览器交互实操 + 截图 | 底栏悬浮 `#action-tooltip` 准确且不遮挡按钮；`❓` 3 Tab 图鉴明确区分 5 自然与 5 暗袭怪，0 假动作字样 | `02-tooltip-hover.png`, `04-help-codex-creeps.png` |
| **AC-10** | 浏览器 `?test=1&netdebug=1` (`DPR=2`) | `spawnStress({ towers: 15, creeps: 45 })`（含 8 分支 + 2 岩浆池）：`FPS: 78~114`、`Render: 0.90 ms`、`DPR: 2`、0 外部 CDN 请求 | `08-stress-netdebug.png`, `metrics.json` |
| **AC-11** | `ws-protocol.test.js` | 断线 `PAUSED_RECONNECT`、带令牌重连无损恢复 `mapId`/`clearedObstacles`/`branch`/`buffTile`、超时判胜通过 | `tests/ws-protocol.test.js` |
| **AC-12** | `ws-protocol.test.js` | `/candy-td/*` 静态与 `/candy-td/ws` 子路径反代全通过 | `tests/ws-protocol.test.js` |
| **AC-13** | `ws-protocol.test.js` + 无 `?test=1` 浏览器核查 | 生产模式 `window.__CANDY_TEST__ === undefined`，服务端 `test_command` 返回 `TEST_HOOKS_DISABLED` | `tests/ws-protocol.test.js`, `metrics.json` |
| **AC-14** | `ws-protocol.test.js` | `INVALID_JSON`、`INVALID_MAP`、`NOT_HOST`、`INVALID_CELL`、`INVALID_SEND_TYPE`、`OBSTACLE_ALREADY_CLEARED`、`INVALID_BRANCH`、`MAX_LEVEL`、`COOLDOWN_ACTIVE`、`ROOM_FULL` 全绿 | `tests/ws-protocol.test.js` |
| **AC-15** | `ws-protocol.test.js` | Raw 与 Gzip 静态资源及 `/healthz` 均返回精确 `Content-Length` 且无 `chunked` | `tests/ws-protocol.test.js` |
| **AC-16** | `ws-protocol.test.js` | `NetClient` 并发 `connect()` 去重、超时/断连拒绝、重试恢复与过期 socket 隔离通过 | `tests/ws-protocol.test.js` |
| **AC-17** | `ws-protocol.test.js` + `index.html` 核查 | `CandyAudio` 在 `sessionStorage SecurityError` 下正常降级内存静音；`file://` 告警脚本完整保留 | `tests/ws-protocol.test.js`, `public/index.html` |
| **AC-18** | 浏览器 Console & 事件日志核查 | 全流程 `consoleErrors: []`、`pageErrors: []`；新增音效事件均映射至 `CandyAudio` | `metrics.json` |
