import type { GameEvent, MatchState, PlayerInputFrame, PlayerSide, Vec3 } from './types.js';

export function cloneVec3(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function cloneMatchState(state: MatchState): MatchState {
  return {
    tick: state.tick,
    config: {
      ...state.config,
      archetypes: [state.config.archetypes[0], state.config.archetypes[1]],
    },
    phase: state.phase,
    phaseTimer: state.phaseTimer,
    players: [
      {
        ...state.players[0],
        pos: cloneVec3(state.players[0].pos),
        vel: cloneVec3(state.players[0].vel),
        stance: { ...state.players[0].stance },
      },
      {
        ...state.players[1],
        pos: cloneVec3(state.players[1].pos),
        vel: cloneVec3(state.players[1].vel),
        stance: { ...state.players[1].stance },
      },
    ],
    ball: {
      ...state.ball,
      pos: cloneVec3(state.ball.pos),
      vel: cloneVec3(state.ball.vel),
      spin: cloneVec3(state.ball.spin),
      firstBouncePos: state.ball.firstBouncePos ? cloneVec3(state.ball.firstBouncePos) : null,
      predictedLanding: state.ball.predictedLanding ? cloneVec3(state.ball.predictedLanding) : null,
    },
    score: {
      ...state.score,
      games: [state.score.games[0], state.score.games[1]],
      points: [state.score.points[0], state.score.points[1]],
    },
    stats: [{ ...state.stats[0] }, { ...state.stats[1] }],
    hawkeye: {
      ...state.hawkeye,
      bouncePos: cloneVec3(state.hawkeye.bouncePos),
    },
    pause: {
      ...state.pause,
      manualPausesLeft: [state.pause.manualPausesLeft[0], state.pause.manualPausesLeft[1]],
      disconnected: [state.pause.disconnected[0], state.pause.disconnected[1]],
      disconnectRemainingSec: [
        state.pause.disconnectRemainingSec[0],
        state.pause.disconnectRemainingSec[1],
      ],
    },
    lastAckSeq: [state.lastAckSeq[0], state.lastAckSeq[1]],
  };
}

/**
 * Transform a world-space vector into local camera view coordinates for a given player side.
 */
export function toLocalVec3(v: Vec3, side: PlayerSide): Vec3 {
  if (side === 1) {
    return { x: v.x, y: v.y, z: v.z };
  }
  return { x: -v.x, y: v.y, z: -v.z };
}

function normalizeYaw(yaw: number): number {
  const twoPi = Math.PI * 2;
  let y = yaw % twoPi;
  if (y > Math.PI) y -= twoPi;
  if (y <= -Math.PI) y += twoPi;
  return y;
}

/**
 * Transform full MatchState spatial fields from canonical world space to player's local view space.
 */
export function toLocalView(state: MatchState, side: PlayerSide): MatchState {
  const copy = cloneMatchState(state);
  if (side === 1) {
    return copy;
  }

  for (const player of copy.players) {
    player.pos = toLocalVec3(player.pos, side);
    player.vel = toLocalVec3(player.vel, side);
    player.yaw = normalizeYaw(player.yaw + Math.PI);
    player.stance.lockedAimX = player.stance.lockedAimX === 0 ? 0 : -player.stance.lockedAimX;
  }

  copy.ball.pos = toLocalVec3(copy.ball.pos, side);
  copy.ball.vel = toLocalVec3(copy.ball.vel, side);
  copy.ball.spin = toLocalVec3(copy.ball.spin, side);
  if (copy.ball.predictedLanding) {
    copy.ball.predictedLanding = toLocalVec3(copy.ball.predictedLanding, side);
  }
  if (copy.ball.firstBouncePos) {
    copy.ball.firstBouncePos = toLocalVec3(copy.ball.firstBouncePos, side);
  }

  copy.hawkeye.bouncePos = toLocalVec3(copy.hawkeye.bouncePos, side);
  return copy;
}

/**
 * Transform spatial coordinates of a GameEvent from canonical world space to player's local view space.
 */
export function toLocalEvent(event: GameEvent, side: PlayerSide): GameEvent {
  if (side === 1) {
    if (event.type === 'HAWKEYE_START') {
      return {
        ...event,
        hawkeye: { ...event.hawkeye, bouncePos: cloneVec3(event.hawkeye.bouncePos) },
      };
    }
    if (event.type === 'POINT_SCORED') {
      return {
        ...event,
        score: {
          ...event.score,
          games: [event.score.games[0], event.score.games[1]],
          points: [event.score.points[0], event.score.points[1]],
        },
      };
    }
    if (event.type === 'MATCH_OVER') {
      return {
        ...event,
        score: {
          ...event.score,
          games: [event.score.games[0], event.score.games[1]],
          points: [event.score.points[0], event.score.points[1]],
        },
        stats: [{ ...event.stats[0] }, { ...event.stats[1] }],
      };
    }
    if ('pos' in event) {
      return { ...event, pos: cloneVec3(event.pos) };
    }
    return { ...event };
  }

  switch (event.type) {
    case 'SHOT_HIT':
    case 'BOUNCE':
    case 'NET_LET':
      return { ...event, pos: toLocalVec3(event.pos, side) };
    case 'HAWKEYE_START':
      return {
        ...event,
        hawkeye: {
          ...event.hawkeye,
          bouncePos: toLocalVec3(event.hawkeye.bouncePos, side),
        },
      };
    case 'POINT_SCORED':
      return {
        ...event,
        score: {
          ...event.score,
          games: [event.score.games[0], event.score.games[1]],
          points: [event.score.points[0], event.score.points[1]],
        },
      };
    case 'MATCH_OVER':
      return {
        ...event,
        score: {
          ...event.score,
          games: [event.score.games[0], event.score.games[1]],
          points: [event.score.points[0], event.score.points[1]],
        },
        stats: [{ ...event.stats[0] }, { ...event.stats[1] }],
      };
    default:
      return { ...event };
  }
}

/**
 * Convert local-screen PlayerInputFrame into canonical world-space directional intents.
 */
export function toWorldInput(localInput: PlayerInputFrame, side: PlayerSide): PlayerInputFrame {
  return {
    ...localInput,
    moveX: localInput.moveX * side,
    moveZ: localInput.moveZ * side,
    aimX: localInput.aimX * side,
    aimZ: localInput.aimZ * side,
  };
}
