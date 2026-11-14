// Phase-4 online acceptance tests (SPEC-phase4-online s5): O-02, O-05, O-07, O-10..O-17, O-20..O-27, O-50, O-51.
// The online server (online/src/server.js) runs in this process on a random port, serving the game itself (SERVE_STATIC);
// pages open http://127.0.0.1:<port>/index.html and use real WebSocket connections.  "Real input" = page.keyboard / page.mouse only.
const L = require('./lib');
const fs = require('fs'), path = require('path');
const { report } = L;
const ONLINE = path.join(L.ROOT, 'online');
const { createServer } = require(path.join(ONLINE, 'src', 'server'));
const { startProxy } = require(path.join(ONLINE, 'test', 'netem-proxy'));
const { BROWSER_SRC, runVm } = require(path.join(ONLINE, 'test', 'driver'));
const { SimHost } = require(path.join(ONLINE, 'src', 'sim-host'));
const WebSocket = require(path.join(ONLINE, 'node_modules', 'ws'));
const SHOTS = path.join(L.SHOTS, 'online');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const G = (page, fn, arg) => page.evaluate(fn, arg);
const wait = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 30 });
const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) + '%' : 'n/a');
async function shot(page, name) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name) }); }
// records every fillText (text only) drawn while window.__cap is on
const TEXT_SPY = `(() => { if (window.__spy) return; window.__spy = 1; window.__texts = []; const ft = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, x, y) { if (window.__cap) window.__texts.push(String(t)); return ft.apply(this, arguments); }; })()`;
const frameTexts = page => G(page, () => new Promise(res => { window.__texts = []; window.__cap = true; requestAnimationFrame(() => requestAnimationFrame(() => { window.__cap = false; res(window.__texts); })); }));

// ---------------------------------------------------------------------------------------------------------------
//  server + pages
// ---------------------------------------------------------------------------------------------------------------
const RELAXED = { connPerMin: 10000, perIp: 1000, createPerHour: 1000, joinFailPerMin: 1000, joinFailPerHour: 10000 };   // all contexts share 127.0.0.1
async function startSrv(over = {}) {
  const srv = createServer(Object.assign({ port: 0, testHooks: true, fast: true, log: false, serveStatic: path.dirname(L.INDEX), gameHtml: L.INDEX, limits: RELAXED }, over));
  const a = await srv.listen(0, '127.0.0.1');
  srv.base = `http://127.0.0.1:${a.port}`;
  srv.cfg.allowedOrigins = [srv.base];                                        // ALLOWED_ORIGINS=http://127.0.0.1:<port>
  srv.api = async (p, body) => { const r = await fetch(srv.base + p, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }); return r.json(); };
  return srv;
}
const ALL_URLS = [], WS_URLS = [];
async function onlinePage(browser, url, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 720 } }, opts.ctx || {}));
  const page = await ctx.newPage();
  page.errors = []; page.ws = 0;
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push('console.error: ' + m.text()); });
  page.on('request', r => ALL_URLS.push(r.url()));
  page.on('websocket', w => { page.ws++; WS_URLS.push(w.url()); });
  if (opts.init) await page.addInitScript(opts.init);
  await page.addInitScript(TEXT_SPY);
  await page.goto(url);
  await page.waitForFunction(() => window.__game);
  page.ctx = ctx;
  return page;
}
// lobby with real input: A presses O, types a name, clicks "创建房间"; B opens the invitation link, types a name, clicks "加入房间"
async function realPair(browser, srv, o = {}) {
  const A = await onlinePage(browser, srv.base + '/index.html' + (o.qA || ''), { init: o.initA });
  await A.keyboard.press('KeyO');
  await A.waitForSelector('#net-name', { state: 'visible' });
  await A.keyboard.type(o.nameA || '甲');
  await A.click('#net-create');
  await A.waitForFunction(() => document.getElementById('net-code-big') && document.getElementById('net-code-big').textContent.length === 6, null, { timeout: 8000 });
  const code = await A.textContent('#net-code-big');
  if (o.seed != null) await srv.api(`/__test/room/${code}/seed`, { seed: o.seed });
  const B = await onlinePage(browser, srv.base + '/index.html' + (o.qB || '') + '#room=' + code, { init: o.initB });
  await B.waitForSelector('#net-name', { state: 'visible' });
  await B.keyboard.type(o.nameB || '乙');
  await B.click('#net-join');
  if (o.noWait) return { A, B, code };
  await A.waitForFunction(() => __game.G.screen === 'select', null, { timeout: 8000 });
  await B.waitForFunction(() => __game.G.screen === 'select', null, { timeout: 8000 });
  return { A, B, code };
}
// character select with real keys: A moves right once, both confirm
async function realSelect(A, B) {
  await A.keyboard.press('KeyD'); await A.keyboard.press('KeyS');
  await B.keyboard.press('ArrowLeft'); await B.keyboard.press('ArrowDown');
  await A.waitForFunction(() => __game.G.screen === 'intro' || __game.G.screen === 'play', null, { timeout: 8000 });
}
// in-page bot + frame recorder: decides when its own player should fire; the test presses the real key
const ONLINE_BOT = `(() => {
  const g = window.__game, H = g.HOOK, PIVOT_Y = g.PIVOT_Y;
  const EV = { bag: 250, piggy: 400, egg: 260, chest: 700, hourglass: 150, clover: 150, lamp: 150, meteor: 450 };
  const val = it => it.value || EV[it.type] || 0;
  const O = window.__onl = { want: null, rec: [], recOn: false, keys: [], idle: 0 };
  addEventListener('keydown', e => { if (O.recOn) O.keys.push({ t: performance.now(), code: e.code }); }, true);
  function firstHit(p) {
    const a = p.hook.angle, sx = Math.sin(a), cy = Math.cos(a); let best = null, bd = 1e9;
    for (const it of g.G.items) { if (it.dead || it.grabbedBy >= 0) continue; const dx = it.x - p.x, dy = it.y - PIVOT_Y, along = dx * sx + dy * cy; if (along <= 0) continue;
      if (Math.abs(dx * cy - dy * sx) < (it.hr || it.r) + H.radius - 2 && along < bd) { bd = along; best = it; } }
    return best;
  }
  function loop() {
    const s = g.net.stats(), G = g.G, me = G.players[s.you], op = G.players[1 - s.you];
    if (O.recOn && me && op) O.rec.push({ t: performance.now(), sc: G.screen, st: me.hook.state, len: me.hook.len, ang: me.hook.angle, pred: s.predActive,
      sp: H.extend * (me.buffs.gear ? H.gear : 1) * (g.CHARS[me.char].extend || 1), ost: op.hook.state, oang: op.hook.angle, paused: !!G.paused, rt: s.renderTick });
    O.want = null;
    if (G.screen === 'play' && !G.paused && me && me.alive && s.connected && !s.pause && !G.timeUp) {
      const h = me.hook;
      if (G.tug && (G.tug.holder === s.you || G.tug.ch === s.you)) O.want = 'mash';
      else if (h.state === 'swing' && !s.predActive && me.frozen <= 0) {
        const it = firstHit(me); O.idle++;
        if ((it && (val(it) / Math.max(0.6, it.weight) >= 60 || val(it) >= 300)) || O.idle > 45) O.want = 'fire';
      } else if (h.state === 'retract' && h.item && me.dyn > 0 && h.item.weight >= 4 && val(h.item) < 100 && h.len > 200) O.want = 'dyn';
      if (h.state !== 'swing') O.idle = 0;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})()`;
