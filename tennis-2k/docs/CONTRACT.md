# 《Court 2K：大满贯时代》V1 跨工作包接口与协议契约（CONTRACT）

- **单一事实源（SSOT）归属**：Notion 为主本（`https://app.notion.com/p/423641bcf097816c9068fd48f36120b9`），本文件 `tennis-2k/docs/CONTRACT.md` 为仓库执行副本。
- **审批状态**：已获用户批准 · `2026-11-25`（Round 2 契约修订版，补齐全部跨包类型、镜像事件、竞态状态机与 workspaces 写边界）
- **版本号**：`V1`
- **关联规格**：[`docs/SPEC.md`](./SPEC.md)
- **变更纪律**：并行开工后严禁任何工作包私下修改本契约；确需变更时必须经调度员同步通知所有相关 Builder 与 Reviewer，并在涉及产品行为时回到用户确认。

---

## 一、Workspace 包结构与模块约定

```text
tennis-2k/package.json         # workspaces: ["shared", "client", "server"]
├─ shared/package.json         # name: "@court2k/shared", type: "module"
├─ client/package.json         # name: "@court2k/client", type: "module", depends on "@court2k/shared": "*"
└─ server/package.json         # name: "@court2k/server", type: "module", depends on "@court2k/shared": "*"
```

- **模块规范**：三包统一 `"type": "module"`，TypeScript `target: "ES2022"`、`module: "ESNext"`、`moduleResolution: "Bundler"`，保证 `npm run build`、Vite、`tsx`、`vitest` 与纯 `node` 生产启动零路径冲突。
- **`@court2k/shared` 统一导出入口**：所有常量、状态/协议类型（含 `ClientMessage`、`ServerMessage`、`ErrorCode`、`TestCommandPayload`、`ScorePatch`、`PRNG`、`BallisticSolveParams`/`Result`）与纯函数均从 `shared/src/index.ts`（构建后 `shared/dist/index.js` + `index.d.ts`）统一导出；`client/` 与 `server/` **严禁**深路径 import `shared/src/...` 内部子文件。
- **纯度约束**：`@court2k/shared` 严禁引用任何浏览器 DOM（`window`/`document`）、`three` 或 Node 专属 API（`fs`/`ws`/`process`），保证前后端 100% 同构执行。

---

## 二、`@court2k/shared` 导出常量、类型与纯函数契约

### 2.1 基础枚举与常量

```ts
export type CourtId = 'hard' | 'clay' | 'grass';
export type ArchetypeId = 'power' | 'allcourt' | 'serve_volley' | 'defender';
export type MatchFormat = 'fast4' | 'super_tiebreak';
export type AIDifficulty = 'rookie' | 'pro' | 'legend';
export type PlayerSide = 1 | -1;     // +1 = P0(+Z近端), -1 = P1(-Z远端)
export type PlayerIndex = 0 | 1;     // 0 对应 side=+1, 1 对应 side=-1

export type ShotActionKey = 'none' | 'J' | 'K' | 'L';
export type InputPhase = 'idle' | 'hold' | 'release';
export type ShotType = 'serve_flat' | 'serve_kick' | 'topspin' | 'slice' | 'dropshot' | 'lob';
export type ShotQuality = 'PERFECT' | 'GOOD' | 'EARLY' | 'LATE' | 'VERY_EARLY' | 'VERY_LATE';
export type PlayerAnimState =
  | 'idle' | 'run' | 'slide' | 'serve_toss'
  | 'forehand' | 'backhand' | 'lob' | 'celebrate';

export type MatchPhase =
  | 'waiting'
  | 'serve_ready'
  | 'serve_toss'
  | 'rally'
  | 'hawkeye'
  | 'point_over'
  | 'paused_manual'
  | 'paused_disconnect'
  | 'resuming'
  | 'match_over';

export type ActivePlayPhase = 'serve_ready' | 'serve_toss' | 'rally';

export type KeyPointLabel =
  | 'NONE' | 'BREAK_POINT' | 'DECIDING_POINT'
  | 'SET_POINT' | 'MATCH_POINT' | 'TIEBREAK';

export type ErrorCode =
  | 'INVALID_MESSAGE'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'INVALID_TOKEN'
  | 'MATCH_ALREADY_STARTED'
  | 'INVALID_PHASE'
  | 'PAUSE_LIMIT_REACHED'
  | 'CANNOT_RESUME_DISCONNECT'
  | 'RATE_LIMITED'
  | 'FORBIDDEN_TEST_HOOK';

export const COURT_DIM = {
  SINGLES_HALF_WIDTH: 4.115,
  DOUBLES_HALF_WIDTH: 5.485,
  HALF_LENGTH: 11.885,
  SERVICE_LINE_Z: 6.40,
  RUN_LIMIT_X: 7.5,
  RUN_LIMIT_Z_MIN: 0.65,
  RUN_LIMIT_Z_MAX: 16.0,
  NET_CENTER_HEIGHT: 0.914,
  NET_POST_HEIGHT: 1.07,
  NET_POST_X: 4.57,
  BALL_RADIUS: 0.0335,
  HAWKEYE_THRESHOLD_M: 0.15,
  HAWKEYE_DURATION_SEC: 1.8,
  FIXED_DT: 1 / 60,
  PHYSICS_SUBSTEPS: 2,
  MANUAL_PAUSE_MAX_COUNT: 3,
  MANUAL_PAUSE_MAX_SEC: 60,
  DISCONNECT_GRACE_SEC: 15,
  RESUME_COUNTDOWN_SEC: 3,
} as const;

export interface CourtConfig {
  readonly id: CourtId;
  readonly label: string;
  readonly innerColor: string;
  readonly outerColor: string;
  readonly lineColor: string;
  readonly restitutionY: number;     // hard 0.78 | clay 0.86 | grass 0.68
  readonly retentionXZ: number;      // hard 0.76 | clay 0.66 | grass 0.86
  readonly spinGrip: number;         // hard 0.18 | clay 0.28 | grass 0.12
  readonly playerFriction: number;   // hard 1.00 | clay 0.72 | grass 0.90
  readonly slideDurationSec: number; // hard 0.22 | clay 0.38 | grass 0.18
  readonly hasClayDust: boolean;
}
export const COURTS: Readonly<Record<CourtId, CourtConfig>>;

export interface ArchetypeConfig {
  readonly id: ArchetypeId;
  readonly label: string;
  readonly power: number;
  readonly speed: number;
  readonly spin: number;
  readonly timing: number;
  readonly net: number;              // power+speed+spin+timing+net === 400
  readonly jerseyPrimary: string;
  readonly jerseyAccent: string;
  readonly headgear: 'headband' | 'wristband_only' | 'visor' | 'cap_backwards';
  readonly shoulderScale: number;
}
export const ARCHETYPES: Readonly<Record<ArchetypeId, ArchetypeConfig>>;
```

