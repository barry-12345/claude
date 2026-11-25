import type {
  ArchetypeId,
  ClientMessage,
  CourtId,
  MatchFormat,
  PlayerIndex,
  PlayerInputFrame,
  PlayerSide,
  ServerMessage,
  TestCommandPayload,
} from '@court2k/shared';

export interface StoredSession {
  roomCode: string;
  sessionToken: string;
  playerIndex: PlayerIndex;
  yourSide: PlayerSide;
}

export interface WebSocketLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export type WsFactory = (url: string) => WebSocketLike;

const SESSION_STORAGE_KEY = 'court2k_online_session';

export function normalizeBaseUrl(raw?: string): string {
  if (!raw || raw === '/') return '/';
  let b = raw.trim();
  if (!b.startsWith('/')) b = `/${b}`;
  if (!b.endsWith('/')) b = `${b}/`;
  return b;
}

export function deriveWsUrl(
  baseUrl = '/',
  loc: { protocol: string; host: string } | null = typeof window !== 'undefined' ? window.location : null
): string {
  const base = normalizeBaseUrl(baseUrl);
  if (!loc) return `${base}ws`;
  const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProto}//${loc.host}${base}ws`;
}

export interface WsClientHandlers {
  onMessage: (msg: ServerMessage) => void;
  onConnectionChange?: (connected: boolean) => void;
  onReconnectCountChange?: (count: number) => void;
  onRttChange?: (rttMs: number) => void;
}

export class WsClient {
  private readonly wsUrl: string;
  private readonly factory: WsFactory;
  private readonly handlers: WsClientHandlers;
  private readonly storage: Storage | null;

  private ws: WebSocketLike | null = null;
  private connected = false;
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectCount = 0;
  private rttMs = 0;
  private inputSeq = 0;
  private session: StoredSession | null = null;
  private pendingOnOpen: ClientMessage[] = [];

  constructor(
    handlers: WsClientHandlers,
    opts?: {
      wsUrl?: string;
      factory?: WsFactory;
      storage?: Storage | null;
    }
  ) {
    const base = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.BASE_URL : '/';
    this.wsUrl = opts?.wsUrl ?? deriveWsUrl(base);
    this.factory = opts?.factory ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.handlers = handlers;
    this.storage =
      opts?.storage !== undefined
        ? opts.storage
        : typeof sessionStorage !== 'undefined'
          ? sessionStorage
          : null;
    this.session = this.loadSession();
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public getReconnectCount(): number {
    return this.reconnectCount;
  }

  public getRttMs(): number {
    return this.rttMs;
  }

  public getSession(): StoredSession | null {
    return this.session;
  }

  public hasStoredSession(): boolean {
    return this.loadSession() !== null;
  }

  public resetInputSeq(): void {
    this.inputSeq = 0;
  }

  public nextSeq(): number {
    this.inputSeq += 1;
    return this.inputSeq;
  }

  public connect(autoReconnectSession = false): void {
    this.clearReconnectTimer();
    this.intentionalClose = false;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
      return;
    }

    const socket = this.factory(this.wsUrl);
    this.ws = socket;

    socket.onopen = () => {
      this.connected = true;
      this.handlers.onConnectionChange?.(true);
      this.startPingLoop();

      if (autoReconnectSession && this.session) {
        this.send({
          type: 'RECONNECT',
          payload: {
            roomCode: this.session.roomCode,
            sessionToken: this.session.sessionToken,
          },
        });
      }

      while (this.pendingOnOpen.length > 0) {
        const msg = this.pendingOnOpen.shift();
        if (msg) this.send(msg);
      }
    };

    socket.onmessage = (ev) => {
      let parsed: ServerMessage;
      try {
        parsed = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }

      if (parsed.type === 'PONG') {
        this.rttMs = Math.max(0, Math.round(Date.now() - parsed.payload.clientTime));
        this.handlers.onRttChange?.(this.rttMs);
        return;
      }

      if (parsed.type === 'ROOM_CREATED' || parsed.type === 'ROOM_JOINED') {
        this.saveSession({
          roomCode: parsed.payload.roomCode,
          sessionToken: parsed.payload.sessionToken,
          playerIndex: parsed.payload.playerIndex,
          yourSide: parsed.payload.yourSide,
        });
      } else if (parsed.type === 'MATCH_START') {
        this.resetInputSeq();
      } else if (parsed.type === 'FULL_SYNC') {
        this.resetInputSeq();
        if (this.session) {
          this.saveSession({
            ...this.session,
            roomCode: parsed.payload.roomCode,
            playerIndex: parsed.payload.playerIndex,
            yourSide: parsed.payload.yourSide,
          });
        }
      } else if (parsed.type === 'ERROR' && parsed.payload.code === 'INVALID_TOKEN') {
        this.clearSession();
      }

      this.handlers.onMessage(parsed);
    };

    socket.onclose = () => {
      if (this.ws !== socket) {
        return;
      }
      this.stopPingLoop();
      const wasConnected = this.connected;
      this.connected = false;
      this.ws = null;
      if (wasConnected) {
        this.handlers.onConnectionChange?.(false);
      }
      if (!this.intentionalClose && this.session) {
        this.scheduleAutoReconnect(1200);
      }
    };

    socket.onerror = () => {
      // Handled via onclose
    };
  }

