// Performance probe (Mac-like conditions): frame times, CPU profile split by function, GC share, canvas size.
//   node tests/perf-probe.js [local|online] [width]x[height] [dpr] [cpuThrottle] [seconds]
//   e.g. node tests/perf-probe.js online 1728x1117 2 4 10
// Online: an in-process server; page A (measured) plays against page B (1280x720, unthrottled); both fire by themselves.
const L = require('./lib');
const path = require('path');
const { createServer } = require(path.join(L.ROOT, 'online', 'src', 'server'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PLAYER = `(() => {                       // presses fire every ~0.7 s, records rAF frame intervals
  window.__frames = []; let last = 0;
  const f = t => { if (last && window.__rec) window.__frames.push(t - last); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f);
  setInterval(() => { const g = window.__game; if (!g) return;
    const online = g.net.stats().ui === 'game', key = online || g.G.mode !== 'versus' ? 'KeyS' : (Math.random() < 0.5 ? 'KeyS' : 'ArrowDown');
    dispatchEvent(new KeyboardEvent('keydown', { code: key })); }, 700);
})()`;
const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : NaN; };

async function measure(opt) {
  const browser = opt.browser;
  const [w, h] = opt.size.split('x').map(Number);
  const srv = createServer({ port: 0, testHooks: true, fast: false, log: false, serveStatic: L.ROOT, gameHtml: L.INDEX, limits: { connPerMin: 1e4, perIp: 1e3, createPerHour: 1e3, joinFailPerMin: 1e3, joinFailPerHour: 1e4 } });
  const a = await srv.listen(0, '127.0.0.1'); const base = `http://127.0.0.1:${a.port}`; srv.cfg.allowedOrigins = [base];
  const ctxA = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: opt.dpr });
  const A = await ctxA.newPage(); A.errors = []; A.on('pageerror', e => A.errors.push(e.message));
  await A.addInitScript(PLAYER);
  await A.goto(base + '/index.html' + (opt.query || '')); await A.waitForFunction(() => window.__game);
  let B = null, ctxB = null;
  if (opt.mode === 'online') {
    await A.evaluate(() => __game.net.connect({ name: 'A' }));
    await A.waitForFunction(() => __game.net.stats().room.length === 6, null, { timeout: 10000 });
    const code = await A.evaluate(() => __game.net.stats().room);
    ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } }); B = await ctxB.newPage(); await B.addInitScript(PLAYER);
    await B.goto(base + '/index.html'); await B.waitForFunction(() => window.__game);
    await B.evaluate(c => __game.net.connect({ name: 'B', room: c }), code);
    await A.waitForFunction(() => __game.G.screen === 'select', null, { timeout: 10000 });
    for (const p of [A, B]) await p.keyboard.press('KeyS');
    await A.waitForFunction(() => __game.G.screen === 'play', null, { timeout: 15000 });
    await srv.api?.call; // (no-op)
  } else {
    await A.evaluate(() => { const g = __game; g.startMode('versus', [0, 1]); g.advance(3); });
  }
  await sleep(1500);
  const cdp = await ctxA.newCDPSession(A);
  if (opt.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: opt.cpu });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Performance.enable');
  const m0 = (await cdp.send('Performance.getMetrics')).metrics;
  await cdp.send('Profiler.start');
  await A.evaluate(() => { window.__frames = []; window.__rec = true; });
  await sleep(opt.secs * 1000);
  const frames = await A.evaluate(() => { window.__rec = false; return window.__frames; });
  const { profile } = await cdp.send('Profiler.stop');
  const m1 = (await cdp.send('Performance.getMetrics')).metrics;
  const info = await A.evaluate(() => { const c = document.getElementById('c'); return { canvas: c.width + 'x' + c.height, dpr: devicePixelRatio, dprLevel: __game.G.dprLevel, screen: __game.G.screen, netdebug: (__game.net.stats().interpDelayMs | 0) }; });
  // self time per function
  const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n])), dt = new Map();
  for (let i = 0; i < profile.samples.length; i++) dt.set(i, profile.timeDeltas[i] || 0);
  profile.samples.forEach((id, i) => { const n = byId.get(id), cf = n.callFrame, k = (cf.functionName || '(anon)') + (cf.lineNumber >= 0 && cf.url ? ':' + (cf.lineNumber + 1) : ''); self.set(k, (self.get(k) || 0) + (profile.timeDeltas[i + 1] || 0) / 1000); });
  const total = [...self.values()].reduce((x, y) => x + y, 0);
  const top = [...self.entries()].sort((x, y) => y[1] - x[1]).slice(0, opt.top || 14).map(([k, v]) => `${k} ${(100 * v / total).toFixed(1)}%`);
  const metric = (m, k) => (m.find(x => x.name === k) || {}).value || 0;
  const res = {
    mode: opt.mode, size: opt.size, dpr: opt.dpr, cpu: opt.cpu, query: opt.query || '', canvas: info.canvas, dprLevel: info.dprLevel, screen: info.screen, frames: frames.length,
    fps: +(1000 / (frames.reduce((x, y) => x + y, 0) / frames.length)).toFixed(1),
    p50: +pct(frames, 0.5).toFixed(1), p95: +pct(frames, 0.95).toFixed(1), p99: +pct(frames, 0.99).toFixed(1), max: +Math.max(...frames).toFixed(1),
    long33: +(100 * frames.filter(f => f > 33.4).length / frames.length).toFixed(2),
    gcPct: +(100 * (self.get('(garbage collector)') || 0) / total).toFixed(1),
    heapMB: +((metric(m1, 'JSHeapUsedSize')) / 1048576).toFixed(1), taskSec: +(metric(m1, 'TaskDuration') - metric(m0, 'TaskDuration')).toFixed(2), scriptSec: +(metric(m1, 'ScriptDuration') - metric(m0, 'ScriptDuration')).toFixed(2),
    D: info.netdebug, errors: A.errors.length, top,
  };
  await ctxA.close(); if (ctxB) await ctxB.close(); await srv.close();
  return res;
}
module.exports = { measure };
if (require.main === module) {
  (async () => {
    const [mode = 'online', size = '1728x1117', dpr = '2', cpu = '4', secs = '10', query = ''] = process.argv.slice(2);
    const browser = await L.launch();
    try { console.log(JSON.stringify(await measure({ browser, mode, size, dpr: +dpr, cpu: +cpu, secs: +secs, query }), null, 1)); }
    finally { await browser.close(); }
  })().catch(e => { console.error(e); process.exit(1); });
}
