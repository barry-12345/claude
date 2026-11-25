import { ARCHETYPES, COURT_DIM, COURTS, PHYSICS_CONSTANTS } from './constants.js';
import {
  computeNetAccuracyMultiplier,
  computePlayerMaxSpeed,
  computePowerMultiplier,
  computeShotQuality,
  computeSpinMultiplier,
} from './meter.js';
import { cloneMatchState, cloneVec3 } from './mirror.js';
import { clamp, evaluateBounceBounds, makeTopspinVec, solveBallisticShot, stepBallSubstep } from './physics.js';
import {
  awardPointToScore,
  computeServeSetupPositions,
  createEmptyStats,
  createInitialScoreState,
} from './rules.js';
import type {
  GameEvent,
  HawkeyeState,
  MatchConfig,
  MatchState,
  PlayerIndex,
  PlayerInputFrame,
  PlayerSide,
  PlayerState,
  PRNG,
  ShotQuality,
  ShotType,
  Vec3,
} from './types.js';

function createInitialPlayer(
  index: PlayerIndex,
  archetype: MatchConfig['archetypes'][number],
  pos: Vec3
): PlayerState {
  const side: PlayerSide = index === 0 ? 1 : -1;
  return {
    index,
    side,
    archetype,
    pos: cloneVec3(pos),
    vel: { x: 0, y: 0, z: 0 },
    yaw: side === 1 ? 0 : Math.PI,
    anim: 'idle',
    animTime: 0,
    isSliding: false,
    slideTimer: 0,
    moveAccelTime: 0,
    meter: {
      active: false,
      action: 'none',
      progress: 0,
      sweetCenter: PHYSICS_CONSTANTS.METER_SWEET_CENTER,
      effectiveHalfWidth: 0.055,
      lastQuality: null,
    },
    takeoverEnergy: 0,
    takeoverPointsLeft: 0,
    takeoverCooldown: false,
  };
}

function resetBallOnServer(state: MatchState): void {
  const srvIdx = state.score.server;
  const srv = state.players[srvIdx];
  state.ball = {
    pos: { x: srv.pos.x, y: 1.05, z: srv.pos.z - srv.side * 0.35 },
    vel: { x: 0, y: 0, z: 0 },
    spin: { x: 0, y: 0, z: 0 },
    active: false,
    bounces: 0,
    touchedNet: false,
    hitTick: state.tick,
    firstBouncePos: null,
    firstBounceInBounds: null,
    lastHitter: null,
    lastShotType: null,
    lastShotQuality: null,
    speedKmhDisplay: 0,
    predictedLanding: null,
  };
}

function resetPlayersForServe(state: MatchState): void {
  const { serverPos, receiverPos } = computeServeSetupPositions(state.score);
  const srvIdx = state.score.server;
  const rcvIdx = (1 - srvIdx) as PlayerIndex;

  for (const idx of [0, 1] as const) {
    const p = state.players[idx];
    p.pos = idx === srvIdx ? cloneVec3(serverPos) : cloneVec3(receiverPos);
    p.vel = { x: 0, y: 0, z: 0 };
    p.yaw = p.side === 1 ? 0 : Math.PI;
    p.anim = 'idle';
    p.animTime = 0;
    p.isSliding = false;
    p.slideTimer = 0;
    p.moveAccelTime = 0;
    p.meter.active = false;
    p.meter.action = 'none';
    p.meter.progress = 0;
  }

  state.phase = 'serve_ready';
  state.phaseTimer = 0;
  resetBallOnServer(state);
}

/**
 * Create a fresh MatchState initialized to serve_ready on the deuce court.
 */
export function createMatchState(config: MatchConfig): MatchState {
  const score = createInitialScoreState(config.format);
  const { serverPos, receiverPos } = computeServeSetupPositions(score);

  const p0 = createInitialPlayer(0, config.archetypes[0], serverPos);
  const p1 = createInitialPlayer(1, config.archetypes[1], receiverPos);

  const state: MatchState = {
    tick: 0,
    config: {
      ...config,
      archetypes: [config.archetypes[0], config.archetypes[1]],
    },
    phase: 'serve_ready',
    phaseTimer: 0,
    players: [p0, p1],
    ball: {
      pos: { x: serverPos.x, y: 1.05, z: serverPos.z - 0.35 },
      vel: { x: 0, y: 0, z: 0 },
      spin: { x: 0, y: 0, z: 0 },
      active: false,
      bounces: 0,
      touchedNet: false,
      hitTick: 0,
      firstBouncePos: null,
      firstBounceInBounds: null,
      lastHitter: null,
      lastShotType: null,
      lastShotQuality: null,
      speedKmhDisplay: 0,
      predictedLanding: null,
    },
    score,
    stats: [createEmptyStats(), createEmptyStats()],
    hawkeye: {
      active: false,
      elapsedSec: 0,
      durationSec: COURT_DIM.HAWKEYE_DURATION_SEC,
      bouncePos: { x: 0, y: COURT_DIM.BALL_RADIUS, z: 0 },
      isIn: true,
      distanceToLineCm: 0,
      lineType: 'sideline',
    },
    pause: {
      reason: 'none',
      initiatedBy: null,
      pausedFromPhase: null,
      remainingSec: 0,
      resumeCountdownSec: 0,
      manualPausesLeft: [COURT_DIM.MANUAL_PAUSE_MAX_COUNT, COURT_DIM.MANUAL_PAUSE_MAX_COUNT],
      disconnected: [false, false],
      disconnectRemainingSec: [COURT_DIM.DISCONNECT_GRACE_SEC, COURT_DIM.DISCONNECT_GRACE_SEC],
    },
    lastAckSeq: [0, 0],
  };

  return state;
}