### 2.2 核心状态、物理辅助与测试指令类型（均由 `@court2k/shared` 统一导出）

```ts
export interface Vec3 { x: number; y: number; z: number; }

export interface PRNG {
  next(): number;                    // [0, 1)
  range(min: number, max: number): number;
  getSeed(): number;
}

export interface BallisticSolveParams {
  origin: Vec3;
  target: Vec3;                      // 期望地面首次触地点（y = COURT_DIM.BALL_RADIUS）
  desiredSpeedXZ: number;            // 期望水平初速 m/s
  spin: Vec3;                        // rad/s
  minNetClearanceM: number;          // 过网安全余量（m）
  peakHeightMinM?: number;           // 挑高球 L 最低顶点高度（如 5.2 m）
}

export interface BallisticSolveResult {
  vel: Vec3;                         // 解算出的初速度向量 m/s
  flightTimeSec: number;             // 预计首次落地时间 s
  predictedLanding: Vec3;            // 经 3 次迭代后的验证落点
  clearsNet: boolean;
}

export interface PlayerInputFrame {
  seq: number;                       // 单调递增输入序号（单机按 tick 递增，联机见 §3.2 复位规则）
  moveX: number;                     // [-1, 1]
  moveZ: number;                     // [-1, 1]
  aimX: number;                      // [-1, 1] 松手瞬间的落点方向
  aimZ: number;                      // [-1, 1]
  action: ShotActionKey;             // 'none' | 'J' | 'K' | 'L'
  phase: InputPhase;                 // 'idle' | 'hold' | 'release'
}

export interface MeterState {
  active: boolean;
  action: ShotActionKey;
  progress: number;                  // [0, 1.18]
  sweetCenter: number;               // 0.78
  effectiveHalfWidth: number;
  lastQuality: ShotQuality | null;
}

export interface PlayerState {
  index: PlayerIndex;
  side: PlayerSide;
  archetype: ArchetypeId;
  pos: Vec3;
  vel: Vec3;
  yaw: number;                       // 弧度：0 面向 -Z，PI 面向 +Z
  anim: PlayerAnimState;
  animTime: number;
  isSliding: boolean;
  slideTimer: number;
  moveAccelTime: number;             // [0, 0.28] 自动加速计时
  meter: MeterState;
  takeoverEnergy: number;            // [0, 100]
  takeoverPointsLeft: number;        // 0 | 1 | 2
  takeoverCooldown: boolean;         // 结束后冷却 1 分
}

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  spin: Vec3;                        // rad/s
  active: boolean;
  bounces: number;
  touchedNet: boolean;               // 跨 tick：发球擦网落地判 LET 必需
  hitTick: number;                   // 跨 tick：AI 反应延迟（240/140/70 ms）纯函数判定必需
  firstBouncePos: Vec3 | null;       // 跨 tick：二跳/制胜分终结时回溯首跳触发鹰眼必需
  firstBounceInBounds: boolean | null;
  lastHitter: PlayerIndex | null;
  lastShotType: ShotType | null;
  lastShotQuality: ShotQuality | null;
  speedKmhDisplay: number;           // 转播显示球速（km/h）
  predictedLanding: Vec3 | null;
}

export interface HawkeyeState {
  active: boolean;
  elapsedSec: number;
  durationSec: number;               // 1.8
  bouncePos: Vec3;                   // 规范世界坐标
  isIn: boolean;
  distanceToLineCm: number;          // 距最近有效线厘米值（≥0）
  lineType: 'sideline' | 'baseline' | 'service_line' | 'center_service_line';
}

export interface PauseState {
  reason: 'none' | 'manual' | 'disconnect';
  initiatedBy: PlayerIndex | null;
  /** 仅保存真实比赛阶段（serve_ready / serve_toss / rally），严禁被 paused_manual 或 resuming 覆盖 */
  pausedFromPhase: ActivePlayPhase | null;
  remainingSec: number;              // manual: <=60s；disconnect: 掉线方最小剩余宽限秒数 <=15s
  resumeCountdownSec: number;        // resuming 阶段 3.0 → 0.0
  manualPausesLeft: [number, number];// 初始 [3, 3]
  disconnected: [boolean, boolean];  // 独立追踪双方连接态（封闭双断线竞态）
  disconnectRemainingSec: [number, number]; // 双方独立 15s 宽限计时器
}

export interface PlayerMatchStats {
  aces: number;
  doubleFaults: number;
  firstServesIn: number;
  firstServesTotal: number;
  winners: number;
  unforcedErrors: number;
  perfectShots: number;
  totalMeterShots: number;
}

export interface ScoreState {
  format: MatchFormat;
  games: [number, number];
  points: [number, number];          // 常规局 0/1/2/3 对应 0/15/30/40；抢七/抢十为真实数字
  isTiebreak: boolean;
  isDecidingPoint: boolean;          // Fast4 40-40 金球
  server: PlayerIndex;
  serveNumber: 1 | 2;
  courtSide: 'deuce' | 'ad';
  keyPointLabel: KeyPointLabel;
  winner: PlayerIndex | null;
}

export interface MatchConfig {
  mode: 'single' | 'online';
  court: CourtId;
  format: MatchFormat;
  archetypes: [ArchetypeId, ArchetypeId];
  aiDifficulty?: AIDifficulty;       // mode === 'single' 时必填
  seed: number;
}

export interface MatchState {
  tick: number;
  config: MatchConfig;
  phase: MatchPhase;
  phaseTimer: number;
  players: [PlayerState, PlayerState];
  ball: BallState;
  score: ScoreState;
  stats: [PlayerMatchStats, PlayerMatchStats];
  hawkeye: HawkeyeState;
  pause: PauseState;
  lastAckSeq: [number, number];
}

export interface ScorePatch {
  games?: [number, number];
  points?: [number, number];
  isTiebreak?: boolean;
  server?: PlayerIndex;
  serveNumber?: 1 | 2;
}

export type TestCommandPayload =
  | { cmd: 'set_seed'; args: { seed: number } }
  | { cmd: 'set_score'; args: ScorePatch }
  | { cmd: 'set_takeover'; args: { playerIndex: PlayerIndex; value: number } }
  | { cmd: 'trigger_hawkeye'; args: { inBounds: boolean; distCm: number; line?: 'sideline' | 'baseline' } }
  | { cmd: 'fast_forward_pause'; args: { seconds: number } };
```

