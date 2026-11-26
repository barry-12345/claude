import { cloneMatchState, type GameEvent, type MatchState, type ServerMessage } from '@court2k/shared';
import type { SnapshotBuffer } from './SnapshotBuffer.js';

export type FullSyncResolution =
  | {
      kind: 'lobby_waiting';
      mode: 'lobby';
      onlineState: null;
    }
  | {
      kind: 'enter_match';
      mode: 'online';
      onlineState: MatchState;
    };

/**
 * Resolve client state transition when receiving FULL_SYNC.
 * When `snapshot.phase === 'waiting'`, the client stays in lobby view instead of switching to an empty match canvas.
 */
export function resolveFullSyncTransition(
  payload: Extract<ServerMessage, { type: 'FULL_SYNC' }>['payload'],
  snapshots: SnapshotBuffer
): FullSyncResolution {
  if (payload.snapshot.phase === 'waiting') {
    snapshots.clear();
    return {
      kind: 'lobby_waiting',
      mode: 'lobby',
      onlineState: null,
    };
  }
  const cloned = cloneMatchState(payload.snapshot);
  snapshots.reset(cloned);
  return {
    kind: 'enter_match',
    mode: 'online',
    onlineState: cloned,
  };
}

/**
 * Synchronize client online MatchState and SnapshotBuffer when GAME_EVENT(MATCH_OVER) arrives
 * (e.g., 15s disconnect forfeit where server sends MATCH_OVER without an extra trailing snapshot).
 */
export function applyOnlineMatchOver(
  currentState: MatchState | null,
  snapshots: SnapshotBuffer,
  event: Extract<GameEvent, { type: 'MATCH_OVER' }>
): MatchState | null {
  const base = currentState ?? snapshots.latest();
  if (!base) {
    return null;
  }
  const next = cloneMatchState(base);
  next.phase = 'match_over';
  next.score = {
    ...event.score,
    games: [event.score.games[0], event.score.games[1]],
    points: [event.score.points[0], event.score.points[1]],
  };
  next.stats = [{ ...event.stats[0] }, { ...event.stats[1] }];
  snapshots.reset(next);
  return next;
}
