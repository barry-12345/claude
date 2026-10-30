// Phase 2.5 (touch / mobile) acceptance tests: T-01 .. T-15 (+ a few extras).  Real touch input only: page.touchscreen.tap and CDP Input.dispatchTouchEvent.
const L = require('./lib');
const fs = require('fs'), path = require('path');
const { report } = L;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const G = (page, fn, arg) => page.evaluate(fn, arg);
const wait = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 30 });
const SHOTS_T = path.join(L.SHOTS, 'touch');

// the spec's phone sizes (logical px, landscape) and their safe-area insets
const PHONES = [
  { name: 'iPhone SE', dev: 'iPhone SE landscape', w: 667, h: 375, safe: '0,0,0,0' },
  { name: 'iPhone 13', dev: 'iPhone 13 landscape', w: 844, h: 390, safe: '47,0,47,0' },
  { name: 'iPhone 14 Pro Max', dev: 'iPhone 14 Pro Max landscape', w: 932, h: 430, safe: '59,0,59,0' },
];
const TEXT_SPY = `(() => { window.__texts = []; const ft = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, x, y) { if (window.__cap) window.__texts.push({ t: String(t), font: this.font, x, y }); return ft.apply(this, arguments); }; })()`;

// a page in a mobile-emulation context (hasTouch + isMobile come from the device descriptor)
async function tPage(browser, { dev = 'iPhone 13 landscape', vp, query = '', init, base = L.URL } = {}) {
  const d = Object.assign({}, L.devices[dev] || L.devices['iPhone 13 landscape']);
  if (vp) d.viewport = vp;
  const ctx = await browser.newContext(d);
  const page = await ctx.newPage();
  page.errors = []; page.ctx = ctx;
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push('console.error: ' + m.text()); });
  if (init) await page.addInitScript(init);
  await page.goto(base + (query ? (base.includes('?') ? '&' : '?') + query : ''));
  await page.waitForFunction(() => window.__game);
  return page;
}
const toScreen = (page, gx, gy) => page.evaluate(([gx, gy]) => { const r = document.getElementById('c').getBoundingClientRect(); return [r.left + gx / 1280 * r.width, r.top + gy / 720 * r.height]; }, [gx, gy]);
async function tapG(page, gx, gy) { const [x, y] = await toScreen(page, gx, gy); await page.touchscreen.tap(x, y); }
const btnOf = async (page, id) => (await page.evaluate(() => __game.uiButtons())).find(b => b.id === id);
async function tapId(page, id, o = {}) {
  let b = null;
  for (let i = 0; i < 30 && !b; i++) { b = await btnOf(page, id); if (!b) await sleep(40); }     // the list is rebuilt by the next rendered frame
  if (!b) throw new Error(`no button "${id}" on screen ${await page.evaluate(() => __game.G.screen)}; have ${(await page.evaluate(() => __game.uiButtons())).map(x => x.id)}`);
  if (!o.now) await page.waitForFunction(() => performance.now() >= __game.G.tapGuardUntil, null, { timeout: 3000 });   // the post-screen-change tap guard (0.65 s) must have expired
  await tapG(page, b.x + b.w / 2, b.y + b.h / 2);
}
async function texts(page) {   // text drawn by exactly one render() pass
  return G(page, () => new Promise(res => { window.__texts = []; window.__cap = true; requestAnimationFrame(() => { window.__cap = false; res(window.__texts); }); }));
}
const px = f => parseFloat(/(\d+(\.\d+)?)px/.exec(f)[1]);

// ---------- T-01 device detection ----------
async function t01(browser) {
  const r = {};
  for (const dev of ['iPhone 13 landscape', 'Pixel 7 landscape']) { const p = await tPage(browser, { dev }); r[dev] = await G(p, () => __game.G.touchUI); await p.ctx.close(); }
  const desk = await L.newPage(browser, L.URL); r.desktop = await G(desk, () => __game.G.touchUI); await desk.context().close();
  // touch laptop: touch screen present (maxTouchPoints > 0) but the primary pointer is a trackpad (any-pointer: fine). Chromium cannot emulate both, so the media query is stubbed.
  const tl = await browser.newContext({ viewport: { width: 1280, height: 720 } }); const tlp = await tl.newPage();
  await tlp.addInitScript(`Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 10 }); const mm = window.matchMedia.bind(window); window.matchMedia = q => /any-pointer: *fine/.test(q) ? { matches: true, media: q, addListener() {}, removeListener() {} } : /pointer: *coarse/.test(q) ? { matches: false, media: q, addListener() {}, removeListener() {} } : mm(q);`);
  await tlp.goto(L.URL); await tlp.waitForFunction(() => window.__game);
  r.touchLaptop = await G(tlp, () => ({ ui: __game.G.touchUI, pts: navigator.maxTouchPoints, fine: matchMedia('(any-pointer: fine)').matches })); await tl.close();
  const f0 = await tPage(browser, { query: 'touch=0' }); r.force0 = await G(f0, () => __game.G.touchUI); await f0.ctx.close();
  const f1 = await L.newPage(browser, L.URL + '?touch=1'); r.force1 = await G(f1, () => __game.G.touchUI); await f1.context().close();
  const sw = await tPage(browser); const swBefore = await G(sw, () => __game.G.touchUI); await G(sw, () => __game.setTouchUI(false)); const swAfter = await G(sw, () => __game.G.touchUI); await G(sw, () => { __game.startMode('solo', [0]); __game.setTouchUI(true); }); const swMid = await G(sw, () => __game.G.touchUI); await sw.ctx.close();
  report('T-01', r['iPhone 13 landscape'] === true && r['Pixel 7 landscape'] === true && r.desktop === false && r.touchLaptop.ui === false && r.touchLaptop.pts > 0 && r.touchLaptop.fine && r.force0 === false && r.force1 === true && swBefore && !swAfter && swMid === false,
    `iPhone 13 touchUI=${r['iPhone 13 landscape']}, Pixel 7 touchUI=${r['Pixel 7 landscape']}, desktop=${r.desktop}, touch laptop (maxTouchPoints=${r.touchLaptop.pts}, any-pointer:fine stubbed ${r.touchLaptop.fine}) touchUI=${r.touchLaptop.ui}; ?touch=0 on a phone -> ${r.force0}; ?touch=1 on desktop -> ${r.force1}; setTouchUI works on the start screen (${swBefore}->${swAfter}) and is ignored mid-game (stays ${swMid})`);
}

