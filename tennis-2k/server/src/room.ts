import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import {
  applyDisconnect,
  applyReconnect,
  applyScorePatch,
  cloneMatchState,
  COURT_DIM,
  createMatchState,
  createRng,
  fastForwardPauseState,
  launchHawkeyeTestBall,
  requestManualPause,
  requestManualResume,
  stepMatch,
  toWorldInput,
  type ArchetypeId,
  type ClientMessage,
  type CourtId,
  type ErrorCode,
  type GameEvent,
  type MatchConfig,
  type MatchFormat,
  type MatchState,
  type PlayerIndex,
  type PlayerInputFrame,
  type PlayerSide,
  type PRNG,
  type ServerMessage,
  type TestCommandPayload,
} from '@court2k/shared';

const IDLE_INPUT: PlayerInputFrame = {
  seq: 0,
  moveX: 0,
  moveZ: 0,
  aimX: 0,
  aimZ: 0,
  action: 'none',
  phase: 'idle',
};

const MAX_INPUT_QUEUE = 8;

function generateSessionToken(): string {
  return randomBytes(24).toString('hex');
}

function sendRaw(ws: WebSocket | null, serialized: string): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(serialized);
  }
}

export function sendServerMessage(ws: WebSocket | null, msg: ServerMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function sendError(ws: WebSocket | null, code: ErrorCode, message: string): void {
  sendServerMessage(ws, { type: 'ERROR', payload: { code, message } });
}

export class Room {
  readonly code: string;
  readonly createdAtMs: number;
  lastActivityAtMs: number;
  emptySinceMs: number | null = null;

  matchConfig: MatchConfig;
  state: MatchState;
  rng: PRNG;

  private sockets: [WebSocket | null, WebSocket | null] = [null, null];
  private sessionTokens: [string | null, string | null] = [null, null];
  private connected: [boolean, boolean] = [false, false];
  private ready: [boolean, boolean] = [false, false];
  private rematchRequested: [boolean, boolean] = [false, false];
  private inputQueues: [PlayerInputFrame[], PlayerInputFrame[]] = [[], []];
  private lastInputs: [PlayerInputFrame, PlayerInputFrame] = [{ ...IDLE_INPUT }, { ...IDLE_INPUT }];
  private shouldRecycle = false;

  constructor(
    code: string,
    hostWs: WebSocket,
    court: CourtId,
    format: MatchFormat,
    archetype: ArchetypeId,
    seed: number,
    nowMs: number
  ) {
    this.code = code;
    this.createdAtMs = nowMs;
    this.lastActivityAtMs = nowMs;

    this.matchConfig = {
      mode: 'online',
      court,
      format,
      archetypes: [archetype, 'allcourt'],
      seed,
    };
    this.rng = createRng(seed);
    this.state = createMatchState(this.matchConfig);
    this.state.phase = 'waiting';

    const token = generateSessionToken();
    this.sockets[0] = hostWs;
    this.sessionTokens[0] = token;
    this.connected[0] = true;

    sendServerMessage(hostWs, {
      type: 'ROOM_CREATED',
      payload: {
        roomCode: this.code,
        sessionToken: token,
        yourSide: 1,
        playerIndex: 0,
        matchConfig: this.cloneMatchConfig(),
      },
    });
  }

  private cloneMatchConfig(): MatchConfig {
    return {
      ...this.matchConfig,
      archetypes: [this.matchConfig.archetypes[0], this.matchConfig.archetypes[1]],
    };
  }

  get isRecycled(): boolean {
    return this.shouldRecycle;
  }

  get isActiveSimulation(): boolean {
    return this.state.phase !== 'waiting' && this.state.phase !== 'match_over' && !this.shouldRecycle;
  }

  get isWaitingOrOver(): boolean {
    return this.state.phase === 'waiting' || this.state.phase === 'match_over';
  }

  get bothDisconnected(): boolean {
    return !this.connected[0] && !this.connected[1];
  }

  getSocket(idx: PlayerIndex): WebSocket | null {
    return this.sockets[idx];
  }

  touch(nowMs: number): void {
    this.lastActivityAtMs = nowMs;
  }

  private clearInputs(): void {
    this.inputQueues = [[], []];
    this.lastInputs = [{ ...IDLE_INPUT }, { ...IDLE_INPUT }];
  }

  private broadcast(msg: ServerMessage): void {
    const serialized = JSON.stringify(msg);
    sendRaw(this.sockets[0], serialized);
    sendRaw(this.sockets[1], serialized);
  }

  private broadcastSnapshot(nowMs: number): void {
    this.broadcast({
      type: 'STATE_SNAPSHOT',
      payload: {
        serverTick: this.state.tick,
        serverTime: nowMs,
        state: this.state,
      },
    });
  }

  private broadcastLobbyUpdate(): void {
    this.broadcast({
      type: 'LOBBY_UPDATE',
      payload: {
        roomCode: this.code,
        matchConfig: this.cloneMatchConfig(),
        connected: [this.connected[0], this.connected[1]],
        ready: [this.ready[0], this.ready[1]],
      },
    });
  }

  canJoinGuest(): { ok: true } | { ok: false; code: ErrorCode; message: string } {
    if (this.state.phase !== 'waiting') {
      return { ok: false, code: 'MATCH_ALREADY_STARTED', message: '比赛已开始' };
    }
    if (this.connected[1]) {
      return { ok: false, code: 'ROOM_FULL', message: '房间已满' };
    }
    return { ok: true };
  }

  joinGuest(guestWs: WebSocket, archetype: ArchetypeId, nowMs: number): { ok: true } | { ok: false; code: ErrorCode; message: string } {
    this.touch(nowMs);
    const check = this.canJoinGuest();
    if (!check.ok) {
      return check;
    }

    const token = generateSessionToken();
    this.sockets[1] = guestWs;
    this.sessionTokens[1] = token;
    this.connected[1] = true;
    this.ready[1] = false;
    this.matchConfig.archetypes[1] = archetype;
    this.state.config.archetypes[1] = archetype;
    this.state.players[1].archetype = archetype;
    this.emptySinceMs = null;

    sendServerMessage(guestWs, {
      type: 'ROOM_JOINED',
      payload: {
        roomCode: this.code,
        sessionToken: token,
        yourSide: -1,
        playerIndex: 1,
        matchConfig: this.cloneMatchConfig(),
        ready: [this.ready[0], this.ready[1]],
      },
    });

    this.broadcastLobbyUpdate();
    return { ok: true };
  }

  verifyAndBindReconnect(
    ws: WebSocket,
    sessionToken: string,
    nowMs: number
  ): { ok: true; playerIndex: PlayerIndex; displacedSocket: WebSocket | null } | { ok: false } {
    let idx: PlayerIndex | null = null;
    if (this.sessionTokens[0] !== null && this.sessionTokens[0] === sessionToken) {
      idx = 0;
    } else if (this.sessionTokens[1] !== null && this.sessionTokens[1] === sessionToken) {
      idx = 1;
    }
    if (idx === null) {
      return { ok: false };
    }

    this.touch(nowMs);
    const displacedSocket = this.sockets[idx] && this.sockets[idx] !== ws ? this.sockets[idx] : null;
    this.sockets[idx] = ws;
    this.connected[idx] = true;
    this.emptySinceMs = null;
    this.inputQueues[idx] = [];
    this.lastInputs[idx] = { ...IDLE_INPUT };

    const side: PlayerSide = idx === 0 ? 1 : -1;

    if (this.state.phase === 'waiting') {
      const rec = applyReconnect(this.state, idx);
      this.state = rec.state;
      sendServerMessage(ws, {
        type: 'FULL_SYNC',
        payload: {
          roomCode: this.code,
          yourSide: side,
          playerIndex: idx,
          snapshot: cloneMatchState(this.state),
          requireInputReset: true,
        },
      });
      this.broadcastLobbyUpdate();
      return { ok: true, playerIndex: idx, displacedSocket };
    }

    const wasPausedDisconnect = this.state.phase === 'paused_disconnect';
    const rec = applyReconnect(this.state, idx);
    this.state = rec.state;

    sendServerMessage(ws, {
      type: 'FULL_SYNC',
      payload: {
        roomCode: this.code,
        yourSide: side,
        playerIndex: idx,
        snapshot: cloneMatchState(this.state),
        requireInputReset: true,
      },
    });

    if (
      this.state.phase === 'match_over' &&
      (this.rematchRequested[0] || this.rematchRequested[1])
    ) {
      sendServerMessage(ws, {
        type: 'REMATCH_STATUS',
        payload: { requested: [this.rematchRequested[0], this.rematchRequested[1]] },
      });
    }

    if (wasPausedDisconnect && rec.bothConnected) {
      this.broadcast({
        type: 'OPPONENT_RECONNECTED',
        payload: {
          resumeInSeconds: COURT_DIM.RESUME_COUNTDOWN_SEC,
          reconnectedIndex: idx,
        },
      });
      this.broadcast({
        type: 'MATCH_RESUMING',
        payload: {
          resumeCountdownSec: this.state.pause.resumeCountdownSec,
          initiatedBy: 'reconnect',
        },
      });
      this.broadcastSnapshot(nowMs);
    }

    return { ok: true, playerIndex: idx, displacedSocket };
  }

  handleDisconnect(idx: PlayerIndex, ws: WebSocket, nowMs: number): void {
    // Ignore stale close event if socket was already replaced by reconnect
    if (this.sockets[idx] !== ws) {
      return;
    }

    this.sockets[idx] = null;
    this.connected[idx] = false;
    this.inputQueues[idx] = [];
    this.lastInputs[idx] = { ...IDLE_INPUT };

    if (this.state.phase === 'waiting') {
      this.ready[idx] = false;
      if (idx === 1) {
        // Guest slot is immediately freed during waiting
        this.sessionTokens[1] = null;
        this.matchConfig.archetypes[1] = 'allcourt';
        this.state.config.archetypes[1] = 'allcourt';
        this.state.players[1].archetype = 'allcourt';
      }
      this.state = applyDisconnect(this.state, idx);
      if (this.bothDisconnected) {
        this.emptySinceMs = nowMs;
      }
      this.broadcastLobbyUpdate();
      return;
    }

    if (this.state.phase === 'match_over') {
      this.rematchRequested[idx] = false;
      this.state = applyDisconnect(this.state, idx);
      if (this.bothDisconnected) {
        this.emptySinceMs = nowMs;
      }
      this.broadcast({
        type: 'REMATCH_STATUS',
        payload: { requested: [this.rematchRequested[0], this.rematchRequested[1]] },
      });
      return;
    }

    const prevPhase = this.state.phase;
    this.state = applyDisconnect(this.state, idx);
    this.clearInputs();

    if (prevPhase !== 'paused_disconnect' && this.state.phase === 'paused_disconnect') {
      this.emitDisconnectPaused(idx, nowMs);
    }
  }

  private emitDisconnectPaused(disconnectedIdx: PlayerIndex, nowMs: number): void {
    this.broadcast({
      type: 'MATCH_PAUSED',
      payload: {
        reason: 'disconnect',
        initiatedBy: disconnectedIdx,
        remainingSec: this.state.pause.remainingSec,
        manualPausesLeft: [
          this.state.pause.manualPausesLeft[0],
          this.state.pause.manualPausesLeft[1],
        ],
      },
    });
    this.broadcast({
      type: 'OPPONENT_DISCONNECTED',
      payload: {
        graceSeconds: COURT_DIM.DISCONNECT_GRACE_SEC,
        disconnectedIndex: disconnectedIdx,
      },
    });
    this.broadcastSnapshot(nowMs);
  }

  handleMessage(
    idx: PlayerIndex,
    ws: WebSocket,
    msg: ClientMessage,
    nowMs: number,
    enableTestHooks: boolean
  ): void {
    this.touch(nowMs);

    switch (msg.type) {
      case 'PING': {
        sendServerMessage(ws, {
          type: 'PONG',
          payload: { clientTime: msg.payload.clientTime, serverTick: this.state.tick },
        });
        return;
      }

      case 'SELECT_LOADOUT': {
        if (this.state.phase !== 'waiting') {
          sendError(ws, 'INVALID_PHASE', '比赛开始后无法修改配置');
          return;
        }
        this.matchConfig.archetypes[idx] = msg.payload.archetype;
        this.state.config.archetypes[idx] = msg.payload.archetype;
        this.state.players[idx].archetype = msg.payload.archetype;

        if (idx === 0) {
          let resetReady = false;
          if (msg.payload.court !== undefined && msg.payload.court !== this.matchConfig.court) {
            this.matchConfig.court = msg.payload.court;
            this.state.config.court = msg.payload.court;
            resetReady = true;
          }
          if (msg.payload.format !== undefined && msg.payload.format !== this.matchConfig.format) {
            this.matchConfig.format = msg.payload.format;
            this.state.config.format = msg.payload.format;
            resetReady = true;
          }
          if (resetReady) {
            this.ready = [false, false];
          }
        }
        this.broadcastLobbyUpdate();
        return;
      }

      case 'READY': {
        if (this.state.phase !== 'waiting') {
          sendError(ws, 'INVALID_PHASE', '当前阶段无法切换就绪状态');
          return;
        }
        this.ready[idx] = msg.payload.ready ?? true;
        this.broadcastLobbyUpdate();

        if (this.connected[0] && this.connected[1] && this.ready[0] && this.ready[1]) {
          this.startMatch();
        }
        return;
      }

      case 'PLAYER_INPUT': {
        if (
          this.state.phase !== 'serve_ready' &&
          this.state.phase !== 'serve_toss' &&
          this.state.phase !== 'rally'
        ) {
          return;
        }
        if (msg.payload.seq <= this.state.lastAckSeq[idx]) {
          return;
        }
        this.state.lastAckSeq[idx] = msg.payload.seq;
        const side: PlayerSide = idx === 0 ? 1 : -1;
        const worldFrame = toWorldInput(
          {
            seq: msg.payload.seq,
            moveX: msg.payload.moveX,
            moveZ: msg.payload.moveZ,
            aimX: msg.payload.aimX,
            aimZ: msg.payload.aimZ,
            action: msg.payload.action,
            phase: msg.payload.phase,
          },
          side
        );
        const queue = this.inputQueues[idx];
        if (queue.length >= MAX_INPUT_QUEUE) {
          const idleIdx = queue.findIndex((f) => f.phase === 'idle');
          if (idleIdx !== -1) {
            queue.splice(idleIdx, 1);
          } else {
            queue.shift();
          }
        }
        queue.push(worldFrame);
        return;
      }

      case 'PAUSE_REQUEST': {
        const res = requestManualPause(this.state, idx);
        if (!res.ok) {
          sendError(ws, res.code, res.message);
          return;
        }
        this.state = res.state;
        this.clearInputs();
        this.broadcast({
          type: 'MATCH_PAUSED',
          payload: {
            reason: 'manual',
            initiatedBy: idx,
            remainingSec: this.state.pause.remainingSec,
            manualPausesLeft: [
              this.state.pause.manualPausesLeft[0],
              this.state.pause.manualPausesLeft[1],
            ],
          },
        });
        this.broadcastSnapshot(nowMs);
        return;
      }

      case 'RESUME_REQUEST': {
        const res = requestManualResume(this.state, idx);
        if (!res.ok) {
          sendError(ws, res.code, res.message);
          return;
        }
        this.state = res.state;
        if (res.alreadyResuming) {
          return;
        }
        this.clearInputs();
        this.broadcast({
          type: 'MATCH_RESUMING',
          payload: {
            resumeCountdownSec: this.state.pause.resumeCountdownSec,
            initiatedBy: idx,
          },
        });
        this.broadcastSnapshot(nowMs);
        return;
      }

      case 'REMATCH_REQUEST': {
        if (this.state.phase !== 'match_over') {
          sendError(ws, 'INVALID_PHASE', '比赛尚未结束，无法发起再来一局');
          return;
        }
        if (this.rematchRequested[idx]) {
          return;
        }
        this.rematchRequested[idx] = true;
        if (
          this.rematchRequested[0] &&
          this.rematchRequested[1] &&
          this.connected[0] &&
          this.connected[1]
        ) {
          this.matchConfig = {
            ...this.matchConfig,
            seed: (this.matchConfig.seed + 1) >>> 0,
            archetypes: [this.matchConfig.archetypes[0], this.matchConfig.archetypes[1]],
          };
          this.startMatch();
          return;
        }
        this.broadcast({
          type: 'REMATCH_STATUS',
          payload: { requested: [this.rematchRequested[0], this.rematchRequested[1]] },
        });
        return;
      }

      case 'TEST_COMMAND': {
        if (!enableTestHooks) {
          sendError(ws, 'FORBIDDEN_TEST_HOOK', 'Test hooks are disabled on this server');
          return;
        }
        this.applyTestCommand(msg.payload, nowMs);
        return;
      }

      default:
        sendError(ws, 'INVALID_MESSAGE', 'Unsupported message in room');
    }
  }

  private startMatch(): void {
    this.rng = createRng(this.matchConfig.seed);
    this.state = createMatchState(this.cloneMatchConfig());
    this.state.tick = 0;
    this.state.lastAckSeq = [0, 0];
    this.rematchRequested = [false, false];
    this.ready = [false, false];
    this.emptySinceMs = null;
    this.clearInputs();

    const snap0 = cloneMatchState(this.state);
    const snap1 = cloneMatchState(this.state);

    sendServerMessage(this.sockets[0], {
      type: 'MATCH_START',
      payload: {
        serverTick: 0,
        yourSide: 1,
        playerIndex: 0,
        snapshot: snap0,
      },
    });
    sendServerMessage(this.sockets[1], {
      type: 'MATCH_START',
      payload: {
        serverTick: 0,
        yourSide: -1,
        playerIndex: 1,
        snapshot: snap1,
      },
    });
  }

  private applyTestCommand(payload: TestCommandPayload, nowMs: number): void {
    switch (payload.cmd) {
      case 'set_seed': {
        this.matchConfig.seed = payload.args.seed >>> 0;
        this.rng = createRng(this.matchConfig.seed);
        this.state.config.seed = this.matchConfig.seed;
        return;
      }
      case 'set_score': {
        this.state = applyScorePatch(this.state, payload.args);
        this.clearInputs();
        this.broadcastSnapshot(nowMs);
        return;
      }
      case 'set_takeover': {
        const next = cloneMatchState(this.state);
        const p = next.players[payload.args.playerIndex];
        const val = payload.args.value;
        const wasActive = p.takeoverPointsLeft > 0;
        p.takeoverEnergy = val;
        if (val >= 100) {
          p.takeoverPointsLeft = 2;
          p.takeoverCooldown = false;
        } else {
          p.takeoverPointsLeft = 0;
          p.takeoverCooldown = false;
        }
        this.state = next;
        if (!wasActive && val >= 100) {
          this.emitGameEvent({ type: 'TAKEOVER_ON', player: payload.args.playerIndex });
        }
        this.broadcastSnapshot(nowMs);
        return;
      }
      case 'trigger_hawkeye': {
        this.state = launchHawkeyeTestBall(this.state, payload.args, this.rng);
        this.clearInputs();
        this.broadcastSnapshot(nowMs);
        return;
      }
      case 'fast_forward_pause': {
        this.state = fastForwardPauseState(this.state, payload.args.seconds);
        this.broadcastSnapshot(nowMs);
        return;
      }
    }
  }

  private consumeTickInput(idx: PlayerIndex): PlayerInputFrame {
    const queue = this.inputQueues[idx];
    if (queue.length > 0) {
      const next = queue.shift()!;
      this.lastInputs[idx] = next;
      return next;
    }
    const prev = this.lastInputs[idx];
    if (prev.phase === 'release') {
      const reset: PlayerInputFrame = { ...prev, action: 'none', phase: 'idle' };
      this.lastInputs[idx] = reset;
      return reset;
    }
    return prev;
  }

  private emitGameEvent(event: GameEvent): void {
    this.broadcast({
      type: 'GAME_EVENT',
      payload: {
        serverTick: this.state.tick,
        event,
      },
    });
  }

  stepTick(dt: number, nowMs: number): void {
    if (!this.isActiveSimulation) {
      return;
    }

    // Contract §3.4: if both players are disconnected and both grace timers hit 0 on the same tick,
    // recycle the room directly without emitting a forfeit win.
    if (
      this.state.phase === 'paused_disconnect' &&
      this.state.pause.disconnected[0] &&
      this.state.pause.disconnected[1] &&
      this.state.pause.disconnectRemainingSec[0] - dt <= 0 &&
      this.state.pause.disconnectRemainingSec[1] - dt <= 0
    ) {
      this.shouldRecycle = true;
      return;
    }

    const prevPhase = this.state.phase;
    const inputs: [PlayerInputFrame, PlayerInputFrame] =
      prevPhase === 'serve_ready' || prevPhase === 'serve_toss' || prevPhase === 'rally'
        ? [this.consumeTickInput(0), this.consumeTickInput(1)]
        : [{ ...IDLE_INPUT }, { ...IDLE_INPUT }];

    const { state: nextState, events } = stepMatch(this.state, inputs, dt, this.rng);
    this.state = nextState;

    let phaseChanged = nextState.phase !== prevPhase;
    if (
      phaseChanged &&
      (nextState.phase === 'serve_ready' ||
        nextState.phase === 'point_over' ||
        nextState.phase === 'hawkeye' ||
        nextState.phase === 'match_over')
    ) {
      this.clearInputs();
    }

    for (const evt of events) {
      if (evt.type === 'PAUSE_TIMEOUT_RESUMING') {
        this.clearInputs();
        this.broadcast({
          type: 'MATCH_RESUMING',
          payload: {
            resumeCountdownSec: evt.resumeCountdownSec,
            initiatedBy: 'timeout',
          },
        });
        phaseChanged = true;
        continue;
      }
      if (evt.type === 'PAUSE_RESUMED') {
        this.clearInputs();
        this.broadcast({
          type: 'MATCH_RESUMED',
          payload: {
            serverTick: nextState.tick,
            requireInputReset: true,
          },
        });
        phaseChanged = true;
        continue;
      }
      if (evt.type === 'MATCH_OVER') {
        if (this.bothDisconnected) {
          this.emptySinceMs = nowMs;
        }
      }
      this.emitGameEvent(evt);
    }

    // Handle delayed transition from hawkeye/point_over into paused_disconnect
    if (prevPhase !== 'paused_disconnect' && nextState.phase === 'paused_disconnect') {
      const discIdx: PlayerIndex = nextState.pause.initiatedBy ?? (nextState.pause.disconnected[0] ? 0 : 1);
      this.clearInputs();
      this.emitDisconnectPaused(discIdx, nowMs);
      return;
    }

    const isPausedOrResuming =
      nextState.phase === 'paused_manual' ||
      nextState.phase === 'paused_disconnect' ||
      nextState.phase === 'resuming';

    const cadenceMatch = isPausedOrResuming
      ? nextState.tick % 12 === 0 // 5Hz during pause/resuming countdown
      : nextState.tick % 2 === 0; // 30Hz during active match

    if (phaseChanged || cadenceMatch) {
      this.broadcastSnapshot(nowMs);
    }
  }

  closeAll(reason = 'Room closed'): void {
    for (const idx of [0, 1] as const) {
      const sock = this.sockets[idx];
      this.sockets[idx] = null;
      if (sock && (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING)) {
        try {
          sock.close(1000, reason);
        } catch {
          // ignore close errors
        }
      }
    }
  }
}
