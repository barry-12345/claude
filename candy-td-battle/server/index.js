import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager } from './room-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

export function createCandyServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 3000);
  const host = options.host ?? process.env.HOST ?? '127.0.0.1';
  const allowTestHooks =
    options.allowTestHooks !== undefined
      ? Boolean(options.allowTestHooks)
      : process.env.CANDY_ALLOW_TEST_HOOKS === '1';

  const roomManager = new RoomManager({ allowTestHooks });

  const server = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      let reqPath = decodeURIComponent(urlObj.pathname);

      // Healthcheck endpoint
      if (reqPath === '/healthz' || reqPath.endsWith('/healthz')) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, allowTestHooks }));
        return;
      }

      if (reqPath.endsWith('/')) {
        reqPath += 'index.html';
      }

      // Normalize relative path & block directory traversal
      const cleanRel = path.posix.normalize(reqPath).replace(/^\/+/, '');
      if (cleanRel.startsWith('..') || cleanRel.includes('\0')) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      let filePath = path.resolve(PUBLIC_DIR, cleanRel);
      if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      try {
        const stat = await fs.stat(filePath);
        if (stat.isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }
      } catch {
        // Fallback: if deployed under unstripped subpath (e.g. /candy-td/js/main.js), strip first segment and check
        const parts = cleanRel.split('/');
        if (parts.length > 1) {
          const strippedRel = parts.slice(1).join('/');
          const candidate = path.resolve(PUBLIC_DIR, strippedRel);
          if (candidate.startsWith(PUBLIC_DIR)) {
            filePath = candidate;
          }
        }
      }

      const data = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
      }
    }
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    try {
      const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = urlObj.pathname;
      if (pathname === '/ws' || pathname.endsWith('/ws')) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      } else {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
      }
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      roomManager.handleMessage(ws, data);
    });
    ws.on('close', () => {
      roomManager.handleDisconnect(ws);
    });
    ws.on('error', () => {
      roomManager.handleDisconnect(ws);
    });
  });

  return {
    server,
    wss,
    roomManager,
    start() {
      return new Promise((resolve) => {
        roomManager.startLoop();
        server.listen(port, host, () => {
          const addr = server.address();
          resolve(typeof addr === 'object' && addr ? addr.port : port);
        });
      });
    },
    stop() {
      return new Promise((resolve) => {
        roomManager.stopLoop();
        for (const client of wss.clients) {
          try {
            client.terminate();
          } catch {
            // ignore
          }
        }
        wss.close(() => {
          if (typeof server.closeAllConnections === 'function') {
            server.closeAllConnections();
          }
          server.close(() => resolve());
        });
      });
    }
  };
}

// Run when executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const candy = createCandyServer();
  const port = await candy.start();
  console.log(
    `[candy-td-battle] Server listening on http://127.0.0.1:${port} (testHooks=${process.env.CANDY_ALLOW_TEST_HOOKS === '1'})`
  );

  const shutdown = async () => {
    await candy.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