### 2.3 游戏事件联合类型（`GameEvent`）

> 所有带坐标字段（`pos`、`hawkeye.bouncePos`）在服务端产出与传输时均为**规范世界坐标**；客户端渲染或定位音效前必须通过 `toLocalEvent(event, yourSide)` 转换。

```ts
export type GameEvent =
  | { type: 'SHOT_HIT'; hitter: PlayerIndex; shotType: ShotType; quality: ShotQuality; speedKmh: number; pos: Vec3 }
  | { type: 'BOUNCE'; pos: Vec3; court: CourtId; bounceIndex: number; inBounds: boolean }
  | { type: 'NET_LET'; isServe: boolean; pos: Vec3 }
  | { type: 'HAWKEYE_START'; hawkeye: HawkeyeState }
  | { type: 'HAWKEYE_END'; isIn: boolean }
  | { type: 'POINT_SCORED'; winner: PlayerIndex; reason: 'ace' | 'winner' | 'unforced_error' | 'double_fault' | 'out' | 'net' | 'double_bounce'; score: ScoreState }
  | { type: 'TAKEOVER_ON'; player: PlayerIndex }
  | { type: 'TAKEOVER_OFF'; player: PlayerIndex }
  | { type: 'PAUSE_TIMEOUT_RESUMING'; resumeCountdownSec: number }
  | { type: 'PAUSE_RESUMED'; serverTick: number }
  | { type: 'MATCH_OVER'; winner: PlayerIndex; reason: 'normal' | 'forfeit'; forfeitedBy?: PlayerIndex; score: ScoreState; stats: [PlayerMatchStats, PlayerMatchStats] };
```

### 2.4 纯函数与确定性接口契约

