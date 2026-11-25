import type {
  ArchetypeId,
  ClientMessage,
  CourtId,
  InputPhase,
  MatchFormat,
  PlayerIndex,
  ScorePatch,
  ShotActionKey,
  TestCommandPayload,
} from '@court2k/shared';

const VALID_COURTS = new Set<CourtId>(['hard', 'clay', 'grass']);
const VALID_FORMATS = new Set<MatchFormat>(['fast4', 'super_tiebreak']);
const VALID_ARCHETYPES = new Set<ArchetypeId>(['power', 'allcourt', 'serve_volley', 'defender']);
const VALID_ACTIONS = new Set<ShotActionKey>(['none', 'J', 'K', 'L']);
const VALID_PHASES = new Set<InputPhase>(['idle', 'hold', 'release']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPlayerIndex(value: unknown): value is PlayerIndex {
  return value === 0 || value === 1;
}

function isTuple2NonNegInt(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isNonNegativeInt(value[0]) &&
    isNonNegativeInt(value[1])
  );
}

function parseScorePatch(raw: unknown): ScorePatch | null {
  if (!isRecord(raw)) {
    return null;
  }
  const patch: ScorePatch = {};
  if (raw.games !== undefined) {
    if (!isTuple2NonNegInt(raw.games)) return null;
    patch.games = [raw.games[0], raw.games[1]];
  }
  if (raw.points !== undefined) {
    if (!isTuple2NonNegInt(raw.points)) return null;
    patch.points = [raw.points[0], raw.points[1]];
  }
  if (raw.isTiebreak !== undefined) {
    if (typeof raw.isTiebreak !== 'boolean') return null;
    patch.isTiebreak = raw.isTiebreak;
  }
  if (raw.server !== undefined) {
    if (!isPlayerIndex(raw.server)) return null;
    patch.server = raw.server;
  }
  if (raw.serveNumber !== undefined) {
    if (raw.serveNumber !== 1 && raw.serveNumber !== 2) return null;
    patch.serveNumber = raw.serveNumber;
  }
  return patch;
}

function parseTestCommand(raw: unknown): TestCommandPayload | null {
  if (!isRecord(raw) || typeof raw.cmd !== 'string' || !isRecord(raw.args)) {
    return null;
  }

  switch (raw.cmd) {
    case 'set_seed': {
      if (!isFiniteNumber(raw.args.seed)) return null;
      return { cmd: 'set_seed', args: { seed: Math.trunc(raw.args.seed) >>> 0 } };
    }
    case 'set_score': {
      const patch = parseScorePatch(raw.args);
      if (!patch) return null;
      return { cmd: 'set_score', args: patch };
    }
    case 'set_takeover': {
      if (!isPlayerIndex(raw.args.playerIndex) || !isFiniteNumber(raw.args.value)) return null;
      return {
        cmd: 'set_takeover',
        args: { playerIndex: raw.args.playerIndex, value: clamp(raw.args.value, 0, 100) },
      };
    }
    case 'trigger_hawkeye': {
      if (typeof raw.args.inBounds !== 'boolean' || !isFiniteNumber(raw.args.distCm)) {
        return null;
      }
      if (raw.args.distCm < 0) return null;
      const line = raw.args.line;
      if (line !== undefined && line !== 'sideline' && line !== 'baseline') {
        return null;
      }
      return {
        cmd: 'trigger_hawkeye',
        args: { inBounds: raw.args.inBounds, distCm: raw.args.distCm, line },
      };
    }
    case 'fast_forward_pause': {
      if (!isFiniteNumber(raw.args.seconds) || raw.args.seconds < 0) return null;
      return { cmd: 'fast_forward_pause', args: { seconds: raw.args.seconds } };
    }
    default:
      return null;
  }
}

export type ParseClientMessageResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; reason: string };

/**
 * Parse and validate an incoming raw WebSocket text frame against the ClientMessage contract.
 */
