import { COURT_DIM } from './constants.js';
import { cloneMatchState } from './mirror.js';
import type { ErrorCode, MatchState, PlayerIndex } from './types.js';

export type PauseActionResult =
  | { ok: true; state: MatchState; alreadyResuming?: boolean }
  | { ok: false; code: ErrorCode; message: string };

function isActivePlayPhase(phase: MatchState['phase']): phase is 'serve_ready' | 'serve_toss' | 'rally' {
  return phase === 'serve_ready' || phase === 'serve_toss' || phase === 'rally';
}

function minDisconnectedRemaining(state: MatchState): number {
  let minSec: number = COURT_DIM.DISCONNECT_GRACE_SEC;
  let found = false;
  for (const idx of [0, 1] as const) {
    if (state.pause.disconnected[idx]) {
      const rem = state.pause.disconnectRemainingSec[idx];
      if (!found || rem < minSec) {
        minSec = rem;
        found = true;
      }
    }
  }
  return found ? minSec : 0;
}

/**
 * Request manual pause during active play. Online mode enforces 3 pauses/player and 60s limit;
 * single-player mode is exempt from limits.
 */
export function requestManualPause(state: MatchState, by: PlayerIndex): PauseActionResult {
  if (!isActivePlayPhase(state.phase)) {
    return {
      ok: false,
      code: 'INVALID_PHASE',
      message: `Cannot pause in phase "${state.phase}"`,
    };
  }

  if (state.config.mode === 'online' && state.pause.manualPausesLeft[by] <= 0) {
    return {
      ok: false,
      code: 'PAUSE_LIMIT_REACHED',
      message: '本场暂停次数（3次）已用尽',
    };
  }

  const next = cloneMatchState(state);
  if (next.config.mode === 'online') {
    next.pause.manualPausesLeft[by] -= 1;
    next.pause.remainingSec = COURT_DIM.MANUAL_PAUSE_MAX_SEC;
  } else {
    next.pause.remainingSec = 0;
  }

  next.pause.reason = 'manual';
  next.pause.initiatedBy = by;
  next.pause.pausedFromPhase = state.phase;
  next.pause.resumeCountdownSec = 0;
  next.phase = 'paused_manual';

  return { ok: true, state: next };
}

/**
 * Request resuming from manual pause. Online mode enters 3s resuming countdown (idempotent if already resuming).
 */
export function requestManualResume(state: MatchState, by: PlayerIndex): PauseActionResult {
  if (state.phase === 'paused_disconnect') {
    return {
      ok: false,
      code: 'CANNOT_RESUME_DISCONNECT',
      message: '等待对手重连中，无法提前恢复',
    };
  }

  if (state.phase === 'resuming') {
    return {
      ok: true,
      state: cloneMatchState(state),
      alreadyResuming: true,
    };
  }

  if (state.phase !== 'paused_manual') {
    return {
      ok: false,
      code: 'INVALID_PHASE',
      message: `Cannot resume from phase "${state.phase}"`,
    };
  }

  const next = cloneMatchState(state);
  if (next.config.mode === 'single') {
    next.phase = next.pause.pausedFromPhase ?? 'serve_ready';
    next.pause.reason = 'none';
    next.pause.initiatedBy = null;
    next.pause.pausedFromPhase = null;
    next.pause.remainingSec = 0;
    next.pause.resumeCountdownSec = 0;
    return { ok: true, state: next };
  }

  next.phase = 'resuming';
  next.pause.resumeCountdownSec = COURT_DIM.RESUME_COUNTDOWN_SEC;
  next.pause.initiatedBy = by;
  return { ok: true, state: next };
}

/**
 * Apply player disconnection. Transitions active/manual-pause/resuming phases into paused_disconnect
 * while preserving the original active pausedFromPhase and without refunding manual pause counts.
 */
export function applyDisconnect(state: MatchState, idx: PlayerIndex): MatchState {
  const next = cloneMatchState(state);
  next.pause.disconnected[idx] = true;
  next.pause.disconnectRemainingSec[idx] = COURT_DIM.DISCONNECT_GRACE_SEC;

  if (
    state.phase === 'serve_ready' ||
    state.phase === 'serve_toss' ||
    state.phase === 'rally' ||
    state.phase === 'paused_manual' ||
    state.phase === 'resuming'
  ) {
    if (isActivePlayPhase(state.phase)) {
      next.pause.pausedFromPhase = state.phase;
    }
    // If paused_manual or resuming, keep existing next.pause.pausedFromPhase untouched
    next.phase = 'paused_disconnect';
    next.pause.reason = 'disconnect';
    next.pause.initiatedBy = idx;
    next.pause.resumeCountdownSec = 0;
    next.pause.remainingSec = minDisconnectedRemaining(next);
  }

  return next;
}

/**
 * Apply player reconnection. Resets lastAckSeq[idx] = 0 and enters 3s resuming once both players are connected.
 */
export function applyReconnect(
  state: MatchState,
  idx: PlayerIndex
): { state: MatchState; bothConnected: boolean } {
  const next = cloneMatchState(state);
  next.lastAckSeq[idx] = 0;
  next.pause.disconnected[idx] = false;
  next.pause.disconnectRemainingSec[idx] = COURT_DIM.DISCONNECT_GRACE_SEC;

  const bothConnected = !next.pause.disconnected[0] && !next.pause.disconnected[1];

  if (next.phase === 'paused_disconnect') {
    if (bothConnected) {
      next.phase = 'resuming';
      next.pause.resumeCountdownSec = COURT_DIM.RESUME_COUNTDOWN_SEC;
      next.pause.remainingSec = 0;
    } else {
      next.pause.remainingSec = minDisconnectedRemaining(next);
    }
  }

  return { state: next, bothConnected };
}

/**
 * Controlled test helper to fast-forward manual pause or disconnect grace timers.
 */
export function fastForwardPauseState(state: MatchState, seconds: number): MatchState {
  const next = cloneMatchState(state);
  const delta = Math.max(0, seconds);

  if (next.phase === 'paused_manual' && next.config.mode === 'online') {
    next.pause.remainingSec = Math.max(0, next.pause.remainingSec - delta);
  } else if (next.phase === 'paused_disconnect') {
    for (const idx of [0, 1] as const) {
      if (next.pause.disconnected[idx]) {
        next.pause.disconnectRemainingSec[idx] = Math.max(
          0,
          next.pause.disconnectRemainingSec[idx] - delta
        );
      }
    }
    next.pause.remainingSec = minDisconnectedRemaining(next);
  } else if (next.phase === 'resuming') {
    next.pause.resumeCountdownSec = Math.max(0, next.pause.resumeCountdownSec - delta);
  }

  return next;
}
