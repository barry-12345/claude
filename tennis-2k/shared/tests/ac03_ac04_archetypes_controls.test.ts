import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES,
  COURT_DIM,
  computeComfortRadius,
  computePlayerMaxSpeed,
  createMatchState,
  createRng,
  spawnIncomingTestBall,
  stepMatch,
  type ArchetypeId,
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

function measureMaxSpeed(archetype: ArchetypeId): number {
  let state = createMatchState({
    mode: 'single',
    court: 'hard',
    format: 'fast4',
    archetypes: [archetype, 'allcourt'],
    aiDifficulty: 'rookie',
    seed: 42,
  });
  state.phase = 'rally';
  state.ball.active = true;
  state.ball.pos = { x: 0, y: 1.5, z: -8 };
  state.ball.vel = { x: 0, y: 2, z: -10 };
  state.ball.lastHitter = 0;

  const rng = createRng(42);
  let maxSpd = 0;
  for (let i = 1; i <= 40; i++) {
    const res = stepMatch(
      state,
      [
        { seq: i, moveX: 1, moveZ: 0, aimX: 0, aimZ: 0, action: 'none', actionPressed: false },
        IDLE_INPUT,
      ],
      COURT_DIM.FIXED_DT,
      rng
    );
    state = res.state;
    const spd = Math.hypot(state.players[0].vel.x, state.players[0].vel.z);
    if (spd > maxSpd) maxSpd = spd;
  }
  return maxSpd;
}