function addTakeoverEnergy(
  player: PlayerState,
  delta: number,
  events: GameEvent[]
): void {
  if (delta > 0) {
    // Do not accumulate while active or during 1-point cooldown
    if (player.takeoverPointsLeft > 0 || player.takeoverCooldown) {
      return;
    }
    player.takeoverEnergy = clamp(player.takeoverEnergy + delta, 0, PHYSICS_CONSTANTS.TAKEOVER_MAX_ENERGY);
    if (player.takeoverEnergy >= PHYSICS_CONSTANTS.TAKEOVER_MAX_ENERGY) {
      player.takeoverPointsLeft = PHYSICS_CONSTANTS.TAKEOVER_DURATION_POINTS;
      events.push({ type: 'TAKEOVER_ON', player: player.index });
    }
  } else if (delta < 0) {
    if (player.takeoverPointsLeft > 0 || player.takeoverCooldown) {
      return;
    }
    player.takeoverEnergy = clamp(player.takeoverEnergy + delta, 0, PHYSICS_CONSTANTS.TAKEOVER_MAX_ENERGY);
  }
}

function advanceTakeoverOnPointEnd(state: MatchState, events: GameEvent[]): void {
  for (const idx of [0, 1] as const) {
    const p = state.players[idx];
    if (p.takeoverPointsLeft > 0) {
      p.takeoverPointsLeft -= 1;
      if (p.takeoverPointsLeft === 0) {
        p.takeoverEnergy = 0;
        p.takeoverCooldown = true;
        events.push({ type: 'TAKEOVER_OFF', player: idx });
      }
    } else if (p.takeoverCooldown) {
      p.takeoverCooldown = false;
    }
  }
}

function updatePlayerMovement(
  state: MatchState,
  idx: PlayerIndex,
  input: PlayerInputFrame,
  dt: number
): void {
  const player = state.players[idx];
  const arch = ARCHETYPES[player.archetype];
  const court = COURTS[state.config.court];

  player.animTime += dt;

  // Serve toss locks server movement
  if (state.phase === 'serve_toss' && state.score.server === idx) {
    player.vel = { x: 0, y: 0, z: 0 };
    player.anim = 'serve_toss';
    return;
  }

  // Handle active slide timer
  if (player.isSliding) {
    player.slideTimer -= dt;
    if (player.slideTimer <= 0) {
      player.isSliding = false;
      player.slideTimer = 0;
    } else {
      player.pos.x += player.vel.x * dt;
      player.pos.z += player.vel.z * dt;
      player.vel.x *= Math.pow(0.25, dt);
      player.vel.z *= Math.pow(0.25, dt);
      clampPlayerPosition(player, state);
      player.anim = 'slide';
      return;
    }
  }

  let mx = clamp(input.moveX, -1, 1);
  let mz = state.phase === 'serve_ready' && state.score.server === idx ? 0 : clamp(input.moveZ, -1, 1);
  const mag = Math.hypot(mx, mz);

  if (mag < 0.05) {
    player.moveAccelTime = 0;
    const decay = Math.pow(court.playerFriction < 0.85 ? 0.008 : 0.0005, dt);
    player.vel.x *= decay;
    player.vel.z *= decay;
    if (Math.hypot(player.vel.x, player.vel.z) < 0.15) {
      player.vel.x = 0;
      player.vel.z = 0;
      if (!player.meter.active) {
        player.anim = 'idle';
      }
    }
  } else {
    // Allow fractional speed (e.g. AI speedScale <= 1) without inflating > 1
    const norm = mag > 1 ? 1 / mag : 1;
    mx *= norm;
    mz *= norm;

    const isTakeover = player.takeoverPointsLeft > 0;
    const accelBoost = isTakeover ? PHYSICS_CONSTANTS.TAKEOVER_ACCEL_BOOST : 1.0;
    player.moveAccelTime = Math.min(
      PHYSICS_CONSTANTS.PLAYER_ACCEL_TIME_SEC,
      player.moveAccelTime + dt * accelBoost
    );
    const ramp = 0.35 + 0.65 * (player.moveAccelTime / PHYSICS_CONSTANTS.PLAYER_ACCEL_TIME_SEC);
    const maxSpeed = computePlayerMaxSpeed(arch.speed);
    const targetVx = mx * maxSpeed * ramp;
    const targetVz = mz * maxSpeed * ramp;

    const blend = Math.min(1, dt * (10 + 8 * court.playerFriction));
    player.vel.x += (targetVx - player.vel.x) * blend;
    player.vel.z += (targetVz - player.vel.z) * blend;
    player.anim = 'run';

    // Check extreme-reach auto slide trigger during rally
    if (state.phase === 'rally' && state.ball.active && state.ball.lastHitter !== idx) {
      const landing = state.ball.predictedLanding;
      if (landing && landing.z * player.side > 0) {
        const distToLanding = Math.hypot(landing.x - player.pos.x, landing.z - player.pos.z);
        const speedHoriz = Math.hypot(state.ball.vel.x, state.ball.vel.z);
        const distBall = Math.hypot(state.ball.pos.x - player.pos.x, state.ball.pos.z - player.pos.z);
        const eta = speedHoriz > 1 ? distBall / speedHoriz : 99;
        const movingTowardLanding =
          (landing.x - player.pos.x) * mx + (landing.z - player.pos.z) * mz > 0.25;

        if (
          eta < PHYSICS_CONSTANTS.SLIDE_TRIGGER_TIME_SEC &&
          distToLanding >= PHYSICS_CONSTANTS.SLIDE_TRIGGER_MIN_DIST_M &&
          distToLanding <= PHYSICS_CONSTANTS.SLIDE_TRIGGER_MAX_DIST_M &&
          movingTowardLanding
        ) {
          player.isSliding = true;
          player.slideTimer = court.slideDurationSec;
          player.anim = 'slide';
          const dirLen = Math.max(0.01, distToLanding);
          player.vel.x = ((landing.x - player.pos.x) / dirLen) * maxSpeed * 1.15;
          player.vel.z = ((landing.z - player.pos.z) / dirLen) * maxSpeed * 1.15;
        }
      }
    }
  }

  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  clampPlayerPosition(player, state);
}