// ---------- T-02 whole game by touch only ----------
async function playByTouch(browser, dev, boost) {
  const page = await tPage(browser, { dev, query: 'fast=1&seed=3' });
  await sleep(300);
  await tapId(page, 'mode-solo'); await wait(page, () => __game.G.screen === 'select', null, 3000);
  await tapId(page, 'char-2'); await sleep(120); await tapId(page, 'char-2');            // select, then tap again to confirm
  await wait(page, () => __game.G.screen === 'intro' || __game.G.screen === 'play', null, 4000);
  const first = await G(page, () => ({ mode: __game.G.mode, ch: __game.G.players[0].char, n: __game.G.players.length }));
  const t0 = Date.now(); let modes = new Set(), results = 0, shops = 0, taps = 0;
  while (Date.now() - t0 < 200000) {
    const st = await G(page, ({ boost }) => { const G = __game.G; if (boost && G.screen === 'play' && (boost === true || G.round === 1)) { const p = G.players[0]; p.money = Math.max(p.money, __game.targets()[G.round - 1] + 50); } return { sc: G.screen, mode: G.mode }; }, { boost });
    modes.add(st.mode);
    if (st.sc === 'final') break;
    if (st.sc === 'play') { await tapG(page, 400 + (taps % 5) * 100, 420); taps++; }
    else if (st.sc === 'intro') await tapG(page, 640, 400);                               // tap = skip
    else if (st.sc === 'results') { await sleep(500); await tapId(page, 'btn-continue').catch(() => {}); results++; }
    else if (st.sc === 'shop') { await sleep(350); const s = await G(page, () => __game.G.shop[0].rerollIdx + 1); await tapId(page, 'shop-card-' + s); await sleep(300); await tapId(page, 'shop-card-' + s).catch(() => {}); shops++; }   // "ready" twice
    await sleep(600);
  }
  const fin = await G(page, () => ({ screen: __game.G.screen, round: __game.G.round, rec: localStorage.getItem('goldminer.soloBest'), victory: __game.G.final && __game.G.final.victory }));
  let rec = null; try { rec = JSON.parse(fin.rec); } catch (e) {}
  const ok = first.mode === 'solo' && first.ch === 2 && first.n === 1 && fin.screen === 'final' && modes.size === 1 && modes.has('solo') && page.errors.length === 0 && rec && ['cleared', 'stars', 'money', 'char', 'perRound'].every(k => k in rec);
  const msg = `${dev.split(' landscape')[0]}${boost ? ' (+top-up)' : ''}: final=${fin.screen === 'final'} round ${fin.round}${fin.victory ? ' victory' : ''}, ${results} result taps, ${shops} shop visits (ready tapped twice), ${taps} field taps, G.mode always ${[...modes]}, soloBest written=${!!rec}, errors=${page.errors.length}, ${((Date.now() - t0) / 1000).toFixed(0)}s`;
  await page.ctx.close();
  return { ok, msg };
}
async function t02(browser) {
  const rs = await Promise.all([playByTouch(browser, 'iPhone 13 landscape', false), playByTouch(browser, 'Pixel 7 landscape', false), playByTouch(browser, 'iPhone 13 landscape', true), playByTouch(browser, 'Pixel 7 landscape', true)]);
  report('T-02', rs.every(r => r.ok), rs.map(r => r.msg).join(' | '));
}

// ---------- T-03 / T-04 versus and co-op are gone ----------
async function t03_04(browser) {
  const page = await tPage(browser, { init: `localStorage.setItem('goldminer.mode', 'versus')`, query: 'seed=1' });
  await page.addInitScript(TEXT_SPY).catch(() => {});
  await sleep(300);
  const ids = (await page.evaluate(() => __game.uiButtons())).map(b => b.id);
  const modeIds = ids.filter(i => i.startsWith('mode-'));
  await page.evaluate(TEXT_SPY);
  const tx = await texts(page);
  const bad = tx.filter(q => /对战|合作|VS/.test(q.t)).map(q => q.t);
  const before = await G(page, () => ({ s: __game.G.screen, m: __game.G.mode, mm: __game.G.menuMode }));
  for (const [gx, gy] of [[639, 124], [1045, 124]]) { await tapG(page, gx, gy); await sleep(150); }   // where the desktop versus / co-op cards are
  const after = await G(page, () => ({ s: __game.G.screen, m: __game.G.mode, mm: __game.G.menuMode, ls: localStorage.getItem('goldminer.mode') }));
  const ok3 = modeIds.length === 1 && modeIds[0] === 'mode-solo' && !bad.length && after.s === 'start' && after.m === before.m && after.mm === 0 && after.ls === 'versus';
  await page.reload(); await page.waitForFunction(() => window.__game);
  const reloaded = await G(page, () => ({ mm: __game.G.menuMode, ls: localStorage.getItem('goldminer.mode'), ids: __game.uiButtons().filter(b => b.id.startsWith('mode-')).map(b => b.id) }));
  await tapId(page, 'mode-solo'); await sleep(200);
  const startedSolo = await G(page, () => ({ s: __game.G.screen, m: __game.G.mode, ls: localStorage.getItem('goldminer.mode') }));
  report('T-03', ok3 && reloaded.ls === 'versus' && reloaded.mm === 0 && reloaded.ids.length === 1 && startedSolo.m === 'solo' && startedSolo.ls === 'versus',
    `stored mode "versus": touch menu mode cards=[${modeIds}], "对战/合作/VS" text drawn=${bad.length}x; taps on the desktop versus/co-op card spots -> screen ${after.s}, G.mode ${after.m}; after reload only ${reloaded.ids}, localStorage.goldminer.mode still "${reloaded.ls}" even after entering solo ("${startedSolo.ls}")`);
  await page.ctx.close();

  // T-04 keyboard on a touch device
  const p2 = await tPage(browser, { query: 'seed=1' });
  await p2.evaluate(TEXT_SPY);
  const log = [];
  for (const k of ['Digit2', 'Digit3', 'ArrowRight', 'KeyD', 'Numpad2', 'Numpad3']) { await p2.keyboard.press(k); log.push(await G(p2, () => [__game.G.menuMode, __game.G.mode, __game.G.screen].join('/'))); }
  const t4 = await texts(p2);
  await p2.keyboard.press('Space'); await sleep(200);
  const sel = await G(p2, () => ({ s: __game.G.screen, m: __game.G.mode }));
  await p2.keyboard.press('ArrowRight'); await p2.keyboard.press('KeyS'); await wait(p2, () => __game.G.screen === 'intro', null, 3000);
  const run = await G(p2, () => ({ n: __game.G.players.length, m: __game.G.mode }));
  report('T-04', log.every(l => l.startsWith('0/') && l.endsWith('/start')) && !t4.some(q => /对战|合作/.test(q.t)) && sel.s === 'select' && sel.m === 'solo' && run.n === 1 && run.m === 'solo' && p2.errors.length === 0,
    `iPhone 13 + keyboard: Digit2, Digit3, ArrowRight, KeyD, Numpad2, Numpad3 leave menuMode/mode/screen at [${[...new Set(log)]}]; Space -> ${sel.s}, G.mode=${sel.m}; keyboard-started game has ${run.n} player (${run.m}); versus/co-op text drawn=${t4.some(q => /对战|合作/.test(q.t))}`);
  await p2.ctx.close();
}

