'use strict';
// O-31 room state machine (injected clock + TICK_MODE=manual): every timer must fire at its tick (+-1)
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

const TICK = 1000 / 60, MIN = 60000;
async function setup(over = {}) {
  const clock = H.fakeClock();
  const srv = await H.startServer(Object.assign({ tickMode: 'manual', fast: true, deadAfter: 1e12 }, over), { clock });
  return { srv, clock };
}
// tick until fn() is true; returns the number of ticks taken
function tickUntil(srv, clock, fn, max = 100000) { let n = 0; while (!fn() && n < max) { clock.t += TICK; srv.tickAll(); n++; } return n; }
async function toPlay(srv, clock, opts) {
  const p = await H.pair(srv, opts);
  p.a.in('ok'); p.b.in('ok'); await H.sleep(30);
  tickUntil(srv, clock, () => p.room.G.screen === 'play', 2000);
  return p;
}
const evalIn = (srv, code, js) => fetch(`${srv.http}/__test/room/${code}/eval`, { method: 'POST', body: JSON.stringify({ code: js }) }).then(r => r.json());

test('O-31a pause -> resume: 3 s countdown (180 ticks), simulation frozen meanwhile', async () => {
  const { srv, clock } = await setup();
  try {
    const { a, b, room } = await toPlay(srv, clock);
    H.ticks(srv, 30, clock);
    a.in('pause'); await H.sleep(20); H.ticks(srv, 1, clock);
    assert.strictEqual(room.pause.reason, 'player'); assert.strictEqual(room.G.paused, true);
    const t0 = room.G.time;
    H.ticks(srv, 120, clock);
    assert.strictEqual(room.G.time, t0);
    b.in('resume'); await H.sleep(20); H.ticks(srv, 1, clock);
    const k0 = room.k; assert.strictEqual(room.pause.resumeAt, k0 + 180);
    const n = tickUntil(srv, clock, () => !room.pause);
    assert.ok(Math.abs(n - 179) <= 1, 'resumed after ' + n);
    assert.strictEqual(room.G.paused, false);
    assert.ok(Math.abs(room.G.time - (t0 - 1 / 60)) < 1e-9, 'one step ran in the resuming tick');
    console.log(`# O-31a pause by P1: G.time frozen for 120 ticks; P2 resume at k=${k0}: running again ${n} ticks later (180 = 3 s); noFireT after resume ${room.G.noFireT.toFixed(3)}`);
  } finally { await srv.close(); }
});

test('O-31b results page: auto after 6 s (360 ticks) / at once when both continue; play again; leave', async () => {
  const { srv, clock } = await setup();
  try {
    const { a, b, room, code } = await toPlay(srv, clock);
    await evalIn(srv, code, '__game.G.players.forEach(p => { p.money += 99999; }); __game.endRound()'); H.ticks(srv, 1, clock);
    assert.strictEqual(room.G.screen, 'results');
    const nAuto = tickUntil(srv, clock, () => room.G.screen !== 'results');
    assert.ok(Math.abs(nAuto - 360) <= 1, 'auto after ' + nAuto);
    // next round, both press continue right away -> leaves the page as soon as 0.4 s have passed (minimum, as in local play)
    tickUntil(srv, clock, () => room.G.screen === 'shop');
    a.in('ready'); b.in('ready'); await H.sleep(20);
    tickUntil(srv, clock, () => room.G.screen === 'play', 3000);
    await evalIn(srv, code, '__game.G.players.forEach(p => { p.money += 99999; }); __game.endRound()'); H.ticks(srv, 1, clock);
    a.in('next'); await H.sleep(20); H.ticks(srv, 1, clock);
    assert.strictEqual(room.seats[0].next, true); assert.strictEqual(room.G.screen, 'results');
    b.in('next'); await H.sleep(20);
    const nVote = tickUntil(srv, clock, () => room.G.screen !== 'results') + 2;
    assert.ok(nVote <= 26, 'votes after ' + nVote);
    // final -> play again needs both
    await evalIn(srv, code, '__game.finishGame()'); H.ticks(srv, 1, clock);
    assert.strictEqual(room.G.screen, 'final');
    a.in('again'); await H.sleep(20); H.ticks(srv, 1, clock);
    const rm = await b.wait(m => m.t === 'room' && m.seats[0] && m.seats[0].again);
    assert.strictEqual(room.G.screen, 'final'); assert.strictEqual(rm.seats[1].again, false);
    b.in('again'); await H.sleep(20); H.ticks(srv, 1, clock);
    assert.strictEqual(room.G.screen, 'select'); assert.strictEqual(room.code, code);
    // leave
    a.in('leave'); await H.sleep(20); H.ticks(srv, 1, clock);
    const closed = await b.wait(m => m.t === 'room' && m.phase === 'closed');
    assert.strictEqual(closed.reason, 'left'); assert.ok(!srv.rooms.has(code));
    console.log(`# O-31b results auto-advance after ${nAuto} ticks (6 s = 360); both "continue" -> left after ${nVote} ticks (0.4 s minimum = 24); "again" by one: other sees again=true, still final; by both: select, same code; leave: other gets closed/left, room gone`);
  } finally { await srv.close(); }
});