| 函数签名 | 行为、不变量与边界规则 |
| --- | --- |
| `createRng(seed: number): PRNG` | 确定性 Mulberry32 PRNG，不依赖 `Math.random()` |
| `netHeightAt(x: number): number` | 返回 `0.914 + (1.07 - 0.914) * Math.min(1, Math.abs(x) / 4.57)` |
| `createMatchState(config: MatchConfig): MatchState` | 返回初始 `MatchState`（`phase: 'serve_ready'`、`manualPausesLeft: [3, 3]`、`disconnected: [false, false]`、`lastAckSeq: [0, 0]`，发球方立于 Deuce 区底线） |
| `stepMatch(state: MatchState, inputs: [PlayerInputFrame, PlayerInputFrame], dt: number, rng: PRNG): { state: MatchState; events: GameEvent[] }` | ① **不修改入参**，返回深克隆新状态与本步 `events`；② **单点推进全部计时器**：含 `paused_manual` 的 60s 倒计时（仅 `mode === 'online'`，到 0 自动进 `resuming` 并触发 `PAUSE_TIMEOUT_RESUMING`）、`paused_disconnect` 的双方独立 15s 计时（到 0 触发 `MATCH_OVER(reason:'forfeit')`）、`resuming` 的 3s 倒计时（到 0 恢复 `pausedFromPhase` 并触发 `PAUSE_RESUMED`）；③ **`W+K` 与深浅瞄准的 `side` 符号归一**：计算 `forwardAimZ = -input.aimZ * player.side`（P0/P1 按屏幕 `W` 均得 `forwardAimZ = +1`，按 `S` 均得 `-1`）；在 `rally` 阶段，当 `action === 'K'` 且 `forwardAimZ >= 0.5` 时判定为 **贴网放小球（`dropshot`）**，否则为常规切削（`slice`）；`serve_ready` 阶段按下 `L` 键静默忽略 |
| `solveBallisticShot(params: BallisticSolveParams): BallisticSolveResult` | 经 3 次迭代补偿空气阻力与 Magnus 偏移，返回精确初速度 `vel` 与 `predictedLanding` |
| `computeShotQuality(progress: number, archetype: ArchetypeConfig, ctx: { shotType: ShotType; isTakeover: boolean; isSliding: boolean }): { quality: ShotQuality; effectiveHalfWidth: number; error: number }` | **优先级边界**：若 `progress >= 1.18`，**无条件优先返回 `VERY_LATE`**（避免高 `TIM` + Takeover + 二发/切削时 `p_sweet + 4 * W_eff > 1.18` 漏判）；其余按 `SPEC.md` §3.6 计算 |
| `computeAIInput(state: MatchState, playerIndex: PlayerIndex, difficulty: AIDifficulty, rng: PRNG): PlayerInputFrame` | 确定性纯函数，基于 `state.tick - state.ball.hitTick` 计算反应延迟（`240 / 140 / 70 ms`），输出规范世界坐标输入帧 |
| `requestManualPause(state: MatchState, by: PlayerIndex): { ok: true; state: MatchState } \| { ok: false; code: ErrorCode; message: string }` | 仅允许在 `serve_ready / serve_toss / rally` 调用（其他阶段返回 `INVALID_PHASE`）；`mode === 'online'` 时检查 `manualPausesLeft[by] > 0`（为 0 返回 `PAUSE_LIMIT_REACHED`），扣减 1 次并设 `remainingSec = 60`；`mode === 'single'` 时**豁免次数与 60s 限制**（不扣次数、`remainingSec = 0` 表示无倒计时） |
| `requestManualResume(state: MatchState, by: PlayerIndex): { ok: true; state: MatchState; alreadyResuming?: boolean } \| { ok: false; code: ErrorCode; message: string }` | `phase === 'paused_disconnect'` 返回 `CANNOT_RESUME_DISCONNECT`；`phase === 'resuming'` 返回 `{ ok: true, state, alreadyResuming: true }`（幂等忽略且**不重置 3s 倒计时**）；`phase === 'paused_manual'` 时：`mode === 'online'` 转 `resuming`（`resumeCountdownSec = 3`），`mode === 'single'` 直接恢复至 `pausedFromPhase` |
| `applyDisconnect(state: MatchState, idx: PlayerIndex): MatchState` | 仅在 `serve_ready / serve_toss / rally / paused_manual / resuming` 时转 `paused_disconnect`：**保留最初的 `pausedFromPhase`（绝不覆写为 `paused_manual` 或 `resuming`）**，不退还已扣手动暂停次数，置 `disconnected[idx] = true`、`disconnectRemainingSec[idx] = 15`；在 `waiting / match_over` 调用仅更新 `disconnected[idx]` 不切换 `phase` |
| `applyReconnect(state: MatchState, idx: PlayerIndex): { state: MatchState; bothConnected: boolean }` | 重置 `lastAckSeq[idx] = 0`、`disconnected[idx] = false`、`disconnectRemainingSec[idx] = 15`；若 `phase === 'paused_disconnect'` 且 `bothConnected === true`，转 `resuming`（`resumeCountdownSec = 3`） |
| `applyScorePatch(state: MatchState, patch: ScorePatch): MatchState` | 受控测试专用纯函数：按 `ScorePatch` 更新比分并重算 `isDecidingPoint / courtSide / keyPointLabel` 与发球站位 |
| `launchHawkeyeTestBall(state: MatchState, opts: { inBounds: boolean; distCm: number; line?: 'sideline' | 'baseline' }, rng: PRNG): MatchState` | 受控测试专用纯函数：**通过 `solveBallisticShot` 真实发射一记飞向目标线 `±distCm` 处的物理球**进入 `rally` 飞行，经真实 `stepMatch` 落点与 `d_line <= 15 cm` 阈值判定（**严禁直接篡改 `hawkeye.active = true` 绕过阈值判定**） |
| `fastForwardPauseState(state: MatchState, seconds: number): MatchState` | 受控测试专用纯函数：按 `seconds` 推进当前 `paused_manual` 或 `paused_disconnect` 计时器（最小夹至 `0.05` 或直接触发到期转移），便于快速验证 60s 自动恢复与 15s 弃权 |
| `toLocalVec3(v: Vec3, side: PlayerSide): Vec3` | `side === 1 ? { ...v } : { x: -v.x, y: v.y, z: -v.z }` |
| `toLocalView(state: MatchState, side: PlayerSide): MatchState` | `side === 1` 返回副本；`side === -1` 对所有空间向量绕 Y 轴旋转 `180°`：含 `players[i].pos/vel/yaw(+π)`、`ball.pos/vel/spin/predictedLanding/firstBouncePos` 与 `hawkeye.bouncePos` |
| `toLocalEvent(event: GameEvent, side: PlayerSide): GameEvent` | `side === 1` 返回副本；`side === -1` 使用 `toLocalVec3` 镜像转换 `SHOT_HIT.pos`、`BOUNCE.pos`、`NET_LET.pos`、`HAWKEYE_START.hawkeye.bouncePos` |
| `toWorldInput(localInput: PlayerInputFrame, side: PlayerSide): PlayerInputFrame` | 返回新对象，`moveX / moveZ / aimX / aimZ` 乘以 `side` |
| `generateRoomCode(rng: PRNG): string` | 从 32 字符集 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（排除 `0/O/1/I`）生成 4 位房间码 |
| `computeStatsSummary(stats: PlayerMatchStats): { firstServePct: number; perfectPct: number }` | 分母为 `0` 返回 `0`，否则四舍五入返回 `0–100` 整数百分比 |