// plays one page until its game reaches the final page: fire / dynamite / tug mashing in play, Space on results, S then W in the shop
async function drive(page, opt = {}) {
  const t0 = Date.now(), limit = opt.limit || 6 * 60 * 1000;
  let lastFire = 0, shopRound = -1, bought = false, readyAt = 0, nextAt = 0, sampleAt = 0;
  const samples = [];
  const fireKeys = ['KeyS', 'ArrowDown'], dynKeys = ['KeyW', 'ArrowUp'];
  for (;;) {
    const st = await G(page, () => { const g = __game, G = g.G, s = g.net.stats(), me = s.seats[s.you] || {}; return { sc: G.screen, want: window.__onl.want, rT: G.resultsT, round: G.round, shopReady: !!(G.shop[s.you] && G.shop[s.you].ready),
      next: !!me.next, pause: s.pause, rx: s.rxBytes, tx: s.txBytes, D: s.interpDelayMs, conn: s.connected }; });
    const now = Date.now();
    if (now - sampleAt >= 1000) { sampleAt = now; samples.push({ t: now, rx: st.rx, tx: st.tx, D: st.D, sc: st.sc }); }
    if (st.sc === 'final' || now - t0 > limit || (opt.until && await opt.until())) break;
    if (st.conn && !st.pause) {
      if (st.sc === 'play' && st.want) {
        if (st.want === 'fire' && now - lastFire > 120) { await page.keyboard.press(fireKeys[Math.random() < 0.5 ? 0 : 1]); lastFire = now; }
        else if (st.want === 'dyn') await page.keyboard.press(dynKeys[Math.random() < 0.5 ? 0 : 1]);
        else if (st.want === 'mash' && now - lastFire > 70) { await page.keyboard.press(fireKeys[0]); lastFire = now; }
      } else if (st.sc === 'results' && !st.next && st.rT > 0.6 && now > nextAt) { await page.keyboard.press('Space'); nextAt = now + 800; }
      else if (st.sc === 'shop') {
        if (shopRound !== st.round) { shopRound = st.round; bought = false; readyAt = now + 500; }
        if (now > readyAt && !bought) { await page.keyboard.press('KeyS'); bought = true; readyAt = now + 300; }
        else if (now > readyAt && !st.shopReady) { await page.keyboard.press('KeyW'); readyAt = now + 900; }
      }
    }
    await sleep(opt.poll || 20);
  }
  return { samples, ms: Date.now() - t0 };
}
// once per round the server tops both players up to the round target (test setup through /__test/eval): with FAST=1 rounds of
// 10 s nobody reaches the target and versus ends at the first elimination, so without it a game is a single round
function topUp(srv, code) {
  let stop = false, boosted = 0;
  const done = (async () => { while (!stop) { const st = await srv.api(`/__test/room/${code}/state`).catch(() => null); if (!st || !st.state) break;
    if (st.state.screen === 'play' && st.state.round !== boosted) { boosted = st.state.round;
      await srv.api(`/__test/room/${code}/eval`, { code: '(() => { const G = __game.G, t = __game.curTarget(); for (const p of G.players) p.money = Math.max(p.money, t + 50); })()' }); }
    await sleep(300); } })();
  return { stop: async () => { stop = true; await done; } };
}
async function finalsAgree(pages, srv, code) {
  const fs_ = [];
  for (const p of pages) fs_.push(await G(p, () => JSON.stringify(__game.G.final)));
  const st = await srv.api(`/__test/room/${code}/state`);
  const sv = JSON.stringify(st.final);
  return { same: fs_.every(f => f === sv) && sv !== 'null', server: st.final, pages: fs_.map(f => JSON.parse(f)) };
}
const scoreStr = f => (f ? `winner ${f.winner}, ${f.scores.map(s => `P${s.player + 1} $${s.score} (round ${s.rounds})`).join(' / ')}` : 'none');
async function closeAll(...pages) { for (const p of pages) if (p) await p.ctx.close().catch(() => {}); }

