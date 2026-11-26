const STORAGE_KEY = 'candy_td_session_v1';

export class NetClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this._connectPromise = null;
    this.rttMs = 0;
    this.serverTickMs = 0;
    this.pingTimer = null;
    this.handlers = {
      onRoomState: () => {},
      onSnapshot: () => {},
      onEvents: () => {},
      onError: () => {},
      onConnectionChange: () => {}
    };
    this.pendingTestRequests = new Map();
    this.reqSeq = 1;
    this.session = this._loadSession();
  }

  _loadSession() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  saveSession(patch) {
    this.session = { ...this.session, ...patch };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.session));
    } catch {
      // ignore
    }
  }

  clearRoomSession() {
    this.session = { nickname: this.session.nickname || '' };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.session));
    } catch {
      // ignore
    }
  }

  getWsUrl() {
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const basePath = location.pathname.replace(/\/[^/]*$/, '/');
    return `${wsProto}//${location.host}${basePath}ws`;
  }

  connect({ timeoutMs = 6000 } = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this._connectPromise && this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      return this._connectPromise;
    }

    let promise;
    promise = new Promise((resolve, reject) => {
      let ws;
      let settled = false;
      let connectTimer = null;

      const clearConnectTimer = () => {
        if (connectTimer !== null) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }
      };

      const failConnect = (err) => {
        if (settled) return;
        settled = true;
        clearConnectTimer();
        this.connected = false;
        if (this._connectPromise === promise) {
          this._connectPromise = null;
        }
        if (this.ws === ws) {
          this.ws = null;
        }
        try {
          if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
            ws.close();
          }
        } catch {
          // ignore close errors during cleanup
        }
        reject(err instanceof Error ? err : new Error(String(err || 'WS_CONNECT_ERROR')));
      };

      try {
        ws = new WebSocket(this.getWsUrl());
      } catch (err) {
        failConnect(err);
        return;
      }

      this.ws = ws;

      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        connectTimer = setTimeout(() => {
          failConnect(new Error('WS_CONNECT_TIMEOUT'));
        }, timeoutMs);
      }

      ws.addEventListener('open', () => {
        if (settled) {
          try {
            ws.close();
          } catch {
            // ignore
          }
          return;
        }
        settled = true;
        clearConnectTimer();
        if (this._connectPromise === promise) {
          this._connectPromise = null;
        }
        this.connected = true;
        this.handlers.onConnectionChange(true);
        this._startPing();
        resolve();
      });

      ws.addEventListener('message', (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        this._dispatch(msg);
      });

      ws.addEventListener('close', () => {
        const isCurrentWs = this.ws === ws;
        if (isCurrentWs) {
          this.connected = false;
          this._stopPing();
          this.ws = null;
        }
        if (!settled) {
          failConnect(new Error('WS_CONNECT_CLOSED'));
        }
        if (isCurrentWs) {
          this.handlers.onConnectionChange(false);
        }
      });

      ws.addEventListener('error', (err) => {
        if (!settled) {
          failConnect(err instanceof Error ? err : new Error('WS_CONNECT_ERROR'));
        }
      });
    });

    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      this._connectPromise = promise;
    }
    return promise;
  }

  _startPing() {
    this._stopPing();
    const sendPing = () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping', clientTime: Date.now() });
      }
    };
    sendPing();
    this.pingTimer = setInterval(sendPing, 2000);
  }

  _stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  _dispatch(msg) {
    switch (msg.type) {
      case 'pong':
        this.rttMs = Math.max(0, Date.now() - (msg.clientTime || Date.now()));
        this.serverTickMs = msg.serverTickMs || 0;
        break;
      case 'room_state':
        this.saveSession({
          roomCode: msg.roomCode,
          playerId: msg.playerId,
          reconnectToken: msg.reconnectToken
        });
        this.handlers.onRoomState(msg);
        break;
      case 'game_snapshot':
        this.handlers.onSnapshot(msg);
        break;
      case 'game_event':
        this.handlers.onEvents(msg.events || []);
        break;
      case 'action_error':
        for (const [id, pending] of this.pendingTestRequests.entries()) {
          if (msg.code === 'TEST_HOOKS_DISABLED' || msg.code === 'UNKNOWN_TEST_ACTION') {
            this.pendingTestRequests.delete(id);
            pending.reject(new Error(`${msg.code}: ${msg.message}`));
          }
        }
        this.handlers.onError(msg);
        break;
      case 'test_command_result': {
        const pending = this.pendingTestRequests.get(msg.requestId);
        if (pending) {
          this.pendingTestRequests.delete(msg.requestId);
          pending.resolve(msg.data);
        }
        break;
      }
      default:
        break;
    }
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  sendTestCommand(action, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WS_NOT_CONNECTED'));
        return;
      }
      const requestId = `req_${this.reqSeq++}`;
      const timer = setTimeout(() => {
        this.pendingTestRequests.delete(requestId);
        reject(new Error(`TEST_COMMAND_TIMEOUT: ${action}`));
      }, 4000);

      this.pendingTestRequests.set(requestId, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });

      this.send({ type: 'test_command', requestId, action, payload });
    });
  }
}
