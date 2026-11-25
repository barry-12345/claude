import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { createCandyServer } from '../server/index.js';
import { ROOM_CODE_CHARS } from '../public/js/shared/constants.js';

function connectWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const queue = [];
    const waiters = [];

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString('utf8'));
      if (waiters.length > 0) {
        const idx = waiters.findIndex((w) => w.predicate(msg));
        if (idx !== -1) {
          const [waiter] = waiters.splice(idx, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(msg);
          return;
        }
      }
      queue.push(msg);
    });

    ws.waitFor = (predicate, timeoutMs = 4000) => {
      const qIdx = queue.findIndex(predicate);
      if (qIdx !== -1) {
        return Promise.resolve(queue.splice(qIdx, 1)[0]);
      }
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          const wIdx = waiters.findIndex((w) => w.resolve === res);
          if (wIdx !== -1) waiters.splice(wIdx, 1);
          rej(new Error(`Timeout waiting for WS message (${timeoutMs}ms)`));
        }, timeoutMs);
        waiters.push({ predicate, resolve: res, reject: rej, timer });
      });
    };

    ws.drainQueue = () => queue.splice(0, queue.length);

    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

test('AC-02 & AC-07: PvP room lifecycle, rematch, and strict WS anti-leak for express/feint', async () => {
  const srv = createCandyServer({ port: 0, allowTestHooks: true });
  const port = await srv.start();
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  const wsA = await connectWs(wsUrl);
  const wsB = await connectWs(wsUrl);

  try {
    wsA.send(JSON.stringify({ type: 'create_room', mode: 'pvp', nickname: '草莓小仙' }));
    const stateA1 = await wsA.waitFor((m) => m.type === 'room_state');
    assert.equal(stateA1.phase, 'LOBBY');
    assert.equal(stateA1.roomCode.length, 4);
    for (const ch of stateA1.roomCode) {
      assert.ok(ROOM_CODE_CHARS.includes(ch), `Unexpected char ${ch} in roomCode`);
    }

    wsB.send(JSON.stringify({ type: 'join_room', roomCode: stateA1.roomCode, nickname: '薄荷熊' }));
    const stateB1 = await wsB.waitFor((m) => m.type === 'room_state' && m.players.length === 2);
    assert.equal(stateB1.playerSlot, 1);

    wsA.send(JSON.stringify({ type: 'player_ready', ready: true }));
    wsB.send(JSON.stringify({ type: 'player_ready', ready: true }));

    const cdA = await wsA.waitFor((m) => m.type === 'room_state' && m.phase === 'COUNTDOWN');
    assert.equal(cdA.phase, 'COUNTDOWN');

    // Fast-forward countdown into PLAYING
    wsA.send(JSON.stringify({ type: 'test_command', action: 'fastForwardTicks', payload: { ticks: 1 } }));
    const snapA0 = await wsA.waitFor((m) => m.type === 'game_snapshot' && m.phase === 'PLAYING' && m.tick >= 1);
    const snapB0 = await wsB.waitFor((m) => m.type === 'game_snapshot' && m.phase === 'PLAYING' && m.tick >= 1);
    assert.equal(snapA0.tick, 1);
    assert.equal(snapB0.tick, 1);

    // Grant resources to A and send both real express & feint
    wsA.send(JSON.stringify({ type: 'test_command', action: 'grantResources', payload: { target: 'self', gold: 2000 } }));
    await wsA.waitFor((m) => m.type === 'test_command_result' && m.action === 'grantResources');

    wsB.drainQueue();
    wsA.send(JSON.stringify({ type: 'send_wave', sendType: 'express_party' }));
    wsA.send(JSON.stringify({ type: 'send_wave', sendType: 'express_feint' }));

    // Fast-forward 30 ticks (1.5s < 3.0s) and verify B's WS messages NEVER contain isFake or sendType
    wsA.send(JSON.stringify({ type: 'test_command', action: 'fastForwardTicks', payload: { ticks: 30 } }));
    await wsA.waitFor((m) => m.type === 'test_command_result' && m.action === 'fastForwardTicks');

    const bSnapMid = await wsB.waitFor(
      (m) => m.type === 'game_snapshot' && m.self.incomingAlerts.length === 2
    );
    const serialized = JSON.stringify(bSnapMid.self.incomingAlerts);
    assert.equal(serialized.includes('isFake'), false);
    assert.equal(serialized.includes('sendType'), false);
    assert.equal(serialized.includes('express_feint'), false);
    assert.equal(serialized.includes('express_party'), false);

    // Check any game_event received by B so far
    const bMsgs = wsB.drainQueue();
    for (const m of bMsgs) {
      if (m.type === 'game_event') {
        const s = JSON.stringify(m);
        assert.equal(s.includes('isFake'), false);
        assert.equal(s.includes('sendType'), false);
      }
    }

    // End game by reducing B hp to 0 via wave/hp grant + fast forward
    wsA.send(JSON.stringify({ type: 'test_command', action: 'grantResources', payload: { target: 'opponent', hp: 1 } }));
    await wsA.waitFor((m) => m.type === 'test_command_result' && m.action === 'grantResources');
    wsA.send(JSON.stringify({ type: 'test_command', action: 'jumpWave', payload: { waveNum: 15 } }));
    await wsA.waitFor((m) => m.type === 'test_command_result' && m.action === 'jumpWave');
    wsA.send(JSON.stringify({ type: 'test_command', action: 'fastForwardTicks', payload: { ticks: 800 } }));
    const endedSnap = await wsA.waitFor((m) => m.type === 'game_snapshot' && m.phase === 'ENDED');
    assert.ok(endedSnap.endedResult);

    // Rematch
    wsA.send(JSON.stringify({ type: 'rematch_request' }));
    wsB.send(JSON.stringify({ type: 'rematch_request' }));
    const rematchCd = await wsA.waitFor((m) => m.type === 'room_state' && m.phase === 'COUNTDOWN');
    assert.equal(rematchCd.phase, 'COUNTDOWN');
  } finally {
    wsA.close();
    wsB.close();
    await srv.stop();
  }
});

