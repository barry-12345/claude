结论：FAIL
候选版本：wp3/server @ 7a112d70ca04bed9f7e4f301a313d50e22762a51
本轮核验方式：代码审 + 独立复跑（`typecheck` / `build` / Vitest 集成测试 / `PORT=4301` 16 房 60Hz 压测）+ 生产构建 `node dist/index.js` 独立对抗探针（`PORT=4302` 安全与子路径隔离、`PORT=4303` 状态机/输入泄漏/弃权同步探针；纯后端服务按 `evaluator.md` 跳过界面 Tester）

达标项：
- [版本与写边界 / AC-16] `git rev-parse HEAD` 为 `7a112d70ca04bed9f7e4f301a313d50e22762a51`；`git diff 7aab824..HEAD --stat` 仅改 16 个文件，全部位于 `tennis-2k/server/**` 与 `tennis-2k/docs/review/wp3/**`，零触碰根 `package.json`/`package-lock.json`、`shared/**`、`client/**`、`SPEC/CONTRACT`、`main` 与 `gold-miner`；`server/src/*.ts` 100% 消费 `@court2k/shared` 顶层导出（0 深路径导入、0 分裂物理）。
- [类型校验 / 构建 / 集成测试] 独立复跑 `npm run typecheck --workspace=@court2k/server`、`npm run build --workspace=@court2k/server`、`npm test --workspace=@court2k/server` 全绿（`1 passed (1)`，`7 passed (7)`，耗时 `5.90s`）；测试断言真实覆盖状态与消息字段，无空断言或弱化门槛。
- [AC-15 16 并发房间 60Hz 压测与子路径兼容] 独立于端口 `4301` 实跑 `scripts/stress-16rooms.ts`：`16` 房持续 `30.01s`，总 tick `1803`（`~60.1 Hz`），平均 tick `0.647 ms`（门槛 `< 8.000 ms`），Max tick `5.999 ms`，Peak RSS `80.83 MB`（门槛 `≤ 256.00 MB`），累计收包 `29372` 条快照。独立生产实例 `PORT=4302`（`WS_PATH=/tennis/ws`）验证 `GET /health` 与 `GET /tennis/health` 均返回 `200`（`rssMb: 51.5`），`/tennis/ws` 升级正常，非法 WS 路径返回 `404`。
- [安全隔离 / 错误码 / 限流] 独立对抗探针在 `ENABLE_TEST_HOOKS=0` 下于入房前与入房后对全部 5 类 `TEST_COMMAND` 100% 返回 `FORBIDDEN_TEST_HOOK`；全部 10 项 `CONTRACT.md` `ErrorCode`（及全部 11 类 `ClientMessage` / 15 类 `ServerMessage`）均按契约实现；10 组畸形 JSON / 越界字段 / `__proto__` / 二进制帧均安全返回 `INVALID_MESSAGE`，`> 64 KB` 超大帧触发 WS `1009` 断开且服务保持 `200` 健康；`> 120 msg/s` 限流返回 `RATE_LIMITED`；4 位房间码排除 `0/O/1/I`。
- [暂停 / 重连核心路径] 并发 `PAUSE_REQUEST` 串行裁决（先到成功、后到 `INVALID_PHASE` 且不扣次数）、并发 `RESUME_REQUEST` 幂等不重置 3s 倒计时、手动暂停期断线保留原始 `pausedFromPhase` 且不退次数、重连清零 `lastAckSeq[idx]` + 下发 `FULL_SYNC(requireInputReset:true)`、双断线独立 15s 计时与双人重连后再恢复、Rematch 重置 `serverTick=0` / `lastAckSeq=[0,0]` / `manualPausesLeft=[3,3]` 及空闲房间 TTL 回收均验证通过。

返工项（FAIL 时填写）：