---

## 三、Client ↔ Server WebSocket 协议契约

### 3.1 连接端点、代理环境变量、健康检查与空闲回收
- **客户端 WS 地址推导**：
  - 规范化 `import.meta.env.BASE_URL` 确保首尾带 `/`（如 `/` 或 `/tennis/`），连接 `${wsProto}//${window.location.host}${base}ws`；
  - Vite dev 代理目标通过环境变量 `VITE_WS_PROXY_TARGET` 注入（默认 `http://127.0.0.1:3301`），将 `<base>ws`（WS）与 `<base>health`（HTTP）转发至服务端，防止 Reviewer/Tester 多端口实例串台。
- **服务端监听**：通过 `PORT`（默认 `3301`）、`WS_PATH`（默认 `/ws`，同时兼容任意前缀路径末尾 `/ws`）与 `ENABLE_TEST_HOOKS`（默认未开启；仅 `=== '1'` 时受理 `TEST_COMMAND`）控制；暴露 `GET /health`（及任意后缀 `/health`）返回：
  ```json
  { "status": "ok", "rooms": 2, "uptimeSec": 145, "rssMb": 64.2 }
  ```
- **空闲房间回收策略**：
  - 双方均断连的空房（`waiting` 或 `match_over`）超过 `60 s` 自动回收；
  - 处于 `waiting` 或 `match_over` 且连续 `600 s`（10 分钟）无任何消息的房间自动关闭并回收，保障 `AC-15` 长期运行内存稳定（RSS `≤ 256 MB`）。
- **防洪限流**：`PLAYER_INPUT` 客户端按 60Hz 发送；单连接超过 `120 msg/s` 持续 1 秒时丢弃超额帧并返回 `ERROR(RATE_LIMITED)`。

### 3.2 Client → Server 消息联合类型（`ClientMessage`，由 `@court2k/shared` 导出）

```ts
export type ClientMessage =
  | { type: 'CREATE_ROOM'; payload: { court: CourtId; format: MatchFormat; archetype: ArchetypeId } }
  | { type: 'JOIN_ROOM'; payload: { roomCode: string; archetype: ArchetypeId } }
  | { type: 'RECONNECT'; payload: { roomCode: string; sessionToken: string } }
  | { type: 'SELECT_LOADOUT'; payload: { archetype: ArchetypeId; court?: CourtId; format?: MatchFormat } }
  | { type: 'READY'; payload: { ready?: boolean } } // 省略默认 true；支持取消就绪
  | { type: 'PLAYER_INPUT'; payload: PlayerInputFrame & { clientTime: number } } // 本地视角意图
  | { type: 'PAUSE_REQUEST'; payload: Record<string, never> }
  | { type: 'RESUME_REQUEST'; payload: Record<string, never> }
  | { type: 'REMATCH_REQUEST'; payload: Record<string, never> }
  | { type: 'PING'; payload: { clientTime: number } }
  | { type: 'TEST_COMMAND'; payload: TestCommandPayload };
```

- **大厅 `SELECT_LOADOUT` 与 `READY` 联动规则**：房主（P0）修改 `court` 或 `format` 时，服务端自动重置双方 `ready = [false, false]` 并广播 `LOBBY_UPDATE`；客场（P1）仅可修改自身 `archetype`（忽略其 `court`/`format` 字段）。
- **输入序号复位与单调不变量（防刷新重连按键失灵）**：
  - 常规对战期间，服务端丢弃 `seq <= state.lastAckSeq[idx]` 的乱序/重复帧；
  - 服务端在 **`RECONNECT` 成功时必须重置 `lastAckSeq[reconnectedIndex] = 0`**，在 **`MATCH_START`（含 Rematch）时重置 `lastAckSeq = [0, 0]` 与 `serverTick = 0`**；
  - 客户端在收到 **`FULL_SYNC` 或 `MATCH_START` 时必须同步**：① 清空本地快照插值队列并以新 `snapshot` 为首帧；② 将本地发送序号重置为 `0`（下一帧发送 `seq = 1`）；③ 调用 `InputController.resetAndRebind()`。

### 3.3 Server → Client 消息联合类型（`ServerMessage`，由 `@court2k/shared` 导出）

