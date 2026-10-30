// Real-keyboard acceptance tests (page.keyboard.press only): AC-05..AC-11.
const L = require('./lib');
const { report } = L;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const G = (page, fn, arg) => page.evaluate(fn, arg);
const wait = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 30 });

async function ac05(browser) {
  const out = [];
  for (const [digit, mode] of [['Digit2', 'versus'], ['Digit3', 'coop']]) {
    const page = await L.newPage(browser, L.URL1);
    const kb = page.keyboard;
    await kb.press(digit); await kb.press('Space');
    await kb.press('KeyS'); await kb.press('ArrowDown');           // P1 confirms with S, P2 with arrow down
    await wait(page, () => window.__game.G.screen === 'intro', null, 5000);
    const s = await G(page, () => ({ mode: __game.G.mode, n: __game.G.players.length, screen: __game.G.screen, menu: __game.G.menuMode }));
    out.push(`${digit}: mode=${s.mode} players=${s.n} screen=${s.screen}`);
    out.ok = (out.ok === undefined ? true : out.ok) && s.mode === mode && s.n === 2 && s.screen === 'intro' && page.errors.length === 0;
    await page.context().close();
  }
  report('AC-05', out.ok, 'real keys Digit2/3 -> Space -> KeyS + ArrowDown -> ' + out.join(' | '));
}

async function ac06_07(browser) {
  const page = await L.newPage(browser, L.URL1);
  const kb = page.keyboard, mm = () => G(page, () => __game.G.menuMode);
  const seq = [await mm()];
  await kb.press('ArrowLeft'); seq.push(await mm());
  await kb.press('ArrowLeft'); seq.push(await mm());
  for (let i = 0; i < 5; i++) await kb.press('KeyD');
  seq.push(await mm());
  const direct = [];
  for (const d of ['Digit1', 'Digit2', 'Digit3']) { await kb.press(d); direct.push(await mm()); }
  await kb.press('Digit2'); await kb.press('KeyA'); const a1 = await mm(); await kb.press('ArrowRight'); const a2 = await mm();
  const ok = seq.join() === '1,0,0,2' && direct.join() === '0,1,2' && a1 === 0 && a2 === 1;
  report('AC-06', ok, `default menuMode=${seq[0]} (versus); ArrowLeft->${seq[1]}; ArrowLeft again->${seq[2]} (no wrap); KeyD x5->${seq[3]}; Digit1/2/3->${direct}; KeyA from versus->${a1}; ArrowRight->${a2}`);
  // AC-07 memory
  await kb.press('Digit1'); await kb.press('Space');
  const st = await G(page, () => ({ screen: __game.G.screen, mode: localStorage.getItem('goldminer.mode') }));
  await page.reload(); await page.waitForFunction(() => window.__game);
  const after = await G(page, () => ({ menu: __game.G.menuMode, screen: __game.G.screen, mode: localStorage.getItem('goldminer.mode') }));
  report('AC-07', st.screen === 'select' && st.mode === 'solo' && after.menu === 0 && after.mode === 'solo' && after.screen === 'start', `Digit1+Space -> screen=${st.screen}, goldminer.mode=${st.mode}; after reload menuMode=${after.menu} (solo), goldminer.mode=${after.mode}`);
  report('AC-06e', page.errors.length === 0, `errors: ${page.errors.length}`);
  await page.context().close();
}

async function ac08(browser) {
  const page = await L.newPage(browser, L.URL1 + '&fast=1&seed=5');
  const kb = page.keyboard, sel = () => G(page, () => ({ idx: __game.G.sel[0].idx, ready: __game.G.sel[0].ready }));
  await kb.press('Digit1'); await kb.press('Space');
  const s0 = await sel(); await kb.press('ArrowRight'); const s1 = await sel(); await kb.press('KeyD'); const s2 = await sel();
  await kb.press('ArrowLeft'); const s3 = await sel(); await kb.press('KeyA'); const s4 = await sel();
  await kb.press('ArrowDown'); const r1 = await sel(); await kb.press('ArrowUp'); const r2 = await sel();       // confirm / cancel with arrows
  await kb.press('KeyS'); const r3 = await sel(); await kb.press('KeyW'); const r4 = await sel();                 // ... and with WASD
  await kb.press('ArrowRight'); await kb.press('ArrowDown');                                                     // select char 1, confirm
  await wait(page, () => __game.G.screen === 'play', null, 8000);
  const hookState = () => G(page, () => __game.G.players[0].hook.state);
  const reset = () => G(page, () => { const h = __game.G.players[0].hook; h.state = 'swing'; h.len = __game.HOOK.minLen; h.item = null; });
  await kb.press('ArrowDown'); const f1 = await hookState(); await reset();
  await kb.press('KeyS'); const f2 = await hookState(); await reset();
  const dynTry = async key => {
    await G(page, () => { const g = __game, p = g.G.players[0], it = g.makeItem('rock_b', 640, 400); g.G.items.push(it); it.grabbedBy = 0; p.hook.item = it; p.hook.state = 'retract'; p.hook.len = 300; p.dyn = 3; });
    const before = await G(page, () => __game.G.players[0].dyn); await kb.press(key);
    const after = await G(page, () => __game.G.players[0].dyn); await reset(); return [before, after];
  };
  const d1 = await dynTry('ArrowUp'), d2 = await dynTry('KeyW');
  const ok = s0.idx === 0 && s1.idx === 1 && s2.idx === 2 && s3.idx === 1 && s4.idx === 0 && r1.ready && !r2.ready && r3.ready && !r4.ready
    && f1 === 'extend' && f2 === 'extend' && d1[1] === d1[0] - 1 && d2[1] === d2[0] - 1 && page.errors.length === 0;
  report('AC-08', ok, `select: ArrowRight ${s0.idx}->${s1.idx}, KeyD ->${s2.idx}, ArrowLeft ->${s3.idx}, KeyA ->${s4.idx}; confirm ArrowDown=${r1.ready}/ArrowUp cancel=${!r2.ready}; KeyS=${r3.ready}/KeyW cancel=${!r4.ready}; fire ArrowDown swing->${f1}, KeyS swing->${f2}; dynamite ArrowUp dyn ${d1[0]}->${d1[1]}, KeyW ${d2[0]}->${d2[1]}`);
  await page.context().close();
}

