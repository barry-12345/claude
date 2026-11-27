import crypto from 'node:crypto';
import {
  COUNTDOWN_SECONDS,
  INITIAL_ECO,
  INITIAL_GOLD,
  INITIAL_HP,
  MAP_ORDER,
  RECONNECT_GRACE_MS,
  ROOM_CODE_CHARS,
  TICK_MS,
  isValidMapSelection
} from '../public/js/shared/constants.js';
import { GameSimulation } from './simulation.js';
import { CandyAIBot } from './ai-bot.js';

const NON_CRITICAL_COMBAT_EVENTS = new Set([
  'tower_shot',
  'mint_splash',
  'popcorn_boom',
  'shield_hit',
  'shield_break',
  'creep_pop',
  'frost_nova',
  'brittle_shatter',
  'healer_pulse',
  'execute_hit',
  'macaron_cracked'
]);
const NON_CRITICAL_EVENT_CAP = 24;
const WS_BACKPRESSURE_BYTES = 65536; // 64 KB

function sanitizeNickname(raw, fallback) {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw
    .replace(/[<>&"'`]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 20);
  return cleaned || fallback;
}

function makeToken() {
  return crypto.randomBytes(16).toString('hex');
}

function pickRandomMapId() {
  return MAP_ORDER[crypto.randomInt(0, MAP_ORDER.length)];
}

export class RoomManager {
  constructor(options = {}) {
    this.allowTestHooks = Boolean(options.allowTestHooks);
    this.rooms = new Map();
    this.wsToSession = new WeakMap();
    this.tickTimer = null;
  }

  startLoop() {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this._tickAllRooms(), TICK_MS);
  }

  stopLoop() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  _generateRoomCode() {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += ROOM_CODE_CHARS[crypto.randomInt(0, ROOM_CODE_CHARS.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Failed to generate unique room code');
  }

  _send(ws, payload) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify(payload));
  }

  _sendError(ws, code, message) {
    this._send(ws, { type: 'action_error', code, message });
  }

  _resolveMapForMatch(room) {
    if (room.mapSelection === 'random') {
      return pickRandomMapId();
    }
    return isValidMapSelection(room.mapSelection) ? room.mapSelection : MAP_ORDER[0];
  }

  _broadcastRoomState(room) {
    const now = Date.now();
    const countdownSec =
      room.phase === 'COUNTDOWN'
        ? Math.max(0, Math.ceil((room.countdownEndMs - now) / 1000))
        : 0;
    const reconnectRemainSec =
      room.phase === 'PAUSED_RECONNECT' && room.reconnectDeadlineMs
        ? Math.max(0, Math.ceil((room.reconnectDeadlineMs - now) / 1000))
        : 0;

    const playersInfo = room.players
      .filter((p) => p !== null)
      .map((p) => ({
        slot: p.slot,
        nickname: p.nickname,
        ready: p.ready,
        connected: p.connected,
        isAI: p.isAI,
        rematchReady: p.rematchReady
      }));

    for (const p of room.players) {
      if (!p || !p.ws || p.isAI) continue;
      this._send(p.ws, {
        type: 'room_state',
        roomCode: room.code,
        mode: room.mode,
        aiDifficulty: room.aiDifficulty,
        mapSelection: room.mapSelection,
        resolvedMapId: room.resolvedMapId,
        phase: room.phase,
        hostSlot: room.hostSlot,
        playerSlot: p.slot,
        playerId: p.playerId,
        reconnectToken: p.reconnectToken,
        players: playersInfo,
        countdownSec,
        reconnectRemainSec
      });
    }
  }

  _filterEventsForPlayer(events, playerSlot, watchedSlot, { criticalOnly = false } = {}) {
    if (!events || events.length === 0) return [];
    const out = [];
    const seenNonLemonShots = new Set();
    let nonCriticalCount = 0;

    for (const ev of events) {
      if (ev.viewerScope !== 'all' && ev.viewerScope !== playerSlot) continue;

      if (NON_CRITICAL_COMBAT_EVENTS.has(ev.type)) {
        if (criticalOnly) continue;
        if (ev.slot !== watchedSlot) continue;
        if (ev.type === 'tower_shot' && ev.towerType !== 'lemon') {
          const dedupKey = `${ev.slot}:${ev.towerType}`;
          if (seenNonLemonShots.has(dedupKey)) continue;
          seenNonLemonShots.add(dedupKey);
        }
        if (nonCriticalCount >= NON_CRITICAL_EVENT_CAP) continue;
        nonCriticalCount += 1;
      }

      const { viewerScope, ...rest } = ev;
      out.push(rest);
    }
    return out;
  }

  _sendSnapshotToPlayer(room, player, events = [], { isPeriodic = false, forceFullOpponent = false } = {}) {
    if (!room.sim || !player || !player.ws || player.isAI || player.ws.readyState !== 1) return;
    const watchedSlot = player.viewMode === 'opponent' ? 1 - player.slot : player.slot;

    if (isPeriodic && room.phase === 'PLAYING' && (player.ws.bufferedAmount || 0) > WS_BACKPRESSURE_BYTES) {
      player.skippedSnapshots = (player.skippedSnapshots || 0) + 1;
      const criticalEvents = this._filterEventsForPlayer(events, player.slot, watchedSlot, {
        criticalOnly: true
      });
      if (criticalEvents.length > 0) {
        this._send(player.ws, {
          type: 'game_event',
          tick: room.sim.tick,
          events: criticalEvents
        });
      }
      return;
    }

    const opponentLite =
      !forceFullOpponent &&
      isPeriodic &&
      player.viewMode !== 'opponent' &&
      room.phase === 'PLAYING' &&
      room.sim.tick % 10 !== 0;

    const snap = room.sim.getClientSnapshot(player.slot, room.phase, { opponentLite });
    snap.skippedSnapshots = player.skippedSnapshots || 0;
    this._send(player.ws, snap);

    const filteredEvents = this._filterEventsForPlayer(events, player.slot, watchedSlot, {
      criticalOnly: false
    });
    if (filteredEvents.length > 0) {
      this._send(player.ws, {
        type: 'game_event',
        tick: room.sim.tick,
        events: filteredEvents
      });
    }
  }

  _broadcastSnapshot(room, events = [], { isPeriodic = false } = {}) {
    if (!room.sim) return;
    for (const p of room.players) {
      if (!p || !p.ws || p.isAI) continue;
      this._sendSnapshotToPlayer(room, p, events, { isPeriodic });
    }
  }

  _startCountdown(room) {
    room.phase = 'COUNTDOWN';
    room.resolvedMapId = this._resolveMapForMatch(room);
    room.countdownEndMs = Date.now() + COUNTDOWN_SECONDS * 1000;
    room.lastCountdownBroadcastSec = COUNTDOWN_SECONDS;
    this._broadcastRoomState(room);
  }

  _beginPlaying(room) {
    room.phase = 'PLAYING';
    if (!room.resolvedMapId) {
      room.resolvedMapId = this._resolveMapForMatch(room);
    }
    room.sim = new GameSimulation({ mapId: room.resolvedMapId });
    room.aiBot = room.mode === 'ai' ? new CandyAIBot(room.aiDifficulty, room.resolvedMapId) : null;
    for (const p of room.players) {
      if (p) {
        p.rematchReady = false;
        p.viewMode = 'self';
        p.skippedSnapshots = 0;
      }
    }
    this._broadcastRoomState(room);
    this._broadcastSnapshot(room, []);
  }

  _tickAllRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      if (room.phase === 'COUNTDOWN') {
        const remSec = Math.max(0, Math.ceil((room.countdownEndMs - now) / 1000));
        if (now >= room.countdownEndMs) {
          this._beginPlaying(room);
        } else if (remSec !== room.lastCountdownBroadcastSec) {
          room.lastCountdownBroadcastSec = remSec;
          this._broadcastRoomState(room);
        }
        continue;
      }

      if (room.phase === 'PAUSED_RECONNECT') {
        const bothOffline = room.players.every((p) => !p || p.isAI || !p.connected);
        const remSec = Math.max(0, Math.ceil((room.reconnectDeadlineMs - now) / 1000));

        if (now >= room.reconnectDeadlineMs) {
          if (bothOffline) {
            this.rooms.delete(code);
            continue;
          }
          const onlinePlayer = room.players.find((p) => p && !p.isAI && p.connected);
          const winnerSlot = onlinePlayer ? onlinePlayer.slot : 0;
          room.phase = 'ENDED';
          let endedResult = room.sim?.endedResult || null;
          if (room.sim) {
            room.sim.phase = 'ENDED';
            const p0 = room.sim.players[0];
            const p1 = room.sim.players[1];
            endedResult = {
              winnerSlot,
              loserSlot: 1 - winnerSlot,
              reason: 'reconnect_timeout',
              endTick: room.sim.tick,
              wave: room.sim.wave,
              mapId: room.sim.mapId,
              stats: [
                { slot: 0, hp: p0.hp, eco: p0.eco, gold: p0.gold, ...p0.stats },
                { slot: 1, hp: p1.hp, eco: p1.eco, gold: p1.gold, ...p1.stats }
              ]
            };
            room.sim.endedResult = endedResult;
          } else {
            endedResult = {
              winnerSlot,
              loserSlot: 1 - winnerSlot,
              reason: 'reconnect_timeout',
              endTick: 0,
              wave: 0,
              mapId: room.resolvedMapId,
              stats: [
                {
                  slot: 0,
                  hp: INITIAL_HP,
                  eco: INITIAL_ECO,
                  gold: INITIAL_GOLD,
                  towersBuilt: 0,
                  towersUpgraded: 0,
                  towersSold: 0,
                  obstaclesCleared: 0,
                  creepsKilled: 0,
                  creepsSent: 0,
                  expressSent: 0,
                  goldEarned: 0,
                  damageDealt: 0
                },
                {
                  slot: 1,
                  hp: INITIAL_HP,
                  eco: INITIAL_ECO,
                  gold: INITIAL_GOLD,
                  towersBuilt: 0,
                  towersUpgraded: 0,
                  towersSold: 0,
                  obstaclesCleared: 0,
                  creepsKilled: 0,
                  creepsSent: 0,
                  expressSent: 0,
                  goldEarned: 0,
                  damageDealt: 0
                }
              ]
            };
          }
          this._broadcastRoomState(room);
          if (room.sim) {
            this._broadcastSnapshot(room, [
              { viewerScope: 'all', type: 'match_ended', endedResult }
            ]);
          } else {
            for (const p of room.players) {
              if (!p || !p.ws || p.isAI) continue;
              this._send(p.ws, {
                type: 'game_event',
                tick: 0,
                events: [{ type: 'match_ended', endedResult }]
              });
            }
          }
        } else if (remSec !== room.lastReconnectBroadcastSec) {
          room.lastReconnectBroadcastSec = remSec;
          this._broadcastRoomState(room);
        }
        continue;
      }

      if (room.phase === 'PLAYING' && room.sim) {
        const t0 = performance.now();
        if (room.aiBot) {
          room.aiBot.onTick(room.sim, 1);
        }
        const events = room.sim.step();
        if (room.sim.phase === 'ENDED') {
          room.phase = 'ENDED';
          this._broadcastRoomState(room);
        }
        room.lastTickDurationMs = Number((performance.now() - t0).toFixed(2));
        this._broadcastSnapshot(room, events, { isPeriodic: room.phase === 'PLAYING' });
      }
    }
  }

  handleMessage(ws, rawData) {
    let msg;
    try {
      const text = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
      msg = JSON.parse(text);
    } catch {
      this._sendError(ws, 'INVALID_JSON', '消息格式必须是合法 JSON');
      return;
    }

    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
      this._sendError(ws, 'INVALID_MESSAGE', '消息缺少有效 type 字段');
      return;
    }

    switch (msg.type) {
      case 'ping':
        this._handlePing(ws, msg);
        break;
      case 'create_room':
        this._handleCreateRoom(ws, msg);
        break;
      case 'join_room':
        this._handleJoinRoom(ws, msg);
        break;
      case 'leave_room':
        this._leaveCurrentRoom(ws, { intentional: true });
        break;
      case 'select_map':
        this._handleSelectMap(ws, msg);
        break;
      case 'player_ready':
        this._handlePlayerReady(ws, msg);
        break;
      case 'set_view_mode':
        this._handleSetViewMode(ws, msg);
        break;
      case 'place_tower':
      case 'upgrade_tower':
      case 'sell_tower':
      case 'demolish_obstacle':
      case 'set_targeting':
      case 'send_wave':
        this._handleGameplayAction(ws, msg);
        break;
      case 'rematch_request':
        this._handleRematchRequest(ws);
        break;
      case 'test_command':
        this._handleTestCommand(ws, msg);
        break;
      default:
        this._sendError(ws, 'UNKNOWN_MESSAGE_TYPE', `未知消息类型: ${msg.type}`);
    }
  }

  _handlePing(ws, msg) {
    const session = this.wsToSession.get(ws);
    const room = session ? this.rooms.get(session.roomCode) : null;
    const player = room && session ? room.players[session.slot] : null;
    this._send(ws, {
      type: 'pong',
      clientTime: msg.clientTime || Date.now(),
      serverTime: Date.now(),
      serverTickMs: room ? room.lastTickDurationMs || 0 : 0,
      skippedSnapshots: player ? player.skippedSnapshots || 0 : 0
    });
  }

  _handleSetViewMode(ws, msg) {
    const session = this.wsToSession.get(ws);
    if (!session) return;
    const room = this.rooms.get(session.roomCode);
    if (!room) return;
    const player = room.players[session.slot];
    if (!player) return;

    if (msg.mode !== 'self' && msg.mode !== 'opponent') {
      this._sendError(ws, 'INVALID_VIEW_MODE', '无效视角模式');
      return;
    }
    player.viewMode = msg.mode;
    if (msg.mode === 'opponent' && room.sim && room.phase === 'PLAYING') {
      this._sendSnapshotToPlayer(room, player, [], {
        isPeriodic: false,
        forceFullOpponent: true
      });
    }
  }

  _detachCurrentSocket(ws) {
    this._leaveCurrentRoom(ws, { intentional: true });
  }

  _leaveCurrentRoom(ws, { intentional = false } = {}) {
    const session = this.wsToSession.get(ws);
    if (!session) return;
    this.wsToSession.delete(ws);

    const room = this.rooms.get(session.roomCode);
    if (!room) return;

    const player = room.players[session.slot];
    if (!player || player.ws !== ws) return;

    player.ws = null;
    player.connected = false;

    if (room.phase === 'LOBBY') {
      room.players[session.slot] = null;
      const remaining = room.players.find((p) => p && !p.isAI && p.connected);
      if (!remaining) {
        this.rooms.delete(room.code);
      } else {
        if (room.hostSlot === session.slot) {
          room.hostSlot = remaining.slot;
        }
        this._broadcastRoomState(room);
      }
      return;
    }

    if (room.phase === 'COUNTDOWN' || room.phase === 'PLAYING' || room.phase === 'PAUSED_RECONNECT') {
      if (intentional) {
        if (room.mode === 'ai') {
          this.rooms.delete(room.code);
          return;
        }
        const remaining = room.players.find((p) => p && !p.isAI && p.connected);
        if (!remaining) {
          this.rooms.delete(room.code);
        } else {
          room.phase = 'ENDED';
          if (room.sim) {
            room.sim.phase = 'ENDED';
            const p0 = room.sim.players[0];
            const p1 = room.sim.players[1];
            room.sim.endedResult = {
              winnerSlot: remaining.slot,
              loserSlot: session.slot,
              reason: 'opponent_left',
              endTick: room.sim.tick,
              wave: room.sim.wave,
              mapId: room.sim.mapId,
              stats: [
                { slot: 0, hp: p0.hp, eco: p0.eco, gold: p0.gold, ...p0.stats },
                { slot: 1, hp: p1.hp, eco: p1.eco, gold: p1.gold, ...p1.stats }
              ]
            };
            this._broadcastRoomState(room);
            this._broadcastSnapshot(room, [
              { viewerScope: 'all', type: 'match_ended', endedResult: room.sim.endedResult }
            ]);
          } else {
            this._broadcastRoomState(room);
          }
        }
        return;
      }

      room.phase = 'PAUSED_RECONNECT';
      room.reconnectDeadlineMs = Date.now() + RECONNECT_GRACE_MS;
      room.lastReconnectBroadcastSec = Math.ceil(RECONNECT_GRACE_MS / 1000);
      this._broadcastRoomState(room);
      return;
    }

    if (room.phase === 'ENDED') {
      const anyOnline = room.players.some((p) => p && !p.isAI && p.connected);
      if (!anyOnline) {
        this.rooms.delete(room.code);
      } else {
        this._broadcastRoomState(room);
      }
    }
  }

  _handleCreateRoom(ws, msg) {
    const mapSelection = msg.mapId !== undefined ? msg.mapId : 'random';
    if (typeof mapSelection !== 'string' || !isValidMapSelection(mapSelection)) {
      this._sendError(ws, 'INVALID_MAP', '无效的地图选择');
      return;
    }

    this._detachCurrentSocket(ws);

    const mode = msg.mode === 'ai' ? 'ai' : 'pvp';
    const aiDifficulty = msg.aiDifficulty === 'clever' ? 'clever' : 'casual';
    const nickname = sanitizeNickname(msg.nickname, '草莓玩家');
    const code = this._generateRoomCode();
    const playerId = typeof msg.playerId === 'string' && msg.playerId ? msg.playerId : makeToken();
    const reconnectToken =
      typeof msg.reconnectToken === 'string' && msg.reconnectToken
        ? msg.reconnectToken
        : makeToken();

    const p0 = {
      slot: 0,
      playerId,
      reconnectToken,
      nickname,
      ready: mode === 'ai',
      connected: true,
      isAI: false,
      rematchReady: false,
      viewMode: 'self',
      skippedSnapshots: 0,
      ws
    };

    const p1 =
      mode === 'ai'
        ? {
            slot: 1,
            playerId: 'ai-bot',
            reconnectToken: 'ai-bot',
            nickname: aiDifficulty === 'clever' ? '狡黠狐狸 AI' : '休闲甜心 AI',
            ready: true,
            connected: true,
            isAI: true,
            rematchReady: true,
            viewMode: 'self',
            skippedSnapshots: 0,
            ws: null
          }
        : null;

    const room = {
      code,
      mode,
      aiDifficulty,
      mapSelection,
      resolvedMapId: null,
      phase: 'LOBBY',
      hostSlot: 0,
      players: [p0, p1],
      sim: null,
      aiBot: null,
      countdownEndMs: 0,
      lastCountdownBroadcastSec: 0,
      reconnectDeadlineMs: 0,
      lastReconnectBroadcastSec: 0,
      lastTickDurationMs: 0
    };

    this.rooms.set(code, room);
    this.wsToSession.set(ws, { roomCode: code, slot: 0 });

    if (mode === 'ai') {
      this._startCountdown(room);
    } else {
      this._broadcastRoomState(room);
    }
  }

  _handleSelectMap(ws, msg) {
    const session = this.wsToSession.get(ws);
    if (!session) {
      this._sendError(ws, 'NOT_IN_ROOM', '尚未加入房间');
      return;
    }
    const room = this.rooms.get(session.roomCode);
    if (!room || room.phase !== 'LOBBY') {
      this._sendError(ws, 'INVALID_PHASE', '仅等待阶段可切换地图');
      return;
    }
    if (session.slot !== room.hostSlot) {
      this._sendError(ws, 'NOT_HOST', '仅房主可以切换对战地图');
      return;
    }
    if (typeof msg.mapId !== 'string' || !isValidMapSelection(msg.mapId)) {
      this._sendError(ws, 'INVALID_MAP', '无效的地图选择');
      return;
    }
    room.mapSelection = msg.mapId;
    this._broadcastRoomState(room);
  }

  _handleJoinRoom(ws, msg) {
    const rawCode = typeof msg.roomCode === 'string' ? msg.roomCode.trim().toUpperCase() : '';
    const room = this.rooms.get(rawCode);
    if (!room) {
      this._sendError(ws, 'ROOM_NOT_FOUND', '未找到该房间码');
      return;
    }

    // Check reconnect token first
    if (typeof msg.reconnectToken === 'string' && msg.reconnectToken) {
      const matchPlayer = room.players.find(
        (p) => p && !p.isAI && p.reconnectToken === msg.reconnectToken
      );
      if (matchPlayer) {
        this._detachCurrentSocket(ws);
        if (matchPlayer.ws && matchPlayer.ws !== ws) {
          try {
            matchPlayer.ws.close(4000, 'Replaced by reconnect');
          } catch {
            // ignore
          }
        }
        matchPlayer.ws = ws;
        matchPlayer.connected = true;
        matchPlayer.viewMode = 'self';
        this.wsToSession.set(ws, { roomCode: room.code, slot: matchPlayer.slot });

        if (room.phase === 'PAUSED_RECONNECT') {
          const allHumanConnected = room.players.every((p) => !p || p.isAI || p.connected);
          if (allHumanConnected) {
            room.reconnectDeadlineMs = 0;
            if (room.sim) {
              room.phase = room.sim.phase === 'ENDED' ? 'ENDED' : 'PLAYING';
            } else {
              this._startCountdown(room);
              return;
            }
          }
        }
        this._broadcastRoomState(room);
        if (room.sim) {
          this._broadcastSnapshot(room, []);
        }
        return;
      }
    }

    // Normal join into open slot
    const openSlot = room.players.findIndex((p) => p === null);
    if (openSlot === -1) {
      this._sendError(ws, 'ROOM_FULL', '该房间已满（2/2）');
      return;
    }

    if (room.phase !== 'LOBBY') {
      this._sendError(ws, 'GAME_IN_PROGRESS', '对局已开始，无法作为新玩家加入');
      return;
    }

    this._detachCurrentSocket(ws);
    const nickname = sanitizeNickname(msg.nickname, openSlot === 0 ? '草莓玩家' : '薄荷玩家');
    const playerId = typeof msg.playerId === 'string' && msg.playerId ? msg.playerId : makeToken();
    const reconnectToken =
      typeof msg.reconnectToken === 'string' && msg.reconnectToken
        ? msg.reconnectToken
        : makeToken();

    room.players[openSlot] = {
      slot: openSlot,
      playerId,
      reconnectToken,
      nickname,
      ready: false,
      connected: true,
      isAI: false,
      rematchReady: false,
      viewMode: 'self',
      skippedSnapshots: 0,
      ws
    };
    this.wsToSession.set(ws, { roomCode: room.code, slot: openSlot });
    this._broadcastRoomState(room);
  }

  _handlePlayerReady(ws, msg) {
    const session = this.wsToSession.get(ws);
    if (!session) {
      this._sendError(ws, 'NOT_IN_ROOM', '尚未加入房间');
      return;
    }
    const room = this.rooms.get(session.roomCode);
    if (!room || room.phase !== 'LOBBY') {
      this._sendError(ws, 'INVALID_PHASE', '当前阶段无法切换准备状态');
      return;
    }
    const player = room.players[session.slot];
    if (!player) return;
    player.ready = Boolean(msg.ready);

    const bothPresent = room.players[0] && room.players[1];
    const bothReady = bothPresent && room.players[0].ready && room.players[1].ready;
    if (bothReady) {
      this._startCountdown(room);
    } else {
      this._broadcastRoomState(room);
    }
  }

  _handleGameplayAction(ws, msg) {
    const session = this.wsToSession.get(ws);
    if (!session) {
      this._sendError(ws, 'NOT_IN_ROOM', '尚未加入房间');
      return;
    }
    const room = this.rooms.get(session.roomCode);
    if (!room || !room.sim || room.phase !== 'PLAYING') {
      this._sendError(ws, 'INVALID_PHASE', '当前不在可操作战斗阶段');
      return;
    }
    const result = room.sim.applyPlayerAction(session.slot, msg);
    if (!result.ok) {
      this._sendError(ws, result.code, result.message);
      return;
    }
    // Push immediate snapshot feedback for responsive UI
    this._broadcastSnapshot(room, room.sim.tickEvents);
    room.sim.tickEvents = [];
  }

  _handleRematchRequest(ws) {
    const session = this.wsToSession.get(ws);
    if (!session) {
      this._sendError(ws, 'NOT_IN_ROOM', '尚未加入房间');
      return;
    }
    const room = this.rooms.get(session.roomCode);
    if (!room || room.phase !== 'ENDED') {
      this._sendError(ws, 'INVALID_PHASE', '对局尚未结束');
      return;
    }
    const player = room.players[session.slot];
    if (!player) return;
    player.rematchReady = true;

    const allAgreed = room.players.every((p) => p && (p.isAI || p.rematchReady));
    if (allAgreed) {
      this._startCountdown(room);
    } else {
      this._broadcastRoomState(room);
    }
  }

  _handleTestCommand(ws, msg) {
    if (!this.allowTestHooks) {
      this._sendError(ws, 'TEST_HOOKS_DISABLED', '测试钩子未开启');
      return;
    }
    const session = this.wsToSession.get(ws);
    if (!session) {
      this._sendError(ws, 'NOT_IN_ROOM', '尚未加入房间');
      return;
    }
    const room = this.rooms.get(session.roomCode);
    if (!room) {
      this._sendError(ws, 'ROOM_NOT_FOUND', '房间不存在');
      return;
    }

    const action = msg.action;
    const payload = msg.payload || {};
    let resultData = null;

    switch (action) {
      case 'getSnapshot': {
        resultData = room.sim
          ? room.sim.getTestSnapshot(session.slot)
          : {
              type: 'game_snapshot',
              phase: room.phase,
              roomCode: room.code,
              mapSelection: room.mapSelection,
              mapId: room.resolvedMapId,
              tick: 0
            };
        break;
      }
      case 'setSeed': {
        if (!room.sim) {
          this._sendError(ws, 'SIM_NOT_READY', '仿真尚未开始');
          return;
        }
        room.sim.setSeed(payload.seed);
        resultData = { seed: room.sim.seed };
        break;
      }
      case 'grantResources': {
        if (!room.sim) {
          this._sendError(ws, 'SIM_NOT_READY', '仿真尚未开始');
          return;
        }
        const targetSlot = payload.target === 'opponent' ? 1 - session.slot : session.slot;
        room.sim.grantResources({
          targetSlot,
          gold: payload.gold,
          eco: payload.eco,
          hp: payload.hp
        });
        this._broadcastSnapshot(room, []);
        resultData = { targetSlot };
        break;
      }
      case 'jumpWave': {
        if (!room.sim) {
          this._sendError(ws, 'SIM_NOT_READY', '仿真尚未开始');
          return;
        }
        const w = room.sim.jumpWave(payload.waveNum);
        this._broadcastSnapshot(room, room.sim.tickEvents);
        room.sim.tickEvents = [];
        resultData = { wave: w };
        break;
      }
      case 'spawnStress': {
        if (!room.sim) {
          this._sendError(ws, 'SIM_NOT_READY', '仿真尚未开始');
          return;
        }
        resultData = room.sim.spawnStress(payload);
        this._broadcastSnapshot(room, []);
        break;
      }
      case 'fastForwardTicks': {
        if (room.phase === 'COUNTDOWN') {
          this._beginPlaying(room);
        }
        if (!room.sim) {
          this._sendError(ws, 'SIM_NOT_READY', '仿真尚未开始');
          return;
        }
        const count = Math.min(20000, Math.max(1, Math.floor(Number(payload.ticks) || 1)));
        const allEvents = [];
        for (let i = 0; i < count; i++) {
          if (room.phase !== 'PLAYING') break;
          if (room.aiBot) room.aiBot.onTick(room.sim, 1);
          const evs = room.sim.step();
          allEvents.push(...evs);
          if (room.sim.phase === 'ENDED') {
            room.phase = 'ENDED';
            this._broadcastRoomState(room);
            break;
          }
        }
        this._broadcastSnapshot(room, allEvents.slice(-24));
        resultData = { tick: room.sim.tick, phase: room.phase, mapId: room.sim.mapId };
        break;
      }
      case 'simulateDisconnect': {
        const targetSlot = payload.target === 'self' ? session.slot : 1 - session.slot;
        const targetPlayer = room.players[targetSlot];
        if (!targetPlayer) {
          this._sendError(ws, 'PLAYER_NOT_FOUND', '目标玩家不存在');
          return;
        }
        const remainMs =
          typeof payload.remainMs === 'number'
            ? Math.max(200, Math.min(RECONNECT_GRACE_MS, payload.remainMs))
            : RECONNECT_GRACE_MS;

        if (targetPlayer.ws) {
          this.wsToSession.delete(targetPlayer.ws);
          try {
            targetPlayer.ws.close(4001, 'Simulated disconnect');
          } catch {
            // ignore
          }
          targetPlayer.ws = null;
        }
        targetPlayer.connected = false;
        if (room.phase === 'COUNTDOWN' || room.phase === 'PLAYING' || room.phase === 'PAUSED_RECONNECT') {
          room.phase = 'PAUSED_RECONNECT';
          room.reconnectDeadlineMs = Date.now() + remainMs;
          room.lastReconnectBroadcastSec = Math.ceil(remainMs / 1000);
          this._broadcastRoomState(room);
        }
        resultData = { targetSlot, phase: room.phase, remainMs };
        break;
      }
      default:
        this._sendError(ws, 'UNKNOWN_TEST_ACTION', `未知测试指令: ${action}`);
        return;
    }

    this._send(ws, {
      type: 'test_command_result',
      requestId: msg.requestId || null,
      action,
      ok: true,
      data: resultData
    });
  }

  handleDisconnect(ws) {
    this._leaveCurrentRoom(ws, { intentional: false });
  }
}
