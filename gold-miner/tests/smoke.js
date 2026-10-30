// SMOKE tier: node tests/run-all.js smoke   (target <= 3 min). Use for rework rounds; the full suite runs once per phase.
// Covers: 3 desktop modes through real keys (?fast=1), ?rules=1 golden spot check vs baseline-phase1 (versus + coop, 1 seed),
// rules-2 golden spot check vs baseline-phase2 (1 seed per mode), one touch-only solo game (iPhone 13), the tap guard (T-17), zero console errors.
const L = require('./lib');
const { report } = L;
const touch = require('./touch');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const G = (page, fn, arg) => page.evaluate(fn, arg);
const wait = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 30 });
const MULBERRY = `(seed => { window.Math.random = function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })`;

async function keyGame(browser, digit, mode) {
  const page = await L.newPage(browser, L.URL + '?fast=1&seed=5');
  const kb = page.keyboard, t0 = Date.now(), solo = mode === 'solo';
  const fire = async () => { if (solo) await kb.press('ArrowDown'); else { await kb.press('KeyS'); await kb.press('ArrowDown'); } };
  await kb.press(digit); await kb.press('Space'); await fire();
  await wait(page, () => __game.G.screen === 'intro' || __game.G.screen === 'play', null, 5000);
  const seen = new Set();
  while (Date.now() - t0 < 100000) {
    // top up round 1 only so that results + shop are exercised; round 2 is then lost and the game ends
    const st = await G(page, () => { const G = __game.G; if (G.screen === 'play' && G.round === 1) for (const p of G.players) if (p.alive) { p.money = Math.max(p.money, __game.targets()[0] + 50); if (G.mode === 'coop') G.teamMoney = Math.max(G.teamMoney, __game.targets()[0] + 50); } return G.screen; });
    seen.add(st);
    if (st === 'final') break;
    if (st === 'play') await fire();
    else if (st === 'results') await kb.press('Space');
    else if (st === 'shop') { if (solo) { await kb.press('ArrowUp'); await kb.press('ArrowUp'); } else { await kb.press('KeyW'); await kb.press('ArrowUp'); } }
    await sleep(400);
  }
  const fin = await G(page, () => ({ s: __game.G.screen, m: __game.G.mode, n: __game.G.players.length }));
  const ok = fin.s === 'final' && fin.m === mode && seen.has('results') && seen.has('shop') && page.errors.length === 0;
  const msg = `${mode}: final=${fin.s === 'final'} saw ${[...seen]} errors=${page.errors.length} ${((Date.now() - t0) / 1000).toFixed(0)}s`;
  await page.context().close();
  return { ok, msg };
}

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
async function golden(browser, baseUrl, newUrl, cases, strip) {
  let same = 0; const bad = [], errs = [];
  for (const [mode, seed] of cases) {
    const res = [];
    for (const url of [baseUrl, newUrl]) {
      const p = await L.newPage(browser, url, { init: `${MULBERRY}(${seed})` });
      let r = await p.evaluate(script(mode)); if (strip) r = { log: r.log, final: { winner: r.final.winner, cleared: r.final.cleared, victory: r.final.victory } };
      res.push(JSON.stringify(r)); errs.push(...p.errors); await p.context().close();
    }
    if (res[0] === res[1]) same++; else bad.push(mode + seed);
  }
  return { same, total: cases.length, bad, errs: errs.length };
}

async function run(browser) {
  const t0 = Date.now();
  const [keys, touchG, g1, g2] = await Promise.all([
    Promise.all([['Digit1', 'solo'], ['Digit2', 'versus'], ['Digit3', 'coop']].map(([d, m]) => keyGame(browser, d, m))),
    touch.playByTouch(browser, 'iPhone 13 landscape', 'r1'),
    golden(browser, L.BASELINE1, L.URL1, [['versus', 3], ['coop', 4]], true),
    golden(browser, L.BASELINE2, L.URL, [['solo', 2], ['versus', 2], ['coop', 2]], false),
  ]);
  report('SMOKE-keys', keys.every(k => k.ok), 'real-key full games (?fast=1): ' + keys.map(k => k.msg).join(' | '));
  report('SMOKE-golden1', g1.same === g1.total && g1.errs === 0, `?rules=1 vs baseline-phase1 (versus seed 3, coop seed 4): ${g1.same}/${g1.total} identical${g1.bad.length ? ' DIFF ' + g1.bad : ''}, errors ${g1.errs}`);
  report('SMOKE-golden2', g2.same === g2.total && g2.errs === 0, `rules 2 vs baseline-phase2 (solo/versus/coop seed 2): ${g2.same}/${g2.total} identical${g2.bad.length ? ' DIFF ' + g2.bad : ''}, errors ${g2.errs}`);
  report('SMOKE-touch', touchG.ok, 'touch-only solo game: ' + touchG.msg);
  await touch.t17(browser);   // tap guard (real taps 150/400 ms apart, play-again, menu double tap)
  console.log(`smoke body: ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
module.exports = { run };
