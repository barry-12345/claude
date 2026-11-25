import { COURT_DIM, PHYSICS_CONSTANTS } from './constants.js';
import type {
  BallisticSolveParams,
  BallisticSolveResult,
  CourtConfig,
  HawkeyeState,
  PlayerSide,
  Vec3,
} from './types.js';

/**
 * Compute net height at world X coordinate (m).
 */
export function netHeightAt(x: number): number {
  const t = Math.min(1, Math.abs(x) / COURT_DIM.NET_POST_X);
  return COURT_DIM.NET_CENTER_HEIGHT + (COURT_DIM.NET_POST_HEIGHT - COURT_DIM.NET_CENTER_HEIGHT) * t;
}

export function clamp(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}

/**
 * Compute 3D acceleration including gravity, quadratic air drag, and Magnus lift/dip.
 */
export function computeBallAcceleration(vel: Vec3, spin: Vec3): Vec3 {
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  const kd = PHYSICS_CONSTANTS.DRAG_COEFF;
  const km = PHYSICS_CONSTANTS.MAGNUS_COEFF;

  // Cross product: spin x vel
  const mx = spin.y * vel.z - spin.z * vel.y;
  const my = spin.z * vel.x - spin.x * vel.z;
  const mz = spin.x * vel.y - spin.y * vel.x;

  return {
    x: -kd * speed * vel.x + km * mx,
    y: -PHYSICS_CONSTANTS.GRAVITY - kd * speed * vel.y + km * my,
    z: -kd * speed * vel.z + km * mz,
  };
}

export interface SubstepOutcome {
  pos: Vec3;
  vel: Vec3;
  spin: Vec3;
  bounced: boolean;
  bouncePos: Vec3 | null;
  hitNet: boolean;
  netLet: boolean;
  netPos: Vec3 | null;
}

/**
 * Advance the ball by a single physics substep (subDt = 1/120 s) with net & ground collision.
 */