function clampPlayerPosition(player: PlayerState, state: MatchState): void {
  if (state.phase === 'serve_ready' && state.score.server === player.index) {
    const sideSign = state.score.courtSide === 'deuce' ? 1 : -1;
    const minBound = player.side * sideSign > 0 ? 0.25 : -COURT_DIM.SINGLES_HALF_WIDTH;
    const maxBound = player.side * sideSign > 0 ? COURT_DIM.SINGLES_HALF_WIDTH : -0.25;
    player.pos.x = clamp(player.pos.x, minBound, maxBound);
    player.pos.z = player.side * (COURT_DIM.HALF_LENGTH + 0.55);
    return;
  }

  player.pos.x = clamp(player.pos.x, -COURT_DIM.RUN_LIMIT_X, COURT_DIM.RUN_LIMIT_X);
  if (player.side === 1) {
    player.pos.z = clamp(player.pos.z, COURT_DIM.RUN_LIMIT_Z_MIN, COURT_DIM.RUN_LIMIT_Z_MAX);
  } else {
    player.pos.z = clamp(player.pos.z, -COURT_DIM.RUN_LIMIT_Z_MAX, -COURT_DIM.RUN_LIMIT_Z_MIN);
  }
}

function executeServeLaunch(
  state: MatchState,
  serverIdx: PlayerIndex,
  shotType: 'serve_flat' | 'serve_kick',
  quality: ShotQuality,
  input: PlayerInputFrame,
  rng: PRNG,
  events: GameEvent[]
): void {
  const srv = state.players[serverIdx];
  const arch = ARCHETYPES[srv.archetype];
  const targetSide = (-srv.side) as PlayerSide;
  const courtSide = state.score.courtSide;

  // Stats updates
  state.stats[serverIdx].totalMeterShots += 1;
  if (quality === 'PERFECT') {
    state.stats[serverIdx].perfectShots += 1;
    addTakeoverEnergy(srv, 34, events);
  } else if (quality === 'GOOD') {
    addTakeoverEnergy(srv, 10, events);
  }
  if (state.score.serveNumber === 1) {
    state.stats[serverIdx].firstServesTotal += 1;
  }

  // Target service box center & aim offset
  // targetSide === -1 (P0 serving): deuce -> x in [-4.115, 0], ad -> [0, 4.115]
  // targetSide === +1 (P1 serving): deuce -> x in [0, 4.115], ad -> [-4.115, 0]
  const expectedSignX = targetSide * (courtSide === 'deuce' ? 1 : -1);
  const boxCenterX = expectedSignX * 2.05;
  const aimOffsetX = clamp(input.aimX, -1, 1) * 1.45;
  let targetX = clamp(boxCenterX + aimOffsetX, -COURT_DIM.SINGLES_HALF_WIDTH + 0.14, COURT_DIM.SINGLES_HALF_WIDTH - 0.14);
  if (expectedSignX > 0) {
    targetX = clamp(boxCenterX + aimOffsetX, 0.14, COURT_DIM.SINGLES_HALF_WIDTH - 0.14);
  } else {
    targetX = clamp(boxCenterX + aimOffsetX, -COURT_DIM.SINGLES_HALF_WIDTH + 0.14, -0.14);
  }

  const baseDepth = shotType === 'serve_flat' ? 5.65 : 5.15;
  let targetZ = targetSide * (baseDepth - clamp(-input.aimZ * srv.side, -1, 1) * 0.45);

  const powMult = computePowerMultiplier(arch.power);
  const spinMult = computeSpinMultiplier(arch.spin);
  const baseSpeed = shotType === 'serve_flat' ? 37.5 : 27.5;
  let speedMult = 1.0;

  if (quality === 'PERFECT') {
    speedMult = 1.16;
    // Tight accurate placement
    targetX += rng.range(-0.04, 0.04);
    targetZ += rng.range(-0.04, 0.04);
  } else if (quality === 'GOOD') {
    speedMult = 1.0;
    targetX += rng.range(-0.32, 0.32);
    targetZ += rng.range(-0.32, 0.32);
  } else if (quality === 'EARLY' || quality === 'LATE') {
    speedMult = 0.78;
    targetX += rng.range(-0.85, 0.85);
    targetZ += targetSide * (quality === 'EARLY' ? -0.85 : 0.95);
  } else {
    // VERY_EARLY / VERY_LATE: Red zone
    speedMult = 0.62;
    if (shotType === 'serve_flat') {
      // 1st serve red zone is 100% fault (long or into net)
      if (quality === 'VERY_EARLY') {
        targetX += expectedSignX * 1.65;
        targetZ = targetSide * (COURT_DIM.SERVICE_LINE_Z + 0.95);
      } else {
        // VERY_LATE: hits net or deep fault
        targetZ = targetSide * (COURT_DIM.SERVICE_LINE_Z + 1.15);
      }
    } else {
      targetX += rng.range(-1.45, 1.45);
      targetZ += targetSide * rng.range(-1.1, 1.35);
    }
  }

  const desiredSpeedXZ = baseSpeed * powMult * speedMult;
  const origin: Vec3 = { x: srv.pos.x, y: 2.78, z: srv.pos.z - srv.side * 0.25 };
  const target: Vec3 = { x: targetX, y: COURT_DIM.BALL_RADIUS, z: targetZ };

  const topspinMag = (shotType === 'serve_flat' ? 18 : 65) * spinMult;
  const spin = makeTopspinVec(target.x - origin.x, target.z - origin.z, topspinMag);

  const solved = solveBallisticShot({
    origin,
    target,
    desiredSpeedXZ,
    spin,
    minNetClearanceM: shotType === 'serve_flat' ? 0.05 : 0.34,
  });

  // Ensure 1st serve red-zone is 100% fault (net or long/wide)
  if (shotType === 'serve_flat' && quality === 'VERY_EARLY') {
    // Pull clearly wide outside service box
    const wideTarget: Vec3 = {
      x: expectedSignX * (COURT_DIM.SINGLES_HALF_WIDTH + 0.75),
      y: COURT_DIM.BALL_RADIUS,
      z: targetSide * 5.8,
    };
    const wideSolved = solveBallisticShot({
      origin,
      target: wideTarget,
      desiredSpeedXZ,
      spin,
      minNetClearanceM: 0.05,
    });
    solved.vel = wideSolved.vel;
    solved.predictedLanding = wideSolved.predictedLanding;
  } else if (shotType === 'serve_flat' && quality === 'VERY_LATE') {
    // Either long past service line (already solved with +1.15m) or into the net
    // Keep solved trajectory landing deep past SERVICE_LINE_Z (6.40m)
  }

  state.ball.pos = origin;
  state.ball.vel = solved.vel;
  state.ball.spin = spin;
  state.ball.active = true;
  state.ball.bounces = 0;
  state.ball.touchedNet = false;
  state.ball.hitTick = state.tick;
  state.ball.firstBouncePos = null;
  state.ball.firstBounceInBounds = null;
  state.ball.lastHitter = serverIdx;
  state.ball.lastShotType = shotType;
  state.ball.lastShotQuality = quality;
  state.ball.predictedLanding = cloneVec3(solved.predictedLanding);

  const physSpeed = Math.hypot(solved.vel.x, solved.vel.y, solved.vel.z);
  const displayScale = shotType === 'serve_flat' ? 4.8 : 5.05;
  state.ball.speedKmhDisplay = Math.round(clamp(physSpeed * displayScale, 95, 222));

  srv.anim = 'forehand';
  srv.animTime = 0;
  srv.meter.active = false;
  srv.meter.lastQuality = quality;
  state.phase = 'rally';
  state.phaseTimer = 0;

  events.push({
    type: 'SHOT_HIT',
    hitter: serverIdx,
    shotType,
    quality,
    speedKmh: state.ball.speedKmhDisplay,
    pos: cloneVec3(origin),
  });
}

