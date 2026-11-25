# 《Court 2K：大满贯时代》V1 契约评审报告 — Round 1

结论：FAIL
候选版本：基点 `feat/tennis-2k @ cf201f902ddeaa3ab185622addda089100d03256`（工作区未提交文件）
- `tennis-2k/docs/SPEC.md` SHA-256: `0D92DA580649B7A57E40882B4553F178EEC662DCEC140D8A9DE64D468AC9738A`
- `tennis-2k/docs/CONTRACT.md` SHA-256: `1FDD7F9FF8166F61B91D057719B50B7A19146AA36CF18C6A451D187B5625550E`
本轮核验方式：独立静态契约审查（逐项核对 `SPEC.md`、`CONTRACT.md`、`parallel.md`、`preflight.md`，并做物理/数值/镜像数学验算；预分配端口 `4900–4999` 本次标为不适用）

---

## 达标项

- **[端口分配与隔离]** `CONTRACT.md` §5 为契约评审（`4900–4999`）、WP1（`3100–3199` / `4100–4199`）、WP2（`3200–3299` / `4200–4299` / Tester `4510–4519`）、WP3（`3300–3399` / `4300–4399`）及整合评审（`3100–3199` / `4900–4999` / Tester `4520–4529`）分配的端口段与 `preflight.md` 100% 严格对齐，零重叠。
- **[核心数值与物理自洽性]** 经独立验算：`COURT_DIM` 全部 16 项常量与 `SPEC.md` §3 完全一致；4 流派五维总分严格均为 `400`（`power` 94+72+82+76+76、`allcourt` 80+80+82+86+72、`serve_volley` 84+84+74+74+84、`defender` 70+94+86+82+68），且满速差 `+17.7% ≥ 15%`、绿条宽差 `+26.8% ≥ 12%` 均满足 `AC-03`；3 场地弹性/水平保留参数在正常旋转范围下满足 `AC-02`（红土弹高约 `+21.6%`、草地弹高约 `-24.0%`、草地弹后水平速高于红土 `> 20%`）。
- **[180° 镜像主体数学]** `P1 (side = -1)` 采用绕 `Y` 轴旋转 `180°`（`x -> -x, z -> -z, yaw -> yaw + π`，行列式 `+1` 保手性），搭配 `worldX = side * localX, worldZ = side * localZ`，可确保双方均在屏幕下方近端向上击球，且 Deuce/Ad 发球站位与对角发球框在双方屏幕上完全左右对称。
- **[核心客户端扩展与子路径设计]** `PlayerAvatarController` 与 `InputController` 接口清晰；WS 地址基于 `import.meta.env.BASE_URL` 动态推导并支持任意末尾 `/ws` 与 `/health`，兼容 `VITE_BASE_PATH=/tennis/`；`?test=1` 与 `ENABLE_TEST_HOOKS=1`（默认拒收并返回 `FORBIDDEN_TEST_HOOK`）生产隔离原则正确，`E2E-01`~`E2E-04` 明确区分了正常入口与测试钩子入口。

---

## 返工项

### 【问题 1（必须）：断线刷新重连与 Rematch 后的 `PLAYER_INPUT.seq` / `serverTick` 序号重置规则缺失，将直接导致重连后按键失灵】

- **现象与证据**：
  - `CONTRACT.md` §2.2 定义 `PlayerInputFrame.seq` 为“单调递增输入序号”、`MatchState.lastAckSeq: [number, number]`；§3.3 `MATCH_START` 示例将 `serverTick` 归零，`FULL_SYNC` 下发 `snapshot` 与 `requireInputReset: true`。
  - 但契约全程未规定：当 `AC-11` / `E2E-03` 中 P1 **刷新浏览器页面**并在 4 秒内通过 `RECONNECT` 恢复时，客户端新实例 `seq` 从 `1` 重新开始，而服务端 `lastAckSeq[1]` 仍停留在断线前的大值（如 `4500`）该如何处理；亦未规定 Rematch 重置 `serverTick` 后客户端快照插值队列如何清空。
- **影响**：若 WP3 服务端按常规单调序号过滤 `seq <= lastAckSeq[idx]`，P1 页面刷新重连后的全部按键将被服务端静默丢弃长达数十秒，直接导致 `AC-11` / `E2E-03` 核心防踩坑目标彻底失败；Rematch 若 `serverTick` 倒退而 WP2 未清插值缓冲，将导致画面冻结。
- **修改方向**：在 `CONTRACT.md` §3.2/§3.3/§4 明确双向约定：① 服务端在 `RECONNECT` 成功时重置 `lastAckSeq[reconnectedIndex] = 0`，在 `MATCH_START`（含 Rematch）时重置 `lastAckSeq = [0, 0]` 与 `serverTick = 0`；② 客户端收到 `FULL_SYNC` 或 `MATCH_START` 时同步清空本地快照插值缓冲，并将输入序号重置（或同步续接 `snapshot.lastAckSeq[idx] + 1`），双端达成唯一不变量。
- **下轮验收标准**：`CONTRACT.md` 中可查到明确的 `RECONNECT` 与 Rematch 序号重置及插值缓冲清空条款，WP2/WP3 按契约实现后不存在刷新重连丢帧路径。