// ---------------------------------------------------------------------------------------------------------------
//  O-02 golden: the same input script in the browser (press + advance) and in the vm host -> identical results, seeds 1-20
// ---------------------------------------------------------------------------------------------------------------
async function o02(browser) {
  const page = await L.newPage(browser, L.URL);
  const host = new SimHost(L.INDEX), gm = host.createGame();
  let same = 0; const bad = [];
  for (let seed = 1; seed <= 20; seed++) {
    const b = await page.evaluate(`(${BROWSER_SRC})(${seed})`);
    const v = runVm(gm, seed);
    const ok = JSON.stringify(b.rounds) === JSON.stringify(v.rounds) && JSON.stringify(b.final) === JSON.stringify(v.final) && b.screen === 'final';
    if (ok) same++; else bad.push(seed);
  }
  report('O-02', same === 20 && page.errors.length === 0, `versus seeds 1-20, scripted inputs (fire every 37 ticks alternating, dynamite on < $50, buy first affordable + ready): browser (press+advance) vs vm host (net.input+net.step) per-round [P1,P2] money and G.final JSON byte-identical ${same}/20${bad.length ? ' DIFF seeds ' + bad : ''}; page errors ${page.errors.length}`);
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------------------
//  O-05 snapshot completeness: page A plays locally, page B only applies A's snapshots; both rendered, pixels compared
// ---------------------------------------------------------------------------------------------------------------
async function o05(browser) {
  const noLoop = 'window.requestAnimationFrame = () => 0;';                    // no game loop: each picture is drawn by net.render()
  const A = await L.newPage(browser, L.URL, { init: noLoop }), B = await L.newPage(browser, L.URL, { init: noLoop });
  await A.evaluate(() => { const g = __game; g.reseed(3); g.startMode('versus', [2, 4]); });
  const freezeT = 123.4;
  const moments = [];
  const capture = async label => {
    // G.t is frozen only for the picture (the game's own clock is restored afterwards: the shop timing reads it)
    const [snap, imgA] = await A.evaluate(t => { const g = __game, G = g.G, keep = G.t; G.t = t; G.particles = []; G.texts = []; g.reseed(77); g.net.render();
      const s = g.net.snapshot(), img = document.getElementById('c').toDataURL('image/png'); G.t = keep; return [s, img]; }, freezeT);
    const r = await B.evaluate(async ({ snap, t, imgA }) => {
      const g = __game, G = g.G; g.net.apply({ t: 'snap', k: 1, full: 1, d: snap }); G.t = t; G.particles = []; G.texts = []; g.reseed(77); g.net.render();
      const c = document.getElementById('c'), w = c.width, h = c.height, mine = c.getContext('2d').getImageData(0, 0, w, h).data;
      const im = new Image(); im.src = imgA; await im.decode();
      const o = document.createElement('canvas'); o.width = w; o.height = h; const oc = o.getContext('2d'); oc.drawImage(im, 0, 0); const other = oc.getImageData(0, 0, w, h).data;
      let diff = 0; for (let i = 0; i < mine.length; i += 4) if (Math.abs(mine[i] - other[i]) > 8 || Math.abs(mine[i + 1] - other[i + 1]) > 8 || Math.abs(mine[i + 2] - other[i + 2]) > 8) diff++;
      return { diff, n: w * h };
    }, { snap, t: freezeT, imgA });
    moments.push({ label, p: r.diff / r.n });
  };
  // a scripted game with forced situations: rounds 1-8 (events, ice, lava, stone doors), a tug of war, results, shop, final
  const forced = { 2: 'blackout', 3: 'meteor', 4: 'wind', 5: 'goldrush', 6: 'quake', 7: 'molearmy', 8: 'meteor' };
  const seen = { tug: 0, event: 0, vent: 0, slab: 0 };
  for (let round = 1; round <= 8; round++) {
    await A.evaluate(ev => { __game.G.forceEvent = ev || null; }, forced[round + 1] || null);
    await A.evaluate(() => __game.advance(0.3)); await capture(`r${round} intro`);
    await A.evaluate(() => { const G = __game.G; while (G.screen === 'intro') __game.advance(1 / 60); });
    for (const tt of [2.5, 9, 16]) {
      await A.evaluate(tt => { const g = __game, G = g.G; while (G.playT < tt && G.screen === 'play') { if (Math.floor(G.playT * 60) % 40 === 0) { g.press('KeyS'); g.press('ArrowDown'); } g.advance(1 / 60); } }, tt);
      const st = await A.evaluate(() => ({ ev: !!(__game.G.event && __game.G.event.fired), hz: __game.G.hazards.map(h => h.kind) }));
      if (st.ev) seen.event++; if (st.hz.includes('vent')) seen.vent++; if (st.hz.includes('slab')) seen.slab++;
      await capture(`r${round} play ${tt}s`);
    }
    if (round === 2 || round === 6) {                                         // tug of war over a fresh nugget
      await A.evaluate(() => { const g = __game, G = g.G, [a, b] = G.players; const it = g.makeItem('gold_l', 640, 500); G.items.push(it); it.grabbedBy = 0; a.hook.item = it; a.hook.state = 'retract'; a.hook.len = 380; a.hook.angle = Math.atan2(640 - a.x, 500 - g.PIVOT_Y); g.startTug(a, b, it); G.tug.x = -0.3; g.advance(0.5); });
      seen.tug++; await capture(`r${round} tug`);
      await A.evaluate(() => { __game.resolveTug(0); });
    }
    await A.evaluate(() => { const g = __game, G = g.G; for (const p of G.players) p.money += 40000; G.time = 0.01; while (G.screen === 'play') g.advance(1 / 60); g.advance(1.2); });
    await capture(`r${round} results`);
    if (round < 8) {
      await A.evaluate(() => { const g = __game; g.afterResults(); g.advance(0.4); g.press('KeyD'); });
      await capture(`r${round} shop`);
      await A.evaluate(() => { const g = __game; g.press('KeyW'); g.press('ArrowUp'); g.advance(1 / 60); });
    } else { await A.evaluate(() => { __game.afterResults(); __game.advance(0.5); }); await capture('final'); }
  }
  const worst = moments.reduce((a, b) => (b.p > a.p ? b : a));
  if (process.env.O05_DEBUG) console.log(moments.map(m => m.label + ' ' + (m.p * 100).toFixed(3)).join('\n'));
  const ok = moments.length >= 20 && worst.p <= 0.005 && seen.tug && seen.event && seen.vent && seen.slab && A.errors.length + B.errors.length === 0;
  report('O-05', ok, `${moments.length} moments (intro/play/results/shop/final; tug ${seen.tug}, fired events ${seen.event}, lava rounds ${seen.vent}, stone-door rounds ${seen.slab}): page B rendering from A's snapshot differs from A by at most ${(worst.p * 100).toFixed(3)}% of pixels (${worst.label}; limit 0.5%); median ${(median(moments.map(m => m.p)) * 100).toFixed(3)}%; errors ${A.errors.length + B.errors.length}`);
  await A.context().close(); await B.context().close();
}

// ---------------------------------------------------------------------------------------------------------------
//  O-07 local modes untouched: AC-06 menu keys, and no WebSocket at all without entering online play
// ---------------------------------------------------------------------------------------------------------------
async function o07(browser, srv) {
  const page = await onlinePage(browser, srv.base + '/index.html');
  const kb = page.keyboard, mm = () => G(page, () => __game.G.menuMode);
  const seq = [await mm()];
  await kb.press('ArrowLeft'); seq.push(await mm()); await kb.press('ArrowLeft'); seq.push(await mm());
  for (let i = 0; i < 5; i++) await kb.press('KeyD'); seq.push(await mm());
  const direct = []; for (const k of ['Digit1', 'Digit2', 'Digit3']) { await kb.press(k); direct.push(await mm()); }
  const order = await G(page, () => __game.MENU_ORDER.join(','));
  // a full local versus game through the keyboard, then back to the menu: still no socket
  await kb.press('Digit2'); await kb.press('Space'); await kb.press('KeyS'); await kb.press('ArrowDown');
  await wait(page, () => __game.G.screen === 'intro' || __game.G.screen === 'play', null, 5000);
  await sleep(1500); await kb.press('KeyP'); await sleep(200); await kb.press('KeyS'); await kb.press('KeyS'); await kb.press('Space');
  const back = await G(page, () => __game.G.screen);
  await sleep(500);
  const ok = seq.join() === '1,0,0,2' && direct.join() === '0,1,2' && order === 'solo,versus,coop' && back === 'start' && page.ws === 0 && page.errors.length === 0;
  report('O-07', ok, `served over http: default menuMode ${seq[0]}, ArrowLeft x2 -> ${seq[1]},${seq[2]} (no wrap), KeyD x5 -> ${seq[3]}; Digit1/2/3 -> ${direct}; MENU_ORDER=${order}; local versus game started and left via the pause menu (screen ${back}); WebSockets opened: ${page.ws}; errors ${page.errors.length}`);
  await closeAll(page);
}

// ---------------------------------------------------------------------------------------------------------------
//  frame analysis helpers (recorded in the page by ONLINE_BOT)
// ---------------------------------------------------------------------------------------------------------------
const DEG = 180 / Math.PI;
function swingSmooth(rec) {                    // O-15: the other player's hook while swinging, frame to frame
  let n = 0, ok = 0;
  for (let i = 1; i < rec.length; i++) {
    const a = rec[i - 1], b = rec[i];
    if (a.sc !== 'play' || b.sc !== 'play' || a.paused || b.paused || a.ost !== 'swing' || b.ost !== 'swing') continue;
    n++; if (Math.abs(b.oang - a.oang) * DEG <= 6) ok++;
  }
  return { n, ok };
}
function predictionCheck(rec, keys) {          // O-14: next frame after the key shows the hook out; extension frames follow speed x dt (+-30 px)
  let presses = 0, nextOk = 0, n = 0, ok = 0, worst = 0;
  for (const k of keys) {
    if (k.code !== 'KeyS' && k.code !== 'ArrowDown') continue;
    const i = rec.findIndex(f => f.t > k.t);
    if (i < 1 || rec[i - 1].st !== 'swing' || rec[i - 1].sc !== 'play' || rec[i - 1].paused) continue;   // only presses that start a fire
    if (!rec[i].pred && rec[i].st === 'swing') continue;                          // the page itself refused (e.g. tug / frozen)
    presses++;
    if (rec[i].st === 'extend' && rec[i].len > 34) nextOk++;
    for (let j = i + 1; j < rec.length && rec[j].st === 'extend' && rec[j - 1].st === 'extend'; j++) {
      const dt = (rec[j].t - rec[j - 1].t) / 1000, dev = Math.abs((rec[j].len - rec[j - 1].len) - rec[j].sp * dt);
      n++; if (dev <= 30) ok++; worst = Math.max(worst, dev);
      if (dev > 30 && process.env.O14_DEBUG) console.log('O14 dev', dev.toFixed(1), JSON.stringify(rec.slice(Math.max(i, j - 3), j + 2).map(f => [Math.round(f.t), f.st, Math.round(f.len), f.pred, f.rt && Math.round(f.rt * 10) / 10])));
    }
  }
  return { presses, nextOk, n, ok, worst };
}
function fireAccuracy(fires) {                 // O-13
  const shown = fires.filter(f => f.shownAngle != null);
  const err = shown.map(f => ({ e: Math.abs(f.shownAngle - f.serverAngle), back: f.back }));
  const within = err.filter(x => x.e <= 1.5).length, notBack = err.filter(x => !x.back).length;
  // out-of-window fires whose own input message was held back >= 250 ms extra by the simulated network (a 300 ms stall, or queued behind one)
  const stalled = shown.filter(f => !f.back && f.sim && (f.sim.stall || f.sim.held >= 400)).length;
  const maxBack = err.filter(x => x.back).reduce((m, x) => Math.max(m, x.e), 0);
  return { total: fires.length, n: err.length, within, notBack, stalled, maxBack, maxAll: err.reduce((m, x) => Math.max(m, x.e), 0) };
}
function bandwidth(samples) {                  // O-17: bytes per second from 1 s samples taken while the game ran
  const play = samples.filter(s => s.sc !== 'select');
  if (play.length < 3) return null;
  const rx = [], tx = [];
  for (let i = 1; i < play.length; i++) { const dt = (play[i].t - play[i - 1].t) / 1000; rx.push((play[i].rx - play[i - 1].rx) / dt); tx.push((play[i].tx - play[i - 1].tx) / dt); }
  const span = (play[play.length - 1].t - play[0].t) / 1000;
  return { rxAvg: (play[play.length - 1].rx - play[0].rx) / span, rxPeak: Math.max(...rx), txAvg: (play[play.length - 1].tx - play[0].tx) / span };
}
async function recOf(page) { return G(page, () => ({ rec: window.__onl.rec, keys: window.__onl.keys, fires: __game.net.stats().fires })); }
async function startRec(...pages) { for (const p of pages) await G(p, () => { window.__onl.rec = []; window.__onl.keys = []; window.__onl.recOn = true; }); }
const shotOnce = {};
async function shotWhen(page, name, fn) { if (shotOnce[name]) return; shotOnce[name] = 1; await shot(page, name); if (fn) await fn(); }

// ---------------------------------------------------------------------------------------------------------------
//  O-10 full game with real input, O-11 play again, O-15 smoothness, O-17 bandwidth, O-26 (no seat token in any URL)
// ---------------------------------------------------------------------------------------------------------------
async function o10(browser, srv) {
  const { A, B, code } = await realPair(browser, srv, { seed: 5 });
  for (const p of [A, B]) await p.evaluate(ONLINE_BOT);
  await sleep(300); await shot(B, '03-select.png');
  await realSelect(A, B);
  await wait(A, () => __game.G.screen === 'play', null, 8000);
  await startRec(A, B);
  await sleep(1200); await shot(A, '04-play-you-tag.png');
  const [ra, rb] = await Promise.all([drive(A), drive(B)]);
  await wait(A, () => __game.G.screen === 'final', null, 20000); await wait(B, () => __game.G.screen === 'final', null, 20000);
  await sleep(500);
  const fin = await finalsAgree([A, B], srv, code);
  const you = [await G(A, () => __game.net.stats().you), await G(B, () => __game.net.stats().you)];
  const errs = A.errors.length + B.errors.length;
  report('O-10', you[0] === 0 && you[1] === 1 && fin.same && errs === 0,
    `FAST=1 seed 5, lobby/select/play/results/shop by real keys and clicks, two contexts: A is player ${you[0] + 1}, B is player ${you[1] + 1}; G.final identical on A, B and the server: ${fin.same} (${scoreStr(fin.server)}); ${(Math.max(ra.ms, rb.ms) / 1000).toFixed(0)} s; errors ${errs}`);
  await shot(A, '09-final-again.png');
  // ---- O-11: play again
  await A.keyboard.press('Space');
  await sleep(1200);
  const mid = { a: await G(A, () => __game.G.screen), b: await G(B, () => __game.G.screen), bSees: await G(B, () => !!(__game.net.stats().seats[0] || {}).again) };
  const tx = await frameTexts(B);
  mid.text = tx.includes('对方想再来一局!');
  await shot(B, '10-final-other-wants-again.png');
  await B.keyboard.press('Enter');
  await wait(A, () => __game.G.screen === 'select', null, 5000); await wait(B, () => __game.G.screen === 'select', null, 5000);
  const codes = [await G(A, () => __game.net.stats().room), await G(B, () => __game.net.stats().room)];
  await realSelect(A, B);
  // the second game goes through all 8 rounds (topUp)
  let shopSeen = 0;
  const boost = topUp(srv, code);
  const shopShot = async () => { const sc = await G(A, () => __game.G.screen); if (sc === 'shop') { shopSeen++; if (!shotOnce['08-shop-opponent.png'] && shopSeen > 20) await shotWhen(A, '08-shop-opponent.png'); } return false; };
  const [r2a, r2b] = await Promise.all([drive(A, { until: shopShot }), drive(B)]);
  await boost.stop();
  await wait(A, () => __game.G.screen === 'final', null, 20000); await wait(B, () => __game.G.screen === 'final', null, 20000);
  await sleep(500);
  const fin2 = await finalsAgree([A, B], srv, code);
  const errs2 = A.errors.length + B.errors.length;
  // O-15 / O-17 over both games (no injection)
  const recA = await recOf(A), recB = await recOf(B);
  const sm = [swingSmooth(recA.rec), swingSmooth(recB.rec)];
  const smN = sm[0].n + sm[1].n, smOk = sm[0].ok + sm[1].ok;
  const Ds = ra.samples.concat(rb.samples, r2a.samples, r2b.samples).filter(x => x.sc === 'play').map(x => x.D);
  const bw = [bandwidth(ra.samples), bandwidth(rb.samples), bandwidth(r2a.samples), bandwidth(r2b.samples)];
  report('O-15', smN > 300 && smOk / smN >= 0.99 && median(Ds) <= 100,
    `no injection, both games: other player's swinging hook, frame-to-frame angle change <= 6 deg in ${smOk}/${smN} frames (${pct(smOk, smN)}, need >= 99%); interpolation delay median ${median(Ds).toFixed(1)} ms (need <= 100; min ${Math.min(...Ds).toFixed(0)}, max ${Math.max(...Ds).toFixed(0)})`);
  const bwOk = bw.every(b => b && b.rxAvg <= 25600 && b.rxPeak <= 81920 && b.txAvg <= 2048);
  report('O-17', bwOk, bw.map((b, i) => `${['A game 1', 'B game 1', 'A game 2 (8 rounds)', 'B game 2'][i]}: down avg ${(b.rxAvg / 1024).toFixed(2)} KB/s, peak 1 s ${(b.rxPeak / 1024).toFixed(2)} KB/s, up avg ${(b.txAvg / 1024).toFixed(3)} KB/s`).join(' | ') + ' (limits 25 / 80 / 2 KB/s)');
  report('O-11', mid.a === 'final' && mid.b === 'final' && mid.bSees && mid.text && codes.every(c => c === code) && fin2.same && fin2.server.scores[0].rounds === 8 && errs2 === 0,
    `A pressed Space only: both still on final (${mid.a}/${mid.b}), B shows "对方想再来一局!"=${mid.text}; B pressed Enter -> both on character select, room code ${codes.join('/')} (was ${code}); second game by real keys through all 8 rounds (results Space, shop S/W; money topped up to each target by the test) in ${(Math.max(r2a.ms, r2b.ms) / 1000).toFixed(0)} s: finals identical on A, B, server: ${fin2.same} (${scoreStr(fin2.server)}); errors ${errs2}`);
  // seat tokens never travel in a URL
  const tokens = [await G(A, c => JSON.parse(localStorage.getItem('goldminer.online.' + c)).seat, code), await G(B, c => JSON.parse(localStorage.getItem('goldminer.online.' + c)).seat, code)];
  const leak = ALL_URLS.concat(WS_URLS).filter(u => tokens.some(t => u.includes(t)));
  await closeAll(A, B);
  return { tokens, leak };
}

// ---------------------------------------------------------------------------------------------------------------
//  O-12 lag 100 +- 50 ms, 2% stalls of 300 ms: three games (seeds 5, 6, 7) at once; O-13 aim accuracy; O-14 prediction
// ---------------------------------------------------------------------------------------------------------------
async function o12(browser) {
  const srv = await startSrv({ netSim: { lat: 100, jitter: 50, stallP: 0.02, stallMs: 300 } });
  try {
    const out = [], fires = [], pc = { presses: 0, nextOk: 0, n: 0, ok: 0, worst: 0 };
    let allSame = true, errs = 0;
    for (const seed of [5, 6, 7]) {                                           // one game after the other (no CPU contention between them)
      const r = Object.assign(await realPair(browser, srv, { seed, nameA: '甲' + seed, nameB: '乙' + seed }), { seed });
      for (const p of [r.A, r.B]) await p.evaluate(ONLINE_BOT);
      await realSelect(r.A, r.B); await startRec(r.A, r.B);
      const boost = topUp(srv, r.code);                                     // 8 rounds: enough fires for the percentages
      await Promise.all([drive(r.A), drive(r.B)]);
      await boost.stop();
      await wait(r.A, () => __game.G.screen === 'final', null, 30000).catch(() => {}); await wait(r.B, () => __game.G.screen === 'final', null, 30000).catch(() => {});
      await sleep(800);
      const f = await finalsAgree([r.A, r.B], srv, r.code); allSame = allSame && f.same;
      errs += r.A.errors.length + r.B.errors.length;
      out.push(`seed ${r.seed}: ${f.same ? 'same' : 'DIFFERENT'} (${scoreStr(f.server)})`);
      for (const p of [r.A, r.B]) {
        const rc = await recOf(p); fires.push(...rc.fires);
        const q = predictionCheck(rc.rec, rc.keys); for (const k in pc) pc[k] = k === 'worst' ? Math.max(pc.worst, q.worst) : pc[k] + q[k];
      }
      await closeAll(r.A, r.B);
    }
    report('O-12', allSame && errs === 0, `NET_SIM lat=100,jitter=50,stall=0.02:300, three games (money topped up to each round target, so all 8 rounds are played), all reached final with identical scores on both pages and the server: ${out.join('; ')}; errors ${errs}`);
    const fa = fireAccuracy(fires);
    const ages = fires.map(f => f.age).filter(a => a != null).sort((a, b) => a - b);
    if (process.env.O13_DEBUG) console.log(fires.map(f => JSON.stringify(f)).join('\n'));
    report('O-13', fa.n >= 30 && fa.within / fa.n >= 0.95 && fa.notBack / fa.n <= 0.02 && fa.maxBack <= 4,
      `${fa.n} fires with a shown angle (of ${fa.total} server fires): |shown - server| <= 1.5 deg for ${fa.within} (${pct(fa.within, fa.n)}, need >= 95%); outside the look-back window ${fa.notBack} (${pct(fa.notBack, fa.n)}, need <= 2%; ${fa.stalled} of them had their own input message stalled by the simulated network); max error of the lag-compensated ones ${fa.maxBack.toFixed(3)} deg (need <= 4); max overall ${fa.maxAll.toFixed(2)} deg; age of the aimed tick on arrival p50 ${ages[ages.length >> 1]} / p95 ${ages[Math.floor(ages.length * 0.95)]} / max ${ages[ages.length - 1]} ticks (window 30)`);
    report('O-14', pc.presses >= 30 && pc.nextOk === pc.presses && pc.ok / pc.n >= 0.98,
      `${pc.presses} fire presses: next frame shows the own hook extending with len > HOOK.minLen in ${pc.nextOk}/${pc.presses}; extension frames with |delta len - speed x dt| <= 30 px: ${pc.ok}/${pc.n} (${pct(pc.ok, pc.n)}, need >= 98%; worst ${pc.worst.toFixed(1)} px)`);
  } finally { await srv.close(); }
}

// ---------------------------------------------------------------------------------------------------------------
//  O-16 tug of war on the same nugget, real keys
// ---------------------------------------------------------------------------------------------------------------
async function o16(browser, srv) {
  const { A, B, code } = await realPair(browser, srv, { seed: 11 });
  try {
    await realSelect(A, B);
    await wait(A, () => __game.G.screen === 'play', null, 8000); await sleep(400);
    // A has just grabbed a (very heavy, so slow) giant nugget in the middle of the field
    await srv.api(`/__test/room/${code}/eval`, { code: `(() => { const g = __game, G = g.G; G.items = []; G.event = null; G.hazards = []; G.time = 60;
      const a = G.players[0], it = g.makeItem('gold_xl', 640, 470); it.weight = 40; G.items.push(it); it.grabbedBy = 0;
      const dx = it.x - a.x, dy = it.y - g.PIVOT_Y, ang = Math.atan2(dx, dy), len = Math.hypot(dx, dy) - it.r * 0.55;
      a.hook.state = 'retract'; a.hook.item = it; a.hook.angle = ang; a.hook.len = len; a.hook.offx = it.x - (a.x + Math.sin(ang) * len); a.hook.offy = it.y - (g.PIVOT_Y + Math.cos(ang) * len);
      return it.id; })()` });
    await sleep(500);
    // B aims at it with its own (interpolated) hook and presses the real key
    const aimed = await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 15000) {
        const d = await G(B, () => { const g = __game, G = g.G, s = g.net.stats(), me = G.players[s.you], it = G.items.find(i => i.type === 'gold_xl' && i.weight === 40);
          if (!it || !me || me.hook.state !== 'swing' || s.predActive) return null; return (me.hook.angle - Math.atan2(it.x - me.x, it.y - g.PIVOT_Y)) * 180 / Math.PI; });
        if (d !== null && Math.abs(d) < 1.5) { await B.keyboard.press('ArrowDown'); return true; }
        await sleep(3);
      }
      return false;
    })();
    await wait(A, () => !!__game.G.tug, null, 5000); await wait(B, () => !!__game.G.tug, null, 5000);
    await shot(B, '05-tug.png');
    const both = [await G(A, () => !!__game.G.tug), await G(B, () => !!__game.G.tug)];
    // both mash their fire keys for the whole tug (5 s)
    let presses = [0, 0]; const t0 = Date.now();
    const mash = async (p, key, i) => {                                 // mash while this page still shows the tug (a press after it would fire again)
      while (Date.now() - t0 < 7000 && await G(p, () => !!__game.G.tug)) { await p.keyboard.press(key); presses[i]++; await sleep(40 + i * 25); }
    };
    await Promise.all([mash(A, 'KeyS', 0), mash(B, 'ArrowDown', 1)]);
    const tugMs = Date.now() - t0;
    const st = await srv.api(`/__test/room/${code}/state`);
    const owner = (st.state.items.find(i => i.type === 'gold_xl' && i.weight === 40) || {}).grabbedBy;
    await sleep(700);
    const shown = [await G(A, () => (__game.G.items.find(i => i.type === 'gold_xl' && i.weight === 40) || {}).grabbedBy), await G(B, () => (__game.G.items.find(i => i.type === 'gold_xl' && i.weight === 40) || {}).grabbedBy)];
    // let the winner reel it in quickly, then compare the money on all three
    await srv.api(`/__test/room/${code}/eval`, { code: `(() => { for (const it of __game.G.items) if (it.weight === 40) it.weight = 1; })()` });
    await sleep(3000);
    const st2 = await srv.api(`/__test/room/${code}/state`);
    if (process.env.O16_DEBUG) console.log(JSON.stringify({ hooks: st2.state.players.map(p => p.hook), items: st2.state.items, screen: st2.state.screen, time: st2.state.time, st1: { tug: st.state.tug, hooks: st.state.players.map(p => p.hook) } }));
    const mS = st2.state.players.map(p => p.money).join(','), mA = await G(A, () => __game.G.players.map(p => p.money).join(',')), mB = await G(B, () => __game.G.players.map(p => p.money).join(','));
    const errs = A.errors.length + B.errors.length;
    report('O-16', aimed && both.every(Boolean) && st.state.tug === null && shown[0] === owner && shown[1] === owner && mA === mS && mB === mS && errs === 0,
      `B aimed with its interpolated hook and pressed ArrowDown: tug on A=${both[0]} B=${both[1]}; real mashing ${presses[0]} (A) / ${presses[1]} (B) presses for ${(tugMs / 1000).toFixed(1)} s; after the tug the nugget belongs to P${owner + 1} on the server, A shows P${shown[0] + 1}, B shows P${shown[1] + 1}; money after delivery server ${mS}, A ${mA}, B ${mB}; errors ${errs}`);
  } finally { await closeAll(A, B); }
}