// ---------- T-05 larger text, 3 viewports ----------
async function t05(browser) {
  const rows = [];
  for (const ph of PHONES) {
    const page = await tPage(browser, { dev: ph.dev, vp: { width: ph.w, height: ph.h }, query: 'seed=3&touch=1' });
    const res = {};
    const shotState = async name => { await sleep(1100); res[name] = await G(page, () => ({ f: __game.G.minFont, h: __game.G.hudFont, sc: __game.G.screen })); };
    await G(page, () => { const g = __game, G = g.G; g.reseed(3); g.startMode('solo', [0]); G.forceEvent = 'none'; g.advance(3); });
    await shotState('play');
    await G(page, () => { const g = __game, G = g.G, p = G.players[0]; p.money = 3000; p.roundGain = 3000; g.endRound(); });
    await shotState('results');
    await G(page, () => { __game.afterResults(); });
    await shotState('shop');
    await G(page, () => { const g = __game, G = g.G; G.round = 3; G.players[0].money = 3000; g.finishGame(); });
    await shotState('final');
    rows.push({ ph, res, err: page.errors.length });
    await page.ctx.close();
  }
  // desktop (touchUI=false): same font sizes as the accepted phase-2 build
  const desk = async (url, query) => {
    const page = await L.newPage(browser, url + (query ? '?' + query : ''));
    await page.evaluate(TEXT_SPY);
    const out = {};
    const grab = async name => { await sleep(300); const tx = await texts(page); out[name] = [...new Set(tx.map(q => px(q.font)))].sort((a, b) => a - b); };
    await G(page, () => { const g = __game, G = g.G; g.reseed(3); g.startMode('solo', [0]); G.forceEvent = 'none'; g.advance(4); });
    await grab('play');
    await G(page, () => { const g = __game, G = g.G, p = G.players[0]; p.money = 3000; p.roundGain = 3000; g.endRound(); });
    await grab('results');
    await G(page, () => { __game.afterResults(); }); await grab('shop');
    await G(page, () => { const g = __game, G = g.G; G.round = 3; g.finishGame(); }); await grab('final');
    out.minFont = await G(page, () => __game.G.minFont);
    await page.context().close(); return out;
  };
  const dNew = await desk(L.URL, 'touch=0'), dOld = await desk(L.BASELINE2);
  const sameDesk = ['play', 'results', 'shop', 'final'].every(k => JSON.stringify(dNew[k]) === JSON.stringify(dOld[k]));
  const okTouch = rows.every(r => ['play', 'results', 'shop', 'final'].every(k => r.res[k].f >= 20) && r.res.play.h.money >= 30 && r.res.play.h.target >= 30 && r.res.play.h.timer >= 30 && r.err === 0);
  report('T-05', okTouch && sameDesk,
    rows.map(r => `${r.ph.w}x${r.ph.h}: G.minFont play/results/shop/final = ${['play', 'results', 'shop', 'final'].map(k => r.res[k].f).join('/')}, HUD coins/target/timer font ${r.res.play.h.money}/${r.res.play.h.target}/${r.res.play.h.timer}`).join(' | ') +
    ` || desktop (touchUI=false) drawn font-size sets identical to baseline-phase2 on play/results/shop/final: ${sameDesk} (smallest sizes ${dNew.play[0]}/${dNew.results[0]}/${dNew.shop[0]}/${dNew.final[0]} vs ${dOld.play[0]}/${dOld.results[0]}/${dOld.shop[0]}/${dOld.final[0]}; new build G.minFont=${dNew.minFont})`);
}

// ---------- T-06 button sizes and safe area ----------
async function t06(browser) {
  const out = [];
  let allBig = true, allInside = true, nBtn = 0;
  for (const ph of PHONES) {
    for (const safe of [null, ph.safe]) {
      const page = await tPage(browser, { dev: ph.dev, vp: { width: ph.w, height: ph.h }, query: 'seed=3&touch=1' + (safe ? '&safe=' + safe : '') });
      const [sl, st, sr, sb] = (safe || '0,0,0,0').split(',').map(Number);
      const seen = [];
      const collect = async () => {
        await sleep(250);
        const r = await G(page, () => { const c = document.getElementById('c').getBoundingClientRect(); return { cw: c.width, l: c.left, t: c.top, r: c.right, b: c.bottom, btns: __game.uiButtons(), vw: innerWidth, vh: innerHeight }; });
        const s = r.cw / 1280;
        for (const b of r.btns) {
          seen.push(b.id); nBtn++;
          if (!safe && (b.w * s < 44 || b.h * s < 44)) { allBig = false; out.push(`${ph.name} ${b.id} ${(b.w * s).toFixed(1)}x${(b.h * s).toFixed(1)}`); }
          const x0 = r.l + b.x * s, y0 = r.t + b.y * s, x1 = x0 + b.w * s, y1 = y0 + b.h * s;
          if (safe && (r.l < sl - 0.5 || r.r > r.vw - sr + 0.5 || r.t < st - 0.5 || r.b > r.vh - sb + 0.5)) allInside = false;
          if (safe && (x0 < sl - 1 || x1 > r.vw - sr + 1 || y0 < st - 1 || y1 > r.vh - sb + 1) && b.id !== 'pause-block' && !/^(shop-card|char)-/.test(b.id)) { allInside = false; out.push(`${ph.name} safe ${b.id} outside`); }
        }
      };
      await collect();                                                      // start screen
      await tapId(page, 'mode-solo'); await collect();                      // select
      await G(page, () => { const g = __game, G = g.G; g.reseed(3); g.startMode('solo', [0]); G.forceEvent = 'none'; g.advance(4); }); await collect();   // play
      await G(page, () => { __game.press('KeyP'); }); await collect(); await G(page, () => { __game.press('KeyP'); });                                       // pause
      await G(page, () => { const g = __game, G = g.G, p = G.players[0]; p.money = 3000; p.roundGain = 3000; g.endRound(); }); await collect();                  // results
      await G(page, () => { __game.afterResults(); }); await sleep(300); await collect();                                                                         // shop
      await G(page, () => { const g = __game, G = g.G; G.round = 3; g.finishGame(); }); await collect();                                                         // final
      if (safe) {
        const ins = await G(page, () => __game.safeInsets());
        if (ins.l !== sl || ins.r !== sr || ins.b !== sb) allInside = false;
      }
      await page.ctx.close();
    }
  }
  report('T-06', allBig && allInside, `${nBtn} registered buttons over start/select/play/pause/results/shop/final on 3 phone sizes: all >= 44 CSS px in both dimensions=${allBig}${allBig ? '' : ' (' + out.slice(0, 3) + ')'}; with ?safe=<l,t,r,b> (47/59 side insets, 21 bottom on iPhone 13) canvas and every button inside the safe area=${allInside}${allInside ? '' : ' (' + out.slice(0, 3) + ')'}`);
}

