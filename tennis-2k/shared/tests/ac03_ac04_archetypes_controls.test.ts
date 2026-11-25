import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES,
  COURT_DIM,
  computeBaseGreenHalfWidth,
  computePlayerMaxSpeed,
  createMatchState,
  createRng,
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
  phase: 'idle',
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
        { seq: i, moveX: 1, moveZ: 0, aimX: 0, aimZ: 0, action: 'none', phase: 'idle' },
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
    [{ seq: 1, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', phase: 'hold' }, IDLE_INPUT],
    COURT_DIM.FIXED_DT,
    rng
  ).state;

  while (state.players[0].meter.progress < 0.77) {
    state = stepMatch(
      state,
      [{ seq: state.tick + 1, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', phase: 'hold' }, IDLE_INPUT],
      COURT_DIM.FIXED_DT,
      rng
    ).state;
  }

  const hitRes = stepMatch(
    state,
    [{ seq: state.tick + 1, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', phase: 'release' }, IDLE_INPUT],
    COURT_DIM.FIXED_DT,
    rng
  );
  return Math.hypot(hitRes.state.ball.vel.x, hitRes.state.ball.vel.y, hitRes.state.ball.vel.z);
}

describe('AC-03 & AC-04: Archetypes, Controls, 4 Shot Trajectories & Slide Reach', () => {
  it('enforces strict total rating 400 and distinct attributes/appearance for all 4 archetypes', () => {
    const ids: ArchetypeId[] = ['power', 'allcourt', 'serve_volley', 'defender'];
    const jerseys = new Set<string>();
    const headgear = new Set<string>();

    for (const id of ids) {
      const a = ARCHETYPES[id];
      expect(a.power + a.speed + a.spin + a.timing + a.net).toBe(400);
      jerseys.add(a.jerseyPrimary);
      headgear.add(a.headgear);
    }

    expect(jerseys.size).toBe(4);
    expect(headgear.size).toBe(4);
  });

  it('satisfies AC-03 speed, green-bar width, and first-serve velocity differentials', () => {
    const defSpeed = measureMaxSpeed('defender');
    const powSpeed = measureMaxSpeed('power');
    expect(defSpeed / powSpeed - 1).toBeGreaterThanOrEqual(0.15);
    expect(computePlayerMaxSpeed(ARCHETYPES.defender.speed)).toBeCloseTo(7.032, 3);

    const allcourtWidth = computeBaseGreenHalfWidth(ARCHETYPES.allcourt.timing);
    const svWidth = computeBaseGreenHalfWidth(ARCHETYPES.serve_volley.timing);
    expect(allcourtWidth / svWidth - 1).toBeGreaterThanOrEqual(0.12);

    const srvPower = measureFirstServeSpeed('power');
    const srvAll = measureFirstServeSpeed('allcourt');
    const srvSV = measureFirstServeSpeed('serve_volley');
    const srvDef = measureFirstServeSpeed('defender');
    expect(srvPower).toBeGreaterThan(srvAll);
    expect(srvPower).toBeGreaterThan(srvSV);
    expect(srvPower).toBeGreaterThan(srvDef);
  });

  it('differentiates J topspin, K slice, W+K dropshot (Z in [1.8, 3.6]), and L lob (peak >= 5.0m)', () => {
    const runShot = (action: 'J' | 'K' | 'L', aimZ: number) => {
      let state = createMatchState({
        mode: 'single',
        court: 'hard',
        format: 'fast4',
        archetypes: ['allcourt', 'allcourt'],
        aiDifficulty: 'rookie',
        seed: 42,
      });
      state.phase = 'rally';
      state.players[0].pos = { x: 0, y: 0, z: 10.5 };
      state.players[1].pos = { x: -5.5, y: 0, z: -13.0 };
      state.ball.active = true;
      state.ball.pos = { x: 0.2, y: 1.0, z: 10.2 };
      state.ball.vel = { x: 0, y: 0, z: 2.0 };
      state.ball.lastHitter = 1;

      const rng = createRng(42);
      state = stepMatch(
        state,
        [{ seq: 1, moveX: 0, moveZ: 0, aimX: 0.2, aimZ, action, phase: 'hold' }, IDLE_INPUT],
        COURT_DIM.FIXED_DT,
        rng
      ).state;

      while (state.players[0].meter.progress < 0.77) {
        state.ball.pos = { x: 0.2, y: 1.0, z: 10.2 };
        state.ball.vel = { x: 0, y: 0, z: 0 };
        state = stepMatch(
          state,
          [{ seq: state.tick + 1, moveX: 0, moveZ: 0, aimX: 0.2, aimZ, action, phase: 'hold' }, IDLE_INPUT],
          COURT_DIM.FIXED_DT,
          rng
        ).state;
      }

      const hit = stepMatch(
        state,
        [{ seq: state.tick + 1, moveX: 0, moveZ: 0, aimX: 0.2, aimZ, action, phase: 'release' }, IDLE_INPUT],
        COURT_DIM.FIXED_DT,
        rng
      );
      state = hit.state;
      const shotEvent = hit.events.find((e) => e.type === 'SHOT_HIT');
      let maxY = state.ball.pos.y;
      let firstBounceZ = 0;
      for (let t = 0; t < 240; t++) {
        const res = stepMatch(state, [IDLE_INPUT, IDLE_INPUT], COURT_DIM.FIXED_DT, rng);
        state = res.state;
        if (state.ball.pos.y > maxY) maxY = state.ball.pos.y;
        const b = res.events.find((e) => e.type === 'BOUNCE');
        if (b && b.type === 'BOUNCE' && b.bounceIndex === 1) {
          firstBounceZ = b.pos.z;
          break;
        }
      }
      return { shotEvent, maxY, firstBounceZ };
    };

    const topspin = runShot('J', 0);
    const slice = runShot('K', 0.2);
    const dropshot = runShot('K', -1.0); // P0 holds W -> aimZ = -1
    const lob = runShot('L', 0);

    expect(topspin.shotEvent?.type === 'SHOT_HIT' && topspin.shotEvent.shotType).toBe('topspin');
    expect(slice.shotEvent?.type === 'SHOT_HIT' && slice.shotEvent.shotType).toBe('slice');
    expect(dropshot.shotEvent?.type === 'SHOT_HIT' && dropshot.shotEvent.shotType).toBe('dropshot');
    expect(lob.shotEvent?.type === 'SHOT_HIT' && lob.shotEvent.shotType).toBe('lob');

    expect(Math.abs(dropshot.firstBounceZ)).toBeGreaterThanOrEqual(1.8);
    expect(Math.abs(dropshot.firstBounceZ)).toBeLessThanOrEqual(3.6);
    expect(lob.maxY).toBeGreaterThanOrEqual(5.0);
    expect(Math.abs(topspin.firstBounceZ)).toBeGreaterThan(Math.abs(dropshot.firstBounceZ) + 4.0);
  });

  it('silently ignores L key during serve_ready', () => {
    const state = createMatchState({
      mode: 'single',
      court: 'hard',
      format: 'fast4',
      archetypes: ['allcourt', 'allcourt'],
      aiDifficulty: 'rookie',
      seed: 42,
    });
    const rng = createRng(42);
    const res = stepMatch(
      state,
      [{ seq: 1, moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, action: 'L', phase: 'hold' }, IDLE_INPUT],
      COURT_DIM.FIXED_DT,
      rng
    );
    expect(res.state.phase).toBe('serve_ready');
    expect(res.state.players[0].meter.active).toBe(false);
  });

  it('triggers automatic extreme-reach slide extending hit radius to 1.80m', () => {
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
    state.ball.pos = { x: 1.9, y: 1.0, z: 6.0 };
    state.ball.vel = { x: 0, y: 0, z: 16.0 };
    state.ball.predictedLanding = { x: 1.9, y: COURT_DIM.BALL_RADIUS, z: 10.0 };

    const rng = createRng(42);
    const step1 = stepMatch(
      state,
      [{ seq: 1, moveX: 1, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', phase: 'hold' }, IDLE_INPUT],
      COURT_DIM.FIXED_DT,
      rng
    );
    expect(step1.state.players[0].isSliding).toBe(true);

    // Position ball at 1.65 m (> 1.35 m base, <= 1.80 m slide) and release
    state = step1.state;
    state.ball.pos = { x: state.players[0].pos.x + 1.65, y: 0.9, z: state.players[0].pos.z };
    const hitRes = stepMatch(
      state,
      [{ seq: 2, moveX: 1, moveZ: 0, aimX: 0, aimZ: 0, action: 'J', phase: 'release' }, IDLE_INPUT],
      COURT_DIM.FIXED_DT,
      rng
    );
    expect(hitRes.events.some((e) => e.type === 'SHOT_HIT' && e.hitter === 0)).toBe(true);
  });
});
