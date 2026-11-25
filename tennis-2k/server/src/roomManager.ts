import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import {
  COURT_DIM,
  createRng,
  generateRoomCode,
  type ClientMessage,
  type PlayerIndex,
} from '@court2k/shared';
import type { ServerConfig } from './config.js';
import { Room, sendError } from './room.js';

interface SocketBinding {
  roomCode: string;
  playerIndex: PlayerIndex;
}

export interface TickMetrics {
  totalTicks: number;
  avgTickMs: number;
  maxTickMs: number;
}

export class RoomManager {
  private readonly config: ServerConfig;
  private readonly rooms = new Map<string, Room>();
  private readonly bindings = new Map<WebSocket, SocketBinding>();
  private readonly codeRng = createRng((Date.now() ^ 0x9e3779b9) >>> 0);

  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private gcTimer: ReturnType<typeof setInterval> | null = null;
  private lastLoopMs = 0;
  private accumulatorSec = 0;
  private running = false;

  private totalTicks = 0;
  private totalTickDurationMs = 0;
  private maxTickMs = 0;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastLoopMs = performance.now();
    this.accumulatorSec = 0;

    const tickIntervalMs = 1000 / 60;
    const scheduleNext = () => {
      if (!this.running) return;
      this.loopTimer = setTimeout(() => {
        this.runSimulationStep();
        scheduleNext();
      }, 15);
    };
    void tickIntervalMs;
    scheduleNext();

