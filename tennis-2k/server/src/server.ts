import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { loadConfig, type ServerConfig } from './config.js';
import { ConnectionRateLimiter } from './rateLimiter.js';
import { sendError } from './room.js';
import { RoomManager, type TickMetrics } from './roomManager.js';
import { parseClientMessage } from './validation.js';

export interface Court2kServerInstance {
  readonly config: ServerConfig;
  readonly httpServer: HttpServer;
  readonly wss: WebSocketServer;
  readonly roomManager: RoomManager;
  getPort(): number;
  getMetrics(): TickMetrics;
  start(): Promise<number>;
  stop(): Promise<void>;
}

function extractPathname(rawUrl: string | undefined): string {
  try {
    return new URL(rawUrl ?? '/', 'http://127.0.0.1').pathname;
  } catch {
    return '/';
  }
}

function isHealthPath(pathname: string): boolean {
  return pathname === '/health' || pathname.endsWith('/health');
}

function isWsUpgradePath(pathname: string, configuredWsPath: string): boolean {
  if (pathname === configuredWsPath || pathname === '/ws' || pathname.endsWith('/ws')) {
    return true;
  }
  if (configuredWsPath !== '/' && pathname.endsWith(configuredWsPath)) {
    return true;
  }
  return false;
}

export function createCourt2kServer(overrides: Partial<ServerConfig> = {}): Court2kServerInstance {
  const config = loadConfig(overrides);
  const roomManager = new RoomManager(config);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  const handleHttpRequest = (req: IncomingMessage, res: ServerResponse) => {
    const pathname = extractPathname(req.url);
    if (req.method === 'GET' && isHealthPath(pathname)) {
      const rssMb = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1));
      const body = JSON.stringify({
        status: 'ok',
        rooms: roomManager.getRoomCount(),
        uptimeSec: Math.floor(process.uptime()),
        rssMb,
      });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  };

  const httpServer = createServer(handleHttpRequest);

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = extractPathname(req.url);
    if (!isWsUpgradePath(pathname, config.wsPath)) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    const rateLimiter = new ConnectionRateLimiter(config.rateLimitMaxPerSec);

    ws.on('message', (data, isBinary) => {
      const nowMs = Date.now();
      const rateCheck = rateLimiter.check(nowMs);
      if (!rateCheck.allowed) {
        if (rateCheck.shouldSendError) {
          sendError(ws, 'RATE_LIMITED', '发送频率过高，已限流');
        }
        return;
      }

      if (isBinary) {
        sendError(ws, 'INVALID_MESSAGE', 'Binary frames are not supported');
        return;
      }

      const rawText = typeof data === 'string' ? data : data.toString('utf8');
      const parsed = parseClientMessage(rawText);
      if (!parsed.ok) {
        sendError(ws, 'INVALID_MESSAGE', parsed.reason);
        return;
      }

      roomManager.handleMessage(ws, parsed.message);
    });

    ws.on('close', () => {
      roomManager.handleSocketClose(ws);
    });

    ws.on('error', () => {
      roomManager.handleSocketClose(ws);
    });
  });

  return {
    config,
    httpServer,
    wss,
    roomManager,
    getPort(): number {
      const addr = httpServer.address();
      if (addr && typeof addr === 'object') {
        return addr.port;
      }
      return config.port;
    },
    getMetrics(): TickMetrics {
      return roomManager.getMetrics();
    },
    start(): Promise<number> {
      return new Promise((resolve, reject) => {
        const onError = (err: Error) => {
          httpServer.off('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          httpServer.off('error', onError);
          roomManager.start();
          resolve(this.getPort());
        };
        httpServer.once('error', onError);
        httpServer.once('listening', onListening);
        httpServer.listen(config.port, config.host);
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve) => {
        roomManager.stop();
        for (const client of wss.clients) {
          try {
            client.terminate();
          } catch {
            // ignore
          }
        }
        wss.close(() => {
          if (httpServer.listening) {
            httpServer.close(() => resolve());
          } else {
            resolve();
          }
        });
      });
    },
  };
}
