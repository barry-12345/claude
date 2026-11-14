'use strict';
// O-30 protocol and limits (+ the server-side half of O-26)
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/protocol');
const H = require('./helpers');

const create = (c, srv, extra) => c.send(Object.assign({ t: 'create', proto: 1, build: srv.build, name: 'x' }, extra || {}));
const join = (c, srv, room) => c.send({ t: 'join', proto: 1, build: srv.build, name: 'y', room });
const ipHdr = ip => ({ headers: { 'X-Forwarded-For': ip } });

test('O-30a room codes: 100 000 codes, length 6, 31-symbol alphabet; a code in use is drawn again', () => {
  const seen = new Set(); let bad = 0;
  for (let i = 0; i < 100000; i++) { const c = P.newRoomCode(); if (!/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(c)) bad++; seen.add(c); }
  assert.strictEqual(bad, 0); assert.strictEqual(P.ALPHABET.length, 31);
  assert.ok(!/[01OIL]/.test(P.ALPHABET));
  let calls = 0; const taken = new Set();
  const code = P.newRoomCode(s => { calls++; if (calls <= 5) { taken.add(s); return true; } return taken.has(s); });
  assert.ok(calls >= 6 && !taken.has(code));
  console.log(`# O-30a 100000 codes: invalid 0, distinct ${seen.size}; collision test: ${calls} draws, returned code not in use`);
});

test('O-30b message limits: >1024 B -> close 1009; bad JSON / unknown type -> bad_message, 20th closes; flood -> 1008; no handshake 5 s -> closed', async () => {
  const clock = H.fakeClock();
  const srv = await H.startServer({ tickMode: 'manual' }, { clock });
  try {
    const c1 = await H.client(srv);
    c1.send('x'.repeat(1025));
    assert.strictEqual((await c1.waitClose()).code, 1009);
    const c2 = await H.client(srv);
    for (let i = 0; i < 10; i++) c2.send('{not json'); for (let i = 0; i < 9; i++) c2.send({ t: 'hello' });
    await H.until(() => c2.msgs.filter(m => m.code === 'bad_message').length === 19);
    assert.strictEqual(c2.closed, null);
    c2.send({ t: 'in', s: -1, a: 'fire' });                      // 20th bad message
    assert.strictEqual((await c2.waitClose()).code, 1008);
    // token bucket 40/s burst 80 (clock frozen: no refill): 80 pings answered, the rest dropped; > 200 drops within 10 s -> 1008
    const c3 = await H.client(srv);
    for (let i = 0; i < 281; i++) c3.send({ t: 'ping', c: i });
    await H.until(() => c3.closed);
    const pongs = c3.msgs.filter(m => m.t === 'pong').length;
    assert.strictEqual(pongs, 80); assert.strictEqual(c3.closed.code, 1008);
    const c3b = await H.client(srv);                              // 80 + 200 drops exactly is still fine
    for (let i = 0; i < 280; i++) c3b.send({ t: 'ping', c: i });
    await H.sleep(150);
    assert.strictEqual(c3b.closed, null);
    // refill: 1 s later 40 more pass
    clock.t += 1000; for (let i = 0; i < 60; i++) c3b.send({ t: 'ping', c: i });
    await H.until(() => c3b.msgs.filter(m => m.t === 'pong').length >= 120); await H.sleep(50);
    const refill = c3b.msgs.filter(m => m.t === 'pong').length - 80;
    assert.strictEqual(refill, 40);
    // handshake: 5 s without create / join / resume
    const c4 = await H.client(srv);
    clock.t += 4900; srv.maintain(); await H.sleep(50); assert.strictEqual(c4.closed, null);
    clock.t += 200; srv.maintain(); assert.strictEqual((await c4.waitClose()).code, 1008);
    console.log(`# O-30b 1025 B -> close 1009; 19 bad messages -> 19 x bad_message, still open, 20th -> close 1008; 281 pings in a burst -> ${pongs} pongs, closed 1008 (201 drops), 280 -> still open, +1 s -> ${refill} more; handshake: open at 4.9 s, closed at 5.1 s`);
  } finally { await srv.close(); }
});

