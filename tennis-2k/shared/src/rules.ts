import { COURT_DIM } from './constants.js';
import { cloneMatchState } from './mirror.js';
import type {
  KeyPointLabel,
  MatchFormat,
  MatchState,
  PlayerIndex,
  PlayerMatchStats,
  ScorePatch,
  ScoreState,
  Vec3,
} from './types.js';

export function createEmptyStats(): PlayerMatchStats {
  return {
    aces: 0,
    doubleFaults: 0,
    firstServesIn: 0,
    firstServesTotal: 0,
    winners: 0,
    unforcedErrors: 0,
    perfectShots: 0,
    totalMeterShots: 0,
  };
}

/**
 * Compute integer percentages (0-100) for first serve % and perfect shot %.
 */
export function computeStatsSummary(stats: PlayerMatchStats): {
  firstServePct: number;
  perfectPct: number;
} {
  const firstServePct =
    stats.firstServesTotal <= 0
      ? 0
      : Math.round((stats.firstServesIn / stats.firstServesTotal) * 100);
  const perfectPct =
    stats.totalMeterShots <= 0
      ? 0
      : Math.round((stats.perfectShots / stats.totalMeterShots) * 100);
  return { firstServePct, perfectPct };
}

export function computeCourtSide(points: [number, number]): 'deuce' | 'ad' {
  return (points[0] + points[1]) % 2 === 0 ? 'deuce' : 'ad';
}

export function computeKeyPointLabel(score: ScoreState): KeyPointLabel {
  if (score.winner !== null) {
    return 'NONE';
  }

  const { format, games, points, isTiebreak, isDecidingPoint, server } = score;

  // Check if either player can win the match on the next point
  for (const p of [0, 1] as const) {
    const opp = (1 - p) as PlayerIndex;
    if (format === 'super_tiebreak') {
      if (points[p] >= 9 && points[p] - points[opp] >= 1) {
        return 'MATCH_POINT';
      }
    } else if (isTiebreak) {
      if (points[p] >= 6 && points[p] - points[opp] >= 1) {
        return 'MATCH_POINT';
      }
    } else if (games[p] === 3 && games[opp] <= 2) {
      if (points[p] >= 3) {
        return 'MATCH_POINT';
      }
    }
  }

  if (!isTiebreak && format === 'fast4' && isDecidingPoint) {
    return 'DECIDING_POINT';
  }

  if (!isTiebreak) {
    const receiver = (1 - server) as PlayerIndex;
    if (points[receiver] >= 3 && points[server] < 3) {
      return 'BREAK_POINT';
    }
  }

  if (isTiebreak) {
    return 'TIEBREAK';
  }

  return 'NONE';
}

export function refreshScoreMetadata(score: ScoreState): ScoreState {
  const next: ScoreState = {
    ...score,
    games: [score.games[0], score.games[1]],
    points: [score.points[0], score.points[1]],
  };
  next.isDecidingPoint =
    next.format === 'fast4' &&
    !next.isTiebreak &&
    next.points[0] === 3 &&
    next.points[1] === 3;
  next.courtSide = computeCourtSide(next.points);
  next.keyPointLabel = computeKeyPointLabel(next);
  return next;
}

export function createInitialScoreState(format: MatchFormat): ScoreState {
  const base: ScoreState = {
    format,
    games: [0, 0],
    points: [0, 0],
    isTiebreak: format === 'super_tiebreak',
    isDecidingPoint: false,
    server: 0,
    serveNumber: 1,
    courtSide: 'deuce',
    keyPointLabel: format === 'super_tiebreak' ? 'TIEBREAK' : 'NONE',
    winner: null,
  };
  return refreshScoreMetadata(base);
}

/**
 * Advance score state when `winner` wins the current point.
 */
