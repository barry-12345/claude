export interface ServerConfig {
  port: number;
  host: string;
  wsPath: string;
  enableTestHooks: boolean;
  emptyRoomTtlMs: number;
  idleRoomTtlMs: number;
  rateLimitMaxPerSec: number;
}

export function normalizeWsPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed === '/') {
    return '/ws';
  }
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.length > 1 && withLeading.endsWith('/')
    ? withLeading.slice(0, -1)
    : withLeading;
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const envPort = process.env.PORT;
  const parsedPort = envPort !== undefined ? Number(envPort) : 3301;
  const port =
    overrides.port ??
    (Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535 ? parsedPort : 3301);

  return {
    port,
    host: overrides.host ?? process.env.HOST ?? '0.0.0.0',
    wsPath: normalizeWsPath(overrides.wsPath ?? process.env.WS_PATH ?? '/ws'),
    enableTestHooks: overrides.enableTestHooks ?? process.env.ENABLE_TEST_HOOKS === '1',
    emptyRoomTtlMs: overrides.emptyRoomTtlMs ?? 60_000,
    idleRoomTtlMs: overrides.idleRoomTtlMs ?? 600_000,
    rateLimitMaxPerSec: overrides.rateLimitMaxPerSec ?? 120,
  };
}
