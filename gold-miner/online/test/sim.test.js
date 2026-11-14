'use strict';
// O-01 (the server runs index.html), O-03 (headless load, resources), O-04 (snapshot / delta round trip)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { SimHost, plain, extractScript } = require('../src/sim-host');
const { diff } = require('../src/delta');
const { runVm, DRIVER_SRC } = require('./driver');
const H = require('./helpers');
const vm = require('vm');

test('O-01 sim-host loads #gm-main from GAME_HTML; no game-rule constants in online/src', () => {
  const html = fs.readFileSync(H.GAME_HTML, 'utf8');
  const host = new SimHost(H.GAME_HTML);
  assert.strictEqual(host.scriptText, extractScript(html));
  assert.ok(host.scriptText.includes('const TARGETS ='), 'the script is the game itself');
  // the server answers with the build hash of exactly that text, computed by the game script itself
  const gm = host.createGame();
  assert.strictEqual(gm.build, gm.net.fnv64(host.scriptText));
  // a copy with one changed character gives another build (the version check works on content, not a number)
  const tmp = path.join(require('os').tmpdir(), 'gm-o01-' + process.pid + '.html');
  fs.writeFileSync(tmp, html.replace('const ROUNDS = 8;', 'const ROUNDS = 8; '));
  const other = new SimHost(tmp).createGame().build; fs.unlinkSync(tmp);
  assert.notStrictEqual(other, gm.build);
  const src = path.resolve(__dirname, '..', 'src');
  const out = execSync(`grep -rEn "TARGETS\\s*=|ITEMS\\s*=|HOOK\\s*=|RULESETS\\s*=|TUG_K" "${src}" || true`).toString().trim();
  assert.strictEqual(out, '', 'rule constants found in online/src:\n' + out);
  console.log(`# O-01 build ${gm.build}; script ${host.scriptText.length} chars; grep of online/src for rule constants: empty`);
});

test('O-03 20 games in the vm without exceptions; 20 rooms <= 600 MB RSS; <= 2 ms per tick', async () => {
  const host = new SimHost(H.GAME_HTML);
  const errors = [];
  const gm = host.createGame({ onError: e => errors.push(e) });
  let finals = 0, ticks = 0;
  const t0 = process.hrtime.bigint();
  for (let seed = 1; seed <= 20; seed++) { const r = runVm(gm, seed); if (r.screen === 'final') finals++; ticks += r.ticks; }
  const pureMs = Number(process.hrtime.bigint() - t0) / 1e6 / ticks;
  assert.strictEqual(finals, 20); assert.deepStrictEqual(errors, []);
  // 20 rooms, each with a game running; full server tick (step + snapshot + delta + send) measured on one room through a real server
  const srv = await H.startServer({ tickMode: 'manual', maxRooms: 20, trustProxy: true });
  try {
  const pairs = [];
  for (let i = 0; i < 20; i++) pairs.push(await H.pair(srv, { headers: { 'X-Forwarded-For': '10.0.0.' + i } }));
  for (const p of pairs) { p.a.in('ok'); p.b.in('ok'); }
  await H.sleep(100);
  H.ticks(srv, 60 * 3);                                               // through select + intro into play
  const rss = process.memoryUsage().rss / 1048576;
  const r0 = pairs[0].room; r0.stats.tickMs = 0; r0.stats.ticks = 0;
  for (let i = 0; i < 600; i++) { for (const p of pairs) p.room.tick(); if (i % 37 === 0) { pairs[0].a.in('fire', { at: r0.k }); await H.sleep(0); } }
  const perTick = r0.stats.tickMs / r0.stats.ticks;
  console.log(`# O-03 20 vm games: 20/20 final, errors 0, game logic ${pureMs.toFixed(3)} ms/tick; 20 rooms open: RSS ${rss.toFixed(0)} MB; one room in play, full tick incl. snapshot/delta/send: ${perTick.toFixed(3)} ms`);
  assert.ok(rss <= 600, 'rss ' + rss); assert.ok(perTick <= 2, 'tick ms ' + perTick);
  } finally { await srv.close(); }
});

test('O-04 snapshot round trip: mirror built from deltas == full snapshot (seeds 1, 2); new connection gets an equal full snapshot', async () => {
  const host = new SimHost(H.GAME_HTML);
  const server = host.createGame(), clientGm = host.createGame();      // the client half (netPatch) is index.html's own code
  let checks = 0, maxDelta = 0, sumDelta = 0, nDelta = 0, maxFull = 0;
  for (const seed of [1, 2]) {
    server.g.reseed(seed); server.g.startMode('versus', [0, 1]);
    const make = vm.runInContext(DRIVER_SRC, server.ctx);
    const d = make(server.g, (s, a) => server.net.input(s, a), () => server.net.step());
    let prev = null, mirror = null, t = 0;
    while (server.G.screen !== 'final' && t < 60 * 60 * 30) {
      d.one(); t++;
      if (t % 2) continue;
      const S = plain(server.net.snapshot());
      if (!prev) { mirror = S; maxFull = Math.max(maxFull, JSON.stringify(S).length); }
      else {
        const delta = diff(prev, S), len = JSON.stringify(delta).length;
        if (server.G.screen === 'play') { sumDelta += len; nDelta++; maxDelta = Math.max(maxDelta, len); }
        mirror = plain(clientGm.net.patch(mirror, delta));
      }
      prev = S;
      if (t % 30 === 0) { assert.deepStrictEqual(mirror, S); checks++; maxFull = Math.max(maxFull, JSON.stringify(S).length); }
    }
    assert.strictEqual(server.G.screen, 'final');
  }
  // a connection that arrives in the middle of a game (resume from another tab) receives a full snapshot equal to the server state
  const srv = await H.startServer({ tickMode: 'manual' });
  try {
    const { a, b, code } = await H.pair(srv, { seed: 3 });
    a.in('ok'); b.in('ok'); await H.sleep(50);
    H.ticks(srv, 60 * 8);
    const token = b.msgs.find(m => m.t === 'welcome').seat;
    const c = await H.client(srv); c.send({ t: 'resume', proto: 1, build: srv.build, room: code, seat: token });
    await c.wait(m => m.t === 'welcome');
    H.ticks(srv, 1);                                                  // the takeover is "urgent": this tick sends the full snapshot
    const full = await c.wait(m => m.t === 'snap' && m.full);
    const st = await (await fetch(`${srv.http}/__test/room/${code}/state`)).json();
    assert.strictEqual(full.k, st.k);
    assert.deepStrictEqual(full.d, st.state);
    console.log(`# O-04 ${checks} mirror==full checks over 2 games, all equal; play deltas avg ${(sumDelta / nDelta).toFixed(0)} B, max ${maxDelta} B; largest full snapshot ${maxFull} B; mid-game resume full snapshot == server state at k=${st.k} (screen ${st.screen})`);
    assert.ok(sumDelta / nDelta <= 1536, 'avg delta'); assert.ok(maxFull <= 30720, 'full size');
  } finally { await srv.close(); }
});
