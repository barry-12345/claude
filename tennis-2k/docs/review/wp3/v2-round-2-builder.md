# Builder 交付报告 — V2 Round 2（Court 2K：大满贯时代 / WP3 `@court2k/server` 返工修复）

## 0. 快速索引
- **候选版本**：`feat/v2-wp3 @ f1dc19758dd04a041bceea424c9d39a60663a6cc`（代码、回归测试与 Round 2 证据提交；基于 Round 1 `dee6731fd8d7f23d7fd5766b843cc08eef7ed78b`；含本报告的最新提交见调度员汇报）
- **本轮相对上轮变化**：修复 Round 1 评审报告（`docs/review/wp3/v2-round-1.md`）唯一阻断缺陷——`waiting` 阶段客队 P1 断线时保留 `sessionTokens[1]` 与 `archetypes[1]`，支持 P1 刷新页面后持原 `sessionToken` 重连取得 `FULL_SYNC(phase: 'waiting')`，同时在 `joinGuest` 新客队入座时覆写生成新令牌使旧 P1 令牌自动失效返回 `INVALID_TOKEN`。改动模块：`server/src/room.ts`、`server/tests/server.integration.test.ts`。
- **启动方式与 Tester 前置条件**：
  - 工作目录：`C:\Users\Barry\.gemini\antigravity\brain\fdfcab71-4559-4883-b470-ad124349528d\scratch\wt-wp3\tennis-2k`
  - 构建命令：`npm run build -w @court2k/shared; npm run build -w @court2k/server`
  - 常规启动（PowerShell）：`$env:PORT='3301'; npm run start -w @court2k/server`
  - 子路径与受控测试启动（PowerShell）：`$env:PORT='3301'; $env:WS_PATH='/tennis/ws'; $env:ENABLE_TEST_HOOKS='1'; npm run start -w @court2k/server`
  - 测试账号 / 种子 / 样本：无外部账号依赖；测试态可通过 `TEST_COMMAND(set_seed)` 注入固定种子。
  - 受控测试钩子用法：仅当服务端环境变量 `ENABLE_TEST_HOOKS=1` 时受理 `TEST_COMMAND`（`set_seed`、`set_score`、`trigger_hawkeye`、`spawn_incoming_ball`、`fast_forward_pause`），默认关闭返回 `ERROR(FORBIDDEN_TEST_HOOK)`。
  - 清理方式：`SIGINT` / `SIGTERM` 或按 PID 停止对应 Node 进程（`Stop-Process -Id <PID>`）。
- **自测命令与证据索引**：
  - 一键校验命令（PowerShell）：`npm run build -w @court2k/shared; npm run build -w @court2k/server; npm run typecheck -w @court2k/server; npm run test -w @court2k/server`（结果：`Test Files 1 passed (1)`、`Tests 12 passed (12)`，0 TS 错误）
  - 16 并发房间压测命令（PowerShell）：`$env:PORT='3301'; npm run stress -w @court2k/server`（结果：16 房间 `30.00s`、`1803` ticks / `~60.1 Hz`、平均 tick `1.532 ms`、Peak RSS `96.97 MB`）
  - 原始证据路径：
    - `docs/review/wp3/evidence/v2-round-2/build-typecheck-test.txt`
    - `docs/review/wp3/evidence/v2-round-2/stress-16rooms-30s.txt`
    - `docs/review/wp3/evidence/v2-round-2/static-scan.txt`
    - `docs/review/wp3/evidence/v2-round-2/workspace-and-runtime-check.txt`
- **环境未验证缺口**：
  - 本工作包为纯后端 WS 服务端（WP3），浏览器双独立会话 E2E 交互、客户端 `InputController` 采样与 Vite `/tennis/` 反代联调属于 WP2 与 `integration/v2` 阶段验收范围。

---

## 1. 实现概述与接口说明

1. **修复【问题 1（必须）】`waiting` 阶段客队 P1 刷新重连返回 `INVALID_TOKEN`（`server/src/room.ts`）**：
   - 在 `Room.handleDisconnect(idx, ws, nowMs)` 的 `this.state.phase === 'waiting'` 分支中，移除原先 `if (idx === 1)` 清空 `this.sessionTokens[1] = null` 及重置 `archetypes[1]` 为 `'allcourt'` 的逻辑，保留 `sessionTokens[1]` 与已选流派，仅将 `connected[1]` 置为 `false`、`ready[1]` 置为 `false`、调用 `applyDisconnect(this.state, idx)` 并广播 `LOBBY_UPDATE`。
   - **双不变量闭环**：
     - **不变量 ①（P1 刷新重连 `AC-13` ③ / `E2E-04` ③）**：断线后无新客队入座时，`sessionTokens[1]` 保持有效，P1 发送 `RECONNECT(roomCode, p1Token)` 通过 `verifyAndBindReconnect` 恢复 `connected[1] = true`，收到 `FULL_SYNC`（`snapshot.phase === 'waiting'`、`playerIndex === 1`、`yourSide === -1`、`pause.disconnected[1] === false`、`lastAckSeq[1] === 0`、保留原流派），且双端收到 `LOBBY_UPDATE(connected: [true, true])`；
     - **不变量 ②（新客队 P2 抢占保护）**：`canJoinGuest()` 仅判断 `phase === 'waiting' && !this.connected[1]`，断线空出的客队槽位仍允许 P2 通过 `JOIN_ROOM` 入座；`joinGuest()` 会生成全新的 `this.sessionTokens[1]` 并更新 `archetypes[1]`，使原 P1 的旧令牌自动失效（后续旧令牌 `RECONNECT` 返回 `ERROR(INVALID_TOKEN)`，且绝不影响 P2）。
