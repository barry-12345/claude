结论：PASS
候选版本：feat/v2-wp3 @ 0601466c3a2c0fada509484140d82ed000b1cd6e（代码与证据提交 f1dc19758dd04a041bceea424c9d39a60663a6cc，基点 beea3a61ab3fd25ca111dc6eab5987862481b18d）
本轮核验方式：Round 2 全量回归（diff 代码审 + 独立 build/typecheck/12 项 Vitest 全量回归 + 端口 4302 独立反例探针 6 项复验 + 端口 4301 独立 16 并发房 60Hz 压测；纯后端 WS 服务，无需派 Tester）。复测范围理由：本次修复触及 `room.ts` `waiting` 阶段会话令牌与重连公共状态，按 `evaluator.md` 第 6 步执行全量回归。

达标项：
- [AC-13 ③ / E2E-04 ③ 返工项闭环验证] 代码审核实 `tennis-2k/server/src/room.ts` 在 `handleDisconnect` 的 `waiting` 分支移除了清空 `sessionTokens[1]` 与重置 `archetypes[1]` 的逻辑，保留 `connected[1] = false` / `ready[1] = false` 与 `LOBBY_UPDATE`。端口 `4302` 独立探针与新增第 12 项 Vitest 用例双证实：① `waiting` 阶段客队 P1 断线后持原 `p1Token` 发送 `RECONNECT` 成功收到 `FULL_SYNC`（`phase: 'waiting'`、`playerIndex: 1`、`yourSide: -1`、`disconnected[1]: false`、`lastAckSeq[1]: 0`、保留原流派 `defender`/`power`）且双端收到 `LOBBY_UPDATE(connected: [true, true])`；② P1 断线后若新客队 P2 抢先 `JOIN_ROOM` 入座，P2 正常获得新令牌并可与 P0 开赛，原 P1 持旧令牌 `RECONNECT` 返回 `ERROR(INVALID_TOKEN)` 且不影响 P2。
- [AC-04 / AC-17 版本、写边界与 V1 零残留] 核实 `git rev-parse HEAD === 0601466c3a2c0fada509484140d82ed000b1cd6e`，`git diff beea3a6..HEAD --name-status` 严格限定于 `tennis-2k/server/**` 与 `tennis-2k/docs/review/wp3/**`，零改动根/包 `package.json`、`shared`、`client` 或契约文档；`server/src` 与 `server/scripts` 对 V1 废弃字段与 `shared/src` 深路径 import 全部 0 命中。
- [CONTRACT §3.3 协议校验、60Hz 边沿队列与全量构建/测试] 独立复跑 `npm run build -w @court2k/shared`、`npm run build -w @court2k/server`、`npm run typecheck -w @court2k/server`、`npm run test -w @court2k/server` 全部通过（0 TS 错误，`Test Files 1 passed (1)`、`Tests 12 passed (12)`，原有 11 项测试断言零修改，耗时 `13.70s`）。端口 `4302` 独立探针 6/6 通过：`/health` 与 `/tennis/health` 均返回 `200`、12 组非法 `PLAYER_INPUT`/`spawn_incoming_ball` 边界入参全部返回 `INVALID_MESSAGE`、超界 `targetX/targetZ` 夹紧至 `[-8, 8]` / `[-16, 16]`、实时 WS 空队列复用清零 `actionPressed = false` 使长按 260ms 松手正确取消武装（`armedAction: 'none'`）。
- [AC-16 16 并发房 60Hz 压测] 端口 `4301` 独立复跑 `npm run stress -w @court2k/server`：16 并发房持续 `30.01s`、`1804` ticks（`~60.1 Hz`），平均 tick **`1.696 ms`**（门槛 `< 8 ms`）、Max `8.220 ms`，Start RSS `67.65 MB`、End RSS `78.71 MB`、Peak RSS **`79.91 MB`**（门槛 `≤ 256 MB`），累计接收快照 `29,054` 条。

未验证项（非门槛 / 环境限制）：
- 本工作包仅覆盖纯 Node/WS 服务端（`@court2k/server`）；浏览器双独立会话端到端交互、客户端 `InputController` 采样与 Vite `/tennis/` 反代联调将在 WP2 与 `integration/v2` 阶段验收。

给用户的摘要：WP3（`@court2k/server`）V2 Round 2 全量复验通过，裁决 `PASS`。上一轮发现的 `waiting` 房客队 P1 刷新重连返回 `INVALID_TOKEN` 缺陷已修复并双验证闭环（原 P1 可持原令牌恢复等待房，新客队 P2 抢占后旧令牌自动失效）；全量构建、类型检查、12/12 集成测试、6 项独立反例探针及 16 房 60Hz 压测（平均 tick `1.696 ms`、Peak RSS `79.91 MB`）全部达标，可放行合入整合阶段。
Obsidian 一行摘要：PASS / WP3 V2 Round 2 修复 waiting 房 P1 重连并全量回归达标（12/12 tests, 1.696ms avg tick, 79.91MB peak RSS） / 放行合入 V2 基线并进入 integration/v2 端到端联调
