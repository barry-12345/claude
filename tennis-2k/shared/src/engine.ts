import { ARCHETYPES, COURT_DIM, COURTS, PHYSICS_CONSTANTS } from './constants.js';
import { cloneMatchState, cloneVec3 } from './mirror.js';
import {
  clamp,
  evaluateBounceBounds,
  makeTopspinVec,
  solveBallisticShot,
  stepBallSubstep,
} from './physics.js';
import {
  computeControlScatterM,
  computeFirstServeCornerFaultProb,
  computeNetAccuracyMultiplier,
  computePlayerMaxSpeed,
  computePositionShotQuality,
  computePowerMultiplier,
  computeSpinMultiplier,
  computeStretchSidelineErrorProb,
} from './ratings.js';
import {
  awardPointToScore,
  computeServeSetupPositions,
  createEmptyStats,
  createInitialScoreState,
} from './rules.js';
import type {
  BallState,
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
  ShotStanceState,
  ShotType,
  SpawnIncomingBallOptions,
  Vec3,
} from './types.js';

function createDefaultStance(lastQuality: ShotQuality | null = null): ShotStanceState {
  return {
    armedAction: 'none',
    holdDurationSec: 0,
    bufferRemainingSec: 0,
    lastConsumedHitTick: -1,
    lockedAimX: 0,
    lastQuality,
  };
}

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
    stance: createDefaultStance(),
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
    p.stance = createDefaultStance(p.stance.lastQuality);
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

  return {
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
      const inSwingAnim =
        (player.anim === 'forehand' || player.anim === 'backhand' || player.anim === 'lob') &&
        player.animTime < 0.34;
      if (!inSwingAnim) {
        player.anim = 'idle';
      }
    }
  } else {
    const norm = mag > 1 ? 1 / mag : 1;
    mx *= norm;
    mz *= norm;

    player.moveAccelTime = Math.min(
      PHYSICS_CONSTANTS.PLAYER_ACCEL_TIME_SEC,
      player.moveAccelTime + dt
    );
    const ramp = 0.35 + 0.65 * (player.moveAccelTime / PHYSICS_CONSTANTS.PLAYER_ACCEL_TIME_SEC);
    const maxSpeed = computePlayerMaxSpeed(arch.speed);
    const targetVx = mx * maxSpeed * ramp;
    const targetVz = mz * maxSpeed * ramp;

    const blend = Math.min(1, dt * (10 + 8 * court.playerFriction));
    player.vel.x += (targetVx - player.vel.x) * blend;
    player.vel.z += (targetVz - player.vel.z) * blend;
    player.anim = 'run';

    // Extreme-reach auto slide trigger during rally
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

function executeServeLaunch(
  state: MatchState,
  serverIdx: PlayerIndex,
  shotType: 'serve_flat' | 'serve_kick',
  lockedAimX: number,
  aimZ: number,
  rng: PRNG,
  events: GameEvent[]
): void {
  const srv = state.players[serverIdx];
  const arch = ARCHETYPES[srv.archetype];
  const targetSide = (-srv.side) as PlayerSide;
  const courtSide = state.score.courtSide;

  const expectedSignX = targetSide * (courtSide === 'deuce' ? 1 : -1);
  const boxCenterX = expectedSignX * 2.05;
  const aimOffsetX = clamp(lockedAimX, -1, 1) * 1.85;
  const minBoxX = expectedSignX > 0 ? 0.16 : -COURT_DIM.SINGLES_HALF_WIDTH + 0.16;
  const maxBoxX = expectedSignX > 0 ? COURT_DIM.SINGLES_HALF_WIDTH - 0.16 : -0.16;
  let targetX = clamp(boxCenterX + aimOffsetX, minBoxX, maxBoxX);

  const baseDepth = shotType === 'serve_flat' ? 5.75 : 5.15;
  const forwardAimZ = clamp(-aimZ * srv.side, -1, 1);
  const maxDepth =
    shotType === 'serve_kick' ? COURT_DIM.SERVICE_LINE_Z - 0.25 : COURT_DIM.SERVICE_LINE_Z - 0.20;
  const depth = clamp(baseDepth + forwardAimZ * 0.35, 3.8, maxDepth);
  let targetZ = targetSide * depth;

  let quality: ShotQuality = 'CLEAN';

  if (shotType === 'serve_flat' && Math.abs(lockedAimX) > 0.85) {
    const pFault = computeFirstServeCornerFaultProb(arch.control);
    if (rng.next() < pFault) {
      quality = 'SOLID';
      if (Math.abs(targetX) > 2.05) {
        // Miss wide past outer sideline by 0.10-0.42 m
        targetX = expectedSignX * (COURT_DIM.SINGLES_HALF_WIDTH + rng.range(0.14, 0.40));
      } else if (rng.next() < 0.5) {
        // Miss across center service line
        targetX = -expectedSignX * rng.range(0.14, 0.38);
      } else {
        // Miss long past service line
        targetZ = targetSide * (COURT_DIM.SERVICE_LINE_Z + rng.range(0.14, 0.40));
      }
    }
  }

  if (quality === 'CLEAN') {
    const cleanScatter = computeControlScatterM('CLEAN', arch.control);
    targetX = clamp(targetX + rng.range(-cleanScatter, cleanScatter), minBoxX, maxBoxX);
    targetZ =
      targetSide *
      clamp(Math.abs(targetZ) + rng.range(-cleanScatter, cleanScatter), 3.75, maxDepth);
  }

  // Stats updates
  state.stats[serverIdx].totalShots += 1;
  if (quality === 'CLEAN') {
    state.stats[serverIdx].cleanShots += 1;
  }
  if (state.score.serveNumber === 1) {
    state.stats[serverIdx].firstServesTotal += 1;
  }

  const powMult = computePowerMultiplier(arch.power);
  const spinMult = computeSpinMultiplier(arch.spin);
  const baseSpeed = shotType === 'serve_flat' ? 38.5 : 28.0;
  const desiredSpeedXZ = baseSpeed * powMult;
  const origin: Vec3 = { x: srv.pos.x, y: 2.78, z: srv.pos.z - srv.side * 0.25 };
  const target: Vec3 = { x: targetX, y: COURT_DIM.BALL_RADIUS, z: targetZ };

  const topspinMag = (shotType === 'serve_flat' ? 18 : 65) * spinMult;
  const spin = makeTopspinVec(target.x - origin.x, target.z - origin.z, topspinMag);

  const solved = solveBallisticShot({
    origin,
    target,
    desiredSpeedXZ,
    spin,
    minNetClearanceM: shotType === 'serve_flat' ? 0.08 : 0.36,
  });

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
  if (shotType === 'serve_flat') {
    state.ball.speedKmhDisplay = Math.round(clamp(physSpeed * 4.55, 182, 216));
  } else {
    state.ball.speedKmhDisplay = Math.round(clamp(physSpeed * 4.65, 140, 166));
  }

  srv.anim = 'forehand';
  srv.animTime = 0;
  srv.stance.armedAction = 'none';
  srv.stance.holdDurationSec = 0;
  srv.stance.bufferRemainingSec = 0;
  srv.stance.lastQuality = quality;
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
  const forwardAimZ = -clamp(input.aimZ, -1, 1) * hitter.side;

  state.stats[hitterIdx].totalShots += 1;
  if (quality === 'CLEAN') {
    state.stats[hitterIdx].cleanShots += 1;
  }

  const clampedAimX = clamp(input.aimX, -1, 1);
  let targetX = clampedAimX * (COURT_DIM.SINGLES_HALF_WIDTH - 0.14);
  let targetZ = 0;
  let baseSpeed = 28.0;
  let topspinMag = 58;
  let minNetClear = 0.22;
  let peakHeightMinM: number | undefined;

  if (shotType === 'dropshot') {
    const netAcc = computeNetAccuracyMultiplier(arch.net);
    const depth =
      forwardAimZ >= 0.5 ? clamp(2.40 / netAcc, 2.15, 2.65) : 2.85;
    targetZ = targetSide * depth;
    targetX = clampedAimX * (COURT_DIM.SINGLES_HALF_WIDTH - 0.32);
    baseSpeed = 14.8;
    topspinMag = -42;
    minNetClear = 0.16;
  } else if (shotType === 'lob') {
    targetZ = targetSide * 10.1;
    targetX = clampedAimX * (COURT_DIM.SINGLES_HALF_WIDTH - 0.50);
    baseSpeed = 19.6;
    topspinMag = 24;
    minNetClear = 1.6;
    peakHeightMinM = 5.60;
  } else if (shotType === 'slice') {
    targetZ = targetSide * 6.0;
    targetX = clampedAimX * (COURT_DIM.SINGLES_HALF_WIDTH - 0.20);
    baseSpeed = 18.8;
    topspinMag = -50;
    minNetClear = 0.20;
  } else {
    // topspin
    targetZ = targetSide * clamp(9.8 + forwardAimZ * 1.55, 8.2, 11.45);
    targetX = clampedAimX * (COURT_DIM.SINGLES_HALF_WIDTH - 0.14);
    baseSpeed = 28.0;
    topspinMag = 58;
    minNetClear = 0.22;
  }

  let speedMult = 1.0;
  const scatter = computeControlScatterM(quality, arch.control);

  if (quality === 'CLEAN') {
    speedMult = 1.12;
    targetX += rng.range(-scatter, scatter);
    targetZ += rng.range(-scatter, scatter);
  } else if (quality === 'SOLID') {
    speedMult = 1.0;
    targetX += rng.range(-scatter, scatter);
    targetZ += rng.range(-scatter, scatter);
    if (shotType === 'dropshot') {
      targetZ = targetSide * clamp(Math.abs(targetZ), 1.85, 3.85);
    } else {
      targetZ = targetSide * Math.max(1.8, Math.abs(targetZ));
    }
  } else {
    // STRETCH
    speedMult = 0.80;
    targetX += rng.range(-scatter, scatter);
    targetZ += rng.range(-scatter, scatter);

    if (shotType === 'dropshot') {
      // V2: dropshot does NOT apply -1.1m pull; instead +0.35m deeper and clamped [2.0, 3.8]m
      const stretchDropDepth = clamp(Math.abs(targetZ) + 0.35, 2.0, 3.8);
      targetZ = targetSide * stretchDropDepth;
    } else {
      // Mid/deep shots pull shallower by 1.1m, clamped >= 2.2m
      targetZ = targetSide * Math.max(2.2, Math.abs(targetZ) - 1.1);
    }

    if (Math.abs(clampedAimX) > 0.75) {
      const pErr = computeStretchSidelineErrorProb(arch.control);
      if (rng.next() < pErr) {
        const sign = clampedAimX >= 0 ? 1 : -1;
        targetX = sign * (COURT_DIM.SINGLES_HALF_WIDTH + rng.range(0.10, 0.32));
      } else {
        targetX = clamp(
          targetX,
          -COURT_DIM.SINGLES_HALF_WIDTH + 0.08,
          COURT_DIM.SINGLES_HALF_WIDTH - 0.08
        );
      }
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

  const horizSpeed = Math.hypot(solved.vel.x, solved.vel.z);
  state.ball.speedKmhDisplay = Math.round(clamp(horizSpeed * 4.85, 65, 185));

  hitter.anim = shotType === 'lob' ? 'lob' : targetX * hitter.side >= 0 ? 'forehand' : 'backhand';
  hitter.animTime = 0;
  hitter.stance.armedAction = 'none';
  hitter.stance.holdDurationSec = 0;
  hitter.stance.bufferRemainingSec = 0;
  hitter.stance.lastQuality = quality;

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

function enterDisconnectPauseFromPlay(state: MatchState): void {
  const discIdx: PlayerIndex = state.pause.disconnected[0] ? 0 : 1;
  state.pause.pausedFromPhase = 'serve_ready';
  state.phase = 'paused_disconnect';
  state.pause.reason = 'disconnect';
  state.pause.initiatedBy = discIdx;
  state.pause.resumeCountdownSec = 0;
  state.pause.remainingSec = Math.min(
    state.pause.disconnected[0] ? state.pause.disconnectRemainingSec[0] : COURT_DIM.DISCONNECT_GRACE_SEC,
    state.pause.disconnected[1] ? state.pause.disconnectRemainingSec[1] : COURT_DIM.DISCONNECT_GRACE_SEC
  );
}

function buildHawkeyeCandidateFromFirstBounce(
  state: MatchState,
  isServeBall: boolean,
  targetSide: PlayerSide
): {
  bouncePos: Vec3;
  isIn: boolean;
  distanceToLineCm: number;
  lineType: HawkeyeState['lineType'];
} | null {
  const firstPos = state.ball.firstBouncePos;
  if (!firstPos || firstPos.z * targetSide <= 0) {
    return null;
  }
  const firstJudgment = evaluateBounceBounds(
    firstPos,
    isServeBall,
    targetSide,
    state.score.courtSide
  );
  return {
    bouncePos: firstPos,
    isIn: firstJudgment.inBounds,
    distanceToLineCm: firstJudgment.distanceToLineCm,
    lineType: firstJudgment.lineType,
  };
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

function updatePlayerStanceBuffer(
  p: PlayerState,
  inp: PlayerInputFrame,
  ball: BallState,
  dt: number
): void {
  if (ball.lastHitter === p.index) {
    p.stance.armedAction = 'none';
    p.stance.holdDurationSec = 0;
    p.stance.bufferRemainingSec = 0;
    return;
  }

  if (ball.hitTick === p.stance.lastConsumedHitTick) {
    return;
  }

  const wasHolding = p.stance.armedAction !== 'none' && p.stance.holdDurationSec > 0;

  if (inp.action !== 'none') {
    if (inp.actionPressed || p.stance.armedAction !== inp.action) {
      p.stance.armedAction = inp.action;
      p.stance.holdDurationSec = dt;
    } else {
      p.stance.holdDurationSec += dt;
    }
    p.stance.bufferRemainingSec = 0;
    return;
  }

  // inp.action === 'none'
  if (wasHolding) {
    if (p.stance.holdDurationSec < PHYSICS_CONSTANTS.TAP_MAX_HOLD_SEC) {
      p.stance.bufferRemainingSec = PHYSICS_CONSTANTS.PRE_INPUT_BUFFER_SEC;
      p.stance.holdDurationSec = 0;
    } else {
      // Long hold (>= 0.20 s) released -> cancel immediately
      p.stance.armedAction = 'none';
      p.stance.holdDurationSec = 0;
      p.stance.bufferRemainingSec = 0;
    }
    return;
  }

  if (p.stance.armedAction !== 'none' && p.stance.bufferRemainingSec > 0) {
    p.stance.bufferRemainingSec = Math.max(0, p.stance.bufferRemainingSec - dt);
    if (p.stance.bufferRemainingSec <= 0) {
      p.stance.armedAction = 'none';
    }
    return;
  }

  p.stance.armedAction = 'none';
  p.stance.holdDurationSec = 0;
  p.stance.bufferRemainingSec = 0;
}

function predictNextPositions(
  p: PlayerState,
  ball: BallState,
  dt: number,
  courtId: MatchConfig['court']
): { nextBallPos: Vec3; nextPlayerPos: Vec3 } {
  const court = COURTS[courtId];
  const subDt = dt / COURT_DIM.PHYSICS_SUBSTEPS;
  let bPos = cloneVec3(ball.pos);
  let bVel = cloneVec3(ball.vel);
  let bSpin = cloneVec3(ball.spin);
  for (let s = 0; s < COURT_DIM.PHYSICS_SUBSTEPS; s++) {
    const out = stepBallSubstep(bPos, bVel, bSpin, subDt, court);
    bPos = out.pos;
    bVel = out.vel;
    bSpin = out.spin;
  }

  const nextX = clamp(p.pos.x + p.vel.x * dt, -COURT_DIM.RUN_LIMIT_X, COURT_DIM.RUN_LIMIT_X);
  const nextZ =
    p.side === 1
      ? clamp(p.pos.z + p.vel.z * dt, COURT_DIM.RUN_LIMIT_Z_MIN, COURT_DIM.RUN_LIMIT_Z_MAX)
      : clamp(p.pos.z + p.vel.z * dt, -COURT_DIM.RUN_LIMIT_Z_MAX, -COURT_DIM.RUN_LIMIT_Z_MIN);

  return {
    nextBallPos: bPos,
    nextPlayerPos: { x: nextX, y: p.pos.y, z: nextZ },
  };
}

/**
 * Pure single-step match simulation advancing physics, V2 auto-contact state machine, rules, and pause/hawkeye timers.
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
          enterDisconnectPauseFromPlay(next);
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
          enterDisconnectPauseFromPlay(next);
        }
      }
    }
    return { state: next, events };
  }

  // Update player positions
  updatePlayerMovement(next, 0, inputs[0], dt);
  updatePlayerMovement(next, 1, inputs[1], dt);

  // Serve ready phase: Decision 1A edge-triggered one-button serve (L silently ignored)
  if (next.phase === 'serve_ready') {
    next.phaseTimer += dt;
    const srvIdx = next.score.server;
    const srv = next.players[srvIdx];
    const srvInput = inputs[srvIdx];

    next.ball.pos = { x: srv.pos.x, y: 1.05, z: srv.pos.z - srv.side * 0.35 };

    if (srvInput.actionPressed && (srvInput.action === 'J' || srvInput.action === 'K')) {
      srv.stance.armedAction = srvInput.action;
      srv.stance.holdDurationSec = dt;
      srv.stance.bufferRemainingSec = 0;
      srv.stance.lockedAimX = clamp(srvInput.aimX, -1, 1);
      srv.anim = 'serve_toss';
      srv.animTime = 0;
      next.phase = 'serve_toss';
      next.phaseTimer = 0;
    }

    return { state: next, events };
  }

  // Serve toss phase: 0.32s auto toss, never canceled on release, update lockedAimX only if |aimX|>0.05
  if (next.phase === 'serve_toss') {
    next.phaseTimer += dt;
    const srvIdx = next.score.server;
    const srv = next.players[srvIdx];
    const srvInput = inputs[srvIdx];

    const tossT = Math.min(1, next.phaseTimer / PHYSICS_CONSTANTS.SERVE_TOSS_DURATION_SEC);
    next.ball.pos = {
      x: srv.pos.x,
      y: 1.05 + Math.sin(tossT * Math.PI) * 1.45,
      z: srv.pos.z - srv.side * 0.28,
    };

    if (Math.abs(srvInput.aimX) > 0.05) {
      srv.stance.lockedAimX = clamp(srvInput.aimX, -1, 1);
    }

    if (next.phaseTimer >= PHYSICS_CONSTANTS.SERVE_TOSS_DURATION_SEC) {
      const shotType: 'serve_flat' | 'serve_kick' =
        srv.stance.armedAction === 'K' ? 'serve_kick' : 'serve_flat';
      executeServeLaunch(
        next,
        srvIdx,
        shotType,
        srv.stance.lockedAimX,
        srvInput.aimZ,
        rng,
        events
      );
    }

    return { state: next, events };
  }

  // Rally phase: V2 pre-arming/buffer state machine + auto best-contact hit detection
  for (const idx of [0, 1] as const) {
    const p = next.players[idx];
    const inp = inputs[idx];
    updatePlayerStanceBuffer(p, inp, next.ball, dt);

    // IRON RULE: never auto-swing when armedAction === 'none'
    if (p.stance.armedAction === 'none') {
      continue;
    }

    const canCheckContact =
      next.ball.active &&
      next.ball.lastHitter !== idx &&
      next.ball.hitTick < next.tick &&
      next.ball.hitTick !== p.stance.lastConsumedHitTick &&
      next.ball.bounces <= 1 &&
      next.ball.pos.z * p.side >= -0.05 &&
      next.ball.vel.z * p.side > 0;

    if (!canCheckContact) {
      continue;
    }

    const reachRadius = p.isSliding
      ? PHYSICS_CONSTANTS.SLIDE_REACH_RADIUS_M
      : PHYSICS_CONSTANTS.BASE_REACH_RADIUS_M;
    const dNow = Math.hypot(next.ball.pos.x - p.pos.x, next.ball.pos.z - p.pos.z);

    if (dNow > reachRadius) {
      continue;
    }

    const { nextBallPos, nextPlayerPos } = predictNextPositions(
      p,
      next.ball,
      dt,
      next.config.court
    );
    const dNext = Math.hypot(nextBallPos.x - nextPlayerPos.x, nextBallPos.z - nextPlayerPos.z);

    const atNet = Math.abs(p.pos.z) < 6.0;
    let heightOk = false;
    if (atNet) {
      heightOk = next.ball.pos.y <= 2.65;
    } else if (next.ball.pos.y <= 2.35) {
      if (next.ball.bounces === 0 && next.ball.pos.y > 1.95 && dNext <= reachRadius) {
        heightOk = false;
      } else {
        heightOk = true;
      }
    }

    if (!heightOk) {
      continue;
    }

    const closestApproach = dNext >= dNow - 0.01;
    const coreSweetSpot =
      dNow <= 0.72 && next.ball.pos.y <= 1.75 && (next.ball.bounces === 1 || atNet);
    const antiMissFallback =
      dNext > reachRadius ||
      (next.ball.bounces === 1 && next.ball.pos.y <= 0.35 && next.ball.vel.y < 0);

    if (closestApproach || coreSweetSpot || antiMissFallback) {
      const fwd = -clamp(inp.aimZ, -1, 1) * p.side;
      const shotType: 'topspin' | 'slice' | 'dropshot' | 'lob' =
        p.stance.armedAction === 'L'
          ? 'lob'
          : p.stance.armedAction === 'K'
            ? fwd <= -0.5
              ? 'slice'
              : 'dropshot'
            : 'topspin';

      const arch = ARCHETYPES[p.archetype];
      const { quality } = computePositionShotQuality(dNow, arch, p.isSliding);
      p.stance.lastConsumedHitTick = next.ball.hitTick;
      executeRallyShot(next, idx, shotType, quality, inp, rng, events);
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
            // Serve LET: replay serve without fault and rollback serve shots/cleanShots/1st-serve stats
            next.stats[hitter].totalShots = Math.max(0, next.stats[hitter].totalShots - 1);
            if (next.ball.lastShotQuality === 'CLEAN') {
              next.stats[hitter].cleanShots = Math.max(0, next.stats[hitter].cleanShots - 1);
            }
            if (next.score.serveNumber === 1) {
              next.stats[hitter].firstServesTotal = Math.max(
                0,
                next.stats[hitter].firstServesTotal - 1
              );
            }
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

          const hawkeyeCandidate = buildHawkeyeCandidateFromFirstBounce(
            next,
            isServeBall,
            targetSide
          );
          const reason = isServeBall ? 'ace' : 'winner';
          finalizePoint(next, hitter, reason, hawkeyeCandidate, events);
          return { state: next, events };
        }
      }
    }

    // Safety out-of-arena bounds check
    if (Math.abs(next.ball.pos.z) > 22 || Math.abs(next.ball.pos.x) > 14) {
      if (next.ball.bounces === 0) {
        if (isServeBall) {
          handleServeFault(next, hitter, events);
        } else {
          finalizePoint(next, (1 - hitter) as PlayerIndex, 'out', null, events);
        }
      } else {
        const hawkeyeCandidate = buildHawkeyeCandidateFromFirstBounce(
          next,
          isServeBall,
          targetSide
        );
        const reason = isServeBall ? 'ace' : 'winner';
        finalizePoint(next, hitter, reason, hawkeyeCandidate, events);
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

  const receiverIdx = (1 - hitterIdx) as PlayerIndex;
  next.players[receiverIdx].pos = { x: -4.5, y: 0, z: targetSide * 12.5 };
  next.players[receiverIdx].stance = createDefaultStance();

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
    lastShotQuality: 'CLEAN',
    speedKmhDisplay: 142,
    predictedLanding: cloneVec3(solved.predictedLanding),
  };

  return next;
}

/**
 * Controlled test helper: launch an incoming topspin ball toward (targetX, targetZ) for receiver player.
 */
export function spawnIncomingTestBall(
  state: MatchState,
  opts: SpawnIncomingBallOptions,
  rng: PRNG
): MatchState {
  void rng;
  const next = cloneMatchState(state);
  const receiverIdx: PlayerIndex = opts.forPlayerIndex ?? 0;
  const senderIdx: PlayerIndex = (1 - receiverIdx) as PlayerIndex;
  const senderSide = next.players[senderIdx].side;
  const speedXZ = opts.speedXZ ?? 21;

  const origin: Vec3 = { x: 0, y: 1.05, z: senderSide * 11.0 };
  const target: Vec3 = {
    x: opts.targetX,
    y: COURT_DIM.BALL_RADIUS,
    z: opts.targetZ,
  };
  const spin = makeTopspinVec(target.x - origin.x, target.z - origin.z, 36);

  const solved = solveBallisticShot({
    origin,
    target,
    desiredSpeedXZ: speedXZ,
    spin,
    minNetClearanceM: 0.22,
  });

  // Move sender out of play and reset stances
  next.players[senderIdx].pos = { x: -5.5, y: 0, z: senderSide * 13.0 };
  next.players[senderIdx].vel = { x: 0, y: 0, z: 0 };
  next.players[senderIdx].stance = createDefaultStance();

  next.players[receiverIdx].stance = createDefaultStance();

  next.phase = 'rally';
  next.phaseTimer = 0;

  const physSpeed = Math.hypot(solved.vel.x, solved.vel.y, solved.vel.z);
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
    lastHitter: senderIdx,
    lastShotType: 'topspin',
    lastShotQuality: 'CLEAN',
    speedKmhDisplay: Math.round(clamp(physSpeed * 4.85, 65, 185)),
    predictedLanding: cloneVec3(solved.predictedLanding),
  };

  return next;
}
