import { cloneMatchState, type GameEvent, type MatchState } from '@court2k/shared';
import type { SnapshotBuffer } from './SnapshotBuffer.js';

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