export function stepBallSubstep(
  pos: Vec3,
  vel: Vec3,
  spin: Vec3,
  subDt: number,
  court: CourtConfig
): SubstepOutcome {
  // Semi-implicit Euler integration with drag + Magnus
  const acc = computeBallAcceleration(vel, spin);
  let vx = vel.x + acc.x * subDt;
  let vy = vel.y + acc.y * subDt;
  let vz = vel.z + acc.z * subDt;

  const prevX = pos.x;
  const prevY = pos.y;
  const prevZ = pos.z;

  let nx = prevX + vx * subDt;
  let ny = prevY + vy * subDt;
  let nz = prevZ + vz * subDt;

  let sx = spin.x;
  let sy = spin.y;
  let sz = spin.z;

  let hitNet = false;
  let netLet = false;
  let netPos: Vec3 | null = null;

  // Check crossing of Z = 0 net plane
  if ((prevZ > 0 && nz <= 0) || (prevZ < 0 && nz >= 0)) {
    const denom = Math.abs(prevZ - nz);
    const t = denom > 1e-9 ? Math.abs(prevZ) / denom : 0.5;
    const xNet = prevX + (nx - prevX) * t;
    const yNet = prevY + (ny - prevY) * t;

    if (Math.abs(xNet) <= COURT_DIM.NET_POST_X + 0.15) {
      const netH = netHeightAt(xNet);
      if (yNet < netH - PHYSICS_CONSTANTS.NET_LET_TOLERANCE_M) {
        // Caught in the net
        hitNet = true;
        netPos = { x: xNet, y: Math.max(COURT_DIM.BALL_RADIUS, yNet), z: prevZ >= 0 ? 0.03 : -0.03 };
        vx *= 0.25;
        vz *= -0.15;
        vy = -0.1 * Math.abs(vy);
        nx = netPos.x;
        ny = netPos.y;
        nz = netPos.z;
      } else if (yNet <= netH + COURT_DIM.BALL_RADIUS) {
        // Net cord let (clears net with dampened horizontal speed)
        netLet = true;
        netPos = { x: xNet, y: yNet, z: 0 };
        vx *= PHYSICS_CONSTANTS.NET_LET_SPEED_SCALE;
        vz *= PHYSICS_CONSTANTS.NET_LET_SPEED_SCALE;
      }
    }
  }

  let bounced = false;
  let bouncePos: Vec3 | null = null;

  // Ground bounce check (y <= BALL_RADIUS and descending)
  if (ny <= COURT_DIM.BALL_RADIUS && vy < 0) {
    const prevAbove = prevY - COURT_DIM.BALL_RADIUS;
    const below = COURT_DIM.BALL_RADIUS - ny;
    const denom = prevAbove + below;
    const t = denom > 1e-9 ? clamp(prevAbove / denom, 0, 1) : 1;

    const bx = prevX + (nx - prevX) * t;
    const bz = prevZ + (nz - prevZ) * t;
    bouncePos = { x: bx, y: COURT_DIM.BALL_RADIUS, z: bz };
    bounced = true;

    // Surface tangential push from spin: spin x up(0,1,0) = (-sz, 0, sx)
    // Multiplied by BALL_RADIUS for physical tangential velocity at contact
    const spinBoostX = -sz * COURT_DIM.BALL_RADIUS;
    const spinBoostZ = sx * COURT_DIM.BALL_RADIUS;

    vx = court.retentionXZ * vx + court.spinGrip * spinBoostX;
    vz = court.retentionXZ * vz + court.spinGrip * spinBoostZ;
    vy = -court.restitutionY * vy;

    sx *= PHYSICS_CONSTANTS.BOUNCE_SPIN_DECAY;
    sy *= PHYSICS_CONSTANTS.BOUNCE_SPIN_DECAY;
    sz *= PHYSICS_CONSTANTS.BOUNCE_SPIN_DECAY;

    // Advance remainder of substep above ground
    const remDt = subDt * (1 - t);
    nx = bx + vx * remDt;
    ny = COURT_DIM.BALL_RADIUS + Math.max(0, vy * remDt);
    nz = bz + vz * remDt;
  }

  return {
    pos: { x: nx, y: ny, z: nz },
    vel: { x: vx, y: vy, z: vz },
    spin: { x: sx, y: sy, z: sz },
    bounced,
    bouncePos,
    hitNet,
    netLet,
    netPos,
  };
}

export interface BounceJudgment {
  inBounds: boolean;
  distanceToLineCm: number;
  lineType: HawkeyeState['lineType'];
}

/**
 * Evaluate ITF line-mark bounds and nearest line distance for a bounce on targetSide's half.
 * When out of bounds, distanceToLineCm & lineType strictly reflect the violated boundary line(s).
 */