  public disconnect(clearStored = true): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.stopPingLoop();
    this.pendingOnOpen = [];
    if (clearStored) {
      this.clearSession();
    }
    if (this.ws) {
      const oldWs = this.ws;
      this.ws = null;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onclose = null;
      oldWs.onerror = null;
      try {
        oldWs.close();
      } catch {
        // ignore
      }
    }
    if (this.connected) {
      this.connected = false;
      this.handlers.onConnectionChange?.(false);
    }
  }

  /**
   * Controlled test helper to simulate connection drop and optional reconnect delay (-1 = stay dropped).
   */
  public simulateDisconnect(reconnectAfterMs: number): void {
    this.clearReconnectTimer();
    this.stopPingLoop();
    this.intentionalClose = reconnectAfterMs < 0;
    if (this.ws) {
      const oldWs = this.ws;
      this.ws = null;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onclose = null;
      oldWs.onerror = null;
      try {
        oldWs.close();
      } catch {
        // ignore
      }
    }
    this.connected = false;
    this.handlers.onConnectionChange?.(false);

    if (reconnectAfterMs >= 0 && this.session) {
      this.scheduleAutoReconnect(reconnectAfterMs);
    }
  }

  public send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
    } else if (msg.type === 'CREATE_ROOM' || msg.type === 'JOIN_ROOM' || msg.type === 'RECONNECT') {
      this.pendingOnOpen.push(msg);
      this.connect(false);
    }
  }

  public createRoom(court: CourtId, format: MatchFormat, archetype: ArchetypeId): void {
    this.clearSession();
    this.send({ type: 'CREATE_ROOM', payload: { court, format, archetype } });
  }

  public joinRoom(roomCode: string, archetype: ArchetypeId): void {
    this.clearSession();
    this.send({
      type: 'JOIN_ROOM',
      payload: { roomCode: roomCode.trim().toUpperCase(), archetype },
    });
  }

  public selectLoadout(archetype: ArchetypeId, court?: CourtId, format?: MatchFormat): void {
    this.send({ type: 'SELECT_LOADOUT', payload: { archetype, court, format } });
  }

  public setReady(ready: boolean): void {
    this.send({ type: 'READY', payload: { ready } });
  }

  public sendPlayerInput(frame: PlayerInputFrame): void {
    this.send({
      type: 'PLAYER_INPUT',
      payload: { ...frame, clientTime: Date.now() },
    });
  }

  public requestPause(): void {
    this.send({ type: 'PAUSE_REQUEST', payload: {} });
  }

  public requestResume(): void {
    this.send({ type: 'RESUME_REQUEST', payload: {} });
  }

  public requestRematch(): void {
    this.send({ type: 'REMATCH_REQUEST', payload: {} });
  }

  public sendTestCommand(payload: TestCommandPayload): void {
    this.send({ type: 'TEST_COMMAND', payload });
  }

  public clearSession(): void {
    this.session = null;
    try {
      this.storage?.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  private saveSession(session: StoredSession): void {
    this.session = session;
    try {
      this.storage?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // ignore
    }
  }

  private loadSession(): StoredSession | null {
    try {
      const raw = this.storage?.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredSession;
      if (parsed && parsed.roomCode && parsed.sessionToken) {
        return parsed;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private scheduleAutoReconnect(delayMs: number): void {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      if (!this.session) return;
      this.reconnectCount += 1;
      this.handlers.onReconnectCountChange?.(this.reconnectCount);
      this.connect(true);
    }, Math.max(50, delayMs));
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        this.send({ type: 'PING', payload: { clientTime: Date.now() } });
      }
    }, 2000);
  }

  private stopPingLoop(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