    const gcCheckMs = Math.min(1000, Math.max(50, Math.floor(this.config.emptyRoomTtlMs / 4)));
    this.gcTimer = setInterval(() => {
      this.collectIdleRooms(Date.now());
    }, gcCheckMs);
  }

  stop(): void {
    this.running = false;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
    for (const room of this.rooms.values()) {
      room.closeAll('Server shutting down');
    }
    this.rooms.clear();
    this.bindings.clear();
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  getMetrics(): TickMetrics {
    return {
      totalTicks: this.totalTicks,
      avgTickMs: this.totalTicks > 0 ? this.totalTickDurationMs / this.totalTicks : 0,
      maxTickMs: this.maxTickMs,
    };
  }

  private runSimulationStep(): void {
    const nowPerf = performance.now();
    const elapsedSec = Math.min(0.1, Math.max(0, (nowPerf - this.lastLoopMs) / 1000));
    this.lastLoopMs = nowPerf;
    this.accumulatorSec += elapsedSec;

    let steps = 0;
    const maxStepsPerCycle = 4;
    while (this.accumulatorSec >= COURT_DIM.FIXED_DT && steps < maxStepsPerCycle) {
      this.accumulatorSec -= COURT_DIM.FIXED_DT;
      steps += 1;
      const t0 = performance.now();
      const wallNow = Date.now();

      for (const [code, room] of this.rooms) {
        room.stepTick(COURT_DIM.FIXED_DT, wallNow);
        if (room.isRecycled) {
          this.recycleRoom(code, 'Both players timed out');
        }
      }

      const dur = performance.now() - t0;
      this.totalTicks += 1;
      this.totalTickDurationMs += dur;
      if (dur > this.maxTickMs) {
        this.maxTickMs = dur;
      }
    }
  }

  private allocateRoomCode(): string {
    for (let attempt = 0; attempt < 64; attempt++) {
      const code = generateRoomCode(this.codeRng);
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    throw new Error('Failed to allocate unique room code');
  }

  private detachSocket(ws: WebSocket, nowMs: number): void {
    const binding = this.bindings.get(ws);
    if (!binding) return;
    this.bindings.delete(ws);

    const room = this.rooms.get(binding.roomCode);
    if (room) {
      room.handleDisconnect(binding.playerIndex, ws, nowMs);
    }
  }

  handleSocketClose(ws: WebSocket): void {
    this.detachSocket(ws, Date.now());
  }

  handleMessage(ws: WebSocket, msg: ClientMessage): void {
    const nowMs = Date.now();

    if (msg.type === 'CREATE_ROOM') {
      this.detachSocket(ws, nowMs);
      const code = this.allocateRoomCode();
      const seed = (Math.floor(this.codeRng.next() * 0x7fffffff) + 1) >>> 0;
      const room = new Room(
        code,
        ws,
        msg.payload.court,
        msg.payload.format,
        msg.payload.archetype,
        seed,
        nowMs
      );
      this.rooms.set(code, room);
      this.bindings.set(ws, { roomCode: code, playerIndex: 0 });
      return;
    }

    if (msg.type === 'JOIN_ROOM') {
      const room = this.rooms.get(msg.payload.roomCode);
      if (!room) {
        sendError(ws, 'ROOM_NOT_FOUND', '房间不存在');
        return;
      }
      const existingBinding = this.bindings.get(ws);
      if (existingBinding && existingBinding.roomCode === room.code) {
        sendError(ws, 'INVALID_PHASE', '已在目标房间中');
        return;
      }
      const preCheck = room.canJoinGuest();
      if (!preCheck.ok) {
        sendError(ws, preCheck.code, preCheck.message);
        return;
      }
      this.detachSocket(ws, nowMs);
      const res = room.joinGuest(ws, msg.payload.archetype, nowMs);
      if (!res.ok) {
        sendError(ws, res.code, res.message);
        return;
      }
      this.bindings.set(ws, { roomCode: room.code, playerIndex: 1 });
      return;
    }

    if (msg.type === 'RECONNECT') {
      const room = this.rooms.get(msg.payload.roomCode);
      if (!room) {
        sendError(ws, 'INVALID_TOKEN', '房间已回收或会话无效');
        return;
      }
      const res = room.verifyAndBindReconnect(ws, msg.payload.sessionToken, nowMs);
      if (!res.ok) {
        sendError(ws, 'INVALID_TOKEN', '重连令牌无效');
        return;
      }
      // Remove previous binding for this socket if any (without triggering disconnect on target room)
      const oldBinding = this.bindings.get(ws);
      if (oldBinding && oldBinding.roomCode !== room.code) {
        this.detachSocket(ws, nowMs);
      }
      if (res.displacedSocket) {
        this.bindings.delete(res.displacedSocket);
        try {
          res.displacedSocket.close(1000, 'Replaced by reconnect');
        } catch {
          // ignore
        }
      }
      this.bindings.set(ws, { roomCode: room.code, playerIndex: res.playerIndex });
      return;
    }

    if (msg.type === 'TEST_COMMAND' && !this.config.enableTestHooks) {
      sendError(ws, 'FORBIDDEN_TEST_HOOK', 'Test hooks are disabled on this server');
      return;
    }

    const binding = this.bindings.get(ws);
    if (!binding) {
      sendError(ws, 'ROOM_NOT_FOUND', '未加入房间或房间已回收');
      return;
    }

    const room = this.rooms.get(binding.roomCode);
    if (!room) {
      this.bindings.delete(ws);
      sendError(ws, 'ROOM_NOT_FOUND', '房间不存在或已回收');
      return;
    }

    room.handleMessage(binding.playerIndex, ws, msg, nowMs, this.config.enableTestHooks);
  }

  collectIdleRooms(nowMs: number): number {
    let recycled = 0;
    for (const [code, room] of this.rooms) {
      if (room.isRecycled) {
        this.recycleRoom(code, 'Recycled');
        recycled += 1;
        continue;
      }

      if (room.isWaitingOrOver) {
        if (
          room.bothDisconnected &&
          room.emptySinceMs !== null &&
          nowMs - room.emptySinceMs >= this.config.emptyRoomTtlMs
        ) {
          this.recycleRoom(code, 'Empty room expired');
          recycled += 1;
          continue;
        }

        if (nowMs - room.lastActivityAtMs >= this.config.idleRoomTtlMs) {
          this.recycleRoom(code, 'Idle room expired');
          recycled += 1;
        }
      }
    }
    return recycled;
  }

  private recycleRoom(code: string, reason: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    this.rooms.delete(code);

    for (const idx of [0, 1] as const) {
      const sock = room.getSocket(idx);
      if (sock) {
        this.bindings.delete(sock);
      }
    }
    room.closeAll(reason);
  }
}
