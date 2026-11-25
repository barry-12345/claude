import { cloneMatchState, type MatchState } from '@court2k/shared';

export interface SnapshotEntry {
  serverTick: number;
  serverTime: number;
  receivedAtMs: number;
  state: MatchState;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/**
 * Snapshot interpolation buffer with deterministic reset on FULL_SYNC / MATCH_START.
 */
export class SnapshotBuffer {
  private entries: SnapshotEntry[] = [];
  private readonly interpDelayMs: number;
  private readonly maxEntries = 20;

  constructor(interpDelayMs = 42) {
    this.interpDelayMs = interpDelayMs;
  }

  public reset(snapshot: MatchState, receivedAtMs = Date.now()): void {
    this.entries = [
      {
        serverTick: snapshot.tick,
        serverTime: receivedAtMs,
        receivedAtMs,
        state: cloneMatchState(snapshot),
      },
    ];
  }

  public clear(): void {
    this.entries = [];
  }

  public size(): number {
    return this.entries.length;
  }

  public push(serverTick: number, serverTime: number, state: MatchState, receivedAtMs = Date.now()): void {
    const last = this.entries[this.entries.length - 1];
    if (last && serverTick < last.serverTick) {
      return;
    }
    this.entries.push({
      serverTick,
      serverTime,
      receivedAtMs,
      state: cloneMatchState(state),
    });
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  public latest(): MatchState | null {
    if (this.entries.length === 0) return null;
    return this.entries[this.entries.length - 1].state;
  }

  public sample(nowMs = Date.now()): MatchState | null {
    if (this.entries.length === 0) return null;
    if (this.entries.length === 1) {
      return cloneMatchState(this.entries[0].state);
    }

    const renderTime = nowMs - this.interpDelayMs;
    const last = this.entries[this.entries.length - 1];

    if (renderTime >= last.receivedAtMs) {
      return cloneMatchState(last.state);
    }

    if (renderTime <= this.entries[0].receivedAtMs) {
      return cloneMatchState(this.entries[0].state);
    }

    let a = this.entries[0];
    let b = this.entries[1];
    for (let i = 0; i < this.entries.length - 1; i++) {
      if (this.entries[i].receivedAtMs <= renderTime && this.entries[i + 1].receivedAtMs >= renderTime) {
        a = this.entries[i];
        b = this.entries[i + 1];
        break;
      }
    }

    const span = Math.max(1, b.receivedAtMs - a.receivedAtMs);
    const t = Math.max(0, Math.min(1, (renderTime - a.receivedAtMs) / span));

    const out = cloneMatchState(b.state);
    for (const idx of [0, 1] as const) {
      const pa = a.state.players[idx];
      const pb = b.state.players[idx];
      const dist = Math.hypot(pb.pos.x - pa.pos.x, pb.pos.z - pa.pos.z);
      if (dist < 3.5) {
        out.players[idx].pos.x = lerp(pa.pos.x, pb.pos.x, t);
        out.players[idx].pos.y = lerp(pa.pos.y, pb.pos.y, t);
        out.players[idx].pos.z = lerp(pa.pos.z, pb.pos.z, t);
        out.players[idx].yaw = lerpAngle(pa.yaw, pb.yaw, t);
      }
    }

    if (a.state.ball.active && b.state.ball.active) {
      const ballDist = Math.hypot(
        b.state.ball.pos.x - a.state.ball.pos.x,
        b.state.ball.pos.y - a.state.ball.pos.y,
        b.state.ball.pos.z - a.state.ball.pos.z
      );
      if (ballDist < 4.0) {
        out.ball.pos.x = lerp(a.state.ball.pos.x, b.state.ball.pos.x, t);
        out.ball.pos.y = lerp(a.state.ball.pos.y, b.state.ball.pos.y, t);
        out.ball.pos.z = lerp(a.state.ball.pos.z, b.state.ball.pos.z, t);
      }
    }

    return out;
  }
}
