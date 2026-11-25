export type CourtId = 'hard' | 'clay' | 'grass';
export type ArchetypeId = 'power' | 'allcourt' | 'serve_volley' | 'defender';
export type MatchFormat = 'fast4' | 'super_tiebreak';
export type AIDifficulty = 'rookie' | 'pro' | 'legend';
export type PlayerSide = 1 | -1; // +1 = P0(+Z近端), -1 = P1(-Z远端)
export type PlayerIndex = 0 | 1; // 0 对应 side=+1, 1 对应 side=-1

export type ShotActionKey = 'none' | 'J' | 'K' | 'L';
export type InputPhase = 'idle' | 'hold' | 'release';
export type ShotType = 'serve_flat' | 'serve_kick' | 'topspin' | 'slice' | 'dropshot' | 'lob';
export type ShotQuality = 'PERFECT' | 'GOOD' | 'EARLY' | 'LATE' | 'VERY_EARLY' | 'VERY_LATE';
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
  | 'TIEBREAK';

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

export interface CourtConfig {
  readonly id: CourtId;
  readonly label: string;
  readonly innerColor: string;
  readonly outerColor: string;
  readonly lineColor: string;
  readonly restitutionY: number;
  readonly retentionXZ: number;
  readonly spinGrip: number;
  readonly playerFriction: number;
  readonly slideDurationSec: number;
  readonly hasClayDust: boolean;
}