test('AC-01: Single-player AI mode (casual & clever) builds & sends without cheats', async () => {
  const srv = createCandyServer({ port: 0, allowTestHooks: true });
  const port = await srv.start();
  const ws = await connectWs(`ws://127.0.0.1:${port}/ws`);

  try {
    ws.send(JSON.stringify({ type: 'create_room', mode: 'ai', aiDifficulty: 'clever', nickname: '玩家1' }));
    const cd = await ws.waitFor((m) => m.type === 'room_state' && m.phase === 'COUNTDOWN');
    assert.equal(cd.players.length, 2);
    assert.equal(cd.players[1].isAI, true);

    ws.send(JSON.stringify({ type: 'test_command', action: 'fastForwardTicks', payload: { ticks: 500 } }));
    const snap = await ws.waitFor((m) => m.type === 'game_snapshot' && m.tick >= 500);
    assert.ok(snap.opponent.towers.length >= 2, 'Clever AI should build at least 2 towers');
    assert.ok(snap.opponent.eco > 25, 'Clever AI should increase Eco via sending creeps');
  } finally {
    ws.close();
    await srv.stop();
  }
});

test('AC-10: 20s Reconnect grace pauses simulation, restores full state, and awards timeout victory', async () => {
  const srv = createCandyServer({ port: 0, allowTestHooks: true });
  const port = await srv.start();
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  const wsA = await connectWs(wsUrl);
  let wsB = await connectWs(wsUrl);

  try {
    wsA.send(JSON.stringify({ type: 'create_room', mode: 'pvp', nickname: 'A' }));
    const stA = await wsA.waitFor((m) => m.type === 'room_state');
    wsB.send(JSON.stringify({ type: 'join_room', roomCode: stA.roomCode, nickname: 'B' }));
    const stB = await wsB.waitFor((m) => m.type === 'room_state' && m.players.length === 2);

    wsA.send(JSON.stringify({ type: 'player_ready', ready: true }));
    wsB.send(JSON.stringify({ type: 'player_ready', ready: true }));
    await wsA.waitFor((m) => m.type === 'room_state' && m.phase === 'COUNTDOWN');

    wsA.send(JSON.stringify({ type: 'test_command', action: 'fastForwardTicks', payload: { ticks: 10 } }));
    await wsA.waitFor((m) => m.type === 'game_snapshot' && m.tick === 10);

    // B places a tower
    wsB.send(JSON.stringify({ type: 'place_tower', towerType: 'strawberry', col: 3, row: 3 }));
    await wsB.waitFor((m) => m.type === 'game_snapshot' && m.self.towers.length === 1);

    // Disconnect B
    wsB.close();
    const pausedState = await wsA.waitFor((m) => m.type === 'room_state' && m.phase === 'PAUSED_RECONNECT');
    assert.equal(pausedState.phase, 'PAUSED_RECONNECT');

    // Reconnect B with reconnectToken
    wsB = await connectWs(wsUrl);
    wsB.send(
      JSON.stringify({
        type: 'join_room',
        roomCode: stA.roomCode,
        nickname: 'B',
        playerId: stB.playerId,
        reconnectToken: stB.reconnectToken
      })
    );
    const resumedState = await wsB.waitFor((m) => m.type === 'room_state' && m.phase === 'PLAYING');
    assert.equal(resumedState.playerSlot, 1);
    const resumedSnap = await wsB.waitFor((m) => m.type === 'game_snapshot' && m.phase === 'PLAYING');
    assert.equal(resumedSnap.self.towers.length, 1);

    // Now simulate disconnect timeout (remainMs = 250) -> A must win automatically
    wsA.send(
      JSON.stringify({
        type: 'test_command',
        action: 'simulateDisconnect',
        payload: { target: 'opponent', remainMs: 250 }
      })
    );
    const winState = await wsA.waitFor((m) => m.type === 'room_state' && m.phase === 'ENDED', 4000);
    assert.equal(winState.phase, 'ENDED');
    const winSnap = await wsA.waitFor((m) => m.type === 'game_snapshot' && m.phase === 'ENDED', 4000);
    assert.equal(winSnap.endedResult.winnerSlot, 0);
    assert.equal(winSnap.endedResult.reason, 'reconnect_timeout');
  } finally {
    wsA.close();
    wsB.close();
    await srv.stop();
  }
});

