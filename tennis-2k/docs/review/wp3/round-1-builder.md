# Builder 交付报告 — Round 1（Court 2K：大满贯时代 / WP3 `@court2k/server`）

## 0. 快速索引
- **候选版本**：`wp3/server`（基于基点 `7aab8240ef2f6412ce772a930c9c03f91d2389e4`，本报告随 Round 1 交付提交落盘，提交哈希见调度员汇报）
- **本轮相对上轮变化**：首次交付；完成 `@court2k/server`（`Node + TypeScript + ws` 60Hz 权威联机服务端）全部实现与自测，涉及 `server/package.json`、`server/tsconfig*.json`、`server/src/**`、`server/tests/**`、`server/scripts/stress-16rooms.ts`。
- **启动方式与 Tester 前置条件**：
  - 构建与启动命令（工作目录 `D:\court2k-work\wt-wp3\tennis-2k`）：
    - `npm run build --workspace=@court2k/server`
    - 常规生产启动：`PORT=3301 npm run start --workspace=@court2k/server`（PowerShell：`$env:PORT='3301'; npm run start --workspace=@court2k/server`）
    - 子路径模式示例：`$env:PORT='3301'; $env:WS_PATH='/tennis/ws'; npm run start --workspace=@court2k/server`
  - 测试账号 / 种子 / 样本：无外部账号依赖；房间种子由服务内 `PRNG` 生成，测试态可通过 `TEST_COMMAND(set_seed)` 注入固定种子（如 `42`）。
  - 受控测试钩子用法：
    - 仅当服务端设置环境变量 `ENABLE_TEST_HOOKS=1` 时受理 WS 消息 `TEST_COMMAND`（默认关闭，未开启时一律返回 `ERROR(FORBIDDEN_TEST_HOOK)`）：
      - `{ "type": "TEST_COMMAND", "payload": { "cmd": "set_seed", "args": { "seed": 42 } } }`
      - `{ "type": "TEST_COMMAND", "payload": { "cmd": "set_score", "args": { "games": [3, 3], "points": [0, 0], "isTiebreak": true } } }`
      - `{ "type": "TEST_COMMAND", "payload": { "cmd": "set_takeover", "args": { "playerIndex": 0, "value": 100 } } }`
      - `{ "type": "TEST_COMMAND", "payload": { "cmd": "trigger_hawkeye", "args": { "inBounds": true, "distCm": 8, "line": "sideline" } } }`
      - `{ "type": "TEST_COMMAND", "payload": { "cmd": "fast_forward_pause", "args": { "seconds": 60 } } }`
  - 清理方式：发送 `SIGINT` / `SIGTERM` 或通过启动返回的 PID 精准终止进程（`Stop-Process -Id <PID>`）。
- **自测命令与证据索引**：
  - 一键校验命令：`npm run typecheck --workspace=@court2k/server && npm run build --workspace=@court2k/server && npm test --workspace=@court2k/server`（结果：1 个测试文件、7/7 用例全通过）
  - 16 并发房间压测命令（PowerShell）：`$env:PORT='3301'; npm run stress --workspace=@court2k/server`（结果：16 房间 30.01s、1803 ticks / ~60.1 Hz、平均 tick `0.699 ms`、Peak RSS `95.24 MB`）
  - 原始证据路径：
    - `docs/review/wp3/evidence/round-1/build-typecheck-test.txt`
    - `docs/review/wp3/evidence/round-1/stress-16rooms-30s.txt`
    - `docs/review/wp3/evidence/round-1/workspace-and-runtime-check.txt`
- **环境未验证缺口**：
  - 本工作包为纯服务端（WP3），浏览器双端 3D 渲染联动、客户端 `InputController.resetAndRebind()` 实机按键与 Vite 代理集成属于 WP2 与整合阶段（`AC-01`、`AC-10`/`AC-11` 浏览器侧、`E2E-01`~`E2E-04`）。

---

## 1. 实现概述与接口说明

严格遵循 `docs/SPEC.md` 与 `docs/CONTRACT.md`，100% 复用 `@court2k/shared` 顶层导出（`0` 深路径引用）：
1. **HTTP / WS 路由与子路径兼容（`server/src/server.ts`、`server/src/config.ts`）**：
   - 支持 `PORT`（默认 `3301`）、`HOST`（默认 `0.0.0.0`）、`WS_PATH`（默认 `/ws`）、`ENABLE_TEST_HOOKS`（默认关闭，仅 `'1'` 开启）。
   - `GET /health` 及任意后缀 `/health`（如 `/tennis/health`）返回 `{ status: 'ok', rooms, uptimeSec, rssMb }`。
   - WS 升级兼容 `${WS_PATH}`、`/ws` 及任意前缀末尾 `/ws`（如 `/tennis/ws`），非 WS 路径返回 `404`。
2. **房间管理、60Hz 权威步进与空闲回收（`server/src/roomManager.ts`、`server/src/room.ts`）**：
   - 使用 `@court2k/shared` 的 `generateRoomCode` 生成 4 位去歧义码（排除 `0/O/1/I`），签发 48 位 hex `sessionToken`。
   - 单一共享 60Hz 固定步长循环（`COURT_DIM.FIXED_DT = 1/60`）调用 `stepMatch`；对战阶段 30Hz（每 2 tick）推送规范世界坐标 `STATE_SNAPSHOT`，暂停/恢复阶段 5Hz（每 12 tick）推送 + 状态变更瞬时推送，关键事件实时广播 `GAME_EVENT`。
   - 双方均断连的 `waiting`/`match_over` 房间超过 `60s` 自动回收；连续 `600s` 无消息的 `waiting`/`match_over` 房间自动关闭并回收。