// ---------------------------------------------------------------------------------------------------------------
//  O-20 drop + reconnect, O-21 reload, both played to the end at the same time
// ---------------------------------------------------------------------------------------------------------------
async function o20o21(browser, srv) {
  const r20 = await realPair(browser, srv, { seed: 21, nameA: '甲', nameB: '乙' });
  const r21 = await realPair(browser, srv, { seed: 22, nameA: '丙', nameB: '丁' });
  for (const p of [r20.A, r20.B, r21.A, r21.B]) await p.evaluate(ONLINE_BOT);
  await realSelect(r20.A, r20.B); await realSelect(r21.A, r21.B);
  await wait(r20.A, () => __game.G.screen === 'play', null, 8000); await wait(r21.A, () => __game.G.screen === 'play', null, 8000);
  let stopB21 = false;
  const games = [drive(r20.A), drive(r20.B), drive(r21.A), drive(r21.B, { until: async () => stopB21 })];
  // ---- O-20
  await sleep(2500);
  const st0 = await srv.api(`/__test/room/${r20.code}/state`);
  const drop = await srv.api(`/__test/drop?room=${r20.code}&slot=1`, {});
  const tDrop = Date.now();
  let sawOverlay = -1, shotDone = false;
  while (Date.now() - tDrop < 3000) {
    const tx = await frameTexts(r20.A);
    if (tx.includes('乙 连接中断')) { sawOverlay = Date.now() - tDrop; if (!shotDone) { await shot(r20.A, '06-disconnect.png'); shotDone = true; } break; }
  }
  const frozen1 = await srv.api(`/__test/room/${r20.code}/state`); await sleep(400); const frozen2 = await srv.api(`/__test/room/${r20.code}/state`);
  let back = -1;
  while (Date.now() - tDrop < 6000) { const rr = await srv.api('/__test/rooms'); const me = rr.find(x => x.code === r20.code); if (me && me.seats[1].online) { back = Date.now() - tDrop; break; } await sleep(50); }
  const bConn = await G(r20.B, () => __game.net.stats().connected);
  let resumedAfter = -1; const tBack = Date.now();
  while (Date.now() - tBack < 6000) { const s = await srv.api(`/__test/room/${r20.code}/state`); if (!s.paused) { resumedAfter = Date.now() - tBack; break; } await sleep(50); }
  const evs = (await srv.api(`/__test/room/${r20.code}/state`)).events;
  const kOff = (evs.find(e => e.ev === 'pause:offline') || {}).k, kRes = (evs.filter(e => e.ev === 'resumed').pop() || {}).k;
  // ---- O-21 (in parallel)
  await sleep(1500);
  stopB21 = true; await games[3];
  await r21.B.reload(); await r21.B.waitForFunction(() => window.__game);
  await wait(r21.B, () => __game.net.stats().connected && __game.net.stats().ui === 'game' && __game.net.stats().bufferLen > 2, null, 8000);
  const you21 = await G(r21.B, () => __game.net.stats().you);
  await r21.B.evaluate(ONLINE_BOT);
  await r21.A.keyboard.press('KeyP');                                          // freeze the game to compare complete states
  await wait(r21.B, () => !!__game.net.stats().pause, null, 5000); await sleep(600);
  const mirror = await G(r21.B, () => __game.net.mirror());
  const st21 = await srv.api(`/__test/room/${r21.code}/state`);
  const equal = JSON.stringify(mirror) === JSON.stringify(st21.state);
  await r21.A.keyboard.press('Space');                                         // "继续"
  games[3] = drive(r21.B);
  await Promise.all(games);
  for (const r of [r20, r21]) { await wait(r.A, () => __game.G.screen === 'final', null, 20000).catch(() => {}); await wait(r.B, () => __game.G.screen === 'final', null, 20000).catch(() => {}); }
  await sleep(600);
  const f20 = await finalsAgree([r20.A, r20.B], srv, r20.code), f21 = await finalsAgree([r21.A, r21.B], srv, r21.code);
  const e20 = r20.A.errors.length + r20.B.errors.length, e21 = r21.A.errors.length + r21.B.errors.length;
  const timeDiff = Math.abs(drop.time - frozen1.state.time);
  report('O-20', sawOverlay >= 0 && sawOverlay <= 1000 && frozen1.state.time === frozen2.state.time && timeDiff <= 1 / 60 + 1e-9 && back >= 0 && back <= 3000 && bConn && kRes - kOff >= 180 && f20.same && e20 === 0,
    `B's TCP destroyed at G.time ${drop.time.toFixed(3)} (k ${drop.k}); server frozen at ${frozen1.state.time.toFixed(3)} (diff ${(timeDiff * 60).toFixed(2)} ticks), unchanged 400 ms later=${frozen1.state.time === frozen2.state.time}; A shows "乙 连接中断" after ${sawOverlay} ms; B back on its seat after ${back} ms; game running again ${resumedAfter} ms later (offline at k ${kOff}, resumed at k ${kRes}: ${kRes - kOff} ticks incl. 180-tick countdown); played to the end: ${f20.same ? 'identical' : 'DIFFERENT'} finals (${scoreStr(f20.server)}); errors ${e20}`);
  report('O-21', you21 === 1 && equal && f21.same && e21 === 0,
    `B reloaded mid-game: back as player ${you21 + 1}; with the game paused B's snapshot == server state: ${equal}; played to the end: ${f21.same ? 'identical' : 'DIFFERENT'} finals (${scoreStr(f21.server)}); errors ${e21}`);
  await closeAll(r20.A, r20.B, r21.A, r21.B);
}