test('AC-11: Subpath reverse proxy (/candy-td/*) serves assets and upgrades WS', async () => {
  const backend = createCandyServer({ port: 0, allowTestHooks: false });
  const backendPort = await backend.start();

  // Local HTTP + WS reverse proxy stripping /candy-td prefix
  const proxyServer = http.createServer((req, res) => {
    const stripped = (req.url || '/').replace(/^\/candy-td/, '') || '/';
    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: backendPort,
        path: stripped,
        method: req.method,
        headers: req.headers
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    req.pipe(proxyReq);
  });

  const proxyWss = new WebSocketServer({ noServer: true });
  proxyServer.on('upgrade', (req, socket, head) => {
    if ((req.url || '').startsWith('/candy-td/ws')) {
      proxyWss.handleUpgrade(req, socket, head, (clientWs) => {
        const upWs = new WebSocket(`ws://127.0.0.1:${backendPort}/ws`);
        const pendingToUp = [];
        clientWs.on('message', (d) => {
          if (upWs.readyState === WebSocket.OPEN) {
            upWs.send(d);
          } else {
            pendingToUp.push(d);
          }
        });
        upWs.on('open', () => {
          while (pendingToUp.length > 0) {
            upWs.send(pendingToUp.shift());
          }
        });
        upWs.on('message', (d) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(d);
          }
        });
        clientWs.on('close', () => upWs.close());
        upWs.on('close', () => clientWs.close());
      });
    } else {
      socket.destroy();
    }
  });

  await new Promise((r) => proxyServer.listen(0, '127.0.0.1', r));
  const proxyPort = proxyServer.address().port;

  try {
    // 1. Check healthz and constants.js through /candy-td/
    const res1 = await fetch(`http://127.0.0.1:${proxyPort}/candy-td/js/shared/constants.js`);
    assert.equal(res1.status, 200);
    const body1 = await res1.text();
    assert.ok(body1.includes('CANVAS_WIDTH'));

    // 2. Check WS through /candy-td/ws
    const ws = await connectWs(`ws://127.0.0.1:${proxyPort}/candy-td/ws`);
    ws.send(JSON.stringify({ type: 'create_room', mode: 'pvp', nickname: '反代测试' }));
    const state = await ws.waitFor((m) => m.type === 'room_state');
    assert.equal(state.phase, 'LOBBY');
    ws.close();
  } finally {
    proxyWss.close();
    if (typeof proxyServer.closeAllConnections === 'function') {
      proxyServer.closeAllConnections();
    }
    await new Promise((r) => proxyServer.close(r));
    await backend.stop();
  }
});