test('O-30c per-IP limits: 30 connections/min, 8 at once, 10 rooms/hour, 10 + 50 failed joins; 21st room -> server_full; mode field ignored', async () => {
  const clock = H.fakeClock();
  const srv = await H.startServer({ tickMode: 'manual', trustProxy: true }, { clock });
  try {
    const res = {};
    // 30 new connections per minute
    let n = 0, refused = 0;
    for (let i = 0; i < 31; i++) { const c = await H.client(srv, ipHdr('1.1.1.1')); await H.sleep(10); if (c.msgs.some(m => m.code === 'rate_limited')) { refused = i + 1; } c.close(); await H.until(() => c.closed); n++; }
    res.conn = refused; assert.strictEqual(refused, 31);
    // 8 at the same time
    const open = []; for (let i = 0; i < 9; i++) open.push(await H.client(srv, ipHdr('2.2.2.2')));
    await H.sleep(50);
    res.concurrent = open.findIndex(c => c.msgs.some(m => m.code === 'rate_limited')) + 1;
    assert.strictEqual(res.concurrent, 9);
    for (const c of open) c.close();
    // 10 rooms per hour (one connection, rooms dropped again so the global cap does not interfere)
    let createRefused = 0;
    for (let i = 0; i < 11; i++) {
      const c = await H.client(srv, ipHdr('3.3.3.3')); create(c, srv);
      const m = await c.wait(x => x.t === 'welcome' || x.t === 'error');
      if (m.t === 'error' && m.code === 'rate_limited') createRefused = i + 1;
      c.close(); await H.until(() => c.closed);
      for (const r of [...srv.rooms.values()]) r.close('test');
    }
    res.create = createRefused; assert.strictEqual(createRefused, 11);
    // failed joins: 10 per minute ...
    const c = await H.client(srv, ipHdr('4.4.4.4'));
    const codes = [];
    for (let i = 0; i < 11; i++) { join(c, srv, 'ZZZZZ' + P.ALPHABET[i]); codes.push((await c.wait(m => m.t === 'error' && !m._seen && (m._seen = true))).code); }
    res.joinMin = codes.indexOf('rate_limited') + 1; assert.strictEqual(res.joinMin, 11);
    assert.ok(c.msgs.find(m => m.code === 'rate_limited').retry > 0);
    // ... and 50 per hour (a minute passes after every 10)
    let total = 10, hourRefused = 0;
    for (let round = 0; round < 5 && !hourRefused; round++) {
      clock.t += 61000;
      for (let i = 0; i < 10 && !hourRefused; i++) {
        const cc = await H.client(srv, ipHdr('4.4.4.' + (10 + round)));        // fresh connections (30/min/IP), same rate key below
        cc.ws.close(); await H.until(() => cc.closed);
      }
      for (let i = 0; i < 10; i++) {
        join(c, srv, 'YYYYY' + P.ALPHABET[i]); total++;
        const m = await c.wait(x => x.t === 'error' && !x._seen && (x._seen = true));
        if (m.code === 'rate_limited') { hourRefused = total; break; }
      }
    }
    res.joinHour = hourRefused; assert.strictEqual(hourRefused, 51);
    // 20 rooms at most
    const owners = [];
    for (let i = 0; i < 21; i++) { const o = await H.client(srv, ipHdr('5.5.' + i + '.1')); create(o, srv, { mode: 'coop' }); owners.push(o); }
    const last = await owners[20].wait(m => m.t === 'error' || m.t === 'welcome');
    res.full = last.code; assert.strictEqual(last.code, 'server_full'); assert.strictEqual(srv.rooms.size, 20);
    // the "mode" field of create is ignored: the room plays versus
    const code = owners[0].msgs.find(m => m.t === 'welcome').room;
    const j = await H.client(srv, ipHdr('6.6.6.6')); join(j, srv, code); await j.wait(m => m.t === 'welcome');
    const st = await (await fetch(`${srv.http}/__test/room/${code}/state`)).json();
    assert.strictEqual(st.state.mode, 'versus');
    console.log(`# O-30c refused at: connection #${res.conn} in a minute, simultaneous #${res.concurrent}, room #${res.create} in an hour, failed join #${res.joinMin} in a minute and #${res.joinHour} in an hour; room #21 -> ${res.full}; create {mode:'coop'} -> room mode ${st.state.mode}`);
  } finally { await srv.close(); }
});

test('O-26 (server side) room full / not found / forged seat / foreign Origin', async () => {
  const srv = await H.startServer({ tickMode: 'manual', allowedOrigins: ['http://127.0.0.1'] });
  try {
    const { code } = await H.pair(srv);
    const c = await H.client(srv); join(c, srv, code);
    assert.strictEqual((await c.wait(m => m.t === 'error')).code, 'room_full');
    const d = await H.client(srv); join(d, srv, 'ZZZZZZ');
    assert.strictEqual((await d.wait(m => m.t === 'error')).code, 'room_not_found');
    const e = await H.client(srv); e.send({ t: 'resume', proto: 1, build: srv.build, room: code, seat: 'A'.repeat(43) });
    assert.strictEqual((await e.wait(m => m.t === 'error')).code, 'bad_seat');
    const f = await H.client(srv, { origin: 'https://evil.example' });
    assert.strictEqual(f.status, 403);
    const v = await H.client(srv); v.send({ t: 'create', proto: 1, build: 'ffffffffffffffff', name: 'x' });
    assert.strictEqual((await v.wait(m => m.t === 'error')).code, 'version');
    console.log('# O-26s third player -> room_full; wrong code -> room_not_found; forged seat -> bad_seat; Origin https://evil.example -> HTTP 403; other build -> version');
  } finally { await srv.close(); }
});
