# Builder 交付报告 — V2 Round 1（Court 2K：大满贯时代 / WP3 `@court2k/server`）

## 0. 快速索引
- **候选版本**：`feat/v2-wp3 @ ba43ec5820332a14c768988b0dadfa5c348c281b`（代码、测试与自测证据提交；基点 `beea3a61ab3fd25ca111dc6eab5987862481b18d`；含本报告的分支最新提交见调度员汇报）
- **本轮相对上轮变化**：首次 V2 交付。全面清除 V1 `InputPhase`/`phase` 与 `set_takeover`/`TAKEOVER_ON` 残留，对齐 `@court2k/shared` V2 `PlayerInputFrame`（`actionPressed: boolean`）与 `TestCommandPayload`（`spawn_incoming_ball`），实现服务端 60Hz 边沿帧防丢队列策略、空队列复用清零 `actionPressed = false`、`spawn_incoming_ball` 开关隔离与强校验，并更新/扩充 Vitest 集成测试（11/11 通过）与 V2 16 并发房间 60Hz 压测脚本。改动模块：`server/src/validation.ts`、`server/src/room.ts`、`server/scripts/stress-16rooms.ts`、`server/tests/server.integration.test.ts`。
- **启动方式与 Tester 前置条件**：
  - 工作目录：`C:\Users\Barry\.gemini\antigravity\brain\fdfcab71-4559-4883-b470-ad124349528d\scratch\wt-wp3\tennis-2k`
  - 构建命令：`npm run build -w @court2k/shared; npm run build -w @court2k/server`
  - 常规启动（PowerShell）：`$env:PORT='3301'; npm run start -w @court2k/server`
  - 子路径与受控测试启动（PowerShell）：`$env:PORT='3301'; $env:WS_PATH='/tennis/ws'; $env:ENABLE_TEST_HOOKS='1'; npm run start -w @court2k/server`
  - 测试账号 / 种子 / 样本：无外部账号依赖；测试态可通过 `TEST_COMMAND(set_seed)` 注入固定种子。
  - 受控测试钩子用法：仅当服务端环境变量 `ENABLE_TEST_HOOKS=1` 时受理 `TEST_COMMAND`（`set_seed`、`set_score`、`trigger_hawkeye`、`spawn_incoming_ball`、`fast_forward_pause`），未开启时一律返回 `ERROR(FORBIDDEN_TEST_HOOK)`。其中 `spawn_incoming_ball` 参数示例：`{ "type": "TEST_COMMAND", "payload": { "cmd": "spawn_incoming_ball", "args": { "targetX": 0.5, "targetZ": -8.5, "speedXZ": 20, "forPlayerIndex": 1 } } }`（`targetX` 夹至 `[-8, 8]`、`targetZ` 夹至 `[-16, 16]`、`speedXZ ∈ (0, 50]`、`forPlayerIndex ∈ {0, 1}`）。
  - 清理方式：`SIGINT` / `SIGTERM` 或按 PID 停止对应 Node 进程（`Stop-Process -Id <PID>`）。
- **自测命令与证据索引**：
  - 一键校验命令（PowerShell）：`npm run build -w @court2k/shared; npm run build -w @court2k/server; npm run typecheck -w @court2k/server; npm run test -w @court2k/server`（结果：`Test Files 1 passed (1)`、`Tests 11 passed (11)`，0 TS 错误）
  - 16 并发房间压测命令（PowerShell）：`$env:PORT='3301'; npm run stress -w @court2k/server`（结果：16 房间 `30.01s`、`1805` ticks / `~60.1 Hz`、平均 tick `0.819 ms`、Peak RSS `91.98 MB`）
  - 原始证据路径：
    - `docs/review/wp3/evidence/v2-round-1/build-typecheck-test.txt`
    - `docs/review/wp3/evidence/v2-round-1/stress-16rooms-30s.txt`
    - `docs/review/wp3/evidence/v2-round-1/static-scan.txt`
    - `docs/review/wp3/evidence/v2-round-1/workspace-and-runtime-check.txt`