test('O-31c offline: freeze, "end game" offer after 60 s, seat released after 10 min; select clears confirmation; end game -> waiting', async () => {
  const { srv, clock } = await setup();
  try {
    // select screen: an absent player's confirmation is cleared
    const p0 = await H.pair(srv);
    p0.b.in('ok'); await H.sleep(20); H.ticks(srv, 1, clock);
    assert.strictEqual(p0.room.G.sel[1].ready, true);
    p0.b.close(); await H.until(() => !p0.room.online(1));
    assert.strictEqual(p0.room.G.sel[1].ready, false);
    p0.room.close('test');
    // in play
    const { a, b, room, code } = await toPlay(srv, clock);
    H.ticks(srv, 20, clock);
    b.close(); await H.until(() => !room.online(1));
    const t0 = room.G.time; H.ticks(srv, 1, clock);
    assert.strictEqual(room.pause.reason, 'offline'); assert.strictEqual(room.G.time, t0);
    const off0 = room.seats[1].offlineSince;
    const nOffer = tickUntil(srv, clock, () => room.pause.endOffer);
    const atOffer = clock.t - off0;
    assert.ok(Math.abs(atOffer - 60000) <= TICK + 1, 'offer at ' + atOffer);
    const msg = await a.wait(m => m.t === 'room' && m.pause && m.pause.endOffer);
    assert.ok(msg.pause.left > 0 && msg.pause.left <= 9 * MIN);
    tickUntil(srv, clock, () => !srv.rooms.has(code), 40000);
    const atGone = clock.t - off0;
    assert.ok(Math.abs(atGone - 10 * MIN) <= TICK + 1, 'gone at ' + atGone);
    const cl = await a.wait(m => m.t === 'room' && m.phase === 'closed');
    assert.strictEqual(cl.reason, 'timeout');
    // "end game" -> both back in the waiting room
    const q = await toPlay(srv, clock);
    q.b.close(); await H.until(() => !q.room.online(1));
    tickUntil(srv, clock, () => q.room.pause.endOffer);
    q.a.in('endgame'); await H.sleep(20); H.ticks(srv, 1, clock);
    assert.strictEqual(q.room.phase, 'waiting');
    console.log(`# O-31c select: offline seat confirmation cleared; play: frozen at once (G.time unchanged), "end game" offered ${(atOffer / 1000).toFixed(3)} s after the drop (${nOffer} ticks), seat released / room deleted at ${(atGone / 60000).toFixed(4)} min, online player told "timeout"; end game -> phase ${q.room.phase}`);
  } finally { await srv.close(); }
});

test('O-31d idle clean-up: host alone 30 min, nobody online 10 min, final untouched 30 min, any room 6 h', async () => {
  const { srv, clock } = await setup();
  const live = code => srv.rooms.has(code);
  const at = (room, ms) => { clock.t = room.created + ms; srv.maintain(); };
  try {
    const out = [];
    // host alone
    const h = await H.client(srv); h.send({ t: 'create', proto: 1, build: srv.build, name: 'h' });
    const code1 = (await h.wait(m => m.t === 'welcome')).room, r1 = srv.rooms.get(code1);
    at(r1, 30 * MIN - TICK); const before1 = live(code1); at(r1, 30 * MIN); out.push(['host alone 30 min', before1, live(code1)]);
    // nobody online
    const p = await H.pair(srv);
    p.a.close(); p.b.close(); await H.until(() => !p.room.online(0) && !p.room.online(1));
    const e0 = p.room.emptySince; clock.t = e0 + 10 * MIN - TICK; srv.maintain(); const before2 = live(p.code); clock.t = e0 + 10 * MIN; srv.maintain();
    out.push(['nobody online 10 min', before2, live(p.code)]);
    // final page untouched
    const f = await H.pair(srv);
    await evalIn(srv, f.code, '__game.startMode("versus", [0, 1]); __game.finishGame()'); H.ticks(srv, 1, clock);
    assert.strictEqual(f.room.G.screen, 'final');
    const f0 = Math.max(f.room.finalAt, f.room.lastActivity); clock.t = f0 + 30 * MIN - TICK; srv.maintain(); const before3 = live(f.code); clock.t = f0 + 30 * MIN; srv.maintain();
    out.push(['final untouched 30 min', before3, live(f.code)]);
    // 6 hours, whatever happens
    const s = await H.pair(srv);
    at(s.room, 6 * 3600000 - TICK); const before4 = live(s.code); at(s.room, 6 * 3600000);
    out.push(['max age 6 h', before4, live(s.code)]);
    for (const [name, b, a] of out) { assert.strictEqual(b, true, name + ' (before)'); assert.strictEqual(a, false, name + ' (after)'); }
    console.log('# O-31d ' + out.map(([n, b, a]) => `${n}: alive 1 tick before=${b}, deleted at the limit=${!a}`).join('; '));
  } finally { await srv.close(); }
});