3. **输入校验、镜像映射与限流（`server/src/validation.ts`、`server/src/rateLimiter.ts`）**：
   - `PLAYER_INPUT` 经严格字段与范围校验后调用 `toWorldInput(frame, side)` 映射至规范世界坐标，按 `lastAckSeq[idx]` 丢弃重复/乱序帧，并通过有界输入队列确保同 tick 内 `hold`/`release` 切换不丢失、恢复/开赛时清零防卡键。
   - 滑动 1s 窗口限流（`> 120 msg/s` 丢弃超额帧并返回 `ERROR(RATE_LIMITED)`）。
   - 完整实现 `CONTRACT.md` 全部 10 项 `ErrorCode`（`INVALID_MESSAGE`、`ROOM_NOT_FOUND`、`ROOM_FULL`、`INVALID_TOKEN`、`MATCH_ALREADY_STARTED`、`INVALID_PHASE`、`PAUSE_LIMIT_REACHED`、`CANNOT_RESUME_DISCONNECT`、`RATE_LIMITED`、`FORBIDDEN_TEST_HOOK`）。
4. **暂停、15s 断线重连、弃权与 Rematch 闭环（`server/src/room.ts`）**：
   - 手动暂停调用 `requestManualPause`/`requestManualResume`：每人最多 3 次、单次最长 60s 自动恢复、并发请求安全串行/幂等忽略、恢复前统一 3s `resuming` 倒计时并下发 `MATCH_RESUMED(requireInputReset: true)`。
   - 断线调用 `applyDisconnect`/`applyReconnect`：活跃/手动暂停/恢复期断线保留原始 `pausedFromPhase` 且不退还次数，广播 `MATCH_PAUSED(reason:'disconnect')` 与 `OPPONENT_DISCONNECTED(15s)`；15s 内携 `roomCode + sessionToken` 重连清零 `lastAckSeq[idx]` 并单播 `FULL_SYNC(requireInputReset: true)`，双方均在线后广播 `OPPONENT_RECONNECTED` + `MATCH_RESUMING('reconnect')`；双断线独立计时（同 tick 归零直接回收房间）；超 15s 唯一广播 `GAME_EVENT(MATCH_OVER, reason:'forfeit')`；`waiting`/`match_over` 阶段断线分别释放客场席位/重置 `rematchRequested`。
   - 完赛后双方确认 `REMATCH_REQUEST` 立即以同房间号重置开新局（`serverTick: 0`、`lastAckSeq: [0, 0]`、`manualPausesLeft: [3, 3]`）。

---

## 2. 验收项逐条自测结果（对应 SPEC 编号）

| SPEC 编号 | 验证方式 | 实测结果与关键数字 | 原始证据路径 |
| --- | --- | --- | --- |
| **CONTRACT §3.1 / §3.5** | Vitest + `node dist/index.js` 实测 | `GET /health` 与 `/tennis/health` 返回 `200`（`rssMb: 51.3`）；子路径 `/tennis/ws` 升级正常；全部 10 项 `ErrorCode` 精确触发 | `docs/review/wp3/evidence/round-1/build-typecheck-test.txt`、`workspace-and-runtime-check.txt` |
| **AC-10（服务端联机/镜像/暂停/Rematch）** | Vitest 集成测试（`tests/server.integration.test.ts`） | P0/P1 镜像输入移动、3 次暂停上限第 4 次 `PAUSE_LIMIT_REACHED`、并发暂停/恢复幂等、60s 到时自动恢复、3s 倒计时及 Rematch 重置 `[3,3]` 与 `serverTick:0` 全通过 | `docs/review/wp3/evidence/round-1/build-typecheck-test.txt` |
| **AC-11（服务端重连/弃权）** | Vitest 集成测试（`tests/server.integration.test.ts`） | 断线广播 15s 暂停；`RECONNECT` 重置 `lastAckSeq[1]=0` 下发 `FULL_SYNC`，恢复后旧低序号 `seq=1` 立即受理；双断线、手动暂停期断线、`>15s` 唯一 `MATCH_OVER(forfeit)` 全通过 | `docs/review/wp3/evidence/round-1/build-typecheck-test.txt` |
| **AC-15（16 并发房间 60Hz 压测）** | 实跑 `scripts/stress-16rooms.ts`（`PORT=3301`） | 16 并发房间持续 `30.01s`，总 tick `1803`（`~60.1 Hz`），平均 tick `0.699 ms`（`< 8 ms`），Max tick `6.996 ms`，Peak RSS `95.24 MB`（`≤ 256 MB`），收包 `29368` 条快照 | `docs/review/wp3/evidence/round-1/stress-16rooms-30s.txt` |
| **AC-16 / 工作包边界** | `Select-String` + `git status` | `server/src/*.ts` 0 条深路径导入；仅修改/新增 `tennis-2k/server/**` 与 `tennis-2k/docs/review/wp3/**`，零触碰根锁文件、`shared/`、`client/`、`SPEC/CONTRACT` | `docs/review/wp3/evidence/round-1/workspace-and-runtime-check.txt` |