> **坐标系铁律**：`MATCH_START.snapshot`、`STATE_SNAPSHOT.state`、`FULL_SYNC.snapshot` 以及 `GAME_EVENT.event` 中的全部坐标均为**规范世界坐标**；客户端渲染与空间音效前必须调用 `toLocalView(state, yourSide)` / `toLocalEvent(event, yourSide)`。

```ts
export type ServerMessage =
  | { type: 'ROOM_CREATED'; payload: { roomCode: string; sessionToken: string; yourSide: 1; playerIndex: 0; matchConfig: MatchConfig } }
  | { type: 'ROOM_JOINED'; payload: { roomCode: string; sessionToken: string; yourSide: -1; playerIndex: 1; matchConfig: MatchConfig; ready: [boolean, boolean] } }
  | { type: 'LOBBY_UPDATE'; payload: { roomCode: string; matchConfig: MatchConfig; connected: [boolean, boolean]; ready: [boolean, boolean] } }
  | { type: 'MATCH_START'; payload: { serverTick: 0; yourSide: PlayerSide; playerIndex: PlayerIndex; snapshot: MatchState } }
  | { type: 'STATE_SNAPSHOT'; payload: { serverTick: number; serverTime: number; state: MatchState } } // 对战期 30Hz；暂停/恢复倒计时期间 5Hz + 变更瞬时推送
  | { type: 'GAME_EVENT'; payload: { serverTick: number; event: GameEvent } }
  | { type: 'MATCH_PAUSED'; payload: { reason: 'manual' | 'disconnect'; initiatedBy: PlayerIndex; remainingSec: number; manualPausesLeft: [number, number] } }
  | { type: 'MATCH_RESUMING'; payload: { resumeCountdownSec: number; initiatedBy: PlayerIndex | 'timeout' | 'reconnect' } }
  | { type: 'MATCH_RESUMED'; payload: { serverTick: number; requireInputReset: true } }
  | { type: 'OPPONENT_DISCONNECTED'; payload: { graceSeconds: 15; disconnectedIndex: PlayerIndex } }
  | { type: 'OPPONENT_RECONNECTED'; payload: { resumeInSeconds: 3; reconnectedIndex: PlayerIndex } }
  | { type: 'FULL_SYNC'; payload: { roomCode: string; yourSide: PlayerSide; playerIndex: PlayerIndex; snapshot: MatchState; requireInputReset: true } }
  | { type: 'REMATCH_STATUS'; payload: { requested: [boolean, boolean] } }
  | { type: 'PONG'; payload: { clientTime: number; serverTick: number } }
  | { type: 'ERROR'; payload: { code: ErrorCode; message: string } };
```

### 3.4 暂停 / 断线 / 恢复 / 弃权 / Rematch 边界状态机与唯一消息序列

| 场景 / 竞态 | 服务端确定性转移规则 | 唯一精确下发 WS 消息序列 |
| --- | --- | --- |
| **正常手动暂停** | 仅 `serve_ready / serve_toss / rally` 且 `manualPausesLeft[i] > 0`；扣减 1 次，保存 `pausedFromPhase`，`remainingSec = 60` | `S→All MATCH_PAUSED(reason:'manual')` + 即时 `STATE_SNAPSHOT` |
| **双方同时 `PAUSE_REQUEST`** | 按事件循环串行处理：先到者成功转 `paused_manual` 扣次数；后到者见 `paused_manual` 拒收且**不扣次数** | 先到者触发上行序列；后到者单播 `ERROR(INVALID_PHASE)` |
| **手动暂停额度归零** | `manualPausesLeft[i] <= 0` 拒收 | 单播 `ERROR(PAUSE_LIMIT_REACHED)` |
| **手动恢复 / 60s 自动到期** | `paused_manual → resuming`（`resumeCountdownSec = 3`）；3s 归零后恢复 `pausedFromPhase` | 发起时 `S→All MATCH_RESUMING(initiatedBy: idx \| 'timeout')` → 3s 后 `S→All MATCH_RESUMED(requireInputReset:true)` + `STATE_SNAPSHOT` |
| **双方同时 `RESUME_REQUEST`** | 先到者转 `resuming`；后到者见 `resuming` **幂等忽略，严禁重置 3s 倒计时** | 仅先到者触发一次 `MATCH_RESUMING` |
| **对战 / 手动暂停 / `resuming` 期间发生断线** | 调用 `applyDisconnect` 转 `paused_disconnect`，**保留原始 `pausedFromPhase`**（绝不覆写），手动暂停被断线接管且不退还次数，`disconnectRemainingSec[i] = 15` | `S→Online MATCH_PAUSED(reason:'disconnect')` + `S→Online OPPONENT_DISCONNECTED` + `STATE_SNAPSHOT` |
| **断线暂停期请求手动恢复** | `phase === 'paused_disconnect'` 禁止手动恢复 | 单播 `ERROR(CANNOT_RESUME_DISCONNECT)` |
| **双方相继断线（双断线）** | 各自独立倒计时 `disconnectRemainingSec[0/1]`；仅 1 人重连时**留在 `paused_disconnect`** 不触发 `resuming`，直至双方均在线 | 先重连方单播 `FULL_SYNC`；第二人重连后再广播 `OPPONENT_RECONNECTED` + `MATCH_RESUMING(initiatedBy:'reconnect')` → 3s 后 `MATCH_RESUMED` |
| **单方 15s 内重连成功** | `applyReconnect` 重置 `lastAckSeq[i] = 0`，双方均在线 → 转 `resuming(3s)` | `S→Reconnected FULL_SYNC(requireInputReset:true)` → `S→All OPPONENT_RECONNECTED` + `S→All MATCH_RESUMING` → 3s 后 `S→All MATCH_RESUMED(requireInputReset:true)` |
| **断线超时 15s 弃权** | `disconnectRemainingSec[i] <= 0` → `phase = 'match_over'`，`winner = 1 - i`（若双方同 tick 归零则直接回收房间） | **唯一结算事件**：`S→All GAME_EVENT(MATCH_OVER, reason:'forfeit', forfeitedBy:i)`（**不再发 `ERROR`**，彻底杜绝双弹窗） |
| **`waiting` / `match_over` 阶段断线** | 绝不进入 `paused_disconnect` 或弃权：`waiting` 置 `ready[i]=false`、`connected[i]=false`（客场离房立刻释放席位）；`match_over` 置 `rematchRequested[i]=false` | `waiting` 广播 `LOBBY_UPDATE`；`match_over` 广播 `REMATCH_STATUS` |
| **赛后 `REMATCH_REQUEST`（含重复点击）** | 重复点击幂等忽略；单方点击更新 `requested`；双方均 `true` 后重置比分/统计/Takeover/`manualPausesLeft=[3,3]`/`lastAckSeq=[0,0]`/`serverTick=0` 开新局 | 单方点击：`S→All REMATCH_STATUS`；双方就绪：`S→All MATCH_START(serverTick:0)` |