export function evaluateBounceBounds(
  pos: Vec3,
  isServe: boolean,
  targetSide: PlayerSide,
  courtSide: 'deuce' | 'ad'
): BounceJudgment {
  const rMark = COURT_DIM.BALL_RADIUS;
  const inTargetHalf = pos.z * targetSide > 0;
  const roundCm = (meters: number) => Number((meters * 100).toFixed(2));

  if (!isServe) {
    const inX = Math.abs(pos.x) <= COURT_DIM.SINGLES_HALF_WIDTH + rMark;
    const inZ = inTargetHalf && Math.abs(pos.z) <= COURT_DIM.HALF_LENGTH + rMark;
    const inBounds = inX && inZ;

    const dLeft = Math.abs(pos.x + COURT_DIM.SINGLES_HALF_WIDTH);
    const dRight = Math.abs(pos.x - COURT_DIM.SINGLES_HALF_WIDTH);
    const dSideline = Math.min(dLeft, dRight);
    const dBaseline = Math.abs(pos.z - targetSide * COURT_DIM.HALF_LENGTH);

    if (inBounds) {
      if (dSideline <= dBaseline) {
        return { inBounds: true, distanceToLineCm: roundCm(dSideline), lineType: 'sideline' };
      }
      return { inBounds: true, distanceToLineCm: roundCm(dBaseline), lineType: 'baseline' };
    }

    if (!inX && inZ) {
      return { inBounds: false, distanceToLineCm: roundCm(dSideline), lineType: 'sideline' };
    }
    if (inX && !inZ) {
      return { inBounds: false, distanceToLineCm: roundCm(dBaseline), lineType: 'baseline' };
    }
    const cornerDist = Math.hypot(dSideline, dBaseline);
    return {
      inBounds: false,
      distanceToLineCm: roundCm(cornerDist),
      lineType: dBaseline >= dSideline ? 'baseline' : 'sideline',
    };
  }

  // Serve box: diagonal opposite service box
  // targetSide === -1 (P0 serving): deuce -> x <= 0, ad -> x >= 0
  // targetSide === +1 (P1 serving): deuce -> x >= 0, ad -> x <= 0
  const expectedSignX = targetSide * (courtSide === 'deuce' ? 1 : -1);
  const xMinNominal = expectedSignX > 0 ? 0 : -COURT_DIM.SINGLES_HALF_WIDTH;
  const xMaxNominal = expectedSignX > 0 ? COURT_DIM.SINGLES_HALF_WIDTH : 0;

  const inX = pos.x >= xMinNominal - rMark && pos.x <= xMaxNominal + rMark;
  const inZ = inTargetHalf && Math.abs(pos.z) <= COURT_DIM.SERVICE_LINE_Z + rMark;
  const inBounds = inX && inZ;

  const dCenter = Math.abs(pos.x);
  const dOuter = Math.abs(pos.x - expectedSignX * COURT_DIM.SINGLES_HALF_WIDTH);
  const dServiceZ = Math.abs(pos.z - targetSide * COURT_DIM.SERVICE_LINE_Z);

  if (inBounds) {
    const candidates: Array<{ dist: number; lineType: HawkeyeState['lineType'] }> = [
      { dist: dOuter, lineType: 'sideline' },
      { dist: dCenter, lineType: 'center_service_line' },
      { dist: dServiceZ, lineType: 'service_line' },
    ];
    candidates.sort((a, b) => a.dist - b.dist);
    return {
      inBounds: true,
      distanceToLineCm: roundCm(candidates[0].dist),
      lineType: candidates[0].lineType,
    };
  }

  const xViolation: { dist: number; lineType: 'center_service_line' | 'sideline' } =
    pos.x * expectedSignX < 0
      ? { dist: dCenter, lineType: 'center_service_line' }
      : { dist: dOuter, lineType: 'sideline' };

  if (!inX && inZ) {
    return {
      inBounds: false,
      distanceToLineCm: roundCm(xViolation.dist),
      lineType: xViolation.lineType,
    };
  }
  if (inX && !inZ) {
    return {
      inBounds: false,
      distanceToLineCm: roundCm(dServiceZ),
      lineType: 'service_line',
    };
  }

  const cornerDist = Math.hypot(xViolation.dist, dServiceZ);
  return {
    inBounds: false,
    distanceToLineCm: roundCm(cornerDist),
    lineType: dServiceZ >= xViolation.dist ? 'service_line' : xViolation.lineType,
  };
}

/**
 * Compute world-space spin vector given horizontal direction and topspin magnitude (+ = topspin, - = backspin).
 */
export function makeTopspinVec(dirX: number, dirZ: number, topspinRadPerSec: number, sidespinRadPerSec = 0): Vec3 {
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-6) {
    return { x: 0, y: sidespinRadPerSec, z: 0 };
  }
  const ux = dirX / len;
  const uz = dirZ / len;
  // Axis y_hat x dir_hat = (uz, 0, -ux)
  return {
    x: uz * topspinRadPerSec,
    y: sidespinRadPerSec,
    z: -ux * topspinRadPerSec,
  };
}

