import { describe, expect, it, vi } from 'vitest';
import { createMatchState, type GameEvent, type ServerMessage } from '@court2k/shared';
import { applyOnlineMatchOver } from '../src/net/onlineSync.js';
import { SnapshotBuffer } from '../src/net/SnapshotBuffer.js';
import { deriveWsUrl, WsClient, type WebSocketLike } from '../src/net/WsClient.js';

class MockWebSocket implements WebSocketLike {
  public readyState = 0;
  public onopen: ((ev: unknown) => void) | null = null;
  public onmessage: ((ev: { data: string }) => void) | null = null;
  public onclose: ((ev: unknown) => void) | null = null;
  public onerror: ((ev: unknown) => void) | null = null;
  public sent: string[] = [];

  openNow(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    const cb = this.onclose;
    setTimeout(() => {
      cb?.({});
    }, 5);
  }
}

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe('WS URL derivation, SnapshotBuffer reset, online MATCH_OVER sync, and WsClient reconnect', () => {
  it('derives relative WS URL cleanly under root and /tennis/ subpaths', () => {
    expect(deriveWsUrl('/', { protocol: 'http:', host: '127.0.0.1:3201' })).toBe(
      'ws://127.0.0.1:3201/ws'
    );
    expect(deriveWsUrl('/tennis', { protocol: 'https:', host: 'example.com' })).toBe(
      'wss://example.com/tennis/ws'
    );
    expect(deriveWsUrl('/tennis/', { protocol: 'https:', host: 'example.com' })).toBe(
      'wss://example.com/tennis/ws'
    );
  });

  it('clears SnapshotBuffer queue on reset(FULL_SYNC)', () => {
    const buf = new SnapshotBuffer(40);
    const s1 = createMatchState({
      mode: 'online',
      court: 'hard',
      format: 'fast4',
      archetypes: ['allcourt', 'power'],
      seed: 1,
    });
    s1.tick = 10;
    const s2 = { ...s1, tick: 20 };
    buf.push(10, 1000, s1, 1000);
    buf.push(20, 1033, s2, 1033);
    expect(buf.size()).toBe(2);

    const fullSyncState = { ...s1, tick: 55 };
    buf.reset(fullSyncState, 2000);
    expect(buf.size()).toBe(1);
    expect(buf.sample(2050)?.tick).toBe(55);
  });

  it('transitions onlineState & SnapshotBuffer to match_over when receiving only GAME_EVENT(MATCH_OVER)', () => {
    const buf = new SnapshotBuffer(40);
    const pausedState = createMatchState({
      mode: 'online',
      court: 'clay',
      format: 'fast4',
      archetypes: ['power', 'defender'],
      seed: 7,
    });
    pausedState.phase = 'paused_disconnect';
    buf.push(120, 5000, pausedState, 5000);

    const ev: Extract<GameEvent, { type: 'MATCH_OVER' }> = {
      type: 'MATCH_OVER',
      winner: 0,
      reason: 'forfeit',
      forfeitedBy: 1,
      score: {
        ...pausedState.score,
        games: [2, 1],
        points: [2, 1],
        winner: 0,
      },
      stats: [
        {
          aces: 1,
          doubleFaults: 0,
          firstServesIn: 4,
          firstServesTotal: 5,
          winners: 3,
          unforcedErrors: 1,
          perfectShots: 5,
          totalMeterShots: 8,
        },
        pausedState.stats[1],
      ],
    };

    const updated = applyOnlineMatchOver(pausedState, buf, ev);
    expect(updated?.phase).toBe('match_over');
    expect(updated?.score.winner).toBe(0);
    expect(updated?.score.games).toEqual([2, 1]);
    expect(updated?.stats[0].winners).toBe(3);
    expect(buf.sample(5100)?.phase).toBe('match_over');
  });

  it('stores sessionToken, resets seq on MATCH_START/FULL_SYNC, reconnects, and clears token on INVALID_TOKEN', () => {
    vi.useFakeTimers();
    const sockets: MockWebSocket[] = [];
    const storage = new MemoryStorage();
    const received: ServerMessage[] = [];

    const client = new WsClient(
      { onMessage: (m) => received.push(m) },
      {
        wsUrl: 'ws://127.0.0.1:3301/ws',
        storage,
        factory: () => {
          const s = new MockWebSocket();
          sockets.push(s);
          return s;
        },
      }
    );

    client.createRoom('clay', 'fast4', 'power');
    expect(sockets).toHaveLength(1);
    sockets[0].openNow();

    const cfg = {
      mode: 'online' as const,
      court: 'clay' as const,
      format: 'fast4' as const,
      archetypes: ['power', 'allcourt'] as ['power', 'allcourt'],
      seed: 42,
    };

    sockets[0].receive({
      type: 'ROOM_CREATED',
      payload: {
        roomCode: 'ABCD',
        sessionToken: 'tok_123',
        yourSide: 1,
        playerIndex: 0,
        matchConfig: cfg,
      },
    });
    expect(client.hasStoredSession()).toBe(true);

    const initSnap = createMatchState(cfg);
    sockets[0].receive({
      type: 'MATCH_START',
      payload: { serverTick: 0, yourSide: 1, playerIndex: 0, snapshot: initSnap },
    });
    expect(client.nextSeq()).toBe(1);
    expect(client.nextSeq()).toBe(2);

    // Simulate abnormal disconnect -> auto reconnect after 1200ms
    sockets[0].close();
    vi.advanceTimersByTime(1300);
    expect(sockets).toHaveLength(2);
    sockets[1].openNow();

    const reconnectPayload = JSON.parse(sockets[1].sent[0]);
    expect(reconnectPayload).toEqual({
      type: 'RECONNECT',
      payload: { roomCode: 'ABCD', sessionToken: 'tok_123' },
    });

    // FULL_SYNC resets inputSeq back to 0 so nextSeq() is 1
    sockets[1].receive({
      type: 'FULL_SYNC',
      payload: {
        roomCode: 'ABCD',
        yourSide: 1,
        playerIndex: 0,
        snapshot: initSnap,
        requireInputReset: true,
      },
    });
    expect(client.nextSeq()).toBe(1);

    // INVALID_TOKEN clears stored session
    sockets[1].receive({
      type: 'ERROR',
      payload: { code: 'INVALID_TOKEN', message: 'bad token' },
    });
    expect(client.hasStoredSession()).toBe(false);
    expect(received.some((m) => m.type === 'FULL_SYNC')).toBe(true);

    client.disconnect(true);
    vi.useRealTimers();
  });

  it('respects simulateDisconnect(4000) delay without async onclose overwriting it to 1200ms', () => {
    vi.useFakeTimers();
    const sockets: MockWebSocket[] = [];
    const storage = new MemoryStorage();

    const client = new WsClient(
      { onMessage: () => {} },
      {
        wsUrl: 'ws://127.0.0.1:3301/ws',
        storage,
        factory: () => {
          const s = new MockWebSocket();
          sockets.push(s);
          return s;
        },
      }
    );

    client.createRoom('hard', 'fast4', 'allcourt');
    sockets[0].openNow();
    sockets[0].receive({
      type: 'ROOM_CREATED',
      payload: {
        roomCode: 'WXYZ',
        sessionToken: 'tok_456',
        yourSide: 1,
        playerIndex: 0,
        matchConfig: {
          mode: 'online',
          court: 'hard',
          format: 'fast4',
          archetypes: ['allcourt', 'defender'],
          seed: 1,
        },
      },
    });

    client.simulateDisconnect(4000);

    // Async onclose fires at 5ms and must NOT reschedule at 1200ms
    vi.advanceTimersByTime(1500);
    expect(sockets).toHaveLength(1);

    // Still waiting before 4000ms
    vi.advanceTimersByTime(2400);
    expect(sockets).toHaveLength(1);

    // Reconnects at 4000ms
    vi.advanceTimersByTime(200);
    expect(sockets).toHaveLength(2);

    // simulateDisconnect(-1) stays disconnected permanently
    sockets[1].openNow();
    client.simulateDisconnect(-1);
    vi.advanceTimersByTime(20000);
    expect(sockets).toHaveLength(2);

    client.disconnect(true);
    vi.useRealTimers();
  });
});
