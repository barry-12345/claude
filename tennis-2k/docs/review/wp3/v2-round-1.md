结论：FAIL
候选版本：feat/v2-wp3 @ dee6731fd8d7f23d7fd5766b843cc08eef7ed78b（代码提交 ba43ec5820332a14c768988b0dadfa5c348c281b，基点 beea3a61ab3fd25ca111dc6eab5987862481b18d）
本轮核验方式：代码审 + 静态扫描 + 独立构建/类型检查/Vitest 复跑 + 端口 4301 独立 16 并发房 60Hz 压测 + 端口 4302 独立反例探针脚本（纯后端 WS 服务，无需派 Tester）

达标项：
- [AC-04 / AC-17 版本、写边界与 V1 零残留] 核实 `git rev-parse HEAD === dee6731fd8d7f23d7fd5766b843cc08eef7ed78b`，`git diff beea3a6..HEAD --name-status` 仅含 `tennis-2k/server/**`（4 文件）与 `tennis-2k/docs/review/wp3/**`（5 文件），零修改根/包 `package.json` 或 `shared`/`client`/`docs`。独立静态扫描 `server/src` 与 `server/scripts` 对 `MeterState`/`InputPhase`/`takeover`/`set_takeover`/`shared/src`/`VALID_PHASES` 全部 **0 命中**。
- [CONTRACT §3.3 校验与 60Hz 边沿队列铁律] 审计 `server/src/validation.ts` 与 `server/src/room.ts` 并经端口 `4302` 独立探针复测：12 组非法 `PLAYER_INPUT`（`actionPressed` 非布尔、`phase: null`、非法 `action`、负/浮点 `seq`）与非法 `spawn_incoming_ball`（`speedXZ <= 0` 或 `> 50`、`forPlayerIndex` 非 `0|1`）全部返回 `INVALID_MESSAGE`；超界 `targetX/targetZ` 正确夹紧至 `[-8, 8]` / `[-16, 16]`；队列溢出（`>= 8`）优先丢弃非边沿帧并保留 `actionPressed === true` 边沿；空队列复用 `lastInputs` 强制清零 `actionPressed = false`，实时 WS 长按 260ms 后松手正确触发取消武装（`armedAction: 'none'`、`bufferRemainingSec: 0`）；`spawn_incoming_ball` 受 `ENABLE_TEST_HOOKS=1` 强隔离，执行后调用 `clearInputs()` 并广播 `STATE_SNAPSHOT`。
- [AC-12 / AC-13 联机镜像、暂停、活跃对局重连/15s 弃权、Rematch 与限流] 独立复跑 `npm run build -w @court2k/shared`、`npm run build -w @court2k/server`、`npm run typecheck -w @court2k/server`、`npm run test -w @court2k/server` 全部通过（0 TS 错误，`1 passed (1)`、`11 passed (11)`，耗时 `13.76s`）。双端镜像 `toWorldInput`、手动暂停（3 次上限/60s 超时/3s 倒计时/5Hz 快照）、活跃对局断线 4s 重连（重置 `lastAckSeq[idx] = 0`）与 15s 弃权唯一 `MATCH_OVER(forfeit)`、Rematch 重置 `[3, 3]` 与统计、空房 TTL 回收、120 msg/s 限流均代码审与测试通过。
- [AC-16 子路径与 16 并发房 60Hz 压测] 端口 `4302` 验证 `/health` 与 `/tennis/health` 均返回 `200`（`rssMb: 54.8 / 56.1`）且 `/tennis/ws` 升级正常；端口 `4301` 独立复跑 `npm run stress -w @court2k/server`：16 房持续 `30.00s`、`1796` ticks（`~59.9 Hz`），平均 tick **`1.471 ms`**（门槛 `< 8 ms`），Max `75.818 ms`，Start RSS `68.29 MB`、Peak RSS **`80.71 MB`**（门槛 `≤ 256 MB`），累计收包 `28,942` 条快照。

返工项（FAIL 时填写）：
【问题 1（必须）：未开赛 `waiting` 阶段客队 P1 刷新重连被服务端拒绝返回 `INVALID_TOKEN`，直接阻断 `AC-13` ③ / `E2E-04` ③】
- 现象与证据：
  - 代码位置：`tennis-2k/server/src/room.ts` 第 335–349 行（`handleDisconnect`）：当 `this.state.phase === 'waiting'` 且 `idx === 1` 时，代码立即执行 `this.sessionTokens[1] = null`（并重置 `archetypes[1]` 为 `'allcourt'`）。
  - 独立探针复现（端口 `4302`）：P0 `CREATE_ROOM`（房处于 `waiting`）→ P1 `JOIN_ROOM` 获得 `p1Token` → P1 断开连接（模拟页面刷新）→ 无其他玩家加入前 P1 使用 `p1Token` 发送 `RECONNECT` → 服务端返回 `{ type: "ERROR", payload: { code: "INVALID_TOKEN", message: "重连令牌无效" } }`，而非预期的 `FULL_SYNC(snapshot.phase === 'waiting')`。
  - 已有测试盲区：`server/tests/server.integration.test.ts` 第 1050–1056 行仅测了房主 P0 在 `waiting` 阶段重连，未覆盖客队 P1。
