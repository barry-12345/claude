import {
  applyScorePatch,
  cloneMatchState,
  computeAIInput,
  COURT_DIM,
  createMatchState,
  createRng,
  fastForwardPauseState,
  launchHawkeyeTestBall,
  PHYSICS_CONSTANTS,
  requestManualPause,
  requestManualResume,
  stepMatch,
  toLocalEvent,
  toLocalView,
  type AIDifficulty,
  type ArchetypeId,
  type CourtId,
  type ErrorCode,
  type GameEvent,
  type MatchFormat,
  type MatchState,
  type PlayerIndex,
  type PlayerSide,
  type PRNG,
  type ScorePatch,
  type ServerMessage,
  type TestStateSnapshot,
} from '@court2k/shared';
import type { Court2KTestHook } from '../contracts.js';
import { AudioManager } from '../audio/AudioManager.js';
import { PerfManager } from '../core/PerfManager.js';
import { InputController } from '../input/InputController.js';
import { SnapshotBuffer } from '../net/SnapshotBuffer.js';
import { WsClient } from '../net/WsClient.js';
import { CourtScene } from '../render/CourtScene.js';
import { HudView } from '../ui/HudView.js';
import { LobbyView, type LobbyState } from '../ui/LobbyView.js';

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_MESSAGE: '消息格式无效',
  ROOM_NOT_FOUND: '房间不存在',
  ROOM_FULL: '房间已满',
  INVALID_TOKEN: '连接凭证失效，请重新加入',
  MATCH_ALREADY_STARTED: '比赛已开始',
  INVALID_PHASE: '当前阶段无法执行此操作',
  PAUSE_LIMIT_REACHED: '本场暂停次数（3次）已用尽',
  CANNOT_RESUME_DISCONNECT: '等待对手重连中，无法提前恢复',
  RATE_LIMITED: '操作频率过快',
  FORBIDDEN_TEST_HOOK: '服务端未开启测试钩子',
};

export class GameApp {
  private readonly scene: CourtScene;
  private readonly perf: PerfManager;
  private readonly input: InputController;
  private readonly audio: AudioManager;
  private readonly ws: WsClient;
  private readonly snapshots: SnapshotBuffer;
  private readonly lobbyView: LobbyView;
  private readonly hudView: HudView;

  private mode: 'lobby' | 'single' | 'online' = 'lobby';
  private yourSide: PlayerSide = 1;
  private playerIndex: PlayerIndex = 0;

  private lobbyState: LobbyState = {
    tab: 'single',
    court: 'hard',
    archetype: 'allcourt',
    format: 'fast4',
    aiDifficulty: 'rookie',
    onlineRoomCode: null,
    onlinePlayerIndex: null,
    onlineConnected: [false, false],
    onlineReady: [false, false],
    onlineConfig: null,
    wsConnected: false,
  };

  private singleState: MatchState | null = null;
  private singleRng: PRNG = createRng(42);
  private singleSeed = 42;
  private singleSeq = 0;
  private singleAccumSec = 0;

  private onlineState: MatchState | null = null;
  private onlineInputAccumSec = 0;
  private rematchRequested: [boolean, boolean] = [false, false];
  private matchOverReason: 'normal' | 'forfeit' = 'normal';
  private forfeitedBy: PlayerIndex | undefined;