test('AC-12 & AC-13: Production mode disables test_command & invalid payloads return safe action_error', async () => {
  const srv = createCandyServer({ port: 0, allowTestHooks: false });
  const port = await srv.start();
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  const ws1 = await connectWs(wsUrl);
  const ws2 = await connectWs(wsUrl);
  const ws3 = await connectWs(wsUrl);

  try {
    // Malformed JSON
    ws1.send('{bad-json');
    const errJson = await ws1.waitFor((m) => m.type === 'action_error');
    assert.equal(errJson.code, 'INVALID_JSON');

    // Test hook disabled in production
    ws1.send(JSON.stringify({ type: 'test_command', action: 'getSnapshot' }));
    const errHook = await ws1.waitFor((m) => m.type === 'action_error');
    assert.equal(errHook.code, 'TEST_HOOKS_DISABLED');

    // Join non-existent room
    ws1.send(JSON.stringify({ type: 'join_room', roomCode: 'ZZZZ', nickname: 'X' }));
    const errNotFound = await ws1.waitFor((m) => m.type === 'action_error');
    assert.equal(errNotFound.code, 'ROOM_NOT_FOUND');

    // Create room and fill 2/2, 3rd player gets ROOM_FULL
    ws1.send(JSON.stringify({ type: 'create_room', mode: 'pvp', nickname: 'Host' }));
    const st1 = await ws1.waitFor((m) => m.type === 'room_state');
    ws2.send(JSON.stringify({ type: 'join_room', roomCode: st1.roomCode, nickname: 'P2' }));
    await ws2.waitFor((m) => m.type === 'room_state' && m.players.length === 2);

    ws3.send(JSON.stringify({ type: 'join_room', roomCode: st1.roomCode, nickname: 'P3' }));
    const errFull = await ws3.waitFor((m) => m.type === 'action_error');
    assert.equal(errFull.code, 'ROOM_FULL');

    // Host leaves in LOBBY -> host transfers to P2
    ws1.close();
    const transferState = await ws2.waitFor((m) => m.type === 'room_state' && m.players.length === 1);
    assert.equal(transferState.hostSlot, 1);
  } finally {
    ws1.close();
    ws2.close();
    ws3.close();
    await srv.stop();
  }
});