interface SimTrajectoryResult {
  landing: Vec3;
  flightTimeSec: number;
  clearsNet: boolean;
  netMarginM: number;
  peakY: number;
}

const SOLVER_COURT: CourtConfig = {
  id: 'hard',
  label: 'solver',
  innerColor: '#000000',
  outerColor: '#000000',
  lineColor: '#FFFFFF',
  restitutionY: 0.78,
  retentionXZ: 0.76,
  spinGrip: 0.18,
  playerFriction: 1.0,
  slideDurationSec: 0.22,
  hasClayDust: false,
};

function simulateToFirstBounce(origin: Vec3, vel: Vec3, spin: Vec3): SimTrajectoryResult {
  const subDt = COURT_DIM.FIXED_DT / COURT_DIM.PHYSICS_SUBSTEPS;
  let pos = { ...origin };
  let curVel = { ...vel };
  let curSpin = { ...spin };
  let peakY = pos.y;
  let clearsNet = true;
  let netMarginM = Infinity;
  let elapsed = 0;

  const maxSteps = 6 * 120; // 6 seconds max
  for (let step = 0; step < maxSteps; step++) {
    const prevZ = pos.z;
    const prevX = pos.x;
    const prevY = pos.y;

    const outcome = stepBallSubstep(pos, curVel, curSpin, subDt, SOLVER_COURT);
    elapsed += subDt;

    if (outcome.hitNet) {
      clearsNet = false;
      const xN = outcome.netPos?.x ?? prevX;
      const yN = outcome.netPos?.y ?? prevY;
      netMarginM = yN - netHeightAt(xN);
      return {
        landing: outcome.pos,
        flightTimeSec: elapsed,
        clearsNet: false,
        netMarginM,
        peakY,
      };
    }

    if ((prevZ > 0 && outcome.pos.z <= 0) || (prevZ < 0 && outcome.pos.z >= 0)) {
      const denom = Math.abs(prevZ - outcome.pos.z);
      const t = denom > 1e-9 ? Math.abs(prevZ) / denom : 0.5;
      const xNet = prevX + (outcome.pos.x - prevX) * t;
      const yNet = prevY + (outcome.pos.y - prevY) * t;
      netMarginM = yNet - netHeightAt(xNet);
      if (yNet < netHeightAt(xNet)) {
        clearsNet = false;
      }
    }

    pos = outcome.pos;
    curVel = outcome.vel;
    curSpin = outcome.spin;
    if (pos.y > peakY) {
      peakY = pos.y;
    }

    if (outcome.bounced && outcome.bouncePos) {
      return {
        landing: outcome.bouncePos,
        flightTimeSec: elapsed,
        clearsNet,
        netMarginM: Number.isFinite(netMarginM) ? netMarginM : 1.0,
        peakY,
      };
    }
  }

  return {
    landing: pos,
    flightTimeSec: elapsed,
    clearsNet,
    netMarginM: Number.isFinite(netMarginM) ? netMarginM : 0,
    peakY,
  };
}

/**
 * Deterministic 3-iteration ballistic solver compensating for air drag, Magnus spin, net clearance, and peak height.
 */
