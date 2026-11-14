// Desktop drawing cap / auto quality vs. display refresh rate (perf round 2).  Simulated vsync: rAF callbacks at the slots of the
// given period (+ jitter).  Each case: draws per second >= min(rate, 57), 120/144 Hz <= 75; perfLevel stays 0 for 15 s;
// the game clock runs 8.00 +- 0.05 s in 8 s.  Small canvas, DPR 2 and 1.25.
const L = require('./lib');
const { report } = L;
const RAF = (P, J) => `(() => { let q = [], armed = false;
  window.requestAnimationFrame = cb => { q.push(cb); if (!armed) { armed = true; const now = performance.now(), slot = Math.ceil((now + 0.5) / ${P}) * ${P}, ts = slot + (${J} ? (Math.random() * 2 - 1) * ${J} : 0);
    setTimeout(() => { armed = false; const l = q; q = []; for (const f of l) f(ts); }, Math.max(0, ts - now)); } return 1; };
  const st = CanvasRenderingContext2D.prototype.setTransform; window.__draws = 0;
  CanvasRenderingContext2D.prototype.setTransform = function (a) { if (this.canvas && this.canvas.id === 'c' && a !== 1) window.__draws++; return st.apply(this, arguments); };
})()`;
const CASES = [['60Hz', 1000 / 60, 0], ['60Hz jitter 15-18ms', 1000 / 60, 1.5], ['75Hz', 1000 / 75, 0], ['90Hz', 1000 / 90, 0], ['100Hz', 10, 0], ['120Hz', 1000 / 120, 0], ['144Hz', 1000 / 144, 0]];
async function one(browser, label, P, J, dpr) {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 270 }, deviceScaleFactor: dpr });
  const p = await ctx.newPage(); await p.addInitScript(RAF(P, J));
  await p.goto(L.URL); await p.waitForFunction(() => window.__game);
  await p.evaluate(() => { const G = __game.G; __game.startMode('versus', [0, 1]); __game.advance(3); G.time = 1e4; });   // a long round
  await p.waitForTimeout(1000);
  const r = await p.evaluate(async () => {
    const G = __game.G, t0 = G.time, w0 = performance.now(), d0 = window.__draws; let maxLevel = 0;
    for (let i = 0; i < 8; i++) { await new Promise(res => setTimeout(res, 1000)); maxLevel = Math.max(maxLevel, G.perfLevel); }
    const r = { gameSec: t0 - G.time, wall: (performance.now() - w0) / 1000, draws: (window.__draws - d0) / ((performance.now() - w0) / 1000) };
    for (let i = 0; i < 7; i++) { await new Promise(res => setTimeout(res, 1000)); maxLevel = Math.max(maxLevel, G.perfLevel); }   // 15 s in all
    return Object.assign(r, { maxLevel, screen: G.screen });
  });
  await ctx.close();
  const rate = 1000 / P, hi = rate >= 110;
  const ok = r.draws >= Math.min(rate, 57) && (!hi || r.draws <= 75) && r.maxLevel === 0 && Math.abs(r.gameSec - r.wall) <= 0.05 && r.screen === 'play';
  return { ok, msg: `${label}@${dpr}: ${r.draws.toFixed(1)} draws/s, game ${r.gameSec.toFixed(2)} s in ${r.wall.toFixed(2)} s, max perfLevel ${r.maxLevel}` };
}
async function run(browser) {
  const out = []; let ok = true;
  for (const dpr of [2, 1.25]) for (const [label, P, J] of CASES) { const r = await one(browser, label, P, J, dpr); ok = ok && r.ok; out.push((r.ok ? '' : 'FAIL ') + r.msg); }
  report('PERF-HZ', ok, out.join(' | '));
}
module.exports = { run };
