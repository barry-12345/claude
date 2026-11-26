# 《Court 2K：大满贯时代》V2 跨工作包接口、协议与资产契约（CONTRACT）

- **单一事实源（SSOT）归属**：Obsidian 为主本（`G:\我的云端硬盘\Barry's obsidian\99_System\Data\Quick_Notes\Notes\Court 2K：大满贯时代 · V2 规划与版本页.md`），本文件 `tennis-2k/docs/CONTRACT.md` 为仓库执行副本。
- **审批状态**：已获用户批准开工 · `2026-11-27`（决策 1A / 2A、增量假设 C-01~C-03 全部生效；Round 2 契约闭环修订版）
- **版本号**：`V2`
- **代码基点**：`feat/tennis-2k-v2 @ ee66efd5f59e8cd6e248c78ad9507be6e52bf576`
- **关联规格**：[`docs/SPEC.md`](./SPEC.md)
- **变更纪律**：并行开工后严禁任何工作包私下修改本契约；确需变更时必须经调度员同步通知所有相关 Builder 与 Reviewer，并在涉及产品行为时回到用户确认。

---

## 一、Workspace 包结构与纯度约定

```text
tennis-2k/package.json                 # workspaces: ["shared", "client", "server"]（V2 零新增 npm 依赖）
├─ assets/source/                      # WP-Asset 独占：Blender 5.2 Python 生成脚本与资产清单
├─ shared/package.json                 # name: "@court2k/shared", type: "module"
├─ client/package.json                 # name: "@court2k/client", type: "module", depends on "@court2k/shared": "*", "three": "^0.174.0"
│  └─ public/assets/models/tennis_player.glb  # WP-Asset 导出，WP2 只读加载
└─ server/package.json                 # name: "@court2k/server", type: "module", depends on "@court2k/shared": "*"
```

- **模块规范**：三包统一 `"type": "module"`、`target: "ES2022"`、`module: "ESNext"`、`moduleResolution: "Bundler"`。
- **`@court2k/shared` 统一导出入口**：所有常量、状态/协议/诊断类型（含 `InputDiagnostics`、`TestStateSnapshot`）与纯函数（含 `cloneMatchState`）均由 `shared/src/index.ts`（构建产物 `shared/dist/index.js` + `index.d.ts`）统一导出；`client/` 与 `server/` **严禁**深路径导入 `shared/src/...`。
- **纯度约束**：`@court2k/shared` 严禁引用任何浏览器 DOM（`window`/`document`）、`three` 或 Node 专属 API（`fs`/`ws`/`process`）。
- **零 V1 废弃残留约束**：V2 源码中严禁保留 `MeterState`、`InputPhase`、`takeover*`、`TAKEOVER_ON`、`TAKEOVER_OFF`、`set_takeover`、`ArchetypeConfig.timing`、`perfectShots`、`totalMeterShots`、`SHOT_METER_MULT`、`METER_*`。

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
export type ShotType = 'serve_flat' | 'serve_kick' | 'topspin' | 'slice' | 'dropshot' | 'lob';
export type ShotQuality = 'CLEAN' | 'SOLID' | 'STRETCH';

export type PlayerAnimState =
  | 'idle'
  | 'run'
  | 'slide'
  | 'serve_toss'
  | 'forehand'
  | 'backhand'
  | 'lob'
  | 'celebrate';

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
  | 'NONE'
  | 'BREAK_POINT'
  | 'DECIDING_POINT'
  | 'SET_POINT'
  | 'MATCH_POINT'
  | 'TIEBREAK'
  | 'SUPER_TIEBREAK';

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

export const PHYSICS_CONSTANTS = {
  GRAVITY: 9.81,
  DRAG_COEFF: 0.022,
  MAGNUS_COEFF: 0.00055,
  BOUNCE_SPIN_DECAY: 0.65,
  NET_LET_TOLERANCE_M: 0.02,
  NET_LET_SPEED_SCALE: 0.65,
  PLAYER_ACCEL_TIME_SEC: 0.28,
  BASE_COMFORT_RADIUS_M: 1.05,
  COMFORT_RADIUS_PER_CTL_M: 0.008,
  BASE_REACH_RADIUS_M: 1.48,
  SLIDE_REACH_RADIUS_M: 1.90,
  SLIDE_TRIGGER_MIN_DIST_M: 1.35,
  SLIDE_TRIGGER_MAX_DIST_M: 2.55,
  SLIDE_TRIGGER_TIME_SEC: 0.55,
  TAP_MAX_HOLD_SEC: 0.20,
  PRE_INPUT_BUFFER_SEC: 0.35,
  SERVE_TOSS_DURATION_SEC: 0.32,
  POINT_OVER_DURATION_SEC: 1.15,
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
  readonly control: number;          // V2 CTL（替代 V1 timing）
  readonly net: number;              // 严格满足 power+speed+spin+control+net === 400
  readonly jerseyPrimary: string;
  readonly jerseyAccent: string;
  readonly shortsColor: string;
  readonly hairColor: string;
  readonly skinTone: string;
  readonly headgear: 'headband' | 'wristband_only' | 'visor' | 'cap_backwards';
  readonly shoulderScale: number;    // power 1.10 | allcourt 1.00 | serve_volley 1.03 | defender 0.94
}
export const ARCHETYPES: Readonly<Record<ArchetypeId, ArchetypeConfig>>;
```

### 2.2 核心状态、输入帧、测试指令与诊断快照类型（均由 `@court2k/shared` 唯一导出）

```ts
export interface Vec3 { x: number; y: number; z: number; }

