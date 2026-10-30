// AC-21: seven 1280x720 screenshots (plus a few extras) of the single-player screens.
const L = require('./lib');
const fs = require('fs'), path = require('path');
const { report } = L;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const G = (page, fn, arg) => page.evaluate(fn, arg);
const wait = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 30 });

// a believable earlier best run, so the menu card, HUD flag and "纪录同期" lines have something to show
const REC = JSON.stringify({ cleared: 7, stars: 13, money: 15620, char: 1, perRound: [1480, 2900, 4300, 6400, 8700, 11300, 14200] });
const REC_LOW = JSON.stringify({ cleared: 5, stars: 7, money: 6100, char: 0, perRound: [1100, 2400, 4000, 5000, 6100] });

async function shot(page, name) {
  const f = path.join(L.SHOTS, name);
  await page.screenshot({ path: f });
  return f;
}

async function run(browser) {
  fs.mkdirSync(L.SHOTS, { recursive: true });
  const files = [];
  // ----- 1-6: one winning run (perfect bot, seed 1) -----
  {
    const page = await L.newPage(browser, L.URL1 + '&seed=1', { init: `localStorage.setItem('goldminer.soloBest', ${JSON.stringify(REC_LOW)})` });
    const kb = page.keyboard;
    await kb.press('Digit1'); await sleep(450);
    files.push(await shot(page, '01-menu.png'));
    await kb.press('Digit2'); await sleep(250); files.push(await shot(page, 'x1-menu-versus.png'));
    await kb.press('Digit1'); await kb.press('Space'); await kb.press('ArrowRight'); await kb.press('ArrowRight'); await sleep(450);
    files.push(await shot(page, '02-select.png'));
    await kb.press('ArrowDown');
    await wait(page, () => __game.G.screen === 'intro', null, 5000); await sleep(1300);
    files.push(await shot(page, 'x2-intro.png'));
    await wait(page, () => __game.G.screen === 'play', null, 5000);
    await page.evaluate(L.BOT_SRC);
    await G(page, () => { __game.G.noFireT = 0; return window.__botUntil('perfect', () => __game.G.screen === 'play' && __game.G.playT > 21); });
    await sleep(120);
    files.push(await shot(page, '03-play.png'));
    await G(page, () => window.__botUntil('perfect', () => __game.G.screen === 'results'));
    await G(page, () => __game.advance(2.2)); await sleep(80);
    files.push(await shot(page, '04-results.png'));
    await kb.press('Space');
    await wait(page, () => __game.G.screen === 'shop' && __game.G.t - __game.G.shopStartT > 0.4, null, 5000);
    await kb.press('ArrowRight'); await kb.press('ArrowRight'); await kb.press('ArrowRight'); await kb.press('ArrowRight'); await kb.press('ArrowRight'); await kb.press('ArrowRight');
    await sleep(120);
    files.push(await shot(page, '05-shop.png'));
    await G(page, () => { const G = __game.G; G.shop[0].sel = 1; });
    await kb.press('ArrowDown'); await sleep(120); await kb.press('ArrowRight'); await kb.press('ArrowRight'); await kb.press('ArrowRight'); await kb.press('ArrowRight'); await kb.press('ArrowRight');
    await sleep(150);
    files.push(await shot(page, 'x3-shop-reroll.png'));
    await kb.press('ArrowUp');
    await G(page, () => window.__botUntil('perfect', () => false));
    await G(page, () => __game.advance(0.5)); await sleep(80);
    files.push(await shot(page, '06-final-win.png'));
    report('AC-21a', page.errors.length === 0, `winning run to final: errors=${page.errors.length}`);
    await page.context().close();
  }
  // ----- 7: a failed run -----
  {
    const page = await L.newPage(browser, L.URL1 + '&seed=9', { init: `localStorage.setItem('goldminer.soloBest', ${JSON.stringify(REC)})` });
    const kb = page.keyboard;
    await kb.press('Digit1'); await kb.press('Space'); await kb.press('ArrowRight'); await kb.press('ArrowDown');
    await wait(page, () => __game.G.screen === 'play', null, 8000);
    await page.evaluate(L.BOT_SRC);
    await G(page, () => window.__botUntil('random', () => false));
    await G(page, () => __game.advance(0.5)); await sleep(80);
    files.push(await shot(page, '07-final-fail.png'));
    const fin = await G(page, () => ({ v: __game.G.final.victory, cleared: __game.G.final.cleared, round: __game.G.round }));
    report('AC-21b', page.errors.length === 0 && !fin.v, `failed run: cleared ${fin.cleared}, ended in round ${fin.round}, errors=${page.errors.length}`);
    await page.context().close();
  }
  const sizes = files.map(f => `${path.basename(f)}:${(fs.statSync(f).size / 1024).toFixed(0)}KB`);
  report('AC-21', ['01-menu', '02-select', '03-play', '04-results', '05-shop', '06-final-win', '07-final-fail'].every(n => fs.existsSync(path.join(L.SHOTS, n + '.png'))), `${files.length} screenshots written to screenshots/ (1280x720): ${sizes.join(', ')} -- visually reviewed by hand, see report`);
}
module.exports = { run };
