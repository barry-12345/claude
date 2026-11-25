import { ARCHETYPES, COURT_DIM, PHYSICS_CONSTANTS } from './constants.js';
import { computeShotQuality } from './meter.js';
import { clamp } from './physics.js';
import { createRng } from './rng.js';
import type {
  AIDifficulty,
  MatchState,
  PlayerIndex,
  PlayerInputFrame,
  PRNG,
  ShotActionKey,
  ShotQuality,
  ShotType,
} from './types.js';

interface AIProfile {
  reactionSec: number;
  speedScale: number;
  perfectProb: number;
  goodProb: number;
  earlyLateProb: number;
  // remainder is veryEarlyLateProb
  aggression: number;
  dropshotProb: number;
  lobProb: number;
  serveVolleyProb: number;
}

const AI_PROFILES: Readonly<Record<AIDifficulty, AIProfile>> = {
  rookie: {
    reactionSec: 0.24,
    speedScale: 0.78,
    perfectProb: 0.1,
    goodProb: 0.55,
    earlyLateProb: 0.3,
    aggression: 0.25,
    dropshotProb: 0.0,
    lobProb: 0.0,
    serveVolleyProb: 0.0,
  },
  pro: {
    reactionSec: 0.14,
    speedScale: 0.92,
    perfectProb: 0.32,
    goodProb: 0.5,
    earlyLateProb: 0.16,
    aggression: 0.65,
    dropshotProb: 0.14,
    lobProb: 0.1,
    serveVolleyProb: 0.12,
  },
  legend: {
    reactionSec: 0.07,
    speedScale: 1.0,
    perfectProb: 0.58,
    goodProb: 0.35,
    earlyLateProb: 0.07,
    aggression: 0.9,
    dropshotProb: 0.18,
    lobProb: 0.22,
    serveVolleyProb: 0.32,
  },
};

function makeShotDecisionSeed(state: MatchState, playerIndex: PlayerIndex): number {
  const s = state.score;
  return (
    (state.config.seed * 73856093) ^
    (s.games[0] * 19349663) ^
    (s.games[1] * 83492791) ^
    (s.points[0] * 2654435761) ^
    (s.points[1] * 2246822519) ^
    (s.serveNumber * 3266489917) ^
    (state.ball.hitTick * 668265263) ^
    (playerIndex * 374761393)
  );
}

function pickAITargetProgress(
  state: MatchState,
  playerIndex: PlayerIndex,
  difficulty: AIDifficulty,
  shotType: ShotType
): number {
  const profile = AI_PROFILES[difficulty];
  const player = state.players[playerIndex];
  const arch = ARCHETYPES[player.archetype];
  const isTakeover = player.takeoverPointsLeft > 0;
  const { effectiveHalfWidth } = computeShotQuality(PHYSICS_CONSTANTS.METER_SWEET_CENTER, arch, {
    shotType,
    isTakeover,
    isSliding: player.isSliding,
  });

  const decisionRng = createRng(makeShotDecisionSeed(state, playerIndex));
  const roll = decisionRng.next();
  const sign = decisionRng.next() < 0.5 ? -1 : 1;

  let qualityTier: 'PERFECT' | 'GOOD' | 'EARLY_LATE' | 'VERY_EARLY_LATE';
  if (roll < profile.perfectProb) {
    qualityTier = 'PERFECT';
  } else if (roll < profile.perfectProb + profile.goodProb) {
    qualityTier = 'GOOD';
  } else if (roll < profile.perfectProb + profile.goodProb + profile.earlyLateProb) {
    qualityTier = 'EARLY_LATE';
  } else {
    qualityTier = 'VERY_EARLY_LATE';
  }

  let offset = 0;
  if (qualityTier === 'PERFECT') {
    offset = sign * decisionRng.range(0, 0.72) * effectiveHalfWidth;
  } else if (qualityTier === 'GOOD') {
    offset = sign * decisionRng.range(1.15, 2.2) * effectiveHalfWidth;
  } else if (qualityTier === 'EARLY_LATE') {
    offset = sign * decisionRng.range(2.6, 3.75) * effectiveHalfWidth;
  } else {
    offset = sign * decisionRng.range(4.25, 5.1) * effectiveHalfWidth;
  }

  return clamp(PHYSICS_CONSTANTS.METER_SWEET_CENTER + offset, 0.1, 1.18);
}