export interface PRNG {
  next(): number;                    // [0, 1)
  range(min: number, max: number): number;
  getSeed(): number;
}

export interface BallisticSolveParams {
  origin: Vec3;
  target: Vec3;
  desiredSpeedXZ: number;
  spin: Vec3;
  minNetClearanceM: number;
  peakHeightMinM?: number;
}

export interface BallisticSolveResult {
  vel: Vec3;
  flightTimeSec: number;
  predictedLanding: Vec3;
  clearsNet: boolean;
}

export interface PlayerInputFrame {
  seq: number;
  moveX: number;                     // [-1, 1]
  moveZ: number;                     // [-1, 1]
  aimX: number;                      // [-1, 1] 触球左右瞄准
  aimZ: number;                      // [-1, 1] 触球深浅微调
  action: ShotActionKey;             // 'none' | 'J' | 'K' | 'L' 当前按住键
  actionPressed: boolean;            // 本 tick 是否新按下（边沿触发）
}

export interface ShotStanceState {
  armedAction: ShotActionKey;        // 'none' | 'J' | 'K' | 'L'
  holdDurationSec: number;           // 连续按住时长；松手时 <0.20s 进 0.35s 缓冲，>=0.20s 立即取消
  bufferRemainingSec: number;        // 短按松手后预输入缓冲剩余秒数
  lastConsumedHitTick: number;       // 防止同一来球重复触发，初始 -1
  lockedAimX: number;                // 发球锁存规范世界坐标 aimX（[-1, 1]）
  lastQuality: ShotQuality | null;   // 'CLEAN' | 'SOLID' | 'STRETCH' | null
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
  moveAccelTime: number;
  stance: ShotStanceState;
}

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  spin: Vec3;
  active: boolean;
  bounces: number;
  touchedNet: boolean;
  hitTick: number;
  firstBouncePos: Vec3 | null;
  firstBounceInBounds: boolean | null;
  lastHitter: PlayerIndex | null;
  lastShotType: ShotType | null;
  lastShotQuality: ShotQuality | null;
  speedKmhDisplay: number;
  predictedLanding: Vec3 | null;
}

export interface HawkeyeState {
  active: boolean;
  elapsedSec: number;
  durationSec: number;
  bouncePos: Vec3;
  isIn: boolean;
  distanceToLineCm: number;
  lineType: 'sideline' | 'baseline' | 'service_line' | 'center_service_line';
}

export interface PauseState {
  reason: 'none' | 'manual' | 'disconnect';
  initiatedBy: PlayerIndex | null;
  pausedFromPhase: ActivePlayPhase | null;
  remainingSec: number;
  resumeCountdownSec: number;
  manualPausesLeft: [number, number];
  disconnected: [boolean, boolean];
  disconnectRemainingSec: [number, number];
}

export interface PlayerMatchStats {
  aces: number;
  doubleFaults: number;
  firstServesIn: number;
  firstServesTotal: number;
  winners: number;
  unforcedErrors: number;
  cleanShots: number;
  totalShots: number;
}

