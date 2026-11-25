import { describe, expect, it } from 'vitest';
import {
  COURT_DIM,
  ROOM_CODE_ALPHABET,
  applyDisconnect,
  applyReconnect,
  createMatchState,
  createRng,
  fastForwardPauseState,
  generateRoomCode,
  requestManualPause,
  requestManualResume,
  stepMatch,
  toLocalEvent,
  toLocalVec3,
  toLocalView,
  toWorldInput,
  type GameEvent,
  type PlayerInputFrame,
} from '../src/index.js';

const IDLE_INPUT: PlayerInputFrame = {
  seq: 0,
  moveX: 0,
  moveZ: 0,
  aimX: 0,
  aimZ: 0,
  action: 'none',
  phase: 'idle',
};

describe('Mirroring, W+K Symmetry & Online Pause/Disconnect/Forfeit FSM', () => {
  it('mirrors world state, events, and player inputs consistently for P0(+1) and P1(-1)', () => {
    const v = { x: 2.5, y: 1.2, z: -6.4 };
    expect(toLocalVec3(v, 1)).toEqual(v);
    expect(toLocalVec3(v, -1)).toEqual({ x: -2.5, y: 1.2, z: 6.4 });

    const state = createMatchState({
      mode: 'online',
      court: 'hard',
      format: 'fast4',
      archetypes: ['power', 'defender'],
      seed: 1,
    });
    state.ball.pos = { x: 1.0, y: 1.5, z: -4.0 };
    state.ball.vel = { x: -2.0, y: 3.0, z: 10.0 };
    state.ball.spin = { x: 20, y: 0, z: 5 };
    state.ball.predictedLanding = { x: 1.5, y: COURT_DIM.BALL_RADIUS, z: 8.0 };
    state.ball.firstBouncePos = { x: 1.4, y: COURT_DIM.BALL_RADIUS, z: 7.9 };
    state.hawkeye.bouncePos = { x: 4.1, y: COURT_DIM.BALL_RADIUS, z: -9.0 };

    const viewP1 = toLocalView(state, -1);
    // P1 is now at positive Z (near side) and P0 is at negative Z (far side)
    expect(viewP1.players[1].pos.z).toBeGreaterThan(0);
    expect(viewP1.players[0].pos.z).toBeLessThan(0);
    expect(viewP1.ball.pos).toEqual({ x: -1.0, y: 1.5, z: 4.0 });
    expect(viewP1.ball.vel).toEqual({ x: 2.0, y: 3.0, z: -10.0 });
    expect(viewP1.ball.spin).toEqual({ x: -20, y: 0, z: -5 });
    expect(viewP1.ball.predictedLanding).toEqual({ x: -1.5, y: COURT_DIM.BALL_RADIUS, z: -8.0 });
    expect(viewP1.ball.firstBouncePos).toEqual({ x: -1.4, y: COURT_DIM.BALL_RADIUS, z: -7.9 });
    expect(viewP1.hawkeye.bouncePos).toEqual({ x: -4.1, y: COURT_DIM.BALL_RADIUS, z: 9.0 });

    const evt: GameEvent = {
      type: 'HAWKEYE_START',
      hawkeye: { ...state.hawkeye },
    };
    const evtP1 = toLocalEvent(evt, -1);
    expect(evtP1.type === 'HAWKEYE_START' && evtP1.hawkeye.bouncePos).toEqual({
      x: -4.1,
      y: COURT_DIM.BALL_RADIUS,
      z: 9.0,
    });
  });

  it('produces symmetric W+K dropshots for both P0 (+1) and P1 (-1)', () => {
    const runPlayerDropshot = (playerIndex: 0 | 1) => {
      const side = playerIndex === 0 ? 1 : -1;
      let state = createMatchState({
        mode: 'online',
        court: 'hard',
        format: 'fast4',
        archetypes: ['allcourt', 'allcourt'],
        seed: 55,
      });
      state.phase = 'rally';
      state.players[playerIndex].pos = { x: 0, y: 0, z: side * 10.5 };
      state.players[1 - playerIndex].pos = { x: -5.5, y: 0, z: -side * 13.0 };
      state.ball.active = true;
      state.ball.lastHitter = (1 - playerIndex) as 0 | 1;
      state.ball.pos = { x: 0, y: 1.0, z: side * 10.2 };
      state.ball.vel = { x: 0, y: 0, z: 0 };

      const rng = createRng(55);
      // Both players press local W+K: aimZ = -1 in local screen coordinates
      const localHold = toWorldInput(
        { seq: 1, moveX: 0, moveZ: 0, aimX: 0, aimZ: -1, action: 'K', phase: 'hold' },
        side
      );
      const localRelease = toWorldInput(
        { seq: 2, moveX: 0, moveZ: 0, aimX: 0, aimZ: -1, action: 'K', phase: 'release' },
        side
      );

      const inputs: [PlayerInputFrame, PlayerInputFrame] =
        playerIndex === 0 ? [localHold, IDLE_INPUT] : [IDLE_INPUT, localHold];
      state = stepMatch(state, inputs, COURT_DIM.FIXED_DT, rng).state;
      state.players[playerIndex].meter.progress = 0.78;

      const relInputs: [PlayerInputFrame, PlayerInputFrame] =
        playerIndex === 0 ? [localRelease, IDLE_INPUT] : [IDLE_INPUT, localRelease];
      const hitRes = stepMatch(state, relInputs, COURT_DIM.FIXED_DT, rng);
      const hitEvt = hitRes.events.find((e) => e.type === 'SHOT_HIT');
      state = hitRes.state;

      let bounceZ = 0;
      for (let i = 0; i < 180; i++) {
        const res = stepMatch(state, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
        state = res.state;
        const b = res.events.find((e) => e.type === 'BOUNCE');
        if (b && b.type === 'BOUNCE' && b.bounceIndex === 1) {
          bounceZ = b.pos.z;
          break;
        }
      }
      return { hitEvt, bounceZ };
    };

    const p0Drop = runPlayerDropshot(0);
    const p1Drop = runPlayerDropshot(1);

    expect(p0Drop.hitEvt?.type === 'SHOT_HIT' && p0Drop.hitEvt.shotType).toBe('dropshot');
    expect(p1Drop.hitEvt?.type === 'SHOT_HIT' && p1Drop.hitEvt.shotType).toBe('dropshot');
    expect(p0Drop.bounceZ).toBeLessThan(0); // lands on P1's half
    expect(p1Drop.bounceZ).toBeGreaterThan(0); // lands on P0's half
    expect(Math.abs(p0Drop.bounceZ)).toBeGreaterThanOrEqual(1.8);
    expect(Math.abs(p0Drop.bounceZ)).toBeLessThanOrEqual(3.6);
    expect(Math.abs(p1Drop.bounceZ)).toBeGreaterThanOrEqual(1.8);
    expect(Math.abs(p1Drop.bounceZ)).toBeLessThanOrEqual(3.6);
  });

  it('aims deeper on W (aimZ=-1) and shallower on S (aimZ=+1) when serving for both P0 and P1', () => {
    const runServeDepth = (playerIndex: 0 | 1, localAimZ: -1 | 1) => {
      const side = playerIndex === 0 ? 1 : -1;
      let state = createMatchState({
        mode: 'online',
        court: 'hard',
        format: 'fast4',
        archetypes: ['allcourt', 'allcourt'],
        seed: 66,
      });
      state.score.server = playerIndex;
      if (playerIndex === 1) {
        state.players[0].pos = { x: -2.15, y: 0, z: 12.335 };
        state.players[1].pos = { x: -1.45, y: 0, z: -12.435 };
      }
      const rng = createRng(66);
      const holdIn = toWorldInput(
        { seq: 1, moveX: 0, moveZ: 0, aimX: 0, aimZ: localAimZ, action: 'J', phase: 'hold' },
        side
      );
      const relIn = toWorldInput(
        { seq: 2, moveX: 0, moveZ: 0, aimX: 0, aimZ: localAimZ, action: 'J', phase: 'release' },
        side
      );
      state = stepMatch(
        state,
        playerIndex === 0 ? [holdIn, IDLE_INPUT] : [IDLE_INPUT, holdIn],
        COURT_DIM.FIXED_DT,
        rng
      ).state;
      state.players[playerIndex].meter.progress = 0.78;
      state = stepMatch(
        state,
        playerIndex === 0 ? [relIn, IDLE_INPUT] : [IDLE_INPUT, relIn],
        COURT_DIM.FIXED_DT,
        rng
      ).state;

      let bounceZ = 0;
      let inBounds = false;
      for (let t = 0; t < 150; t++) {
        const res = stepMatch(state, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
        state = res.state;
        const b = res.events.find((e) => e.type === 'BOUNCE');
        if (b && b.type === 'BOUNCE' && b.bounceIndex === 1) {
          bounceZ = b.pos.z;
          inBounds = b.inBounds;
          break;
        }
      }
      return { absZ: Math.abs(bounceZ), inBounds };
    };

    const p0Deep = runServeDepth(0, -1); // W = deep
    const p0Short = runServeDepth(0, 1); // S = shallow
    expect(p0Deep.inBounds).toBe(true);
    expect(p0Short.inBounds).toBe(true);
    expect(p0Deep.absZ).toBeGreaterThan(p0Short.absZ + 0.5);

    const p1Deep = runServeDepth(1, -1); // W = deep
    const p1Short = runServeDepth(1, 1); // S = shallow
    expect(p1Deep.inBounds).toBe(true);
    expect(p1Short.inBounds).toBe(true);
    expect(p1Deep.absZ).toBeGreaterThan(p1Short.absZ + 0.5);
  });

  it('enforces manual pause limit (3/player), 60s timeout auto-resume, and single-player exemption', () => {
    const rng = createRng(11);
    let state = createMatchState({
      mode: 'online',
      court: 'hard',
      format: 'fast4',
      archetypes: ['allcourt', 'allcourt'],
      seed: 11,
    });
    state.phase = 'rally';

    for (let i = 0; i < 3; i++) {
      const pRes = requestManualPause(state, 0);
      expect(pRes.ok).toBe(true);
      if (!pRes.ok) throw new Error('expected ok');
      expect(pRes.state.pause.manualPausesLeft[0]).toBe(2 - i);
      expect(pRes.state.pause.remainingSec).toBe(60);

      // Simultaneous pause request while paused returns INVALID_PHASE and does NOT decrement P1's count
      const p1Simultaneous = requestManualPause(pRes.state, 1);
      expect(p1Simultaneous.ok).toBe(false);
      if (!p1Simultaneous.ok) expect(p1Simultaneous.code).toBe('INVALID_PHASE');

      // Resume -> 3s resuming; second resume is idempotent and does not reset countdown
      const rRes = requestManualResume(pRes.state, 1);
      expect(rRes.ok).toBe(true);
      if (!rRes.ok) throw new Error('expected resume');
      expect(rRes.state.phase).toBe('resuming');

      const stepped = stepMatch(rRes.state, [IDLE_INPUT, IDLE_INPUT], 1.0, rng).state;
      expect(stepped.pause.resumeCountdownSec).toBeCloseTo(2.0, 5);
      const dupResume = requestManualResume(stepped, 0);
      expect(dupResume.ok).toBe(true);
      if (dupResume.ok) {
        expect(dupResume.alreadyResuming).toBe(true);
        expect(dupResume.state.pause.resumeCountdownSec).toBeCloseTo(2.0, 5);
      }

      // Finish 3s countdown -> restores rally & emits PAUSE_RESUMED
      const done = stepMatch(stepped, [IDLE_INPUT, IDLE_INPUT], 2.1, rng);
      expect(done.state.phase).toBe('rally');
      expect(done.events.some((e) => e.type === 'PAUSE_RESUMED')).toBe(true);
      state = done.state;
    }

    // 4th pause rejected
    const fourth = requestManualPause(state, 0);
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.code).toBe('PAUSE_LIMIT_REACHED');

    // P1 pauses and hits 60s timeout auto-resume
    const p1Pause = requestManualPause(state, 1);
    expect(p1Pause.ok).toBe(true);
    if (!p1Pause.ok) throw new Error('expected ok');
    const ff = fastForwardPauseState(p1Pause.state, 60);
    const timeoutStep = stepMatch(ff, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
    expect(timeoutStep.state.phase).toBe('resuming');
    expect(timeoutStep.events.some((e) => e.type === 'PAUSE_TIMEOUT_RESUMING')).toBe(true);

    // Single player exempt from pause limits & 60s timer
    let sp = createMatchState({
      mode: 'single',
      court: 'hard',
      format: 'fast4',
      archetypes: ['allcourt', 'allcourt'],
      aiDifficulty: 'rookie',
      seed: 11,
    });
    for (let i = 0; i < 5; i++) {
      const spPause = requestManualPause(sp, 0);
      expect(spPause.ok).toBe(true);
      if (!spPause.ok) throw new Error('expected ok');
      expect(spPause.state.pause.manualPausesLeft[0]).toBe(3);
      expect(spPause.state.pause.remainingSec).toBe(0);
      const spResume = requestManualResume(spPause.state, 0);
      expect(spResume.ok).toBe(true);
      if (spResume.ok) {
        expect(spResume.state.phase).toBe('serve_ready');
        sp = spResume.state;
      }
    }
  });

  it('handles disconnect during manual pause, double disconnect, reconnect & 15s forfeit accurately', () => {
    const rng = createRng(99);
    let state = createMatchState({
      mode: 'online',
      court: 'hard',
      format: 'fast4',
      archetypes: ['allcourt', 'allcourt'],
      seed: 99,
    });
    state.phase = 'rally';
    state.lastAckSeq = [42, 37];

    // P0 pauses manually (from rally), then P1 disconnects during paused_manual
    const paused = requestManualPause(state, 0);
    expect(paused.ok).toBe(true);
    if (!paused.ok) throw new Error('expected ok');
    state = applyDisconnect(paused.state, 1);
    expect(state.phase).toBe('paused_disconnect');
    expect(state.pause.pausedFromPhase).toBe('rally'); // NOT overwritten by paused_manual!
    expect(state.pause.manualPausesLeft[0]).toBe(2); // NOT refunded!

    // Manual resume rejected during disconnect
    const badResume = requestManualResume(state, 0);
    expect(badResume.ok).toBe(false);
    if (!badResume.ok) expect(badResume.code).toBe('CANNOT_RESUME_DISCONNECT');

    // P0 also disconnects (double disconnect)
    state = applyDisconnect(state, 0);
    expect(state.pause.disconnected).toEqual([true, true]);

    // P1 reconnects first: stays in paused_disconnect because P0 still disconnected
    const rec1 = applyReconnect(state, 1);
    expect(rec1.bothConnected).toBe(false);
    expect(rec1.state.lastAckSeq[1]).toBe(0);
    expect(rec1.state.phase).toBe('paused_disconnect');

    // P0 reconnects second: enters 3s resuming
    const rec2 = applyReconnect(rec1.state, 0);
    expect(rec2.bothConnected).toBe(true);
    expect(rec2.state.lastAckSeq[0]).toBe(0);
    expect(rec2.state.phase).toBe('resuming');
    expect(rec2.state.pause.resumeCountdownSec).toBe(3);

    // Timeout forfeit test: disconnect P1 > 15s -> MATCH_OVER(reason:'forfeit', forfeitedBy:1)
    let disc = applyDisconnect(rec2.state, 1);
    disc = fastForwardPauseState(disc, 15.1);
    const forfeitStep = stepMatch(disc, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
    expect(forfeitStep.state.phase).toBe('match_over');
    expect(forfeitStep.state.score.winner).toBe(0);
    const mEvt = forfeitStep.events.find((e) => e.type === 'MATCH_OVER');
    expect(mEvt?.type === 'MATCH_OVER' && mEvt.reason).toBe('forfeit');
    expect(mEvt?.type === 'MATCH_OVER' && mEvt.forfeitedBy).toBe(1);

    // Disconnect in waiting or match_over does NOT enter paused_disconnect
    const waitState = createMatchState({
      mode: 'online',
      court: 'hard',
      format: 'fast4',
      archetypes: ['allcourt', 'allcourt'],
      seed: 1,
    });
    waitState.phase = 'waiting';
    const waitDisc = applyDisconnect(waitState, 1);
    expect(waitDisc.phase).toBe('waiting');
    expect(waitDisc.pause.disconnected[1]).toBe(true);
  });

  it('generates valid unambiguous 4-char room codes', () => {
    const rng = createRng(7);
    for (let i = 0; i < 30; i++) {
      const code = generateRoomCode(rng);
      expect(code).toHaveLength(4);
      for (const ch of code) {
        expect(ROOM_CODE_ALPHABET.includes(ch)).toBe(true);
      }
    }
  });
});