function executeRallyShot(
  state: MatchState,
  hitterIdx: PlayerIndex,
  shotType: 'topspin' | 'slice' | 'dropshot' | 'lob',
  quality: ShotQuality,
  input: PlayerInputFrame,
  rng: PRNG,
  events: GameEvent[]
): void {
  const hitter = state.players[hitterIdx];
  const arch = ARCHETYPES[hitter.archetype];
  const targetSide = (-hitter.side) as PlayerSide;
  const forwardAimZ = -clamp(input.aimZ, -1, 1) * hitter.side; // +1 = deeper toward opponent baseline, -1 = shallower

  state.stats[hitterIdx].totalMeterShots += 1;
  if (quality === 'PERFECT') {
    state.stats[hitterIdx].perfectShots += 1;
    addTakeoverEnergy(hitter, 34, events);
  } else if (quality === 'GOOD') {
    addTakeoverEnergy(hitter, 10, events);
  }

  const maxAimX = COURT_DIM.SINGLES_HALF_WIDTH - 0.12;
  let targetX = clamp(input.aimX, -1, 1) * maxAimX;
  let targetZ = 0;
  let baseSpeed = 27.5;
  let topspinMag = 52;
  let minNetClear = 0.22;
  let peakHeightMinM: number | undefined;

  if (shotType === 'dropshot') {
    // Target opponent front court Z in [1.8, 3.6] m
    const netAcc = computeNetAccuracyMultiplier(arch.net);
    const depth = clamp(2.65 - forwardAimZ * 0.45 / netAcc, 1.95, 3.4);
    targetZ = targetSide * depth;
    targetX = clamp(input.aimX, -1, 1) * (COURT_DIM.SINGLES_HALF_WIDTH - 0.35);
    baseSpeed = 14.5;
    topspinMag = -36;
    minNetClear = 0.16;
  } else if (shotType === 'lob') {
    targetZ = targetSide * 9.8;
    targetX = clamp(input.aimX, -1, 1) * (COURT_DIM.SINGLES_HALF_WIDTH - 0.55);
    baseSpeed = 19.5;
    topspinMag = 24;
    minNetClear = 1.6;
    peakHeightMinM = 5.65;
  } else if (shotType === 'slice') {
    targetZ = targetSide * clamp(8.6 + forwardAimZ * 2.0, 6.2, 11.1);
    baseSpeed = 18.0;
    topspinMag = -48;
    minNetClear = 0.2;
  } else {
    // topspin
    targetZ = targetSide * clamp(9.5 + forwardAimZ * 1.9, 6.8, 11.45);
    baseSpeed = 27.2;
    topspinMag = 56;
    minNetClear = 0.22;
  }

  let speedMult = 1.0;
  if (quality === 'PERFECT') {
    speedMult = 1.16;
    // Zero error beyond tiny 2cm jitter, guaranteeing <= 0.15m precision
    targetX += rng.range(-0.02, 0.02);
    targetZ += rng.range(-0.02, 0.02);
  } else if (quality === 'GOOD') {
    speedMult = 1.0;
    targetX += rng.range(-0.35, 0.35);
    targetZ += rng.range(-0.35, 0.35);
  } else if (quality === 'EARLY' || quality === 'LATE') {
    speedMult = 0.78;
    const nearSideline = Math.abs(targetX) > COURT_DIM.SINGLES_HALF_WIDTH - 0.38;
    if (nearSideline && rng.next() < 0.2) {
      // 20% chance of slight wide miss when aiming near sideline
      targetX = Math.sign(targetX || 1) * (COURT_DIM.SINGLES_HALF_WIDTH + rng.range(0.06, 0.28));
    } else {
      targetX += rng.range(-0.95, 0.95);
    }
    // Shallower depth on early/late
    targetZ = targetSide * Math.max(2.2, Math.abs(targetZ) - rng.range(0.5, 1.35));
  } else {
    // VERY_EARLY / VERY_LATE
    speedMult = 0.62;
    if (quality === 'VERY_EARLY') {
      const pullSign = targetX !== 0 ? Math.sign(targetX) : rng.next() < 0.5 ? -1 : 1;
      targetX = pullSign * (COURT_DIM.SINGLES_HALF_WIDTH + rng.range(0.45, 1.4));
      targetZ += rng.range(-1.2, 1.2);
    } else {
      // VERY_LATE: either long past baseline or low into net
      targetX += rng.range(-1.2, 1.2);
      targetZ = targetSide * (COURT_DIM.HALF_LENGTH + rng.range(0.55, 1.8));
    }
  }

  const powMult = computePowerMultiplier(arch.power);
  const spinMult = computeSpinMultiplier(arch.spin);
  const desiredSpeedXZ = baseSpeed * powMult * speedMult;
  const origin: Vec3 = {
    x: state.ball.pos.x,
    y: clamp(state.ball.pos.y, 0.55, 2.6),
    z: state.ball.pos.z,
  };
  const target: Vec3 = { x: targetX, y: COURT_DIM.BALL_RADIUS, z: targetZ };
  const spin = makeTopspinVec(target.x - origin.x, target.z - origin.z, topspinMag * spinMult);

  const solved = solveBallisticShot({
    origin,
    target,
    desiredSpeedXZ,
    spin,
    minNetClearanceM: minNetClear,
    peakHeightMinM,
  });

  if (quality === 'VERY_LATE' && rng.next() < 0.45) {
    // Occasional net error on VERY_LATE
    solved.vel.y -= 2.2;
  }

  state.ball.pos = origin;
  state.ball.vel = solved.vel;
  state.ball.spin = spin;
  state.ball.active = true;
  state.ball.bounces = 0;
  state.ball.touchedNet = false;
  state.ball.hitTick = state.tick;
  state.ball.firstBouncePos = null;
  state.ball.firstBounceInBounds = null;
  state.ball.lastHitter = hitterIdx;
  state.ball.lastShotType = shotType;
  state.ball.lastShotQuality = quality;
  state.ball.predictedLanding = cloneVec3(solved.predictedLanding);

  const physSpeed = Math.hypot(solved.vel.x, solved.vel.y, solved.vel.z);
  state.ball.speedKmhDisplay = Math.round(clamp(physSpeed * 4.85, 65, 185));

  hitter.anim = shotType === 'lob' ? 'lob' : targetX * hitter.side >= 0 ? 'forehand' : 'backhand';
  hitter.animTime = 0;
  hitter.meter.active = false;
  hitter.meter.lastQuality = quality;

  events.push({
    type: 'SHOT_HIT',
    hitter: hitterIdx,
    shotType,
    quality,
    speedKmh: state.ball.speedKmhDisplay,
    pos: cloneVec3(origin),
  });
}