---

### 【问题 2（必须）：`GAME_EVENT` 坐标空间与镜像函数缺失，且 P1 `W+K` 放小球/深浅瞄准的 `side` 符号归一未固化】

- **现象与证据**：
  - `CONTRACT.md` §3.3 仅在 `STATE_SNAPSHOT` 注明“规范世界坐标，客户端按 `toLocalView(state, yourSide)` 渲染”，未说明 `MATCH_START.snapshot`、`FULL_SYNC.snapshot` 及 `GAME_EVENT`（含 `SHOT_HIT.pos`、`BOUNCE.pos`、`NET_LET.pos`、`HAWKEYE_START.hawkeye.bouncePos`）的坐标系；§2.4 缺少 `toLocalEvent` / `toLocalVec3`，且 `toLocalView` 遗漏旋转 `ball.spin`（`x -> -x, z -> -z`）。
  - `SPEC.md` §3.6 定义 `W + K` 为贴网放小球，但经 `toWorldInput(localInput, -1)` 转换后，P1 按 `W`（`localZ = -1`）映射为 `worldAimZ = +1`（与 P0 的 `-1` 相反），`CONTRACT.md` §2.4 未规定 `stepMatch` 必须使用 `side` 归一后的前向分量（如 `forwardZ = -input.aimZ * player.side`）判定 `W+K` 放小球与深浅落点。
- **影响**：P1 端消费 `GAME_EVENT` 渲染鹰眼贴地镜头、球印、击球特效与红土扬尘时会出现 180° 位置错位（直接击穿 `E2E-02`）；若 WP1 直接以 `aimZ < -0.5` 判 `W+K`，P1 联机时 `W+K` 与 `S+K` 将完全反转（击穿 `AC-10` / `E2E-01`）。
- **修改方向**：① 在 §3.3 显式规定所有服务端下发的状态快照与 `GAME_EVENT` 坐标均为规范世界坐标；② 在 `@court2k/shared` §2.4 补充 `toLocalEvent(event: GameEvent, side: PlayerSide): GameEvent`（并在 `toLocalView` 中同步旋转 `ball.spin`）；③ 在 §2.4 `stepMatch` / `toWorldInput` 说明中固化前向瞄准与 `W+K` 的 `side` 归一规则（并明确判定读取 `aimZ` 还是 `moveZ`）。
- **下轮验收标准**：`CONTRACT.md` 覆盖全部含坐标的快照/事件镜像接口，且 P0/P1 在 `W/A/S/D + J/K/L`（含 `W+K`）及鹰眼事件坐标上 100% 对称无反转歧义。

---

### 【问题 3（必须）：WS 暂停/断线/弃权边界状态机与竞态规则不闭环，存在死循环与双端协议错配风险】

- **现象与证据**：
  1. **断线叠加手动暂停 / `resuming` 断线 / 双断线**：`PauseState` 仅存单个 `initiatedBy` 与 `pausedFromPhase`（`CONTRACT.md` §2.2），未定义：
     - `paused_manual` 或 `resuming` 期间发生断线时，必须保留最初的比赛阶段 `pausedFromPhase`（若覆盖为 `'paused_manual'` 或 `'resuming'` 将导致重连恢复死循环），且手动暂停被断线暂停接管（不退还已扣次数）；
     - 双方相继断线时如何独立追踪两方连接状态与 15s 宽限计时，防止仅一方重连就误触发 `resuming`；
     - `waiting`（大厅）与 `match_over`（赛后 Rematch 页）断线不得进入 `paused_disconnect` 或触发 `OPPONENT_FORFEIT`。
  2. **并发竞态未定义**：双方同时发 `PAUSE_REQUEST`（后者拒收 `INVALID_PHASE` 且不扣次数）、同时发 `RESUME_REQUEST`（后者幂等忽略且**不得重置 3s 倒计时**）、重复发 `REMATCH_REQUEST` 的幂等规则均未写明。
  3. **消息重叠与弃权结算语义分裂**：断线/重连同时定义了 `MATCH_PAUSED(reason:'disconnect')` 与 `OPPONENT_DISCONNECTED`、`OPPONENT_RECONNECTED` 与 `MATCH_RESUMING(initiatedBy:'reconnect')`；15s 弃权被放在 §3.4 `ERROR(OPPONENT_FORFEIT)` 表中要求弹窗结算，而正常完赛走 `GAME_EVENT(MATCH_OVER)`，未明确是否同时发两者及谁为客户端唯一结算触发源。
  4. **暂停倒计时推进职责与单机差异缺失**：`CONTRACT.md` §2.4 未明确 `pause.remainingSec`、`pause.resumeCountdownSec` 及 `15s` 断线倒计时由 `stepMatch` 推进还是 `server` 独立推进（及是否发对应事件）、暂停期间是否继续广播 `STATE_SNAPSHOT`（影响 `fastForwardPause` 后 HUD 刷新），亦未说明单机模式 `Esc` 暂停豁免 3 次/60s 限制。