// ---------- T-07 tap -> fire, T-08 multi-touch bomb ----------
async function t07_08(browser) {
  const page = await tPage(browser, { query: 'seed=5', vp: { width: 844, height: 390 } });
  const start = async () => { await G(page, () => { const g = __game, G = g.G; g.reseed(5); g.startMode('solo', [0]); G.forceEvent = 'none'; g.advance(4); g.clearField(); const h = G.players[0].hook; h.state = 'swing'; h.len = __game.HOOK.minLen; h.item = null; G.players[0].dyn = 3; G.noFireT = 0; }); };
  await start();
  const before = await G(page, () => __game.G.players[0].hook.state);
  const [fx, fy] = await toScreen(page, 400, 450);
  await page.touchscreen.tap(fx, fy);
  const next = await G(page, () => new Promise(r => requestAnimationFrame(() => r(__game.G.players[0].hook.state))));
  // also a tap on a button area must not fire: the pause button
  await start(); const pb = await btnOf(page, 'btn-pause');
  await tapG(page, pb.x + pb.w / 2, pb.y + pb.h / 2); await sleep(100);
  const afterPauseTap = await G(page, () => ({ paused: __game.G.paused, st: __game.G.players[0].hook.state }));
  await G(page, () => { __game.press('KeyP'); });
  report('T-07', before === 'swing' && next === 'extend' && afterPauseTap.paused && afterPauseTap.st === 'swing', `tap on the field: hook ${before} -> "${next}" by the next animation frame; tapping the pause button pauses (${afterPauseTap.paused}) without firing (hook stays "${afterPauseTap.st}")`);

  // T-08: finger A rests on the field, finger B taps the bomb button while an item is being reeled in
  await start();
  await G(page, () => { const g = __game, G = g.G, p = G.players[0], it = g.makeItem('rock_b', 640, 420); G.items.push(it); it.grabbedBy = 0; p.hook.item = it; p.hook.state = 'retract'; p.hook.len = 330; p.hook.angle = 0; window.__it = it; });
  const bomb = await btnOf(page, 'btn-bomb'); await sleep(100);
  const usable = await G(page, () => __game.G.players[0].hook.state);
  const cdp = await page.context().newCDPSession(page);
  const [ax, ay] = await toScreen(page, 600, 450), [bx, by] = await toScreen(page, bomb.x + bomb.w / 2, bomb.y + bomb.h / 2);
  const dyn0 = await G(page, () => __game.G.players[0].dyn);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ax, y: ay, id: 1 }] });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ax, y: ay, id: 1 }, { x: bx, y: by, id: 2 }] });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: ax, y: ay, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(150);
  const r = await G(page, () => { const p = __game.G.players[0]; return { dyn: p.dyn, dead: window.__it.dead, st: p.hook.state, item: !!p.hook.item }; });
  await G(page, () => { const G = __game.G; if (G.players[0].hook.state === 'retract') { G.players[0].hook.len = 40; } });
  report('T-08', usable === 'retract' && r.dyn === dyn0 - 1 && r.dead && !r.item && r.st !== 'extend', `CDP multi-touch: finger A held on the field while finger B tapped the bomb button during a pull: dynamite ${dyn0} -> ${r.dyn}, item destroyed=${r.dead}, hook state "${r.st}" (finger A caused no extra launch)`);
  await page.ctx.close();
}

// ---------- T-09 portrait overlay ----------
async function t09(browser) {
  const p1 = await tPage(browser, { dev: 'iPhone 13', vp: { width: 390, height: 844 }, query: 'seed=1' });
  await sleep(300);
  const a = await G(p1, () => ({ p: __game.G.portrait, disp: getComputedStyle(document.getElementById('rot')).display, txt: document.getElementById('rot').innerText }));
  await p1.screenshot({ path: path.join((fs.mkdirSync(SHOTS_T, { recursive: true }), SHOTS_T), 'portrait-overlay.png') });
  await p1.ctx.close();
  const p2 = await tPage(browser, { vp: { width: 844, height: 390 }, query: 'seed=1' });
  await G(p2, () => { const g = __game; g.reseed(1); g.startMode('solo', [0]); g.advance(4); });
  const mid0 = await G(p2, () => ({ s: __game.G.screen, paused: __game.G.paused, p: __game.G.portrait }));
  await p2.setViewportSize({ width: 390, height: 844 }); await sleep(300);
  const portrait = await G(p2, () => ({ paused: __game.G.paused, p: __game.G.portrait, disp: getComputedStyle(document.getElementById('rot')).display }));
  await p2.setViewportSize({ width: 844, height: 390 }); await sleep(300);
  const back = await G(p2, () => ({ paused: __game.G.paused, p: __game.G.portrait, disp: getComputedStyle(document.getElementById('rot')).display, pauseSel: __game.G.pauseSel }));
  const tx = await (async () => { await p2.evaluate(TEXT_SPY); return texts(p2); })();
  await tapId(p2, 'pause-resume'); await sleep(150);
  const resumed = await G(p2, () => __game.G.paused);
  report('T-09', a.p && a.disp === 'flex' && /请横屏游玩/.test(a.txt) && mid0.s === 'play' && !mid0.paused && portrait.paused && portrait.p && portrait.disp === 'flex' && !back.p && back.disp === 'none' && back.paused && tx.some(q => q.t === '已暂停') && !resumed,
    `390x844: G.portrait=${a.p}, overlay display=${a.disp} "${a.txt.replace(/\n/g, ' ')}"; in play (${mid0.s}) rotating to portrait -> paused=${portrait.paused}; back to 844x390 -> overlay ${back.disp}, still paused=${back.paused} on the pause menu (drawn=${tx.some(q => q.t === '已暂停')}); tap "继续游戏" -> paused=${resumed}`);
  await p2.ctx.close();
}

// ---------- T-10 gesture blocking ----------
async function t10(browser) {
  const page = await tPage(browser, { vp: { width: 844, height: 390 } });
  const r = await G(page, () => {
    const c = document.getElementById('c');
    const e = new TouchEvent('touchmove', { cancelable: true, bubbles: true }); c.dispatchEvent(e);
    const e2 = new TouchEvent('touchstart', { cancelable: true, bubbles: true }); c.dispatchEvent(e2);
    const dbl = new MouseEvent('dblclick', { cancelable: true, bubbles: true }); c.dispatchEvent(dbl);
    return { moveDP: e.defaultPrevented, startDP: e2.defaultPrevented, dblDP: dbl.defaultPrevented, ta: getComputedStyle(c).touchAction, meta: document.querySelector('meta[name=viewport]').content, fixed: getComputedStyle(document.body).position, scale0: window.visualViewport.scale,
      apple: !!document.querySelector('meta[name=apple-mobile-web-app-capable]'), mobile: !!document.querySelector('meta[name=mobile-web-app-capable]'), us: getComputedStyle(c).userSelect, ob: getComputedStyle(document.body).overscrollBehavior };
  });
  const [x, y] = await toScreen(page, 100, 300);
  await page.touchscreen.tap(x, y); await sleep(60); await page.touchscreen.tap(x, y); await sleep(300);
  const scale = await G(page, () => window.visualViewport.scale);
  report('T-10', r.moveDP && r.startDP && r.dblDP && r.ta === 'none' && /user-scalable=no/.test(r.meta) && /viewport-fit=cover/.test(r.meta) && scale === 1 && r.apple && r.mobile && r.fixed === 'fixed',
    `touchmove defaultPrevented=${r.moveDP} (touchstart ${r.startDP}, dblclick ${r.dblDP}); canvas touch-action=${r.ta}, user-select=${r.us}, body overscroll-behavior="${r.ob}", position=${r.fixed}; viewport meta "${r.meta}"; apple/mobile web-app-capable metas=${r.apple}/${r.mobile}; visualViewport.scale after a double tap=${scale}`);
  await page.ctx.close();
}

