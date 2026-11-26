import { COURT_DIM } from './constants.js';
import { clamp } from './physics.js';
import { createRng } from './rng.js';
import type {
  AIDifficulty,
  MatchState,
  PlayerIndex,
  PlayerInputFrame,
  PRNG,
  ShotActionKey,
  ShotType,
} from './types.js';

interface AIProfile {
  reactionSec: number;
  speedScale: number;
  positionOffsetM: number;
  recoveryScale: number;
  aggression: number;
  dropshotProb: number;
  sliceProb: number;
  lobProb: number;
  serveVolleyProb: number;
  cornerServeProb: number;
  aimMin: number;
  aimMax: number;
  aimNoise: number;
  stretchSafeProb: number;
}

const AI_PROFILES: Readonly<Record<AIDifficulty, AIProfile>> = {
  rookie: {
    reactionSec: 0.28,
    speedScale: 0.74,
    positionOffsetM: 0.58,
    recoveryScale: 0.22,
    aggression: 0.28,
    dropshotProb: 0.0,
    sliceProb: 0.28,
    lobProb: 0.0,
    serveVolleyProb: 0.0,
    cornerServeProb: 0.15,
    aimMin: 0.10,
    aimMax: 0.55,
    aimNoise: 0.85,
    stretchSafeProb: 0.10,
  },
  pro: {
    reactionSec: 0.14,
    speedScale: 0.90,
    positionOffsetM: 0.22,
    recoveryScale: 0.85,
    aggression: 0.68,
    dropshotProb: 0.16,
    sliceProb: 0.12,
    lobProb: 0.10,
    serveVolleyProb: 0.12,
    cornerServeProb: 0.40,
    aimMin: 0.56,
    aimMax: 0.86,
    aimNoise: 0.12,
    stretchSafeProb: 0.65,
  },
  legend: {
    reactionSec: 0.05,
    speedScale: 1.0,
    positionOffsetM: 0.05,
    recoveryScale: 1.0,
    aggression: 0.92,
    dropshotProb: 0.22,
    sliceProb: 0.05,
    lobProb: 0.24,
    serveVolleyProb: 0.30,
    cornerServeProb: 0.70,
    aimMin: 0.85,
    aimMax: 0.99,
    aimNoise: 0.02,
    stretchSafeProb: 0.96,
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
    const action: ShotActionKey =
      state.score.serveNumber === 1
        ? difficulty === 'rookie' && decisionRng.next() < 0.45
          ? 'K'
          : 'J'
        : 'K';
    const shotType: ShotType = action === 'J' ? 'serve_flat' : 'serve_kick';
    const pushCorner = decisionRng.next() < profile.cornerServeProb;
    const sign = decisionRng.next() < 0.5 ? -1 : 1;
    const aimX = pushCorner
      ? sign * decisionRng.range(0.86, 0.96)
      : decisionRng.range(-profile.aggression * 0.75, profile.aggression * 0.75);
    return { action, shotType, aimX: clamp(aimX, -1, 1), aimZ: 0 };
  }

  const oppDeep = Math.abs(opp.pos.z) > 9.0;
  const oppAtNet = Math.abs(opp.pos.z) < 6.2;

  let action: ShotActionKey = 'J';
  let shotType: ShotType = 'topspin';
  let aimZ = -0.45 * player.side; // deep topspin bias

  const roll = decisionRng.next();
  if (oppAtNet && roll < profile.lobProb) {
    action = 'L';
    shotType = 'lob';
    aimZ = 0;
  } else if (oppDeep && roll < profile.dropshotProb) {
    action = 'K';
    shotType = 'dropshot';
    aimZ = -0.85 * player.side; // W+K tight dropshot
  } else if (roll > 1 - profile.sliceProb) {
    action = 'K';
    shotType = 'slice';
    aimZ = 0.8 * player.side; // S+K defensive mid-court slice
  }

  const openSide = opp.pos.x >= 0 ? -1 : 1;
  const oppOffCenter = Math.abs(opp.pos.x) > 0.8;
  const isStretchedOrSliding =
    player.isSliding ||
    Math.hypot(state.ball.pos.x - player.pos.x, state.ball.pos.z - player.pos.z) > 1.35;

  let aimX: number;
  if (isStretchedOrSliding && decisionRng.next() < profile.stretchSafeProb) {
    // Experienced AI recovers safely crosscourt within sideline tolerance when stretched
    aimX = openSide * decisionRng.range(0.35, 0.65);
  } else if (isStretchedOrSliding && difficulty === 'rookie') {
    // Rookie panics/sprays when stretched, naturally incurring sideline errors
    const errSign = decisionRng.next() < 0.5 ? -1 : 1;
    aimX = errSign * decisionRng.range(0.78, 1.0);
  } else {
    const baseAim =
      openSide *
      decisionRng.range(
        oppOffCenter ? Math.min(0.96, profile.aimMin + 0.08) : profile.aimMin,
        profile.aimMax
      );
    aimX = baseAim + decisionRng.range(-profile.aimNoise, profile.aimNoise);
  }

  return {
    action,
    shotType,
    aimX: clamp(aimX, -1, 1),
    aimZ: clamp(aimZ, -1, 1),
  };
}

/**
 * Deterministic V2 AI decision function outputting canonical world-space PlayerInputFrame.
 * Follows the exact same V2 auto-contact and edge-triggered serve protocol as human players.
 */