【问题 1（必须）：得分结束 / 鹰眼 / 发球失误切换回 `serve_ready` 未清空服务端残留输入，触发幽灵自动抛球与 `VERY_LATE` 失误】
- 现象与证据：代码审 `server/src/room.ts`（`L435–442`、`L644–658`、`L670–762`）发现 `PLAYER_INPUT` 在 `point_over` / `hawkeye` 阶段被直接丢弃，但 `stepTick` 在进入 `point_over` / `hawkeye` 或切换至 `serve_ready` 时**从未调用 `this.clearInputs()`**，导致上一回合残留的 `lastInputs[idx]`（及 `inputQueues[idx]`）在下一分 `serve_ready` 首 tick 被 `consumeTickInput()` 自动重放。独立对抗探针（`PORT=4303` `probeB1_staleInputLeak`）实测复现：P0 在 `rally` 按住 `J`（`phase:'hold'`），回合结束后于 `point_over` 内松手发送 `release` 与 `idle`，此后不再按任何键；进入 `serve_ready` 后服务端立即观测到 `phasesSeen: ["point_over", "serve_ready", "serve_toss", "rally"]`，`ghostServeTossTriggered: true`，并自动击出 1 记 `SHOT_HIT(quality: "VERY_LATE")` 幽灵发球失误。
- 影响：真实 1v1 对战中，凡发球方在回合终结瞬间正按住 `J`/`K`（且在 `point_over` 或鹰眼特写结束 `resetAndRebind()` 期间松手），下一分将无需任何按键就被迫自动抛球并 100% 触发红区发球失误（一发直接丢掉，或二发直接双误），严重破坏 `AC-10` 与 `AC-07`（鹰眼结束后正常续打）核心体验。
- 修改方向：在 `Room.stepTick` 中，每当发生阶段切换进入 `point_over`、`hawkeye`、`match_over` 或 `serve_ready`（含发球一发失误 / `NET_LET` 从 `rally` 直接回到 `serve_ready` 的情况）时调用 `this.clearInputs()`，彻底阻断上一回合的 `lastInputs` 与队列帧泄漏到下一分。
- 下轮验收标准：新增集成测试回归用例覆盖「`rally` 期间按住 `J` → `point_over` / `hawkeye` 期间松手发送 `release`/`idle` → 进入 `serve_ready` 后不发送新按键保持 ≥ 1.5s」，断言阶段稳定停留在 `serve_ready`，绝不进入 `serve_toss` 且 `SHOT_HIT` 计数为 `0`；独立复跑全套测试与对抗探针 100% 通过。

【问题 2（必须）：15 秒断线弃权刻意抑制最终 `STATE_SNAPSHOT`，导致在线端状态快照停留在 `paused_disconnect`】
- 现象与证据：代码审 `server/src/room.ts`（`L725–726`、`L746–748`）存在 `suppressSnapshotOnForfeit = true`，导致 15s 弃权触发 `MATCH_OVER(reason:'forfeit')` 时跳过了 `phaseChanged` 的 `broadcastSnapshot`，且因 `isActiveSimulation` 随即变为 `false`，服务端此后不再下发任何 `STATE_SNAPSHOT`。独立对抗探针（`PORT=4303` `probeB2_forfeitSnapshot`）实测确认：P1 断线快进 `15.1s` 后，P0 收到 `GAME_EVENT(MATCH_OVER, reason:'forfeit', forfeitedBy:1)` 且 `errorsAfterForfeit: 0`，但 `lastSnapshotPhaseAfterForfeit` 仍为 `"paused_disconnect"`，从未收到 `phase: "match_over"` 的 `STATE_SNAPSHOT`（与正常完赛时下发 `STATE_SNAPSHOT(phase:'match_over')` 的行为不一致）。
- 影响：违反 `CONTRACT.md` §3.3 `STATE_SNAPSHOT`「变更瞬时推送」约定（§3.4 强调的是「不再发 `ERROR`，杜绝双弹窗」，而非抑制 `STATE_SNAPSHOT`）。客户端若由 `STATE_SNAPSHOT` 驱动 HUD 或 `TestStateSnapshot.matchState`，弃权后在线方 `matchState.phase` 将永久卡在 `paused_disconnect`，有残留 15s 断线遮罩或导致 `E2E-03`（`AC-11`）状态断言失败的风险。
- 修改方向：移除 `suppressSnapshotOnForfeit` 抑制分支，在 `GAME_EVENT(MATCH_OVER, reason:'forfeit')` 之后正常随 `phaseChanged` 广播最终 `STATE_SNAPSHOT`（`phase: 'match_over'`、`score.winner` 已更新），同时继续保持 0 条 `ERROR` 输出。
- 下轮验收标准：集成测试在 `>15s` 弃权用例中同时断言：① 收到唯一 `GAME_EVENT(MATCH_OVER, reason:'forfeit', forfeitedBy)` 且 `ERROR` 数量为 `0`；② 在线方收到 `STATE_SNAPSHOT` 且其 `state.phase === 'match_over'`、`state.score.winner === 0`。