// ---------- T-11 menus by tap ----------
async function t11(browser) {
  const page = await tPage(browser, { vp: { width: 844, height: 390 }, query: 'seed=7&fast=1', init: 'localStorage.removeItem("goldminer.reduceFx")' });
  const res = {};
  // legend: four pages
  const pages = [await G(page, () => __game.G.legendPage)];
  for (let i = 0; i < 4; i++) { await tapId(page, 'btn-legend'); await sleep(120); pages.push(await G(page, () => __game.G.legendPage)); }
  res.legend = pages.join(',');
  // select -> start by the buttons
  await tapId(page, 'mode-solo'); await wait(page, () => __game.G.screen === 'select', null, 2000);
  await tapId(page, 'btn-back'); await wait(page, () => __game.G.screen === 'start', null, 2000);
  await tapId(page, 'mode-solo'); await wait(page, () => __game.G.screen === 'select', null, 2000);
  await tapId(page, 'btn-start'); await sleep(100); const ready = await G(page, () => __game.G.sel[0].ready);   // "开始" confirms
  await tapId(page, 'btn-start');                                                                              // now "立即开始"
  await wait(page, () => __game.G.screen === 'intro', null, 2000); res.sel = ready;
  await tapG(page, 640, 400); await wait(page, () => __game.G.screen === 'play', null, 2000);
  // pause menu: three rows + two switches
  await tapId(page, 'btn-pause'); await sleep(120); res.paused = await G(page, () => __game.G.paused);
  await tapId(page, 'pause-fx'); await sleep(100); res.fx = await G(page, () => localStorage.getItem('goldminer.reduceFx'));
  const muted0 = await G(page, () => __game.Snd.muted); await tapId(page, 'pause-sound'); await sleep(100); res.snd = [muted0, await G(page, () => __game.Snd.muted)];
  await tapId(page, 'pause-fx'); await sleep(100); res.fx2 = await G(page, () => localStorage.getItem('goldminer.reduceFx'));
  await tapId(page, 'pause-sound'); await sleep(60);
  await tapId(page, 'pause-resume'); await sleep(120); res.resumed = !(await G(page, () => __game.G.paused));
  await G(page, () => { __game.G.players[0].caught = 3; });
  await tapId(page, 'btn-pause'); await sleep(100); await tapId(page, 'pause-restart'); await sleep(150);
  res.restart = await G(page, () => ({ mode: __game.G.mode, round: __game.G.round, n: __game.G.players.length, ch: __game.G.players[0].char, paused: __game.G.paused, screen: __game.G.screen }));
  await wait(page, () => __game.G.screen === 'play', null, 3000);
  await tapId(page, 'btn-pause'); await sleep(100); await tapId(page, 'pause-menu'); await sleep(150); res.menu = await G(page, () => __game.G.screen);
  // shop: select, buy, refresh
  await G(page, () => { const g = __game, G = g.G; g.reseed(7); g.startMode('solo', [0]); G.forceEvent = 'none'; const p = G.players[0]; p.money = 40000; p.roundGain = 40000; G.screen = 'play'; g.endRound(); });
  await sleep(600); await tapId(page, 'btn-continue'); await wait(page, () => __game.G.screen === 'shop', null, 3000); await sleep(400);
  const s0 = await G(page, () => ({ money: __game.G.players[0].money, price: __game.G.shop[0].offers[1].price, id: __game.G.shop[0].offers[1].id }));
  await tapId(page, 'shop-card-1'); await sleep(100); const sel = await G(page, () => __game.G.shop[0].sel);
  const moneyAfterSelect = await G(page, () => __game.G.players[0].money);
  await tapId(page, 'shop-card-1'); await sleep(150);
  const moneyBought = await G(page, () => __game.G.players[0].money);
  res.shop = { sel, selectFree: moneyAfterSelect === s0.money, paid: s0.money - moneyBought, price: s0.price };
  const rr0 = await G(page, () => ({ idx: __game.G.shop[0].rerollIdx, n: __game.G.shop[0].rerolls, m: __game.G.players[0].money, rp: __game.G.shop[0].rerollPrice }));
  await tapId(page, 'shop-card-' + rr0.idx); await sleep(100); await tapId(page, 'shop-card-' + rr0.idx); await sleep(150);
  const rr1 = await G(page, () => ({ n: __game.G.shop[0].rerolls, m: __game.G.players[0].money }));
  res.reroll = { n: rr1.n, paid: rr0.m - rr1.m, price: rr0.rp };
  await sleep(450);                                                                                             // (a card cannot be bought again within the 0.35 s touch cooldown)
  await tapId(page, 'btn-buy');                                                                                 // explicit button on the selected (refresh) card
  await sleep(150); const rr2 = await G(page, () => __game.G.shop[0].rerolls); res.reroll.n2 = rr2;
  // ready: tap twice
  await tapId(page, 'shop-card-' + (rr0.idx + 1)); await sleep(150); res.armed = await G(page, () => __game.G.shop[0].armed);
  await tapId(page, 'shop-card-' + (rr0.idx + 1)); await wait(page, () => __game.G.screen === 'intro', null, 2000).then(() => { res.ready = true; }).catch(() => { res.ready = false; });
  // final: play again / main menu
  await G(page, () => { const g = __game, G = g.G; G.round = 3; g.finishGame(); });
  await sleep(300); await tapId(page, 'btn-again'); await sleep(200);
  res.again = await G(page, () => ({ mode: __game.G.mode, screen: __game.G.screen, round: __game.G.round }));
  await G(page, () => { const g = __game, G = g.G; G.round = 3; g.finishGame(); }); await sleep(300);
  await tapId(page, 'btn-menu'); await sleep(200); res.menu2 = await G(page, () => __game.G.screen);
  const ok = res.legend === '0,1,2,3,0' && res.sel === true && res.paused && res.fx === '1' && res.fx2 === '0' && res.snd[0] !== res.snd[1] && res.resumed && res.restart.mode === 'solo' && res.restart.round === 1 && res.restart.ch === 0 && res.menu === 'start'
    && res.shop.sel === 1 && res.shop.selectFree && res.shop.paid === res.shop.price && res.reroll.n === rr0.n + 1 && res.reroll.paid === res.reroll.price && res.reroll.n2 === rr0.n + 2 && res.armed === true && res.ready === true
    && res.again.mode === 'solo' && res.again.screen === 'intro' && res.again.round === 1 && res.menu2 === 'start' && page.errors.length === 0;
  report('T-11', ok, `tap-only: legend pages ${res.legend}; select: "开始" confirms (${res.sel}) then "立即开始" -> intro; pause button -> paused=${res.paused}, "特效" toggle -> reduceFx ${res.fx} then ${res.fx2}, "声音" toggle muted ${res.snd}, resume=${res.resumed}, restart -> ${res.restart.mode} round ${res.restart.round}, main menu -> ${res.menu}; shop: first tap selects without paying (${res.shop.selectFree}), second tap pays ${res.shop.paid} (price ${res.shop.price}), refresh card tapped twice -> ${res.reroll.n} refresh paid ${res.reroll.paid} (price ${res.reroll.price}), buy button on refresh card -> ${res.reroll.n2}, ready tapped: armed=${res.armed}, again -> intro=${res.ready}; final: "再来一局" -> ${res.again.mode}/${res.again.screen}, "主菜单" -> ${res.menu2}; errors=${page.errors.length}`);
  await page.ctx.close();
}

// ---------- T-12 audio unlock ----------
async function t12(browser) {
  const page = await tPage(browser, { vp: { width: 844, height: 390 } });
  await sleep(400);
  const before = await G(page, () => ({ ctx: !!__game.Snd.ctx, st: __game.Snd.ctx && __game.Snd.ctx.state }));
  const errsBefore = page.errors.length;
  await tapId(page, 'btn-legend'); await sleep(400);
  const after = await G(page, () => ({ ctx: !!__game.Snd.ctx, st: __game.Snd.ctx && __game.Snd.ctx.state }));
  report('T-12', !before.ctx && errsBefore === 0 && after.st === 'running' && page.errors.length === 0, `before the first tap: no audio context, errors=${errsBefore}; after the first tap: AudioContext.state=${after.st}, errors=${page.errors.length}`);
  await page.ctx.close();
}