export function solveBallisticShot(params: BallisticSolveParams): BallisticSolveResult {
  const { origin, target, desiredSpeedXZ, spin, minNetClearanceM, peakHeightMinM } = params;
  const g = PHYSICS_CONSTANTS.GRAVITY;
  const targetY = target.y > COURT_DIM.BALL_RADIUS ? target.y : COURT_DIM.BALL_RADIUS;

  const dx0 = target.x - origin.x;
  const dz0 = target.z - origin.z;
  const dist0 = Math.hypot(dx0, dz0);
  if (dist0 < 1e-4) {
    return {
      vel: { x: 0, y: 4, z: 0 },
      flightTimeSec: 0.5,
      predictedLanding: { ...target, y: targetY },
      clearsNet: true,
    };
  }

  // Initial flight-time estimate bounded by net clearance and optional lob peak height
  const baseSpeed = Math.max(4, desiredSpeedXZ);
  let flightT = dist0 / baseSpeed;

  if (origin.z * target.z < 0) {
    const f = Math.abs(origin.z) / (Math.abs(origin.z) + Math.abs(target.z));
    const xNet = origin.x + f * dx0;
    const minNetY = netHeightAt(xNet) + minNetClearanceM;
    const baseNetY = (1 - f) * origin.y + f * targetY;
    if (minNetY > baseNetY && f > 0.02 && f < 0.98) {
      const minTForNet = Math.sqrt((2 * (minNetY - baseNetY)) / (g * f * (1 - f)));
      if (minTForNet > flightT) {
        flightT = minTForNet;
      }
    }
  }

  if (peakHeightMinM !== undefined && peakHeightMinM > Math.max(origin.y, targetY)) {
    const hRise = peakHeightMinM - origin.y;
    const hFall = peakHeightMinM - targetY;
    const minTForPeak = Math.sqrt((2 * hRise) / g) + Math.sqrt((2 * hFall) / g);
    if (minTForPeak > flightT) {
      flightT = minTForPeak;
    }
  }

  let aimX = target.x;
  let aimZ = target.z;
  let extraVy = 0;

  let vel: Vec3 = { x: 0, y: 0, z: 0 };
  let sim: SimTrajectoryResult = {
    landing: { ...target, y: targetY },
    flightTimeSec: flightT,
    clearsNet: true,
    netMarginM: 1,
    peakY: origin.y,
  };

  for (let iter = 0; iter < 3; iter++) {
    const dx = aimX - origin.x;
    const dz = aimZ - origin.z;
    const dist = Math.hypot(dx, dz);
    const dragBoost = 1 + 0.5 * PHYSICS_CONSTANTS.DRAG_COEFF * dist;
    const vx = (dx / flightT) * dragBoost;
    const vz = (dz / flightT) * dragBoost;
    const vy = (targetY - origin.y + 0.5 * g * flightT * flightT) / flightT + extraVy;

    vel = { x: vx, y: vy, z: vz };
    sim = simulateToFirstBounce(origin, vel, spin);

    const errX = target.x - sim.landing.x;
    const errZ = target.z - sim.landing.z;
    aimX += errX * 0.92;
    aimZ += errZ * 0.92;

    if (!sim.clearsNet || sim.netMarginM < minNetClearanceM) {
      const deficit = Math.max(0.05, minNetClearanceM - sim.netMarginM);
      extraVy += Math.sqrt(2 * g * deficit) * 0.65;
      flightT *= 1.06;
    }
    if (peakHeightMinM !== undefined && sim.peakY < peakHeightMinM) {
      const deficitH = peakHeightMinM - sim.peakY;
      extraVy += Math.sqrt(2 * g * deficitH) * 0.65;
      flightT *= 1.05;
    }
  }

  // Final velocity from 3rd compensated aim target
  const dxFinal = aimX - origin.x;
  const dzFinal = aimZ - origin.z;
  const distFinal = Math.hypot(dxFinal, dzFinal);
  const dragBoostFinal = 1 + 0.5 * PHYSICS_CONSTANTS.DRAG_COEFF * distFinal;
  vel = {
    x: (dxFinal / flightT) * dragBoostFinal,
    y: (targetY - origin.y + 0.5 * g * flightT * flightT) / flightT + extraVy,
    z: (dzFinal / flightT) * dragBoostFinal,
  };
  sim = simulateToFirstBounce(origin, vel, spin);

  return {
    vel,
    flightTimeSec: sim.flightTimeSec,
    predictedLanding: sim.landing,
    clearsNet: sim.clearsNet,
  };
}