async function ac09(browser) {
  const page = await L.newPage(browser, L.URL1 + '&fast=1&seed=3');
  const kb = page.keyboard, t0 = Date.now();
  await kb.press('Digit1'); await kb.press('Space'); await kb.press('ArrowRight'); await kb.press('ArrowRight'); await kb.press('ArrowDown');
  await wait(page, () => __game.G.screen === 'intro' || __game.G.screen === 'play', null, 5000);
  const s = await G(page, () => { const G = __game.G; return { mode: G.mode, n: G.players.length, ch: G.players[0].char, x: G.players[0].x }; });
  let flip = false, screens = new Set(), maxRound = 0;
  while (Date.now() - t0 < 6 * 60 * 1000) {
    const st = await G(page, () => ({ sc: __game.G.screen, r: __game.G.round }));
    screens.add(st.sc); maxRound = Math.max(maxRound, st.r);
    if (st.sc === 'final') break;
    if (st.sc === 'results') await kb.press('Space');
    else if (st.sc === 'shop') { await kb.press('KeyS'); await kb.press('KeyW'); }
    else if (st.sc === 'play') { await kb.press(flip ? 'KeyS' : 'ArrowDown'); flip = !flip; }
    await sleep(700);
  }
  const fin = await G(page, () => ({ screen: __game.G.screen, round: __game.G.round, rec: localStorage.getItem('goldminer.soloBest') }));
  let rec = null; try { rec = JSON.parse(fin.rec); } catch (e) {}
  const fields = rec && ['cleared', 'stars', 'money', 'char', 'perRound'].every(k => k in rec);
  report('AC-09', s.mode === 'solo' && s.n === 1 && s.ch === 2 && s.x === 640 && fin.screen === 'final' && page.errors.length === 0 && fields,
    `mode=${s.mode} players=${s.n} char=${s.ch} x=${s.x}; reached final=${fin.screen === 'final'} after ${((Date.now() - t0) / 1000).toFixed(0)}s (round ${fin.round}); errors=${page.errors.length}; soloBest fields ok=${!!fields} ${fin.rec ? fin.rec.slice(0, 60) : ''}`);
  await page.context().close();
}

// AC-10: normal speed. The in-page bot only *asks* for keys; every key goes through page.keyboard.press.
async function ac10one(browser, seed) {
  const page = await L.newPage(browser, L.URL1 + '&seed=' + seed);
  const kb = page.keyboard, map = { KeyS: 'ArrowDown', KeyW: 'ArrowUp' };
  await kb.press('Digit1'); await kb.press('Space'); await kb.press('ArrowDown');
  await wait(page, () => __game.G.screen === 'intro', null, 5000);
  await page.evaluate(L.BOT_SRC); await page.evaluate(() => window.__rtBot('skilled'));
  const t0 = Date.now(); let presses = 0;
  while (Date.now() - t0 < 120000) {
    const sc = await G(page, () => __game.G.screen);
    if (sc === 'results') break;
    const w = await G(page, () => { const k = window.__want; window.__want = null; return k; });
    if (w) { await kb.press(map[w] || w); presses++; } else await sleep(3);
  }
  await wait(page, () => __game.G.resultsT > 0.5, null, 5000);
  const r1 = await G(page, () => { const G = __game.G; return { stars: G.results[0].stars, total: G.results[0].total, round: G.round, income: G.results[0].income }; });
  await kb.press('Space');
  await wait(page, () => __game.G.screen === 'shop' && __game.G.t - __game.G.shopStartT > 0.35, null, 5000);
  const shop = await G(page, () => { const s = __game.G.shop[0], p = __game.G.players[0]; return { money: p.money, offers: s.offers.map(o => ({ id: o.id, price: o.price })), dyn: p.dyn }; });
  const idx = shop.offers.findIndex(o => o.price <= shop.money);
  let bought = null;
  if (idx >= 0) {
    for (let i = 0; i < idx; i++) await kb.press('ArrowRight');
    await kb.press('ArrowDown'); await sleep(100);
    const m = await G(page, () => __game.G.players[0].money);
    bought = { id: shop.offers[idx].id, price: shop.offers[idx].price, spent: shop.money - m };
  }
  await kb.press('ArrowUp');
  await wait(page, () => __game.G.round === 2 && __game.G.screen === 'intro', null, 5000);
  const ok = r1.stars >= 1 && bought && bought.spent === bought.price && page.errors.length === 0;
  const msg = `seed ${seed}: R1 stars=${r1.stars} (income ${r1.income}, total ${r1.total}, ${presses} real key presses); bought ${bought && bought.id} for ${bought && bought.price} (money -${bought && bought.spent}) after moving ${idx}x ArrowRight; ArrowUp -> round 2 intro`;
  await page.context().close();
  return { ok, msg };
}
async function ac10(browser) {
  const rs = await Promise.all([1, 2, 3].map(s => ac10one(browser, s)));
  report('AC-10', rs.every(r => r.ok), rs.map(r => r.msg).join(' || '));
}