// ---------- T-13 performance ----------
async function t13(browser) {
  const out = {};
  for (const rate of [1, 4]) {
    const page = await tPage(browser, { dev: 'Pixel 7 landscape', query: 'seed=5' });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await G(page, () => {
      const g = __game, G = g.G; g.reseed(5); g.startMode('solo', [0]); G.forceEvent = 'none'; G.round = 3; g.startRound(); g.advance(3);   // round 4
      window.__ft = []; let last = performance.now(); (function f(n) { window.__ft.push(n - last); last = n; requestAnimationFrame(f); })(last);
    });
    await G(page, () => { window.__rt = true; });
    // keep the hook busy like a player would (real taps)
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) { await tapG(page, 380 + Math.random() * 500, 430); await sleep(900); }
    out[rate] = await G(page, () => { const a = window.__ft.slice(5).map(x => 1000 / x).sort((x, y) => x - y); return { med: a[a.length >> 1], p10: a[Math.floor(a.length * 0.1)], n: a.length, lvl: __game.G.dprLevel, round: __game.G.round, scr: __game.G.screen, cw: document.getElementById('c').width }; });
    out[rate].err = page.errors.length;
    await page.ctx.close();
  }
  report('T-13', out[1].med >= 55 && out[4].med >= 40 && out[4].lvl < 2 && out[1].err + out[4].err === 0,
    `Pixel 7, round 4, 20 s of play with real taps: unthrottled median ${out[1].med.toFixed(1)} fps (>=55; 10th percentile ${out[1].p10.toFixed(1)}, dprLevel stayed ${out[1].lvl}, canvas ${out[1].cw}px wide); CPU x4 throttle: median ${out[4].med.toFixed(1)} fps (>=40), dprLevel dropped to ${out[4].lvl} (<2), canvas ${out[4].cw}px wide`);
}

// ---------- T-14 keyboard does not regress ----------
async function t14(browser) {
  // touch device: ArrowDown still fires
  const page = await tPage(browser, { vp: { width: 844, height: 390 }, query: 'seed=5' });
  await G(page, () => { const g = __game, G = g.G; g.reseed(5); g.startMode('solo', [0]); G.forceEvent = 'none'; g.advance(4); G.players[0].hook.phase = 0; });
  await page.keyboard.press('ArrowDown'); const st = await G(page, () => __game.G.players[0].hook.state);
  await page.ctx.close();
  // desktop: all three modes enter via the keyboard; golden run against the accepted phase-2 build (rule 2, default)
  const d = await L.newPage(browser, L.URL);
  const modes = [];
  for (const [dig, mode] of [['Digit1', 'solo'], ['Digit2', 'versus'], ['Digit3', 'coop']]) {
    await d.keyboard.press(dig); await d.keyboard.press('Space'); await sleep(100);
    if (mode === 'solo') { await d.keyboard.press('ArrowDown'); } else { await d.keyboard.press('KeyS'); await d.keyboard.press('ArrowDown'); }
    await wait(d, () => __game.G.screen === 'intro', null, 4000);
    modes.push(await G(d, () => [__game.G.mode, __game.G.players.length].join(':')));
    await d.keyboard.press('Escape'); await d.keyboard.press('ArrowDown'); await d.keyboard.press('ArrowDown'); await d.keyboard.press('Enter'); await sleep(100);
  }
  await d.context().close();
  const MULBERRY = `(seed => { window.Math.random = function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })`;
  const script = mode => `(() => { const g = window.__game, G = g.G, STEP = 1 / 60;
    G.mode = ${JSON.stringify(mode)}; G.chars = [1, 4]; g.startGame();
    const log = []; let guard = 0;
    while (G.screen !== 'final' && guard++ < 60 * 60 * 30) {
      if (G.screen === 'play') { for (const p of G.players) if (p.alive && p.hook.state === 'swing' && Math.floor(G.playT * 60) % 47 === p.id * 13) g.press(p.cfg.keys.fire); }
      else if (G.screen === 'results' && G.resultsT > 0.5) { log.push(G.players.map(p => p.money).concat([G.teamMoney])); g.press('Space'); }
      else if (G.screen === 'shop' && G.t - G.shopStartT > 0.3) { g.press('KeyS'); g.press('KeyW'); g.press('ArrowUp'); }
      g.advance(STEP);
    }
    return { log, final: { winner: G.final.winner, cleared: G.final.cleared, victory: G.final.victory, scores: G.final.scores } }; })()`;
  let same = 0, total = 0;
  for (const mode of ['solo', 'versus', 'coop']) for (let seed = 1; seed <= 5; seed++) {
    const res = [];
    for (const url of [L.BASELINE2, L.URL]) {
      const p = await L.newPage(browser, url, { init: `${MULBERRY}(${seed})` });
      res.push(await p.evaluate(script(mode))); await p.context().close();
    }
    total++; if (JSON.stringify(res[0]) === JSON.stringify(res[1])) same++;
  }
  report('T-14', st === 'extend' && modes.join() === 'solo:1,versus:2,coop:2' && same === total,
    `phone + keyboard: ArrowDown fires (hook "${st}"); desktop keyboard menu reaches ${modes.join(' ')}; desktop golden runs vs tests/baseline-phase2.html (rule 2, solo/versus/coop x seeds 1-5, per-round money + final scores): ${same}/${total} identical; AC-P2-01/02/21 (desktop, 3 modes) are in the phase2 group of this same runner`);
}

// ---------- extras: no fullscreen API, particle cap ----------
async function textras(browser) {
  const page = await tPage(browser, { vp: { width: 844, height: 390 }, init: 'try { delete Element.prototype.requestFullscreen; } catch (e) {} try { delete Element.prototype.webkitRequestFullscreen; } catch (e) {}' });
  await sleep(300);
  const ids = (await page.evaluate(() => __game.uiButtons())).map(b => b.id);
  await page.evaluate(TEXT_SPY); const tx = await texts(page);
  const hint = tx.some(q => q.t === '添加到主屏幕可全屏游玩');
  await page.ctx.close();
  const p2 = await tPage(browser, { vp: { width: 844, height: 390 }, query: 'seed=2' });
  const n = await G(p2, () => { const g = __game, G = g.G; g.reseed(2); g.startMode('solo', [0]); G.forceEvent = 'none'; g.advance(4); let mx = 0; for (let i = 0; i < 40; i++) { g.explodeTNT(g.makeItem('tnt', 400 + i * 10, 500)); g.explodeTNT(g.makeItem('tnt', 900 - i * 10, 400)); mx = Math.max(mx, G.particles.length); } return mx; });
  const n2 = await G(p2, () => { __game.reduceFx(true); const G = __game.G; G.particles = []; for (let i = 0; i < 40; i++) __game.explodeTNT(__game.makeItem('tnt', 400 + i * 10, 500)); __game.reduceFx(false); return G.particles.length; });
  report('T-16', !ids.includes('btn-fullscreen') && hint && n <= 300 && n2 <= 150,
    `no requestFullscreen (iPhone Safari): no fullscreen button, "添加到主屏幕可全屏游玩" drawn=${hint}; particle cap on touch: peak ${n} (<=300), with effects reduced ${n2} (<=150)`);
  await p2.ctx.close();
}

