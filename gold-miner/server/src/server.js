'use strict';
// 黄金矿工排行榜服务:只用 node:http,手写小路由。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadConfig } = require('./config');
const { openDb, makeQueries } = require('./db');
const { RateLimiter } = require('./ratelimit');
const { validateSubmission, loadBadWords, MODES } = require('./validate');
const { makeAdminOps, OpError } = require('./admin-ops');

const MAX_BODY = 2048;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
};

const sha = (s) => crypto.createHash('sha256').update(s).digest();

/**
 * 创建服务。opts.clock 可注入 { now() }(限流与 created_at 都用它)。
 * 返回 { server, db, listen(), close(), url() }。
 */
function createApp(config, opts = {}) {
  const clock = opts.clock || { now: Date.now };
  const db = openDb(config.dbPath, config.migrationsDir);
  const q = makeQueries(db);
  const badwords = loadBadWords(config.badwordsPath);
  const admin = makeAdminOps(db, { backupDir: config.backupDir, badwords });
  const postLimit = new RateLimiter([{ windowMs: 60_000, max: 5 }, { windowMs: 3_600_000, max: 30 }], () => clock.now());
  const getLimit = new RateLimiter([{ windowMs: 60_000, max: 120 }], () => clock.now());
  const authFailLimit = new RateLimiter([{ windowMs: 60_000, max: 10 }], () => clock.now());
  const adminHash = config.adminPassword ? sha(config.adminPassword) : null;

  function clientIp(req) {
    const addr = req.socket.remoteAddress || '';
    const local = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
    if (config.trustProxy && local) {
      const x = req.headers['x-real-ip'];
      if (typeof x === 'string' && x.trim()) return x.trim().slice(0, 64);
    }
    return addr;
  }

  function corsHeaders(req) {
    const origin = req.headers.origin;
    if (!origin || !config.corsOrigins.length) return {};
    if (config.corsOrigins.includes('*')) return { 'Access-Control-Allow-Origin': '*' };
    if (config.corsOrigins.includes(origin)) return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
    return {};
  }

  function send(req, res, status, body, extra = {}) {
    const buf = Buffer.from(JSON.stringify(body), 'utf8');
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(req),
      ...extra,
    });
    res.end(buf);
  }
  const fail = (req, res, status, error, extra) => send(req, res, status, { ok: false, error }, extra);

  function readJson(req) {
    return new Promise((resolve) => {
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') {
        req.resume();
        return resolve({ status: 415, error: 'bad_type' });
      }
      const len = Number(req.headers['content-length']);
      let size = 0;
      let tooLarge = Number.isFinite(len) && len > MAX_BODY;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) tooLarge = true;
        else chunks.push(c);
        if (size > 1_000_000) req.destroy();
      });
      req.on('error', () => resolve({ status: 400, error: 'bad_json' }));
      req.on('end', () => {
        if (tooLarge) return resolve({ status: 413, error: 'too_large' });
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve({ value: v });
        } catch {
          resolve({ status: 400, error: 'bad_json' });
        }
      });
    });
  }

  function rateLimited(req, res, limiter, key) {
    const r = limiter.take(key);
    if (r.ok) return false;
    fail(req, res, 429, 'rate_limited', { 'Retry-After': String(r.retryAfter) });
    return true;
  }

  async function handleApi(req, res, url) {
    const p = url.pathname;
    const method = req.method;
    const ip = clientIp(req);

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        ...corsHeaders(req),
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      });
      return res.end();
    }

    if (p === '/api/health') {
      if (method !== 'GET') return fail(req, res, 405, 'method_not_allowed', { Allow: 'GET, OPTIONS' });
      return send(req, res, 200, { ok: true });
    }

    if (p === '/api/leaderboard') {
      if (method !== 'GET') return fail(req, res, 405, 'method_not_allowed', { Allow: 'GET, OPTIONS' });
      if (rateLimited(req, res, getLimit, 'g:' + ip)) return;
      const mode = url.searchParams.get('mode');
      if (!MODES.includes(mode)) return fail(req, res, 400, 'bad_mode');
      return send(req, res, 200, { mode, entries: q.leaderboard(mode) });
    }

    if (p === '/api/scores') {
      if (method !== 'POST') return fail(req, res, 405, 'method_not_allowed', { Allow: 'POST, OPTIONS' });
      if (rateLimited(req, res, postLimit, 'p:' + ip)) return;
      const body = await readJson(req);
      if (body.error) return fail(req, res, body.status, body.error);
      const v = validateSubmission(body.value, badwords);
      if (!v.ok) return fail(req, res, 400, v.error);
      const r = q.submit(v.value, clock.now());
      if (r.ok) return send(req, res, 201, { ok: true, id: r.id, rank: r.rank });
      return send(req, res, 200, r);
    }

    if (p.startsWith('/api/admin/') || p === '/api/admin') return handleAdmin(req, res, url, ip);

    return fail(req, res, 404, 'not_found');
  }

  async function handleAdmin(req, res, url, ip) {
    if (!adminHash) return fail(req, res, 404, 'not_found'); // 未设置密码:接口关闭
    // 已处于"认证失败限流"状态的 IP:不再比较密码(正确密码也返回 429),防止暴力破解
    const locked = authFailLimit.peek('a:' + ip);
    if (!locked.ok) return fail(req, res, 429, 'rate_limited', { 'Retry-After': String(locked.retryAfter) });
    const m = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
    const ok = m ? crypto.timingSafeEqual(sha(m[1]), adminHash) : false;
    if (!ok) {
      authFailLimit.record('a:' + ip); // 只有失败才计数
      return fail(req, res, 401, 'unauthorized');
    }
    const p = url.pathname;
    const method = req.method;
    const wrap = async (fn) => {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof OpError) return fail(req, res, e.status, e.code);
        throw e;
      }
    };
    const readBody = async () => {
      const b = await readJson(req);
      if (b.error) throw new OpError(b.status, b.error);
      if (b.value === null || typeof b.value !== 'object' || Array.isArray(b.value)) throw new OpError(400, 'bad_json');
      return b.value;
    };

    if (p === '/api/admin/scores' && method === 'GET') {
      return wrap(() => {
        const mode = url.searchParams.get('mode') || undefined;
        const lim = url.searchParams.get('limit');
        const limit = lim === null ? 100 : /^\d+$/.test(lim) ? Number(lim) : NaN;
        return send(req, res, 200, { ok: true, entries: admin.list(mode, limit) });
      });
    }
    const idm = /^\/api\/admin\/scores\/(\d+)$/.exec(p);
    if (idm && method === 'DELETE') return wrap(() => send(req, res, 200, { ok: true, ...admin.del(Number(idm[1])) }));
    if (idm && method === 'PATCH') {
      return wrap(async () => {
        const b = await readBody();
        return send(req, res, 200, { ok: true, ...admin.rename(Number(idm[1]), b.name) });
      });
    }
    if (p === '/api/admin/archive' && method === 'POST') {
      return wrap(async () => {
        const b = await readBody();
        return send(req, res, 200, { ok: true, ...admin.archive(b.version, b.mode) });
      });
    }
    if (p === '/api/admin/clear' && method === 'POST') {
      return wrap(async () => {
        const b = await readBody();
        return send(req, res, 200, { ok: true, ...admin.clear(b) });
      });
    }
    return fail(req, res, 404, 'not_found');
  }

  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(req, res, 405, 'method_not_allowed');
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return fail(req, res, 400, 'bad_path');
    }
    if (rel.includes('\0')) return fail(req, res, 400, 'bad_path');
    if (rel.endsWith('/')) rel += 'index.html';
    const root = config.serveStatic;
    const file = path.resolve(root, '.' + path.sep + rel);
    if (file !== root && !file.startsWith(root + path.sep)) return fail(req, res, 403, 'forbidden');
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return fail(req, res, 404, 'not_found');
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer({ connectionsCheckingInterval: 2000 }, (req, res) => {
    const done = (e) => {
      // 堆栈只写日志,不返回给客户端
      process.stderr.write('[goldminer] 内部错误: ' + (e && e.stack ? e.stack : e) + '\n');
      if (!res.headersSent) fail(req, res, 500, 'internal');
      else res.end();
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        Promise.resolve(handleApi(req, res, url)).catch(done);
      } else if (config.serveStatic) {
        serveStatic(req, res, url);
      } else {
        fail(req, res, 404, 'not_found');
      }
    } catch (e) {
      done(e);
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;

  return {
    server,
    db,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => resolve(server.address().port));
      }),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => {
          try {
            db.close();
          } catch {}
          resolve();
        });
      }),
  };
}

async function main() {
  const config = loadConfig();
  const app = createApp(config);
  const port = await app.listen();
  console.log(`[goldminer] 监听 http://${config.host}:${port}  DB=${config.dbPath}  管理接口=${config.adminPassword ? '开启' : '关闭'}`);
  const stop = () => app.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[goldminer] 启动失败:', e.message);
    process.exit(1);
  });
}

module.exports = { createApp };
