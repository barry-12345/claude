'use strict';
// 黄金矿工联机对战服务端: node:http + ws.  /online/ws (WebSocket), /online/health; SERVE_STATIC serves the game for development / tests;
// /__test/* exists only with ONLINE_TEST_HOOKS=1 and NODE_ENV !== 'production'.
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { WebSocketServer } = require('ws');
const { SimHost, plain } = require('./sim-host');
const { Room } = require('./room');
const P = require('./protocol');
const { WindowLimiter, TokenBucket } = require('./ratelimit');
const { parseNetSim, DelayLine } = require('./netsim');

const MIN = 60 * 1000, HOUR = 60 * MIN;
function duration(v, def) {                  // "5s", "10m", "6h", "250ms" or plain milliseconds
  if (v === undefined || v === null || v === '') return def;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h)?\s*$/.exec(String(v));
  if (!m) return def;
  return Math.round(+m[1] * ({ ms: 1, s: 1000, m: MIN, h: HOUR }[m[2] || 'ms']));
}
function loadConfig(env = process.env) {
  return {
    port: env.PORT !== undefined ? +env.PORT : 8790,
    host: env.HOST || '127.0.0.1',
    gameHtml: env.GAME_HTML || path.resolve(__dirname, '..', '..', 'index.html'),
    allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    trustProxy: env.TRUST_PROXY === '1',
    serveStatic: env.SERVE_STATIC || '',
    fast: env.FAST === '1',
    seatTimeout: duration(env.SEAT_TIMEOUT, 10 * MIN),
    endOfferAfter: duration(env.END_OFFER_AFTER, 60 * 1000),
    idleWaiting: duration(env.IDLE_WAITING, 30 * MIN),
    idleEmpty: duration(env.IDLE_EMPTY, 10 * MIN),
    idleFinal: duration(env.IDLE_FINAL, 30 * MIN),
    maxAge: duration(env.MAX_AGE, 6 * HOUR),
    handshake: duration(env.HANDSHAKE_TIMEOUT, 5000),
    deadAfter: duration(env.DEAD_AFTER, 8000),
    tickMode: env.TICK_MODE === 'manual' ? 'manual' : 'auto',
    netSim: parseNetSim(env.NET_SIM),
    testHooks: env.ONLINE_TEST_HOOKS === '1' && env.NODE_ENV !== 'production',
    maxRooms: env.MAX_ROOMS ? +env.MAX_ROOMS : 20,
    maxConns: env.MAX_CONNS ? +env.MAX_CONNS : 100,
    log: env.ONLINE_LOG !== '0',
  };
}
const realClock = { now: () => performance.timeOrigin + performance.now() };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function createServer(config = {}, deps = {}) {
  const cfg = Object.assign(loadConfig({}), config);
  const clock = deps.clock || realClock;
  const host = new SimHost(cfg.gameHtml, { fast: cfg.fast });
  const build = host.createGame().build;                        // the hash of the script the server runs (= what Caddy serves)
  const rooms = new Map(), conns = new Set(), perIp = new Map();
  const lim = {
    conn: new WindowLimiter(30, MIN, clock), create: new WindowLimiter(10, HOUR, clock),
    joinMin: new WindowLimiter(10, MIN, clock), joinHour: new WindowLimiter(50, HOUR, clock),
  };
  const log = (...a) => { if (cfg.log) console.log(new Date().toISOString(), ...a); };
  const srv = { cfg, clock, host, rooms, conns, build, lim };

  // ---- sending (optionally through the simulated network)
  srv.send = (c, obj) => {
    if (!c || c.closed) return;
    const s = JSON.stringify(obj);
    c.tx += s.length;
    const go = () => { if (c.ws.readyState === 1) c.ws.send(s); };
    if (c.outLine) c.outLine.push(go); else go();
  };
  srv.closeConn = (c, code, reason) => {
    if (c.closed) return;
    const go = () => { try { c.ws.close(code, reason); } catch (e) {} };
    if (c.outLine) c.outLine.push(go); else go();
  };
  srv.deleteRoom = room => { if (rooms.get(room.code) === room) rooms.delete(room.code); log('room closed', room.code); };

  // ---- HTTP
  const json = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); };
  const readBody = req => new Promise((resolve) => { let b = ''; req.on('data', d => { b += d; if (b.length > 65536) req.destroy(); }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { resolve(null); } }); });
  async function handleTest(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean);   // ['__test', ...]
    if (req.method === 'GET' && parts[1] === 'rooms') return json(res, 200, [...rooms.values()].map(r => r.info()));
    if (req.method === 'POST' && parts[1] === 'step') { const n = Math.max(0, Math.min(36000, +(url.searchParams.get('n') || 1))); for (let i = 0; i < n; i++) srv.tickAll(); return json(res, 200, { ok: true, n }); }
    if (req.method === 'POST' && parts[1] === 'drop') {
      const r = rooms.get(url.searchParams.get('room') || ''), slot = +(url.searchParams.get('slot') || 0), s = r && r.seats[slot];
      if (!s || !s.conn) return json(res, 404, { ok: false });
      try { s.conn.ws._socket.destroy(); } catch (e) {}
      return json(res, 200, { ok: true });
    }
    if (parts[1] === 'room' && parts[2]) {
      const r = rooms.get(parts[2]); if (!r) return json(res, 404, { error: 'room_not_found' });
      if (req.method === 'GET' && parts[3] === 'state') return json(res, 200, Object.assign(r.info(), { state: r.snapshot(), final: plain(r.G.final) }));
      if (req.method === 'POST' && parts[3] === 'seed') { const b = await readBody(req); if (!b || !Number.isInteger(b.seed)) return json(res, 400, { ok: false }); r.setSeed(b.seed); return json(res, 200, { ok: true, seed: b.seed }); }
      if (req.method === 'POST' && parts[3] === 'eval') {
        const b = await readBody(req); if (!b || typeof b.code !== 'string') return json(res, 400, { ok: false });
        try { const v = vm.runInContext(b.code, r.game.ctx); r.urgent = true; return json(res, 200, { ok: true, value: plain(v) === undefined ? null : plain(v) }); }
        catch (e) { return json(res, 500, { ok: false, error: String(e && e.message || e) }); }
      }
    }
    return json(res, 404, { error: 'not found' });
  }
  function serveStatic(req, res, url) {
    let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
    const root = path.resolve(cfg.serveStatic), file = path.resolve(root, '.' + p);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
    });
  }
  const server = http.createServer((req, res) => {
    let url; try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); res.end(); return; }
    if (url.pathname === '/online/health') {
      const games = [...rooms.values()].filter(r => r.inProgress()).length;
      return json(res, 200, { ok: true, build, rooms: rooms.size, games, conns: conns.size });
    }
    if (cfg.testHooks && url.pathname.startsWith('/__test/')) { handleTest(req, res, url).catch(e => json(res, 500, { error: String(e) })); return; }
    if (cfg.serveStatic && (req.method === 'GET' || req.method === 'HEAD')) return serveStatic(req, res, url);
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found');
  });

  // ---- WebSocket
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const clientIp = req => {
    const ra = req.socket.remoteAddress || '';
    const local = ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
    if (cfg.trustProxy && local && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
    return ra;
  };
  server.on('upgrade', (req, socket, head) => {
    let url; try { url = new URL(req.url, 'http://x'); } catch (e) { socket.destroy(); return; }
    if (url.pathname !== '/online/ws') { socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    const origin = req.headers.origin || '';
    if (cfg.allowedOrigins.length && !cfg.allowedOrigins.includes(origin)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => onConnection(ws, req));
  });
  function onConnection(ws, req) {
    const now = clock.now(), ip = clientIp(req);
    const c = { ws, ip, room: null, slot: -1, created: now, lastMsg: now, bucket: new TokenBucket(40, 80, clock), drops: [], bad: 0, synced: false, ackSeq: null, tx: 0, closed: false,
      outLine: cfg.netSim ? new DelayLine(cfg.netSim) : null, inLine: cfg.netSim ? new DelayLine(cfg.netSim) : null };
    conns.add(c);
    const n = (perIp.get(ip) || 0) + 1; perIp.set(ip, n);
    ws.on('close', () => {
      c.closed = true; conns.delete(c);
      const m = (perIp.get(ip) || 1) - 1; if (m > 0) perIp.set(ip, m); else perIp.delete(ip);
      if (c.inLine) c.inLine.clear();
      if (c.room) c.room.detach(c);
    });
    ws.on('error', () => {});
    // connection-level limits: answered with an error message, then closed
    let refuse = null;
    if (conns.size > cfg.maxConns) refuse = { t: 'error', code: 'server_full' };
    else if (n > 8) refuse = { t: 'error', code: 'rate_limited', retry: 10 };
    else { const r = lim.conn.hit(ip); if (!r.ok) refuse = { t: 'error', code: 'rate_limited', retry: r.retry }; }
    if (refuse) { srv.send(c, refuse); srv.closeConn(c, 1008, refuse.code); return; }
    ws.on('message', (data, isBinary) => {
      const text = isBinary ? null : data.toString();
      if (c.inLine) c.inLine.push(() => onMessage(c, text)); else onMessage(c, text);
    });
  }
  function onMessage(c, text) {
    if (c.closed) return;
    const now = clock.now();
    c.lastMsg = now;
    if (!c.bucket.take()) {                                     // flood: drop; too many drops in 10 s closes the connection
      c.drops.push(now); while (c.drops.length && c.drops[0] <= now - 10000) c.drops.shift();
      if (c.drops.length > 200) srv.closeConn(c, 1008, 'flood');
      return;
    }
    const r = text === null ? { ok: false } : P.parse(text);
    if (!r.ok) {
      c.bad++; srv.send(c, { t: 'error', code: 'bad_message' });
      if (c.bad >= 20) srv.closeConn(c, 1008, 'bad messages');
      return;
    }
    const m = r.msg;
    if (m.t === 'ping') { srv.send(c, { t: 'pong', c: m.c, k: c.room ? Math.round(c.room.serverTick() * 1000) / 1000 : 0 }); return; }
    if (m.t === 'in') { if (c.room) c.room.push(c, m); return; }
    if (c.room) return;                                         // already seated: a second create / join / resume is ignored
    if (m.proto !== P.PROTO || m.build !== build) { srv.send(c, { t: 'error', code: 'version' }); srv.closeConn(c, 1000, 'version'); return; }
    if (m.t === 'create') {
      const lr = lim.create.peek(c.ip);
      if (!lr.ok) { srv.send(c, { t: 'error', code: 'rate_limited', retry: lr.retry }); return; }
      if (rooms.size >= cfg.maxRooms) { srv.send(c, { t: 'error', code: 'server_full' }); return; }
      lim.create.record(c.ip);
      const code = P.newRoomCode(s => rooms.has(s));
      const room = new Room(srv, code, { seed: cfg.testHooks && m.seed != null ? m.seed : null });
      rooms.set(code, room);
      room.addSeat(0, m.name);
      room.attach(0, c);
      log('room created', code);
      return;
    }
    if (m.t === 'join') {
      const a = lim.joinMin.peek(c.ip), b = lim.joinHour.peek(c.ip);
      if (!a.ok || !b.ok) { srv.send(c, { t: 'error', code: 'rate_limited', retry: Math.max(a.retry, b.retry) }); return; }
      const room = rooms.get(m.room);
      if (!room || room.phase === 'closed') { lim.joinMin.record(c.ip); lim.joinHour.record(c.ip); srv.send(c, { t: 'error', code: 'room_not_found' }); return; }
      if (room.seats[1]) { srv.send(c, { t: 'error', code: 'room_full' }); return; }
      room.addSeat(1, m.name);
      room.attach(1, c);
      return;
    }
    if (m.t === 'resume') {
      const room = rooms.get(m.room);
      if (!room || room.phase === 'closed') { srv.send(c, { t: 'error', code: 'room_not_found' }); return; }
      const slot = room.seats.findIndex(s => s && s.token === m.seat);
      if (slot < 0) { srv.send(c, { t: 'error', code: 'bad_seat' }); return; }
      room.attach(slot, c);
    }
  }

  // ---- ticking and housekeeping
  srv.tickAll = () => { for (const r of [...rooms.values()]) r.tick(); srv.maintain(); };
  srv.maintain = () => {
    const now = clock.now();
    for (const c of conns) {
      if (c.closed) continue;
      if (!c.room && c.slot < 0 && now - c.created > cfg.handshake && !c.handshakeClosed) { c.handshakeClosed = true; srv.closeConn(c, 1008, 'handshake timeout'); }
      else if (now - c.lastMsg > cfg.deadAfter) { c.closed = true; try { c.ws.terminate(); } catch (e) {} }
    }
    for (const r of [...rooms.values()]) r.maintain(now);
  };
  let timer = null, pingTimer = null, hkTimer = null, t0 = 0, done = 0;
  function loop() {
    const now = clock.now();
    let due = Math.floor((now - t0) * 60 / 1000) - done;
    if (due > 10) { done += due - 10; due = 10; }               // at most 10 catch-up ticks per round
    for (let i = 0; i < due; i++) { for (const r of [...rooms.values()]) r.tick(); done++; }
    const next = t0 + (done + 1) * 1000 / 60;
    timer = setTimeout(loop, Math.max(1, next - clock.now()));
  }
  srv.server = server; srv.wss = wss;
  srv.listen = (port = cfg.port, hostName = cfg.host) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, hostName, () => {
      if (cfg.tickMode === 'auto') { t0 = clock.now(); done = 0; timer = setTimeout(loop, 16); }
      hkTimer = setInterval(() => { if (cfg.tickMode === 'auto') srv.maintain(); }, 250);
      pingTimer = setInterval(() => { for (const c of conns) if (!c.closed) try { c.ws.ping(); } catch (e) {} }, 15000);   // keeps Caddy / NAT mappings alive
      resolve(server.address());
    });
  });
  srv.close = () => new Promise(resolve => {
    clearTimeout(timer); clearInterval(pingTimer); clearInterval(hkTimer);
    for (const c of conns) { if (c.outLine) c.outLine.clear(); if (c.inLine) c.inLine.clear(); try { c.ws.terminate(); } catch (e) {} }
    server.close(() => resolve());
    if (server.closeAllConnections) server.closeAllConnections();
  });
  return srv;
}

module.exports = { createServer, loadConfig, duration };

if (require.main === module) {
  const cfg = loadConfig();
  const srv = createServer(cfg);
  srv.listen().then(a => console.log(`goldminer-online listening on ${a.address}:${a.port} (build ${srv.build}${cfg.netSim ? ', NET_SIM on' : ''}${cfg.testHooks ? ', test hooks on' : ''})`))
    .catch(e => { console.error('cannot listen:', e.message); process.exit(1); });
  const stop = () => srv.close().then(() => process.exit(0));
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