async function ac11(browser) {
  const page = await L.newPage(browser, L.URL1 + '&fast=1&seed=2');
  const kb = page.keyboard;
  await kb.press('Digit1'); await kb.press('Space'); await kb.press('ArrowRight'); await kb.press('ArrowRight'); await kb.press('ArrowDown');
  await wait(page, () => __game.G.screen === 'play', null, 8000);
  await G(page, () => { __game.G.round; });
  await kb.press('KeyP');
  const p1 = await G(page, () => __game.G.paused);
  await kb.press('ArrowDown'); await kb.press('Enter');
  const r = await G(page, () => { const G = __game.G; return { paused: G.paused, mode: G.mode, ch: G.players[0].char, round: G.round, n: G.players.length, screen: G.screen }; });
  await kb.press('KeyP');                               // pause again (intro of the restarted game)
  const p2 = await G(page, () => __game.G.paused);
  await kb.press('ArrowDown'); await kb.press('ArrowDown'); await kb.press('Enter');
  const e = await G(page, () => ({ screen: __game.G.screen, paused: __game.G.paused }));
  report('AC-11', p1 && !r.paused && r.mode === 'solo' && r.ch === 2 && r.round === 1 && r.n === 1 && p2 && e.screen === 'start' && !e.paused && page.errors.length === 0,
    `KeyP paused=${p1}; ArrowDown+Enter restart -> mode=${r.mode} char=${r.ch} round=${r.round} players=${r.n} screen=${r.screen}; pause again=${p2}, ArrowDown x2 + Enter -> screen=${e.screen}`);
  await page.context().close();
}


// AC-09b: same real-key flow as AC-09, but G.players[0].money is topped up during play so the whole 8-round loop
// (intro / play / results / shop / final) is exercised with real key presses instead of dying in round 1.
async function ac09b(browser) {
  const page = await L.newPage(browser, L.URL1 + '&fast=1&seed=3');
  const kb = page.keyboard, t0 = Date.now();
  await kb.press('Digit1'); await kb.press('Space'); await kb.press('ArrowDown');
  await wait(page, () => __game.G.screen === 'intro' || __game.G.screen === 'play', null, 5000);
  let flip = false, shops = 0, results = 0;
  while (Date.now() - t0 < 4 * 60 * 1000) {
    const st = await G(page, () => { const G = __game.G; if (G.screen === 'play') { const p = G.players[0]; p.money = Math.max(p.money, __game.SOLO_TARGETS[G.round - 1] + 100); } return G.screen; });
    if (st === 'final') break;
    if (st === 'results') { await kb.press('Space'); results++; }
    else if (st === 'shop') { await kb.press('ArrowRight'); await kb.press('KeyS'); await kb.press('ArrowUp'); shops++; }
    else if (st === 'play') { await kb.press(flip ? 'KeyS' : 'ArrowDown'); flip = !flip; }
    await sleep(500);
  }
  const fin = await G(page, () => ({ screen: __game.G.screen, round: __game.G.round, victory: __game.G.final && __game.G.final.victory }));
  report('AC-09b', fin.screen === 'final' && fin.round === 8 && fin.victory && page.errors.length === 0, `real keys through all 8 rounds: reached final=${fin.screen === 'final'} round=${fin.round} victory=${fin.victory}; result pages passed=${results}, shop visits=${shops}; errors=${page.errors.length}`);
  await page.context().close();
}

async function run(browser) {
  await ac05(browser); await ac06_07(browser); await ac08(browser); await ac11(browser); await ac09(browser); await ac09b(browser); await ac10(browser);
}
module.exports = { run };