2. **补充自动化回归测试（`server/tests/server.integration.test.ts`）**：
   - 新增第 12 项用例 `allows guest P1 waiting reconnect via original token and invalidates old token once a new guest P2 claims the slot`（原有 11 项用例断言完全未修改、全部继续通过），完整验证上述两条不变量及 P0 + P2 正常 `READY` 开赛闭环。

---

## 2. 验收项逐条自测结果（对应 SPEC 编号）

| SPEC 编号 | 验证方式 | 实测结果与关键数字 | 原始证据路径 |
| --- | --- | --- | --- |
| **回归 1（`AC-13` ③ P1 `waiting` 重连）** | Vitest (`tests/server.integration.test.ts`) | P1(`power`) 在 `waiting` 断线后用原 `p1Token` 发送 `RECONNECT`：收到 `FULL_SYNC(phase:'waiting', playerIndex:1, yourSide:-1, disconnected[1]:false, lastAckSeq[1]:0, archetypes[1]:'power')`，P0/P1 均收 `LOBBY_UPDATE(connected:[true,true])` | `docs/review/wp3/evidence/v2-round-2/build-typecheck-test.txt` |
| **回归 2（`waiting` 槽位抢占旧令牌失效）** | Vitest (`tests/server.integration.test.ts`) | P1 断线后 P2(`serve_volley`) 执行 `JOIN_ROOM` 成功收 `ROOM_JOINED`；原 P1 持旧 `p1Token` 重连返回 `ERROR(INVALID_TOKEN)`；P0 与 P2 随后 `READY` 正常 `MATCH_START` | `docs/review/wp3/evidence/v2-round-2/build-typecheck-test.txt` |
| **构建 / 类型 / 全量测试** | `build` + `typecheck` + `vitest run` | `shared` & `server` 构建通过，`typecheck` 0 错误，`1 passed (1)`、`12 passed (12)`（`Duration 13.76s`） | `docs/review/wp3/evidence/v2-round-2/build-typecheck-test.txt` |
| **AC-04（V1 清零静态扫描）** | PowerShell `Select-String` | `server/src` 与 `server/scripts` 对 V1 废弃标识与 `shared/src` 全部 **0 命中** | `docs/review/wp3/evidence/v2-round-2/static-scan.txt` |
| **AC-16（16 并发房 60Hz 压测）** | `npm run stress -w @court2k/server`（`PORT=3301`） | 16 房持续 `30.00s`，`1803` ticks（`~60.1 Hz`），平均 tick **`1.532 ms`**（`< 8 ms`），Max `9.813 ms`，Peak RSS **`96.97 MB`**（`≤ 256 MB`），收包 `29072` 条快照 | `docs/review/wp3/evidence/v2-round-2/stress-16rooms-30s.txt` |
| **AC-16 / AC-17（运行态与写边界）** | `node dist/index.js` + `git status` | `PORT=3301 WS_PATH=/tennis/ws` 实测 `/health`（`rssMb: 53.5`）与 `/tennis/health`（`rssMb: 54.1`）均返回 `200`，测试后已按 `PID=38424` 终止；改动严格限于 `tennis-2k/server/**` 与 `tennis-2k/docs/review/wp3/**` | `docs/review/wp3/evidence/v2-round-2/workspace-and-runtime-check.txt` |

---

## 3. 改动影响面与失效旧证据（返工轮必填）

- **修改的模块 / 文件**：
  - `tennis-2k/server/src/room.ts`（仅修改 `Room.handleDisconnect` 中 `this.state.phase === 'waiting'` 分支，移除 `idx === 1` 时清空 `sessionTokens[1]` 与重置 `archetypes[1]` 的代码块）
  - `tennis-2k/server/tests/server.integration.test.ts`（未修改原有 11 项测试的断言，新增第 12 项回归用例）
  - `tennis-2k/docs/review/wp3/v2-round-1.md`（纳入评审记录）及 `tennis-2k/docs/review/wp3/evidence/v2-round-2/*`
- **触及的公共状态 / 存档 / 权限 / 契约 / 邻近流程**：
  - 未修改 `CONTRACT.md` 任何消息类型、错误码或数据结构；
  - 仅影响 `waiting` 阶段客队断线后的 `sessionTokens[1]` 与 `matchConfig.archetypes[1]` 生命周期：`canJoinGuest()` 仍允许新客队在 `!connected[1]` 时加入并覆盖新令牌，对局中（`serve_ready` / `serve_toss` / `rally` / `paused_*`）与 `match_over` 分支逻辑零改动；
  - `emptyRoomTtlMs`（双断连 60s 回收）与 `idleRoomTtlMs`（600s 回收）行为不变（原第 8 项回收测试继续通过）。
- **已失效的旧证据与建议复测范围**：
  - Round 1 证据（`docs/review/wp3/evidence/round-1/*` 与 `docs/review/wp3/evidence/v2-round-1/*`）因 `room.ts` 修复及测试扩充已作废，以 `docs/review/wp3/evidence/v2-round-2/*` 为准；
  - 建议 Reviewer 重点复测：`waiting` 阶段 P1 断线重连 `FULL_SYNC(waiting)`、`waiting` 阶段 P1 断线后 P2 抢先入座使旧 P1 token 返回 `INVALID_TOKEN`，并复跑全量 `build` / `typecheck` / 12 项 Vitest 与 16 房压测。