- **环境未验证缺口**：
  - 本工作包为纯后端 WS 服务端（WP3），浏览器双独立会话 E2E 交互、客户端 `InputController` 采样与 Vite `/tennis/` 反代联调属于 WP2 与 `integration/v2` 阶段验收范围。

---

## 1. 实现概述与接口说明

1. **V2 协议校验与 V1 废弃项清理（`server/src/validation.ts`）**：
   - 移除 `InputPhase`、`VALID_PHASES` 与 `TEST_COMMAND(set_takeover)`。
   - `PLAYER_INPUT` 强制校验 `action ∈ {'none', 'J', 'K', 'L'}`、`typeof actionPressed === 'boolean'`、`seq` 非负整数、`moveX/moveZ/aimX/aimZ/clientTime` 为有限数（方向分量夹至 `[-1, 1]`），并显式拒绝携带旧版 `phase` 字段的帧（返回 `INVALID_MESSAGE`）。
   - 新增 `TEST_COMMAND(spawn_incoming_ball)` 强校验：`targetX`/`targetZ` 为有限数并分别夹至 `[-8, 8]` / `[-16, 16]`；可选 `speedXZ` 必须为有限数且满足 `0 < speedXZ <= 50`；可选 `forPlayerIndex` 必须为 `0 | 1`。
2. **60Hz 边沿输入消费与测试钩子执行（`server/src/room.ts`）**：
   - `IDLE_INPUT` 升级为 V2 结构（`action: 'none', actionPressed: false`），统一从 `@court2k/shared` 导入 `spawnIncomingTestBall` 等全部符号，无任何 `shared/src` 深路径导入。
   - `PLAYER_INPUT` 入队溢出（`queue.length >= 8`）时优先丢弃队列中最早的非边沿帧（`!f.actionPressed`），仅当队列全为边沿帧时才丢弃队首，保证快速短按在网络抖动下不丢失。
   - `consumeTickInput(idx)` 在队列为空复用 `lastInputs[idx]` 时强制构造 `{ ...prev, actionPressed: false }` 并写回 `lastInputs[idx]`，保留持续按住的 `action` 与移动/瞄准向量，严禁重复触发边沿。
   - `applyTestCommand('spawn_incoming_ball')`（受 `enableTestHooks` 门控保护，关闭时由 `RoomManager` / `Room` 返回 `FORBIDDEN_TEST_HOOK`）调用 `spawnIncomingTestBall(this.state, payload.args, this.rng)`，随即执行 `this.clearInputs()` 并立即广播 `STATE_SNAPSHOT`。
   - 在 `joinGuest` 补充复位 `state.pause.disconnected[1] = false` 与 `disconnectRemainingSec[1] = 15`，与 `waiting` 阶段槽位释放保持一致；完整保留 4 位防混淆房码、1v1 近端镜像输入 `toWorldInput`、手动暂停（3 次 / 60s / 3s 恢复倒计时）、15s 断线宽限与 `lastAckSeq[idx] = 0` 重连、`waiting` 态断线不弃权、`match_over` Rematch（重置比分、统计与 `[3, 3]` 暂停次数）及空闲房间回收。
3. **压测脚本与测试套件升级（`server/scripts/stress-16rooms.ts`、`server/tests/server.integration.test.ts`）**：
   - 将 `stress-16rooms.ts` 全部 `PLAYER_INPUT` 升级为 V2 `actionPressed` 协议。
   - `server.integration.test.ts` 扩充至 11 个用例：覆盖 `Room` 级队列溢出保边沿/空队列清边沿不变量、`spawn_incoming_ball` 开关隔离与参数校验、拒绝 V1 `phase` 与 `set_takeover`、1v1 镜像 + V2 自动触球 + 不按落空、手动暂停/4s 重连/15s 弃权/Rematch 闭环、`/health` 与 `/tennis/ws` 子路径及房间回收。

---

## 2. 验收项逐条自测结果（对应 SPEC 编号）

