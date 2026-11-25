import { describe, expect, it } from 'vitest';
import {
  COURT_DIM,
  COURTS,
  makeTopspinVec,
  netHeightAt,
  solveBallisticShot,
  stepBallSubstep,
  type CourtId,
} from '../src/index.js';

function simulateFirstBounceMetrics(courtId: CourtId) {
  const court = COURTS[courtId];
  const subDt = COURT_DIM.FIXED_DT / COURT_DIM.PHYSICS_SUBSTEPS;
  let pos = { x: 0, y: 1.15, z: 9.0 };
  let vel = { x: 0, y: -5.2, z: -23.0 };
  let spin = makeTopspinVec(0, -1, 50);

  let bounced = false;
  let postBounceSpeedXZ = 0;
  let maxPostBounceY = 0;

  for (let i = 0; i < 600; i++) {
    const out = stepBallSubstep(pos, vel, spin, subDt, court);
    pos = out.pos;
    vel = out.vel;
    spin = out.spin;

    if (!bounced && out.bounced) {
      bounced = true;
      postBounceSpeedXZ = Math.hypot(vel.x, vel.z);
    } else if (bounced) {
      if (pos.y > maxPostBounceY) {
        maxPostBounceY = pos.y;
      }
      if (vel.y < 0 && pos.y <= maxPostBounceY) {
        break;
      }
    }
  }

  return { maxPostBounceY, postBounceSpeedXZ };
}

describe('AC-02: Three Grand Slam Courts Physics & Ballistic Solver', () => {
  it('matches exact court config constants', () => {
    expect(COURTS.hard.restitutionY).toBe(0.78);
    expect(COURTS.hard.retentionXZ).toBe(0.76);
    expect(COURTS.clay.restitutionY).toBe(0.86);
    expect(COURTS.clay.retentionXZ).toBe(0.66);
    expect(COURTS.clay.hasClayDust).toBe(true);
    expect(COURTS.grass.restitutionY).toBe(0.68);
    expect(COURTS.grass.retentionXZ).toBe(0.86);
  });

  it('satisfies AC-02 bounce height and post-bounce speed differentials', () => {
    const hard = simulateFirstBounceMetrics('hard');
    const clay = simulateFirstBounceMetrics('clay');
    const grass = simulateFirstBounceMetrics('grass');

    const clayVsHardPct = (clay.maxPostBounceY - hard.maxPostBounceY) / hard.maxPostBounceY;
    const grassDropPct = (hard.maxPostBounceY - grass.maxPostBounceY) / hard.maxPostBounceY;
    const grassVsClaySpeedPct = (grass.postBounceSpeedXZ - clay.postBounceSpeedXZ) / clay.postBounceSpeedXZ;

    expect(clayVsHardPct).toBeGreaterThanOrEqual(0.08);
    expect(grassDropPct).toBeGreaterThanOrEqual(0.1);
    expect(grassVsClaySpeedPct).toBeGreaterThanOrEqual(0.2);
  });

  it('prevents high-speed ball tunneling across net and ground with 2x substeps', () => {
    const court = COURTS.hard;
    const subDt = COURT_DIM.FIXED_DT / COURT_DIM.PHYSICS_SUBSTEPS;
    let pos = { x: 0, y: 0.45, z: 0.4 };
    let vel = { x: 0, y: -1.0, z: -48.0 }; // crosses Z=0 in <1 tick
    let spin = { x: 0, y: 0, z: 0 };

    let hitNet = false;
    for (let i = 0; i < 6; i++) {
      const out = stepBallSubstep(pos, vel, spin, subDt, court);
      pos = out.pos;
      vel = out.vel;
      spin = out.spin;
      if (out.hitNet) {
        hitNet = true;
        break;
      }
    }
    expect(hitNet).toBe(true);
    expect(netHeightAt(0)).toBeCloseTo(0.914, 4);
    expect(netHeightAt(4.57)).toBeCloseTo(1.07, 4);
  });

  it('solves deterministic 3-iteration ballistic shots within <= 0.15 m across shot types', () => {
    const cases = [
      {
        name: 'topspin',
        origin: { x: 1.5, y: 1.0, z: 11.2 },
        target: { x: -3.2, y: COURT_DIM.BALL_RADIUS, z: -10.5 },
        desiredSpeedXZ: 30,
        spin: makeTopspinVec(-4.7, -21.7, 56),
        minNetClearanceM: 0.22,
      },
      {
        name: 'slice',
        origin: { x: -2.0, y: 0.9, z: 10.0 },
        target: { x: 2.5, y: COURT_DIM.BALL_RADIUS, z: -8.5 },
        desiredSpeedXZ: 18,
        spin: makeTopspinVec(4.5, -18.5, -45),
        minNetClearanceM: 0.2,
      },
      {
        name: 'dropshot',
        origin: { x: 1.0, y: 0.95, z: 8.0 },
        target: { x: -2.5, y: COURT_DIM.BALL_RADIUS, z: -2.6 },
        desiredSpeedXZ: 14,
        spin: makeTopspinVec(-3.5, -10.6, -35),
        minNetClearanceM: 0.16,
      },
      {
        name: 'lob',
        origin: { x: 0.5, y: 0.9, z: 9.5 },
        target: { x: -1.5, y: COURT_DIM.BALL_RADIUS, z: -10.6 },
        desiredSpeedXZ: 19,
        spin: makeTopspinVec(-2.0, -20.1, 24),
        minNetClearanceM: 1.5,
        peakHeightMinM: 5.5,
      },
      {
        name: 'serve_flat',
        origin: { x: 1.45, y: 2.55, z: 12.1 },
        target: { x: -3.1, y: COURT_DIM.BALL_RADIUS, z: -5.8 },
        desiredSpeedXZ: 42,
        spin: makeTopspinVec(-4.55, -17.9, 18),
        minNetClearanceM: 0.16,
      },
    ];

    for (const c of cases) {
      const res = solveBallisticShot(c);
      expect(res.clearsNet).toBe(true);
      const err = Math.hypot(res.predictedLanding.x - c.target.x, res.predictedLanding.z - c.target.z);
      expect(err).toBeLessThanOrEqual(0.15);
    }
  });
});
