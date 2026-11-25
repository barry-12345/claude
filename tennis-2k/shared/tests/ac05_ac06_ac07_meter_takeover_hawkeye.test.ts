import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES,
  COURT_DIM,
  computeShotQuality,
  createMatchState,
  createRng,
  evaluateBounceBounds,
  launchHawkeyeTestBall,
  makeTopspinVec,
  solveBallisticShot,
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
  phase: 'idle',
};

describe('AC-05, AC-06 & AC-07: 2K Meter, Takeover & Hawkeye', () => {
  it('enforces priority boundary progress >= 1.18 -> VERY_LATE even when 0.78 + 4*W_eff > 1.18', () => {
    // High TIM (allcourt=86) + Takeover (1.25x) + serve_kick (1.35x) => W_eff ~ 0.115 => 0.78 + 4*W_eff = 1.24 > 1.18
    const res = computeShotQuality(1.18, ARCHETYPES.allcourt, {
      shotType: 'serve_kick',
      isTakeover: true,
      isSliding: false,
    });
    expect(0.78 + 4 * res.effectiveHalfWidth).toBeGreaterThan(1.18);
    expect(res.quality).toBe('VERY_LATE');
  });

  it('verifies AC-05 serve & rally accuracy across 20+ samples per quality tier', () => {
    const rng = createRng(100);

    const runRallyAtProgress = (targetProgress: number, action: 'J' | 'K') => {
      let state = createMatchState({
        mode: 'single',
        court: 'hard',
        format: 'fast4',
        archetypes: ['allcourt', 'allcourt'],
        aiDifficulty: 'rookie',
        seed: 100,
      });
      state.phase = 'rally';
      state.players[0].pos = { x: 0, y: 0, z: 10.5 };
      state.players[1].pos = { x: -6, y: 0, z: -13.0 };
      state.ball.active = true;
      state.ball.lastHitter = 1;
      state.ball.pos = { x: 0.1, y: 1.0, z: 10.2 };
      state.ball.vel = { x: 0, y: 0, z: 0 };

      state = stepMatch(
        state,
        [{ seq: 1, moveX: 0, moveZ: 0, aimX: 0.4, aimZ: -0.2, action, phase: 'hold' }, IDLE_INPUT],
        COURT_DIM.FIXED_DT,
        rng
      ).state;
      state.players[0].meter.progress = targetProgress;
      const hitRes = stepMatch(
        state,
        [{ seq: 2, moveX: 0, moveZ: 0, aimX: 0.4, aimZ: -0.2, action, phase: 'release' }, IDLE_INPUT],
        COURT_DIM.FIXED_DT,
        rng
      );
      const hitEvt = hitRes.events.find((e) => e.type === 'SHOT_HIT');
      let s = hitRes.state;
      let clearedNet = true;
      let landingErr = 99;
      for (let t = 0; t < 200; t++) {
        const step = stepMatch(s, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
        s = step.state;
        if (step.events.some((e) => e.type === 'POINT_SCORED' && e.reason === 'net')) {
          clearedNet = false;
          break;
        }
        const b = step.events.find((e) => e.type === 'BOUNCE');
        if (b && b.type === 'BOUNCE' && b.bounceIndex === 1) {
          // Compare actual first bounce directly against intended world target (aimX=0.4, aimZ=-0.2)
          const idealTargetX = 0.4 * (COURT_DIM.SINGLES_HALF_WIDTH - 0.12);
          const idealTargetZ = -(9.5 + 0.2 * 1.9);
          landingErr = Math.hypot(b.pos.x - idealTargetX, b.pos.z - idealTargetZ);
          break;
        }
      }
      return { hitEvt, clearedNet, landingErr };
    };

    const runServeAtProgress = (action: 'J' | 'K', targetProgress: number) => {
      let state = createMatchState({
        mode: 'single',
        court: 'hard',
        format: 'fast4',
        archetypes: ['allcourt', 'allcourt'],
        aiDifficulty: 'rookie',
        seed: 100,
      });
      state = stepMatch(
        state,
        [{ seq: 1, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action, phase: 'hold' }, IDLE_INPUT],
        COURT_DIM.FIXED_DT,
        rng
      ).state;
      state.players[0].meter.progress = targetProgress;
      const hit = stepMatch(
        state,
        [{ seq: 2, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action, phase: 'release' }, IDLE_INPUT],
        COURT_DIM.FIXED_DT,
        rng
      );
      let s = hit.state;
      const speed = Math.hypot(s.ball.vel.x, s.ball.vel.y, s.ball.vel.z);
      let inBounds = false;
      for (let t = 0; t < 180; t++) {
        const step = stepMatch(s, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
        s = step.state;
        const b = step.events.find((e) => e.type === 'BOUNCE');
        if (b && b.type === 'BOUNCE' && b.bounceIndex === 1) {
          inBounds = b.inBounds;
          break;
        }
        if (s.phase !== 'rally') break;
      }
      return { speed, inBounds };
    };

    // 20 PERFECT rally shots: 100% over net & <= 0.15 m error
    for (let i = 0; i < 20; i++) {
      const r = runRallyAtProgress(0.78, 'J');
      expect(r.clearedNet).toBe(true);
      expect(r.landingErr).toBeLessThanOrEqual(0.15);
    }

    // 20 1st serves (J) vs 20 2nd serves (K) in PERFECT/GOOD + 20 1st serves in RED
    let firstPerfectSpeedSum = 0;
    let secondPerfectSpeedSum = 0;
    let secondInCount = 0;
    let firstRedFaultCount = 0;

    for (let i = 0; i < 20; i++) {
      const s1 = runServeAtProgress('J', 0.78);
      const s2 = runServeAtProgress('K', i % 2 === 0 ? 0.78 : 0.88);
      const s1Red = runServeAtProgress('J', i % 2 === 0 ? 0.25 : 1.18);
      firstPerfectSpeedSum += s1.speed;
      secondPerfectSpeedSum += s2.speed;
      if (s2.inBounds) secondInCount++;
      if (!s1Red.inBounds) firstRedFaultCount++;
    }

    expect(firstPerfectSpeedSum / secondPerfectSpeedSum - 1).toBeGreaterThanOrEqual(0.25);
    expect(firstRedFaultCount).toBe(20); // 100% fault in 1st serve red zone
    expect(secondInCount / 20).toBeGreaterThanOrEqual(0.95);
  });

  it('activates Takeover at 100, widens meter by 1.25x for 2 points, then cools down 1 point', () => {
    const rng = createRng(42);
    let state = createMatchState({
      mode: 'single',
      court: 'hard',
      format: 'fast4',
      archetypes: ['allcourt', 'allcourt'],
      aiDifficulty: 'rookie',
      seed: 42,
    });

    const normalWidth = computeShotQuality(0.78, ARCHETYPES.allcourt, {
      shotType: 'topspin',
      isTakeover: false,
      isSliding: false,
    }).effectiveHalfWidth;

    // 3 Perfect shots => +34 * 3 = 102 -> clamped 100, activates Takeover
    for (let i = 0; i < 3; i++) {
      state.phase = 'rally';
      state.players[0].pos = { x: 0, y: 0, z: 10.5 };
      state.players[1].pos = { x: -5, y: 0, z: -11.0 };
      state.ball.active = true;
      state.ball.lastHitter = 1;
      state.ball.pos = { x: 0, y: 1.0, z: 10.3 };
      state = stepMatch(
        state,
        [{ seq: state.tick + 1, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', phase: 'hold' }, IDLE_INPUT],
        COURT_DIM.FIXED_DT,
        rng
      ).state;
      state.players[0].meter.progress = 0.78;
      const res = stepMatch(
        state,
        [{ seq: state.tick + 1, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', phase: 'release' }, IDLE_INPUT],
        COURT_DIM.FIXED_DT,
        rng
      );
      state = res.state;
      if (i === 2) {
        expect(res.events.some((e) => e.type === 'TAKEOVER_ON' && e.player === 0)).toBe(true);
      }
    }

    expect(state.players[0].takeoverEnergy).toBe(100);
    expect(state.players[0].takeoverPointsLeft).toBe(2);

    const takeoverWidth = computeShotQuality(0.78, ARCHETYPES.allcourt, {
      shotType: 'topspin',
      isTakeover: state.players[0].takeoverPointsLeft > 0,
      isSliding: false,
    }).effectiveHalfWidth;
    expect(takeoverWidth / normalWidth).toBeCloseTo(1.25, 5);

    // Helper to finish 1 point cleanly (double fault by P1 or net by P1)
    const finishPointByP1Net = () => {
      state.phase = 'rally';
      state.ball.active = true;
      state.ball.lastHitter = 1;
      state.ball.bounces = 0;
      state.ball.lastShotType = 'topspin';
      state.ball.pos = { x: 0, y: 0.4, z: -0.1 };
      state.ball.vel = { x: 0, y: 0, z: 15 };
      const res = stepMatch(state, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
      state = res.state;
      return res.events;
    };

    // Point 1 finishes: pointsLeft 2 -> 1
    finishPointByP1Net();
    expect(state.players[0].takeoverPointsLeft).toBe(1);
    expect(state.players[0].takeoverCooldown).toBe(false);

    // Point 2 finishes: pointsLeft 1 -> 0, TAKEOVER_OFF, cooldown = true
    const ev2 = finishPointByP1Net();
    expect(ev2.some((e) => e.type === 'TAKEOVER_OFF' && e.player === 0)).toBe(true);
    expect(state.players[0].takeoverPointsLeft).toBe(0);
    expect(state.players[0].takeoverEnergy).toBe(0);
    expect(state.players[0].takeoverCooldown).toBe(true);

    // During Point 3 (cooldown): Perfect shot does NOT accumulate Takeover energy
    state.phase = 'rally';
    state.players[0].pos = { x: 0, y: 0, z: 10.5 };
    state.ball.active = true;
    state.ball.lastHitter = 1;
    state.ball.pos = { x: 0, y: 1.0, z: 10.3 };
    state = stepMatch(
      state,
      [{ seq: state.tick + 1, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', phase: 'hold' }, IDLE_INPUT],
      COURT_DIM.FIXED_DT,
      rng
    ).state;
    state.players[0].meter.progress = 0.78;
    state = stepMatch(
      state,
      [{ seq: state.tick + 1, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', phase: 'release' }, IDLE_INPUT],
      COURT_DIM.FIXED_DT,
      rng
    ).state;
    expect(state.players[0].takeoverEnergy).toBe(0);

    // Point 3 finishes: cooldown clears
    finishPointByP1Net();
    expect(state.players[0].takeoverCooldown).toBe(false);
  });

  it('triggers Hawkeye via real physics on 8cm IN and 10cm OUT across all 3 courts (sideline & baseline), and skips on 25cm', () => {
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
        expect(in8.started.hawkeye.distanceToLineCm).toBeLessThanOrEqual(15);
        expect(in8.ended?.isIn).toBe(true);
        expect(in8.finalPhase).toBe('serve_ready');

        const out10 = runHawkeyeCase(court, line, false, 10);
        expect(out10.started).not.toBeNull();
        expect(out10.started.hawkeye.isIn).toBe(false);
        expect(out10.started.hawkeye.lineType).toBe(line);
        expect(out10.started.hawkeye.distanceToLineCm).toBeLessThanOrEqual(15);
        expect(out10.ended?.isIn).toBe(false);

        const in25 = runHawkeyeCase(court, line, true, 25);
        expect(in25.started).toBeNull();
        expect(in25.finalPhase).toBe('point_over');

        const out25 = runHawkeyeCase(court, line, false, 25);
        expect(out25.started).toBeNull();
        expect(out25.finalPhase).toBe('point_over');
      }
    }
  });

  it('never triggers Hawkeye or mislabels lines on 50-300cm obvious OUT balls near perpendicular lines', () => {
    // 1) Rally ball 50 cm outside sideline (x=4.615) near baseline (z=-11.865)
    const j1 = evaluateBounceBounds({ x: 4.615, y: COURT_DIM.BALL_RADIUS, z: -11.865 }, false, -1, 'deuce');
    expect(j1.inBounds).toBe(false);
    expect(j1.lineType).toBe('sideline');
    expect(j1.distanceToLineCm).toBeCloseTo(50, 1);

    // 2) Rally ball 91.5 cm past baseline (z=-12.8) near sideline (x=4.09)
    const j2 = evaluateBounceBounds({ x: 4.09, y: COURT_DIM.BALL_RADIUS, z: -12.8 }, false, -1, 'deuce');
    expect(j2.inBounds).toBe(false);
    expect(j2.lineType).toBe('baseline');
    expect(j2.distanceToLineCm).toBeCloseTo(91.5, 1);

    // 3) Serve into wrong service box by 300 cm (x=+3.0 when target is [-4.115, 0]) near service line (z=-6.38)
    const j3 = evaluateBounceBounds({ x: 3.0, y: COURT_DIM.BALL_RADIUS, z: -6.38 }, true, -1, 'deuce');
    expect(j3.inBounds).toBe(false);
    expect(j3.lineType).toBe('center_service_line');
    expect(j3.distanceToLineCm).toBeCloseTo(300, 1);

    // Verify none of them trigger HAWKEYE_START inside stepMatch
    const rng = createRng(88);
    for (const target of [
      { x: 4.615, y: COURT_DIM.BALL_RADIUS, z: -11.865 },
      { x: 4.09, y: COURT_DIM.BALL_RADIUS, z: -12.8 },
    ]) {
      let state = createMatchState({
        mode: 'single',
        court: 'hard',
        format: 'fast4',
        archetypes: ['allcourt', 'allcourt'],
        aiDifficulty: 'rookie',
        seed: 88,
      });
      const origin = { x: 0, y: 1.0, z: 10.5 };
      const spin = makeTopspinVec(target.x - origin.x, target.z - origin.z, 35);
      const solved = solveBallisticShot({
        origin,
        target,
        desiredSpeedXZ: 25,
        spin,
        minNetClearanceM: 0.25,
      });
      state.phase = 'rally';
      state.players[1].pos = { x: -5, y: 0, z: -13 };
      state.ball.active = true;
      state.ball.lastHitter = 0;
      state.ball.lastShotType = 'topspin';
      state.ball.pos = origin;
      state.ball.vel = solved.vel;
      state.ball.spin = spin;

      let hawkeyeFired = false;
      for (let t = 0; t < 240; t++) {
        const res = stepMatch(state, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
        state = res.state;
        if (res.events.some((e) => e.type === 'HAWKEYE_START')) hawkeyeFired = true;
        if (state.phase === 'point_over' || state.phase === 'hawkeye') break;
      }
      expect(hawkeyeFired).toBe(false);
      expect(state.phase).toBe('point_over');
    }
  });

  it('rolls back firstServesTotal and totalMeterShots on serve LET replay', () => {
    const rng = createRng(91);
    let state = createMatchState({
      mode: 'single',
      court: 'hard',
      format: 'fast4',
      archetypes: ['allcourt', 'allcourt'],
      aiDifficulty: 'rookie',
      seed: 91,
    });
    // Launch a serve, force net-let flag while landing in deuce service box
    state = stepMatch(
      state,
      [{ seq: 1, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', phase: 'hold' }, IDLE_INPUT],
      COURT_DIM.FIXED_DT,
      rng
    ).state;
    state.players[0].meter.progress = 0.78;
    const hit = stepMatch(
      state,
      [{ seq: 2, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', phase: 'release' }, IDLE_INPUT],
      COURT_DIM.FIXED_DT,
      rng
    );
    state = hit.state;
    expect(state.stats[0].firstServesTotal).toBe(1);
    expect(state.stats[0].totalMeterShots).toBe(1);

    // Simulate ball clipping net cord and bouncing inside deuce box (-2.0, -4.5)
    state.ball.touchedNet = true;
    state.ball.pos = { x: -2.0, y: 0.04, z: -4.5 };
    state.ball.vel = { x: 0, y: -5.0, z: -12.0 };
    const bounceStep = stepMatch(state, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
    expect(bounceStep.state.phase).toBe('serve_ready');
    expect(bounceStep.state.score.serveNumber).toBe(1);
    expect(bounceStep.state.stats[0].firstServesTotal).toBe(0);
    expect(bounceStep.state.stats[0].totalMeterShots).toBe(0);
    expect(bounceStep.state.stats[0].perfectShots).toBe(0);
  });
});