### 3.5 统一错误码表（`ErrorCode`）

| 错误码 | 触发条件 | 客户端处理要求 |
| --- | --- | --- |
| `INVALID_MESSAGE` | JSON 解析失败或字段非法 | 控制台警告，不崩溃 |
| `ROOM_NOT_FOUND` | 4 位码不存在或已回收 | 大厅 Toast 提示“房间不存在” |
| `ROOM_FULL` | 房间已满 2 人 | 大厅 Toast 提示“房间已满” |
| `INVALID_TOKEN` | `RECONNECT` token 不匹配或房间已回收 | 清除 `sessionStorage` 残留 token 并回大厅提示 |
| `MATCH_ALREADY_STARTED` | 试图加入已开赛房间 | 大厅提示“比赛已开始” |
| `INVALID_PHASE` | 当前阶段不允许该操作（如鹰眼期/已暂停期重复请求暂停） | 轻量 Toast 提示，保持原状态 |
| `PAUSE_LIMIT_REACHED` | 发起方 `manualPausesLeft[idx] <= 0` | HUD 提示“本场暂停次数（3次）已用尽” |
| `CANNOT_RESUME_DISCONNECT` | 断线暂停期尝试手动恢复 | HUD 提示“等待对手重连中，无法提前恢复” |
| `RATE_LIMITED` | 单连接超频 | 静默丢弃并节流 |
| `FORBIDDEN_TEST_HOOK` | 服务端未设 `ENABLE_TEST_HOOKS=1` 收到 `TEST_COMMAND` | 拒绝执行并记日志 |

---

## 四、客户端内部接口与受控测试快照契约（WP2 必守）

### 4.1 角色渲染与输入自愈接口

```ts
export interface PlayerAvatarController {
  readonly root: THREE.Group;
  setArchetype(config: ArchetypeConfig): void;
  updatePose(player: PlayerState, dt: number): void;
  dispose(): void;
}

export interface InputDiagnostics {
  attached: boolean;
  pressedCount: number;
  rebindCount: number;
  lastResetReason: string | null;
}

export interface InputController {
  attach(): void;
  detach(): void;
  /** 清空 pressedKeys 与蓄力态、先解绑再重绑 window 监听、blur 焦点元素 */
  resetAndRebind(reason: string): void;
  sampleFrame(seq: number): PlayerInputFrame;
  getDiagnostics(): InputDiagnostics;
}
```

- 必须触发 `resetAndRebind(reason)` 的 6 类时机：① 收到 `FULL_SYNC`（同时重置发送序号与清插值队列）；② 收到 `MATCH_RESUMED`；③ 收到 `HAWKEYE_END`；④ 单机暂停恢复；⑤ `window` `blur` / `visibilitychange(hidden→visible)`；⑥ 页面刷新重挂。

### 4.2 受控测试状态快照类型（`window.__COURT2K_TEST__.getState()`）

```ts
export interface TestStateSnapshot {
  mode: 'lobby' | 'single' | 'online';
  yourSide: PlayerSide;
  roomCode: string | null;
  wsConnected: boolean;
  reconnectCount: number;
  rttMs: number;
  matchState: MatchState | null;            // 当前客户端视图对应状态深拷贝
  qualityTier: 'HIGH' | 'MEDIUM' | 'LOW';
  activeDpr: number;
  estHz: number;
  fpsCapEnabled: boolean;
  upgradeCount: number;                     // 必须恒满足 <= 1
  fps: number;
  maxFrameMs: number;
  drawCalls: number;
  inputDiagnostics: InputDiagnostics;
}
```

---

## 五、工作包严格边界、npm Workspaces 隔离与端口分配

