'use strict';
// Test helpers: an in-process server (optionally with a fake clock and manual ticks) and a small WebSocket client.
const path = require('path');
const WebSocket = require('ws');
const { createServer } = require('../src/server');

const GAME_HTML = path.resolve(__dirname, '..', '..', 'index.html');
const fakeClock = (t = 1e12) => ({ t, now() { return this.t; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startServer(over = {}, deps = {}) {
  const srv = createServer(Object.assign({ port: 0, gameHtml: GAME_HTML, testHooks: true, log: false }, over), deps);
  const a = await srv.listen(0, '127.0.0.1');
  srv.port = a.port; srv.url = `ws://127.0.0.1:${a.port}/online/ws`; srv.http = `http://127.0.0.1:${a.port}`;
  return srv;
}
// ticks the server `n` times; with a fake clock, the clock moves 1/60 s per tick
function ticks(srv, n, clock) { for (let i = 0; i < n; i++) { if (clock) clock.t += 1000 / 60; srv.tickAll(); } }

// minimal client: collects messages, waits for a predicate
function client(srv, opts = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(opts.url || srv.url, { headers: Object.assign({ Origin: opts.origin || 'http://127.0.0.1' }, opts.headers || {}) });
    const c = { ws, msgs: [], closed: null, seq: 0 };
    ws.on('message', d => { try { c.msgs.push(JSON.parse(d.toString())); } catch (e) {} });
    ws.on('close', (code, reason) => { c.closed = { code, reason: reason.toString() }; });
    ws.on('open', () => resolve(c));
    ws.on('unexpected-response', (req, res) => { c.status = res.statusCode; resolve(c); });
    ws.on('error', e => { if (!c.status) reject(e); });
    c.send = o => ws.send(typeof o === 'string' ? o : JSON.stringify(o));
    c.in = (a, extra) => c.send(Object.assign({ t: 'in', s: ++c.seq, a }, extra || {}));
    c.last = t => { for (let i = c.msgs.length - 1; i >= 0; i--) if (c.msgs[i].t === t) return c.msgs[i]; return null; };
    c.wait = async (pred, ms = 3000) => { const t0 = Date.now(); for (;;) { const m = c.msgs.find(pred); if (m) return m; if (Date.now() - t0 > ms) throw new Error('timeout waiting for message'); await sleep(5); } };
    c.waitClose = async (ms = 3000) => { const t0 = Date.now(); while (!c.closed) { if (Date.now() - t0 > ms) throw new Error('timeout waiting for close'); await sleep(5); } return c.closed; };
    c.close = () => { try { ws.close(); } catch (e) {} };
  });
}
// create + join: returns { a, b, code, room }
async function pair(srv, opts = {}) {
  const a = await client(srv, opts);
  a.send({ t: 'create', proto: 1, build: srv.build, name: opts.nameA || '甲', seed: opts.seed });
  const w = await a.wait(m => m.t === 'welcome');
  const b = await client(srv, opts);
  b.send({ t: 'join', proto: 1, build: srv.build, name: opts.nameB || '乙', room: w.room });
  await b.wait(m => m.t === 'welcome');
  await a.wait(m => m.t === 'room' && m.phase === 'game');
  return { a, b, code: w.room, room: srv.rooms.get(w.room) };
}
async function until(fn, ms = 3000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await sleep(5); } }

module.exports = { GAME_HTML, fakeClock, sleep, startServer, ticks, client, pair, until };
