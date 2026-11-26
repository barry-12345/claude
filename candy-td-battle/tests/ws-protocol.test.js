import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { createCandyServer } from '../server/index.js';
import { MAP_ORDER, ROOM_CODE_CHARS } from '../public/js/shared/constants.js';
import { NetClient } from '../public/js/net-client.js';
import { CandyAudio } from '../public/js/audio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

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

test('AC-02 & AC-04: PvP map selection, demolish obstacle, Lv3 branch, 2A express alerts, and rematch', async () => {
  const srv = createCandyServer({ port: 0, allowTestHooks: true });
  const port = await srv.start();
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  const wsA = await connectWs(wsUrl);
  const wsB = await connectWs(wsUrl);

  try {
    wsA.send(JSON.stringify({ type: 'create_room', mode: 'pvp', nickname: '草莓小仙', mapId: 'classic_s' }));
    const stateA1 = await wsA.waitFor((m) => m.type === 'room_state');
    assert.equal(stateA1.phase, 'LOBBY');
    assert.equal(stateA1.mapSelection, 'classic_s');
    assert.equal(stateA1.roomCode.length, 4);
    for (const ch of stateA1.roomCode) {
      assert.ok(ROOM_CODE_CHARS.includes(ch), `Unexpected char ${ch} in roomCode`);
    }

    wsB.send(JSON.stringify({ type: 'join_room', roomCode: stateA1.roomCode, nickname: '薄荷熊' }));
    const stateB1 = await wsB.waitFor((m) => m.type === 'room_state' && m.players.length === 2);
    assert.equal(stateB1.playerSlot, 1);
    assert.equal(stateB1.mapSelection, 'classic_s');

    // Non-host select_map must fail with NOT_HOST
    wsB.send(JSON.stringify({ type: 'select_map', mapId: 'crown_peaks' }));
    const errNotHost = await wsB.waitFor((m) => m.type === 'action_error');
    assert.equal(errNotHost.code, 'NOT_HOST');

    // Host switches map to crown_peaks -> B syncs
    wsA.send(JSON.stringify({ type: 'select_map', mapId: 'crown_peaks' }));
    const syncB = await wsB.waitFor((m) => m.type === 'room_state' && m.mapSelection === 'crown_peaks');
    assert.equal(syncB.mapSelection, 'crown_peaks');

    wsA.send(JSON.stringify({ type: 'player_ready', ready: true }));
    wsB.send(JSON.stringify({ type: 'player_ready', ready: true }));

    const cdA = await wsA.waitFor((m) => m.type === 'room_state' && m.phase === 'COUNTDOWN');
    assert.equal(cdA.resolvedMapId, 'crown_peaks');

    // Fast-forward countdown into PLAYING
    wsA.send(JSON.stringify({ type: 'test_command', action: 'fastForwardTicks', payload: { ticks: 1 } }));
    const snapA0 = await wsA.waitFor((m) => m.type === 'game_snapshot' && m.phase === 'PLAYING' && m.tick >= 1);
    const snapB0 = await wsB.waitFor((m) => m.type === 'game_snapshot' && m.phase === 'PLAYING' && m.tick >= 1);
    assert.equal(snapA0.mapId, 'crown_peaks');
    assert.equal(snapB0.mapId, 'crown_peaks');

    // Grant resources to A, demolish obstacle [9,4] (crown_peaks range buff), place tower, upgrade Lv2->Lv3 branch A
    wsA.send(JSON.stringify({ type: 'test_command', action: 'grantResources', payload: { target: 'self', gold: 2000 } }));
    await wsA.waitFor((m) => m.type === 'test_command_result' && m.action === 'grantResources');

    wsA.send(JSON.stringify({ type: 'demolish_obstacle', col: 9, row: 4 }));
    const snapDem = await wsA.waitFor((m) => m.type === 'game_snapshot' && m.self.clearedObstacles.includes('9,4'));
    assert.equal(snapDem.opponent.clearedObstacles.length, 0);

    wsA.send(JSON.stringify({ type: 'place_tower', towerType: 'strawberry', col: 9, row: 4 }));
    const snapPlace = await wsA.waitFor((m) => m.type === 'game_snapshot' && m.self.towers.length === 1);
    const tid = snapPlace.self.towers[0].id;
    assert.equal(snapPlace.self.towers[0].buffTile, 'range');

    wsA.send(JSON.stringify({ type: 'upgrade_tower', towerId: tid }));
    await wsA.waitFor((m) => m.type === 'game_snapshot' && m.self.towers[0]?.level === 2);

    // Lv2 -> Lv3 without branch rejected
    wsA.send(JSON.stringify({ type: 'upgrade_tower', towerId: tid }));
    const errBranch = await wsA.waitFor((m) => m.type === 'action_error');
    assert.equal(errBranch.code, 'INVALID_BRANCH');

    wsA.send(JSON.stringify({ type: 'upgrade_tower', towerId: tid, branch: 'A' }));
    const snapLv3 = await wsA.waitFor((m) => m.type === 'game_snapshot' && m.self.towers[0]?.level === 3);
    assert.equal(snapLv3.self.towers[0].branch, 'A');

    // Send 2A express_healer & express_titan -> B must receive sendType for icon alert
    wsB.drainQueue();
    wsA.send(JSON.stringify({ type: 'send_wave', sendType: 'express_healer' }));
    wsA.send(JSON.stringify({ type: 'send_wave', sendType: 'express_titan' }));
    wsA.send(JSON.stringify({ type: 'test_command', action: 'fastForwardTicks', payload: { ticks: 20 } }));
    await wsA.waitFor((m) => m.type === 'test_command_result' && m.action === 'fastForwardTicks');

    const bSnapMid = await wsB.waitFor(
      (m) => m.type === 'game_snapshot' && m.self.incomingAlerts.length === 2
    );
    assert.equal(bSnapMid.self.incomingAlerts[0].sendType, 'express_healer');
    assert.equal(bSnapMid.self.incomingAlerts[1].sendType, 'express_titan');
    assert.equal(JSON.stringify(bSnapMid).includes('isFake'), false);

    // End game and rematch
    wsA.send(JSON.stringify({ type: 'test_command', action: 'grantResources', payload: { target: 'opponent', hp: 1 } }));
    await wsA.waitFor((m) => m.type === 'test_command_result' && m.action === 'grantResources');
    wsA.send(JSON.stringify({ type: 'test_command', action: 'jumpWave', payload: { waveNum: 15 } }));
    await wsA.waitFor((m) => m.type === 'test_command_result' && m.action === 'jumpWave');
    wsA.send(JSON.stringify({ type: 'test_command', action: 'fastForwardTicks', payload: { ticks: 900 } }));
    const endedSnap = await wsA.waitFor((m) => m.type === 'game_snapshot' && m.phase === 'ENDED');
    assert.ok(endedSnap.endedResult);

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

test('AC-01 & Random Map: Single-player AI mode resolves random map and operates cleanly', async () => {
  const srv = createCandyServer({ port: 0, allowTestHooks: true });
  const port = await srv.start();
  const ws = await connectWs(`ws://127.0.0.1:${port}/ws`);

  try {
    ws.send(JSON.stringify({ type: 'create_room', mode: 'ai', aiDifficulty: 'clever', mapId: 'random', nickname: '玩家1' }));
    const cd = await ws.waitFor((m) => m.type === 'room_state' && m.phase === 'COUNTDOWN');
    assert.equal(cd.players.length, 2);
    assert.equal(cd.players[1].isAI, true);
    assert.equal(cd.mapSelection, 'random');
    assert.ok(MAP_ORDER.includes(cd.resolvedMapId));

    ws.send(JSON.stringify({ type: 'test_command', action: 'fastForwardTicks', payload: { ticks: 500 } }));
    const snap = await ws.waitFor((m) => m.type === 'game_snapshot' && m.tick >= 500);
    assert.equal(snap.mapId, cd.resolvedMapId);
    assert.ok(snap.opponent.towers.length >= 2, 'Clever AI should build at least 2 towers');
    assert.ok(snap.opponent.eco > 25, 'Clever AI should increase Eco via sending dark raids');
  } finally {
    ws.close();
    await srv.stop();
  }
});

test('AC-11: 20s Reconnect grace pauses simulation, restores V2 mapId/clearedObstacles/branch, and awards timeout victory', async () => {
  const srv = createCandyServer({ port: 0, allowTestHooks: true });
  const port = await srv.start();
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  const wsA = await connectWs(wsUrl);
  let wsB = await connectWs(wsUrl);

  try {
    wsA.send(JSON.stringify({ type: 'create_room', mode: 'pvp', mapId: 'rainbow_m', nickname: 'A' }));
    const stA = await wsA.waitFor((m) => m.type === 'room_state');
    wsB.send(JSON.stringify({ type: 'join_room', roomCode: stA.roomCode, nickname: 'B' }));
    const stB = await wsB.waitFor((m) => m.type === 'room_state' && m.players.length === 2);

    wsA.send(JSON.stringify({ type: 'player_ready', ready: true }));
    wsB.send(JSON.stringify({ type: 'player_ready', ready: true }));
    await wsA.waitFor((m) => m.type === 'room_state' && m.phase === 'COUNTDOWN');

    wsA.send(JSON.stringify({ type: 'test_command', action: 'fastForwardTicks', payload: { ticks: 10 } }));
    await wsA.waitFor((m) => m.type === 'game_snapshot' && m.tick === 10);

    // Grant B gold, demolish rainbow_m obstacle [5,4], place tower and upgrade Lv3-B
    wsB.send(JSON.stringify({ type: 'test_command', action: 'grantResources', payload: { target: 'self', gold: 2000 } }));
    await wsB.waitFor((m) => m.type === 'test_command_result' && m.action === 'grantResources');
    wsB.send(JSON.stringify({ type: 'demolish_obstacle', col: 5, row: 4 }));
    await wsB.waitFor((m) => m.type === 'game_snapshot' && m.self.clearedObstacles.includes('5,4'));
    wsB.send(JSON.stringify({ type: 'place_tower', towerType: 'mint', col: 5, row: 4 }));
    const sB1 = await wsB.waitFor((m) => m.type === 'game_snapshot' && m.self.towers.length === 1);
    const tid = sB1.self.towers[0].id;
    wsB.send(JSON.stringify({ type: 'upgrade_tower', towerId: tid }));
    await wsB.waitFor((m) => m.type === 'game_snapshot' && m.self.towers[0]?.level === 2);
    wsB.send(JSON.stringify({ type: 'upgrade_tower', towerId: tid, branch: 'B' }));
    await wsB.waitFor((m) => m.type === 'game_snapshot' && m.self.towers[0]?.level === 3);

    // Disconnect B
    wsB.close();
    const pausedState = await wsA.waitFor((m) => m.type === 'room_state' && m.phase === 'PAUSED_RECONNECT');
    assert.equal(pausedState.phase, 'PAUSED_RECONNECT');

    // Reconnect B with reconnectToken -> verify V2 mapId, clearedObstacles, branch & buffTile restored
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
    assert.equal(resumedState.resolvedMapId, 'rainbow_m');
    const resumedSnap = await wsB.waitFor((m) => m.type === 'game_snapshot' && m.phase === 'PLAYING');
    assert.equal(resumedSnap.mapId, 'rainbow_m');
    assert.deepEqual(resumedSnap.self.clearedObstacles, ['5,4']);
    assert.equal(resumedSnap.self.towers.length, 1);
    assert.equal(resumedSnap.self.towers[0].branch, 'B');
    assert.equal(resumedSnap.self.towers[0].buffTile, 'rate');

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

test('AC-12: Subpath reverse proxy (/candy-td/*) serves assets and upgrades WS', async () => {
  const backend = createCandyServer({ port: 0, allowTestHooks: false });
  const backendPort = await backend.start();

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
    const res1 = await fetch(`http://127.0.0.1:${proxyPort}/candy-td/js/shared/constants.js`);
    assert.equal(res1.status, 200);
    const body1 = await res1.text();
    assert.ok(body1.includes('MAP_DEFS'));

    const ws = await connectWs(`ws://127.0.0.1:${proxyPort}/candy-td/ws`);
    ws.send(JSON.stringify({ type: 'create_room', mode: 'pvp', mapId: 'waffle_zig', nickname: '反代测试' }));
    const state = await ws.waitFor((m) => m.type === 'room_state');
    assert.equal(state.phase, 'LOBBY');
    assert.equal(state.mapSelection, 'waffle_zig');
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

test('AC-13 & AC-14: Production mode disables test_command & V2 invalid payloads return safe action_error', async () => {
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

    // Invalid mapId in create_room
    ws1.send(JSON.stringify({ type: 'create_room', mode: 'pvp', mapId: 'no_such_map', nickname: 'X' }));
    const errBadMap = await ws1.waitFor((m) => m.type === 'action_error');
    assert.equal(errBadMap.code, 'INVALID_MAP');

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

test('AC-14 Regression: V2 gameplay boundaries (OOB cell, path cell, duplicate demolish, missing branch, invalid express_feint)', async () => {
  const srv = createCandyServer({ port: 0, allowTestHooks: true });
  const port = await srv.start();
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  const wsA = await connectWs(wsUrl);
  const wsB = await connectWs(wsUrl);

  try {
    wsA.send(JSON.stringify({ type: 'create_room', mode: 'pvp', mapId: 'classic_s', nickname: 'HostA' }));
    const r1 = await wsA.waitFor((m) => m.type === 'room_state');
    wsB.send(JSON.stringify({ type: 'join_room', roomCode: r1.roomCode, nickname: 'GuestB' }));
    await wsB.waitFor((m) => m.type === 'room_state' && m.players.length === 2);
    wsA.send(JSON.stringify({ type: 'player_ready', ready: true }));
    wsB.send(JSON.stringify({ type: 'player_ready', ready: true }));
    await wsA.waitFor((m) => m.type === 'room_state' && m.phase === 'COUNTDOWN');

    wsA.send(JSON.stringify({ type: 'test_command', action: 'fastForwardTicks', payload: { ticks: 5 } }));
    await wsA.waitFor((m) => m.type === 'game_snapshot' && m.phase === 'PLAYING' && m.tick >= 5);

    wsA.send(JSON.stringify({ type: 'place_tower', towerType: 'strawberry', col: 99, row: 0 }));
    assert.equal((await wsA.waitFor((m) => m.type === 'action_error')).code, 'INVALID_CELL');

    wsA.send(JSON.stringify({ type: 'place_tower', towerType: 'strawberry', col: 0, row: 2 }));
    assert.equal((await wsA.waitFor((m) => m.type === 'action_error')).code, 'INVALID_CELL');

    wsA.send(JSON.stringify({ type: 'send_wave', sendType: 'express_feint' }));
    assert.equal((await wsA.waitFor((m) => m.type === 'action_error')).code, 'INVALID_SEND_TYPE');

    wsA.send(JSON.stringify({ type: 'test_command', action: 'grantResources', payload: { target: 'self', gold: 2000 } }));
    await wsA.waitFor((m) => m.type === 'test_command_result' && m.action === 'grantResources');

    // Duplicate demolish
    wsA.send(JSON.stringify({ type: 'demolish_obstacle', col: 3, row: 4 }));
    await wsA.waitFor((m) => m.type === 'game_snapshot' && m.self.clearedObstacles.includes('3,4'));
    wsA.send(JSON.stringify({ type: 'demolish_obstacle', col: 3, row: 4 }));
    assert.equal((await wsA.waitFor((m) => m.type === 'action_error')).code, 'OBSTACLE_ALREADY_CLEARED');

    // Lv2 -> Lv3 branch checks & max level
    wsA.send(JSON.stringify({ type: 'place_tower', towerType: 'strawberry', col: 3, row: 3 }));
    const tSnap = await wsA.waitFor((m) => m.type === 'game_snapshot' && m.self.towers.length === 1);
    const tid = tSnap.self.towers[0].id;
    wsA.send(JSON.stringify({ type: 'upgrade_tower', towerId: tid }));
    await wsA.waitFor((m) => m.type === 'game_snapshot' && m.self.towers[0]?.level === 2);
    wsA.send(JSON.stringify({ type: 'upgrade_tower', towerId: tid }));
    assert.equal((await wsA.waitFor((m) => m.type === 'action_error')).code, 'INVALID_BRANCH');
    wsA.send(JSON.stringify({ type: 'upgrade_tower', towerId: tid, branch: 'B' }));
    await wsA.waitFor((m) => m.type === 'game_snapshot' && m.self.towers[0]?.level === 3);
    wsA.send(JSON.stringify({ type: 'upgrade_tower', towerId: tid, branch: 'A' }));
    assert.equal((await wsA.waitFor((m) => m.type === 'action_error')).code, 'MAX_LEVEL');

    // Cooldown spam on raid_swarm
    wsA.send(JSON.stringify({ type: 'send_wave', sendType: 'raid_swarm' }));
    wsA.send(JSON.stringify({ type: 'send_wave', sendType: 'raid_swarm' }));
    assert.equal((await wsA.waitFor((m) => m.type === 'action_error')).code, 'COOLDOWN_ACTIVE');
  } finally {
    wsA.close();
    wsB.close();
    await srv.stop();
  }
});

function rawHttpGet(port, reqPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: reqPath,
        method: 'GET',
        headers
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('AC-15: Static assets and /healthz return exact Content-Length without chunked encoding (raw & gzip)', async () => {
  const srv = createCandyServer({ port: 0, allowTestHooks: false });
  const port = await srv.start();

  try {
    const targets = [
      { reqPath: '/', filePath: path.join(PUBLIC_DIR, 'index.html') },
      { reqPath: '/css/style.css', filePath: path.join(PUBLIC_DIR, 'css', 'style.css') },
      { reqPath: '/js/main.js', filePath: path.join(PUBLIC_DIR, 'js', 'main.js') },
      { reqPath: '/js/renderer.js', filePath: path.join(PUBLIC_DIR, 'js', 'renderer.js') },
      { reqPath: '/healthz', filePath: null }
    ];

    for (const { reqPath, filePath } of targets) {
      const expectedRaw = filePath
        ? await fs.readFile(filePath)
        : Buffer.from(JSON.stringify({ ok: true, allowTestHooks: false }), 'utf8');

      const rawRes = await rawHttpGet(port, reqPath);
      assert.equal(rawRes.status, 200, `${reqPath} raw status`);
      assert.equal(rawRes.headers['transfer-encoding'], undefined, `${reqPath} raw must not be chunked`);
      assert.equal(rawRes.headers['content-encoding'], undefined, `${reqPath} raw must not be gzip`);
      assert.equal(Number(rawRes.headers['content-length']), rawRes.body.length, `${reqPath} raw Content-Length`);
      assert.equal(Buffer.compare(rawRes.body, expectedRaw), 0, `${reqPath} raw byte match`);

      const gzRes = await rawHttpGet(port, reqPath, { 'Accept-Encoding': 'gzip, deflate, br' });
      assert.equal(gzRes.status, 200, `${reqPath} gzip status`);
      assert.equal(gzRes.headers['transfer-encoding'], undefined, `${reqPath} gzip must not be chunked`);
      assert.equal(gzRes.headers['content-encoding'], 'gzip', `${reqPath} gzip Content-Encoding`);
      assert.match(String(gzRes.headers.vary || ''), /Accept-Encoding/i, `${reqPath} Vary header`);
      assert.equal(Number(gzRes.headers['content-length']), gzRes.body.length, `${reqPath} gzip Content-Length`);
      const unzipped = zlib.gunzipSync(gzRes.body);
      assert.equal(Buffer.compare(unzipped, expectedRaw), 0, `${reqPath} gunzipped byte match`);
    }
  } finally {
    await srv.stop();
  }
});

test('AC-16: NetClient deduplicates concurrent connect(), rejects on timeout/close, and recovers on retry', async () => {
  const prevWS = globalThis.WebSocket;
  const prevLocation = globalThis.location;
  const prevStorage = globalThis.sessionStorage;

  const sentMessages = [];
  const createdSockets = [];
  let mode = 'slow_open';

  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      if (mode === 'sync_throw') {
        throw new Error('WS_SYNC_CONSTRUCT_ERROR');
      }
      this.url = url;
      this.readyState = MockWebSocket.CONNECTING;
      this.listeners = new Map();
      createdSockets.push(this);
      if (mode === 'slow_open') {
        setTimeout(() => {
          if (this.readyState !== MockWebSocket.CONNECTING) return;
          this.readyState = MockWebSocket.OPEN;
          this._emit('open', {});
        }, 50);
      } else if (mode === 'fast_open') {
        setTimeout(() => {
          if (this.readyState !== MockWebSocket.CONNECTING) return;
          this.readyState = MockWebSocket.OPEN;
          this._emit('open', {});
        }, 10);
      } else if (mode === 'close_early') {
        setTimeout(() => {
          if (this.readyState !== MockWebSocket.CONNECTING) return;
          this.readyState = MockWebSocket.CLOSED;
          this._emit('close', {});
        }, 20);
      }
    }

    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }

    _emit(type, ev) {
      for (const fn of this.listeners.get(type) || []) fn(ev);
    }

    send(data) {
      sentMessages.push(JSON.parse(data));
    }

    close() {
      this.readyState = MockWebSocket.CLOSED;
    }
  }

  globalThis.WebSocket = MockWebSocket;
  globalThis.location = { protocol: 'http:', host: '127.0.0.1:3100', pathname: '/' };
  globalThis.sessionStorage = {
    getItem: () => null,
    setItem: () => {}
  };

  try {
    const net = new NetClient();

    mode = 'slow_open';
    const p1 = net.connect({ timeoutMs: 1000 });
    const p2 = net.connect({ timeoutMs: 1000 });
    assert.equal(p1, p2, 'Concurrent connect() must reuse in-flight promise');
    assert.equal(net.connected, false);
    await Promise.all([p1, p2]);
    assert.equal(net.connected, true);
    assert.equal(net.send({ type: 'create_room', mode: 'ai' }), true);
    assert.equal(net.send({ type: 'ping', clientTime: 1 }), true);
    assert.ok(sentMessages.some((m) => m.type === 'create_room'));

    net._stopPing();
    net.ws.close();
    net.ws = null;
    net.connected = false;

    mode = 'hang';
    await assert.rejects(() => net.connect({ timeoutMs: 80 }), /WS_CONNECT_TIMEOUT/);
    assert.equal(net.ws, null);
    assert.equal(net._connectPromise, null);
    assert.equal(net.connected, false);

    mode = 'close_early';
    await assert.rejects(() => net.connect({ timeoutMs: 500 }), /WS_CONNECT_CLOSED/);
    assert.equal(net.ws, null);
    assert.equal(net._connectPromise, null);

    mode = 'fast_open';
    await net.connect({ timeoutMs: 500 });
    assert.equal(net.connected, true);
    assert.equal(net.send({ type: 'join_room', roomCode: 'ABCD' }), true);

    let disconnectCount = 0;
    net.handlers.onConnectionChange = (isConn) => {
      if (!isConn) disconnectCount++;
    };
    const staleSocket = createdSockets[1];
    staleSocket._emit('close', {});
    assert.equal(net.connected, true);
    assert.ok(net.ws !== null);
    assert.equal(disconnectCount, 0);

    net._stopPing();
    net.ws.close();
    net.ws = null;
    net.connected = false;

    mode = 'sync_throw';
    await assert.rejects(() => net.connect({ timeoutMs: 500 }), /WS_SYNC_CONSTRUCT_ERROR/);
    assert.equal(net.ws, null);
    assert.equal(net._connectPromise, null);
    assert.equal(net.connected, false);
  } finally {
    globalThis.WebSocket = prevWS;
    globalThis.location = prevLocation;
    globalThis.sessionStorage = prevStorage;
  }
});

test('AC-17: CandyAudio falls back to in-memory mute state when sessionStorage throws SecurityError', () => {
  const prevStorage = globalThis.sessionStorage;
  const securityErr = () => {
    const err = new Error('Access is denied for this document.');
    err.name = 'SecurityError';
    throw err;
  };

  globalThis.sessionStorage = {
    getItem: securityErr,
    setItem: securityErr
  };

  try {
    const audio = new CandyAudio();
    assert.equal(audio.muted, false);
    assert.equal(audio.toggleMute(), true);
    assert.equal(audio.muted, true);
    assert.equal(audio.toggleMute(), false);
    assert.equal(audio.muted, false);
  } finally {
    globalThis.sessionStorage = prevStorage;
  }
});
