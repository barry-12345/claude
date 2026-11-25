import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCourt2kServer } from './server.js';

export { loadConfig, normalizeWsPath, type ServerConfig } from './config.js';
export { ConnectionRateLimiter } from './rateLimiter.js';
export { Room } from './room.js';
export { RoomManager, type TickMetrics } from './roomManager.js';
export { createCourt2kServer, type Court2kServerInstance } from './server.js';
export { parseClientMessage, type ParseClientMessageResult } from './validation.js';

const isEntrypoint =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint) {
  const server = createCourt2kServer();
  server
    .start()
    .then((port) => {
      console.log(
        `[court2k-server] listening on http://${server.config.host}:${port} (wsPath=${server.config.wsPath}, testHooks=${server.config.enableTestHooks})`
      );
    })
    .catch((err) => {
      console.error('[court2k-server] failed to start:', err);
      process.exit(1);
    });

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}