| 工作包 | 独占写目录与显式豁免 | 依赖基点 | Builder 端口 | Reviewer 端口 | Tester 端口 / 会话 |
| --- | --- | --- | --- | --- | --- |
| **契约评审** | 只读 `docs/SPEC.md`、`docs/CONTRACT.md`；评审报告 `docs/review/contract/**` | 无 | 不适用 | `4900–4999` | 不适用 |
| **WP1 (`shared`)** | `tennis-2k/package.json`、`tsconfig.base.json`、`.gitignore`、`shared/**`、**占位骨架 `client/package.json` & `server/package.json`（仅 name/private/type 占位，零源码）**；豁免报告 `docs/review/wp1/**` | 契约 PASS | `3100–3199` | `4100–4199` | 不适用（脚本闭环） |
| **WP2 (`client`)** | `tennis-2k/client/**`（只读 `@court2k/shared`）；豁免报告 `docs/review/wp2/**` | WP1 合入基点 | `3200–3299`（Vite `3201`） | `4200–4299`（`4201`） | `4510–4519`（独立会话） |
| **WP3 (`server`)** | `tennis-2k/server/**`（只读 `@court2k/shared`）；豁免报告 `docs/review/wp3/**` | WP1 合入基点 | `3300–3399`（WS `3301`） | `4300–4399`（`4301`） | 不适用（脚本闭环） |
| **整合与整体评审** | 整合分支 `integration/v1`（含统一生成 `package-lock.json` 与联调脚本）；报告 `docs/review/integration/**` | WP1+WP2+WP3 全 PASS | `3100–3199` | `4900–4999`（前 `4901`/后 `4902`） | `4520–4529`（双独立 Context） |

> **npm Workspaces 并行锁文件红线**：
> 1. WP1 初始化 `tennis-2k/package.json` 时同步写入最小占位 `client/package.json` 与 `server/package.json`，确保 WP1 阶段 `npm install` 不报 `ENOENT`；
> 2. **WP2 与 WP3 安装依赖时严禁修改或提交根目录 `tennis-2k/package.json` 与 `tennis-2k/package-lock.json`**（安装各自包依赖可使用 `npm install --workspace=client --package-lock=false` 或提交前还原根目录 `package-lock.json`），仅提交各自 `<pkg>/package.json` 与源码；
> 3. 整合分支合入 WP1 + WP2 + WP3 后，执行一次干净 `npm install` 生成并提交唯一统一的 `tennis-2k/package-lock.json`。

---

## 六、跨工作包端到端联调场景（整合评审第 1 轮必验）

- **测试数据与脚本责任人**：整合阶段 Builder 在整合分支提供一键本地启动脚本（支持通过环境变量注入前后端端口、`VITE_WS_PROXY_TARGET`、`VITE_BASE_PATH`、`ENABLE_TEST_HOOKS=1`）及子路径反代测试脚本；由整体评审 Reviewer 编排一次性测试简报，双独立浏览器 Context Tester 执行取证。

| 场景编号 | 关联 SPEC | 入口与前置 | 端到端验证步骤 | 通过标准 |
| --- | --- | --- | --- | --- |
| **`E2E-01`** | `AC-10` | 双独立浏览器 Context（**不带 `?test=1`**） | P0 建房得 4 位码 → P1 输码入房选不同流派 → 双方用 `WASD/J/K/L`（含 P1 执行 `W+K` 放小球）打完至少 1 局 Fast4 → 途中 P0 按 `Esc` 暂停、P1 点击恢复走 3s 倒计时并立即按键 → 完赛后双方点击 Rematch 开启新局 | 双端均处于屏幕下方近端向上击球，移动/瞄准/`W+K` 100% 对称无反转；暂停/恢复/3s 倒计时生效且恢复后按键不失灵；Rematch 正确清插值队列、重置 `serverTick=0`、比分与暂停次数 `[3,3]` |
| **`E2E-02`** | `AC-07`、`AC-10` | 双独立浏览器 Context（`?test=1`，服务端 `ENABLE_TEST_HOOKS=1`） | 联机中调用 `triggerHawkeyeShot({ inBounds: true, distCm: 8 })` 发射真实物理压线球；再测 `distCm: 25` | `8 cm` 球经真实物理判定在双端同步触发 1.8s 3D 鹰眼特写（P1 球印/镜头经 `toLocalEvent` 正确镜像无 180° 错位）并同判 `IN`；`25 cm` 不触发 |
| **`E2E-03`** | `AC-11` | 双独立浏览器 Context | ① 联机中触发 P1 刷新页面并在 4 秒内通过 `sessionToken` 自动重连 → 恢复瞬间 P1 立即按 `WASD` + `J/K/L`；② 另测 P1 断线并快进/实等超 15 秒 | ① 房主见 15s 暂停倒计时；重连服务端重置 `lastAckSeq[1]=0`、客户端清插值队列并重置 `seq`，`FULL_SYNC` + 3s 倒计时后原比分续打且 **P1 按键 100% 即时响应不丢帧不失灵**；② 超 15s 双方仅收到唯一 `MATCH_OVER(reason:'forfeit')` 结算弹窗 |
| **`E2E-04`** | `AC-12`、`AC-15` | `VITE_BASE_PATH=/tennis/` 生产构建 + 本地子路径静态与 WS 代理 | 访问 `http://127.0.0.1:<port>/tennis/?netdebug=1` 跑通单机与联机连接，并行执行 16 并发房间 60Hz 后端压测 | 所有静态与 WS 资源 0 个 404；`?netdebug=1` 指标完整；16 并发房间平均 tick `< 8 ms` 且 RSS `≤ 256 MB` |