function measureFirstServeSpeed(archetype: ArchetypeId): number {
  let state = createMatchState({
    mode: 'single',
    court: 'hard',
    format: 'fast4',
    archetypes: [archetype, 'allcourt'],
    aiDifficulty: 'rookie',
    seed: 42,
  });
  const rng = createRng(42);
  state = stepMatch(
    state,
    [{ seq: 1, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', actionPressed: true }, IDLE_INPUT],
    COURT_DIM.FIXED_DT,
    rng
  ).state;

  for (let i = 0; i < 30 && state.phase === 'serve_toss'; i++) {
    state = stepMatch(state, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng).state;
  }

  return Math.hypot(state.ball.vel.x, state.ball.vel.y, state.ball.vel.z);
}

describe('AC-03 & AC-06: Archetypes, V2 Controls, Shot Trajectories & Quality Tiers', () => {
  it('enforces strict total rating 400 with CTL and distinct appearance for all 4 archetypes', () => {
    const ids: ArchetypeId[] = ['power', 'allcourt', 'serve_volley', 'defender'];
    const jerseys = new Set<string>();
    const headgear = new Set<string>();

    for (const id of ids) {
      const a = ARCHETYPES[id];
      expect(a.power + a.speed + a.spin + a.control + a.net).toBe(400);
      expect('timing' in a).toBe(false);
      expect(a.shortsColor).toBeTruthy();
      expect(a.hairColor).toBeTruthy();
      expect(a.skinTone).toBeTruthy();
      jerseys.add(a.jerseyPrimary);
      headgear.add(a.headgear);
    }

    expect(jerseys.size).toBe(4);
    expect(headgear.size).toBe(4);
  });

  it('satisfies AC-03 speed, comfort radius, and first-serve velocity differentials', () => {
    const defSpeed = measureMaxSpeed('defender');
    const powSpeed = measureMaxSpeed('power');
    expect(defSpeed / powSpeed - 1).toBeGreaterThanOrEqual(0.15);
    expect(computePlayerMaxSpeed(ARCHETYPES.defender.speed)).toBeCloseTo(7.032, 3);

    const allcourtR = computeComfortRadius(ARCHETYPES.allcourt.control);
    const svR = computeComfortRadius(ARCHETYPES.serve_volley.control);
    expect(allcourtR / svR - 1).toBeGreaterThanOrEqual(0.08);

    const srvPower = measureFirstServeSpeed('power');
    const srvAll = measureFirstServeSpeed('allcourt');
    const srvSV = measureFirstServeSpeed('serve_volley');
    const srvDef = measureFirstServeSpeed('defender');
    expect(srvPower).toBeGreaterThan(srvAll);
    expect(srvPower).toBeGreaterThan(srvSV);
    expect(srvPower).toBeGreaterThan(srvDef);
  });

  it('differentiates J topspin, K default dropshot, W+K tight dropshot, S+K slice, L lob, and A/D spread', () => {
    const runShot = (
      action: 'J' | 'K' | 'L',
      aimX: number,
      aimZ: number,
      archetype: ArchetypeId = 'allcourt'
    ) => {
      const rng = createRng(42);
      let state = createMatchState({
        mode: 'single',
        court: 'hard',
        format: 'fast4',
        archetypes: [archetype, 'allcourt'],
        aiDifficulty: 'rookie',
        seed: 42,
      });
      state.players[0].pos = { x: 0, y: 0, z: 9.0 };
      state = spawnIncomingTestBall(state, { targetX: 0, targetZ: 9.0, speedXZ: 22, forPlayerIndex: 0 }, rng);

      let hitEvent: any = null;
      let maxY = 0;
      let firstBouncePos: { x: number; z: number } | null = null;
      let clearedNet = true;

      for (let t = 1; t <= 240; t++) {
        const input: PlayerInputFrame = !hitEvent
          ? { seq: t, moveX: 0, moveZ: 0, aimX, aimZ, action, actionPressed: t === 1 }
          : IDLE_INPUT;
        const res = stepMatch(state, [input, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
        state = res.state;

        if (!hitEvent) {
          const h = res.events.find((e) => e.type === 'SHOT_HIT' && e.hitter === 0);
          if (h) hitEvent = h;
        } else {
          if (state.ball.pos.y > maxY) maxY = state.ball.pos.y;
          if (res.events.some((e) => e.type === 'POINT_SCORED' && e.reason === 'net')) {
            clearedNet = false;
            break;
          }
          const b = res.events.find((e) => e.type === 'BOUNCE' && e.bounceIndex === 1);
          if (b && b.type === 'BOUNCE') {
            firstBouncePos = { x: b.pos.x, z: b.pos.z };
            break;
          }
        }
      }
      return { hitEvent, maxY, firstBouncePos, clearedNet };
    };

    const topspin = runShot('J', 0, 0);
    const plainK = runShot('K', 0, 0);
    const wkTight = runShot('K', 0, -1.0, 'serve_volley'); // P0 W -> aimZ = -1
    const skSlice = runShot('K', 0, 1.0); // P0 S -> aimZ = +1
    const lob = runShot('L', 0, 0);

    expect(topspin.hitEvent?.shotType).toBe('topspin');
    expect(plainK.hitEvent?.shotType).toBe('dropshot');
    expect(wkTight.hitEvent?.shotType).toBe('dropshot');
    expect(skSlice.hitEvent?.shotType).toBe('slice');
    expect(lob.hitEvent?.shotType).toBe('lob');

    expect(Math.abs(topspin.firstBouncePos!.z)).toBeGreaterThanOrEqual(8.0);
    expect(Math.abs(topspin.firstBouncePos!.z)).toBeLessThanOrEqual(11.5);
    expect(Math.abs(plainK.firstBouncePos!.z)).toBeGreaterThanOrEqual(1.8);
    expect(Math.abs(plainK.firstBouncePos!.z)).toBeLessThanOrEqual(3.9);
    expect(Math.abs(wkTight.firstBouncePos!.z)).toBeLessThan(Math.abs(plainK.firstBouncePos!.z));
    expect(Math.abs(skSlice.firstBouncePos!.z)).toBeGreaterThanOrEqual(4.8);
    expect(Math.abs(skSlice.firstBouncePos!.z)).toBeLessThanOrEqual(7.2);
    expect(lob.maxY).toBeGreaterThanOrEqual(5.0);

    // A/D spread >= 4.4 m
    const leftTop = runShot('J', -1, 0);
    const rightTop = runShot('J', 1, 0);
    expect(Math.abs(rightTop.firstBouncePos!.x - leftTop.firstBouncePos!.x)).toBeGreaterThanOrEqual(4.4);
  });

  it('verifies AC-06 CLEAN/SOLID/STRETCH speeds, CLEAN <= 0.12m precision, STRETCH dropshot [2.0,3.8]m, and CTL sideline control', () => {
    const rng = createRng(100);

    const simulateAtOffset = (
      offsetX: number,
      action: 'J' | 'K',
      aimX: number,
      aimZ: number,
      archetype: ArchetypeId,
      forceSlide = false
    ) => {
      let state = createMatchState({
        mode: 'single',
        court: 'hard',
        format: 'fast4',
        archetypes: [archetype, 'allcourt'],
        aiDifficulty: 'rookie',
        seed: 100,
      });
      state.players[0].pos = { x: offsetX, y: 0, z: 9.0 };
      state = spawnIncomingTestBall(state, { targetX: 0, targetZ: 9.0, speedXZ: 22, forPlayerIndex: 0 }, rng);

      let hitEvt: any = null;
      let clearedNet = true;
      let bouncePos: { x: number; z: number } | null = null;
      let inBounds = false;

      for (let t = 1; t <= 220; t++) {
        if (forceSlide && !hitEvt && state.ball.pos.z > 5.0) {
          state.players[0].isSliding = true;
          state.players[0].slideTimer = 0.25;
        }
        const input: PlayerInputFrame = !hitEvt
          ? { seq: t, moveX: 0, moveZ: 0, aimX, aimZ, action, actionPressed: t === 1 }
          : IDLE_INPUT;
        const res = stepMatch(state, [input, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
        state = res.state;
        if (!hitEvt) {
          const h = res.events.find((e) => e.type === 'SHOT_HIT' && e.hitter === 0);
          if (h) hitEvt = h;
        } else {
          if (res.events.some((e) => e.type === 'POINT_SCORED' && e.reason === 'net')) {
            clearedNet = false;
            break;
          }
          const b = res.events.find((e) => e.type === 'BOUNCE' && e.bounceIndex === 1);
          if (b && b.type === 'BOUNCE') {
            bouncePos = { x: b.pos.x, z: b.pos.z };
            inBounds = b.inBounds;
            break;
          }
        }
      }
      return { hitEvt, clearedNet, bouncePos, inBounds };
    };

    // 20+ CLEAN groundstrokes across J, K, S+K -> 100% over net & <= 0.12 m landing error
    const cleanCases: Array<{ action: 'J' | 'K'; aimX: number; aimZ: number; idealX: number; idealZ: number }> = [
      { action: 'J', aimX: 0.4, aimZ: 0, idealX: 0.4 * (COURT_DIM.SINGLES_HALF_WIDTH - 0.14), idealZ: -9.8 },
      { action: 'K', aimX: -0.3, aimZ: 0, idealX: -0.3 * (COURT_DIM.SINGLES_HALF_WIDTH - 0.32), idealZ: -2.85 },
      { action: 'K', aimX: 0.2, aimZ: 1, idealX: 0.2 * (COURT_DIM.SINGLES_HALF_WIDTH - 0.20), idealZ: -6.0 },
    ];

    for (let i = 0; i < 21; i++) {
      const c = cleanCases[i % cleanCases.length];
      const r = simulateAtOffset(0, c.action, c.aimX, c.aimZ, 'allcourt');
      expect(r.hitEvt?.quality).toBe('CLEAN');
      expect(r.clearedNet).toBe(true);
      expect(r.bouncePos).not.toBeNull();
      const err = Math.hypot(r.bouncePos!.x - c.idealX, r.bouncePos!.z - c.idealZ);
      expect(err).toBeLessThanOrEqual(0.12);
    }

    // Compare J speeds across CLEAN / SOLID / STRETCH with identical aim
    let cleanJSpeedSum = 0;
    let solidSpeedSum = 0;
    let stretchSpeedSum = 0;
    for (let i = 0; i < 20; i++) {
      const cleanJ = simulateAtOffset(0, 'J', 0, 0, 'allcourt');
      expect(cleanJ.hitEvt?.quality).toBe('CLEAN');
      expect(cleanJ.clearedNet).toBe(true);
      cleanJSpeedSum += cleanJ.hitEvt.speedKmh;

      const solid = simulateAtOffset(1.30, 'J', 0, 0, 'allcourt');
      expect(solid.hitEvt?.quality).toBe('SOLID');
      expect(solid.clearedNet).toBe(true);
      solidSpeedSum += solid.hitEvt.speedKmh;

      const stretch = simulateAtOffset(1.55, 'J', 0, 0, 'allcourt', true);
      expect(stretch.hitEvt?.quality).toBe('STRETCH');
      expect(Math.abs(stretch.bouncePos!.z)).toBeGreaterThanOrEqual(2.2);
      stretchSpeedSum += stretch.hitEvt.speedKmh;
    }
    expect(cleanJSpeedSum / 20).toBeGreaterThan(solidSpeedSum / 20);
    expect(solidSpeedSum / 20).toBeGreaterThan(stretchSpeedSum / 20);

    // STRETCH dropshot stays clamped in [2.0, 3.8] m (not pulled shallow into net)
    for (let i = 0; i < 20; i++) {
      const stretchDrop = simulateAtOffset(1.55, 'K', 0, 0, 'allcourt', true);
      expect(stretchDrop.hitEvt?.quality).toBe('STRETCH');
      expect(stretchDrop.hitEvt?.shotType).toBe('dropshot');
      expect(stretchDrop.clearedNet).toBe(true);
      expect(Math.abs(stretchDrop.bouncePos!.z)).toBeGreaterThanOrEqual(2.0);
      expect(Math.abs(stretchDrop.bouncePos!.z)).toBeLessThanOrEqual(3.8);
    }

    // High CTL (allcourt=86) has lower sideline out rate under STRETCH than low CTL (serve_volley=74)
    let highCtlOut = 0;
    let lowCtlOut = 0;
    for (let i = 0; i < 120; i++) {
      const hi = simulateAtOffset(1.55, 'J', 0.95, 0, 'allcourt', true);
      if (!hi.inBounds) highCtlOut++;
      const lo = simulateAtOffset(1.55, 'J', 0.95, 0, 'serve_volley', true);
      if (!lo.inBounds) lowCtlOut++;
    }
    expect(highCtlOut).toBeLessThan(lowCtlOut);
  });

  it('triggers automatic extreme-reach slide extending reach radius to 1.90 m', () => {
    let state = createMatchState({
      mode: 'single',
      court: 'clay',
      format: 'fast4',
      archetypes: ['allcourt', 'allcourt'],
      aiDifficulty: 'rookie',
      seed: 42,
    });
    state.phase = 'rally';
    state.players[0].pos = { x: 0.0, y: 0, z: 10.0 };
    state.ball.active = true;
    state.ball.lastHitter = 1;
    state.ball.hitTick = 0;
    state.ball.pos = { x: 1.9, y: 1.0, z: 6.0 };
    state.ball.vel = { x: 0, y: 0, z: 16.0 };
    state.ball.predictedLanding = { x: 1.9, y: COURT_DIM.BALL_RADIUS, z: 10.0 };

    const rng = createRng(42);
    const step1 = stepMatch(
      state,
      [{ seq: 1, moveX: 1, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', actionPressed: true }, IDLE_INPUT],
      COURT_DIM.FIXED_DT,
      rng
    );
    expect(step1.state.players[0].isSliding).toBe(true);

    // Ball at 1.70 m (> 1.48 m base, <= 1.90 m slide reach) moving toward player -> auto-hits STRETCH
    state = step1.state;
    state.ball.pos = { x: state.players[0].pos.x + 1.70, y: 0.9, z: state.players[0].pos.z };
    state.ball.vel = { x: 0.5, y: 0, z: 14.0 };
    let shotEvt: any = null;
    for (let t = 2; t <= 8 && !shotEvt; t++) {
      const hitRes = stepMatch(
        state,
        [{ seq: t, moveX: 1, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', actionPressed: false }, IDLE_INPUT],
        COURT_DIM.FIXED_DT,
        rng
      );
      state = hitRes.state;
      shotEvt = hitRes.events.find((e) => e.type === 'SHOT_HIT' && e.hitter === 0) ?? null;
    }
    expect(shotEvt).toBeDefined();
    expect(shotEvt?.quality).toBe('STRETCH');
  });
});