- **修改方向**：在 `CONTRACT.md` §2.3/§2.4/§3.3 补全：① 增设「暂停/断线/恢复/Rematch 状态转移与竞态处理规则」小节，逐条封闭上述 4 类场景；② 明确断线、重连、手动暂停、60s 到时、15s 弃权的**唯一精确 WS 消息序列**（建议 `MATCH_OVER` 增加 `reason: 'normal' | 'forfeit'` 作为唯一结算事件，或明确与 `OPPONENT_FORFEIT` 的主从关系避免双弹窗）；③ 明确暂停/恢复计时器由 `@court2k/shared` 还是 `server` 单点推进、单机暂停规则，以及暂停期快照推送策略。
- **下轮验收标准**：上述全部边界与竞态场景在 `CONTRACT.md` 中均有唯一确定转移规则与明确消息序列，WP2 与 WP3 无需私下约定即可闭环对接。

---

### 【问题 4（必须）：并行构建必需的跨包类型、`TEST_COMMAND` 参数结构及纯函数跨 tick 状态字段缺失】

- **现象与证据**：
  1. **受控测试指令 `TEST_COMMAND.args` 未定型**：`CONTRACT.md` §3.2 仅写 `args: Record<string, unknown>`，未定义 `set_score`（`ScorePatch`）、`set_takeover`、`trigger_hawkeye`、`set_seed` 的参数类型（仅 `fast_forward_pause` 在示例里隐含 `{ seconds: number }`）。WP2 实现 `Court2KTestHook` 发消息、WP3 解析消息并行开发时必现字段名漂移，直接阻塞 `AC-07`/`AC-08`/`AC-10`/`E2E-02`/`E2E-03`。
  2. **导出类型缺失**：§2.4 引用了 `PRNG`、`BallisticSolveParams`、`BallisticSolveResult`、`ErrorCode`，但 §2.2 未给出定义；且未明确 `@court2k/shared` 统一导出 `ClientMessage`、`ServerMessage`、`ErrorCode`、`ScorePatch`、`TestCommandPayload` 等 WS 协议联合类型。
  3. **纯函数 `stepMatch` / `computeAIInput` 缺少跨 tick 状态字段**：`stepMatch` 严禁隐藏闭包状态，但 `BallState` 缺少：`touchedNet: boolean`（发球擦网落地判 `LET` 必需）、`firstBouncePos: Vec3 | null`（压线 Ace/制胜分二跳终结时回溯首跳落点触发鹰眼必需）、`hitTick: number`（AI 反应延迟 `240/140/70 ms` 纯函数判定必需）。
  4. **绿条超 `1.18` 边界优先级缺口**：`allcourt`（`TIM=86`）在 Takeover（`1.25×`）下发二发（`1.35×`）或切削（`1.18×`）时，`p_sweet + 4 * W_eff` 可达 `1.240 > 1.18`，按公式 `computeShotQuality(1.18)` 会得出 `LATE` 而非 `SPEC.md` §3.6 要求的强制 `VERY_LATE`。
- **修改方向**：在 `CONTRACT.md` §2 与 §3.2 中补齐上述精确 TypeScript 类型定义（`ClientMessage`/`ServerMessage`/`ErrorCode`/`TestCommandPayload`/`ScorePatch`/`BallisticSolveParams`/`BallisticSolveResult`/`PRNG` 全部由 `@court2k/shared` 统一导出），在 `BallState` 补齐跨 tick 必需字段，并在 `computeShotQuality` 契约中注明 `progress >= 1.18` 优先判 `VERY_LATE`；同时补充 `trigger_hawkeye` 必须发射真实物理球过判定阈值（禁止直接篡改 `hawkeye.active = true` 绕过判定）。
- **下轮验收标准**：`CONTRACT.md` 中所有被函数签名或 WS 协议引用的类型均已完整定义且归口 `@court2k/shared` 导出，WP2 与 WP3 在 `TEST_COMMAND` 与 WS 消息上零猜测。

---

### 【问题 5（必须）：npm workspaces 根文件与 `package-lock.json` 写边界在并行包间存在直接冲突】