function finalizePoint(
  state: MatchState,
  winner: PlayerIndex,
  reason: 'ace' | 'winner' | 'unforced_error' | 'double_fault' | 'out' | 'net' | 'double_bounce',
  hawkeyeCandidate: {
    bouncePos: Vec3;
    isIn: boolean;
    distanceToLineCm: number;
    lineType: HawkeyeState['lineType'];
  } | null,
  events: GameEvent[]
): void {
  const loser = (1 - winner) as PlayerIndex;

  // Update stats
  if (reason === 'ace') {
    state.stats[winner].aces += 1;
    state.stats[winner].winners += 1;
  } else if (reason === 'winner' || reason === 'double_bounce') {
    state.stats[winner].winners += 1;
  } else if (reason === 'double_fault') {
    state.stats[loser].doubleFaults += 1;
  } else if (reason === 'unforced_error' || reason === 'out' || reason === 'net') {
    state.stats[loser].unforcedErrors += 1;
  }

  // Advance existing Takeover counters BEFORE awarding new end-of-point Takeover energy
  advanceTakeoverOnPointEnd(state, events);

  // Takeover energy adjustments
  if (reason === 'ace' || reason === 'winner' || reason === 'double_bounce') {
    addTakeoverEnergy(state.players[winner], 25, events);
  } else if (reason === 'double_fault') {
    addTakeoverEnergy(state.players[loser], -30, events);
  } else if (reason === 'unforced_error' || reason === 'out' || reason === 'net') {
    addTakeoverEnergy(state.players[loser], -25, events);
  }

  state.score = awardPointToScore(state.score, winner);
  state.ball.active = false;
  state.players[winner].anim = 'celebrate';
  state.players[winner].animTime = 0;

  events.push({
    type: 'POINT_SCORED',
    winner,
    reason,
    score: {
      ...state.score,
      games: [state.score.games[0], state.score.games[1]],
      points: [state.score.points[0], state.score.points[1]],
    },
  });

  // Trigger Hawkeye if close to line (<= 15 cm)
  if (hawkeyeCandidate && hawkeyeCandidate.distanceToLineCm <= COURT_DIM.HAWKEYE_THRESHOLD_M * 100) {
    state.hawkeye = {
      active: true,
      elapsedSec: 0,
      durationSec: COURT_DIM.HAWKEYE_DURATION_SEC,
      bouncePos: cloneVec3(hawkeyeCandidate.bouncePos),
      isIn: hawkeyeCandidate.isIn,
      distanceToLineCm: hawkeyeCandidate.distanceToLineCm,
      lineType: hawkeyeCandidate.lineType,
    };
    state.phase = 'hawkeye';
    state.phaseTimer = 0;
    events.push({
      type: 'HAWKEYE_START',
      hawkeye: {
        ...state.hawkeye,
        bouncePos: cloneVec3(state.hawkeye.bouncePos),
      },
    });
    return;
  }

  state.phase = 'point_over';
  state.phaseTimer = PHYSICS_CONSTANTS.POINT_OVER_DURATION_SEC;
}

function handleServeFault(state: MatchState, serverIdx: PlayerIndex, events: GameEvent[]): void {
  if (state.score.serveNumber === 1) {
    state.score.serveNumber = 2;
    resetPlayersForServe(state);
    return;
  }
  const receiverIdx = (1 - serverIdx) as PlayerIndex;
  finalizePoint(state, receiverIdx, 'double_fault', null, events);
}

/**
 * Pure single-step match simulation advancing physics, rules, AI/player inputs, and pause/hawkeye timers.
 */