| SPEC 编号 | 验证方式 | 实测结果与关键数字 | 原始证据路径 |
| --- | --- | --- | --- |
| **AC-04（WP3 V1 清零）** | PowerShell `Select-String` 静态扫描 | `server/src` 与 `server/scripts` 对 `MeterState`/`InputPhase`/`takeover`/`set_takeover`/`shared/src` 等全部 **0 命中**（`server/tests` 仅在反向拒绝用例中包含字面量测试样本） | `docs/review/wp3/evidence/v2-round-1/static-scan.txt` |
| **V2 队列边沿铁律（`CONTRACT` §3.3）** | Vitest (`Room` 单元测试) | 10 帧突发入队（`#2` 为 `J + actionPressed:true`，其余 `false`）经 8 tick 消费后正确触发 `serve_toss`；全边沿溢出保留最新 8 帧；空队列复用连跑 5 tick 后 `holdDurationSec ≈ 5 * (1/60)s`（未重置） | `docs/review/wp3/evidence/v2-round-1/build-typecheck-test.txt` |
| **`spawn_incoming_ball` 与受控钩子** | Vitest 集成测试 | 未开 `ENABLE_TEST_HOOKS=1` 返回 `FORBIDDEN_TEST_HOOK`；开启后拒绝 `set_takeover` 与非法参数（`speedXZ=0/51`、`forPlayerIndex=2` 等）返回 `INVALID_MESSAGE`，合法调用夹紧范围并推送 `rally` 快照 | `docs/review/wp3/evidence/v2-round-1/build-typecheck-test.txt` |
| **AC-12（联机镜像/自动触球/暂停/Rematch）** | Vitest 集成测试 | 1v1 镜像位移对称；`spawn_incoming_ball` 下不按键 0 击球自然判分；按 `K + aimX=1` 触发 `SHOT_HIT(hitter:1, dropshot)` 且球速 `vel.x < 0`；3 次手动暂停/第 4 次 `PAUSE_LIMIT_REACHED`/60s 自动恢复/3s 倒计时/Rematch 重置 `[3,3]` 与统计全通过 | `docs/review/wp3/evidence/v2-round-1/build-typecheck-test.txt` |
| **AC-13（4s 重连 / 15s 弃权 / `waiting` 刷新）** | Vitest 集成测试 | 双断线重连重置 `lastAckSeq=[0,0]` 且旧后发 `seq=1` 正常受理；`waiting` 断线不弃权、`FULL_SYNC` 保持 `waiting` 与 `disconnected[0]=false`；15.1s 弃权下发唯一 `MATCH_OVER(forfeit)` 与最终 `STATE_SNAPSHOT` | `docs/review/wp3/evidence/v2-round-1/build-typecheck-test.txt` |
| **构建 / 类型 / 全量测试** | `build` + `typecheck` + `vitest run` | `shared` & `server` 构建通过，`typecheck` 0 错误，`1 passed (1)`、`11 passed (11)`（`Duration 13.76s`） | `docs/review/wp3/evidence/v2-round-1/build-typecheck-test.txt` |
| **AC-16（16 并发房 60Hz 压测）** | `npm run stress -w @court2k/server`（`PORT=3301`） | 16 房持续 `30.01s`，`1805` ticks（`~60.1 Hz`），平均 tick **`0.819 ms`**（`< 8 ms`），Max `7.060 ms`，Start RSS `80.23 MB`，Peak RSS **`91.98 MB`**（`≤ 256 MB`），收包 `29062` 条快照 | `docs/review/wp3/evidence/v2-round-1/stress-16rooms-30s.txt` |
| **AC-16 / AC-17（运行态与写边界）** | `node dist/index.js` + `git status` | `PORT=3301 WS_PATH=/tennis/ws` 实测 `/health` 与 `/tennis/health` 均返回 `200`（`rssMb: 57.1 / 57.3`），测试后已按 `PID=29116` 终止；改动严格限于 `tennis-2k/server/**` 与 `tennis-2k/docs/review/wp3/**` | `docs/review/wp3/evidence/v2-round-1/workspace-and-runtime-check.txt` |
