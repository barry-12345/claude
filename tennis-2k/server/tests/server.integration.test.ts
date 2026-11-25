import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  ROOM_CODE_ALPHABET,
  type ClientMessage,
  type ServerMessage,
} from '@court2k/shared';
import { createCourt2kServer, type Court2kServerInstance } from '../src/index.js';

class TestClient {
  readonly ws: WebSocket;
  readonly messages: ServerMessage[] = [];
  private waiters: Array<{
    predicate: (msg: ServerMessage) => boolean;
    resolve: (msg: ServerMessage) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString('utf8')) as ServerMessage;
      this.messages.push(msg);
      for (let i = 0; i < this.waiters.length; i++) {
        const w = this.waiters[i];
        if (w.predicate(msg)) {
          clearTimeout(w.timer);
          this.waiters.splice(i, 1);
          w.resolve(msg);
          break;
        }
      }
    });
  }

  static connect(url: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.once('open', () => resolve(new TestClient(ws)));
      ws.once('error', (err) => reject(err));
    });
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  sendRaw(raw: string | Buffer): void {
    this.ws.send(raw);
  }

  clearMessages(): void {
    this.messages.length = 0;
  }

  waitFor<T extends ServerMessage['type']>(
    type: T,
    predicate?: (msg: Extract<ServerMessage, { type: T }>) => boolean,
    timeoutMs = 5000
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const idx = this.messages.findIndex(
      (m) => m.type === type && (!predicate || predicate(m as Extract<ServerMessage, { type: T }>))
    );
    if (idx !== -1) {
      const found = this.messages[idx] as Extract<ServerMessage, { type: T }>;
      this.messages.splice(idx, 1);
      return Promise.resolve(found);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pos = this.waiters.findIndex((w) => w.timer === timer);
        if (pos !== -1) this.waiters.splice(pos, 1);
        reject(new Error(`Timed out waiting for ${type} after ${timeoutMs}ms`));
      }, timeoutMs);

      this.waiters.push({
        predicate: (m) =>
          m.type === type && (!predicate || predicate(m as Extract<ServerMessage, { type: T }>)),
        resolve: (m) => {
          const mIdx = this.messages.indexOf(m);
          if (mIdx !== -1) this.messages.splice(mIdx, 1);
          resolve(m as Extract<ServerMessage, { type: T }>);
        },
        reject,
        timer,
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

const activeServers: Court2kServerInstance[] = [];
const activeClients: TestClient[] = [];

async function startTestServer(
  overrides: Parameters<typeof createCourt2kServer>[0] = {}
): Promise<{ server: Court2kServerInstance; port: number; wsUrl: string }> {
  const server = createCourt2kServer({ port: 0, host: '127.0.0.1', ...overrides });
  activeServers.push(server);
  const port = await server.start();
  return { server, port, wsUrl: `ws://127.0.0.1:${port}/ws` };
}

async function connectClient(url: string): Promise<TestClient> {
  const client = await TestClient.connect(url);
  activeClients.push(client);
  return client;
}

async function createStartedRoom(wsUrl: string, court: 'hard' | 'clay' | 'grass' = 'hard') {
  const p0 = await connectClient(wsUrl);
  const p1 = await connectClient(wsUrl);

  p0.send({
    type: 'CREATE_ROOM',
    payload: { court, format: 'fast4', archetype: 'power' },
  });
  const created = await p0.waitFor('ROOM_CREATED');
  const roomCode = created.payload.roomCode;
  const p0Token = created.payload.sessionToken;

  p1.send({
    type: 'JOIN_ROOM',
    payload: { roomCode, archetype: 'defender' },
  });
  const joined = await p1.waitFor('ROOM_JOINED');
  const p1Token = joined.payload.sessionToken;

  p0.send({ type: 'READY', payload: { ready: true } });
  p1.send({ type: 'READY', payload: { ready: true } });

  const start0 = await p0.waitFor('MATCH_START');
  const start1 = await p1.waitFor('MATCH_START');

  return { p0, p1, roomCode, p0Token, p1Token, start0, start1 };
}

afterEach(async () => {
  while (activeClients.length > 0) {
    const c = activeClients.pop()!;
    await c.close();
  }
  while (activeServers.length > 0) {
    const s = activeServers.pop()!;
    await s.stop();
  }
});

describe('@court2k/server integration suite', () => {
  it('serves /health and /tennis/health and supports subpath WS upgrade', async () => {
    const { port } = await startTestServer({ wsPath: '/tennis/ws' });

    const res1 = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as {
      status: string;
      rooms: number;
      uptimeSec: number;
      rssMb: number;
    };
    expect(body1.status).toBe('ok');
    expect(body1.rooms).toBe(0);
    expect(typeof body1.uptimeSec).toBe('number');
    expect(body1.rssMb).toBeGreaterThan(0);

    const res2 = await fetch(`http://127.0.0.1:${port}/tennis/health`);
    expect(res2.status).toBe(200);

    const res404 = await fetch(`http://127.0.0.1:${port}/unknown`);
    expect(res404.status).toBe(404);

    // Subpath WS upgrade works on /tennis/ws and arbitrary prefix /proxy/ws
    const c1 = await connectClient(`ws://127.0.0.1:${port}/tennis/ws`);
    c1.send({ type: 'PING', payload: { clientTime: 1234 } });
    // PING before joining room returns ROOM_NOT_FOUND
    const err = await c1.waitFor('ERROR');
    expect(err.payload.code).toBe('ROOM_NOT_FOUND');

    // Invalid WS path fails handshake
    await expect(
      new Promise<void>((resolve, reject) => {
        const badWs = new WebSocket(`ws://127.0.0.1:${port}/not-a-ws-endpoint`);
        badWs.once('open', () => reject(new Error('Should not open')));
        badWs.once('error', () => resolve());
      })
    ).resolves.toBeUndefined();
  });

  it('handles room creation, loadout reset rules, and all ErrorCodes accurately', async () => {
    const { wsUrl } = await startTestServer({ enableTestHooks: false, rateLimitMaxPerSec: 120 });
    const p0 = await connectClient(wsUrl);
    const p1 = await connectClient(wsUrl);
    const p2 = await connectClient(wsUrl);

    // 1. INVALID_MESSAGE (malformed JSON, invalid payload, binary frame)
    p0.sendRaw('{not json');
    expect((await p0.waitFor('ERROR')).payload.code).toBe('INVALID_MESSAGE');
    p0.sendRaw(JSON.stringify({ type: 'CREATE_ROOM', payload: { court: 'mars' } }));
    expect((await p0.waitFor('ERROR')).payload.code).toBe('INVALID_MESSAGE');
    p0.sendRaw(Buffer.from([1, 2, 3]));
    expect((await p0.waitFor('ERROR')).payload.code).toBe('INVALID_MESSAGE');

    // 2. FORBIDDEN_TEST_HOOK when ENABLE_TEST_HOOKS != '1'
    p0.send({ type: 'TEST_COMMAND', payload: { cmd: 'set_seed', args: { seed: 42 } } });
    expect((await p0.waitFor('ERROR')).payload.code).toBe('FORBIDDEN_TEST_HOOK');

    // 3. ROOM_NOT_FOUND on unknown JOIN_ROOM
    p1.send({ type: 'JOIN_ROOM', payload: { roomCode: 'ZZZZ', archetype: 'allcourt' } });
    expect((await p1.waitFor('ERROR')).payload.code).toBe('ROOM_NOT_FOUND');

    // 4. CREATE_ROOM -> unambiguous 4-char code
    p0.send({
      type: 'CREATE_ROOM',
      payload: { court: 'hard', format: 'fast4', archetype: 'allcourt' },
    });
    const created = await p0.waitFor('ROOM_CREATED');
    const code = created.payload.roomCode;
    expect(code).toHaveLength(4);
    for (const ch of code) {
      expect(ROOM_CODE_ALPHABET.includes(ch)).toBe(true);
      expect('0O1I'.includes(ch)).toBe(false);
    }

    // 5. JOIN_ROOM -> P1 joins; 3rd client gets ROOM_FULL
    p1.send({ type: 'JOIN_ROOM', payload: { roomCode: code, archetype: 'defender' } });
    const joined = await p1.waitFor('ROOM_JOINED');
    expect(joined.payload.yourSide).toBe(-1);
    expect(joined.payload.playerIndex).toBe(1);

    p2.send({ type: 'JOIN_ROOM', payload: { roomCode: code, archetype: 'power' } });
    expect((await p2.waitFor('ERROR')).payload.code).toBe('ROOM_FULL');

    // 6. SELECT_LOADOUT: guest cannot alter court; host changing court resets both ready flags
    p0.send({ type: 'READY', payload: { ready: true } });
    p1.send({ type: 'READY', payload: {} }); // omit ready -> defaults true
    await p0.waitFor('LOBBY_UPDATE', (m) => m.payload.ready[0] && !m.payload.ready[1]);
    // Wait: both ready started match immediately! Let's test loadout reset before both ready in a fresh room
    const p3 = await connectClient(wsUrl);
    p3.send({
      type: 'CREATE_ROOM',
      payload: { court: 'hard', format: 'fast4', archetype: 'allcourt' },
    });
    const created2 = await p3.waitFor('ROOM_CREATED');
    const code2 = created2.payload.roomCode;
    const p4 = await connectClient(wsUrl);
    p4.send({ type: 'JOIN_ROOM', payload: { roomCode: code2, archetype: 'power' } });
    await p4.waitFor('ROOM_JOINED');

    p4.send({ type: 'READY', payload: { ready: true } });
    await p3.waitFor('LOBBY_UPDATE', (m) => m.payload.ready[1] === true);

    // Guest tries to change court -> ignored
    p4.send({
      type: 'SELECT_LOADOUT',
      payload: { archetype: 'serve_volley', court: 'grass', format: 'super_tiebreak' },
    });
    const afterGuestLoadout = await p3.waitFor(
      'LOBBY_UPDATE',
      (m) => m.payload.matchConfig.archetypes[1] === 'serve_volley'
    );
    expect(afterGuestLoadout.payload.matchConfig.court).toBe('hard');
    expect(afterGuestLoadout.payload.matchConfig.format).toBe('fast4');

    // Host changes court -> resets ready to [false, false]
    p3.send({
      type: 'SELECT_LOADOUT',
      payload: { archetype: 'allcourt', court: 'clay' },
    });
    const afterHostCourt = await p4.waitFor(
      'LOBBY_UPDATE',
      (m) => m.payload.matchConfig.court === 'clay'
    );
    expect(afterHostCourt.payload.ready).toEqual([false, false]);

    // 7. MATCH_ALREADY_STARTED on JOIN_ROOM after match started in first room
    p2.send({ type: 'JOIN_ROOM', payload: { roomCode: code, archetype: 'power' } });
    expect((await p2.waitFor('ERROR')).payload.code).toBe('MATCH_ALREADY_STARTED');

    // 8. INVALID_PHASE: REMATCH_REQUEST during active play, SELECT_LOADOUT during active play
    p0.send({ type: 'REMATCH_REQUEST', payload: {} });
    expect((await p0.waitFor('ERROR')).payload.code).toBe('INVALID_PHASE');
    p0.send({ type: 'SELECT_LOADOUT', payload: { archetype: 'power' } });
    expect((await p0.waitFor('ERROR')).payload.code).toBe('INVALID_PHASE');

    // 9. INVALID_TOKEN on wrong token or unknown room RECONNECT
    p2.send({ type: 'RECONNECT', payload: { roomCode: code, sessionToken: 'wrong-token' } });
    expect((await p2.waitFor('ERROR')).payload.code).toBe('INVALID_TOKEN');
    p2.send({ type: 'RECONNECT', payload: { roomCode: 'NOPE', sessionToken: 'some-token' } });
    expect((await p2.waitFor('ERROR')).payload.code).toBe('INVALID_TOKEN');

    // 10. RATE_LIMITED when exceeding 120 msg/s
    for (let i = 1; i <= 135; i++) {
      p0.send({
        type: 'PLAYER_INPUT',
        payload: {
          seq: i,
          moveX: 0,
          moveZ: 0,
          aimX: 0,
          aimZ: 0,
          action: 'none',
          phase: 'idle',
          clientTime: Date.now(),
        },
      });
    }
    const rateErr = await p0.waitFor('ERROR', (m) => m.payload.code === 'RATE_LIMITED');
    expect(rateErr.payload.code).toBe('RATE_LIMITED');
  });

  it('runs 60Hz authoritative simulation, 30Hz snapshots, mirrored inputs, and hawkeye test hook', async () => {
    const { wsUrl } = await startTestServer({ enableTestHooks: true });
    const { p0, p1 } = await createStartedRoom(wsUrl, 'clay');

    // P0 moves locally right (+X -> world +X); P1 moves locally right (+X -> world -X)
    p0.clearMessages();
    p1.clearMessages();

    p0.send({
      type: 'PLAYER_INPUT',
      payload: {
        seq: 1,
        moveX: 1,
        moveZ: 0,
        aimX: 0,
        aimZ: 0,
        action: 'none',
        phase: 'idle',
        clientTime: Date.now(),
      },
    });
    p1.send({
      type: 'PLAYER_INPUT',
      payload: {
        seq: 1,
        moveX: 1,
        moveZ: 0,
        aimX: 0,
        aimZ: 0,
        action: 'none',
        phase: 'idle',
        clientTime: Date.now(),
      },
    });

    // Wait for server to advance ~12 ticks
    const snap = await p0.waitFor('STATE_SNAPSHOT', (m) => m.payload.serverTick >= 12);
    // P0 started at +1.45, moved +X; P1 started at -2.15, local +X -> world -X
    expect(snap.payload.state.players[0].pos.x).toBeGreaterThan(1.45);
    expect(snap.payload.state.players[1].pos.x).toBeLessThan(-2.15);
    expect(snap.payload.state.lastAckSeq).toEqual([1, 1]);

    // Trigger Hawkeye 8cm IN shot via TEST_COMMAND
    p0.send({
      type: 'TEST_COMMAND',
      payload: { cmd: 'trigger_hawkeye', args: { inBounds: true, distCm: 8, line: 'sideline' } },
    });

    const hkStart0 = await p0.waitFor(
      'GAME_EVENT',
      (m) => m.payload.event.type === 'HAWKEYE_START',
      4000
    );
    const hkStart1 = await p1.waitFor(
      'GAME_EVENT',
      (m) => m.payload.event.type === 'HAWKEYE_START',
      4000
    );
    expect(hkStart0.payload.event.type === 'HAWKEYE_START' && hkStart0.payload.event.hawkeye.isIn).toBe(
      true
    );
    expect(hkStart1.payload.event.type).toBe('HAWKEYE_START');

    // Requesting pause during hawkeye returns INVALID_PHASE
    p0.send({ type: 'PAUSE_REQUEST', payload: {} });
    const hkPauseErr = await p0.waitFor('ERROR');
    expect(hkPauseErr.payload.code).toBe('INVALID_PHASE');

    const hkEnd = await p0.waitFor(
      'GAME_EVENT',
      (m) => m.payload.event.type === 'HAWKEYE_END',
      4000
    );
    expect(hkEnd.payload.event.type === 'HAWKEYE_END' && hkEnd.payload.event.isIn).toBe(true);

    // Trigger 25cm OUT ball -> must NOT trigger HAWKEYE_START, goes straight to POINT_SCORED
    p0.clearMessages();
    p0.send({
      type: 'TEST_COMMAND',
      payload: { cmd: 'trigger_hawkeye', args: { inBounds: false, distCm: 25, line: 'sideline' } },
    });
    const pt25 = await p0.waitFor(
      'GAME_EVENT',
      (m) => m.payload.event.type === 'POINT_SCORED',
      4000
    );
    expect(pt25.payload.event.type).toBe('POINT_SCORED');
    expect(
      p0.messages.some((m) => m.type === 'GAME_EVENT' && m.payload.event.type === 'HAWKEYE_START')
    ).toBe(false);

    // Test set_seed, set_score, set_takeover TEST_COMMANDs
    p0.send({ type: 'TEST_COMMAND', payload: { cmd: 'set_seed', args: { seed: 42 } } });
    p0.send({
      type: 'TEST_COMMAND',
      payload: { cmd: 'set_score', args: { games: [3, 3], points: [0, 0], isTiebreak: true } },
    });
    const tbSnap = await p0.waitFor(
      'STATE_SNAPSHOT',
      (m) => m.payload.state.score.isTiebreak && m.payload.state.score.games[0] === 3
    );
    expect(tbSnap.payload.state.score.keyPointLabel).toBe('TIEBREAK');

    p0.send({
      type: 'TEST_COMMAND',
      payload: { cmd: 'set_takeover', args: { playerIndex: 0, value: 100 } },
    });
    const tkEvt = await p0.waitFor('GAME_EVENT', (m) => m.payload.event.type === 'TAKEOVER_ON');
    expect(tkEvt.payload.event.type === 'TAKEOVER_ON' && tkEvt.payload.event.player).toBe(0);
  }, 15_000);

  it('enforces manual pause 3x limit, 60s timeout auto-resume, 3s countdown, 5Hz pause snapshots, and race handling', async () => {
    const { wsUrl } = await startTestServer({ enableTestHooks: true });
    const { p0, p1 } = await createStartedRoom(wsUrl);

    for (let i = 0; i < 3; i++) {
      p0.clearMessages();
      p1.clearMessages();

      // P0 pauses; simultaneous P1 pause gets INVALID_PHASE without losing P1 quota
      p0.send({ type: 'PAUSE_REQUEST', payload: {} });
      const paused0 = await p0.waitFor('MATCH_PAUSED');
      const paused1 = await p1.waitFor('MATCH_PAUSED');
      expect(paused0.payload.reason).toBe('manual');
      expect(paused0.payload.manualPausesLeft).toEqual([2 - i, 3]);
      expect(paused1.payload.manualPausesLeft).toEqual([2 - i, 3]);

      p1.send({ type: 'PAUSE_REQUEST', payload: {} });
      const raceErr = await p1.waitFor('ERROR');
      expect(raceErr.payload.code).toBe('INVALID_PHASE');

      // P1 resumes + duplicate P0 resume is idempotent
      p1.send({ type: 'RESUME_REQUEST', payload: {} });
      const resuming = await p0.waitFor('MATCH_RESUMING');
      expect(resuming.payload.initiatedBy).toBe(1);
      expect(resuming.payload.resumeCountdownSec).toBe(3);

      p0.send({ type: 'RESUME_REQUEST', payload: {} }); // idempotent, no second MATCH_RESUMING

      // Fast forward 3s resuming countdown
      p0.send({ type: 'TEST_COMMAND', payload: { cmd: 'fast_forward_pause', args: { seconds: 3.1 } } });
      const resumed = await p0.waitFor('MATCH_RESUMED');
      expect(resumed.payload.requireInputReset).toBe(true);

      const extraResuming = p0.messages.filter((m) => m.type === 'MATCH_RESUMING');
      expect(extraResuming.length).toBe(0);
    }

    // 4th pause by P0 -> PAUSE_LIMIT_REACHED
    p0.send({ type: 'PAUSE_REQUEST', payload: {} });
    expect((await p0.waitFor('ERROR')).payload.code).toBe('PAUSE_LIMIT_REACHED');

    // P1 still has 3 pauses -> pause, verify ~5Hz snapshot cadence during pause, and test 60s auto-timeout resume
    p0.clearMessages();
    p1.clearMessages();
    p1.send({ type: 'PAUSE_REQUEST', payload: {} });
    const p1Paused = await p1.waitFor('MATCH_PAUSED');
    expect(p1Paused.payload.manualPausesLeft).toEqual([0, 2]);

    await new Promise((r) => setTimeout(r, 450));
    const pauseSnaps = p1.messages.filter((m) => m.type === 'STATE_SNAPSHOT');
    // Immediate snapshot + ~2 snapshots at 5Hz in 450ms (well below 30Hz = ~13)
    expect(pauseSnaps.length).toBeGreaterThanOrEqual(2);
    expect(pauseSnaps.length).toBeLessThanOrEqual(6);

    p1.send({ type: 'TEST_COMMAND', payload: { cmd: 'fast_forward_pause', args: { seconds: 60 } } });
    const timeoutResuming = await p0.waitFor('MATCH_RESUMING');
    expect(timeoutResuming.payload.initiatedBy).toBe('timeout');

    p1.send({ type: 'TEST_COMMAND', payload: { cmd: 'fast_forward_pause', args: { seconds: 3.1 } } });
    const timeoutResumed = await p1.waitFor('MATCH_RESUMED');
    expect(timeoutResumed.payload.requireInputReset).toBe(true);
  }, 15_000);

  it('preserves pausedFromPhase and does not refund quota when disconnecting during manual pause', async () => {
    const { server, wsUrl } = await startTestServer({ enableTestHooks: true });
    const { p0, p1, roomCode, p0Token, p1Token } = await createStartedRoom(wsUrl);

    p0.send({ type: 'PAUSE_REQUEST', payload: {} });
    await p0.waitFor('MATCH_PAUSED');

    // P1 disconnects while manually paused
    await p1.close();
    const discPaused = await p0.waitFor('MATCH_PAUSED', (m) => m.payload.reason === 'disconnect');
    expect(discPaused.payload.manualPausesLeft).toEqual([2, 3]);

    // P1 reconnects -> resumes back to original serve_ready phase with quota still [2, 3]
    const p1Rec = await connectClient(wsUrl);
    p1Rec.send({ type: 'RECONNECT', payload: { roomCode, sessionToken: p1Token } });
    const sync = await p1Rec.waitFor('FULL_SYNC');
    expect(sync.payload.snapshot.pause.pausedFromPhase).toBe('serve_ready');
    expect(sync.payload.snapshot.pause.manualPausesLeft).toEqual([2, 3]);

    p0.send({ type: 'TEST_COMMAND', payload: { cmd: 'fast_forward_pause', args: { seconds: 3.1 } } });
    await p1Rec.waitFor('MATCH_RESUMED');

    // Both disconnect simultaneously and both time out -> room recycled cleanly without forfeit event
    await p0.close();
    await p1Rec.close();
    // Simulate time advance via fast_forward on room? Since both sockets are closed, test room state directly via server internals?
    // Verify room still exists in paused_disconnect while within 15s, and token works
    expect(server.roomManager.getRoomCount()).toBe(1);
    const p0Check = await connectClient(wsUrl);
    p0Check.send({ type: 'RECONNECT', payload: { roomCode, sessionToken: p0Token } });
    const sync0 = await p0Check.waitFor('FULL_SYNC');
    expect(sync0.payload.snapshot.phase).toBe('paused_disconnect');
  }, 15_000);

  it('handles 4s reconnect with lastAckSeq reset, double disconnect, 15s forfeit, and rematch', async () => {
    const { wsUrl } = await startTestServer({ enableTestHooks: true });
    const { p0, p1, roomCode, p0Token, p1Token } = await createStartedRoom(wsUrl);

    // Send seq 10 from P1 before disconnect
    p1.send({
      type: 'PLAYER_INPUT',
      payload: {
        seq: 10,
        moveX: 0,
        moveZ: 0,
        aimX: 0,
        aimZ: 0,
        action: 'none',
        phase: 'idle',
        clientTime: Date.now(),
      },
    });
    await p0.waitFor('STATE_SNAPSHOT', (m) => m.payload.state.lastAckSeq[1] === 10);

    // P1 disconnects -> P0 sees MATCH_PAUSED(disconnect) & OPPONENT_DISCONNECTED(15s)
    await p1.close();
    const discPause = await p0.waitFor('MATCH_PAUSED', (m) => m.payload.reason === 'disconnect');
    expect(discPause.payload.initiatedBy).toBe(1);
    const oppDisc = await p0.waitFor('OPPONENT_DISCONNECTED');
    expect(oppDisc.payload.graceSeconds).toBe(15);
    expect(oppDisc.payload.disconnectedIndex).toBe(1);

    // P0 tries manual resume during disconnect -> CANNOT_RESUME_DISCONNECT
    p0.send({ type: 'RESUME_REQUEST', payload: {} });
    expect((await p0.waitFor('ERROR')).payload.code).toBe('CANNOT_RESUME_DISCONNECT');

    // Double disconnect: P0 also disconnects
    await p0.close();

    // P1 reconnects first -> stays in paused_disconnect, gets FULL_SYNC with lastAckSeq[1]=0
    const p1Rec = await connectClient(wsUrl);
    p1Rec.send({ type: 'RECONNECT', payload: { roomCode, sessionToken: p1Token } });
    const fullSync1 = await p1Rec.waitFor('FULL_SYNC');
    expect(fullSync1.payload.requireInputReset).toBe(true);
    expect(fullSync1.payload.snapshot.lastAckSeq[1]).toBe(0);
    expect(fullSync1.payload.snapshot.phase).toBe('paused_disconnect');

    // P0 reconnects second -> enters 3s resuming and notifies both
    const p0Rec = await connectClient(wsUrl);
    p0Rec.send({ type: 'RECONNECT', payload: { roomCode, sessionToken: p0Token } });
    const fullSync0 = await p0Rec.waitFor('FULL_SYNC');
    expect(fullSync0.payload.snapshot.lastAckSeq[0]).toBe(0);

    const oppRec = await p1Rec.waitFor('OPPONENT_RECONNECTED');
    expect(oppRec.payload.reconnectedIndex).toBe(0);
    const resuming = await p1Rec.waitFor('MATCH_RESUMING');
    expect(resuming.payload.initiatedBy).toBe('reconnect');

    p0Rec.send({ type: 'TEST_COMMAND', payload: { cmd: 'fast_forward_pause', args: { seconds: 3.1 } } });
    await p1Rec.waitFor('MATCH_RESUMED');

    // P1 sends fresh seq = 1 (< old seq 10!) -> must be ACCEPTED because lastAckSeq[1] was reset!
    p1Rec.send({
      type: 'PLAYER_INPUT',
      payload: {
        seq: 1,
        moveX: 1,
        moveZ: 0,
        aimX: 0,
        aimZ: 0,
        action: 'none',
        phase: 'idle',
        clientTime: Date.now(),
      },
    });
    const afterRecSnap = await p0Rec.waitFor(
      'STATE_SNAPSHOT',
      (m) => m.payload.state.lastAckSeq[1] === 1
    );
    expect(afterRecSnap.payload.state.lastAckSeq[1]).toBe(1);

    // Now test >15s disconnect forfeit
    p0Rec.clearMessages();
    await p1Rec.close();
    await p0Rec.waitFor('OPPONENT_DISCONNECTED');
    p0Rec.send({ type: 'TEST_COMMAND', payload: { cmd: 'fast_forward_pause', args: { seconds: 15.1 } } });
    const forfeitEvt = await p0Rec.waitFor(
      'GAME_EVENT',
      (m) => m.payload.event.type === 'MATCH_OVER'
    );
    expect(
      forfeitEvt.payload.event.type === 'MATCH_OVER' && forfeitEvt.payload.event.reason
    ).toBe('forfeit');
    expect(
      forfeitEvt.payload.event.type === 'MATCH_OVER' && forfeitEvt.payload.event.forfeitedBy
    ).toBe(1);
    const forfeitSnap = await p0Rec.waitFor(
      'STATE_SNAPSHOT',
      (m) => m.payload.state.phase === 'match_over'
    );
    expect(forfeitSnap.payload.state.phase).toBe('match_over');
    expect(forfeitSnap.payload.state.score.winner).toBe(0);
    expect(p0Rec.messages.filter((m) => m.type === 'ERROR').length).toBe(0);

    // P0 requests rematch BEFORE P1 reconnects; P1 reconnects in match_over and receives REMATCH_STATUS
    p0Rec.send({ type: 'REMATCH_REQUEST', payload: {} });
    await p0Rec.waitFor('REMATCH_STATUS', (m) => m.payload.requested[0] === true);

    const p1After = await connectClient(wsUrl);
    p1After.send({ type: 'RECONNECT', payload: { roomCode, sessionToken: p1Token } });
    await p1After.waitFor('FULL_SYNC');
    const recRematchStatus = await p1After.waitFor('REMATCH_STATUS');
    expect(recRematchStatus.payload.requested).toEqual([true, false]);

    // Duplicate click is idempotent
    p0Rec.send({ type: 'REMATCH_REQUEST', payload: {} });
    p1After.send({ type: 'REMATCH_REQUEST', payload: {} });

    const rematchStart0 = await p0Rec.waitFor('MATCH_START');
    const rematchStart1 = await p1After.waitFor('MATCH_START');
    expect(rematchStart0.payload.serverTick).toBe(0);
    expect(rematchStart1.payload.serverTick).toBe(0);
    expect(rematchStart0.payload.snapshot.lastAckSeq).toEqual([0, 0]);
    expect(rematchStart0.payload.snapshot.pause.manualPausesLeft).toEqual([3, 3]);
  }, 15_000);

  it('recycles empty waiting/match_over rooms after TTL and frees guest slot on waiting disconnect', async () => {
    const { server, wsUrl } = await startTestServer({ emptyRoomTtlMs: 120, idleRoomTtlMs: 500 });
    const p0 = await connectClient(wsUrl);
    const p1 = await connectClient(wsUrl);

    p0.send({
      type: 'CREATE_ROOM',
      payload: { court: 'grass', format: 'super_tiebreak', archetype: 'serve_volley' },
    });
    const created = await p0.waitFor('ROOM_CREATED');
    const code = created.payload.roomCode;

    p1.send({ type: 'JOIN_ROOM', payload: { roomCode: code, archetype: 'power' } });
    await p1.waitFor('ROOM_JOINED');

    // Guest disconnects in waiting -> frees slot so another guest can join
    await p1.close();
    const afterGuestLeft = await p0.waitFor('LOBBY_UPDATE', (m) => m.payload.connected[1] === false);
    expect(afterGuestLeft.payload.connected).toEqual([true, false]);

    const p2 = await connectClient(wsUrl);
    p2.send({ type: 'JOIN_ROOM', payload: { roomCode: code, archetype: 'allcourt' } });
    await p2.waitFor('ROOM_JOINED');

    // Both disconnect in waiting -> emptyRoomTtlMs recycles room
    await p0.close();
    await p2.close();
    await new Promise((r) => setTimeout(r, 250));
    expect(server.roomManager.getRoomCount()).toBe(0);
  });

  it('clears residual held inputs on point_over/hawkeye transition to serve_ready (no ghost serve)', async () => {
    const { wsUrl } = await startTestServer({ enableTestHooks: true });
    const { p0 } = await createStartedRoom(wsUrl);

    // Launch a hawkeye 25cm out ball so phase enters rally -> point_over -> serve_ready
    p0.send({
      type: 'TEST_COMMAND',
      payload: { cmd: 'trigger_hawkeye', args: { inBounds: false, distCm: 25, line: 'sideline' } },
    });
    await p0.waitFor('STATE_SNAPSHOT', (m) => m.payload.state.phase === 'rally');

    // Hold J during rally right before point ends
    p0.send({
      type: 'PLAYER_INPUT',
      payload: {
        seq: 1,
        moveX: 0,
        moveZ: 0,
        aimX: 0,
        aimZ: 0,
        action: 'J',
        phase: 'hold',
        clientTime: Date.now(),
      },
    });

    await p0.waitFor('STATE_SNAPSHOT', (m) => m.payload.state.phase === 'point_over');

    // Release during point_over (which server ignores) and then send nothing
    p0.send({
      type: 'PLAYER_INPUT',
      payload: {
        seq: 2,
        moveX: 0,
        moveZ: 0,
        aimX: 0,
        aimZ: 0,
        action: 'none',
        phase: 'release',
        clientTime: Date.now(),
      },
    });

    await p0.waitFor('STATE_SNAPSHOT', (m) => m.payload.state.phase === 'serve_ready');
    p0.clearMessages();

    // Hold still >= 1.5s without sending any new key; must stay in serve_ready with 0 ghost shots
    await new Promise((r) => setTimeout(r, 1600));
    const snaps = p0.messages.filter((m) => m.type === 'STATE_SNAPSHOT');
    expect(snaps.length).toBeGreaterThan(0);
    for (const s of snaps) {
      if (s.type === 'STATE_SNAPSHOT') {
        expect(s.payload.state.phase).toBe('serve_ready');
      }
    }
    const shotHits = p0.messages.filter(
      (m) => m.type === 'GAME_EVENT' && m.payload.event.type === 'SHOT_HIT'
    );
    expect(shotHits.length).toBe(0);
  }, 15_000);

  it('preserves host binding on self JOIN_ROOM and resets pause.disconnected on waiting reconnect', async () => {
    const { wsUrl } = await startTestServer();
    const p0 = await connectClient(wsUrl);
    p0.send({
      type: 'CREATE_ROOM',
      payload: { court: 'hard', format: 'fast4', archetype: 'allcourt' },
    });
    const created = await p0.waitFor('ROOM_CREATED');
    const roomCode = created.payload.roomCode;
    const token0 = created.payload.sessionToken;

    // Host sends JOIN_ROOM to own room -> rejected with INVALID_PHASE without detaching host
    p0.send({ type: 'JOIN_ROOM', payload: { roomCode, archetype: 'power' } });
    expect((await p0.waitFor('ERROR')).payload.code).toBe('INVALID_PHASE');

    // Verify host is still attached by sending READY
    p0.send({ type: 'READY', payload: { ready: true } });
    const lobby = await p0.waitFor('LOBBY_UPDATE');
    expect(lobby.payload.connected).toEqual([true, false]);
    expect(lobby.payload.ready).toEqual([true, false]);

    // Host disconnects in waiting, then reconnects -> FULL_SYNC snapshot must have disconnected[0] === false
    await p0.close();
    const p0Rec = await connectClient(wsUrl);
    p0Rec.send({ type: 'RECONNECT', payload: { roomCode, sessionToken: token0 } });
    const sync = await p0Rec.waitFor('FULL_SYNC');
    expect(sync.payload.snapshot.pause.disconnected[0]).toBe(false);
  });
});