export function stepMatch(
  state: MatchState,
  inputs: [PlayerInputFrame, PlayerInputFrame],
  dt: number,
  rng: PRNG
): { state: MatchState; events: GameEvent[] } {
  const next = cloneMatchState(state);
  const events: GameEvent[] = [];
  next.tick += 1;

  if (next.phase === 'waiting' || next.phase === 'match_over') {
    return { state: next, events };
  }

  // Manual pause timer (online mode only; single-player exempt)
  if (next.phase === 'paused_manual') {
    if (next.config.mode === 'online') {
      next.pause.remainingSec = Math.max(0, next.pause.remainingSec - dt);
      if (next.pause.remainingSec <= 0) {
        next.phase = 'resuming';
        next.pause.resumeCountdownSec = COURT_DIM.RESUME_COUNTDOWN_SEC;
        events.push({
          type: 'PAUSE_TIMEOUT_RESUMING',
          resumeCountdownSec: COURT_DIM.RESUME_COUNTDOWN_SEC,
        });
      }
    }
    return { state: next, events };
  }

  // Disconnect grace timers (independent per player)
  if (next.phase === 'paused_disconnect') {
    let minRem: number = COURT_DIM.DISCONNECT_GRACE_SEC;
    let forfeitedBy: PlayerIndex | null = null;
    for (const idx of [0, 1] as const) {
      if (next.pause.disconnected[idx]) {
        next.pause.disconnectRemainingSec[idx] = Math.max(
          0,
          next.pause.disconnectRemainingSec[idx] - dt
        );
        if (next.pause.disconnectRemainingSec[idx] < minRem) {
          minRem = next.pause.disconnectRemainingSec[idx];
        }
        if (next.pause.disconnectRemainingSec[idx] <= 0 && forfeitedBy === null) {
          forfeitedBy = idx;
        }
      }
    }
    next.pause.remainingSec = minRem;

    if (forfeitedBy !== null) {
      const winner = (1 - forfeitedBy) as PlayerIndex;
      next.phase = 'match_over';
      next.score.winner = winner;
      events.push({
        type: 'MATCH_OVER',
        winner,
        reason: 'forfeit',
        forfeitedBy,
        score: {
          ...next.score,
          games: [next.score.games[0], next.score.games[1]],
          points: [next.score.points[0], next.score.points[1]],
        },
        stats: [{ ...next.stats[0] }, { ...next.stats[1] }],
      });
    }
    return { state: next, events };
  }

  // 3-second resume countdown
  if (next.phase === 'resuming') {
    next.pause.resumeCountdownSec = Math.max(0, next.pause.resumeCountdownSec - dt);
    if (next.pause.resumeCountdownSec <= 0) {
      next.phase = next.pause.pausedFromPhase ?? 'serve_ready';
      next.pause.reason = 'none';
      next.pause.initiatedBy = null;
      next.pause.pausedFromPhase = null;
      next.pause.remainingSec = 0;
      next.pause.resumeCountdownSec = 0;
      events.push({ type: 'PAUSE_RESUMED', serverTick: next.tick });
    }
    return { state: next, events };
  }

  // Hawkeye close-up timer
  if (next.phase === 'hawkeye') {
    next.hawkeye.elapsedSec += dt;
    if (next.hawkeye.elapsedSec >= next.hawkeye.durationSec) {
      next.hawkeye.active = false;
      events.push({ type: 'HAWKEYE_END', isIn: next.hawkeye.isIn });

      if (next.score.winner !== null) {
        next.phase = 'match_over';
        events.push({
          type: 'MATCH_OVER',
          winner: next.score.winner,
          reason: 'normal',
          score: {
            ...next.score,
            games: [next.score.games[0], next.score.games[1]],
            points: [next.score.points[0], next.score.points[1]],
          },
          stats: [{ ...next.stats[0] }, { ...next.stats[1] }],
        });
      } else {
        resetPlayersForServe(next);
        if (next.pause.disconnected[0] || next.pause.disconnected[1]) {
          next.pause.pausedFromPhase = 'serve_ready';
          next.phase = 'paused_disconnect';
          next.pause.reason = 'disconnect';
        }
      }
    }
    return { state: next, events };
  }

  // Point over pause before next serve or match end
  if (next.phase === 'point_over') {
    next.phaseTimer -= dt;
    if (next.phaseTimer <= 0) {
      if (next.score.winner !== null) {
        next.phase = 'match_over';
        events.push({
          type: 'MATCH_OVER',
          winner: next.score.winner,
          reason: 'normal',
          score: {
            ...next.score,
            games: [next.score.games[0], next.score.games[1]],
            points: [next.score.points[0], next.score.points[1]],
          },
          stats: [{ ...next.stats[0] }, { ...next.stats[1] }],
        });
      } else {
        resetPlayersForServe(next);
        if (next.pause.disconnected[0] || next.pause.disconnected[1]) {
          next.pause.pausedFromPhase = 'serve_ready';
          next.phase = 'paused_disconnect';
          next.pause.reason = 'disconnect';
        }
      }
    }
    return { state: next, events };
  }

  // Update player positions
  updatePlayerMovement(next, 0, inputs[0], dt);
  updatePlayerMovement(next, 1, inputs[1], dt);

  // Serve ready phase
  if (next.phase === 'serve_ready') {
    next.phaseTimer += dt;
    const srvIdx = next.score.server;
    const srv = next.players[srvIdx];
    const srvInput = inputs[srvIdx];

    // Keep ball positioned with server
    next.ball.pos = { x: srv.pos.x, y: 1.05, z: srv.pos.z - srv.side * 0.35 };

    // L (Lob) is silently ignored during serve_ready
    if (srvInput.phase === 'hold' && (srvInput.action === 'J' || srvInput.action === 'K')) {
      const shotType: ShotType = srvInput.action === 'J' ? 'serve_flat' : 'serve_kick';
      const arch = ARCHETYPES[srv.archetype];
      const { effectiveHalfWidth } = computeShotQuality(PHYSICS_CONSTANTS.METER_SWEET_CENTER, arch, {
        shotType,
        isTakeover: srv.takeoverPointsLeft > 0,
        isSliding: false,
      });
      srv.meter.active = true;
      srv.meter.action = srvInput.action;
      srv.meter.progress = 0;
      srv.meter.effectiveHalfWidth = effectiveHalfWidth;
      srv.anim = 'serve_toss';
      srv.animTime = 0;
      next.phase = 'serve_toss';
      next.phaseTimer = 0;
    }

    return { state: next, events };
  }

  // Serve toss phase
  if (next.phase === 'serve_toss') {
    next.phaseTimer += dt;
    const srvIdx = next.score.server;
    const srv = next.players[srvIdx];
    const srvInput = inputs[srvIdx];

    // Animate ball toss arc
    const tossT = Math.min(1, next.phaseTimer / 0.85);
    next.ball.pos = {
      x: srv.pos.x,
      y: 1.05 + Math.sin(tossT * Math.PI) * 1.65,
      z: srv.pos.z - srv.side * 0.28,
    };

    srv.meter.progress += PHYSICS_CONSTANTS.METER_PROGRESS_RATE * dt;
    const shotType: 'serve_flat' | 'serve_kick' =
      srv.meter.action === 'J' ? 'serve_flat' : 'serve_kick';
    const arch = ARCHETYPES[srv.archetype];
    const evalRes = computeShotQuality(srv.meter.progress, arch, {
      shotType,
      isTakeover: srv.takeoverPointsLeft > 0,
      isSliding: false,
    });
    srv.meter.effectiveHalfWidth = evalRes.effectiveHalfWidth;

    if (srvInput.phase === 'release' || srv.meter.progress >= PHYSICS_CONSTANTS.METER_MAX_PROGRESS) {
      executeServeLaunch(next, srvIdx, shotType, evalRes.quality, srvInput, rng, events);
    }

    return { state: next, events };
  }

  // Rally phase: check swing meters first
  for (const idx of [0, 1] as const) {
    const p = next.players[idx];
    const inp = inputs[idx];
    const arch = ARCHETYPES[p.archetype];

    if (!p.meter.active && inp.phase === 'hold' && inp.action !== 'none' && next.ball.lastHitter !== idx) {
      const fwd = -clamp(inp.aimZ, -1, 1) * p.side;
      const previewType: ShotType =
        inp.action === 'L' ? 'lob' : inp.action === 'K' ? (fwd >= 0.5 ? 'dropshot' : 'slice') : 'topspin';
      const { effectiveHalfWidth } = computeShotQuality(PHYSICS_CONSTANTS.METER_SWEET_CENTER, arch, {
        shotType: previewType,
        isTakeover: p.takeoverPointsLeft > 0,
        isSliding: p.isSliding,
      });
      p.meter.active = true;
      p.meter.action = inp.action;
      p.meter.progress = 0;
      p.meter.effectiveHalfWidth = effectiveHalfWidth;
    } else if (p.meter.active) {
      p.meter.progress += PHYSICS_CONSTANTS.METER_PROGRESS_RATE * dt;
      const fwd = -clamp(inp.aimZ, -1, 1) * p.side;
      const shotType: 'topspin' | 'slice' | 'dropshot' | 'lob' =
        p.meter.action === 'L'
          ? 'lob'
          : p.meter.action === 'K'
            ? fwd >= 0.5
              ? 'dropshot'
              : 'slice'
            : 'topspin';
      const evalRes = computeShotQuality(p.meter.progress, arch, {
        shotType,
        isTakeover: p.takeoverPointsLeft > 0,
        isSliding: p.isSliding,
      });
      p.meter.effectiveHalfWidth = evalRes.effectiveHalfWidth;

      const released =
        inp.phase === 'release' || p.meter.progress >= PHYSICS_CONSTANTS.METER_MAX_PROGRESS;
      if (released) {
        const reachRadius = p.isSliding
          ? PHYSICS_CONSTANTS.SLIDE_REACH_RADIUS_M
          : PHYSICS_CONSTANTS.BASE_REACH_RADIUS_M;
        const distXZ = Math.hypot(next.ball.pos.x - p.pos.x, next.ball.pos.z - p.pos.z);
        const canHit =
          next.ball.active &&
          next.ball.lastHitter !== idx &&
          next.ball.bounces <= 1 &&
          distXZ <= reachRadius &&
          next.ball.pos.y <= 3.35 &&
          next.ball.pos.z * p.side > -0.5;

        if (canHit) {
          executeRallyShot(next, idx, shotType, evalRes.quality, inp, rng, events);
        } else {
          // Whiff / swung early out of range
          p.meter.active = false;
          p.meter.progress = 0;
          p.meter.lastQuality = evalRes.quality;
        }
      }
    }
  }

  // Ball physics with 2x substeps
  if (next.ball.active) {
    const court = COURTS[next.config.court];
    const subDt = dt / COURT_DIM.PHYSICS_SUBSTEPS;
    const hitter = next.ball.lastHitter ?? next.score.server;
    const targetSide = (-next.players[hitter].side) as PlayerSide;
    const isServeBall =
      next.ball.lastShotType === 'serve_flat' || next.ball.lastShotType === 'serve_kick';

    for (let s = 0; s < COURT_DIM.PHYSICS_SUBSTEPS; s++) {
      const outcome = stepBallSubstep(next.ball.pos, next.ball.vel, next.ball.spin, subDt, court);
      next.ball.pos = outcome.pos;
      next.ball.vel = outcome.vel;
      next.ball.spin = outcome.spin;

      if (outcome.netLet && outcome.netPos) {
        next.ball.touchedNet = true;
        events.push({
          type: 'NET_LET',
          isServe: isServeBall,
          pos: cloneVec3(outcome.netPos),
        });
      }

      if (outcome.hitNet) {
        if (next.ball.bounces === 0) {
          if (isServeBall) {
            handleServeFault(next, hitter, events);
          } else {
            const opp = (1 - hitter) as PlayerIndex;
            finalizePoint(next, opp, 'net', null, events);
          }
          return { state: next, events };
        }
      }

      if (outcome.bounced && outcome.bouncePos) {
        next.ball.bounces += 1;

        if (next.ball.bounces === 1) {
          const judgment = evaluateBounceBounds(
            outcome.bouncePos,
            isServeBall,
            targetSide,
            next.score.courtSide
          );
          next.ball.firstBouncePos = cloneVec3(outcome.bouncePos);
          next.ball.firstBounceInBounds = judgment.inBounds;

          events.push({
            type: 'BOUNCE',
            pos: cloneVec3(outcome.bouncePos),
            court: next.config.court,
            bounceIndex: 1,
            inBounds: judgment.inBounds,
          });

          if (isServeBall && next.ball.touchedNet && judgment.inBounds) {
            // Serve LET: replay serve without fault
            resetPlayersForServe(next);
            return { state: next, events };
          }

          if (!judgment.inBounds) {
            if (isServeBall && next.score.serveNumber === 1) {
              handleServeFault(next, hitter, events);
              return { state: next, events };
            }

            const winner = (1 - hitter) as PlayerIndex;
            const reason = isServeBall ? 'double_fault' : 'out';
            const hawkeyeCandidate =
              outcome.bouncePos.z * targetSide > 0
                ? {
                    bouncePos: outcome.bouncePos,
                    isIn: false,
                    distanceToLineCm: judgment.distanceToLineCm,
                    lineType: judgment.lineType,
                  }
                : null;
            finalizePoint(next, winner, reason, hawkeyeCandidate, events);
            return { state: next, events };
          }

          if (isServeBall && next.score.serveNumber === 1) {
            next.stats[hitter].firstServesIn += 1;
          }
        } else if (next.ball.bounces === 2) {
          events.push({
            type: 'BOUNCE',
            pos: cloneVec3(outcome.bouncePos),
            court: next.config.court,
            bounceIndex: 2,
            inBounds: true,
          });

          const firstPos = next.ball.firstBouncePos;
          let hawkeyeCandidate: {
            bouncePos: Vec3;
            isIn: boolean;
            distanceToLineCm: number;
            lineType: HawkeyeState['lineType'];
          } | null = null;
          if (firstPos) {
            const firstJudgment = evaluateBounceBounds(
              firstPos,
              isServeBall,
              targetSide,
              next.score.courtSide
            );
            hawkeyeCandidate = {
              bouncePos: firstPos,
              isIn: firstJudgment.inBounds,
              distanceToLineCm: firstJudgment.distanceToLineCm,
              lineType: firstJudgment.lineType,
            };
          }

          const reason = isServeBall ? 'ace' : 'winner';
          finalizePoint(next, hitter, reason, hawkeyeCandidate, events);
          return { state: next, events };
        }
      }
    }

    // Safety out-of-arena bounds check (e.g. sky-high out ball)
    if (
      Math.abs(next.ball.pos.z) > 22 ||
      Math.abs(next.ball.pos.x) > 14
    ) {
      if (next.ball.bounces === 0) {
        if (isServeBall) {
          handleServeFault(next, hitter, events);
        } else {
          finalizePoint(next, (1 - hitter) as PlayerIndex, 'out', null, events);
        }
      } else {
        const reason = isServeBall ? 'ace' : 'winner';
        finalizePoint(next, hitter, reason, null, events);
      }
    }
  }

  return { state: next, events };
}

