# Builder 交付报告 — Round 1（《糖果塔防对战》Candy TD Battle V1）

## 0. 快速索引
- **候选版本**：`v1-candy-td-battle @ d1d4417266b0c1ff357ed0f610f50197857f9130`（本报告提交为紧随其后的文档提交；最终分支 `HEAD` 以调度消息回传为准）
- **本轮相对上轮变化**：首次交付（从基点 `1521656d6060d50a94f2230db2586bbff82a4558` 完整实现全部模块：`server/*`、`public/*`、`tests/*`、`package.json`、`README.md`）
- **启动方式与 Tester 前置条件**：
  - 正常生产启动：`PORT=4500 npm start`（默认 `PORT=3000`，Tester 请使用 `4500–4599` 端口段；Reviewer 代码审如需起服务请使用 `4100–4199`）
  - 测试模式启动：`PORT=4501 npm run start:test`（注入 `CANDY_ALLOW_TEST_HOOKS=1`）
  - 测试账号 / 种子 / 样本：无需账号；默认单人/双人入口免登录；仿真固定种子示例 `seed=42`
  - 受控测试钩子用法（**双门控隔离**）：
    1. 服务端必须设置 `CANDY_ALLOW_TEST_HOOKS=1`（即 `npm run start:test`），否则任何 WS `test_command` 均被拒绝并返回 `TEST_HOOKS_DISABLED`。
    2. 浏览器 URL 必须携带 `?test=1` 才会挂载 `window.__CANDY_TEST__`；普通入口 `typeof window.__CANDY_TEST__ === 'undefined'`。
    3. 已实现接口：`getSnapshot()`, `setSeed(seed)`, `grantResources({ target, gold, eco, hp })`, `jumpWave(waveNum)`, `spawnStress({ towers, creeps })`, `fastForwardTicks(ticks)`, `simulateDisconnect(target, remainMs)` 及 `getAudioState()`。
    4. 性能诊断浮层：URL 附加 `?netdebug=1` 即可显示 `FPS / Render(ms) / RTT(ms) / ServerTick(ms) / DPR / Entities`。
  - 清理方式：记录启动的 Node / 浏览器 PID，结束时按 PID 单独终止，严禁使用 `pkill` / `killall`。
- **自测命令与证据索引**：
  - 一键测试命令：`npm test`（结果：`11/11` 通过，耗时 `886.055 ms`）
  - 关键截图/日志路径：
    - `docs/review/evidence/round-1/01-lobby-home.png`（首页大厅）
    - `docs/review/evidence/round-1/02-combat-active.png`（实战建塔升级气泡 + Eco 飘字）
    - `docs/review/evidence/round-1/03-peek-opponent.png`（防误触偷看对手视角与顶部紫框提示）
    - `docs/review/evidence/round-1/04-stress-netdebug.png`（`DPR=2` 下 15 塔 + 45 怪压测 `?netdebug=1` 读数）
    - `docs/review/evidence/round-1/05-overtime-wave16.png`（第 16 波糖果狂热加时赛）
    - `docs/review/evidence/round-1/06-outgoing-express-hud.png`（己方发出假动作冷却遮罩与顶部发出提示）
    - `docs/review/evidence/round-1/07-express-incoming-truck.png`（3s 快递预警粉车入场倒计时）
    - `docs/review/evidence/round-1/08-feint-unbox-bubble.png`（假动作开箱五彩纸屑与鬼脸气泡）
    - `docs/review/evidence/round-1/metrics.json`（Edge CDP 实测采集指标）
- **环境未验证缺口**：
  1. 本机为 Windows 环境，无真机 Mac Retina 硬件，已使用 Edge CDP `Emulation.setDeviceMetricsOverride({ width: 1280, height: 720, deviceScaleFactor: 2 })` 仿真验证 `DPR=2` 渲染性能。
  2. 无头浏览器无物理扬声器发声，Web Audio 节点调用、静音开关与 `sessionStorage` 持久化通过代码逻辑与 `AudioContext` 状态验证（真机听感需 Tester/用户交互确认）。

---

## 1. 实现概述与接口说明