// ---------------------------------------------------------------------------------------------------------------
//  O-22 half-open connection (black-holed by a TCP proxy)
// ---------------------------------------------------------------------------------------------------------------
async function o22(browser, srv) {
  const port = Number(new URL(srv.base).port);
  const proxy = await startProxy({ target: port });
  const { A, B, code } = await realPair(browser, srv, { seed: 31, qB: `?server=${encodeURIComponent(`ws://127.0.0.1:${proxy.port}/online/ws`)}` });
  try {
    await realSelect(A, B);
    await wait(A, () => __game.G.screen === 'play', null, 8000); await sleep(1000);
    proxy.set({ blackhole: true });
    const t0 = Date.now(); let detected = -1;
    while (Date.now() - t0 < 12000) { const r = (await srv.api('/__test/rooms')).find(x => x.code === code); if (r && !r.seats[1].online) { detected = Date.now() - t0; break; } await sleep(25); }
    const st = await srv.api(`/__test/room/${code}/state`);
    proxy.set({ blackhole: false });
    report('O-22', detected > 0 && detected <= 8500 && st.paused && st.pause.reason === 'offline',
      `B's traffic black-holed by online/test/netem-proxy.js (connection left open): server marked B offline after ${(detected / 1000).toFixed(2)} s (limit 8.5 s) and froze the game (pause ${st.pause && st.pause.reason})`);
  } finally { await closeAll(A, B); await proxy.close(); }
}

// ---------------------------------------------------------------------------------------------------------------
//  O-23 never comes back: "结束对局" after 2 s, "对方已离开" after 5 s (SEAT_TIMEOUT=5s, END_OFFER_AFTER=2s)
// ---------------------------------------------------------------------------------------------------------------
async function o23(browser) {
  const srv = await startSrv({ seatTimeout: 5000, endOfferAfter: 2000 });
  try {
    const { A, B, code } = await realPair(browser, srv, { seed: 41 });
    await realSelect(A, B);
    await wait(A, () => __game.G.screen === 'play', null, 8000); await sleep(800);
    await B.ctx.close();
    const t0 = Date.now(); let offer = -1, left = -1, gone = -1;
    while (Date.now() - t0 < 9000) {
      const now = Date.now() - t0;
      if (offer < 0 && await G(A, () => __game.uiButtons().some(b => b.id === 'net-endgame'))) { offer = now; await shot(A, '07-end-game-offer.png'); }
      if (left < 0 && await G(A, () => { const e = document.getElementById('net-msgtext'); return !!(e && e.offsetParent && /对方已离开/.test(e.textContent)); })) left = now;
      if (gone < 0 && !(await srv.api('/__test/rooms')).some(r => r.code === code)) gone = now;
      if (offer >= 0 && left >= 0 && gone >= 0) break;
      await sleep(40);
    }
    report('O-23', offer >= 1900 && offer <= 2600 && left >= 4900 && left <= 5700 && gone >= 4900 && gone <= 5700 && A.errors.length === 0,
      `B closed for good: A sees the "结束对局" button after ${(offer / 1000).toFixed(2)} s, "对方已离开" after ${(left / 1000).toFixed(2)} s; room gone from /__test/rooms after ${(gone / 1000).toFixed(2)} s; errors ${A.errors.length}`);
    await closeAll(A);
  } finally { await srv.close(); }
}

// ---------------------------------------------------------------------------------------------------------------
//  O-24 pause / resume countdown / hidden tab
// ---------------------------------------------------------------------------------------------------------------
async function o24(browser, srv) {
  const { A, B, code } = await realPair(browser, srv, { seed: 51 });
  try {
    await realSelect(A, B);
    await wait(A, () => __game.G.screen === 'play', null, 8000); await sleep(1000);
    await A.keyboard.press('KeyP');
    await wait(A, () => __game.G.paused === true, null, 3000); await wait(B, () => __game.G.paused === true, null, 3000);
    await sleep(200);
    const tA = await frameTexts(A), tB = await frameTexts(B);
    const pausedText = tA.includes('甲 暂停了游戏') && tB.includes('甲 暂停了游戏');
    await shot(B, '11-pause.png');
    const s1 = await srv.api(`/__test/room/${code}/state`); await sleep(1000); const s2 = await srv.api(`/__test/room/${code}/state`);
    await B.keyboard.press('Space');                                         // "继续" (first item)
    const tPress = Date.now(); const seen = new Set(); let resumedB = -1, resumedA = -1, shotCd = false;
    while (Date.now() - tPress < 6000) {
      const [ta, tb] = await Promise.all([frameTexts(A), frameTexts(B)]);
      for (const t of ['3', '2', '1']) { if (ta.includes(t) && tb.includes(t)) seen.add(t); }
      if (!shotCd && seen.has('2')) { shotCd = true; await shot(A, '12-countdown.png'); }
      if (resumedB < 0 && !(await G(B, () => __game.G.paused))) resumedB = Date.now() - tPress;
      if (resumedA < 0 && !(await G(A, () => __game.G.paused))) resumedA = Date.now() - tPress;
      if (resumedA >= 0 && resumedB >= 0) break;
    }
    const ev = (await srv.api(`/__test/room/${code}/state`)).events;
    const kIn = (ev.filter(e => e.ev === 'in:resume:1').pop() || {}).k, kRes = (ev.filter(e => e.ev === 'resumed').pop() || {}).k;
    // hidden tab
    await sleep(1000);
    await A.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(500);
    const ev2 = (await srv.api(`/__test/room/${code}/state`)).events;
    const kAway = (ev2.find(e => e.ev === 'in:away:0') || {}).k, kPz = (ev2.find(e => e.ev === 'pause:away') || {}).k;
    const ok = pausedText && s1.state.time === s2.state.time && ['3', '2', '1'].every(t => seen.has(t)) && Math.abs(resumedB - 3000) <= 200 + 150 && Math.abs(kRes - kIn - 180) <= 1 && kPz - kAway <= 1 && A.errors.length + B.errors.length === 0;
    report('O-24', ok,
      `A pressed P: G.paused on A and B, both draw "甲 暂停了游戏"=${pausedText}; server G.time unchanged over 1 s (${s1.state.time.toFixed(3)} = ${s2.state.time.toFixed(3)}); B chose 继续: countdown ${[...seen].join('-')} shown on both pages, server resumed ${(kRes - kIn)} ticks (= ${((kRes - kIn) / 60).toFixed(2)} s) after the request, pages unpaused ${(resumedA / 1000).toFixed(2)} s (A) / ${(resumedB / 1000).toFixed(2)} s (B) after the key press (incl. interpolation delay ~0.1 s); hidden tab: "away" arrived at k ${kAway}, paused at k ${kPz} (${kPz - kAway} tick)`);
  } finally { await closeAll(A, B); }
}

// ---------------------------------------------------------------------------------------------------------------
//  O-25 version mismatch
// ---------------------------------------------------------------------------------------------------------------
async function o25(browser, srv) {
  const { A, B, code } = await realPair(browser, srv, { noWait: true, initB: "window.__GM_BUILD_OVERRIDE = '0123456789abcdef';" });
  try {
    await B.waitForFunction(() => { const e = document.getElementById('net-msgtext'); return e && e.offsetParent && e.textContent.includes('游戏已更新'); }, null, { timeout: 5000 });
    const r = await G(B, () => ({ text: document.getElementById('net-msgtext').textContent, btn: (b => b.offsetParent ? b.textContent : null)(document.getElementById('net-refresh')) }));
    await shot(B, '13-version.png');
    const info = (await srv.api('/__test/rooms')).find(x => x.code === code);
    report('O-25', r.text === '游戏已更新,请刷新页面' && r.btn === '刷新' && info && info.seats[1] === null && B.errors.length === 0,
      `B with __GM_BUILD_OVERRIDE: shows "${r.text}" and a "${r.btn}" button; the room's second seat is still ${JSON.stringify(info && info.seats[1])} (seats unchanged); errors ${B.errors.length}`);
  } finally { await closeAll(A, B); }
}

// ---------------------------------------------------------------------------------------------------------------
//  O-26 strangers: room full / not found / rate limited (default limits), forged seat, foreign Origin, no token in URLs
// ---------------------------------------------------------------------------------------------------------------
async function o26(browser, tokenCheck) {
  const srv = await startSrv({ limits: {} });                                  // the real per-IP limits
  try {
    const { A, B, code } = await realPair(browser, srv, { seed: 61 });
    const C = await onlinePage(browser, srv.base + '/index.html#room=' + code);
    await C.waitForSelector('#net-name', { state: 'visible' }); await C.keyboard.type('丙'); await C.click('#net-join');
    await C.waitForFunction(() => /房间已满|房间不存在|操作太频繁/.test(document.getElementById('net-err').textContent), null, { timeout: 5000 });
    const full = await C.textContent('#net-err');
    const tries = [];
    for (let i = 0; i < 11; i++) {
      await C.fill('#net-code', 'ZZZZZ' + '23456789ABC'[i]);
      await C.evaluate(() => { document.getElementById('net-err').textContent = ''; });
      await C.click('#net-join');
      await C.waitForFunction(() => /房间不存在|操作太频繁/.test(document.getElementById('net-err').textContent), null, { timeout: 5000 });
      tries.push(await C.textContent('#net-err'));
    }
    // forged seat token, foreign Origin
    const ws = await new Promise(res => { const w = new WebSocket(srv.base.replace('http', 'ws') + '/online/ws', { headers: { Origin: srv.base } }); w.on('open', () => res(w)); });
    const forged = await new Promise(res => { ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'error') res(m.code); }); ws.send(JSON.stringify({ t: 'resume', proto: 1, build: srv.build, room: code, seat: 'x'.repeat(43) })); });
    ws.close();
    const evil = await new Promise(res => { const w = new WebSocket(srv.base.replace('http', 'ws') + '/online/ws', { headers: { Origin: 'https://evil.example' } }); w.on('unexpected-response', (q, r) => res(r.statusCode)); w.on('open', () => res('open')); w.on('error', () => {}); });
    const leak = tokenCheck ? tokenCheck.leak : [];
    const ok = full === '房间已满' && tries.slice(0, 10).every(t => t === '房间不存在') && /^操作太频繁/.test(tries[10]) && forged === 'bad_seat' && evil === 403 && tokenCheck && leak.length === 0 && C.errors.length === 0;
    report('O-26', ok, `third context with the right code -> "${full}"; wrong codes 1-10 -> "${tries[0]}", 11th within a minute -> "${tries[10]}"; forged seat token resume -> ${forged}; upgrade with Origin https://evil.example -> HTTP ${evil}; seat tokens (${tokenCheck ? tokenCheck.tokens.length : 0}) found in ${ALL_URLS.length} request / ${WS_URLS.length} WebSocket URLs: ${leak.length}`);
    await closeAll(A, B, C);
  } finally { await srv.close(); }
}