export interface ArchetypeConfig {
  readonly id: ArchetypeId;
  readonly label: string;
  readonly power: number;
  readonly speed: number;
  readonly spin: number;
  readonly timing: number;
  readonly net: number; // power+speed+spin+timing+net === 400
  readonly jerseyPrimary: string;
  readonly jerseyAccent: string;
  readonly headgear: 'headband' | 'wristband_only' | 'visor' | 'cap_backwards';
  readonly shoulderScale: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PRNG {
  next(): number; // [0, 1)
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
  moveX: number;
  moveZ: number;
  aimX: number;
  aimZ: number;
  action: ShotActionKey;
  phase: InputPhase;
}

export interface MeterState {
  active: boolean;
  action: ShotActionKey;
  progress: number;
  sweetCenter: number;
  effectiveHalfWidth: number;
  lastQuality: ShotQuality | null;
}

export interface PlayerState {
  index: PlayerIndex;
  side: PlayerSide;
  archetype: ArchetypeId;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  anim: PlayerAnimState;
  animTime: number;
  isSliding: boolean;
  slideTimer: number;
  moveAccelTime: number;
  meter: MeterState;
  takeoverEnergy: number;
  takeoverPointsLeft: number;
  takeoverCooldown: boolean;
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
  perfectShots: number;
  totalMeterShots: number;
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

export type TestCommandPayload =
  | { cmd: 'set_seed'; args: { seed: number } }
  | { cmd: 'set_score'; args: ScorePatch }
  | { cmd: 'set_takeover'; args: { playerIndex: PlayerIndex; value: number } }
  | { cmd: 'trigger_hawkeye'; args: { inBounds: boolean; distCm: number; line?: 'sideline' | 'baseline' } }
  | { cmd: 'fast_forward_pause'; args: { seconds: number } };

export type GameEvent =
  | {
      type: 'SHOT_HIT';
      hitter: PlayerIndex;
      shotType: ShotType;
      quality: ShotQuality;
      speedKmh: number;
      pos: Vec3;
    }
  | {
      type: 'BOUNCE';
      pos: Vec3;
      court: CourtId;
      bounceIndex: number;
      inBounds: boolean;
    }
  | { type: 'NET_LET'; isServe: boolean; pos: Vec3 }
  | { type: 'HAWKEYE_START'; hawkeye: HawkeyeState }
  | { type: 'HAWKEYE_END'; isIn: boolean }
  | {
      type: 'POINT_SCORED';
      winner: PlayerIndex;
      reason: 'ace' | 'winner' | 'unforced_error' | 'double_fault' | 'out' | 'net' | 'double_bounce';
      score: ScoreState;
    }
  | { type: 'TAKEOVER_ON'; player: PlayerIndex }
  | { type: 'TAKEOVER_OFF'; player: PlayerIndex }
  | { type: 'PAUSE_TIMEOUT_RESUMING'; resumeCountdownSec: number }
  | { type: 'PAUSE_RESUMED'; serverTick: number }
  | {
      type: 'MATCH_OVER';
      winner: PlayerIndex;
      reason: 'normal' | 'forfeit';
      forfeitedBy?: PlayerIndex;
      score: ScoreState;
      stats: [PlayerMatchStats, PlayerMatchStats];
    };

export type ClientMessage =
  | { type: 'CREATE_ROOM'; payload: { court: CourtId; format: MatchFormat; archetype: ArchetypeId } }
  | { type: 'JOIN_ROOM'; payload: { roomCode: string; archetype: ArchetypeId } }
  | { type: 'RECONNECT'; payload: { roomCode: string; sessionToken: string } }
  | { type: 'SELECT_LOADOUT'; payload: { archetype: ArchetypeId; court?: CourtId; format?: MatchFormat } }
  | { type: 'READY'; payload: { ready?: boolean } }
  | { type: 'PLAYER_INPUT'; payload: PlayerInputFrame & { clientTime: number } }
  | { type: 'PAUSE_REQUEST'; payload: Record<string, never> }
  | { type: 'RESUME_REQUEST'; payload: Record<string, never> }
  | { type: 'REMATCH_REQUEST'; payload: Record<string, never> }
  | { type: 'PING'; payload: { clientTime: number } }
  | { type: 'TEST_COMMAND'; payload: TestCommandPayload };

export type ServerMessage =
  | {
      type: 'ROOM_CREATED';
      payload: {
        roomCode: string;
        sessionToken: string;
        yourSide: 1;
        playerIndex: 0;
        matchConfig: MatchConfig;
      };
    }
  | {
      type: 'ROOM_JOINED';
      payload: {
        roomCode: string;
        sessionToken: string;
        yourSide: -1;
        playerIndex: 1;
        matchConfig: MatchConfig;
        ready: [boolean, boolean];
      };
    }
  | {
      type: 'LOBBY_UPDATE';
      payload: {
        roomCode: string;
        matchConfig: MatchConfig;
        connected: [boolean, boolean];
        ready: [boolean, boolean];
      };
    }
  | {
      type: 'MATCH_START';
      payload: {
        serverTick: 0;
        yourSide: PlayerSide;
        playerIndex: PlayerIndex;
        snapshot: MatchState;
      };
    }
  | {
      type: 'STATE_SNAPSHOT';
      payload: { serverTick: number; serverTime: number; state: MatchState };
    }
  | { type: 'GAME_EVENT'; payload: { serverTick: number; event: GameEvent } }
  | {
      type: 'MATCH_PAUSED';
      payload: {
        reason: 'manual' | 'disconnect';
        initiatedBy: PlayerIndex;
        remainingSec: number;
        manualPausesLeft: [number, number];
      };
    }
  | {
      type: 'MATCH_RESUMING';
      payload: { resumeCountdownSec: number; initiatedBy: PlayerIndex | 'timeout' | 'reconnect' };
    }
  | { type: 'MATCH_RESUMED'; payload: { serverTick: number; requireInputReset: true } }
  | {
      type: 'OPPONENT_DISCONNECTED';
      payload: { graceSeconds: 15; disconnectedIndex: PlayerIndex };
    }
  | {
      type: 'OPPONENT_RECONNECTED';
      payload: { resumeInSeconds: 3; reconnectedIndex: PlayerIndex };
    }
  | {
      type: 'FULL_SYNC';
      payload: {
        roomCode: string;
        yourSide: PlayerSide;
        playerIndex: PlayerIndex;
        snapshot: MatchState;
        requireInputReset: true;
      };
    }
  | { type: 'REMATCH_STATUS'; payload: { requested: [boolean, boolean] } }
  | { type: 'PONG'; payload: { clientTime: number; serverTick: number } }
  | { type: 'ERROR'; payload: { code: ErrorCode; message: string } };

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
  matchState: MatchState | null;
  qualityTier: 'HIGH' | 'MEDIUM' | 'LOW';
  activeDpr: number;
  estHz: number;
  fpsCapEnabled: boolean;
  upgradeCount: number;
  fps: number;
  maxFrameMs: number;
  drawCalls: number;
  inputDiagnostics: InputDiagnostics;
}