function chooseShotAction(
  state: MatchState,
  playerIndex: PlayerIndex,
  difficulty: AIDifficulty
): { action: ShotActionKey; shotType: ShotType; aimX: number; aimZ: number } {
  const profile = AI_PROFILES[difficulty];
  const player = state.players[playerIndex];
  const opp = state.players[1 - playerIndex];
  const decisionRng = createRng(makeShotDecisionSeed(state, playerIndex) ^ 0x9e3779b9);

  if (state.phase === 'serve_ready' || state.phase === 'serve_toss') {
    const useFirstServe = state.score.serveNumber === 1 && difficulty !== 'rookie';
    const action: ShotActionKey = useFirstServe
      ? 'J'
      : state.score.serveNumber === 1 && decisionRng.next() < 0.55
        ? 'J'
        : 'K';
    const shotType: ShotType = action === 'J' ? 'serve_flat' : 'serve_kick';
    const aimX = decisionRng.range(-profile.aggression, profile.aggression);
    return { action, shotType, aimX, aimZ: 0 };
  }

  // Rally shot selection
  const oppDeep = Math.abs(opp.pos.z) > 10.6;
  const oppAtNet = Math.abs(opp.pos.z) < 5.8;

  let action: ShotActionKey = 'J';
  let shotType: ShotType = 'topspin';
  // Deep default aim: in world coords, pushing deeper toward opponent means -player.side * (-1) for forward?
  // Remember CONTRACT: forwardAimZ = -aimZ * player.side.
  // For W+K dropshot, forwardAimZ >= 0.5 => aimZ = -0.8 * player.side.
  // For normal deep groundstroke, aimZ = 0 (mid-deep) or slight deep bias: aimZ = -0.25 * player.side.
  let aimZ = -0.15 * player.side;

  if (oppAtNet && decisionRng.next() < profile.lobProb) {
    action = 'L';
    shotType = 'lob';
    aimZ = 0;
  } else if (oppDeep && decisionRng.next() < profile.dropshotProb) {
    action = 'K';
    shotType = 'dropshot';
    aimZ = -0.85 * player.side;
  } else if (difficulty === 'rookie' && decisionRng.next() < 0.25) {
    action = 'K';
    shotType = 'slice';
    aimZ = 0.2 * player.side;
  } else if (difficulty !== 'rookie' && decisionRng.next() < 0.14) {
    action = 'K';
    shotType = 'slice';
    aimZ = 0.2 * player.side;
  }

  // Aim away from opponent's X position scaled by aggression
  const openSide = opp.pos.x >= 0 ? -1 : 1;
  const aimX =
    openSide * profile.aggression * decisionRng.range(0.42, 0.84) +
    decisionRng.range(-0.1, 0.1);

  return {
    action,
    shotType,
    aimX: clamp(aimX, -1, 1),
    aimZ: clamp(aimZ, -1, 1),
  };
}

/**
 * Deterministic AI decision function producing canonical world-space PlayerInputFrame.
 */