// ---------------------------------------------------------------------------------------------------------------
//  O-27 touch devices: grey "联机对战" button -> hint only; invitation link -> "use a computer" sheet; never a socket
// ---------------------------------------------------------------------------------------------------------------
async function o27(browser, srv) {
  const out = []; let allOk = true;
  for (const [name, safe] of [['iPhone 13 landscape', '47,0,47,21'], ['Pixel 7 landscape', '47,0,47,21']]) {
    const dev = L.devices[name];
    const page = await onlinePage(browser, `${srv.base}/index.html?safe=${safe}`, { ctx: Object.assign({}, dev) });
    await sleep(400);
    const r = await G(page, () => { const c = document.getElementById('c').getBoundingClientRect(); return { cw: c.width, l: c.left, t: c.top, b: __game.uiButtons().find(x => x.id === 'btn-online'), vw: innerWidth, vh: innerHeight, touch: __game.G.touchUI }; });
    const [sl, st, sr, sb] = safe.split(',').map(Number), s = r.cw / 1280;
    const bx0 = r.l + r.b.x * s, by0 = r.t + r.b.y * s, bw = r.b.w * s, bh = r.b.h * s;
    const inside = bx0 >= sl - 1 && by0 >= st - 1 && bx0 + bw <= r.vw - sr + 1 && by0 + bh <= r.vh - sb + 1;
    if (name.startsWith('iPhone')) await shot(page, '20-touch-menu.png');
    await page.touchscreen.tap(bx0 + bw / 2, by0 + bh / 2);
    const tTap = Date.now();
    const first = await frameTexts(page);
    const shown = first.includes('联机对战需在电脑上进行');
    if (name.startsWith('iPhone')) await shot(page, '21-touch-hint.png');
    let goneAt = -1;
    while (Date.now() - tTap < 4000) { const tx = await G(page, () => new Promise(res => { window.__texts = []; window.__cap = true; requestAnimationFrame(() => { window.__cap = false; res(window.__texts); }); })); if (!tx.includes('联机对战需在电脑上进行')) { goneAt = Date.now() - tTap; break; } }
    const screen1 = await G(page, () => __game.G.screen);
    // invitation link on the phone
    await page.goto(`${srv.base}/index.html?safe=${safe}#room=K7M2QX`); await page.waitForFunction(() => window.__game); await sleep(400);
    const sheet = await G(page, () => { const e = document.getElementById('net-touch'); return e ? { vis: getComputedStyle(e).display !== 'none', text: e.textContent } : null; });
    const link = `${srv.base}/index.html?safe=${safe}#room=K7M2QX`;
    if (name.startsWith('iPhone')) await shot(page, '22-touch-invite.png');
    const sb_ = await page.$('#net-tsolo'); const bb = await sb_.boundingBox();
    await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(300);
    const after = await G(page, () => ({ vis: getComputedStyle(document.getElementById('net-touch')).display !== 'none', screen: __game.G.screen }));
    const ok = r.touch && bw >= 44 && bh >= 44 && inside && shown && Math.abs(goneAt - 2500) <= 200 + 60 && screen1 === 'start' && sheet && sheet.vis && sheet.text.includes('联机对战需在电脑上进行') && sheet.text.includes(link) && !after.vis && after.screen === 'start' && page.ws === 0 && page.errors.length === 0;
    allOk = allOk && ok;
    out.push(`${name}: button ${bw.toFixed(1)}x${bh.toFixed(1)} CSS px inside the safe area=${inside}; tap -> hint in the next frame=${shown}, gone after ${(goneAt / 1000).toFixed(2)} s, screen ${screen1}; #room link -> sheet visible=${sheet && sheet.vis} with title and full link=${!!(sheet && sheet.text.includes(link))}; "玩单人模式" -> sheet hidden=${!after.vis}, screen ${after.screen}; WebSockets ${page.ws}; errors ${page.errors.length}`);
    await closeAll(page);
  }
  report('O-27', allOk, out.join(' | ') + ' | (touch suite: see the "touch" group of run-all)');
}

