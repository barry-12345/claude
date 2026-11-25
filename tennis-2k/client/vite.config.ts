import { defineConfig } from 'vite';

function normalizeBase(raw?: string): string {
  if (!raw || raw === '/') return '/';
  let b = raw.trim();
  if (!b.startsWith('/')) b = `/${b}`;
  if (!b.endsWith('/')) b = `${b}/`;
  return b;
}

const base = normalizeBase(process.env.VITE_BASE_PATH);
const wsTarget = process.env.VITE_WS_PROXY_TARGET || 'http://127.0.0.1:3301';

export default defineConfig({
  base,
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT || 3201),
    strictPort: true,
    proxy: {
      [`${base}ws`]: {
        target: wsTarget,
        ws: true,
        changeOrigin: true,
      },
      [`${base}health`]: {
        target: wsTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: Number(process.env.PORT || 3201),
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