- 影响：直接违反 `SPEC.md` `AC-13` ③ 与 `CONTRACT.md` §7 `E2E-04` ③（明确要求“未开赛 `waiting` 房内 P1 刷新重连 → `waiting` 房刷新仍留在大厅等待视图”）。集成阶段 P1 在等待房刷新后会收到 `INVALID_TOKEN` 并被踢回初始大厅，无法触发 `FULL_SYNC(waiting)` 保持等待房。
- 修改方向：
  - 在 `server/src/room.ts` 的 `handleDisconnect` 中，`waiting` 阶段 `idx === 1` 断线时不要清空 `this.sessionTokens[1]`（也不必清空 `archetypes[1]`），仅将 `connected[1] = false`、`ready[1] = false` 并广播 `LOBBY_UPDATE`。
  - 由于 `canJoinGuest()` 仅判断 `!this.connected[1]`，且 `joinGuest()` 在新客队加入时会生成并覆写新的 `this.sessionTokens[1]` 与 `archetype`，因此保留 `sessionTokens[1]` 同时满足两个不变量：① 无新客队加入时，原 P1 刷新页面可通过 `RECONNECT` 正常收到 `FULL_SYNC(phase: 'waiting')` 并回到等待房（且 `connected[1]` 恢复 `true`）；② 若断线期间另一位新客队 P2 通过 `JOIN_ROOM` 占用槽位，则 `joinGuest()` 覆写 `sessionTokens[1]`，原 P1 旧令牌自动失效返回 `INVALID_TOKEN`，不会顶掉 P2。
  - 在 `server/tests/server.integration.test.ts` 补齐两项断言：① `waiting` 阶段 P1 断线重连成功收到 `FULL_SYNC(phase: 'waiting', playerIndex: 1, yourSide: -1)` 且 `LOBBY_UPDATE` 恢复 `connected: [true, true]`、保留原流派；② `waiting` 阶段 P1 断线后若 P2 抢先 `JOIN_ROOM` 成功，原 P1 再用旧 token `RECONNECT` 收到 `INVALID_TOKEN` 且不影响 P2。
- 下轮验收标准：
  - `waiting` 阶段 P1 断线后发送 `RECONNECT(roomCode, p1Token)` 返回 `FULL_SYNC`（`snapshot.phase === 'waiting'`、`playerIndex === 1`、`yourSide === -1`、`pause.disconnected[1] === false`、`lastAckSeq[1] === 0`），且 P0/P1 均收到 `LOBBY_UPDATE(connected: [true, true])`；
  - `waiting` 阶段 P1 断线后若 P2 加入房间，P2 正常收到 `ROOM_JOINED`，且原 P1 旧 token `RECONNECT` 返回 `ERROR(INVALID_TOKEN)`；
  - 全量 `build` / `typecheck` / `test` 0 错全绿且 16 房 60Hz 压测指标仍达标（平均 tick `< 8 ms`、Peak RSS `≤ 256 MB`）。

未验证项（非门槛 / 环境限制）：
- 本工作包仅覆盖纯 Node/WS 服务端（`@court2k/server`）；浏览器双独立会话 E2E、客户端 `InputController` 采样与 Vite `/tennis/` 静态+WS 反代联调将在 WP2 与 `integration/v2` 阶段验收。

给用户的摘要：WP3 服务端 V2 协议校验、60Hz 边沿防丢队列、空队列清边沿、`spawn_incoming_ball` 测试钩子及 16 房 60Hz 压测（平均 tick `1.471 ms`、Peak RSS `80.71 MB`）均已达标；但代码审与独立探针发现 1 项阻断性缺陷：未开赛 `waiting` 房内客队 P1 断线时会立即清空 `sessionTokens[1]`，导致 P1 刷新重连返回 `INVALID_TOKEN` 而非 `FULL_SYNC(waiting)`，将直接阻断 `AC-13`/`E2E-04` ③。本轮裁决 `FAIL`，退回 Builder 定点修复并补测试后复验。
Obsidian 一行摘要：FAIL / WP3 核心协议与压测达标（1.471ms, 80.71MB），但 waiting 房 P1 断线误清 sessionTokens[1] 导致刷新重连报 INVALID_TOKEN 阻断 E2E-04 ③ / Builder 修复 room.ts 并补 P1 waiting 重连与槽位被占保护测试后进入 V2 Round 2 复验