// ---------------------------------------------------------------------------------------------------------------
//  O-50 extra desktop screenshots (lobby, waiting room); the rest are taken by the tests above
// ---------------------------------------------------------------------------------------------------------------
async function shotsLobby(browser, srv) {
  const A = await onlinePage(browser, srv.base + '/index.html');
  await A.keyboard.press('KeyO'); await A.waitForSelector('#net-name', { state: 'visible' }); await A.keyboard.type('甲'); await A.fill('#net-code', 'k7m2qx');
  await shot(A, '01-lobby.png');
  await A.click('#net-create'); await A.waitForFunction(() => document.getElementById('net-code-big').textContent.length === 6);
  await sleep(300); await shot(A, '02-waiting-room.png');
  const code = await A.textContent('#net-code-big'), typed = await A.inputValue('#net-code');
  await closeAll(A);
  return { code, typed };
}

async function run(browser) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await o02(browser);
  await o05(browser);
  const srv = await startSrv();
  try {
    await o07(browser, srv);
    const lob = await shotsLobby(browser, srv);
    const tok = await o10(browser, srv);
    await o16(browser, srv);
    await o20o21(browser, srv);
    await o22(browser, srv);
    await o24(browser, srv);
    await o25(browser, srv);
    await o27(browser, srv);
    await o23(browser);
    await o26(browser, tok);
    await o12(browser);
    report('O-50', fs.readdirSync(SHOTS).filter(f => /^(0|1)\d-/.test(f)).length >= 13 && lob.typed === 'K7M2QX',
      `desktop screenshots in screenshots/online/: ${fs.readdirSync(SHOTS).filter(f => /^(0|1)\d-/.test(f)).sort().join(', ')} (room-code field turned "k7m2qx" into "${lob.typed}"); checked by eye, see review report`);
    report('O-51', ['20-touch-menu.png', '21-touch-hint.png', '22-touch-invite.png'].every(f => fs.existsSync(path.join(SHOTS, f))), 'iPhone 13 landscape screenshots: 20-touch-menu.png, 21-touch-hint.png, 22-touch-invite.png (checked by eye)');
  } finally { await srv.close(); }
}

module.exports = { run, startSrv, onlinePage, realPair, realSelect, drive, ONLINE_BOT, finalsAgree, scoreStr, closeAll, TEXT_SPY, frameTexts, shot, sleep, G, wait, median, pct, SHOTS, ALL_URLS, WS_URLS,
  o02, o05, o07, o10, o12, o16, o20o21, o22, o23, o24, o25, o26, o27, shotsLobby };