- **现象与证据**：
  - `CONTRACT.md` §1 指定 `tennis-2k/package.json` 含 `workspaces: ["shared", "client", "server"]`，§5 规定 WP1 独占 `tennis-2k/package.json`、`tsconfig.base.json`、`shared/**`，WP2 仅限 `tennis-2k/client/**`，WP3 仅限 `tennis-2k/server/**`（“越界即判 FAIL”）。
  - 实际工程中：① 若 WP1 阶段 `client/`、`server/` 尚未存在，`npm install` 解析显式 `workspaces` 数组会报 `ENOENT`；② WP2 与 WP3 各自安装依赖（`vite`/`three` vs `ws`/`tsx`）时，`npm install` 默认会改写根目录 `tennis-2k/package-lock.json`，既触犯“越界即判 FAIL”，又会在整合分支引发必然的 lockfile 冲突；③ 各包按 `parallel.md` §3 需写入 `docs/review/<wp>/round-N-builder.md`，当前独占写目录表未予显式豁免。
- **修改方向**：在 `CONTRACT.md` §5 明确：① WP1 负责创建最小骨架 `client/package.json` 与 `server/package.json`（仅含 name/private/type 占位）或明确工作区初始化策略，避免 WP1 自身 `npm install` 失败；② 明确 WP2/WP3 安装依赖时严禁提交根目录 `package-lock.json`（仅提交各自 `<pkg>/package.json` 与源码），统一由整合分支生成并提交最终 `package-lock.json`；③ 明确允许各包写入自身 `docs/review/<wp>/round-N-builder.md`；④ 顺带在 §3.1/§5 约定前端 Vite dev 代理目标通过 `VITE_WS_PROXY_TARGET`（默认 `http://127.0.0.1:3301`）注入，防止 Reviewer/Tester 多端口实例硬编码串台。
- **下轮验收标准**：WP1/WP2/WP3 写边界在 npm workspaces 真实命令下可零报错、零越界、零 lockfile 冲突地并行执行。

---

### 【建议项（非阻断，推荐顺手补齐）】

1. **【建议：补齐 `TestStateSnapshot` 字段清单】** 在 `CONTRACT.md` §4 给出 `TestStateSnapshot` 接口定义（含 `qualityTier`、`activeDpr`、`estHz`、`fpsCapEnabled`、`upgradeCount`、`inputDiagnostics`），避免 WP2 与后续 Tester/Reviewer 脚本字段猜测。
2. **【建议：明确大厅 `READY` 联动与发球 `L` 键行为】** 约定房主执行 `SELECT_LOADOUT` 变更场地或赛制时自动重置双方 `ready = [false, false]`，支持取消就绪；约定 `serve_ready` 阶段按下 `L` 键静默忽略。
3. **【建议：明确空闲房间回收超时】** 在 `CONTRACT.md` §3.1 约定大厅空房/完赛态闲置超时回收策略（如 10 分钟），保障 `AC-15` 16 并发房间 RSS `≤ 256 MB` 长期稳定。

---

## 规格层面问题（如有）

- **无物理不可行或需求级矛盾**。上述 5 项均为 `CONTRACT.md` 跨包接口/状态机/工程边界细化缺口，修订后不改变用户已批准的 `SPEC.md` 产品规则（仅需同步更新 Notion 主本并按 `parallel.md` §1 履行契约复核）。

---

## 未验证项（非门槛 / 环境限制）

- 本轮为并行开工前的纯文档/契约静态审查，尚未产出业务代码；所有运行时行为、3D 渲染帧率、双浏览器联机同步与压测均留待 WP1–WP3 与整合阶段实测验证。

---

## 给用户的摘要

`CONTRACT.md` 的整体架构、端口段分配、物理/流派数值与 180° 镜像主体数学均与 `SPEC.md` 一致，但发现了 **5 处会直接阻断前后端并行开发或引发重连失灵的契约缺口**（包括刷新重连后输入序号未重置、事件坐标镜像与 P1 `W+K` 符号归一缺失、断线叠加暂停/双断线/弃权状态机未闭环、`TEST_COMMAND` 与共享纯函数类型缺失，以及 npm workspaces 锁文件写边界冲突）。本次契约评审暂判 **`FAIL`**，建议让规划员先补全 `CONTRACT.md` 并快速复验通过，再冻结基点启动并行开发，可避免后续整合期大面积返工。

---

## Notion 一行摘要

`FAIL` / 发现 5 项跨包契约阻断缺口（重连序号重置、事件镜像与 P1 `W+K` 归一、暂停断线竞态与弃权协议、共享/测试指令类型及 workspaces 锁文件边界） / 由 Planner 修订 `CONTRACT.md` 并同步 Notion 主本后进行契约 Round 2 复验
