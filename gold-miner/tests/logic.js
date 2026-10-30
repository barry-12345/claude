// Logic-level acceptance tests (driven through window.__game): AC-01..04, 12..20.
const L = require('./lib');
const { report } = L;
const fs = require('fs');

const MULBERRY = `(seed => { window.Math.random = function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })`;

const REQUIRED_HOOKS = 'G, ITEMS, TARGETS, COOP_TARGETS, SHOP, HOOK, FAST, LEGEND_PAGES, Snd, press, advance, generateLevel, levelWorth, hookTip, endRound, makeItem, explodeTNT, startGame, startRound, selectKey, reshuffle, spawnMeteor, tugPress, resolveTug, startTug, rollEvent, slabState, ventState, slabBlocks, plumeAt, burnHook, occFor, CHARS, EVENTS, THEMES, themeOf, pauseGame, resumeGame, loadBest, saveBest, deliver, finishGame, afterResults, shopAction, openShop, curTarget'.split(/,\s*/);
const NEW_HOOKS = 'reseed, startMode, SOLO_TARGETS, STAR_MULT, MENU_ORDER, PIVOT_Y, W, H, isSolo, starsFor, loadSoloBest, saveSoloBest, targets'.split(/,\s*/);

async function run(browser) {
  // ---------------- AC-02 hooks ----------------
  {
    const page = await L.newPage(browser, L.URL1);
    const keys = await page.evaluate(() => Object.keys(window.__game));
    const missingOld = REQUIRED_HOOKS.filter(k => !keys.includes(k)), missingNew = NEW_HOOKS.filter(k => !keys.includes(k));
    report('AC-02', !missingOld.length && !missingNew.length, `${REQUIRED_HOOKS.length} old + ${NEW_HOOKS.length} new members present; missing old=[${missingOld}] new=[${missingNew}]`);
    await page.context().close();
  }

  // ---------------- AC-04 numbers unchanged ----------------
  {
    const grab = () => { const g = window.__game; return JSON.stringify({ T: g.TARGETS, C: g.COOP_TARGETS, I: g.ITEMS, S: g.SHOP, CH: g.CHARS, E: g.EVENTS, TH: g.THEMES, HOOK: g.HOOK, LP: g.LEGEND_PAGES }); };
    const a = await L.newPage(browser, L.BASELINE), b = await L.newPage(browser, L.URL1);
    const sa = await a.evaluate(grab), sb = await b.evaluate(grab);
    // coop record read/write: same seeded coop game in both builds must write identical coopBest and leave soloBest alone
    const coopGame = `(() => { window.__sentinel = 1; const g = window.__game, G = g.G; ${MULBERRY}(7); G.mode = 'coop'; G.chars = [1, 4]; g.startGame(); let n = 0;
      while (G.screen !== 'final' && n++ < 200000) { if (G.screen === 'play') { for (const p of G.players) if (p.alive && p.hook.state === 'swing' && Math.floor(G.playT * 60) % 47 === p.id * 13) g.press(p.cfg.keys.fire); }
        else if (G.screen === 'results' && G.resultsT > 0.5) g.press('Space'); else if (G.screen === 'shop' && G.t - G.shopStartT > 0.3) { g.press('KeyS'); g.press('KeyW'); g.press('ArrowUp'); } g.advance(1 / 60); }
      return [localStorage.getItem('goldminer.coopBest'), localStorage.getItem('goldminer.soloBest')]; })()`;
    const ca = await a.evaluate(coopGame), cb = await b.evaluate(coopGame);
    const ok = sa === sb && ca[0] && ca[0] === cb[0] && cb[1] === null;
    report('AC-04', ok, `TARGETS/COOP_TARGETS/ITEMS/SHOP/CHARS/EVENTS/THEMES/HOOK deep-equal=${sa === sb}; coopBest identical=${ca[0] === cb[0]} (${cb[0]}); soloBest untouched=${cb[1] === null}`);
    await a.context().close(); await b.context().close();
  }

  // ---------------- AC-03 golden comparison ----------------
  {
    let same = 0, total = 0; const diffs = [];
    const script = (mode) => `(() => { const g = window.__game, G = g.G, STEP = 1 / 60;
      G.mode = ${JSON.stringify(mode)}; G.chars = [1, 4]; g.startGame();
      const log = []; let guard = 0;
      while (G.screen !== 'final' && guard++ < 60 * 60 * 30) {
        if (G.screen === 'play') { for (const p of G.players) if (p.alive && p.hook.state === 'swing' && Math.floor(G.playT * 60) % 47 === p.id * 13) g.press(p.cfg.keys.fire); }
        else if (G.screen === 'results' && G.resultsT > 0.5) { log.push(G.players.map(p => p.money).concat([G.teamMoney])); g.press('Space'); }
        else if (G.screen === 'shop' && G.t - G.shopStartT > 0.3) { g.press('KeyS'); g.press('KeyW'); g.press('ArrowUp'); }
        g.advance(STEP);
      }
      return { log, final: G.final }; })()`;
    let rounds = 0;
    for (const mode of ['versus', 'coop']) for (let seed = 1; seed <= 10; seed++) {
      const res = [];
      for (const url of [L.BASELINE, L.URL1]) {
        const page = await L.newPage(browser, url, { init: `${MULBERRY}(${seed})` });
        res.push(await page.evaluate(script(mode)));
        await page.context().close();
      }
      const key = r => JSON.stringify(r.log) + '|' + [r.final.winner, r.final.cleared, r.final.victory].join(',');
      total++; rounds += res[1].log.length;
      if (key(res[0]) === key(res[1])) same++;   // winner / cleared / victory (phase 2 added scores+version to G.final, which the old build lacks) else diffs.push(mode + seed);
    }
    report('AC-03', same === total, `${same}/${total} byte-identical (versus+coop x seeds 1-10, ${rounds} round results compared)${diffs.length ? ' DIFF: ' + diffs : ''}`);
  }

  // ---------------- AC-01 stability, three modes x seeds 1-20 ----------------
  {
    const page = await L.newPage(browser, L.URL1);
    await page.evaluate(L.BOT_SRC);
    const res = {};
    for (const mode of ['solo', 'versus', 'coop']) {
      let reached = 0;
      const out = await page.evaluate(({ mode }) => { const r = []; for (let s = 1; s <= 20; s++) { const o = window.__bot({ seed: s, mode, bot: 'skilled' }); r.push(o.screen === 'final'); } return r; }, { mode });
      reached = out.filter(Boolean).length; res[mode] = reached;
    }
    const ok = page.errors.length === 0 && Object.values(res).every(v => v === 20);
    report('AC-01', ok, `skilled bot, seeds 1-20: reached final solo=${res.solo}/20 versus=${res.versus}/20 coop=${res.coop}/20; pageerror+console.error=${page.errors.length}`);
    await page.context().close();
  }

  // ---------------- AC-13 starsFor ----------------
  {
    const page = await L.newPage(browser, L.URL1);
    const cases = [[1, 999, 999, 0], [1, 1000, 1000, 1], [1, 1499, 1499, 1], [1, 1500, 1500, 2], [1, 1999, 1999, 2], [1, 2000, 2000, 3], [1, 2500, 900, 0], [2, 1949, 2300, 1], [2, 1950, 2300, 2], [2, 2599, 3000, 2], [2, 2600, 3000, 3], [8, 6800, 17200, 3], [8, 5100, 17200, 2]];
    const got = await page.evaluate(cs => cs.map(c => window.__game.starsFor(c[0], c[1], c[2])), cases);
    const bad = cases.filter((c, i) => got[i] !== c[3]);
    report('AC-13', !bad.length, `${cases.length - bad.length}/${cases.length} boundary cases ok (first-round: 999/1000/1499/1500/1999/2000/2500@900 -> 0/1/1/2/2/3/0)${bad.length ? ' BAD ' + JSON.stringify(bad) : ''}`);
    await page.context().close();
  }

  // ---------------- AC-12 difficulty curve (+ AC-14 bot part) ----------------
  const botStats = {};
  {
    const page = await L.newPage(browser, L.URL1);
    await page.evaluate(L.BOT_SRC);
    for (const bot of ['random', 'novice', 'skilled', 'perfect']) {
      const r = await page.evaluate(({ bot }) => {
        const res = [];
        for (let s = 1; s <= 50; s++) { const o = window.__bot({ seed: s, mode: 'solo', bot }); res.push({ c: o.cleared, st: o.stars.reduce((a, b) => a + b, 0), v: o.final.victory, bolts: o.bolts, tug: o.tugSeen, assist: o.assistSeen, shop: o.shieldShop, dice: o.diceShield, screen: o.screen }); }
        return res;
      }, { bot });
      const n = r.length;
      botStats[bot] = { p1: r.filter(x => x.c >= 1).length / n, ge3: r.filter(x => x.c >= 3).length / n, ge5: r.filter(x => x.c >= 5).length / n, ge7: r.filter(x => x.c >= 7).length / n, full: r.filter(x => x.v).length / n, stars: r.reduce((a, x) => a + x.st, 0) / n,
        bolts: r.reduce((a, x) => a + x.bolts, 0), tug: r.some(x => x.tug), assist: r.some(x => x.assist), shop: r.reduce((a, x) => a + x.shop, 0), dice: r.reduce((a, x) => a + x.dice, 0), allFinal: r.every(x => x.screen === 'final') };
    }
    const B = botStats, f = v => (v * 100).toFixed(0) + '%';
    const okR = B.random.full <= 0.10 && B.random.ge3 <= 0.65;
    const okN = B.novice.p1 >= 0.85 && B.novice.full >= 0.30 && B.novice.full <= 0.80;
    const okS = B.skilled.full >= 0.90 && B.skilled.stars >= 11 && B.skilled.stars <= 19;
    const okP = B.perfect.full >= 0.95 && B.perfect.stars >= 15;
    report('AC-12', okR && okN && okS && okP, `seeds 1-50. random: full ${f(B.random.full)} (<=10%), >=3 cleared ${f(B.random.ge3)} (<=65%) | novice: R1 ${f(B.novice.p1)} (>=85%), full ${f(B.novice.full)} (30-80%) | skilled: full ${f(B.skilled.full)} (>=90%), avg stars ${B.skilled.stars.toFixed(2)} (11-19) | perfect: full ${f(B.perfect.full)} (>=95%), avg stars ${B.perfect.stars.toFixed(2)} (>=15)`);
    report('AC-14a', Object.values(B).every(b => b.bolts === 0 && !b.tug && !b.assist && b.shop === 0 && b.dice === 0) && Object.values(B).every(b => b.allFinal),
      `over ${4 * 50} bot games: bolt items=${Object.values(B).reduce((a, b) => a + b.bolts, 0)}, G.tug ever set=${Object.values(B).some(b => b.tug)}, hook tug/assist ever=${Object.values(B).some(b => b.assist)}, shield in a shop=${Object.values(B).reduce((a, b) => a + b.shop, 0)}, dice->shield=${Object.values(B).reduce((a, b) => a + b.dice, 0)}`);
    report('AC-12e', page.errors.length === 0, `errors during the 200 bot games: ${page.errors.length}`);
    await page.context().close();
  }

  // ---------------- AC-14b/15 level generation, shop contents ----------------
  {
    const page = await L.newPage(browser, L.URL1);
    const r = await page.evaluate(() => {
      const g = window.__game, G = g.G, TAN = Math.tan(66 * Math.PI / 180), out = { levels: 0, bolts: 0, unreachable: 0, items: 0, worthOk: 0, shield: 0, offersChecked: 0, diceShield: 0, diceDraws: 0, minRatio: 9 };
      for (let s = 1; s <= 50; s++) {
        g.reseed(s); g.startMode('solo', [0]);
        for (let r = 1; r <= 8; r++) {
          G.round = r; const hz = [];
          const items = g.generateLevel(r, G.players, hz);
          out.levels++;
          for (const it of items) { out.items++; if (it.type === 'bolt') out.bolts++; if (Math.abs(it.x - 640) > (it.y - 198) * TAN + 1e-6) out.unreachable++; }
          const th = g.themeOf(r), tg = g.SOLO_TARGETS, inc = tg[r - 1] - (tg[r - 2] || 0);
          const need = Math.max(1700, inc * 2.1 + 500) * (hz.length ? 1.15 : (th === 1 ? 1.1 : 1));
          const w = g.levelWorth(items); if (w >= need) out.worthOk++; out.minRatio = Math.min(out.minRatio, w / need);
        }
        // shops incl. rerolls
        const p = G.players[0];
        for (let r = 1; r <= 8; r++) {
          G.round = r; G.stars[r - 1] = r % 4; p.money = 1e6; g.openShop();
          const chk = () => { out.offersChecked++; if (G.shop[0].offers.some(o => o.id === 'shield')) out.shield++; };
          chk();
          for (let k = 0; k < 4; k++) { G.t += 1; g.shopAction(0, 'reroll'); chk(); }
        }
      }
      g.reseed(99); g.startMode('solo', [0]);
      for (let k = 0; k < 3000; k++) { G.players[0].pending.dice = true; g.startRound(); out.diceDraws++; if (G.players[0].diceGain === 'shield' || G.players[0].buffs.shield) out.diceShield++; }
      return out;
    });
    report('AC-14b', r.bolts === 0 && r.shield === 0 && r.diceShield === 0, `${r.levels} levels (${r.items} items): bolts=${r.bolts}; ${r.offersChecked} shop shelves (incl. 4 rerolls each): shield=${r.shield}; ${r.diceDraws} dice rolls: shield=${r.diceShield}`);
    report('AC-15', r.unreachable === 0 && r.worthOk / r.levels >= 0.95, `unreachable items=${r.unreachable}/${r.items}; levelWorth >= need in ${r.worthOk}/${r.levels} levels (${(100 * r.worthOk / r.levels).toFixed(1)}%), min worth/need=${r.minRatio.toFixed(2)}`);
    report('AC-15e', page.errors.length === 0, `errors: ${page.errors.length}`);
    await page.context().close();
  }

  // ---------------- AC-16 star rewards ----------------
  {
    const page = await L.newPage(browser, L.URL1);
    const r = await page.evaluate(() => {
      const g = window.__game, G = g.G, res = [];
      for (const [stars, mult, dynPlus] of [[3, 0.8, 1], [2, 0.9, 0], [1, 1, 0], [0, 1, 0]]) {
        g.reseed(5); g.startMode('solo', [0]);
        const p = G.players[0], target = g.SOLO_TARGETS[0];
        // force the round result through the real endRound path
        p.roundStart = 0; p.money = stars === 0 ? target - 1 : stars === 1 ? target : stars === 2 ? 1500 : 2000; p.roundGain = p.money; p.medal = stars === 0;
        g.endRound(); const got = G.results[0].stars;
        const dyn0 = p.dyn; g.afterResults();
        const s = G.shop[0], rs = (stars === 0) ? 'saved' : '';
        res.push({ stars, got, screen: G.screen, mult, ok: s.offers.every(o => o.price === Math.round(o.basePrice * mult / 5) * 5), n: s.offers.length, disc: s.discount, dyn: p.dyn - dyn0, dynPlus, rs });
      }
      return res;
    });
    const ok = r.every(x => x.got === x.stars && x.screen === 'shop' && x.ok && x.n === 6 && x.disc === x.mult && x.dyn === x.dynPlus);
    report('AC-16', ok, r.map(x => `${x.stars}* -> discount x${x.disc}, prices ok=${x.ok}, dynamite +${x.dyn}, goods=${x.n}`).join(' | '));
    await page.context().close();
  }

  // ---------------- AC-17 refresh shelf ----------------
  {
    const page = await L.newPage(browser, L.URL1);
    const r = await page.evaluate(() => {
      const g = window.__game, G = g.G, out = {};
      const setup = (stars, money) => { g.reseed(11); g.startMode('solo', [0]); G.round = 2; g.startRound(); const p = G.players[0]; p.money = money; G.stars[2] = stars; g.openShop(); G.t += 1; return p; };
      // exact prices at 1 star (no discount), then the 0.9 discount rounding
      let p = setup(1, 5000); let s = G.shop[0];
      const base = 30 + 15 * G.round;
      out.round = G.round; out.idx = s.rerollIdx; out.idxOk = s.rerollIdx === 6;
      s.sel = s.rerollIdx; const m0 = p.money, p0 = s.rerollPrice;
      g.press('KeyS');
      out.d1 = m0 - p.money; out.p0 = p0; out.expect1 = base; out.rerolls = s.rerolls; out.p1 = s.rerollPrice; out.offers = s.offers.length;
      p = setup(2, 5000); s = G.shop[0]; s.sel = s.rerollIdx; const m1 = p.money; g.press('KeyS');
      out.d2 = m1 - p.money; out.expect2 = Math.round(base * 0.9 / 5) * 5; out.p2 = s.rerollPrice; out.expect2b = Math.round((base + 30) * 0.9 / 5) * 5;
      // purchased boost never comes back
      p = setup(1, 1e6); s = G.shop[0];
      const pick = s.offers.findIndex(o => !g.SHOP[o.id].stack && !g.SHOP[o.id].special);
      const bought = s.offers[pick].id; s.sel = pick; g.press('KeyS'); out.bought = bought; out.pending = !!p.pending[g.SHOP[bought].buff];
      let again = 0; for (let k = 0; k < 40; k++) { G.shop[0].sel = G.shop[0].rerollIdx; g.press('KeyS'); if (G.shop[0].offers.some(o => o.id === bought)) again++; if (G.shop[0].offers.length !== 6) out.badN = (out.badN || 0) + 1; }
      out.again = again; out.stillPending = !!p.pending[g.SHOP[bought].buff];
      // not enough money
      p = setup(1, 10); s = G.shop[0]; s.sel = s.rerollIdx; g.press('KeyS');
      out.poorMoney = p.money; out.poorMsg = s.msg; out.poorT = s.msgT; out.poorRerolls = s.rerolls;
      return out;
    });
    const ok = r.idxOk && r.d1 === r.expect1 && r.rerolls === 1 && r.p1 - r.p0 === 30 && r.offers === 6 && r.d2 === r.expect2 && r.p2 === r.expect2b && !r.again && r.pending && r.stillPending && !r.badN && r.poorMoney === 10 && r.poorMsg === '金币不足!' && r.poorT > 0 && r.poorRerolls === 0;
    report('AC-17', ok, `round ${r.round}: rerollIdx=${r.idx}; 1 star: paid ${r.d1} (expected ${r.expect1}), rerolls=${r.rerolls}, price ${r.p0}->${r.p1} (+${r.p1 - r.p0}), 6 goods=${r.offers === 6}; 2 stars: paid ${r.d2} (expected ${r.expect2}), next ${r.p2} (expected ${r.expect2b}); bought "${r.bought}" reappeared ${r.again}/40 rerolls, boost kept=${r.stillPending}; poor: money ${r.poorMoney}, msg "${r.poorMsg}"`);
    await page.context().close();
  }

  // ---------------- AC-18 failure / medal ----------------
  {
    const page = await L.newPage(browser, L.URL1);
    const r = await page.evaluate(() => {
      const g = window.__game, G = g.G, out = {};
      for (const medal of [false, true]) {
        g.reseed(3); g.startMode('solo', [0]); G.round = 1; g.startRound(); G.screen = 'play';
        const p = G.players[0]; p.medal = medal; p.roundStart = 1000; p.money = g.SOLO_TARGETS[1] - 1; p.roundGain = 1299;
        g.endRound(); const r0 = G.results[0]; g.afterResults();
        out[medal ? 'medal' : 'none'] = { round: G.round, passed: r0.passed, saved: r0.saved, stars: r0.stars, medalLeft: p.medal, screen: G.screen, final: G.final && G.final.victory };
      }
      return out;
    });
    const a = r.none, b = r.medal;
    report('AC-18', a.round === 2 && !a.passed && !a.saved && a.screen === 'final' && a.final === false && b.saved && b.stars === 0 && !b.medalLeft && b.screen === 'shop',
      `round 2, money target-1: no medal -> passed=${a.passed} saved=${a.saved} screen=${a.screen}; with medal -> saved=${b.saved}, stars=${b.stars}, medal consumed=${!b.medalLeft}, screen=${b.screen}`);
    await page.context().close();
  }

  // ---------------- AC-19 records, AC-20 structure ----------------
  {
    const page = await L.newPage(browser, L.URL1);
    await page.evaluate(L.BOT_SRC);
    const r = await page.evaluate(() => {
      const g = window.__game, G = g.G, out = {};
      localStorage.clear(); localStorage.setItem('goldminer.coopBest', '{"cleared":5,"money":9999}');
      const viol = [];
      const hook = () => {
        if (G.players.length !== 1) viol.push('players=' + G.players.length);
        if (G.screen === 'shop' && G.shop.length !== 1) viol.push('shop=' + G.shop.length);
        if (G.screen === 'results' && G.stars.length !== G.round) viol.push(`stars ${G.stars.length} vs round ${G.round}`);
      };
      const o1 = window.__bot({ seed: 4, mode: 'solo', bot: 'skilled', hook });
      out.first = { newBest: o1.final.newBest, stored: localStorage.getItem('goldminer.soloBest'), round: o1.round, victory: o1.final.victory };
      const rec1 = JSON.parse(out.first.stored);
      out.first.fields = ['cleared', 'stars', 'money', 'char', 'perRound'].every(k => k in rec1); out.first.perLen = rec1.perRound.length;
      const o2 = window.__bot({ seed: 9, mode: 'solo', bot: 'random', hook });
      out.worse = { newBest: o2.final.newBest, same: localStorage.getItem('goldminer.soloBest') === out.first.stored, round: o2.round, perLen: o2.final.best ? null : null, victory: o2.final.victory, cleared: o2.final.cleared };
      // perRound of the failed run: replay it and look at what finishGame would have saved (record compare path)
      localStorage.clear(); localStorage.setItem('goldminer.coopBest', '{"cleared":5,"money":9999}'); const o3 = window.__bot({ seed: 9, mode: 'solo', bot: 'random', hook });
      const rec3 = JSON.parse(localStorage.getItem('goldminer.soloBest'));
      out.fail = { round: o3.round, perLen: rec3.perRound.length, last: rec3.perRound[rec3.perRound.length - 1], target: g.SOLO_TARGETS[o3.round - 1], newBest: o3.final.newBest, victory: o3.final.victory };
      // a clearly better run replaces the record
      const o4 = window.__bot({ seed: 4, mode: 'solo', bot: 'perfect', hook });
      out.better = { newBest: o4.final.newBest, rec: JSON.parse(localStorage.getItem('goldminer.soloBest')).stars };
      out.coop = localStorage.getItem('goldminer.coopBest'); out.viol = viol.length; out.violSample = viol.slice(0, 3);
      return out;
    });
    report('AC-19', r.first.newBest === true && r.first.fields && r.first.perLen === r.first.round && !r.worse.newBest && r.worse.same && r.fail.perLen === r.fail.round && r.fail.last < r.fail.target && r.better.newBest && r.coop === '{"cleared":5,"money":9999}',
      `1st game newBest=${r.first.newBest} fields ok=${r.first.fields} perRound.length=${r.first.perLen}==G.round ${r.first.round}; worse game newBest=${r.worse.newBest}, record unchanged=${r.worse.same}; failed run perRound.length=${r.fail.perLen}==round ${r.fail.round} (last cumulative ${r.fail.last} < target ${r.fail.target}); better run replaces=${r.better.newBest}; coopBest untouched=${r.coop === '{"cleared":5,"money":9999}'}`);
    report('AC-20', r.viol === 0, `players.length==1, shop.length==1, stars.length==round (at results) held on every frame of 3 full games; violations=${r.viol} ${r.violSample}`);
    report('AC-19e', page.errors.length === 0, `errors: ${page.errors.length}`);
    await page.context().close();
  }
}
module.exports = { run };