// ---------- T-15 screenshots ----------
async function t15(browser) {
  fs.mkdirSync(SHOTS_T, { recursive: true });
  const REC = JSON.stringify({ cleared: 5, stars: 9, money: 9400, char: 1, perRound: [1500, 4400, 8000, 11000, 15000] });
  const files = [];
  for (const ph of PHONES) {
    const tag = ph.w + 'x' + ph.h;
    const page = await tPage(browser, { dev: ph.dev, vp: { width: ph.w, height: ph.h }, query: 'seed=3&safe=' + ph.safe, init: `localStorage.setItem('goldminer.soloBest', ${JSON.stringify(REC)})` });
    const shot = async name => { const f = path.join(SHOTS_T, `${tag}-${name}.png`); await page.screenshot({ path: f }); files.push(f); };
    await sleep(500); await shot('1-menu');
    await tapId(page, 'mode-solo'); await sleep(300); await tapId(page, 'char-2'); await sleep(300); await shot('2-select');
    await G(page, () => { const g = __game, G = g.G; g.reseed(3); g.startMode('solo', [2]); G.forceEvent = 'goldrush'; G.round = 1; g.startRound(); g.advance(3.2); const p = G.players[0]; p.money = 2900; p.roundGain = 1500; p.buffs.strength = true; p.buffs.gear = true; p.dyn = 2; g.advance(1); });
    await sleep(350); await shot('3-play');
    await G(page, () => { const g = __game, G = g.G, p = G.players[0]; p.money = 5400; p.roundGain = 4200; g.endRound(); }); await sleep(2600); await shot('3b-results');
    await G(page, () => { __game.afterResults(); }); await sleep(500); await tapId(page, 'shop-card-1'); await sleep(250); await shot('4-shop');
    await G(page, () => { const g = __game, G = g.G; G.round = 3; G.stars = [3, 2, 0]; G.soloCum = [2100, 5400, 5600]; G.soloSaved = [false, false, true]; g.finishGame(); }); await sleep(700); await shot('5-final');
    if (page.errors.length) throw new Error('errors in screenshots: ' + page.errors[0]);
    await page.ctx.close();
  }
  report('T-15', files.length === 18 && files.every(f => fs.existsSync(f)), `${files.length} screenshots in screenshots/touch/ (menu, character select, play, results, shop, final x 667x375, 844x390 with 47px side insets, 932x430 with 59px side insets); visually reviewed by hand (see report)`);
}

// ---------- T-17 (review issue 1): double taps must not skip the final screen ----------
async function t17(browser) {
  const res = {};
  const toLastResults = async page => {
    await G(page, () => { const g = __game, G = g.G; g.reseed(4); g.startMode('solo', [0]); G.forceEvent = 'none'; G.round = 7; g.startRound(); G.screen = 'play'; const p = G.players[0]; p.money = 40000; p.roundGain = 40000; g.endRound(); });
    await sleep(700);
  };
  for (const gap of [150, 400]) {
    const page = await tPage(browser, { vp: { width: 844, height: 390 }, query: 'seed=4' });
    await toLastResults(page);
    const b = await btnOf(page, 'btn-continue'); const label = (await G(page, () => __game.G.results[0].over || __game.G.round >= 8));
    const [x, y] = await toScreen(page, b.x + b.w / 2, b.y + b.h / 2);
    await page.touchscreen.tap(x, y); await sleep(gap); await page.touchscreen.tap(x, y); await sleep(350);
    res['gap' + gap] = await G(page, () => ({ s: __game.G.screen, r: __game.G.round, last: __game.G.round >= 8 }));
    if (gap === 150) {
      await sleep(1000);
      await tapId(page, 'btn-again', { now: true }); await sleep(250);
      res.again = await G(page, () => ({ s: __game.G.screen, m: __game.G.mode, r: __game.G.round }));
    }
    res['err' + gap] = page.errors.length;
    await page.ctx.close();
  }
  { // pause menu -> main menu, double tap lands on the solo card position
    const page = await tPage(browser, { vp: { width: 844, height: 390 }, query: 'seed=4' });
    await G(page, () => { const g = __game; g.reseed(4); g.startMode('solo', [0]); g.advance(4); });
    await tapId(page, 'btn-pause'); await sleep(300);
    const b = await btnOf(page, 'pause-menu'); const [x, y] = await toScreen(page, b.x + b.w / 2, b.y + b.h / 2);
    await page.touchscreen.tap(x, y); await sleep(160); await page.touchscreen.tap(x, y); await sleep(350);
    res.menu = await G(page, () => ({ s: __game.G.screen, paused: __game.G.paused }));
    await sleep(600);
    const mb = await btnOf(page, 'mode-solo'); await tapG(page, mb.x + mb.w / 2, mb.y + mb.h / 2); await sleep(300);
    res.menuTap = await G(page, () => __game.G.screen);
    await page.ctx.close();
  }
  report('T-17', res.gap150.s === 'final' && res.gap400.s === 'final' && res.gap150.last && res.again.s === 'intro' && res.again.m === 'solo' && res.again.r === 1 && res.menu.s === 'start' && res.menuTap === 'select' && res.err150 + res.err400 === 0,
    `last-round results page, real taps on "查看最终结果" twice: 150 ms apart -> ${res.gap150.s}, 400 ms apart -> ${res.gap400.s} (round ${res.gap400.r}); 1 s later "再来一局" -> ${res.again.s} / ${res.again.m} / round ${res.again.r}; pause menu "返回主菜单" double tap (160 ms) -> ${res.menu.s}; a deliberate tap on the solo card 0.6 s later -> ${res.menuTap}`);
}

// ---------- T-18 (review suggestion 2): triple tap buys once ----------
async function t18(browser) {
  const page = await tPage(browser, { vp: { width: 844, height: 390 }, query: 'seed=7' });
  await G(page, () => { const g = __game, G = g.G; g.reseed(7); g.startMode('solo', [0]); G.forceEvent = 'none'; const p = G.players[0]; p.money = 40000; p.roundGain = 40000; G.screen = 'play'; g.endRound(); });
  await sleep(700); await tapId(page, 'btn-continue'); await wait(page, () => __game.G.screen === 'shop', null, 3000); await sleep(700);
  await G(page, () => { const s = __game.G.shop[0]; s.offers[1] = { id: 'dynamite', basePrice: 100, price: 100, count: 0 }; s.sel = 0; });
  await sleep(100);
  const b = await btnOf(page, 'shop-card-1'); const [x, y] = await toScreen(page, b.x + b.w / 2, b.y + b.h / 2);
  const before = await G(page, () => ({ m: __game.G.players[0].money, d: __game.G.players[0].dyn }));
  const t0 = Date.now();
  for (let i = 0; i < 3; i++) await page.touchscreen.tap(x, y);
  const spanMs = Date.now() - t0;
  await sleep(80);
  const one = await G(page, () => ({ m: __game.G.players[0].money, d: __game.G.players[0].dyn }));
  await sleep(500); await page.touchscreen.tap(x, y); await sleep(120);
  const two = await G(page, () => ({ m: __game.G.players[0].money, d: __game.G.players[0].dyn }));
  report('T-18', one.d - before.d === 1 && before.m - one.m === 100 && two.d - before.d === 2 && two.m === before.m - 200,
    `stackable dynamite card, 3 real taps within ${spanMs} ms (1st selects, 2nd buys, 3rd falls into the 0.35 s cooldown): dynamite +${one.d - before.d}, coins -${before.m - one.m}; one more tap 0.5 s later: dynamite +${two.d - before.d} in total`);
  await page.ctx.close();
}

