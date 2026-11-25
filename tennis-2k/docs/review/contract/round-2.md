# 《Court 2K：大满贯时代》V1 契约评审报告 — Round 2

结论：PASS
候选版本：基点 `feat/tennis-2k @ cf201f902ddeaa3ab185622addda089100d03256`（工作区未提交文件）
- `tennis-2k/docs/SPEC.md` SHA-256: `D89A1BF38BD480DDDE9453981C52194F3FEA1949737D6763849C8292FA128067`
- `tennis-2k/docs/CONTRACT.md` SHA-256: `74CAE45F50A6B91A9AD5D2411931CC469E2DC23CAF19E874D81E9EFE5D534C7C`
本轮核验方式：全量回归静态契约复验（逐项复核 Round 1 全部 5 项必须修复项与 3 项建议项，并交叉核对 `SPEC.md` 与 `CONTRACT.md` 全文一致性、类型对齐、镜像数学及 `preflight.md` 端口规范；预分配端口 `4900–4999` 本次标为不适用）

---

## 复测范围与理由

因本轮改动触及跨包接口契约（`@court2k/shared` 导出类型、WS 协议状态机与 workspaces 写边界），按 `evaluator.md` §6 执行**全量回归核查**，覆盖全部 5 大审查维度及 `SPEC.md` 同步修订点。

---

## 达标项

- **[Round 1 问题 1 已闭环 · 重连/Rematch 序号与插值复位]** `CONTRACT.md` §2.4 `applyReconnect` 与 §3.2 明确约定：服务端在 `RECONNECT` 成功时重置 `lastAckSeq[reconnectedIndex] = 0`，在 `MATCH_START`（含 Rematch）时重置 `lastAckSeq = [0, 0]` 与 `serverTick = 0`；客户端收到 `FULL_SYNC` 或 `MATCH_START` 时同步清空本地插值缓冲、重置本地发送 `seq = 0`（下帧发 `1`）并触发 `InputController.resetAndRebind()`。彻底封闭页面刷新重连后输入被服务端丢帧的隐患。
- **[Round 1 问题 2 已闭环 · 事件坐标镜像与 P1 `W+K` 符号归一]** `CONTRACT.md` §2.3、§2.4、§3.3 固化坐标系铁律（所有快照与 `GAME_EVENT` 均为规范世界坐标），补齐 `toLocalVec3`、`toLocalEvent` 及 `toLocalView` 对 `ball.spin`/`firstBouncePos` 的 180° 旋转；`stepMatch` 固化 `forwardAimZ = -input.aimZ * player.side`，经验算 P0（`side=+1`）与 P1（`side=-1`）按屏幕 `W` 均得 `+1`、按 `S` 均得 `-1`，`W+K` 放小球与鹰眼坐标 100% 对称无反转。
- **[Round 1 问题 3 已闭环 · 暂停/断线/弃权状态机与竞态规则]** `PauseState` 扩展独立 `disconnected: [boolean, boolean]` 与 `disconnectRemainingSec: [number, number]`，明确保留原始 `pausedFromPhase: ActivePlayPhase | null` 杜绝覆写死循环；§3.4 完整封闭同时请求暂停/恢复/Rematch、`paused_manual`/`resuming` 叠加断线、双断线及 `waiting`/`match_over` 断线；统一以 `GAME_EVENT(MATCH_OVER, reason:'forfeit', forfeitedBy)` 为唯一弃权结算源并从 `ErrorCode` 移除 `OPPONENT_FORFEIT` 消除双弹窗；明确 `stepMatch` 单点推进全部计时器、暂停期 5Hz 推快照、单机 `Esc` 暂停豁免 3 次/60s 限制。
- **[Round 1 问题 4 已闭环 · 跨包类型、`TEST_COMMAND` 与纯函数跨 tick 字段]** `@court2k/shared` 统一导出 `ClientMessage`、`ServerMessage`、`ErrorCode`（10 项与 §3.5 表 100% 对齐）、强类型联合 `TestCommandPayload`、`ScorePatch`、`PRNG`、`BallisticSolveParams`/`Result`；`BallState` 补齐 `touchedNet`/`hitTick`/`firstBouncePos`/`firstBounceInBounds`；`computeShotQuality` 与 `SPEC.md` §3.6 同步固化 `progress >= 1.18` 优先判 `VERY_LATE`；`launchHawkeyeTestBall` 强制走真实物理弹道判定。
- **[Round 1 问题 5 与全部建议项已闭环 · Workspaces 隔离、端口与扩展项]** `CONTRACT.md` §5 明确 WP1 创建占位 `client/package.json` & `server/package.json`、WP2/WP3 严禁修改或提交根目录 `package.json`/`package-lock.json`、整合分支统一生成锁文件，并显式豁免各包 `docs/review/<wp>/**`；补齐 `VITE_WS_PROXY_TARGET`、`TestStateSnapshot`、大厅 `SELECT_LOADOUT` 重置 `ready`、`serve_ready` 忽略 `L` 键及空房 `60s`/`600s` 回收策略。端口分配继续 100% 符合 `preflight.md`。
- **[受控测试钩子隔离与规格一致性]** `?test=1` 与 `ENABLE_TEST_HOOKS=1` 生产隔离完整，覆盖全部高风险 `AC` 与 `E2E-01`~`E2E-04`；`SPEC.md` 的 3 处术语对齐修订均未改变任何用户已批准产品决策。

---

## 返工项

无（0 项必须修复项）。

### 轻微实现提示（非阻断，供 WP1/WP3 实现时注意）
- 若玩家恰在 `hawkeye`（1.8s）或 `point_over`（~1s）短过渡态掉线，`applyDisconnect` 按约定记录 `disconnected[idx] = true` 后，建议 WP1 在 `hawkeye`/`point_over` 结束切入下一分 `serve_ready` 时检测 `disconnected[0] || disconnected[1]` 自动转入 `paused_disconnect`，避免掉线方在过渡态结束后无人接发球。

---

## 规格层面问题（如有）

无。

---

## 未验证项（非门槛 / 环境限制）

- 本轮为并行开工前契约复验，尚未产生业务代码；物理引擎、3D 渲染、双端联机、15s 断线重连与 16 并发房压测均按计划在 WP1、WP2、WP3 与整合阶段逐项实测。

---

## 给用户的摘要

契约评审 Round 2 复验 **`PASS`**。Round 1 指出的全部 5 项跨包阻断缺口（刷新重连序号与插值复位、事件坐标镜像与 P1 `W+K` 归一、暂停/断线/双断线/弃权竞态闭环、共享与测试指令强类型及 npm workspaces 锁文件边界）和 3 项建议项均已全部补齐且与 `SPEC.md` 完全一致、未引入新矛盾。当前 `docs/SPEC.md` 与 `docs/CONTRACT.md` 已具备同步 Notion 主本、提交代码基点并进入 Preflight 检查与并行构建的条件。

---

## Notion 一行摘要

`PASS` / 契约 Round 2 全量复验通过（Round 1 全部 5 项必须项与 3 项建议项已闭环，零新矛盾） / 同步 Notion 主本、提交基点并执行 6 项 Preflight 汇报后启动 WP1 构建