export interface ScoreState {
  format: MatchFormat;
  games: [number, number];
  points: [number, number];
  isTiebreak: boolean;
  isDecidingPoint: boolean;
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
  aiDifficulty?: AIDifficulty;
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

export interface SpawnIncomingBallOptions {
  targetX: number;                   // 规范世界坐标 X（客户端钩子负责按 yourSide 镜像后传入）
  targetZ: number;                   // 规范世界坐标 Z
  speedXZ?: number;                  // 默认 21 m/s
  forPlayerIndex?: PlayerIndex;      // 默认 0
}

export type TestCommandPayload =
  | { cmd: 'set_seed'; args: { seed: number } }
  | { cmd: 'set_score'; args: ScorePatch }
  | { cmd: 'trigger_hawkeye'; args: { inBounds: boolean; distCm: number; line?: 'sideline' | 'baseline' } }
  | { cmd: 'spawn_incoming_ball'; args: SpawnIncomingBallOptions }
  | { cmd: 'fast_forward_pause'; args: { seconds: number } };

export interface InputDiagnostics {
  attached: boolean;
  pressedCount: number;
  rebindCount: number;
  lastResetReason: string | null;
}

export interface TestStateSnapshot {
  mode: 'lobby' | 'single' | 'online';
  yourSide: PlayerSide;
  roomCode: string | null;
  wsConnected: boolean;
  reconnectCount: number;
  rttMs: number;
  matchState: MatchState | null;            // 本地视角状态深拷贝
  avatarLoaded: boolean;
  avatarSource: 'glb' | 'fallback';
  avatarTriangles: number;
  qualityTier: 'HIGH' | 'MEDIUM' | 'LOW';
  activeDpr: number;
  estHz: number;
  fpsCapEnabled: boolean;
  upgradeCount: number;                     // 恒满足 <= 1
  fps: number;
  maxFrameMs: number;
  drawCalls: number;
  inputDiagnostics: InputDiagnostics;
}
```

### 2.3 游戏事件联合类型（`GameEvent`）

> 所有坐标字段均为**规范世界坐标**；客户端渲染或定位音效前必须调用 `toLocalEvent(event, yourSide)`。

```ts
export type GameEvent =
  | { type: 'SHOT_HIT'; hitter: PlayerIndex; shotType: ShotType; quality: ShotQuality; speedKmh: number; pos: Vec3 }
  | { type: 'BOUNCE'; pos: Vec3; court: CourtId; bounceIndex: number; inBounds: boolean }
  | { type: 'NET_LET'; isServe: boolean; pos: Vec3 }
  | { type: 'HAWKEYE_START'; hawkeye: HawkeyeState }
  | { type: 'HAWKEYE_END'; isIn: boolean }
  | { type: 'POINT_SCORED'; winner: PlayerIndex; reason: 'ace' | 'winner' | 'unforced_error' | 'double_fault' | 'out' | 'net' | 'double_bounce'; score: ScoreState }
  | { type: 'PAUSE_TIMEOUT_RESUMING'; resumeCountdownSec: number }
  | { type: 'PAUSE_RESUMED'; serverTick: number }
  | { type: 'MATCH_OVER'; winner: PlayerIndex; reason: 'normal' | 'forfeit'; forfeitedBy?: PlayerIndex; score: ScoreState; stats: [PlayerMatchStats, PlayerMatchStats] };
```

### 2.4 纯函数与确定性接口契约（均由 `shared/src/index.ts` 导出）

| 函数签名 | 行为、不变量与边界规则 |
| --- | --- |
| `createRng(seed: number): PRNG` | 确定性 Mulberry32 PRNG，禁止 `Math.random()` |
| `cloneMatchState(state: MatchState): MatchState` | 深拷贝完整 `MatchState`，含 `players[0/1].stance`、`ball`、`score`、`stats`、`hawkeye`、`pause`、`lastAckSeq` |
| `netHeightAt(x: number): number` | `0.914 + (1.07 - 0.914) * Math.min(1, Math.abs(x) / 4.57)` |
| `computePlayerMaxSpeed(speedRating: number): number` | `5.4 + (speedRating - 60) * 0.048` |
| `computePowerMultiplier(powerRating: number): number` | `1.0 + (powerRating - 80) * 0.008` |
| `computeSpinMultiplier(spinRating: number): number` | `1.0 + (spinRating - 80) * 0.010` |
| `computeNetAccuracyMultiplier(netRating: number): number` | `1.0 + (netRating - 75) * 0.012` |
| `computeComfortRadius(controlRating: number): number` | `1.05 + (controlRating - 75) * 0.008` |
| `computeControlScatterM(quality: ShotQuality, controlRating: number): number` | `CLEAN`: `0.03`；`SOLID`: `Math.max(0.14, 0.28 - (CTL - 75) * 0.006)`；`STRETCH`: `Math.max(0.38, 0.68 - (CTL - 75) * 0.012)` |
| `computeStretchSidelineErrorProb(controlRating: number): number` | `clamp(0.14 - (CTL - 75) * 0.004, 0.04, 0.22)` |
| `computeFirstServeCornerFaultProb(controlRating: number): number` | `clamp(0.10 - (CTL - 75) * 0.003, 0.03, 0.16)` |
| `computePositionShotQuality(contactDistM: number, archetype: ArchetypeConfig, isSliding: boolean): { quality: ShotQuality; comfortRadiusM: number }` | `isSliding \|\| contactDistM > 1.48` → `'STRETCH'`；else `contactDistM <= R_sweet` → `'CLEAN'`；else `'SOLID'` |
| `createMatchState(config: MatchConfig): MatchState` | 初始化 `phase: 'serve_ready'`、`manualPausesLeft: [3, 3]`、`lastAckSeq: [0, 0]`、`stance.lastConsumedHitTick = -1`、`stance.lockedAimX = 0`、`score.keyPointLabel`（超级抢十初始 `'SUPER_TIEBREAK'`） |
| `stepMatch(state, inputs, dt, rng)` | 不修改入参，推进物理/计时器/自动触球状态机。严格遵守：① **铁律**：`stance.armedAction === 'none'` 绝不挥拍；② **防同帧与隔网触球**：仅在 `ball.hitTick < next.tick`、`ball.pos.z * p.side >= -0.05` 且 `ball.vel.z * p.side > 0` 时允许触球；③ **短按缓冲/长按取消**：`holdDurationSec < 0.20` 松手进 `0.35s` 缓冲，`>= 0.20` 松手立刻清零；④ **一键发球边沿与锁存**：`serve_ready → serve_toss` 严格要求 `input.actionPressed && (input.action === 'J' \|\| input.action === 'K')`（`L` 静默忽略），进入后 `serve_toss` 期间松开 `J`/`K` 不取消、`lockedAimX` 仅在 `Math.abs(input.aimX) > 0.05` 时更新、`0.32 s` 自动出球；正常发球判 `CLEAN`、极边角失误 `serve_flat` 判 `SOLID`，均计 `totalShots += 1`（`CLEAN` 计 `cleanShots += 1`），`NET_LET` 按 `lastShotQuality === 'CLEAN'` 与 `serveNumber === 1` 精确回滚；⑤ **`K` 默认放小球 & `STRETCH` 钳位**：`forwardAimZ = -aimZ * side`，`K` 且 `forwardAimZ <= -0.5`（`S+K`）判 `slice`，其余 `K`（含 `W+K`）判 `dropshot`；`STRETCH` 的 `-1.1 m` 浅缩仅作用于 `topspin`/`slice`/`lob`（钳位 `\|Z\| >= 2.2`），对 `dropshot` 改为 `+0.35 m` 变深并钳位最终 `\|Z\| ∈ [2.0, 3.8]` |
| `solveBallisticShot(params): BallisticSolveResult` | 3 次迭代阻力+Magnus 补偿解算器 |
| `computeAIInput(state, playerIndex, difficulty, rng): PlayerInputFrame` | 确定性纯函数，输出规范世界坐标 V2 `PlayerInputFrame`（发球触发 tick 与新武装 tick 正确置 `actionPressed: true`），走与玩家完全相同的自动触球逻辑 |
| `requestManualPause` / `requestManualResume` / `applyDisconnect` / `applyReconnect` / `fastForwardPauseState` | 与 V1 状态机不变量完全一致（`pausedFromPhase` 保护、双断线独立计时、重连重置 `lastAckSeq[idx] = 0`） |
| `applyScorePatch(state, patch): MatchState` | 更新比分、发球站位，重置双方 `stance` |
| `launchHawkeyeTestBall(state, opts, rng): MatchState` | 经 `solveBallisticShot` 真实发射压线球走真实 `stepMatch` 判定 |
| `spawnIncomingTestBall(state, opts, rng): MatchState` | 经 `solveBallisticShot` 从发球方底线向 `(opts.targetX, opts.targetZ)` 发射真实物理来球，强制置 `phase = 'rally'`、`phaseTimer = 0`、`ball.active = true`、`ball.bounces = 0`、`ball.touchedNet = false`、`ball.lastHitter = 1 - receiverIdx`、`ball.lastShotType = 'topspin'`、`ball.lastShotQuality = 'CLEAN'`、`ball.hitTick = next.tick`、`ball.firstBouncePos = null`、`ball.firstBounceInBounds = null`，重置接球方 `stance`（`armedAction = 'none'`、`lastConsumedHitTick = -1`）并移开发球方 |
| `toLocalVec3` / `toLocalView` / `toLocalEvent` / `toWorldInput` | `side === -1` 时 180° 镜像所有空间向量与 `players[i].stance.lockedAimX`；`toWorldInput` 将 `moveX/moveZ/aimX/aimZ` 乘以 `side` 并原样透传 `action` 与 `actionPressed` |
| `generateRoomCode(rng): string` | 32 字符无歧义 4 位房间码 |
| `computeStatsSummary(stats: PlayerMatchStats): { firstServePct: number; cleanPct: number }` | 分母为 `0` 返回 `0`，否则四舍五入 `0–100` 整数百分比 |

---

## 三、Client ↔ Server WebSocket 协议契约

### 3.1 连接、子路径、健康检查与空闲回收（保持 V1 规范）
- 客户端 WS 地址：规范化 `import.meta.env.BASE_URL`（首尾带 `/`），连接 `${wsProto}//${window.location.host}${base}ws`；Vite 代理 `VITE_WS_PROXY_TARGET`（默认 `http://127.0.0.1:3301`）。
- 服务端：`PORT`（默认 `3301`）、`WS_PATH`（默认 `/ws`，兼容任意前缀后缀 `/ws`）、`ENABLE_TEST_HOOKS`（仅 `'1'` 受理 `TEST_COMMAND`）；`GET /health` 返回 `{ status, rooms, uptimeSec, rssMb }`。
- 空闲回收：双断连空房 `60 s` 回收；`waiting`/`match_over` 无消息 `600 s` 回收；超 `120 msg/s` 持续 1s 返回 `ERROR(RATE_LIMITED)`。

### 3.2 `ClientMessage` 与 `ServerMessage` 联合类型（由 `@court2k/shared` 导出）
- **`ClientMessage`** 保留全部 11 种消息，以下两处升级为 V2：
  1. `PLAYER_INPUT`: `payload: PlayerInputFrame & { clientTime: number }`（V2 `action` + `actionPressed: boolean`，无 `phase`）；
  2. `TEST_COMMAND`: `payload: TestCommandPayload`（移除 `set_takeover`，新增 `spawn_incoming_ball`）。
- **`ServerMessage`** 保留全部 15 种消息（`ROOM_CREATED`、`ROOM_JOINED`、`LOBBY_UPDATE`、`MATCH_START`、`STATE_SNAPSHOT`、`GAME_EVENT`、`MATCH_PAUSED`、`MATCH_RESUMING`、`MATCH_RESUMED`、`OPPONENT_DISCONNECTED`、`OPPONENT_RECONNECTED`、`FULL_SYNC`、`REMATCH_STATUS`、`PONG`、`ERROR`），其中 `MatchState` 与 `GameEvent` 为 V2 类型（零 `takeover`/`meter` 字段）。

### 3.3 服务端 60Hz `PLAYER_INPUT` 消费与 `TEST_COMMAND` 校验铁律（WP3 必守）
1. **`PLAYER_INPUT` 校验**：`server/src/validation.ts` 必须强校验 `action ∈ {'none','J','K','L'}` 与 `typeof payload.actionPressed === 'boolean'`，拒绝 V1 旧格式或非法字段。
2. **`spawn_incoming_ball` 校验与执行**：
   - `validation.ts` 强校验：`targetX` 为有限数且夹至 `[-8, 8]`、`targetZ` 为有限数且夹至 `[-16, 16]`、可选 `speedXZ` 必须为有限数且 `> 0 && <= 50`、可选 `forPlayerIndex` 必须为 `0 | 1`；
   - `room.ts` 收到并校验通过后，调用 `spawnIncomingTestBall(this.state, payload.args, this.rng)`，调用 `this.clearInputs()` 清空残留输入队列，并立即广播 `STATE_SNAPSHOT`。
3. **队列防丢边沿**：当 `inputQueues[idx].length >= 8` 时，优先丢弃首个 `actionPressed === false` 的旧帧，仅当队列全为边沿帧时才丢弃队首，确保快速短按 `J`/`K`/`L` 在网络抖动下不丢失。
4. **空队列复用清边沿**：`consumeTickInput(idx)` 在队列为空复用 `lastInputs[idx]` 时，**必须返回 `{ ...prev, actionPressed: false }`**（保留持续按住的 `action` 与 `moveX/moveZ/aimX/aimZ`，绝不把单次按下边沿重复多 tick）。
5. **序号与缓冲复位**：`RECONNECT` 成功重置 `lastAckSeq[idx] = 0`；`MATCH_START`（含 Rematch）重置 `lastAckSeq = [0, 0]`、`serverTick = 0`；客户端收到 `FULL_SYNC`/`MATCH_START` 清空 `SnapshotBuffer`、重置本地 `seq = 0` 并调用 `InputController.resetAndRebind()`。
6. **`waiting` 阶段刷新重连不变量**：客户端收到 `FULL_SYNC` 时，若 `payload.snapshot.phase === 'waiting'`，保持 `mode = 'lobby'` 与大厅界面可见，仅同步 `roomCode`/`yourSide`/`playerIndex`/`onlineConfig`，不误切比赛 HUD。

---

## 四、Blender 5.2 风格化 `.glb` 资产契约（WP-Asset ↔ WP2 锁定）

### 4.1 资产路径与生成复现命令
- **源脚本**：`tennis-2k/assets/source/generate_player_avatar.py`（同时支持**无参默认运行**导出至 `tennis-2k/client/public/assets/models/tennis_player.glb` 与 `-- --output <path>` 指定路径覆盖）
- **资产清单**：`tennis-2k/assets/source/README.md`
- **导出目标**：`tennis-2k/client/public/assets/models/tennis_player.glb`
- **无头复现命令**：
  ```powershell
  # 默认路径一键导出
  & "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tennis-2k/assets/source/generate_player_avatar.py
  # 或显式指定输出路径
  & "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tennis-2k/assets/source/generate_player_avatar.py -- --output tennis-2k/client/public/assets/models/tennis_player.glb
  ```
- **前端加载路径**：`${normalizeBase(import.meta.env.BASE_URL)}assets/models/tennis_player.glb`（兼容 `/` 与 `/tennis/`）。

### 4.2 几何、21 骨层级、独立节点、朝向、材质与动画精确契约（WP2 强依赖，严禁偏差）

| 维度 | 契约精确要求 |
| --- | --- |
| **坐标系、朝向与持拍侧** | Blender 建模正面朝 **`+Y`**，使用 `export_yup=True` 导出为 glTF 2.0 标准 Y-up（单位米 `m`）后：**人物正面/鼻尖/遮阳帽檐严格朝 `-Z`**（对齐游戏 `yaw = 0`）、反戴鸭舌帽檐朝 `+Z`、**右手持拍 `Hand_R` / `RacquetSocket` 严格位于 `+X` 侧**、总高 `1.75–1.82 m`、脚底 `|minY| ≤ 0.01 m` |
| **网格、体量与 Draw Calls** | 一体平滑蒙皮主体 + 合身短袖球衣/短裤/中筒袜/运动鞋/立体发型/简约五官/细化 Y 喉球拍；**`.glb` 原始体积 `≤ 350 KB`**；单角色可见三角面 **`3,500–7,500`**（全文件所有节点总计 `≤ 9,000`）；必须含至少 1 个 `SkinnedMesh`；**单角色 Draw Calls `≤ 18`**（双人 `≤ 36`，全场景 `≤ 150`） |
| **21 骨 `Armature` 精确父子层级** | `Hips` → `Spine` → `Chest` → (`Neck` → `Head` → `HeadgearSocket`; `Shoulder_L` → `UpperArm_L` → `Forearm_L` → `Hand_L`; `Shoulder_R` → `UpperArm_R` → `Forearm_R` → `Hand_R` → `RacquetSocket`); `Hips` → (`Thigh_L` → `Shin_L` → `Foot_L`; `Thigh_R` → `Shin_R` → `Foot_R`) |
| **独立命名的可切换场景节点（6 个，严禁合并进主体网格）** | 均须可由 `root.getObjectByName(name)` 检索并独立切换 `.visible`：<br>• `Headgear_Headband`（挂于 `HeadgearSocket`，`power` 显示，材质 `Mat_JerseyAccent`）<br>• `Headgear_Visor`（挂于 `HeadgearSocket`，`serve_volley` 显示，带身 `Mat_JerseyPrimary` / 帽檐 `Mat_JerseyAccent`）<br>• `Headgear_CapBackwards`（挂于 `HeadgearSocket`，`defender` 显示，帽冠 `Mat_JerseyAccent` / 帽檐 `Mat_JerseyPrimary`）<br>• `Wristband_L`（挂于 `Forearm_L`，`power` 与 `allcourt` 显示，材质 `Mat_JerseyAccent`）<br>• `Wristband_R`（挂于 `Forearm_R`，`power` 与 `allcourt` 显示，材质 `Mat_JerseyAccent`）<br>• `Racquet`（挂于 `RacquetSocket`，常显，拍框 `Mat_RacquetFrame` / 球线 `Mat_RacquetStrings` / 可选握把静态材质） |
| **必需的 10 个换色材质槽 + 允许静态五官材质** | 必须包含以下 10 个精确命名的运行期换色材质：`Mat_JerseyPrimary`、`Mat_JerseyAccent`、`Mat_Shorts`、`Mat_Skin`、`Mat_Hair`、`Mat_Socks`、`Mat_ShoeUpper`、`Mat_ShoeSole`、`Mat_RacquetFrame`、`Mat_RacquetStrings`。<br>**允许额外静态材质**用于五官与细节（如 `Mat_EyeWhite`、`Mat_EyeIris`、`Mat_FaceDetail`、`Mat_RacquetGrip`），WP2 运行期不改其颜色，防止眼球/眉毛/握把随球衣变色 |
| **8 条嵌入式 NLA 动画 Clip 与防 `scale` 覆写规则** | 精确命名：`idle`（循环）、`run`（循环）、`slide`（单次/循环）、`serve_toss`（`0.35 s`）、`forehand`（`0.36 s`）、`backhand`（`0.36 s`）、`lob`（`0.40 s`）、`celebrate`（循环）。<br>**防覆写铁律**：8 条动画仅可写入骨骼旋转与 `Hips` 位移轨道，**严禁导出任何骨骼的 `scale` 轨道**，确保 WP2 施加于 `Chest` 骨骼的 `shoulderScale` 不被 `AnimationMixer` 覆写 |

---

## 五、客户端内部接口与输入/渲染强契约（WP2 必守）

> 注：`InputDiagnostics` 与 `TestStateSnapshot` 由 **`@court2k/shared` 唯一导出**（定义见 §2.2），`client/src/contracts.ts` 直接从 `@court2k/shared` 导入复用于 `ClientInputController` 与 `Court2KTestHook`，严禁重复定义冲突类型。

```ts
import type * as THREE from 'three';
import type {
  ArchetypeConfig,
  InputDiagnostics,
  PlayerInputFrame,
  PlayerState,
  ScorePatch,
  TestStateSnapshot,
} from '@court2k/shared';

export interface AvatarStatus {
  loaded: boolean;
  source: 'glb' | 'fallback';
  triangles: number;
  clipNames: string[];
}

export interface PlayerAvatarController {
  readonly root: THREE.Group;
  setArchetype(config: ArchetypeConfig): void;
  updatePose(player: PlayerState, dt: number): void;
  getStatus(): AvatarStatus;
  dispose(): void;
}

export interface ClientInputController {
  attach(): void;
  detach(): void;
  resetAndRebind(reason: string): void;
  sampleFrame(seq: number): PlayerInputFrame;
  getDiagnostics(): InputDiagnostics;
}
```

### 5.1 `ClientInputController.sampleFrame()` 4 条硬性行为契约（与服务端 §3.3 端到端闭环）
1. **忽略自动连发 `e.repeat === true`**：长按 `J`/`K`/`L` 触发的浏览器 `keydown(repeat=true)` **绝不**产生 `actionPressed = true`，避免在 `stepMatch` 中反复将 `holdDurationSec` 重置为 `dt` 而破坏长按松手取消（`AC-05` ④）。
2. **单帧内快按锁存**：若 `keydown` 与 `keyup` 在同一 16.6 ms 帧内连续发生（`sampleFrame` 尚未采样），必须锁存 1 帧合成边沿——当帧 `sampleFrame` 返回 `{ action: key, actionPressed: true }`，下一帧恢复 `{ action: 'none', actionPressed: false }`，绝不丢弃快点短按。
3. **按住期间无缝切换球种**：当前正按住球种键（如 `J`）时按下另一球种键（如 `K`），立即切换 `currentAction = 'K'` 并锁存 `actionPressed = true`；随后松开旧键 `J` 时**绝不清空**当前激活的 `K`；松开当前激活键时若另有已按下球种键则回落至该键（不重发 `actionPressed`），否则归 `'none'`。
4. **`resetAndRebind(reason)` 完整清空**：必须同时清空 `pressedKeys`、`currentAction = 'none'`、待发 `actionPressed` 锁存与快按锁存，先解绑再重绑 `window`/`document` 监听，并 `blur()` 焦点元素（覆盖全部 6 类触发时机：`FULL_SYNC`、`MATCH_RESUMED`、`HAWKEYE_END`、单机暂停恢复、`blur/focus/visibilitychange`、初始挂载）。

### 5.2 `GlbPlayerAvatar` 与受控测试钩子约束
- **`GlbPlayerAvatar`**：通过 `GLTFLoader` 加载并缓存单一 `.glb`，双角色各自 `SkeletonUtils.clone()` 并深克隆 10 个换色材质实例；按 `config.shoulderScale` 设置 `Chest` 骨骼缩放（`x = shoulderScale, y = 1, z = config.id === 'defender' ? 0.94 : 1.0`）；按 `headgear` 切换 `Headgear_*` 与 `Wristband_L/R` 可见性；严禁静默回退（加载失败时 `getStatus()` 必须返回 `{ loaded: false, source: 'fallback' }` 并 `console.error`）。
- **地面预选球种环**：当 `player.stance.armedAction !== 'none'` 且处于 `rally` 时，在本地玩家脚下渲染对应颜色的柔和地面环（`J` `#f59e0b`、`K` `#06b6d4`、`L` `#a855f7`），并对上半身叠加柔和引拍蓄势转向；未武装时立即隐藏。
- **`spawnIncomingBall` 测试钩子坐标系**：`window.__COURT2K_TEST__.spawnIncomingBall(opts)` 接收**当前客户端本地视图坐标**（`targetZ > 0` 永远指向己方近端半场），`GameApp` 乘以 `this.yourSide` 转为规范世界坐标后传入引擎或发往 `TEST_COMMAND(spawn_incoming_ball)`，默认 `forPlayerIndex = this.playerIndex`。

---

## 六、工作包严格边界、端口分配与并行纪律

| 工作包 | 独占写目录与报告目录 | 依赖基点 | Builder 端口 | Reviewer 端口 | Tester 端口 / 会话 |
| --- | --- | --- | --- | --- | --- |
| **契约评审** | 只读 `docs/SPEC.md`、`CONTRACT.md`；报告 `docs/review/contract/**` | 用户批准开工 | 不适用 | `4900–4999` | 不适用 |
| **WP1 (`shared`)** | `tennis-2k/shared/**`；报告 `docs/review/wp1/**` | 契约 PASS | `3100–3199` | `4100–4199` | 不适用（脚本闭环） |
| **WP-Asset (`assets`)** | `tennis-2k/assets/**`、`tennis-2k/client/public/assets/models/**`；报告 `docs/review/wp-asset/**` | 契约 PASS（**与 WP1 并行**） | 不适用（Blender CLI） | 不适用（脚本+渲染图审） | 不适用 |
| **WP2 (`client`)** | `tennis-2k/client/src/**`、`client/tests/**`、`client/index.html`、`client/vite.config.ts`；报告 `docs/review/wp2/**` | WP1 + WP-Asset 合入 V2 基点 | `3200–3299`（`3201`） | `4200–4299`（`4201`） | `4510–4519`（独立会话） |
| **WP3 (`server`)** | `tennis-2k/server/**`；报告 `docs/review/wp3/**` | WP1 合入 V2 基点（**与 WP2 并行**） | `3300–3399`（`3301`） | `4300–4399`（`4301`） | 不适用（脚本闭环） |
| **整合与整体评审 (`integration/v2`)** | 整合分支与联调脚本；报告 `docs/review/integration/**` | WP1 + WP-Asset + WP2 + WP3 全 PASS | `3100–3199` | `4900–4999`（`4901`/`4902`） | `4520–4529`（双独立 Context） |

> **npm Workspaces 红线**：V2 零新增第三方 npm 依赖，WP1 / WP-Asset / WP2 / WP3 均**严禁修改**根目录 `tennis-2k/package.json`、`package-lock.json` 或各自 `package.json` 依赖项。

---

## 七、跨工作包端到端联调场景（整合评审第 1 轮必验）

- **测试数据与脚本责任人**：整合阶段 Builder 负责提供一键本地联调启动脚本、`/tennis/` 反代测试脚本与截图亮度校验脚本；整体评审 Reviewer 编排一次性测试简报，双独立浏览器 Context Tester 执行 `E2E-01` ~ `E2E-05` 取证。

| 场景编号 | 关联 SPEC | 入口与前置 | 端到端验证步骤 | 通过标准 |
| --- | --- | --- | --- | --- |
| **`E2E-01`** | `AC-02`, `AC-11`, `AC-12` | 双独立浏览器 Context（**不带 `?test=1`**） | P0 建房得 4 位码 → P1 选不同流派入房开赛 → 双方使用 V2 自动触球（`J` 深/`K` 前/`A`/`D` 左右）完打 ≥ 1 局 Fast4 → 途中 P0 `Esc` 暂停、P1 恢复走 3s 倒计时并立即操作 → 完赛双方点击 Rematch 开新局 | 双端均真实加载 Blender `.glb` 角色且处于明亮大满贯日场（无暗箱、无绿条、无火热槽）；双方均在下方近端向上击球且方向 100% 对称；暂停恢复不失灵；Rematch 正确重置比分与 `[3,3]` 暂停次数 |
| **`E2E-02`** | `AC-05`, `AC-06` | 双独立浏览器 Context（`?test=1`，服务端 `ENABLE_TEST_HOOKS=1`） | 联机下对 P1 调用 `spawnIncomingBall` 发近身来球：① P1 仅移动不按 `J`/`K`/`L`；② P1 提前短按 `K` + `A`（放小球瞄左） | ① P1 0 次自动挥拍、球自然落空；② P1 的 `actionPressed` 边沿经服务端 60Hz 准确触发前场短球（`|Z| ∈ [1.8, 3.9] m`）并镜像同步至 P0 |
| **`E2E-03`** | `AC-08`, `AC-12` | 双独立浏览器 Context（`?test=1`） | 联机触发 `8 cm` 压线球（`IN`）、`10 cm` 出界球（`OUT`）及 `25 cm` 反例 | `8 cm`/`10 cm` 双端同步切入 1.8s 3D 鹰眼特写（P1 球印/镜头精确 180° 镜像）并同判 `IN`/`OUT`，结束后双方按键立即恢复；`25 cm` 不触发 |
| **`E2E-04`** | `AC-13` | 双独立浏览器 Context | ① 对局中 P1 刷新页面 4s 内自动重连，3s 倒计时结束瞬间 P1 立即按 `WASD` + `J`/`K`；② 另测 P1 断线超 15s；③ 未开赛 `waiting` 房内 P1 刷新重连 | ① 原比分续打且 **P1 移动与自动触球 100% 即时响应**；② 超 15s 双方仅收唯一 `MATCH_OVER(forfeit)` 结算弹窗；③ `waiting` 房刷新仍留在大厅等待视图 |
| **`E2E-05`** | `AC-11`, `AC-14`, `AC-16` | `VITE_BASE_PATH=/tennis/` 生产构建 + 本地静态/WS 反代 | 访问 `http://127.0.0.1:<port>/tennis/?netdebug=1` 跑通单机与 1v1 联机，并行执行 16 并发房间 60Hz 30 秒压测 | 静态资源、**`/tennis/assets/models/tennis_player.glb`** 与 `/tennis/ws` 均 0 个 404；`?netdebug=1` 指标完整、单角色 Draw Calls `≤ 18`、全场景 `≤ 150`；16 房平均 tick `< 8 ms`、RSS `≤ 256 MB` |