// ---------- T-19 (review suggestion 3): backgrounding pauses ----------
async function t19(browser) {
  const page = await tPage(browser, { vp: { width: 844, height: 390 }, query: 'seed=3' });
  await G(page, () => { const g = __game; g.reseed(3); g.startMode('solo', [0]); g.advance(4); });
  const hide = vis => G(page, vis => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => vis === 'hidden' }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis }); document.dispatchEvent(new Event('visibilitychange')); return __game.G.paused; }, vis);
  const sc = await G(page, () => __game.G.screen);
  const pausedHidden = await hide('hidden');
  const pausedShown = await hide('visible');
  await page.evaluate(TEXT_SPY); await sleep(150); const tx = await texts(page);
  // on the desktop UI nothing happens
  const d = await L.newPage(browser, L.URL + '?touch=0');
  await d.evaluate(() => { const g = __game; g.reseed(3); g.startMode('solo', [0]); g.advance(4); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const deskPaused = await G(d, () => __game.G.paused); await d.context().close();
  report('T-19', sc === 'play' && pausedHidden === true && pausedShown === true && tx.some(q => q.t === '已暂停') && deskPaused === false && page.errors.length === 0,
    `touch UI in play: visibilitychange -> hidden: G.paused=${pausedHidden}; back to visible: still paused=${pausedShown} with the pause menu drawn=${tx.some(q => q.t === '已暂停')}; desktop UI unaffected (paused=${deskPaused})`);
  await page.ctx.close();
}

// ---------- T-20 (review suggestion 4): DPR step-down ----------
async function t20(browser) {
  const out = {};
  for (const rate of [2, 4]) {
    const page = await tPage(browser, { dev: 'Pixel 7 landscape', query: 'seed=5' });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await G(page, () => {
      const g = __game, G = g.G; g.reseed(5); g.startMode('solo', [0]); G.forceEvent = 'none'; G.round = 3; g.startRound(); g.advance(3);
      window.__ft = []; let last = performance.now(); (function f(n) { window.__ft.push(n - last); last = n; requestAnimationFrame(f); })(last);
    });
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) { await tapG(page, 380 + Math.random() * 500, 430); await sleep(900); }
    out[rate] = await G(page, () => { const ms = window.__ft.slice(5), a = ms.map(x => 1000 / x).sort((x, y) => x - y), sm = ms.slice().sort((x, y) => x - y); return { med: a[a.length >> 1], lvl: __game.G.dprLevel, why: __game.G.dprReason, meanMs: ms.reduce((x, y) => x + y, 0) / ms.length, medMs: sm[sm.length >> 1], long: ms.filter(x => x > 25).length / ms.length }; });
    out[rate].err = page.errors.length; await page.ctx.close();
  }
  report('T-20', out[2].lvl === 2 && out[2].why === null && out[4].lvl < 2 && out[4].med >= 40 && !!out[4].why && out[2].med >= 55 && out[2].err + out[4].err === 0,
    `Pixel 7, play screen only, step needs two 2 s windows with >= 75% of frames > 22 ms (or one with 90% and a median > 30 ms; from 1.5 one slow window): CPU x2 -> median ${out[2].med.toFixed(1)} fps (frame time median ${out[2].medMs.toFixed(1)} ms, mean ${out[2].meanMs.toFixed(1)} ms, ${(100 * out[2].long).toFixed(0)}% of frames > 25 ms), dprLevel stays ${out[2].lvl} (reason ${JSON.stringify(out[2].why)}); CPU x4 (frame time median ${out[4].medMs.toFixed(1)} ms, mean ${out[4].meanMs.toFixed(1)} ms) -> median ${out[4].med.toFixed(1)} fps (>=40), dprLevel ${out[4].lvl}, G.dprReason=${JSON.stringify(out[4].why)}`);
}

// ---------- T-21 (review suggestion 5): desktop pixels unchanged vs phase 2 ----------
async function t21(browser) {
  const FREEZE = `(() => { let T = 1000; performance.now = () => T; const cbs = []; window.requestAnimationFrame = cb => { cbs.push(cb); return cbs.length; }; window.__tick = n => { for (let i = 0; i < n; i++) { T += 16.6667; const c = cbs.splice(0); c.forEach(f => f(T)); } }; })()`;
  const shots = async (url, query) => {
    const page = await L.newPage(browser, url + '?' + query, { init: FREEZE });
    const out = {};
    const grab = async name => { await page.evaluate(() => window.__tick(3)); out[name] = await page.evaluate(() => document.getElementById('c').toDataURL()); };
    await page.evaluate(() => { const g = __game, G = g.G; g.reseed(3); g.startMode('solo', [2]); G.forceEvent = 'none'; g.advance(2); });
    await grab('intro');
    await page.evaluate(() => { __game.advance(5); }); await grab('play');
    await page.evaluate(() => { const g = __game, G = g.G, p = G.players[0]; p.money = 5400; p.roundGain = 4200; g.endRound(); g.advance(1.5); }); await grab('results');
    await page.evaluate(() => { const g = __game, G = g.G; g.afterResults(); g.advance(0.6); }); await grab('shop');
    await page.evaluate(() => { const G = __game.G; G.shop[0].sel = G.shop[0].rerollIdx; __game.advance(0.1); }); await grab('shop-reroll');
    await page.evaluate(() => { const G = __game.G; G.shop[0].sel = G.shop[0].rerollIdx + 1; __game.shopAction(0, 'ready'); __game.advance(0.1); }); await grab('shop-armed');
    await page.evaluate(() => { const g = __game, G = g.G; G.round = 3; g.finishGame(); g.advance(0.5); }); await grab('final');
    await page.context().close(); return out;
  };
  const a = await shots(L.URL, 'touch=0&seed=3'), b = await shots(L.BASELINE2, 'seed=3');
  const names = Object.keys(a), diff = names.filter(n => a[n] !== b[n]);
  report('T-21', diff.length === 0, `desktop (touchUI=false) canvas pixels with a frozen clock vs baseline-phase2 on ${names.join('/')}: ${names.length - diff.length}/${names.length} identical${diff.length ? ' DIFF: ' + diff : ''}`);
}

async function run(browser) {
  await t01(browser); await t03_04(browser); await t05(browser); await t06(browser); await t07_08(browser); await t09(browser); await t10(browser); await t11(browser); await t12(browser); await textras(browser);
  await t15(browser); await t13(browser); await t14(browser); await t17(browser); await t18(browser); await t19(browser); await t20(browser); await t21(browser); await t02(browser);
}
module.exports = { playByTouch, run, t17, t18, t19, t20, t21, t01, t02, t03_04, t05, t06, t07_08, t09, t10, t11, t12, t13, t14, t15, textras };