1. **共享常量层（[`public/js/shared/constants.js`](../../public/js/shared/constants.js)）**：
   - 前后端共同导入同一 ES Module，锁定 `1280×720` 逻辑画布、`DPR ≤ 2`、18×9 棋盘（`127` 可建草地 + `31` 路径格 + `4` 甜品装饰障碍物，总路径长 `1748 px`）、右侧偷看热区 `[1204..1276, 180..540]`（与棋盘右沿 `1144` 保留 `60 px` 隔离带）。
   - 定义 4 座糖果塔 Lv1–Lv3、5 种糖果怪、6 项派怪/快递/假动作按钮、15 波自然波次表与第 16 波起狂暴加时缩放函数。

2. **服务端权威引擎与联机控制（[`server/`](../../server/)）**：
   - `simulation.js`：20Hz 固定步长确定性仿真（Mulberry32 PRNG），实现薄荷减速与 Lv3 `+15%` 易伤、焦糖爆米花群伤及 Lv3 二次弹跳、柠檬破甲 `1.6×/1.8×` 及 Lv3 穿透、`120 ticks` Eco 发薪、60 ticks 快递到达、马卡龙半血破壳提速。
   - **防泄密契约**：`getClientSnapshot(viewerSlot)` 与 `game_event` 在 `tick < arriveTick` 期间对防守方 `incomingAlerts` 仅保留 `{ id, arriveTick, totalTicks }`，彻底剥离 `isFake`、`sendType`、`fromSlot`。
   - `ai-bot.js`：休闲甜心（`casual`，决策间隔 `1.8s`，不用假动作）与狡黠狐狸（`clever`，决策间隔 `1.0s`，针对缺柠檬塔派硬糖并主动混用真假快递），全程走标准 `applyPlayerAction`。
   - `room-manager.js` & `index.js`：4 位剔除易混字符房间码、房主离房移交、3 秒倒计时、`PAUSED_RECONNECT` 20 秒断线重连宽限与超时裁决、再来一局清零重置；HTTP 静态服务拦截目录穿越并兼容 `/candy-td/` 反代子路径 HTTP 与 `/ws` 升级。

3. **前端高颜值渲染与交互（[`public/`](../../public/)）**：
   - `renderer.js`：三层离屏缓存（静态马卡龙地图底板、4 塔 × 3 级底座精灵图、220 粒子 + 60 飘字环形对象池），战斗零 `shadowBlur`，50ms 快照线性插值，260ms/200ms 三次方缓动推拉偷看镜头，4 处甜品装饰物与 5 种动态糖果怪、粉车快递与假动作开箱气泡。
   - `input.js` & `ui.js`：支持纯鼠标 + `1–4` / `Q/W/E/R/T/F` / `Space` 快捷操作；偷看状态严格屏蔽地图建塔/选塔点击；`sessionStorage` 隔离会话令牌与静音偏好。
   - `audio.js`：原生 Web Audio API 合成 11 种清脆糖果音效，首次交互解锁，右上角一键静音。

---

## 2. 验收项逐条自测结果

