import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@court2k/shared';
import { createCourt2kServer } from '../src/index.js';

const ROOM_COUNT = Number(process.env.STRESS_ROOMS ?? 16);
const DURATION_SEC = Number(process.env.STRESS_DURATION_SEC ?? 30);
const PORT = Number(process.env.PORT ?? 3301);

function connectWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', (err) => reject(err));
  });
}

function sendMsg(ws: WebSocket, msg: ClientMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function waitForMsg<T extends ServerMessage['type']>(
  ws: WebSocket,
  type: T
): Promise<Extract<ServerMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error(`Timeout waiting for ${type}`));
    }, 10_000);
    const onMsg = (data: WebSocket.RawData) => {
      const parsed = JSON.parse(data.toString('utf8')) as ServerMessage;
      if (parsed.type === type) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(parsed as Extract<ServerMessage, { type: T }>);
      }
    };
    ws.on('message', onMsg);
  });
}

async function main(): Promise<void> {
  const server = createCourt2kServer({ port: PORT, host: '127.0.0.1' });
  const boundPort = await server.start();
  const wsUrl = `ws://127.0.0.1:${boundPort}/ws`;

  const pairs: Array<{ p0: WebSocket; p1: WebSocket; seq: [number, number] }> = [];
  let snapshotsReceived = 0;

  try {
    for (let i = 0; i < ROOM_COUNT; i++) {
      const p0 = await connectWs(wsUrl);
      const p1 = await connectWs(wsUrl);

      p0.on('message', (data) => {
        const msg = JSON.parse(data.toString('utf8')) as ServerMessage;
        if (msg.type === 'STATE_SNAPSHOT') snapshotsReceived += 1;
      });
      p1.on('message', (data) => {
        const msg = JSON.parse(data.toString('utf8')) as ServerMessage;
        if (msg.type === 'STATE_SNAPSHOT') snapshotsReceived += 1;
      });

      const createdP = waitForMsg(p0, 'ROOM_CREATED');
      sendMsg(p0, {
        type: 'CREATE_ROOM',
        payload: { court: i % 3 === 0 ? 'hard' : i % 3 === 1 ? 'clay' : 'grass', format: 'fast4', archetype: 'allcourt' },
      });
      const created = await createdP;

      const joinedP = waitForMsg(p1, 'ROOM_JOINED');
      sendMsg(p1, {
        type: 'JOIN_ROOM',
        payload: { roomCode: created.payload.roomCode, archetype: 'defender' },
      });
      await joinedP;

      const start0 = waitForMsg(p0, 'MATCH_START');
      const start1 = waitForMsg(p1, 'MATCH_START');
      sendMsg(p0, { type: 'READY', payload: { ready: true } });
      sendMsg(p1, { type: 'READY', payload: { ready: true } });
      await Promise.all([start0, start1]);

      pairs.push({ p0, p1, seq: [0, 0] });
    }

    const startRssMb = process.memoryUsage().rss / (1024 * 1024);
    let maxRssMb = startRssMb;
    const t0 = performance.now();

    // Send realistic 60Hz inputs across all 16 rooms for DURATION_SEC seconds
    const inputInterval = setInterval(() => {
      const now = Date.now();
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        pair.seq[0] += 1;
        pair.seq[1] += 1;
        const phase0 = pair.seq[0] % 45 === 1 ? 'hold' : pair.seq[0] % 45 === 25 ? 'release' : 'idle';
        const action0 = phase0 === 'idle' ? 'none' : 'J';
        sendMsg(pair.p0, {
          type: 'PLAYER_INPUT',
          payload: {
            seq: pair.seq[0],
            moveX: Math.sin(pair.seq[0] * 0.1),
            moveZ: 0,
            aimX: 0.3,
            aimZ: -0.5,
            action: action0,
            phase: phase0,
            clientTime: now,
          },
        });
        sendMsg(pair.p1, {
          type: 'PLAYER_INPUT',
          payload: {
            seq: pair.seq[1],
            moveX: Math.cos(pair.seq[1] * 0.1),
            moveZ: 0,
            aimX: -0.3,
            aimZ: -0.5,
            action: 'none',
            phase: 'idle',
            clientTime: now,
          },
        });
      }
      const rssMb = process.memoryUsage().rss / (1024 * 1024);
      if (rssMb > maxRssMb) maxRssMb = rssMb;
    }, 1000 / 60);

    const rssSampler = setInterval(() => {
      const rssMb = process.memoryUsage().rss / (1024 * 1024);
      if (rssMb > maxRssMb) maxRssMb = rssMb;
    }, 1000);

    await new Promise((r) => setTimeout(r, DURATION_SEC * 1000));
    clearInterval(inputInterval);
    clearInterval(rssSampler);

    const elapsedSec = (performance.now() - t0) / 1000;
    const endRssMb = process.memoryUsage().rss / (1024 * 1024);
    if (endRssMb > maxRssMb) maxRssMb = endRssMb;
    const metrics = server.getMetrics();

    console.log('=== AC-15 16-Room 60Hz Stress Test Report ===');
    console.log(`Rooms: ${server.roomManager.getRoomCount()}`);
    console.log(`Duration: ${elapsedSec.toFixed(2)}s`);
    console.log(`Total Server Ticks: ${metrics.totalTicks} (~${(metrics.totalTicks / elapsedSec).toFixed(1)} Hz)`);
    console.log(`Avg Tick Duration: ${metrics.avgTickMs.toFixed(3)} ms (target < 8.000 ms)`);
    console.log(`Max Tick Duration: ${metrics.maxTickMs.toFixed(3)} ms`);
    console.log(`Start RSS: ${startRssMb.toFixed(2)} MB`);
    console.log(`End RSS: ${endRssMb.toFixed(2)} MB`);
    console.log(`Peak RSS: ${maxRssMb.toFixed(2)} MB (target <= 256.00 MB)`);
    console.log(`Snapshots Received (all clients): ${snapshotsReceived}`);

    if (metrics.avgTickMs >= 8.0) {
      throw new Error(`Average tick duration ${metrics.avgTickMs.toFixed(3)} ms >= 8 ms`);
    }
    if (maxRssMb > 256.0) {
      throw new Error(`Peak RSS ${maxRssMb.toFixed(2)} MB > 256 MB`);
    }
  } finally {
    for (const pair of pairs) {
      pair.p0.close();
      pair.p1.close();
    }
    await server.stop();
  }
}

main().catch((err) => {
  console.error('[stress-16rooms] FAILED:', err);
  process.exit(1);
});