/**
 * Controlled test helper: launch a real physical ball via solveBallisticShot toward target line ± distCm
 * so that stepMatch performs authentic physics and <= 15 cm Hawkeye threshold evaluation.
 */
export function launchHawkeyeTestBall(
  state: MatchState,
  opts: { inBounds: boolean; distCm: number; line?: 'sideline' | 'baseline' },
  rng: PRNG
): MatchState {
  void rng;
  const next = cloneMatchState(state);
  const hitterIdx: PlayerIndex = 0;
  const hitterSide = next.players[hitterIdx].side; // +1
  const targetSide = (-hitterSide) as PlayerSide; // -1
  const line = opts.line ?? 'sideline';

  const distM = Math.max(0, opts.distCm / 100);
  const rMark = COURT_DIM.BALL_RADIUS;
  // For out-of-bounds test calls smaller than ball radius, ensure center clears R_mark
  const outOffsetM = opts.inBounds ? -distM : Math.max(distM, rMark + 0.005);

  let targetX = 0;
  let targetZ = targetSide * 7.5;
  if (line === 'sideline') {
    targetX = COURT_DIM.SINGLES_HALF_WIDTH + outOffsetM;
    targetZ = targetSide * 7.5;
  } else {
    targetX = 1.2;
    targetZ = targetSide * (COURT_DIM.HALF_LENGTH + outOffsetM);
  }

  const origin: Vec3 = { x: 0.4, y: 1.05, z: hitterSide * 10.5 };
  const target: Vec3 = { x: targetX, y: COURT_DIM.BALL_RADIUS, z: targetZ };
  const spin = makeTopspinVec(target.x - origin.x, target.z - origin.z, 42);

  const solved = solveBallisticShot({
    origin,
    target,
    desiredSpeedXZ: 27,
    spin,
    minNetClearanceM: 0.25,
  });

  // Move receiver out of the way so the ball bounces cleanly without being returned
  const receiverIdx = (1 - hitterIdx) as PlayerIndex;
  next.players[receiverIdx].pos = { x: -4.5, y: 0, z: targetSide * 12.5 };
  next.players[receiverIdx].meter.active = false;

  next.phase = 'rally';
  next.phaseTimer = 0;
  next.ball = {
    pos: origin,
    vel: solved.vel,
    spin,
    active: true,
    bounces: 0,
    touchedNet: false,
    hitTick: next.tick,
    firstBouncePos: null,
    firstBounceInBounds: null,
    lastHitter: hitterIdx,
    lastShotType: 'topspin',
    lastShotQuality: 'PERFECT',
    speedKmhDisplay: 142,
    predictedLanding: cloneVec3(solved.predictedLanding),
  };

  return next;
}