| SPEC 编号 | 验证方式 | 实测结果与关键数字 | 原始证据路径 |
| --- | --- | --- | --- |
| **AC-01** | Edge CDP 正常入口实操 + `ws-protocol.test.js` | 无 `?test=1` 启动 `casual` AI 局，建草莓+薄荷塔、升级 Lv2、派软糖并完成 6s Eco 发薪（`Eco +30/6s`），偷看 AI 布局后回防；0 Console 报错 | `docs/review/evidence/round-1/01-lobby-home.png`, `02-combat-active.png`, `03-peek-opponent.png` |
| **AC-02** | `ws-protocol.test.js` 自动化集成测试 | 双端 `pvp` 建房（4 位无易混字符房码）→ `?room=` 语义加入 → 准备倒计时 → 同步建塔/派怪 → 结算 → `rematch_request` 重置，通过 | `tests/ws-protocol.test.js` (`npm test` 11/11) |
| **AC-03** | Edge CDP 实操 + `input.js` 逻辑 | 鼠标移入 `[1204..1276, 180..540]` 进入偷看；`Space` 按住期间以 `$1000` 金币点击网格，`peekClickBlocked: true`（塔数与金币零变化） | `docs/review/evidence/round-1/03-peek-opponent.png`, `metrics.json` |
| **AC-04** | `sim-unit.test.js` + Edge CDP 实操 | 非法格/占格/缺钱均拦截；草莓 Lv1→Lv3 累计投入 `$295`，出售精确返还 `Math.round(295×0.7)=$207`；切换 `strong` 即时生效 | `tests/sim-unit.test.js`, `02-combat-active.png` |
| **AC-05** | `sim-unit.test.js` 固定种子仿真 | 薄荷 Lv1 降速 `35%`、Lv3 降速 `55%` 且他塔精确 `×1.15`；爆米花全额溅射且对硬甲 `×0.6`；柠檬对 `toffee` 精确造成 `104 / 189` 伤害并触发 Lv3 `50%` 穿透 | `tests/sim-unit.test.js` |
| **AC-06** | `sim-unit.test.js` + Edge CDP 实操 | 严格每 `120 ticks` 按当前 `eco`（`25 → 30`）发薪；击杀 4 只派来软糖共赚 `4×4=$16`（远低于 `$50` 派怪成本） | `tests/sim-unit.test.js`, `02-combat-active.png` |
| **AC-07** | `ws-protocol.test.js` + `sim-unit.test.js` + Edge CDP | 前 59 ticks WS 下发 `incomingAlerts` 零 `isFake`/`sendType` 字段；第 3 辆快递拦截返回 `EXPRESS_QUEUE_FULL`；假动作 `$65/+5 Eco/18s` 冷却且造成 `0` 伤害并展示彩带鬼脸气泡 | `tests/ws-protocol.test.js`, `06-outgoing-express-hud.png`, `07-express-incoming-truck.png`, `08-feint-unbox-bubble.png` |
| **AC-08** | `sim-unit.test.js` + Edge CDP (`?test=1`) | `jumpWave(15)` 刷出 `giant_cake`；`jumpWave(16)` 触发「糖果狂热加时赛」横幅与彩虹高血高速怪群 | `tests/sim-unit.test.js`, `05-overtime-wave16.png` |
| **AC-09** | Edge CDP (`DPR=2` + `?netdebug=1&test=1`) | `spawnStress({ towers: 15, creeps: 45 })` 实测 `FPS: 60`、`Render: 0.40 ms`、`RTT: 1 ms`、`ServerTick: 0.1 ms`、`DPR: 2`、`Entities: 36/4/62`；外部 CDN 请求数为 `0` | `docs/review/evidence/round-1/04-stress-netdebug.png`, `metrics.json` |
| **AC-10** | `ws-protocol.test.js` 自动化集成测试 | 断线即时切换 `PAUSED_RECONNECT`；携带 `reconnectToken` 重连无损恢复已建塔与状态；超时（250ms 测试窗口）自动判在线方胜出 | `tests/ws-protocol.test.js` |
| **AC-11** | `ws-protocol.test.js` 本地反代模拟 | 本地 HTTP+WS 代理转发 `/candy-td/*`：静态资源 `200 OK`，`ws://127.0.0.1:<port>/candy-td/ws` 握手与建房成功 | `tests/ws-protocol.test.js` |
| **AC-12** | `ws-protocol.test.js` + Edge CDP | 默认模式 `typeof window.__CANDY_TEST__ === 'undefined'`；生产服务端收到 `test_command` 返回 `TEST_HOOKS_DISABLED` | `tests/ws-protocol.test.js`, `metrics.json` |
| **AC-13** | `ws-protocol.test.js` | 畸形 JSON、不存在房间码、满房第 3 人加入、房主离房移交权限均平稳处理并返回明确 `action_error.code` | `tests/ws-protocol.test.js` |
| **AC-14** | Edge CDP + 代码检查 (`audio.js`) | `CandyAudio` 首次交互解锁 `AudioContext`，建塔/发薪/快递/假动作触发对应合成音节点，静音开关同步写入 `sessionStorage` | `public/js/audio.js`, `public/js/main.js` |