export function parseClientMessage(rawText: string): ParseClientMessageResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, reason: 'Malformed JSON payload' };
  }

  if (!isRecord(parsed) || typeof parsed.type !== 'string' || !isRecord(parsed.payload)) {
    return { ok: false, reason: 'Message must be an object with string type and object payload' };
  }

  const p = parsed.payload;

  switch (parsed.type) {
    case 'CREATE_ROOM': {
      if (
        !VALID_COURTS.has(p.court as CourtId) ||
        !VALID_FORMATS.has(p.format as MatchFormat) ||
        !VALID_ARCHETYPES.has(p.archetype as ArchetypeId)
      ) {
        return { ok: false, reason: 'Invalid CREATE_ROOM parameters' };
      }
      return {
        ok: true,
        message: {
          type: 'CREATE_ROOM',
          payload: {
            court: p.court as CourtId,
            format: p.format as MatchFormat,
            archetype: p.archetype as ArchetypeId,
          },
        },
      };
    }

    case 'JOIN_ROOM': {
      if (typeof p.roomCode !== 'string' || !VALID_ARCHETYPES.has(p.archetype as ArchetypeId)) {
        return { ok: false, reason: 'Invalid JOIN_ROOM parameters' };
      }
      const code = p.roomCode.trim().toUpperCase();
      if (code.length !== 4) {
        return { ok: false, reason: 'Room code must be 4 characters' };
      }
      return {
        ok: true,
        message: {
          type: 'JOIN_ROOM',
          payload: { roomCode: code, archetype: p.archetype as ArchetypeId },
        },
      };
    }

    case 'RECONNECT': {
      if (typeof p.roomCode !== 'string' || typeof p.sessionToken !== 'string') {
        return { ok: false, reason: 'Invalid RECONNECT parameters' };
      }
      const code = p.roomCode.trim().toUpperCase();
      const token = p.sessionToken.trim();
      if (code.length !== 4 || token.length === 0) {
        return { ok: false, reason: 'Invalid RECONNECT roomCode or sessionToken' };
      }
      return {
        ok: true,
        message: {
          type: 'RECONNECT',
          payload: { roomCode: code, sessionToken: token },
        },
      };
    }

    case 'SELECT_LOADOUT': {
      if (!VALID_ARCHETYPES.has(p.archetype as ArchetypeId)) {
        return { ok: false, reason: 'Invalid archetype in SELECT_LOADOUT' };
      }
      if (p.court !== undefined && !VALID_COURTS.has(p.court as CourtId)) {
        return { ok: false, reason: 'Invalid court in SELECT_LOADOUT' };
      }
      if (p.format !== undefined && !VALID_FORMATS.has(p.format as MatchFormat)) {
        return { ok: false, reason: 'Invalid format in SELECT_LOADOUT' };
      }
      return {
        ok: true,
        message: {
          type: 'SELECT_LOADOUT',
          payload: {
            archetype: p.archetype as ArchetypeId,
            court: p.court as CourtId | undefined,
            format: p.format as MatchFormat | undefined,
          },
        },
      };
    }

    case 'READY': {
      if (p.ready !== undefined && typeof p.ready !== 'boolean') {
        return { ok: false, reason: 'Invalid READY payload' };
      }
      return {
        ok: true,
        message: {
          type: 'READY',
          payload: { ready: p.ready as boolean | undefined },
        },
      };
    }

    case 'PLAYER_INPUT': {
      if (
        !isNonNegativeInt(p.seq) ||
        !isFiniteNumber(p.moveX) ||
        !isFiniteNumber(p.moveZ) ||
        !isFiniteNumber(p.aimX) ||
        !isFiniteNumber(p.aimZ) ||
        !VALID_ACTIONS.has(p.action as ShotActionKey) ||
        !VALID_PHASES.has(p.phase as InputPhase) ||
        !isFiniteNumber(p.clientTime)
      ) {
        return { ok: false, reason: 'Invalid PLAYER_INPUT fields' };
      }
      return {
        ok: true,
        message: {
          type: 'PLAYER_INPUT',
          payload: {
            seq: p.seq,
            moveX: clamp(p.moveX, -1, 1),
            moveZ: clamp(p.moveZ, -1, 1),
            aimX: clamp(p.aimX, -1, 1),
            aimZ: clamp(p.aimZ, -1, 1),
            action: p.action as ShotActionKey,
            phase: p.phase as InputPhase,
            clientTime: p.clientTime,
          },
        },
      };
    }

    case 'PAUSE_REQUEST':
      return { ok: true, message: { type: 'PAUSE_REQUEST', payload: {} } };

    case 'RESUME_REQUEST':
      return { ok: true, message: { type: 'RESUME_REQUEST', payload: {} } };

    case 'REMATCH_REQUEST':
      return { ok: true, message: { type: 'REMATCH_REQUEST', payload: {} } };

    case 'PING': {
      if (!isFiniteNumber(p.clientTime)) {
        return { ok: false, reason: 'Invalid PING clientTime' };
      }
      return { ok: true, message: { type: 'PING', payload: { clientTime: p.clientTime } } };
    }

    case 'TEST_COMMAND': {
      const cmdPayload = parseTestCommand(p);
      if (!cmdPayload) {
        return { ok: false, reason: 'Invalid TEST_COMMAND payload' };
      }
      return { ok: true, message: { type: 'TEST_COMMAND', payload: cmdPayload } };
    }

    default:
      return { ok: false, reason: `Unknown message type: ${parsed.type}` };
  }
}
