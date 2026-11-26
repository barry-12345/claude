import { describe, expect, it } from 'vitest';
import {
  COURT_DIM,
  createMatchState,
  createRng,
  evaluateBounceBounds,
  launchHawkeyeTestBall,
  makeTopspinVec,
  solveBallisticShot,
  spawnIncomingTestBall,
  stepMatch,
  type CourtId,
  type PlayerInputFrame,
} from '../src/index.js';

const IDLE_INPUT: PlayerInputFrame = {
  seq: 0,
  moveX: 0,
  moveZ: 0,
  aimX: 0,
  aimZ: 0,
  action: 'none',
  actionPressed: false,
};

describe('AC-05, AC-07 & AC-08: V2 Auto-Contact, Decision 1A Serve & Hawkeye', () => {
  it('AC-05 iron rule: approaching ball with no shot key pressed triggers 0 swings and allows miss', () => {
    const rng = createRng(100);
    let state = createMatchState({
      mode: 'single',
      court: 'hard',
      format: 'fast4',
      archetypes: ['allcourt', 'allcourt'],
      aiDifficulty: 'rookie',
      seed: 100,
    });
    state.players[0].pos = { x: 0, y: 0, z: 9.0 };
    state = spawnIncomingTestBall(state, { targetX: 0, targetZ: 9.0, speedXZ: 22, forPlayerIndex: 0 }, rng);

    let minDist = Infinity;
    let swung = false;
    let pointEnded = false;

    for (let t = 1; t <= 240; t++) {
      const res = stepMatch(state, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
      state = res.state;
      const d = Math.hypot(state.ball.pos.x - state.players[0].pos.x, state.ball.pos.z - state.players[0].pos.z);
      if (d < minDist) minDist = d;
      if (res.events.some((e) => e.type === 'SHOT_HIT' && e.hitter === 0)) swung = true;
      if (res.events.some((e) => e.type === 'POINT_SCORED')) {
        pointEnded = true;
        break;
      }
    }

    expect(minDist).toBeLessThan(0.5);
    expect(swung).toBe(false);
    expect(pointEnded).toBe(true);
  });

  it('AC-05: supports pre-hold, short-tap (<0.20s) 0.35s buffer, buffer expiry, and long-hold (>=0.20s) release cancel', () => {
    const rng = createRng(100);

    // 1) Short tap (<0.20s) at 0.25s before contact hits cleanly via 0.35s buffer
    let sShort = createMatchState({
      mode: 'single',
      court: 'hard',
      format: 'fast4',
      archetypes: ['allcourt', 'allcourt'],
      aiDifficulty: 'rookie',
      seed: 100,
    });
    sShort.players[0].pos = { x: 0, y: 0, z: 10.5 };
    sShort = spawnIncomingTestBall(sShort, { targetX: 0, targetZ: 10.5, speedXZ: 20, forPlayerIndex: 0 }, rng);

    // Advance until roughly 0.25s before arrival
    for (let t = 1; t <= 42; t++) {
      sShort = stepMatch(sShort, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng).state;
    }
    // 3 ticks (0.05s) short tap then release
    for (let t = 1; t <= 3; t++) {
      sShort = stepMatch(
        sShort,
        [{ seq: t, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', actionPressed: t === 1 }, IDLE_INPUT],
        COURT_DIM.FIXED_DT,
        rng
      ).state;
    }
    const afterRelease = stepMatch(sShort, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng).state;
    expect(afterRelease.players[0].stance.armedAction).toBe('J');
    expect(afterRelease.players[0].stance.bufferRemainingSec).toBeGreaterThan(0.30);

    let shortHit = false;
    sShort = afterRelease;
    for (let t = 1; t <= 40; t++) {
      const res = stepMatch(sShort, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
      sShort = res.state;
      if (res.events.some((e) => e.type === 'SHOT_HIT' && e.hitter === 0)) {
        shortHit = true;
        break;
      }
    }
    expect(shortHit).toBe(true);

    // 2) Long hold (>= 0.20s) released before ball enters reach cancels immediately and allows miss
    let sLong = createMatchState({
      mode: 'single',
      court: 'hard',
      format: 'fast4',
      archetypes: ['allcourt', 'allcourt'],
      aiDifficulty: 'rookie',
      seed: 100,
    });
    sLong.players[0].pos = { x: 0, y: 0, z: 10.5 };
    sLong = spawnIncomingTestBall(sLong, { targetX: 0, targetZ: 10.5, speedXZ: 20, forPlayerIndex: 0 }, rng);

    // Hold for 16 ticks (0.267s >= 0.20s) while ball is still far
    for (let t = 1; t <= 16; t++) {
      sLong = stepMatch(
        sLong,
        [{ seq: t, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', actionPressed: t === 1 }, IDLE_INPUT],
        COURT_DIM.FIXED_DT,
        rng
      ).state;
    }
    expect(sLong.players[0].stance.holdDurationSec).toBeGreaterThanOrEqual(0.20);

    // Release -> immediate cancel
    const canceled = stepMatch(sLong, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng).state;
    expect(canceled.players[0].stance.armedAction).toBe('none');
    expect(canceled.players[0].stance.bufferRemainingSec).toBe(0);

    let swungAfterCancel = false;
    sLong = canceled;
    for (let t = 1; t <= 120; t++) {
      const res = stepMatch(sLong, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
      sLong = res.state;
      if (res.events.some((e) => e.type === 'SHOT_HIT' && e.hitter === 0)) swungAfterCancel = true;
      if (res.events.some((e) => e.type === 'POINT_SCORED')) break;
    }
    expect(swungAfterCancel).toBe(false);
  });

  it('AC-05: prevents same-tick double hits and across-the-net hits when both players stand at net', () => {
    const rng = createRng(101);
    let state = createMatchState({
      mode: 'single',
      court: 'hard',
      format: 'fast4',
      archetypes: ['serve_volley', 'serve_volley'],
      aiDifficulty: 'rookie',
      seed: 101,
    });
    state.phase = 'rally';
    state.players[0].pos = { x: 0, y: 0, z: 1.5 };
    state.players[1].pos = { x: 0, y: 0, z: -0.65 };
    state.ball.active = true;
    state.ball.lastHitter = 1;
    state.ball.hitTick = 0;
    state.ball.bounces = 0;
    state.ball.pos = { x: 0, y: 1.2, z: 1.35 };
    state.ball.vel = { x: 0, y: 0.2, z: 12.0 };

    const hold0: PlayerInputFrame = { seq: 1, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', actionPressed: true };
    const hold1: PlayerInputFrame = { seq: 1, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', actionPressed: true };

    const res1 = stepMatch(state, [hold0, hold1], COURT_DIM.FIXED_DT, rng);
    const hits1 = res1.events.filter((e) => e.type === 'SHOT_HIT');
    expect(hits1.length).toBe(1);
    expect(hits1[0].type === 'SHOT_HIT' && hits1[0].hitter).toBe(0);
    // Ball is still on P0's side (z > 0.05) and within P1's 1.48m reach, so P1 must NOT hit across the net
    expect(res1.state.ball.pos.z).toBeGreaterThan(0.05);
    expect(Math.hypot(res1.state.ball.pos.x - res1.state.players[1].pos.x, res1.state.ball.pos.z - res1.state.players[1].pos.z)).toBeLessThanOrEqual(1.48);

    const res2 = stepMatch(
      res1.state,
      [
        { ...hold0, actionPressed: false },
        { ...hold1, actionPressed: false },
      ],
      COURT_DIM.FIXED_DT,
      rng
    );
    const hits2 = res2.events.filter((e) => e.type === 'SHOT_HIT');
    expect(hits2.length).toBe(0);
  });

  it('AC-07 Decision 1A: edge-triggered 0.32s serve, lockedAimX, J>K>=22%, K 100% in, J corner faults, L ignored', () => {
    const rng = createRng(100);

    // L ignored & non-edge hold ignored in serve_ready
    const init = createMatchState({
      mode: 'single',
      court: 'hard',
      format: 'fast4',
      archetypes: ['allcourt', 'allcourt'],
      aiDifficulty: 'rookie',
      seed: 100,
    });
    expect(
      stepMatch(
        init,
        [{ seq: 1, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action: 'L', actionPressed: true }, IDLE_INPUT],
        COURT_DIM.FIXED_DT,
        rng
      ).state.phase
    ).toBe('serve_ready');
    expect(
      stepMatch(
        init,
        [{ seq: 1, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', actionPressed: false }, IDLE_INPUT],
        COURT_DIM.FIXED_DT,
        rng
      ).state.phase
    ).toBe('serve_ready');

    const runOneButtonServe = (
      action: 'J' | 'K',
      aimX: number,
      aimZ: number,
      arch: 'allcourt' | 'serve_volley' = 'allcourt',
      releaseImmediately = true
    ) => {
      let s = createMatchState({
        mode: 'single',
        court: 'hard',
        format: 'fast4',
        archetypes: [arch, 'allcourt'],
        aiDifficulty: 'rookie',
        seed: 100,
      });
      // Trigger on tick 1
      s = stepMatch(
        s,
        [{ seq: 1, moveX: 0, moveZ: 0, aimX, aimZ, action, actionPressed: true }, IDLE_INPUT],
        COURT_DIM.FIXED_DT,
        rng
      ).state;
      expect(s.phase).toBe('serve_toss');

      // Toss ticks (release immediately and drop aimX to 0 to verify lockedAimX sticks)
      let hitEvt: any = null;
      for (let t = 2; t <= 30 && s.phase === 'serve_toss'; t++) {
        const tossIn: PlayerInputFrame = releaseImmediately
          ? IDLE_INPUT
          : { seq: t, moveX: 0, moveZ: 0, aimX, aimZ, action, actionPressed: false };
        const res = stepMatch(s, [tossIn, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
        s = res.state;
        const h = res.events.find((e) => e.type === 'SHOT_HIT');
        if (h) hitEvt = h;
      }
      expect(s.phase).toBe('rally');
      const speed = Math.hypot(s.ball.vel.x, s.ball.vel.y, s.ball.vel.z);

      let bounceX = 0;
      let bounceZ = 0;
      let inBounds = false;
      for (let t = 0; t < 180; t++) {
        const step = stepMatch(s, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
        s = step.state;
        const b = step.events.find((e) => e.type === 'BOUNCE' && e.bounceIndex === 1);
        if (b && b.type === 'BOUNCE') {
          bounceX = b.pos.x;
          bounceZ = b.pos.z;
          inBounds = b.inBounds;
          break;
        }
        if (s.phase !== 'rally') break;
      }
      return { speed, hitEvt, bounceX, bounceZ, inBounds };
    };

    // 25 J serves vs 25 K serves (including extreme aimX)
    let jSpeedSum = 0;
    let kSpeedSum = 0;
    let kInCount = 0;
    for (let i = 0; i < 25; i++) {
      const aim = i % 2 === 0 ? -0.5 : 0.5;
      const sj = runOneButtonServe('J', aim, 0);
      const sk = runOneButtonServe('K', i % 3 === 0 ? -1 : i % 3 === 1 ? 1 : 0, i % 2 === 0 ? -1 : 1);
      jSpeedSum += sj.speed;
      kSpeedSum += sk.speed;
      if (sk.inBounds) kInCount++;
    }
    expect(jSpeedSum / kSpeedSum - 1).toBeGreaterThanOrEqual(0.22);
    expect(kInCount).toBe(25); // 100% in-bounds

    // A/D left-right separation + lockedAimX persistence after releasing keys mid-toss
    const serveLeft = runOneButtonServe('J', -0.8, 0, 'allcourt', true);
    const serveRight = runOneButtonServe('J', 0.8, 0, 'allcourt', true);
    expect(serveRight.bounceX - serveLeft.bounceX).toBeGreaterThanOrEqual(2.4);

    // Extreme corner J serve natural fault rate (3%-16%, lower for higher CTL)
    let cornerFaultHighCtl = 0;
    let cornerFaultLowCtl = 0;
    for (let i = 0; i < 400; i++) {
      const rHi = runOneButtonServe('J', -1.0, 0, 'allcourt');
      if (!rHi.inBounds) cornerFaultHighCtl++;
      const rLo = runOneButtonServe('J', -1.0, 0, 'serve_volley');
      if (!rLo.inBounds) cornerFaultLowCtl++;
    }
    expect(cornerFaultHighCtl / 400).toBeGreaterThanOrEqual(0.03);
    expect(cornerFaultHighCtl / 400).toBeLessThanOrEqual(0.16);
    expect(cornerFaultLowCtl / 400).toBeGreaterThanOrEqual(0.03);
    expect(cornerFaultLowCtl / 400).toBeLessThanOrEqual(0.16);
    expect(cornerFaultLowCtl).toBeGreaterThan(cornerFaultHighCtl);
  });

  it('rolls back totalShots, cleanShots, and firstServesTotal on serve NET_LET replay', () => {
    const rng = createRng(91);
    let state = createMatchState({
      mode: 'single',
      court: 'hard',
      format: 'fast4',
      archetypes: ['allcourt', 'allcourt'],
      aiDifficulty: 'rookie',
      seed: 91,
    });
    state = stepMatch(
      state,
      [{ seq: 1, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', actionPressed: true }, IDLE_INPUT],
      COURT_DIM.FIXED_DT,
      rng
    ).state;
    for (let t = 2; t <= 25 && state.phase === 'serve_toss'; t++) {
      state = stepMatch(state, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng).state;
    }
    expect(state.stats[0].firstServesTotal).toBe(1);
    expect(state.stats[0].totalShots).toBe(1);
    expect(state.stats[0].cleanShots).toBe(1);

    // Force net-let bounce inside deuce service box
    state.ball.touchedNet = true;
    state.ball.pos = { x: -2.0, y: 0.04, z: -4.5 };
    state.ball.vel = { x: 0, y: -5.0, z: -12.0 };
    const bounceStep = stepMatch(state, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
    expect(bounceStep.state.phase).toBe('serve_ready');
    expect(bounceStep.state.score.serveNumber).toBe(1);
    expect(bounceStep.state.stats[0].firstServesTotal).toBe(0);
    expect(bounceStep.state.stats[0].totalShots).toBe(0);
    expect(bounceStep.state.stats[0].cleanShots).toBe(0);
  });

  it('AC-08: triggers Hawkeye via real physics on 8cm IN / 10cm OUT across 3 courts and skips 25cm', () => {
    const runHawkeyeCase = (
      court: CourtId,
      line: 'sideline' | 'baseline',
      inBounds: boolean,
      distCm: number
    ) => {
      const rng = createRng(77);
      let state = createMatchState({
        mode: 'single',
        court,
        format: 'fast4',
        archetypes: ['allcourt', 'allcourt'],
        aiDifficulty: 'rookie',
        seed: 77,
      });
      state = launchHawkeyeTestBall(state, { inBounds, distCm, line }, rng);

      let started: any = null;
      let ended: any = null;
      for (let t = 0; t < 400; t++) {
        const res = stepMatch(state, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
        state = res.state;
        const hs = res.events.find((e) => e.type === 'HAWKEYE_START');
        if (hs) started = hs;
        const he = res.events.find((e) => e.type === 'HAWKEYE_END');
        if (he) {
          ended = he;
          break;
        }
        if (state.phase === 'point_over') {
          break;
        }
      }
      return { started, ended, finalPhase: state.phase };
    };

    for (const court of ['hard', 'clay', 'grass'] as const) {
      for (const line of ['sideline', 'baseline'] as const) {
        const in8 = runHawkeyeCase(court, line, true, 8);
        expect(in8.started).not.toBeNull();
        expect(in8.started.hawkeye.isIn).toBe(true);
        expect(in8.started.hawkeye.lineType).toBe(line);
        expect(in8.ended?.isIn).toBe(true);
        expect(in8.finalPhase).toBe('serve_ready');

        const out10 = runHawkeyeCase(court, line, false, 10);
        expect(out10.started).not.toBeNull();
        expect(out10.started.hawkeye.isIn).toBe(false);
        expect(out10.started.hawkeye.lineType).toBe(line);
        expect(out10.ended?.isIn).toBe(false);

        expect(runHawkeyeCase(court, line, true, 25).started).toBeNull();
        expect(runHawkeyeCase(court, line, false, 25).started).toBeNull();
      }
    }

    // Obvious OUT balls near perpendicular lines
    const j1 = evaluateBounceBounds({ x: 4.615, y: COURT_DIM.BALL_RADIUS, z: -11.865 }, false, -1, 'deuce');
    expect(j1.inBounds).toBe(false);
    expect(j1.lineType).toBe('sideline');
    expect(j1.distanceToLineCm).toBeCloseTo(50, 1);

    const j2 = evaluateBounceBounds({ x: 4.09, y: COURT_DIM.BALL_RADIUS, z: -12.8 }, false, -1, 'deuce');
    expect(j2.inBounds).toBe(false);
    expect(j2.lineType).toBe('baseline');
    expect(j2.distanceToLineCm).toBeCloseTo(91.5, 1);

    const j3 = evaluateBounceBounds({ x: 3.0, y: COURT_DIM.BALL_RADIUS, z: -6.38 }, true, -1, 'deuce');
    expect(j3.inBounds).toBe(false);
    expect(j3.lineType).toBe('center_service_line');
    expect(j3.distanceToLineCm).toBeCloseTo(300, 1);
  });
});