【问题 3（建议）：`JOIN_ROOM` 解绑时序与 `waiting` / `match_over` 重连状态一致性收口】
- 现象与证据：① `server/src/roomManager.ts:178` 在校验 `room.joinGuest` 之前先执行 `this.detachSocket(ws, nowMs)`，独立探针（`probeB3_selfJoin`）证实房主向自己房间发 `JOIN_ROOM` 会先把自己从槽位 0 踢出再以客场加入槽位 1（`lobbyConnected: [[false, true]]`），或向已满/已开赛房间发 `JOIN_ROOM` 失败时反被从原房间断开；② `server/src/room.ts:250–263` 在 `waiting` 阶段重连提前返回未调用 `applyReconnect`，探针（`probeB4_waitingReconnect`）证实下发的 `FULL_SYNC` 快照残留 `pause.disconnected: [true, false]`；③ `match_over` 阶段重连仅发 `FULL_SYNC`，未补发当前 `REMATCH_STATUS`（若对手已点再来一局，重连方看不到待确认状态）。
- 影响：属边缘操作与状态一致性细节，不影响常规主路径，但顺手修齐可杜绝整合联调中的偶发异常。
- 修改方向：① `JOIN_ROOM` 先校验目标房间可加入且该 socket 未绑定至目标房间，再解绑旧房间；② `waiting` 阶段 `verifyAndBindReconnect` 先调用 `applyReconnect` 更新状态再发 `FULL_SYNC`；③ `match_over` 重连时若任一方已请求 Rematch，向重连方补发一次 `REMATCH_STATUS`。
- 下轮验收标准：房主重复 `JOIN_ROOM` 自己房间或失败加入其他房间不破坏原房间连接；`waiting` 重连的 `FULL_SYNC` 快照中 `pause.disconnected[idx] === false`。

未验证项（非门槛 / 环境限制）：
- 本工作包为纯后端 WS 服务端（WP3），浏览器双端 3D 镜像渲染、客户端 `InputController.resetAndRebind()` 实机按键自愈与 Vite `/tennis/` 反代联合链路属于 WP2 与整合阶段（`E2E-01` ~ `E2E-04`），本轮不越界验证。

给用户的摘要：WP3 后端整体完成度很高，60Hz 权威仿真、16 房压测（平均 tick 0.647 ms、Peak RSS 80.83 MB）、子路径兼容、安全钩子隔离与绝大多数暂停/重连状态机均一次性通过独立复测。但独立对抗探针挖出 2 个影响真实联机体验的必须修复缺陷：回合结束/鹰眼返回 `serve_ready` 时未清服务端残留输入会导致下一分幽灵自动抛球并红区失误，以及 15 秒弃权时抑制了最终 `STATE_SNAPSHOT` 导致在线方快照停留在 `paused_disconnect`。已签发 FAIL 退回 WP3 Builder 定点修复并补回归测试，修完预计很快可过审。
Notion 一行摘要：FAIL（WP3 Round 1） / 16 房压测 0.647ms/80.8MB 与安全隔离达标，但发现回合切换残留输入致幽灵发球失误及弃权抑制最终快照 2 项必改缺陷 / 退回 WP3 Builder 定点修复并补回归测试后复验。