export function awardPointToScore(score: ScoreState, winner: PlayerIndex): ScoreState {
  if (score.winner !== null) {
    return score;
  }

  const next: ScoreState = {
    ...score,
    games: [score.games[0], score.games[1]],
    points: [score.points[0], score.points[1]],
    serveNumber: 1,
  };
  const loser = (1 - winner) as PlayerIndex;

  if (next.isTiebreak) {
    next.points[winner] += 1;
    const totalTbPoints = next.points[0] + next.points[1];
    const targetPts = next.format === 'super_tiebreak' ? 10 : 7;

    if (next.points[winner] >= targetPts && next.points[winner] - next.points[loser] >= 2) {
      if (next.format === 'fast4') {
        next.games[winner] += 1; // 4-3
      } else {
        next.games[winner] = 1;
      }
      next.winner = winner;
      return refreshScoreMetadata(next);
    }

    // Tiebreak serve rotation: switch after 1st point, then every 2 points
    if (totalTbPoints % 2 === 1) {
      next.server = (1 - next.server) as PlayerIndex;
    }
    return refreshScoreMetadata(next);
  }

  // Fast4 regular game
  if (next.isDecidingPoint || (next.points[winner] >= 3 && next.points[loser] < 3)) {
    // Game won
    next.games[winner] += 1;
    next.points = [0, 0];
    next.isDecidingPoint = false;

    if (next.games[winner] >= 4 && next.games[winner] - next.games[loser] >= 2) {
      next.winner = winner;
      return refreshScoreMetadata(next);
    }

    next.server = (1 - next.server) as PlayerIndex;
    if (next.games[0] === 3 && next.games[1] === 3) {
      next.isTiebreak = true;
    }
    return refreshScoreMetadata(next);
  }

  next.points[winner] += 1;
  return refreshScoreMetadata(next);
}

/**
 * Compute canonical serve & receive player positions for the current score.
 */
export function computeServeSetupPositions(score: ScoreState): {
  serverPos: Vec3;
  receiverPos: Vec3;
} {
  const serverSide = score.server === 0 ? 1 : -1;
  const receiverSide = -serverSide;
  // Server stands on right of own view for deuce, left for ad:
  // For side = +1: right = +x, left = -x -> x = side * (deuce ? +1 : -1) * offset
  // For side = -1: local right = -x (world), local left = +x (world) -> x = side * (deuce ? +1 : -1) * offset
  const sideSign = score.courtSide === 'deuce' ? 1 : -1;
  const serverX = serverSide * sideSign * 1.45;
  const receiverX = receiverSide * sideSign * 2.15;

  return {
    serverPos: { x: serverX, y: 0, z: serverSide * (COURT_DIM.HALF_LENGTH + 0.55) },
    receiverPos: { x: receiverX, y: 0, z: receiverSide * (COURT_DIM.HALF_LENGTH + 0.45) },
  };
}

/**
 * Apply controlled test score patch and reposition players for next serve.
 */
export function applyScorePatch(state: MatchState, patch: ScorePatch): MatchState {
  const next = cloneMatchState(state);
  if (patch.games) {
    next.score.games = [patch.games[0], patch.games[1]];
  }
  if (patch.points) {
    next.score.points = [patch.points[0], patch.points[1]];
  }
  if (patch.isTiebreak !== undefined) {
    next.score.isTiebreak = patch.isTiebreak;
  } else if (next.config.format === 'fast4') {
    next.score.isTiebreak = next.score.games[0] === 3 && next.score.games[1] === 3;
  }
  if (patch.server !== undefined) {
    next.score.server = patch.server;
  }
  if (patch.serveNumber !== undefined) {
    next.score.serveNumber = patch.serveNumber;
  }
  next.score.winner = null;
  next.score = refreshScoreMetadata(next.score);

  const { serverPos, receiverPos } = computeServeSetupPositions(next.score);
  const srvIdx = next.score.server;
  const rcvIdx = (1 - srvIdx) as PlayerIndex;
  next.players[srvIdx].pos = serverPos;
  next.players[srvIdx].vel = { x: 0, y: 0, z: 0 };
  next.players[rcvIdx].pos = receiverPos;
  next.players[rcvIdx].vel = { x: 0, y: 0, z: 0 };
  next.phase = 'serve_ready';
  next.ball.active = false;
  next.ball.pos = { x: serverPos.x, y: 1.05, z: serverPos.z - next.players[srvIdx].side * 0.35 };
  next.ball.vel = { x: 0, y: 0, z: 0 };
  next.ball.spin = { x: 0, y: 0, z: 0 };
  return next;
}