test('Round-2 Regression: leave_room cleans LOBBY ghost, COUNTDOWN reconnect initializes sim, and AC-13 WS boundaries', async () => {
  const srv = createCandyServer({ port: 0, allowTestHooks: true });
  const port = await srv.start();
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  const wsA = await connectWs(wsUrl);
  let wsB = await connectWs(wsUrl);

  try {
    // 1. P1 creates PvP room, P2 joins, P1 sends leave_room -> P2 becomes host with 1 player
    wsA.send(JSON.stringify({ type: 'create_room', mode: 'pvp', nickname: 'HostA' }));
    const r1 = await wsA.waitFor((m) => m.type === 'room_state');
    wsB.send(JSON.stringify({ type: 'join_room', roomCode: r1.roomCode, nickname: 'GuestB' }));
    await wsB.waitFor((m) => m.type === 'room_state' && m.players.length === 2);

    wsA.drainQueue();
    wsA.send(JSON.stringify({ type: 'leave_room' }));
    const p2HostState = await wsB.waitFor((m) => m.type === 'room_state' && m.players.length === 1);
    assert.equal(p2HostState.hostSlot, 1);

    // P1 creates a brand new room -> P2 toggling ready in old room must NOT leak to P1
    wsA.send(JSON.stringify({ type: 'create_room', mode: 'pvp', nickname: 'HostA2' }));
    const r2 = await wsA.waitFor((m) => m.type === 'room_state');
    assert.notEqual(r2.roomCode, r1.roomCode);
    wsB.send(JSON.stringify({ type: 'player_ready', ready: true }));
    await new Promise((r) => setTimeout(r, 80));
    const leaked = wsA.drainQueue().filter((m) => m.type === 'room_state' && m.roomCode === r1.roomCode);
    assert.equal(leaked.length, 0);

    // 2. COUNTDOWN disconnect + reconnect must NOT leave sim === null
    wsB.send(JSON.stringify({ type: 'leave_room' }));
    wsB.send(JSON.stringify({ type: 'join_room', roomCode: r2.roomCode, nickname: 'GuestB2' }));
    const bJoin = await wsB.waitFor((m) => m.type === 'room_state' && m.roomCode === r2.roomCode && m.players.length === 2);
    wsA.send(JSON.stringify({ type: 'player_ready', ready: true }));
    wsB.send(JSON.stringify({ type: 'player_ready', ready: true }));
    await wsA.waitFor((m) => m.type === 'room_state' && m.phase === 'COUNTDOWN');

    // Disconnect B during COUNTDOWN
    wsB.close();
    await wsA.waitFor((m) => m.type === 'room_state' && m.phase === 'PAUSED_RECONNECT');

    // Reconnect B -> must resume COUNTDOWN and then transition into PLAYING with non-null sim
    wsB = await connectWs(wsUrl);
    wsB.send(
      JSON.stringify({
        type: 'join_room',
        roomCode: r2.roomCode,
        nickname: 'GuestB2',
        playerId: bJoin.playerId,
        reconnectToken: bJoin.reconnectToken
      })
    );
    await wsA.waitFor((m) => m.type === 'room_state' && m.phase === 'COUNTDOWN');
    wsA.send(JSON.stringify({ type: 'test_command', action: 'fastForwardTicks', payload: { ticks: 5 } }));
    const snapA = await wsA.waitFor((m) => m.type === 'game_snapshot' && m.phase === 'PLAYING' && m.tick >= 5);
    assert.ok(snapA.tick >= 5);

    // 3. AC-13 WS protocol boundaries: out-of-bounds cell, path cell, max level, cooldown spam
    wsA.send(JSON.stringify({ type: 'place_tower', towerType: 'strawberry', col: 99, row: 0 }));
    const errOob = await wsA.waitFor((m) => m.type === 'action_error');
    assert.equal(errOob.code, 'INVALID_CELL');

    wsA.send(JSON.stringify({ type: 'place_tower', towerType: 'strawberry', col: 0, row: 2 }));
    const errPath = await wsA.waitFor((m) => m.type === 'action_error');
    assert.equal(errPath.code, 'INVALID_CELL');

    wsA.send(JSON.stringify({ type: 'test_command', action: 'grantResources', payload: { target: 'self', gold: 2000 } }));
    await wsA.waitFor((m) => m.type === 'test_command_result' && m.action === 'grantResources');

    wsA.send(JSON.stringify({ type: 'place_tower', towerType: 'strawberry', col: 3, row: 3 }));
    const tSnap = await wsA.waitFor((m) => m.type === 'game_snapshot' && m.self.towers.length === 1);
    const tid = tSnap.self.towers[0].id;
    wsA.send(JSON.stringify({ type: 'upgrade_tower', towerId: tid }));
    wsA.send(JSON.stringify({ type: 'upgrade_tower', towerId: tid }));
    wsA.send(JSON.stringify({ type: 'upgrade_tower', towerId: tid }));
    const errMax = await wsA.waitFor((m) => m.type === 'action_error');
    assert.equal(errMax.code, 'MAX_LEVEL');

    // Cooldown spam on express_feint
    wsA.send(JSON.stringify({ type: 'send_wave', sendType: 'express_feint' }));
    wsA.send(JSON.stringify({ type: 'send_wave', sendType: 'express_feint' }));
    const errCd = await wsA.waitFor((m) => m.type === 'action_error');
    assert.equal(errCd.code, 'COOLDOWN_ACTIVE');
  } finally {
    wsA.close();
    wsB.close();
    await srv.stop();
  }
});
