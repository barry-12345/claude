# Builder 交付报告 — Round 2（Court 2K：大满贯时代 / WP3 `@court2k/server` 返工修复）

## 0. 快速索引
- **候选版本**：`wp3/server`（基于 Round 1 `7a112d70ca04bed9f7e4f301a313d50e22762a51`，本交付报告随 Round 2 提交落盘，提交哈希见调度员汇报）
- **本轮相对上轮变化**：修复 Round 1 评审报告（`docs/review/wp3/round-1.md`）全部 2 项必须修复缺陷及 1 项建议改进（阶段切入 `serve_ready` / `point_over` / `hawkeye` / `match_over` 清空服务端残留输入防幽灵发球、15s 弃权正常下发最终 `STATE_SNAPSHOT(phase:'match_over')`、`JOIN_ROOM` 预校验后解绑、以及 `waiting` / `match_over` 重连一致性收口），改动模块 `server/src/room.ts`、`server/src/roomManager.ts` 与 `server/tests/server.integration.test.ts`。
- **启动方式与 Tester 前置条件**：
  - 构建与启动命令（工作目录 `D:\court2k-work\wt-wp3\tennis-2k`）：
    - `npm run build --workspace=@court2k/server`
    - 常规生产启动：`$env:PORT='3301'; npm run start --workspace=@court2k/server`
    - 子路径模式：`$env:PORT='3301'; $env:WS_PATH='/tennis/ws'; npm run start --workspace=@court2k/server`
  - 测试账号 / 种子 / 样本：无外部账号依赖；测试态可通过 `TEST_COMMAND(set_seed)` 注入固定种子。
  - 受控测试钩子用法：仅当 `ENABLE_TEST_HOOKS=1` 时受理 `TEST_COMMAND`（`set_seed` / `set_score` / `set_takeover` / `trigger_hawkeye` / `fast_forward_pause`），默认关闭返回 `FORBIDDEN_TEST_HOOK`。
  - 清理方式：`SIGINT` / `SIGTERM` 或按 PID 停止服务进程（`Stop-Process -Id <PID>`）。
- **自测命令与证据索引**：
  - 一键校验命令：`npm run typecheck --workspace=@court2k/server && npm run build --workspace=@court2k/server && npm test --workspace=@court2k/server`（结果：1 个测试文件、9/9 用例全通过）
  - 16 并发房间压测命令（PowerShell）：`$env:PORT='3301'; npm run stress --workspace=@court2k/server`（结果：16 房间持续 `30.01s`、`1803` ticks / `~60.1 Hz`、平均 tick `0.635 ms`、Peak RSS `93.11 MB`）
  - 原始证据路径：
    - `docs/review/wp3/evidence/round-2/build-typecheck-test.txt`
    - `docs/review/wp3/evidence/round-2/stress-16rooms-30s.txt`
    - `docs/review/wp3/evidence/round-2/workspace-and-runtime-check.txt`
- **环境未验证缺口**：
  - 本工作包为纯后端 WS 服务端（WP3），浏览器双端 3D 渲染、`InputController.resetAndRebind()` 实机按键与 Vite `/tennis/` 反代联调属 WP2 与整合阶段（`AC-01`、`AC-10`/`AC-11` 浏览器侧、`E2E-01`~`E2E-04`）。

---

## 1. 实现概述与接口说明（Round 2 定点修复）

1. **修复【问题 1（必须）】回合切换/鹰眼/发球失误返回 `serve_ready` 残留输入导致幽灵发球（`server/src/room.ts`）**：
   - 在 `Room.stepTick` 中，当 `nextState.phase !== prevPhase` 且新阶段为 `serve_ready`、`point_over`、`hawkeye` 或 `match_over` 时（涵盖常规得分、鹰眼特写、一发失误及发球 `NET_LET` 回到 `serve_ready` 的全部路径），立即调用 `this.clearInputs()` 清空 `inputQueues` 与 `lastInputs`，同时保留 `serve_ready -> serve_toss` 与 `serve_toss -> rally` 的正常蓄力衔接。
2. **修复【问题 2（必须）】15 秒断线弃权抑制最终 `STATE_SNAPSHOT`（`server/src/room.ts`）**：
   - 移除 `suppressSnapshotOnForfeit` 抑制分支，在 `GAME_EVENT(MATCH_OVER, reason:'forfeit', forfeitedBy)` 发出后正常随 `phaseChanged` 向在线端广播最终 `STATE_SNAPSHOT`（`phase: 'match_over'`、`score.winner` 已更新），同时保持 0 条 `ERROR` 输出。
3. **修复【问题 3（建议）】`JOIN_ROOM` 解绑时序与 `waiting` / `match_over` 重连状态一致性（`server/src/roomManager.ts`、`server/src/room.ts`）**：
   - 在 `Room` 新增 `canJoinGuest()`；`RoomManager.handleMessage('JOIN_ROOM')` 先校验 Socket 未绑定于目标房间（否则返回 `INVALID_PHASE`）且目标房间可加入，通过后再调用 `detachSocket`，杜绝房主自加或加房失败破坏原房间连接；
   - `Room.verifyAndBindReconnect` 在 `waiting` 分支先执行 `applyReconnect(this.state, idx)` 再发送 `FULL_SYNC`，确保快照中 `pause.disconnected[idx] === false`；
   - `match_over` 重连时若 `rematchRequested[0] || rematchRequested[1]`，在 `FULL_SYNC` 后向重连端补发当前 `REMATCH_STATUS`。