  private rafId: number | null = null;
  private lastRafMs = 0;
  private lastRenderMs = 0;
  private startMs = performance.now();
  private lastResumeSecond = -1;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, opts: { testMode: boolean; netDebug: boolean }) {
    this.perf = new PerfManager();
    this.perf.setDevicePixelRatio(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

    this.scene = new CourtScene(canvas);
    this.audio = new AudioManager();
    this.input = new InputController();
    this.snapshots = new SnapshotBuffer();

    this.input.setEscapeHandler(() => {
      this.handleEscapeToggle();
    });
    this.input.attach();
    this.input.resetAndRebind('initial_mount');

    this.ws = new WsClient({
      onMessage: (msg) => this.handleServerMessage(msg),
      onConnectionChange: (connected) => {
        this.lobbyState.wsConnected = connected;
        if (this.mode === 'lobby') {
          this.renderLobby();
        }
      },
    });

    this.lobbyView = new LobbyView(uiRoot, {
      onSelectTab: (tab) => {
        this.audio.unlock();
        this.lobbyState.tab = tab;
        if (tab === 'online' && !this.ws.isConnected() && this.ws.hasStoredSession()) {
          this.ws.connect(true);
        }
        this.renderLobby();
      },
      onSelectCourt: (court) => {
        this.audio.unlock();
        this.lobbyState.court = court;
        if (this.lobbyState.tab === 'online' && this.lobbyState.onlineRoomCode && this.lobbyState.onlinePlayerIndex === 0) {
          this.ws.selectLoadout(this.lobbyState.archetype, court, this.lobbyState.onlineConfig?.format ?? this.lobbyState.format);
        }
        this.renderLobby();
      },
      onSelectArchetype: (arch) => {
        this.audio.unlock();
        this.lobbyState.archetype = arch;
        if (this.lobbyState.tab === 'online' && this.lobbyState.onlineRoomCode) {
          this.ws.selectLoadout(arch);
        }
        this.renderLobby();
      },
      onSelectFormat: (fmt) => {
        this.audio.unlock();
        this.lobbyState.format = fmt;
        if (this.lobbyState.tab === 'online' && this.lobbyState.onlineRoomCode && this.lobbyState.onlinePlayerIndex === 0) {
          this.ws.selectLoadout(this.lobbyState.archetype, this.lobbyState.onlineConfig?.court ?? this.lobbyState.court, fmt);
        }
        this.renderLobby();
      },
      onSelectDifficulty: (diff) => {
        this.audio.unlock();
        this.lobbyState.aiDifficulty = diff;
        this.renderLobby();
      },
      onStartSingle: () => {
        this.audio.unlock();
        this.startSingleMatch();
      },
      onCreateRoom: () => {
        this.audio.unlock();
        this.ws.createRoom(this.lobbyState.court, this.lobbyState.format, this.lobbyState.archetype);
      },
      onJoinRoom: (code) => {
        this.audio.unlock();
        if (code.length !== 4) {
          this.hudView.showToast('请输入 4 位房间码');
          return;
        }
        this.ws.joinRoom(code, this.lobbyState.archetype);
      },
      onToggleReady: () => {
        this.audio.unlock();
        if (this.lobbyState.onlinePlayerIndex === null) return;
        const cur = this.lobbyState.onlineReady[this.lobbyState.onlinePlayerIndex];
        this.ws.setReady(!cur);
      },
      onLeaveRoom: () => {
        this.ws.disconnect(true);
        this.resetOnlineLobby();
        this.renderLobby();
      },
      onToggleMute: () => {
        this.audio.toggleMute();
        this.renderLobby();
      },
    });

    this.hudView = new HudView(
      uiRoot,
      {
        onToggleMute: () => {
          this.audio.toggleMute();
        },
        onRequestPause: () => {
          this.requestPause();
        },
        onRequestResume: () => {
          this.requestResume();
        },
        onRequestRematch: () => {
          this.requestRematch();
        },
        onExitToLobby: () => {
          this.exitToLobby();
        },
      },
      opts.netDebug
    );

    const onGestureUnlock = () => {
      this.audio.unlock();
    };
    window.addEventListener('pointerdown', onGestureUnlock, { passive: true });
    window.addEventListener('keydown', onGestureUnlock, { passive: true });
    window.addEventListener('resize', this.handleResize);
    this.handleResize();

    this.renderLobby();

    // Auto-reconnect if page refreshed mid-match with active sessionStorage token
    if (this.ws.hasStoredSession()) {
      this.lobbyState.tab = 'online';
      this.ws.connect(true);
    }

    if (opts.testMode) {
      window.__COURT2K_TEST__ = this.createTestHook();
    }

    this.lastRafMs = performance.now();
    this.lastRenderMs = this.lastRafMs;
    this.rafId = requestAnimationFrame(this.loop);
  }

  public dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    window.removeEventListener('resize', this.handleResize);
    this.input.detach();
    this.ws.disconnect(false);
    this.audio.dispose();
    this.scene.dispose();
  }

  private readonly handleResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.perf.setDevicePixelRatio(window.devicePixelRatio || 1);
    this.scene.applyPerfPreset(this.perf.getPreset(), this.perf.getActiveDpr());
    this.scene.resize(w, h);
  };

  private renderLobby(): void {
    this.lobbyView.render(this.lobbyState, this.audio.isMuted());
  }

  private startSingleMatch(): void {
    const aiPool: ArchetypeId[] = ['power', 'allcourt', 'serve_volley', 'defender'];
    const aiArch = aiPool[(aiPool.indexOf(this.lobbyState.archetype) + 2) % aiPool.length];
    this.singleRng = createRng(this.singleSeed);
    this.singleState = createMatchState({
      mode: 'single',
      court: this.lobbyState.court,
      format: this.lobbyState.format,
      archetypes: [this.lobbyState.archetype, aiArch],
      aiDifficulty: this.lobbyState.aiDifficulty,
      seed: this.singleSeed,
    });
    this.singleSeq = 0;
    this.singleAccumSec = 0;
    this.yourSide = 1;
    this.playerIndex = 0;
    this.mode = 'single';
    this.rematchRequested = [false, false];
    this.matchOverReason = 'normal';
    this.forfeitedBy = undefined;

    this.lobbyView.setVisible(false);
    this.hudView.setMatchVisible(true);
    this.input.setAllowArrowKeys(true);
    this.input.setCaptureActive(true);
    this.input.resetAndRebind('single_match_start');
  }

  private exitToLobby(): void {
    if (this.mode === 'online') {
      this.ws.disconnect(true);
      this.resetOnlineLobby();
    }
    this.mode = 'lobby';
    this.singleState = null;
    this.onlineState = null;
    this.snapshots.clear();
    this.input.setCaptureActive(false);
    this.hudView.setMatchVisible(false);
    this.lobbyView.setVisible(true);
    this.renderLobby();
  }

  private resetOnlineLobby(): void {
    this.lobbyState.onlineRoomCode = null;
    this.lobbyState.onlinePlayerIndex = null;
    this.lobbyState.onlineConnected = [false, false];
    this.lobbyState.onlineReady = [false, false];
    this.lobbyState.onlineConfig = null;
  }

  private handleEscapeToggle(): void {
    const state = this.getActiveRawState();
    if (!state) return;
    if (state.phase === 'serve_ready' || state.phase === 'serve_toss' || state.phase === 'rally') {
      this.requestPause();
    } else if (state.phase === 'paused_manual') {
      this.requestResume();
    }
  }

  private requestPause(): void {
    if (this.mode === 'single' && this.singleState) {
      const res = requestManualPause(this.singleState, 0);
      if (res.ok) {
        this.singleState = res.state;
        this.input.setCaptureActive(true);
      } else {
        this.hudView.showToast(ERROR_MESSAGES[res.code] ?? res.message);
      }
      return;
    }
    if (this.mode === 'online') {
      this.ws.requestPause();
    }
  }

  private requestResume(): void {
    if (this.mode === 'single' && this.singleState) {
      const res = requestManualResume(this.singleState, 0);
      if (res.ok) {
        this.singleState = res.state;
        this.input.resetAndRebind('single_pause_resumed');
      } else {
        this.hudView.showToast(ERROR_MESSAGES[res.code] ?? res.message);
      }
      return;
    }
    if (this.mode === 'online') {
      this.ws.requestResume();
    }
  }

  private requestRematch(): void {
    if (this.mode === 'single') {
      this.startSingleMatch();
      return;
    }
    if (this.mode === 'online') {
      this.ws.requestRematch();
    }
  }

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'ROOM_CREATED': {
        this.lobbyState.tab = 'online';
        this.lobbyState.onlineRoomCode = msg.payload.roomCode;
        this.lobbyState.onlinePlayerIndex = msg.payload.playerIndex;
        this.lobbyState.onlineConfig = msg.payload.matchConfig;
        this.lobbyState.onlineConnected = [true, false];
        this.lobbyState.onlineReady = [false, false];
        this.yourSide = msg.payload.yourSide;
        this.playerIndex = msg.payload.playerIndex;
        this.renderLobby();
        break;
      }
      case 'ROOM_JOINED': {
        this.lobbyState.tab = 'online';
        this.lobbyState.onlineRoomCode = msg.payload.roomCode;
        this.lobbyState.onlinePlayerIndex = msg.payload.playerIndex;
        this.lobbyState.onlineConfig = msg.payload.matchConfig;
        this.lobbyState.onlineConnected = [true, true];
        this.lobbyState.onlineReady = msg.payload.ready;
        this.yourSide = msg.payload.yourSide;
        this.playerIndex = msg.payload.playerIndex;
        this.renderLobby();
        break;
      }
      case 'LOBBY_UPDATE': {
        this.lobbyState.onlineRoomCode = msg.payload.roomCode;
        this.lobbyState.onlineConfig = msg.payload.matchConfig;
        this.lobbyState.onlineConnected = msg.payload.connected;
        this.lobbyState.onlineReady = msg.payload.ready;
        if (this.mode === 'lobby') {
          this.renderLobby();
        }
        break;
      }
      case 'MATCH_START': {
        this.mode = 'online';
        this.yourSide = msg.payload.yourSide;
        this.playerIndex = msg.payload.playerIndex;
        this.onlineState = msg.payload.snapshot;
        this.snapshots.reset(msg.payload.snapshot);
        this.rematchRequested = [false, false];
        this.matchOverReason = 'normal';
        this.forfeitedBy = undefined;

        this.lobbyView.setVisible(false);
        this.hudView.setMatchVisible(true);
        this.input.setAllowArrowKeys(false);
        this.input.setCaptureActive(true);
        this.input.resetAndRebind('MATCH_START');
        break;
      }
      case 'FULL_SYNC': {
        this.mode = 'online';
        this.lobbyState.onlineRoomCode = msg.payload.roomCode;
        this.yourSide = msg.payload.yourSide;
        this.playerIndex = msg.payload.playerIndex;
        this.onlineState = msg.payload.snapshot;
        this.snapshots.reset(msg.payload.snapshot);
        this.rematchRequested = [false, false];

        this.lobbyView.setVisible(false);
        this.hudView.setMatchVisible(true);
        this.input.setAllowArrowKeys(false);
        this.input.setCaptureActive(true);
        this.input.resetAndRebind('FULL_SYNC');
        break;
      }
      case 'STATE_SNAPSHOT': {
        this.onlineState = msg.payload.state;
        this.snapshots.push(msg.payload.serverTick, msg.payload.serverTime, msg.payload.state);
        break;
      }
      case 'GAME_EVENT': {
        this.processLocalEvent(toLocalEvent(msg.payload.event, this.yourSide));
        break;
      }
      case 'MATCH_PAUSED': {
        if (msg.payload.reason === 'manual') {
          this.hudView.showToast(
            `${msg.payload.initiatedBy === this.playerIndex ? '你' : '对手'}暂停了比赛 (${Math.ceil(msg.payload.remainingSec)}s)`
          );
        }
        break;
      }
      case 'MATCH_RESUMING': {
        this.lastResumeSecond = -1;
        break;
      }
      case 'MATCH_RESUMED': {
        this.input.resetAndRebind('MATCH_RESUMED');
        this.audio.playCountdownTick(true);
        this.hudView.showToast('比赛恢复！');
        break;
      }
      case 'OPPONENT_DISCONNECTED': {
        this.hudView.showToast(`对手已断线，等待重连 (${msg.payload.graceSeconds}s)`);
        break;
      }
      case 'OPPONENT_RECONNECTED': {
        this.hudView.showToast(`对手已重连，${msg.payload.resumeInSeconds} 秒后恢复`);
        break;
      }
      case 'REMATCH_STATUS': {
        this.rematchRequested = msg.payload.requested;
        break;
      }
      case 'ERROR': {
        if (msg.payload.code === 'RATE_LIMITED') break;
        const text = ERROR_MESSAGES[msg.payload.code] ?? msg.payload.message;
        this.hudView.showToast(text);
        if (msg.payload.code === 'INVALID_TOKEN') {
          this.resetOnlineLobby();
          if (this.mode !== 'lobby') {
            this.exitToLobby();
          } else {
            this.renderLobby();
          }
        }
        break;
      }
    }
  }

  private processLocalEvent(ev: GameEvent): void {
    const raw = this.getActiveRawState();
    const court = raw?.config.court ?? 'hard';

    this.hudView.handleEventCallout(ev, this.playerIndex);

    switch (ev.type) {
      case 'SHOT_HIT': {
        this.audio.playShotHit(ev.shotType, ev.quality, court);
        if (ev.quality === 'PERFECT' && ev.hitter === this.playerIndex) {
          this.scene.triggerPerfectShockwave({ x: ev.pos.x, z: ev.pos.z });
        }
        break;
      }
      case 'BOUNCE': {
        this.audio.playBounce(ev.court, ev.inBounds);
        break;
      }
      case 'NET_LET': {
        this.audio.playNetLet();
        break;
      }
      case 'HAWKEYE_START': {
        this.audio.playHawkeyePulse(ev.hawkeye.isIn);
        break;
      }
      case 'HAWKEYE_END': {
        this.input.resetAndRebind('HAWKEYE_END');
        break;
      }
      case 'POINT_SCORED': {
        this.audio.playPointScored(ev.winner === this.playerIndex, ev.score.keyPointLabel);
        break;
      }
      case 'TAKEOVER_ON': {
        this.audio.playTakeover(true);
        break;
      }
      case 'TAKEOVER_OFF': {
        this.audio.playTakeover(false);
        break;
      }
      case 'MATCH_OVER': {
        this.matchOverReason = ev.reason;
        this.forfeitedBy = ev.forfeitedBy;
        this.input.setCaptureActive(false);
        break;
      }
    }
  }

  private readonly loop = (nowMs: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);

    const rawRafDtMs = nowMs - this.lastRafMs;
    this.lastRafMs = nowMs;
    this.perf.recordRafDelta(rawRafDtMs);

    // Only cap at 60fps when estHz > 105Hz
    if (this.perf.isFpsCapEnabled() && nowMs - this.lastRenderMs < 15.2) {
      return;
    }

    const renderDtMs = Math.max(1, nowMs - this.lastRenderMs);
    this.lastRenderMs = nowMs;
    const dtSec = Math.min(0.05, renderDtMs / 1000);

    const frameStart = performance.now();

    if (this.mode === 'single' && this.singleState) {
      this.stepSinglePlayer(dtSec);
      const localView = toLocalView(this.singleState, this.yourSide);
      this.scene.renderMatch(localView, this.playerIndex, dtSec);
      this.hudView.updateMatchHud(
        localView,
        this.playerIndex,
        this.audio.isMuted(),
        this.rematchRequested,
        this.matchOverReason,
        this.forfeitedBy
      );
    } else if (this.mode === 'online') {
      this.stepOnlineInputs(dtSec);
      const sampled = this.snapshots.sample(Date.now()) ?? this.onlineState;
      if (sampled) {
        const localView = toLocalView(sampled, this.yourSide);
        if (localView.phase === 'resuming') {
          const sec = Math.max(1, Math.ceil(localView.pause.resumeCountdownSec));
          if (sec !== this.lastResumeSecond) {
            this.lastResumeSecond = sec;
            this.audio.playCountdownTick(false);
          }
        }
        this.scene.renderMatch(localView, this.playerIndex, dtSec);
        this.hudView.updateMatchHud(
          localView,
          this.playerIndex,
          this.audio.isMuted(),
          this.rematchRequested,
          this.matchOverReason,
          this.forfeitedBy
        );
      }
    } else {
      const court = this.lobbyState.onlineConfig?.court ?? this.lobbyState.court;
      this.scene.renderLobbyPreview(court, this.lobbyState.archetype, (nowMs - this.startMs) / 1000, dtSec);
    }

    const workMs = Math.max(renderDtMs, performance.now() - frameStart);
    this.perf.recordFrame(workMs, renderDtMs);

    const preset = this.perf.getPreset();
    this.scene.applyPerfPreset(preset, this.perf.getActiveDpr());
    this.hudView.updateNetDebug(
      this.perf.getMetrics(),
      this.scene.getDrawCalls(),
      this.ws.getRttMs(),
      this.ws.getReconnectCount(),
      this.mode
    );
  };

  private stepSinglePlayer(dtSec: number): void {
    if (!this.singleState) return;
    this.singleAccumSec += dtSec;
    const fixedDt = COURT_DIM.FIXED_DT;

    while (this.singleAccumSec >= fixedDt) {
      this.singleAccumSec -= fixedDt;
      this.singleSeq += 1;
      const p0Input = this.input.sampleFrame(this.singleSeq);
      const diff: AIDifficulty = this.singleState.config.aiDifficulty ?? 'rookie';
      const p1Input = computeAIInput(this.singleState, 1, diff, this.singleRng);
      const res = stepMatch(this.singleState, [p0Input, p1Input], fixedDt, this.singleRng);
      this.singleState = res.state;
      for (const ev of res.events) {
        this.processLocalEvent(toLocalEvent(ev, this.yourSide));
      }
    }
  }

  private stepOnlineInputs(dtSec: number): void {
    const raw = this.onlineState;
    if (!raw) return;
    const playable = raw.phase === 'serve_ready' || raw.phase === 'serve_toss' || raw.phase === 'rally';
    if (!playable) return;

    this.onlineInputAccumSec += dtSec;
    const fixedDt = COURT_DIM.FIXED_DT;
    let steps = 0;
    while (this.onlineInputAccumSec >= fixedDt && steps < 2) {
      this.onlineInputAccumSec -= fixedDt;
      steps += 1;
      const seq = this.ws.nextSeq();
      const frame = this.input.sampleFrame(seq);
      this.ws.sendPlayerInput(frame);
    }
  }

  private getActiveRawState(): MatchState | null {
    return this.mode === 'single' ? this.singleState : this.mode === 'online' ? this.onlineState : null;
  }

  private createTestHook(): Court2KTestHook {
    return {
      getState: (): Readonly<TestStateSnapshot> => {
        const raw = this.getActiveRawState();
        const localView = raw ? cloneMatchState(toLocalView(raw, this.yourSide)) : null;
        const m = this.perf.getMetrics();
        return {
          mode: this.mode,
          yourSide: this.yourSide,
          roomCode: this.lobbyState.onlineRoomCode,
          wsConnected: this.ws.isConnected(),
          reconnectCount: this.ws.getReconnectCount(),
          rttMs: this.ws.getRttMs(),
          matchState: localView,
          qualityTier: m.qualityTier,
          activeDpr: m.activeDpr,
          estHz: m.estHz,
          fpsCapEnabled: m.fpsCapEnabled,
          upgradeCount: m.upgradeCount,
          fps: m.fps,
          maxFrameMs: m.maxFrameMs,
          drawCalls: this.scene.getDrawCalls(),
          inputDiagnostics: this.input.getDiagnostics(),
        };
      },
      setSeed: (seed: number) => {
        this.singleSeed = seed;
        this.singleRng = createRng(seed);
        if (this.mode === 'single' && this.singleState) {
          this.singleState = {
            ...this.singleState,
            config: { ...this.singleState.config, seed },
          };
        } else if (this.mode === 'online') {
          this.ws.sendTestCommand({ cmd: 'set_seed', args: { seed } });
        }
      },
      setScore: (patch: ScorePatch) => {
        if (this.mode === 'single' && this.singleState) {
          this.singleState = applyScorePatch(this.singleState, patch);
        } else if (this.mode === 'online') {
          this.ws.sendTestCommand({ cmd: 'set_score', args: patch });
        }
      },
      setTakeover: (playerIndex: PlayerIndex, value: number) => {
        if (this.mode === 'single' && this.singleState) {
          const next = cloneMatchState(this.singleState);
          const clamped = Math.max(0, Math.min(PHYSICS_CONSTANTS.TAKEOVER_MAX_ENERGY, value));
          next.players[playerIndex].takeoverEnergy = clamped;
          if (clamped >= PHYSICS_CONSTANTS.TAKEOVER_MAX_ENERGY) {
            next.players[playerIndex].takeoverPointsLeft = PHYSICS_CONSTANTS.TAKEOVER_DURATION_POINTS;
            next.players[playerIndex].takeoverCooldown = false;
          } else {
            next.players[playerIndex].takeoverPointsLeft = 0;
          }
          this.singleState = next;
        } else if (this.mode === 'online') {
          this.ws.sendTestCommand({ cmd: 'set_takeover', args: { playerIndex, value } });
        }
      },
      triggerHawkeyeShot: (opts) => {
        if (this.mode === 'single' && this.singleState) {
          this.singleState = launchHawkeyeTestBall(this.singleState, opts, this.singleRng);
        } else if (this.mode === 'online') {
          this.ws.sendTestCommand({ cmd: 'trigger_hawkeye', args: opts });
        }
      },
      fastForwardPause: (seconds: number) => {
        if (this.mode === 'single' && this.singleState) {
          this.singleState = fastForwardPauseState(this.singleState, seconds);
        } else if (this.mode === 'online') {
          this.ws.sendTestCommand({ cmd: 'fast_forward_pause', args: { seconds } });
        }
      },
      simulatePerfSpike: (frameMs: number, durationMs: number) => {
        this.perf.simulatePerfSpike(frameMs, durationMs);
      },
      simulateRefreshRate: (hz: number) => {
        this.perf.simulateRefreshRate(hz);
      },
      simulateDisconnect: (reconnectAfterMs: number) => {
        if (this.mode === 'online') {
          this.ws.simulateDisconnect(reconnectAfterMs);
        }
      },
    };
  }
}