export function computeAIInput(
  state: MatchState,
  playerIndex: PlayerIndex,
  difficulty: AIDifficulty,
  rng: PRNG
): PlayerInputFrame {
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
    actionPressed: false,
  };

  if (state.phase === 'serve_ready') {
    if (state.score.server === playerIndex && state.phaseTimer >= 0.35) {
      const choice = chooseShotAction(state, playerIndex, difficulty);
      return {
        ...baseFrame,
        aimX: choice.aimX,
        aimZ: choice.aimZ,
        action: choice.action,
        actionPressed: true,
      };
    }
    return baseFrame;
  }

  if (state.phase === 'serve_toss') {
    if (state.score.server === playerIndex) {
      const choice = chooseShotAction(state, playerIndex, difficulty);
      return {
        ...baseFrame,
        aimX: choice.aimX,
        aimZ: choice.aimZ,
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

  const posRng = createRng(makeShotDecisionSeed(state, playerIndex) ^ 0x517cc1b7);
  const offsetX = posRng.range(-profile.positionOffsetM, profile.positionOffsetM);
  const offsetZ = posRng.range(-profile.positionOffsetM, profile.positionOffsetM);

  let targetX = 0;
  let targetZ = player.side * (COURT_DIM.HALF_LENGTH - 0.6);
  let moveSpeedFactor = profile.speedScale;

  if (!ballFromOpponent) {
    const wasServe =
      ball.lastShotType === 'serve_flat' || ball.lastShotType === 'serve_kick';
    const opp = state.players[1 - playerIndex];
    const oppWasStretched =
      opp.stance.lastQuality === 'STRETCH' && difficulty === 'legend';
    const goNet =
      (wasServe &&
        (player.archetype === 'serve_volley' || difficulty === 'legend') &&
        posRng.next() < profile.serveVolleyProb) ||
      (oppWasStretched && ball.lastShotType === 'topspin' && posRng.next() < 0.70) ||
      (difficulty === 'legend' && ball.lastShotType === 'dropshot');
    targetX = difficulty === 'rookie' ? offsetX * 1.5 : 0;
    targetZ = goNet
      ? player.side * 4.2
      : player.side * (COURT_DIM.HALF_LENGTH - 0.7);
    moveSpeedFactor = profile.speedScale * profile.recoveryScale;
  } else if (elapsedSinceHit >= profile.reactionSec) {
    const landing = ball.predictedLanding;
    if (landing && landing.z * player.side > 0) {
      const isShortBall = Math.abs(landing.z) < 5.0;
      const interceptOffset = isShortBall ? 0.35 : 1.15;
      const interceptZ = clamp(
        landing.z + player.side * interceptOffset + offsetZ,
        player.side > 0 ? COURT_DIM.RUN_LIMIT_Z_MIN : -COURT_DIM.RUN_LIMIT_Z_MAX + 0.5,
        player.side > 0 ? COURT_DIM.RUN_LIMIT_Z_MAX - 0.5 : -COURT_DIM.RUN_LIMIT_Z_MIN
      );
      targetX = clamp(
        landing.x + offsetX,
        -COURT_DIM.RUN_LIMIT_X + 0.3,
        COURT_DIM.RUN_LIMIT_X - 0.3
      );
      targetZ = interceptZ;
    } else {
      targetX = clamp(
        ball.pos.x + offsetX,
        -COURT_DIM.RUN_LIMIT_X + 0.3,
        COURT_DIM.RUN_LIMIT_X - 0.3
      );
      targetZ = clamp(
        ball.pos.z + player.side * 0.6 + offsetZ,
        player.side > 0 ? COURT_DIM.RUN_LIMIT_Z_MIN : -COURT_DIM.RUN_LIMIT_Z_MAX + 0.5,
        player.side > 0 ? COURT_DIM.RUN_LIMIT_Z_MAX - 0.5 : -COURT_DIM.RUN_LIMIT_Z_MIN
      );
    }
  } else {
    targetX = player.pos.x;
    targetZ = player.pos.z;
  }

  const dxMove = targetX - player.pos.x;
  const dzMove = targetZ - player.pos.z;
  const distMove = Math.hypot(dxMove, dzMove);
  let moveX = 0;
  let moveZ = 0;
  if (distMove > 0.12) {
    const scale = moveSpeedFactor * Math.min(1, distMove / 0.45);
    moveX = (dxMove / distMove) * scale;
    moveZ = (dzMove / distMove) * scale;
  }

  const choice = chooseShotAction(state, playerIndex, difficulty);
  const incomingValid =
    ballFromOpponent &&
    ball.active &&
    ball.hitTick !== player.stance.lastConsumedHitTick &&
    elapsedSinceHit >= profile.reactionSec &&
    ball.bounces <= 1 &&
    ball.pos.y <= 3.5 &&
    ball.vel.z * player.side > 0.2;

  if (incomingValid) {
    if (player.stance.armedAction === 'none') {
      return {
        ...baseFrame,
        moveX,
        moveZ,
        aimX: choice.aimX,
        aimZ: choice.aimZ,
        action: choice.action,
        actionPressed: true,
      };
    }

    return {
      ...baseFrame,
      moveX,
      moveZ,
      aimX: choice.aimX,
      aimZ: choice.aimZ,
      action: player.stance.armedAction,
      actionPressed: false,
    };
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