---

## 2. 验收项逐条自测结果（对应 SPEC 编号）

| SPEC 编号 | 验证方式 | 实测结果与关键数字 | 原始证据路径 |
| --- | --- | --- | --- |
| **回归 1（幽灵发球阻断）** | Vitest (`tests/server.integration.test.ts`) | `rally` 按住 `J` → `point_over` 内松手 → 进入 `serve_ready` 后保持 `1600 ms` 无按键：全快照保持 `serve_ready` 且 `SHOT_HIT` 计数为 `0` | `docs/review/wp3/evidence/round-2/build-typecheck-test.txt` |
| **回归 2（15s 弃权最终快照）** | Vitest (`tests/server.integration.test.ts`) | P1 断线快进 `15.1s`：收到唯一 `GAME_EVENT(MATCH_OVER, reason:'forfeit', forfeitedBy:1)`、`0` 条 `ERROR`，且收到 `STATE_SNAPSHOT(phase:'match_over', winner:0)` | `docs/review/wp3/evidence/round-2/build-typecheck-test.txt` |
| **回归 3（自加房与重连一致性）** | Vitest (`tests/server.integration.test.ts`) | 房主对己房发 `JOIN_ROOM` 返回 `INVALID_PHASE` 且原槽位 0 保持连接；`waiting` 重连 `FULL_SYNC.snapshot.pause.disconnected[0] === false`；`match_over` 重连补发 `REMATCH_STATUS` | `docs/review/wp3/evidence/round-2/build-typecheck-test.txt` |
| **全量集成测试 / 构建 / 类型** | `typecheck` + `build` + `vitest run` | `1 passed (1)`、`9 passed (9)`，0 TS 错误 | `docs/review/wp3/evidence/round-2/build-typecheck-test.txt` |
| **AC-15（16 并发房间压测）** | 实跑 `scripts/stress-16rooms.ts`（`PORT=3301`） | 16 房 `30.01s`、`1803` ticks（`~60.1 Hz`）、平均 tick `0.635 ms`（`< 8 ms`）、Max `4.446 ms`、Peak RSS `93.11 MB`（`≤ 256 MB`）、收包 `29230` 条快照 | `docs/review/wp3/evidence/round-2/stress-16rooms-30s.txt` |
| **AC-16 / 边界与生产启动** | `node dist/index.js` + `Select-String` + `git status` | `GET /health`（`rssMb: 51.7`）与 `/tennis/health`（`rssMb: 52.3`）均返回 `200`；0 深路径导入；仅改 `tennis-2k/server/**` 与 `tennis-2k/docs/review/wp3/**` | `docs/review/wp3/evidence/round-2/workspace-and-runtime-check.txt` |

---

## 3. 改动影响面与失效旧证据（返工轮必填）

- **修改的模块 / 文件**：
  - `tennis-2k/server/src/room.ts`（`canJoinGuest`、`verifyAndBindReconnect` 的 `waiting`/`match_over` 分支、`stepTick` 阶段切换清输入与移除 `suppressSnapshotOnForfeit`）
  - `tennis-2k/server/src/roomManager.ts`（`JOIN_ROOM` 预校验后再 `detachSocket`）
  - `tennis-2k/server/tests/server.integration.test.ts`（原有 7 项全部保留并增强弃权快照/Rematch 状态断言，新增 2 项回归用例共 9 项）
- **触及的公共状态 / 存档 / 权限 / 契约 / 邻近流程**：
  - 未修改任何 `CONTRACT.md` 类型、错误码或消息字段；
  - `stepTick` 阶段切换清输入同时作用于常规得分、鹰眼特写结束、一发失误与发球擦网重发（`NET_LET`）进入 `serve_ready` 的全部回合切换路径；
  - 15s 弃权下发最终 `STATE_SNAPSHOT` 影响 `paused_disconnect -> match_over` 瞬间的在线端快照同步，不增加任何 `ERROR` 消息；
  - `JOIN_ROOM` 预校验调整了多房间切换时先校验后解绑的执行顺序。
- **已失效的旧证据与建议复测范围**：
  - Round 1 证据（`docs/review/wp3/evidence/round-1/*`）因服务端源码与集成测试变更已全部作废，以 `docs/review/wp3/evidence/round-2/*` 为准；
  - 建议 Reviewer 复跑全量 `typecheck` / `build` / 9 项 Vitest 用例与 16 房压测，并针对「`rally` 按住 `J` → `point_over` / `hawkeye` 松手 → `serve_ready` 静止」与「15s 弃权 `STATE_SNAPSHOT(phase:'match_over')`」复测独立对抗探针。
