'use strict';
// O-32 lag compensation: aim with the phase of tick `at`, catch up at most 18 ticks, fall back to a plain fire outside the window
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const H = require('./helpers');

const TICK = 1000 / 60;
test('O-32 backdated fire: at=now-10 / now-25 / now-40, interrupted swing, item already held by the other player', async () => {
  const clock = H.fakeClock();
  const srv = await H.startServer({ tickMode: 'manual', fast: true, deadAfter: 1e12 }, { clock });
  try {
    const { a, b, room } = await H.pair(srv, { seed: 9 });
    a.in('ok'); b.in('ok'); await H.sleep(30);
    const tick = n => H.ticks(srv, n, clock);
    while (room.G.screen !== 'play') tick(1);
    const run = js => vm.runInContext(js, room.game.ctx);
    run(`(() => { const G = __game.G; G.items = []; G.forceEvent = 'none'; G.event = null; G.time = 1e6; G.hazards = []; })()`);
    const G = room.G, H0 = run('__game.HOOK'), STEP = 1 / 60;
    const reset = () => run(`(() => { for (const p of __game.G.players) { const h = p.hook; h.state = 'swing'; h.len = __game.HOOK.minLen; h.item = null; } __game.G.items = []; __game.G.tug = null; })()`);
    const extendLen = (n, speed) => { let L = H0.minLen; for (let i = 0; i < n; i++) { let rem = speed * STEP; while (rem > 0) { const s = Math.min(rem, 5); L += s; rem -= s; } } return L; };
    const speed0 = H0.extend * run('__game.CHARS[__game.G.players[0].char].extend || 1');
    const histPh = (slot, k) => room.net.hookHistory(slot).find(e => e.k === k).ph;
    const res = [];
    const caseFire = (back, label) => {
      reset(); tick(40);
      const now = room.k, at = now - back;
      const cur = G.players[0].hook.phase;
      const expPh = back <= 30 ? histPh(0, at) : cur;
      const r = room.fire(0, { s: 100 + back, at }, now);
      const h = G.players[0].hook;
      const expLen = back <= 30 ? extendLen(Math.min(18, back), speed0) : H0.minLen;
      res.push(`${label}: phase err ${Math.abs(h.phase - expPh).toExponential(1)}, len ${h.len.toFixed(3)} (expected ${expLen.toFixed(3)}), backdated=${r.back}, fireAt=${r.fireAt - now}`);
      assert.ok(Math.abs(h.phase - expPh) < 1e-9, label + ' phase');
      assert.ok(Math.abs(h.len - expLen) < 1e-9, label + ' len ' + h.len + ' vs ' + expLen);
      assert.strictEqual(r.back, back <= 30);
      assert.strictEqual(r.fireAt, back <= 30 ? at : now);
    };
    caseFire(10, 'at=now-10'); caseFire(25, 'at=now-25 (catch-up capped at 18)'); caseFire(40, 'at=now-40 (outside the window)');
    // fractional at: phase interpolated between the two neighbouring ticks
    reset(); tick(40);
    { const now = room.k, at = now - 7.25, p0 = histPh(0, now - 8), p1 = histPh(0, now - 7), exp = p0 + (p1 - p0) * 0.75;
      room.fire(0, { s: 200, at }, now); const e = Math.abs(G.players[0].hook.phase - exp); res.push(`at=now-7.25: phase err ${e.toExponential(1)}`); assert.ok(e < 1e-9); }
    // the hook was not swinging between at and now -> plain fire with the current phase
    reset(); tick(40);
    run(`(() => { const h = __game.G.players[0].hook; h.state = 'retract'; h.len = __game.HOOK.minLen + 200; h.blast = true; })()`);
    tick(6);
    { const now = room.k, cur = G.players[0].hook.phase; const r = room.fire(0, { s: 300, at: now - 8 }, now);
      res.push(`interrupted swing: backdated=${r.back}, phase err ${Math.abs(G.players[0].hook.phase - cur).toExponential(1)}, len ${G.players[0].hook.len}`);
      assert.strictEqual(r.back, false); assert.ok(Math.abs(G.players[0].hook.phase - cur) < 1e-12); assert.strictEqual(G.players[0].hook.len, H0.minLen); }
    // an item the other player already holds is never taken by the catch-up (at most a tug of war starts)
    reset(); tick(40);
    { const now = room.k, at = now - 18, ph = histPh(0, at), ang = H0.maxAngle * Math.sin(ph);
      const px = G.players[0].x, py = run('__game.PIVOT_Y'), d = 110;
      const id = run(`(() => { const G = __game.G, it = __game.makeItem('gold_l', ${px + Math.sin(ang) * d}, ${py + Math.cos(ang) * d}); G.items.push(it);
        const q = G.players[1]; it.grabbedBy = 1; q.hook.item = it; q.hook.state = 'retract'; q.hook.len = 500; return it.id; })()`);
      const r = room.fire(0, { s: 400, at }, now);
      const it = G.items.find(i => i.id === id);
      res.push(`held item: grabbedBy ${it.grabbedBy} (was 1), P1 hook "${G.players[0].hook.state}", tug ${!!G.tug}`);
      assert.ok(r && r.back); assert.strictEqual(it.grabbedBy, 1);
      assert.ok(G.tug ? G.players[0].hook.state === 'tug' : true);
    }
    console.log('# O-32 ' + res.join('; '));
  } finally { await srv.close(); }
});