export function computeAIInput(
  state: MatchState,
  playerIndex: PlayerIndex,
  difficulty: AIDifficulty,
  rng: PRNG
): PlayerInputFrame {
  // Touch rng slightly only if needed? Keep deterministic without mutating caller expectations
  void rng;
  const profile = AI_PROFILES[difficulty];
  const player = state.players[playerIndex];

  const baseFrame: PlayerInputFrame = {
    seq: state.tick + 1,
    moveX: 0,
    moveZ: 0,
    aimX: 0,
    aimZ: 0,
    action: 'none',
    phase: 'idle',
  };

  // Serve ready: initiate serve after short settle ticks
  if (state.phase === 'serve_ready') {
    if (state.score.server === playerIndex && state.phaseTimer >= 0.35) {
      const choice = chooseShotAction(state, playerIndex, difficulty);
      return {
        ...baseFrame,
        aimX: choice.aimX,
        aimZ: choice.aimZ,
        action: choice.action,
        phase: 'hold',
      };
    }
    return baseFrame;
  }

  // Serve toss: hold meter until targetProgress, then release
  if (state.phase === 'serve_toss') {
    if (state.score.server === playerIndex && player.meter.active) {
      const choice = chooseShotAction(state, playerIndex, difficulty);
      const shotType: ShotType = player.meter.action === 'J' ? 'serve_flat' : 'serve_kick';
      const targetProgress = pickAITargetProgress(state, playerIndex, difficulty, shotType);
      const shouldRelease = player.meter.progress >= targetProgress;
      return {
        ...baseFrame,
        aimX: choice.aimX,
        aimZ: choice.aimZ,
        action: player.meter.action,
        phase: shouldRelease ? 'release' : 'hold',
      };
    }
    return baseFrame;
  }

  if (state.phase !== 'rally') {
    return baseFrame;
  }

  const ball = state.ball;
  const ballFromOpponent = ball.lastHitter !== playerIndex;
  const elapsedSinceHit = (state.tick - ball.hitTick) * COURT_DIM.FIXED_DT;

  // Determine movement target in canonical world coordinates
  let targetX = 0;
  let targetZ = player.side * (COURT_DIM.HALF_LENGTH - 0.6);

  if (!ballFromOpponent) {
    // Ball moving away from AI: recover toward baseline center, or rush net on serve-and-volley
    const decisionRng = createRng(makeShotDecisionSeed(state, playerIndex) ^ 0x517cc1b7);
    const wasServe =
      ball.lastShotType === 'serve_flat' || ball.lastShotType === 'serve_kick';
    const goNet =
      wasServe &&
      (player.archetype === 'serve_volley' || difficulty === 'legend') &&
      decisionRng.next() < profile.serveVolleyProb;
    targetX = 0;
    targetZ = goNet
      ? player.side * 4.8
      : player.side * (COURT_DIM.HALF_LENGTH - 0.7);
  } else if (elapsedSinceHit >= profile.reactionSec) {
    // React to incoming ball
    const landing = ball.predictedLanding;
    if (landing && landing.z * player.side > 0) {
      // Position behind/at predicted bounce or intercept along trajectory
      const interceptZ = clamp(
        landing.z + player.side * 1.15,
        player.side > 0 ? COURT_DIM.RUN_LIMIT_Z_MIN : -COURT_DIM.RUN_LIMIT_Z_MAX + 0.5,
        player.side > 0 ? COURT_DIM.RUN_LIMIT_Z_MAX - 0.5 : -COURT_DIM.RUN_LIMIT_Z_MIN
      );
      targetX = clamp(landing.x, -COURT_DIM.RUN_LIMIT_X + 0.3, COURT_DIM.RUN_LIMIT_X - 0.3);
      targetZ = interceptZ;
    } else {
      targetX = clamp(ball.pos.x, -COURT_DIM.RUN_LIMIT_X + 0.3, COURT_DIM.RUN_LIMIT_X - 0.3);
      targetZ = clamp(
        ball.pos.z + player.side * 0.6,
        player.side > 0 ? COURT_DIM.RUN_LIMIT_Z_MIN : -COURT_DIM.RUN_LIMIT_Z_MAX + 0.5,
        player.side > 0 ? COURT_DIM.RUN_LIMIT_Z_MAX - 0.5 : -COURT_DIM.RUN_LIMIT_Z_MIN
      );
    }
  } else {
    // Within reaction delay: stay near current spot
    targetX = player.pos.x;
    targetZ = player.pos.z;
  }

  const dxMove = targetX - player.pos.x;
  const dzMove = targetZ - player.pos.z;
  const distMove = Math.hypot(dxMove, dzMove);
  let moveX = 0;
  let moveZ = 0;
  if (distMove > 0.12) {
    const scale = profile.speedScale * Math.min(1, distMove / 0.45);
    moveX = (dxMove / distMove) * scale;
    moveZ = (dzMove / distMove) * scale;
  }

  // Swing / meter logic
  const choice = chooseShotAction(state, playerIndex, difficulty);
  const activeShotType: ShotType = player.meter.active
    ? player.meter.action === 'L'
      ? 'lob'
      : player.meter.action === 'K'
        ? choice.shotType === 'dropshot'
          ? 'dropshot'
          : 'slice'
        : 'topspin'
    : choice.shotType;
  const targetProgress = pickAITargetProgress(state, playerIndex, difficulty, activeShotType);

  if (player.meter.active) {
    const distBallXZ = Math.hypot(ball.pos.x - player.pos.x, ball.pos.z - player.pos.z);
    const reachLimit = player.isSliding
      ? PHYSICS_CONSTANTS.SLIDE_REACH_RADIUS_M
      : PHYSICS_CONSTANTS.BASE_REACH_RADIUS_M;

    const ballOnAISide = ball.pos.z * player.side > -0.4;
    const readyToHit =
      ballFromOpponent &&
      ballOnAISide &&
      distBallXZ <= reachLimit &&
      ball.pos.y <= 3.1 &&
      ball.bounces <= 1;

    // Release when meter reaches targetProgress AND ball is in reach,
    // or if ball is passing while already near sweet zone (never dump into VERY_EARLY)
    const ballPassing = (ball.pos.z - player.pos.z) * player.side > 0.25;
    const minSafePassProgress = Math.min(targetProgress, PHYSICS_CONSTANTS.METER_SWEET_CENTER - 0.03);
    if (
      (readyToHit &&
        (player.meter.progress >= targetProgress ||
          (ballPassing && player.meter.progress >= minSafePassProgress))) ||
      player.meter.progress >= 1.16
    ) {
      return {
        ...baseFrame,
        moveX,
        moveZ,
        aimX: choice.aimX,
        aimZ: choice.aimZ,
        action: player.meter.action,
        phase: 'release',
      };
    }

    return {
      ...baseFrame,
      moveX,
      moveZ,
      aimX: choice.aimX,
      aimZ: choice.aimZ,
      action: player.meter.action,
      phase: 'hold',
    };
  }

  // Decide whether to start holding the shot meter timed for targetProgress
  if (ballFromOpponent && elapsedSinceHit >= profile.reactionSec && ball.bounces <= 1 && ball.pos.y <= 3.5) {
    const approachingZ = ball.vel.z * player.side > 0.5;
    if (approachingZ) {
      const bounceFactor = ball.bounces === 0 ? 0.78 : 0.9;
      const effectiveSpeedZ = Math.max(2.0, Math.abs(ball.vel.z) * bounceFactor);
      const timeToPlayerZ = Math.abs(player.pos.z - ball.pos.z) / effectiveSpeedZ;
      const desiredChargeTime = targetProgress / PHYSICS_CONSTANTS.METER_PROGRESS_RATE;
      const distBallXZ = Math.hypot(ball.pos.x - player.pos.x, ball.pos.z - player.pos.z);
      if (timeToPlayerZ <= desiredChargeTime + 0.04 || distBallXZ <= 1.65) {
        return {
          ...baseFrame,
          moveX,
          moveZ,
          aimX: choice.aimX,
          aimZ: choice.aimZ,
          action: choice.action,
          phase: 'hold',
        };
      }
    }
  }

  return {
    ...baseFrame,
    moveX,
    moveZ,
  };
}

export function getAIProfileReactionSec(difficulty: AIDifficulty): number {
  return AI_PROFILES[difficulty].reactionSec;
}
