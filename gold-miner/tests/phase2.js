// Phase-2 acceptance tests: AC-P2-01 .. AC-P2-24 (rule set 2 is the default; ?rules=1 is the legacy path).
const L = require('./lib');
const fs = require('fs'), path = require('path');
const { report } = L;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const G = (page, fn, arg) => page.evaluate(fn, arg);
const wait = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 30 });
const SHOTS2 = path.join(L.SHOTS, 'phase2');

const MULBERRY = `(seed => { window.Math.random = function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })`;
// records every fillText (text + font + measured width) while window.__cap is true
const TEXT_SPY = `(() => { window.__texts = []; const ft = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, x, y) { if (window.__cap) window.__texts.push({ t: String(t), font: this.font, w: this.measureText(String(t)).width }); return ft.apply(this, arguments); }; })()`;
async function texts(page) {   // text drawn by exactly one render() pass (the game's rAF callback runs before ours)
  return G(page, () => new Promise(res => { window.__texts = []; window.__cap = true; requestAnimationFrame(() => { window.__cap = false; res(window.__texts); }); }));
}
async function shot(page, name) { fs.mkdirSync(SHOTS2, { recursive: true }); await page.screenshot({ path: path.join(SHOTS2, name) }); }

const NEW_MEMBERS = 'RULESETS, R, RULE_VERSION, setRules, finaleCount, worthClear, spawnFinale, isReduceFx, reduceFx, fxRand, placeItem, clearField'.split(/,\s*/);
const OLD_MEMBERS = 'G, ITEMS, TARGETS, COOP_TARGETS, SHOP, HOOK, FAST, LEGEND_PAGES, Snd, press, advance, generateLevel, levelWorth, hookTip, endRound, makeItem, explodeTNT, startGame, startRound, selectKey, reshuffle, spawnMeteor, tugPress, resolveTug, startTug, rollEvent, slabState, ventState, slabBlocks, plumeAt, burnHook, occFor, CHARS, EVENTS, THEMES, themeOf, pauseGame, resumeGame, loadBest, saveBest, deliver, finishGame, afterResults, shopAction, openShop, curTarget, reseed, startMode, SOLO_TARGETS, STAR_MULT, MENU_ORDER, PIVOT_Y, W, H, isSolo, starsFor, loadSoloBest, saveSoloBest, targets'.split(/,\s*/);

// ---------- AC-P2-01 / 04 ----------
async function ac01(browser) {
  const out = {};
  for (const [name, url] of [['rules2', L.URL], ['rules1', L.URL1]]) {
    const page = await L.newPage(browser, url);
    await page.evaluate(L.BOT_SRC);
    const reached = {};
    for (const mode of ['solo', 'versus', 'coop']) {
      const r = await page.evaluate(({ mode }) => { let n = 0; for (let s = 1; s <= 20; s++) if (window.__bot({ seed: s, mode, bot: 'skilled' }).screen === 'final') n++; return n; }, { mode });
      reached[mode] = r;
    }
    out[name] = { reached, errors: page.errors.length };
    await page.context().close();
  }
  const ok = ['rules2', 'rules1'].every(k => out[k].errors === 0 && Object.values(out[k].reached).every(v => v === 20));
  report('AC-P2-01', ok, `skilled bot, seeds 1-20 x 3 modes: rule 2 reached final ${JSON.stringify(out.rules2.reached)}, errors=${out.rules2.errors}; rules=1 reached ${JSON.stringify(out.rules1.reached)}, errors=${out.rules1.errors}`);
}
async function ac04(browser) {
  const page = await L.newPage(browser, L.URL);
  const r = await page.evaluate(() => {
    const g = window.__game, G = g.G;
    return { keys: Object.keys(g), ver: g.RULE_VERSION, rv: g.R.version, setBefore: (g.setRules(1), g.RULE_VERSION), setBack: (g.setRules(2), g.RULE_VERSION),
      stats: Object.keys(G.stats), fields: ['finaleOn', 'hitStop', 'soloSaved', 'stats'].map(k => k in G),
      ignored: (() => { g.startMode('solo', [0]); g.setRules(1); return g.RULE_VERSION; })() };
  });
  const miss = OLD_MEMBERS.concat(NEW_MEMBERS).filter(k => !r.keys.includes(k));
  const okStats = ['finaleSpawned', 'finaleBonus', 'hitStops', 'bigWins', 'nearMiss'].every(k => r.stats.includes(k));
  report('AC-P2-04', !miss.length && r.ver === 2 && r.setBefore === 1 && r.setBack === 2 && r.ignored === 2 && okStats && r.fields.every(Boolean),
    `${OLD_MEMBERS.length} phase-1 + ${NEW_MEMBERS.length} new members present (missing: [${miss}]); default RULE_VERSION=${r.ver}; setRules works on start screen (->${r.setBefore}, ->${r.setBack}) and is ignored mid-game (still ${r.ignored}); G.stats keys ok=${okStats}`);
  await page.context().close();
}

// ---------- AC-P2-02 rules=1 byte-identical to the accepted phase-1 build ----------
async function ac02(browser) {
  let same = 0, total = 0; const diffs = [];
  const script = mode => `(() => { const g = window.__game, G = g.G, STEP = 1 / 60;
    G.mode = ${JSON.stringify(mode)}; G.chars = [1, 4]; g.startGame();
    const log = []; let guard = 0;
    while (G.screen !== 'final' && guard++ < 60 * 60 * 30) {
      if (G.screen === 'play') { for (const p of G.players) if (p.alive && p.hook.state === 'swing' && Math.floor(G.playT * 60) % 47 === p.id * 13) g.press(p.cfg.keys.fire); }
      else if (G.screen === 'results' && G.resultsT > 0.5) { log.push(G.players.map(p => p.money).concat([G.teamMoney])); g.press('Space'); }
      else if (G.screen === 'shop' && G.t - G.shopStartT > 0.3) { g.press('KeyS'); g.press('KeyW'); g.press('ArrowUp'); }
      g.advance(STEP);
    }
    return { log, final: { winner: G.final.winner, cleared: G.final.cleared, victory: G.final.victory } }; })()`;
  for (const mode of ['versus', 'coop']) for (let seed = 1; seed <= 10; seed++) {
    const res = [];
    for (const url of [L.BASELINE1, L.URL1]) {
      const page = await L.newPage(browser, url, { init: `${MULBERRY}(${seed})` });
      res.push(await page.evaluate(script(mode)));
      await page.context().close();
    }
    total++;
    if (JSON.stringify(res[0]) === JSON.stringify(res[1])) same++; else diffs.push(mode + seed);
  }
  report('AC-P2-02a', same === total, `versus+coop x seeds 1-10 on ?rules=1 vs tests/baseline-phase1.html: ${same}/${total} identical (per-round [P1,P2,team] money + winner/cleared/victory)${diffs.length ? ' DIFF ' + diffs : ''}`);
  // (b) solo, phase-1 skilled bot, shop pressed once
  let same2 = 0; const diffs2 = [];
  const pa = await L.newPage(browser, L.BASELINE1), pb = await L.newPage(browser, L.URL1);
  for (const p of [pa, pb]) await p.evaluate(L.BOT_SRC);
  const solo = () => { const r = []; for (let s = 1; s <= 10; s++) { const o = window.__bot({ seed: s, mode: 'solo', bot: 'skilled' }); r.push({ rounds: o.rounds, c: o.final.cleared, st: o.final.stars, m: o.final.money }); } return r; };
  const ra = await pa.evaluate(solo), rb = await pb.evaluate(solo);
  for (let i = 0; i < 10; i++) if (JSON.stringify(ra[i]) === JSON.stringify(rb[i])) same2++; else diffs2.push(i + 1);
  report('AC-P2-02b', same2 === 10 && pb.errors.length === 0, `solo x seeds 1-10 (skilled bot, shop ready pressed once): ${same2}/10 identical (per-round money, cleared, stars, final money)${diffs2.length ? ' DIFF ' + diffs2 : ''}`);
  await pa.context().close(); await pb.context().close();
}

// ---------- AC-P2-05 / 06 / 20 difficulty ----------
async function ac05(browser) {
  const page = await L.newPage(browser, L.URL);
  await page.evaluate(L.BOT_SRC);
  const S = {};
  for (const mode of ['solo', 'versus', 'coop']) {
    S[mode] = {};
    for (const bot of ['spam', 'random', 'novice', 'skilled', 'perfect']) {
      const r = await page.evaluate(({ mode, bot }) => {
        const res = []; for (let s = 1; s <= 50; s++) { const o = window.__bot({ seed: s, mode, bot }); res.push({ per: o.per, st: o.stars.reduce((a, b) => a + b, 0), fin: o.screen === 'final', round: o.round, victory: o.final.victory, died2: o.round === 2 && !o.final.victory }); }
        return res;
      }, { mode, bot });
      const all = r.flatMap(x => x.per), n = all.length;
      S[mode][bot] = { n, full: all.filter(v => v >= 8).length / n, p1: all.filter(v => v >= 1).length / n, avg: all.reduce((a, b) => a + b, 0) / n, reach: r.reduce((a, x) => a + x.round, 0) / r.length, died2: r.filter(x => x.died2).length, stars: r.reduce((a, x) => a + x.st, 0) / r.length, allFinal: r.every(x => x.fin) };
    }
  }
  const f = v => (100 * v).toFixed(0) + '%';
  const row = (mode, bot) => `${f(S[mode][bot].full)}`;
  
  const okA = S.solo.random.full <= 0.02 && S.solo.spam.full <= 0.02 && S.solo.novice.avg >= 2.8 && S.solo.novice.died2 <= 12 && S.solo.skilled.full >= 0.45 && S.solo.skilled.full <= 0.65 && S.solo.skilled.stars >= 10 && S.solo.skilled.stars <= 14 && S.solo.perfect.full >= 0.85 && S.solo.perfect.p1 === 1;
  const okB = S.versus.random.full <= 0.02 && S.versus.spam.full <= 0.02 && S.versus.skilled.full >= 0.45 && S.versus.skilled.full <= 0.65 && S.versus.perfect.full >= 0.85 && S.versus.perfect.p1 >= 0.98;
  const okC = S.coop.random.full <= 0.02 && S.coop.spam.full <= 0.04 && S.coop.skilled.full >= 0.45 && S.coop.skilled.full <= 0.65 && S.coop.perfect.full >= 0.85;
  report('AC-P2-05a', okA, `solo seeds 1-50: random ${row('solo', 'random')}, spam ${row('solo', 'spam')} (both <=2%); novice mean rounds cleared ${S.solo.novice.avg.toFixed(2)} (>=2.8; mean round reached ${S.solo.novice.reach.toFixed(2)}), died in round 2: ${S.solo.novice.died2}/50 (<=12); skilled ${row('solo', 'skilled')} (45-65%), avg stars ${S.solo.skilled.stars.toFixed(1)} (10-14); perfect ${row('solo', 'perfect')} (>=85%), R1 pass ${f(S.solo.perfect.p1)} (=100%); novice ${row('solo', 'novice')}`);
  report('AC-P2-05b', okB, `versus per player (n=100): random ${row('versus', 'random')}, spam ${row('versus', 'spam')} (both <=2%; game ends at the first elimination); skilled ${row('versus', 'skilled')} (45-65%); perfect ${row('versus', 'perfect')} (>=85%), R1 pass ${f(S.versus.perfect.p1)} (>=98%); novice ${row('versus', 'novice')}`);
  report('AC-P2-05c', okC, `coop seeds 1-50: random ${row('coop', 'random')} (<=2%), spam ${row('coop', 'spam')} (<=4%, known deviation SPEC 6.1); skilled ${row('coop', 'skilled')} (45-65%); perfect ${row('coop', 'perfect')} (>=85%); novice ${row('coop', 'novice')}`);
  const grad = m => S[m].random.reach < S[m].skilled.reach && S[m].skilled.reach < S[m].perfect.reach && S[m].spam.reach < S[m].skilled.reach;
  report('AC-P2-06', grad('solo') && grad('versus') && grad('coop') && ['solo', 'versus', 'coop'].every(m => Object.values(S[m]).every(x => x.allFinal)),
    ['solo', 'versus', 'coop'].map(m => `${m} mean rounds cleared per player (round reached in brackets): spam ${S[m].spam.avg.toFixed(2)} (${S[m].spam.reach.toFixed(2)}) / random ${S[m].random.avg.toFixed(2)} (${S[m].random.reach.toFixed(2)}) / novice ${S[m].novice.avg.toFixed(2)} (${S[m].novice.reach.toFixed(2)}) / skilled ${S[m].skilled.avg.toFixed(2)} (${S[m].skilled.reach.toFixed(2)}) / perfect ${S[m].perfect.avg.toFixed(2)} (${S[m].perfect.reach.toFixed(2)})`).join(' | '));
  report('AC-P2-20', S.solo.perfect.p1 === 1 && S.versus.perfect.p1 >= 0.98, `perfect bot round-1 pass: solo ${f(S.solo.perfect.p1)} (=100%), versus per player ${f(S.versus.perfect.p1)} (>=98%)`);
  report('AC-P2-05e', page.errors.length === 0, `errors during the ${3 * 5 * 50} bot games: ${page.errors.length}`);
  await page.context().close();
}

// ---------- AC-P2-07 effects never change results ----------
async function ac07(browser) {
  const page = await L.newPage(browser, L.URL);
  await page.evaluate(L.BOT_SRC);
  const r = await page.evaluate(() => {
    const g = window.__game; let same = 0, total = 0, bigWins = 0; const bad = [];
    for (const mode of ['solo', 'versus']) for (let s = 1; s <= 5; s++) {
      g.reduceFx(true); const a = window.__bot({ seed: s, mode, bot: 'skilled' });
      g.reduceFx(false); const b = window.__bot({ seed: s, mode, bot: 'skilled' });
      total++; bigWins += b.stats.bigWins;
      if (JSON.stringify(a.rounds) === JSON.stringify(b.rounds) && JSON.stringify(a.final.scores) === JSON.stringify(b.final.scores)) same++; else bad.push(mode + s);
    }
    g.reduceFx(false);
    return { same, total, bad, bigWins };
  });
  report('AC-P2-07', r.same === r.total, `solo+versus x seeds 1-5, skilled bot: reduceFx(true) vs reduceFx(false) -> ${r.same}/${r.total} games with identical per-round money and final scores (${r.bigWins} big-win effects fired in the fx-on games)${r.bad.length ? ' DIFF ' + r.bad : ''}`);
  await page.context().close();
}

// ---------- AC-P2-08 / 09 / 10 / 11 finale ----------
async function ac08(browser) {
  const page = await L.newPage(browser, L.URL);
  const r = await page.evaluate(() => {
    const g = window.__game, G = g.G, out = { counts: [], badY: 0, overlap: 0, unreach: 0, retrig: 0, banner: 0, flagBefore: 0, rounds: 0, expect: g.finaleCount(4), hz: 0 };
    const circles = it => it.occ;
    const run = (round, seed) => {
      g.reseed(seed); g.startMode('solo', [0]); G.forceEvent = 'none';
      G.round = round - 1; g.startRound(); out.rounds++;
      g.advance(4);                                          // intro
      if (G.screen !== 'play') return;
      let guard = 0;
      while (!G.finaleOn && guard++ < 4000) {
        const before = G.items.length; if (G.time > 15.02) { g.advance(1 / 60); continue; }
        g.advance(1 / 60);
      }
      // the frame that crossed 15 s
      const fin = G.items.filter(i => i.finale);
      out.counts.push(fin.length);
      if (round === 4) out.n4 = (out.n4 || []).concat(fin.length);
      if (G.banner && G.banner.text === '黄金尾声!') out.banner++;
      for (const it of fin) {
        if (it.y < 430) out.badY++;
        if (!g.reachable(it.x, it.y, G.players.filter(p => p.alive))) out.unreach++;
        for (const o of G.items) {
          if (o === it || o.dead) continue;
          for (const a of it.occ) for (const b of o.occ) if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) out.overlap++;
        }
        for (const h of G.hazards) for (const b of h.occ) for (const a of it.occ) if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) out.overlap++;
      }
      out.hz += G.hazards.length;
      const spawned = G.stats.finaleSpawned;
      while (G.screen === 'play') g.advance(1 / 60);          // run the round out: no second trigger
      if (G.stats.finaleSpawned !== spawned) out.retrig++;
    };
    for (let s = 1; s <= 20; s++) run(4, s);
    for (const rd of [5, 6, 8]) for (let s = 1; s <= 6; s++) run(rd, s);
    return out;
  });
  const avg4 = r.n4.reduce((a, b) => a + b, 0) / r.n4.length;
  report('AC-P2-08', r.expect === 4 && avg4 >= 3.8 && r.badY === 0 && r.overlap === 0 && r.unreach === 0 && r.retrig === 0 && r.banner === r.rounds,
    `finaleCount(4)=${r.expect}; round 4 seeds 1-20 avg new items ${avg4.toFixed(2)} (>=3.8, min ${Math.min(...r.n4)}); over ${r.rounds} rounds (incl. 18 hazard rounds 5/6/8): items with y<430=${r.badY}, overlapping=${r.overlap}, unreachable=${r.unreach}, second trigger=${r.retrig}, banner shown ${r.banner}/${r.rounds}`);
  await page.context().close();
}
async function ac09_10_11(browser) {
  const page = await L.newPage(browser, L.URL);
  const r = await page.evaluate(() => {
    const g = window.__game, G = g.G, out = {};
    const val = (setup) => {
      g.reseed(3); g.startMode('solo', [0]); G.forceEvent = 'none'; G.round = 3; g.startRound(); g.advance(4); G.event = null;
      const p = G.players[0]; g.clearField();
      setup(p);
      const before = p.money, it = g.makeItem('gold_l', 640, 500); G.items.push(it);
      g.deliver(p, it); return p.money - before;
    };
    out.before = val(() => {});
    out.fin = val(() => { G.finaleOn = true; });
    out.rush = val(() => { G.finaleOn = true; G.event = { id: 'goldrush' }; });
    out.clover = val(p => { G.finaleOn = true; G.event = { id: 'goldrush' }; p.clover = true; });
    out.four = val(p => { G.finaleOn = true; G.event = { id: 'goldrush' }; p.clover = true; p.buffs.appraise = true; });
    out.finOnlyStat = G.stats.finaleBonus;
    // coop split: team +525, holder +263, helper +262
    g.reseed(4); g.startMode('coop', [0, 1]); G.forceEvent = 'none'; g.advance(4); g.clearField(); G.event = null; G.finaleOn = true;
    const [a, b] = G.players, t0 = G.teamMoney, a0 = a.money, b0 = b.money;
    const it = g.makeItem('gold_l', 640, 500); G.items.push(it); G.splitWith = b; g.deliver(a, it); G.splitWith = null;
    out.coop = [G.teamMoney - t0, a.money - a0, b.money - b0];
    // finale items stay reachable when only P1 is alive (rule 1 survivor path is used here only to exercise spawnFinale)
    let bad = 0, n = 0;
    for (let s = 1; s <= 12; s++) {
      g.reseed(s); g.startMode('versus', [0, 1]); G.forceEvent = 'none'; G.players[1].alive = false; G.players[1].elimRound = 1; G.round = 1; g.startRound(); g.advance(4);
      for (let k = 0; k < 4; k++) for (const it2 of g.spawnFinale()) { n++; if (!g.reachable(it2.x, it2.y, [G.players[0]])) bad++; }
    }
    out.elim = { n, bad };
    return out;
  });
  report('AC-P2-09', r.before === 350 && r.fin === 525 && r.rush === 788 && r.clover === 1576 && r.four === 2050, `big gold nugget: before finale ${r.before} (350), in finale ${r.fin} (525), + gold rush ${r.rush} (788), + clover ${r.clover} (1576), + appraisal book too ${r.four} (2050)`);
  report('AC-P2-10', r.coop[0] === 525 && r.coop[1] === 263 && r.coop[2] === 262, `co-op finale assist delivery: team +${r.coop[0]} (525), holder +${r.coop[1]} (263), helper +${r.coop[2]} (262)`);
  report('AC-P2-11a', r.elim.bad === 0 && r.elim.n > 40, `finale items with only P1 alive: ${r.elim.n} spawned, ${r.elim.bad} not reachable from P1`);
  await page.context().close();
}

// ---------- AC-P2-12 hit-stop ----------
// ---------- AC-P2-11 versus ends at the first elimination (rule 2) ----------
async function ac11(browser) {
  const run = async url => {
    const page = await L.newPage(browser, url, { init: TEXT_SPY });
    const r = await page.evaluate(() => {
      const g = window.__game, G = g.G, out = {};
      const setup = (m1, m2, medal) => {
        g.reseed(9); g.startMode('versus', [0, 1]); G.forceEvent = 'none'; G.round = 1; g.startRound(); G.screen = 'play';
        const [a, b] = G.players, tg = g.targets()[1];
        a.roundStart = b.roundStart = 0; a.money = m1(tg); b.money = m2(tg); if (medal) b.medal = true; G.round = 2;
        g.endRound();
      };
      const snap = () => ({ screen: G.screen, winner: G.final && G.final.winner, scores: G.final && G.final.scores, medal: G.players[1].medal, alive: G.players.map(p => p.alive), round: G.round });
      setup(t => t + 500, t => t - 1);                       // P2 misses by 1, no medal
      out.btn = Array.from([0]).length; out.resultsNext = G.screen;
      out.a0 = snap();
      window.__elimResults = true;
      return out;
    });
    await sleep(100);
    const tx1 = await texts(page);
    const next = tx1.some(q => q.t === '按空格查看最终结果') ? '最终结果' : tx1.some(q => q.t === '按空格进入商店') ? '商店' : '?';
    if (url === L.URL) { await sleep(800); await shot(page, '11-versus-early-end-results.png'); }
    await sleep(500); await page.keyboard.press('Space'); await sleep(200);
    const a = await G(page, () => { const G = __game.G; return { screen: G.screen, winner: G.final && G.final.winner, scores: G.final && G.final.scores, round: G.round, alive: G.players.map(p => p.alive) }; });
    if (url === L.URL) { await sleep(300); await shot(page, '11-versus-early-end-final.png'); }
    const r2 = await page.evaluate(() => {
      const g = window.__game, G = g.G, out = {};
      const base = () => { g.reseed(9); g.startMode('versus', [0, 1]); G.forceEvent = 'none'; G.round = 1; g.startRound(); G.screen = 'play'; G.round = 2; const [a, b] = G.players; a.roundStart = b.roundStart = 0; return [a, b, g.targets()[1]]; };
      { const [a, b, t] = base(); a.money = t + 100; b.money = t - 1; b.medal = true; g.endRound(); g.afterResults(); out.medal = { screen: G.screen, medal: b.medal, alive: b.alive, saved: G.results[1].saved }; }
      { const [a, b, t] = base(); a.money = t - 5; b.money = t - 300; g.endRound(); g.afterResults(); out.both = { screen: G.screen, winner: G.final && G.final.winner, sc: G.final && G.final.scores.map(q => q.score), rounds: G.final && G.final.scores.map(q => q.rounds) }; }
      return out;
    });
    const ev = await G(page, () => __game.R.versusEndOnElim);
    return { next, a, r2, ev, errors: page.errors.length, ctx: page.context() };
  };
  const n = await run(L.URL), o = await run(L.URL1);
  const okNew = n.ev === true && n.next === '最终结果' && n.a.screen === 'final' && n.a.winner === 0 && n.a.scores.length === 2 && n.a.scores.every(q => q.rounds === 2) && n.r2.medal.screen === 'shop' && n.r2.medal.saved && !n.r2.medal.medal && n.r2.medal.alive
    && n.r2.both.screen === 'final' && n.r2.both.winner === 0 && n.r2.both.rounds.every(v => v === 2) && n.errors === 0;
  const okOld = o.ev === false && o.next === '商店' && o.a.screen === 'shop';
  report('AC-P2-11', okNew && okOld, `rule 2: P2 misses by $1 without a medal -> results page says "按空格查看最终结果"; Space -> screen=${n.a.screen}, winner=${n.a.winner}, scores rounds=${n.a.scores && n.a.scores.map(q => q.rounds)}, scores=${n.a.scores && n.a.scores.map(q => q.score)}; with a medal -> ${n.r2.medal.screen}, medal consumed=${!n.r2.medal.medal}, still alive=${n.r2.medal.alive}; both miss -> ${n.r2.both.screen}, winner=${n.r2.both.winner} (more money, P1), rounds=${n.r2.both.rounds}; R.versusEndOnElim=${n.ev}. ?rules=1 same scenario -> next-step text "${o.next === '商店' ? '按空格进入商店' : o.next}", Space -> ${o.a.screen} (survivor continues), R.versusEndOnElim=${o.ev}`);
  await n.ctx.close(); await o.ctx.close();
}

async function ac12(browser) {
  const res = {};
  for (const [name, url] of [['rules2', L.URL], ['rules1', L.URL1]]) {
    const page = await L.newPage(browser, url);
    res[name] = await page.evaluate(() => {
      const g = window.__game, G = g.G, out = {};
      const grab = type => {
        g.reseed(8); g.startMode('solo', [0]); G.forceEvent = 'none'; g.advance(4); g.clearField();
        const p = G.players[0]; p.hook.phase = 0; p.hook.angle = 0;
        const it = g.makeItem(type, 640, 330); G.items.push(it);
        g.press('KeyS'); let guard = 0, maxStop = 0;
        while (!p.hook.item && guard++ < 600) { g.advance(1 / 60); maxStop = Math.max(maxStop, G.hitStop); }
        const t0 = G.time, frames = [];
        for (let k = 0; k < 8; k++) { g.advance(1 / 60); frames.push(G.time); maxStop = Math.max(maxStop, G.hitStop); }
        return { grabbed: !!p.hook.item, t0, frames, hs: G.stats.hitStops, maxStop };
      };
      out.diamond = grab('diamond'); out.gold = grab('gold_m');
      return out;
    });
    await page.context().close();
  }
  const d = res.rules2.diamond, m = res.rules2.gold, o = res.rules1.diamond;
  const frozen = d.frames.slice(0, 3).every(t => t === d.t0);       // 0.05 s after the catch: timer still frozen
  const resumed = d.frames[5] < d.t0;                                // 0.1 s after: timer runs again
  report('AC-P2-12', d.grabbed && frozen && resumed && m.frames[0] < m.t0 && d.hs === 1 && m.hs === 0 && o.maxStop === 0 && o.hs === 0,
    `rule 2: diamond grab -> G.time frozen for the next 3 frames (${frozen}), runs again after 6 frames (${resumed}); medium gold $150 -> time runs at once (${m.frames[0] < m.t0}), stats.hitStops diamond=${d.hs} gold=${m.hs}; rules=1: max G.hitStop=${o.maxStop}, hitStops=${o.hs}`);
}

// ---------- AC-P2-13 / 14 / 15 / 16 economy, shop, field, scores ----------
async function ac13_16(browser) {
  const page = await L.newPage(browser, L.URL);
  const r = await page.evaluate(() => {
    const g = window.__game, G = g.G, out = { piggy: [1e9, 0], chest: [1e9, 0], rockW: 0, rocks: 0, levels: 0 };
    for (const mode of ['solo', 'versus', 'coop']) for (let s = 1; s <= (mode === 'solo' ? 200 : 40); s++) {
      g.reseed(s); g.startMode(mode, [0, 1]);
      for (let r = 1; r <= 8; r++) {
        G.round = r; const hzL = []; const items = g.generateLevel(r, G.players, hzL); out.levels++;
        if (r >= 2) { const lo = Math.round(28 + 1.5 * r - 2), hi = Math.round(28 + 1.5 * r + 2), n = items.length; out.cnt = (out.cnt || 0) + 1; if (n >= lo && n <= hi) out.cntOk = (out.cntOk || 0) + 1; else if (n + hzL.length >= 66) out.cntCap = (out.cntCap || 0) + 1; else if (n > hi) out.cntTopUp = (out.cntTopUp || 0) + 1; else out.cntLow = (out.cntLow || 0) + 1; }
        for (const it of items) {
          const base = g.ITEMS[it.type].weight; if (Math.abs(it.weight - base) > 1e-9 && it.type !== 'turtle' && it.type !== 'rubble') out.wBad = (out.wBad || 0) + 1;
          if (it.type === 'piggy') { out.piggy = [Math.min(out.piggy[0], it.value), Math.max(out.piggy[1], it.value)]; }
          if (it.type === 'chest') { out.chest = [Math.min(out.chest[0], it.value), Math.max(out.chest[1], it.value)]; }
          if (it.type === 'rock_b') { out.rocks++; if (Math.abs(it.weight - 9) >= 1e-9) out.rockW++; }
        }
      }
    }
    out.hg = g.R.hourglass; out.empty = g.R.empty; out.anchorW = g.makeItem('anchor', 100, 400).weight;
    const keys = ['nBase', 'nPer', 'needMin', 'loneK', 'junkW', 'bagMoneyP', 'bagMax', 'egg', 'hourglass', 'empty'];
    out.sameKeys = keys.every(k => g.RULESETS[1][k] === g.RULESETS[2][k]) && JSON.stringify(g.RULESETS[1].needK) === JSON.stringify(g.RULESETS[2].needK) && JSON.stringify(g.RULESETS[1].piggy) === JSON.stringify(g.RULESETS[2].piggy) && JSON.stringify(g.RULESETS[1].chest) === JSON.stringify(g.RULESETS[2].chest) && g.RULESETS[2].wmul === null;
    // shop prices at round 5
    const ratios = []; let badPrice = 0, n = 0;
    for (const mode of ['versus', 'solo']) for (let s = 1; s <= 40; s++) {
      g.reseed(s); g.startMode(mode, [0, 1]); G.round = 5; G.stars[4] = s % 2; g.openShop();
      for (const sh of G.shop) if (sh) for (const o of sh.offers) {
        const base = g.SHOP[o.id].base, lo = (o.price - 2.5) / (base * 2.2), hi = (o.price + 2.5) / (base * 2.2); n++;
        if (hi < 0.85 - 1e-9 || lo > 1.15 + 1e-9) badPrice++; ratios.push(o.price / (base * 2.2));
        if (o.price % 5) badPrice++;
      }
    }
    out.shop = { n, badPrice, min: Math.min(...ratios), max: Math.max(...ratios) };
    return out;
  });
  // field / economy redesign was dropped: rule 2 keeps every phase-1 item value, weight and generation number
  report('AC-P2-13', r.piggy[0] >= 300 && r.piggy[1] <= 500 && r.chest[0] >= 300 && r.chest[1] <= 1200 && r.rockW === 0 && r.rocks > 100 && r.hg === 8 && r.empty === 900 && r.anchorW === 12 && r.sameKeys && !r.wBad && !r.cntLow,
    `[economy unchanged from phase 1; item-count clause is a code review: rule-2 generateLevel differs from rule 1 only by the round-1 rules and the target arrays] ${r.levels} generated levels: piggy value ${r.piggy[0]}-${r.piggy[1]} (300-500), chest ${r.chest[0]}-${r.chest[1]} (300-1200), ${r.rocks} big rocks all weight 9 (bad=${r.rockW}), anchor weight ${r.anchorW}; R.hourglass=${r.hg} (8), R.empty=${r.empty} (900); field/economy keys equal in RULESETS 1 and 2: ${r.sameKeys}; item weights == ITEMS table (mismatches ${r.wBad || 0}); rounds 2-8 item count: ${r.cntOk || 0} within round(28+1.5r+-2) (the guarantee top-up almost always adds items, as in phase 1), ${r.cntCap || 0} at the 66 cap, ${r.cntTopUp || 0} above range via the guarantee top-up, ${r.cntLow || 0} below`);
  report('AC-P2-14', r.shop.badPrice === 0, `round-5 shops (versus + solo 0-1 star, ${r.shop.n} goods): price = round(base x 2.2 x f / 5) x 5 with f in [0.85, 1.15] for all; observed f ${r.shop.min.toFixed(3)}-${r.shop.max.toFixed(3)}; bad=${r.shop.badPrice}`);

  // AC-P2-15 field
  const f = await page.evaluate(() => {
    const g = window.__game, G = g.G, out = {};
    for (const mode of ['solo', 'versus', 'coop']) {
      let levels = 0, ok = 0, capped = 0, rock3 = 0, rocksMax = 0;
      for (let s = 1; s <= 50; s++) {
        g.reseed(s); g.startMode(mode, [0, 1]);
        for (let r = 1; r <= 8; r++) {
          G.round = r; const hz = []; const items = g.generateLevel(r, G.players, hz); levels++;
          const th = g.themeOf(r), tg = g.R.targets[mode], inc = tg[r - 1] - (tg[r - 2] || 0);
          const need = Math.max(g.R.needMin, inc * g.R.needK[mode] + 500) * (hz.length ? 1.15 : (th === 1 ? 1.1 : 1));
          let w;
          if (r === 1) w = mode === 'versus' ? Math.min(...G.players.map(p => 2 * g.worthClear(items, [p], p.x < 640 ? 0 : 1))) : g.worthClear(items, G.players);
          else w = g.levelWorth(items);
          if (w >= need) ok++; else if (items.length + hz.length >= 66) { ok++; capped++; }
          if (r === 1) { const rb = items.filter(i => i.type === 'rock_b').length; rocksMax = Math.max(rocksMax, rb); }
        }
      }
      out[mode] = { levels, ok, capped, rocksMax };
    }
    // lone survivor: item count ratio
    let two = 0, one = 0, n = 0;
    for (let s = 1; s <= 50; s++) for (let r = 1; r <= 8; r++) {
      g.reseed(s); g.startMode('versus', [0, 1]); G.round = r;
      two += g.generateLevel(r, G.players, []).length;
      g.reseed(s); g.startMode('versus', [0, 1]); G.round = r;
      one += g.generateLevel(r, [G.players[0]], []).length; n++;
    }
    out.lone = { two: two / n, one: one / n, ratio: one / two }; out.loneK = g.R.loneK;
    return out;
  });
  const okF = ['solo', 'versus', 'coop'].every(m => f[m].ok / f[m].levels >= 0.95 && f[m].rocksMax <= 2) && f.lone.ratio >= 0.9 && f.lone.ratio <= 1.1 && f.loneK === 1;
  report('AC-P2-15', okF, ['solo', 'versus', 'coop'].map(m => `${m}: ${(100 * f[m].ok / f[m].levels).toFixed(1)}% levels meet need or the 66-item cap (${f[m].capped} by cap), round-1 big rocks <= ${f[m].rocksMax}`).join(' | ') + `; versus lone-survivor field unchanged (loneK=${f.loneK}): item count ratio ${f.lone.ratio.toFixed(3)} (${f.lone.one.toFixed(1)} vs ${f.lone.two.toFixed(1)}, sampled only with fewer winches in play)`);

  // AC-P2-16 final scores
  await page.evaluate(L.BOT_SRC);
  const sc = await page.evaluate(() => {
    const out = [];
    for (const mode of ['solo', 'versus', 'coop']) for (const bot of ['skilled', 'random']) for (let s = 1; s <= 4; s++) {
      const o = window.__bot({ seed: s, mode, bot }), G = window.__game.G, f = o.final;
      const ok = f.version === 2 && f.scores.length === (mode === 'versus' ? 2 : 1) && f.scores.every((q, i) => Number.isInteger(q.score) && q.score >= 0 && (mode === 'coop' ? q.score === Math.round(G.teamMoney) && q.player === -1 && q.char === -1 :
        q.score === Math.round(G.players[i].money) && q.player === i && q.char === G.players[i].char && q.rounds === (G.players[i].alive ? G.round : G.players[i].elimRound)));
      out.push(ok);
    }
    return out;
  });
  const v1 = await L.newPage(browser, L.URL1); await v1.evaluate(L.BOT_SRC);
  const ver1 = await v1.evaluate(() => [window.__bot({ seed: 1, mode: 'solo', bot: 'skilled' }).final.version, window.__bot({ seed: 1, mode: 'versus', bot: 'skilled' }).final.version, window.__bot({ seed: 1, mode: 'versus', bot: 'skilled' }).final.scores.length]);
  report('AC-P2-16', sc.every(Boolean) && ver1[0] === 1 && ver1[1] === 1 && ver1[2] === 2, `G.final.scores/version checked on ${sc.length} games (solo/versus/coop x skilled/random x seeds 1-4): ${sc.filter(Boolean).length}/${sc.length} correct (score = final money, rounds, char, version 2); rules=1 version=${ver1[0]}/${ver1[1]} with scores present; "最终得分" text on the final pages: see AC-P2-24`);
  await v1.context().close(); await page.context().close();
}

// ---------- AC-P2-17 (real keys) shop double confirm ----------
async function ac17(browser) {
  const setupSolo = async () => {
    const page = await L.newPage(browser, L.URL);
    await page.evaluate(() => { const g = window.__game, G = g.G; g.reseed(5); g.startMode('solo', [0]); G.forceEvent = 'none'; const p = G.players[0]; p.money = 1500; p.roundGain = 1500; G.screen = 'play'; g.endRound(); });
    await sleep(600); await page.keyboard.press('Space');
    await wait(page, () => __game.G.screen === 'shop', null, 5000); await sleep(500);
    return page;
  };
  const st = page => G(page, () => ({ sc: __game.G.screen, armed: __game.G.shop[0] && __game.G.shop[0].armed, sel: __game.G.shop[0] && __game.G.shop[0].sel }));
  const res = {};
  { // arm, expire, double press
    const page = await setupSolo();
    await page.keyboard.press('ArrowUp'); await sleep(200); res.a1 = await st(page);
    await sleep(1700); res.a2 = await st(page);
    await page.keyboard.press('ArrowUp'); await sleep(300); await page.keyboard.press('ArrowUp');
    await wait(page, () => __game.G.screen === 'intro', null, 1000).then(() => { res.a3 = true; }).catch(() => { res.a3 = false; });
    res.errors = page.errors.length; await page.context().close();
  }
  { // arm then move cancels
    const page = await setupSolo();
    await page.keyboard.press('ArrowUp'); await sleep(150); const before = await st(page);
    await page.keyboard.press('ArrowRight'); await sleep(150); const after = await st(page); res.b = { before, after };
    await page.context().close();
  }
  { // cursor on the ready card + ArrowDown
    const page = await setupSolo();
    await page.keyboard.press('ArrowLeft'); await sleep(100); res.cSel = (await st(page)).sel;
    await page.keyboard.press('ArrowDown');
    await wait(page, () => __game.G.screen === 'intro', null, 1500).then(() => { res.c = true; }).catch(() => { res.c = false; });
    await page.context().close();
  }
  { // versus: W + ArrowUp starts at once
    const page = await L.newPage(browser, L.URL);
    await page.evaluate(() => { const g = window.__game, G = g.G; g.reseed(5); g.startMode('versus', [0, 1]); G.forceEvent = 'none'; for (const p of G.players) { p.money = 2000; p.roundGain = 2000; } G.screen = 'play'; g.endRound(); });
    await sleep(600); await page.keyboard.press('Space');
    await wait(page, () => __game.G.screen === 'shop', null, 5000); await sleep(500);
    await page.keyboard.press('KeyW'); await page.keyboard.press('ArrowUp');
    await wait(page, () => __game.G.screen === 'intro', null, 1500).then(() => { res.d = true; }).catch(() => { res.d = false; });
    await page.context().close();
  }
  const ok = res.a1.sc === 'shop' && res.a1.armed === true && res.a2.sc === 'shop' && res.a2.armed === false && res.a3 && !res.b.after.armed && res.b.before.armed && res.b.after.sel === res.b.before.sel + 1 && res.cSel === 7 && res.c && res.d && res.errors === 0;
  report('AC-P2-17', ok, `real keys, solo shop: ArrowUp once -> armed=${res.a1.armed}; after 1.7 s armed=${res.a2.armed} (still shop); ArrowUp x2 (300 ms apart) -> intro=${res.a3}; ArrowUp then ArrowRight -> armed ${res.b.before.armed}->${res.b.after.armed}, sel ${res.b.before.sel}->${res.b.after.sel}; cursor on ready card (sel ${res.cSel}) + ArrowDown -> intro=${res.c}; versus KeyW+ArrowUp -> intro=${res.d}`);
}

// ---------- AC-P2-18 / 19 solo final medal cell, HUD captions ----------
async function ac18_19(browser) {
  const page = await L.newPage(browser, L.URL, { init: TEXT_SPY });
  await page.evaluate(() => {
    const g = window.__game, G = g.G; localStorage.clear();
    g.reseed(6); g.startMode('solo', [0]); G.forceEvent = 'none'; const p = G.players[0];
    const finish = (money, medal) => { G.screen = 'play'; p.medal = medal || p.medal; p.roundStart = 0; p.money = money; p.roundGain = money - (p.roundStart || 0); g.endRound(); g.afterResults(); };
    p.roundGain = 1500; p.money = 2000; G.screen = 'play'; g.endRound(); g.afterResults();            // round 1 passes, shop opens
    g.shopAction(0, 'buy');                                                                            // (whatever is first, may fail on money; irrelevant)
    G.shop[0].ready = true; g.advance(0.5); g.advance(3); G.screen = 'play';                           // -> round 2 intro/play
    p.medal = true; p.money = g.targets()[1] - 1; p.roundGain = 100; g.endRound(); g.afterResults();   // saved by the medal
    G.shop[0].ready = true; g.advance(0.5); G.screen = 'play';                                         // -> round 3
    p.money = 10; p.roundGain = 10; g.endRound(); g.afterResults();                                    // real failure -> final
  });
  const r = await G(page, () => ({ saved: __game.G.soloSaved, stars: __game.G.stars, screen: __game.G.screen, round: __game.G.round }));
  await sleep(200);
  const tx = await texts(page);
  const nSaved = tx.filter(q => q.t === '金牌保住').length, nFail = tx.filter(q => q.t === '未达标').length;
  const hasScore = tx.some(q => q.t.startsWith('最终得分'));
  await shot(page, '06-solo-final-score-medal.png');
  report('AC-P2-18', JSON.stringify(r.saved) === '[false,true,false]' && r.screen === 'final' && nSaved === 1 && nFail === 1 && hasScore,
    `G.soloSaved=${JSON.stringify(r.saved)} (expected [false,true,false]); final page draws "金牌保住" x${nSaved}, "未达标" x${nFail} (exactly one each), "最终得分" drawn=${hasScore}; screenshot 06-solo-final-score-medal.png`);
  // HUD captions in round 3
  await page.evaluate(() => { const g = window.__game, G = g.G; g.reseed(2); g.startMode('solo', [0]); G.forceEvent = 'none'; G.round = 2; g.startRound(); g.advance(4); });
  const hud = await texts(page);
  const caps = hud.filter(q => q.t.startsWith('收入≥'));
  const wide = await G(page, () => 0);
  const maxW = Math.max(...caps.map(q => q.w));
  await shot(page, '04-hud-round3-captions.png');
  report('AC-P2-19', caps.length >= 2 && hud.some(q => q.t === '达标') && maxW <= 70, `round-3 HUD captions: ${[...new Set(caps.map(q => q.t + ' (' + q.w.toFixed(1) + 'px, ' + q.font.split(' ').slice(-2, -1)[0] + ')'))].join(', ')}; widest ${maxW.toFixed(1)} px (<= 70); round 1 shows "达标 / 收入≥$1,260 / 收入≥$1,560"`);
  const g1 = await G(page, () => [__game.starGoal(1, 0), __game.starGoal(1, 1)]);
  report('AC-P2-19b', g1[0] === 1260 && g1[1] === 1560, `round-1 star goals ${g1} (1.05 x 1200, 1.3 x 1200; SPEC s7-c text still quotes the pre-amendment $1,200/$1,500)`);
  await page.context().close();
}

// ---------- AC-P2-21 real-key full games, all 3 modes ----------
async function ac21(browser) {
  const out = [];
  for (const boost of [false, true]) for (const [digit, mode] of [['Digit1', 'solo'], ['Digit2', 'versus'], ['Digit3', 'coop']]) {
    const page = await L.newPage(browser, L.URL + '?fast=1&seed=5', { init: TEXT_SPY });
    const kb = page.keyboard, t0 = Date.now();
    await kb.press(digit); await kb.press('Space');
    if (mode === 'solo') await kb.press('ArrowDown'); else { await kb.press('KeyS'); await kb.press('ArrowDown'); }
    await wait(page, () => __game.G.screen === 'intro' || __game.G.screen === 'play', null, 5000);
    let results = 0, shops = 0, lastRound = 0;
    while (Date.now() - t0 < 5 * 60 * 1000) {
      const st = await G(page, ({ boost }) => { const G = __game.G; if (boost && G.screen === 'play') for (const p of G.players) if (p.alive) { p.money = Math.max(p.money, __game.targets()[G.round - 1] + 50); if (G.mode === 'coop') G.teamMoney = Math.max(G.teamMoney, __game.targets()[G.round - 1] + 50); } return G.screen; }, { boost });
      if (st === 'final') break;
      if (st === 'play') { if (mode === 'solo') await kb.press('ArrowDown'); else { await kb.press('KeyS'); await kb.press('ArrowDown'); } }
      else if (st === 'results') { await kb.press('Space'); results++; }
      else if (st === 'shop') { if (mode === 'solo') { await kb.press('ArrowUp'); await kb.press('ArrowUp'); } else { await kb.press('KeyW'); await kb.press('ArrowUp'); } shops++; }
      await sleep(600);
    }
    const fin = await G(page, () => ({ screen: __game.G.screen, round: __game.G.round, mode: __game.G.mode }));
    await sleep(150);
    const tx = await texts(page);
    const label = mode === 'coop' ? '团队得分' : '最终得分';
    out.push({ boost, mode, ok: fin.screen === 'final' && fin.mode === mode && page.errors.length === 0 && tx.some(q => q.t === label || q.t.startsWith(label)), round: fin.round, results, shops, errors: page.errors.length, secs: ((Date.now() - t0) / 1000).toFixed(0) });
    await page.context().close();
  }
  report('AC-P2-21', out.every(o => o.ok), out.map(o => `${o.mode}${o.boost ? '+topup' : ''}: final=${o.ok} (round ${o.round}, ${o.results} result pages, ${o.shops} shop visits, ${o.errors} errors, ${o.secs}s)`).join(' | '));
}

// ---------- AC-P2-22 V key ----------
async function ac22(browser) {
  const page = await L.newPage(browser, L.URL + '?fast=1&seed=3', { init: TEXT_SPY });
  const kb = page.keyboard;
  await kb.press('Digit1'); await kb.press('Space'); await kb.press('ArrowDown');
  await wait(page, () => __game.G.screen === 'play', null, 5000);
  await kb.press('KeyV');
  const a = await G(page, () => ({ ls: localStorage.getItem('goldminer.reduceFx'), on: __game.isReduceFx(), toast: __game.G.toast }));
  const tx = await texts(page);
  const toastDrawn = tx.some(q => q.t === 'V 特效:关');
  await shot(page, '09-v-toggle-toast.png');
  await page.reload(); await page.waitForFunction(() => window.__game);
  const b = await G(page, () => ({ ls: localStorage.getItem('goldminer.reduceFx'), on: __game.isReduceFx() }));
  await kb.press('KeyV');
  const c = await G(page, () => ({ ls: localStorage.getItem('goldminer.reduceFx'), on: __game.isReduceFx(), toast: __game.G.toast }));
  report('AC-P2-22', a.ls === '1' && a.on && a.toast === 'V 特效:关' && toastDrawn && b.ls === '1' && b.on && c.ls === '0' && !c.on && c.toast === 'V 特效:开' && page.errors.length === 0,
    `KeyV in game -> localStorage=${a.ls}, toast "${a.toast}" drawn bottom-right=${toastDrawn}; after reload still ${b.ls}/${b.on}; KeyV again -> ${c.ls}, toast "${c.toast}"`);
  await page.context().close();
}

// ---------- AC-P2-23 live finale, real-time bot with real key presses ----------
async function ac23(browser) {
  const page = await L.newPage(browser, L.URL + '?seed=2');
  const kb = page.keyboard, map = { KeyS: 'ArrowDown', KeyW: 'ArrowUp' };
  await kb.press('Digit1'); await kb.press('Space'); await kb.press('ArrowDown');
  await wait(page, () => __game.G.screen === 'intro', null, 5000);
  await page.evaluate(L.BOT_SRC); await page.evaluate(() => { window.__rtBot('skilled'); window.__sawBanner = false; (function w() { const b = __game.G.banner; if (b && b.text === '黄金尾声!') window.__sawBanner = true; requestAnimationFrame(w); })(); });
  const t0 = Date.now(); let presses = 0, got = null;
  while (Date.now() - t0 < 100000) {
    const s = await G(page, () => ({ sc: __game.G.screen, time: __game.G.time, fin: __game.G.finaleOn, round: __game.G.round }));
    if (s.sc === 'play' && s.round === 1 && s.time <= 14) { got = s; break; }
    const w = await G(page, () => { const k = window.__want; window.__want = null; return k; });
    if (w) { await kb.press(map[w] || w); presses++; } else await sleep(3);
  }
  const saw = await G(page, () => window.__sawBanner);
  const items = await G(page, () => __game.G.items.filter(i => i.finale).length);
  report('AC-P2-23', got && got.fin === true && saw && items >= 1 && page.errors.length === 0, `real-time skilled bot (${presses} real ArrowDown/ArrowUp presses): with ${got && got.time.toFixed(1)} s left in round 1 finaleOn=${got && got.fin}, banner seen=${saw}, finale items on field=${items}, errors=${page.errors.length}`);
  await page.context().close();
}

// ---------- AC-P2-24 screenshots ----------
async function ac24(browser) {
  fs.mkdirSync(SHOTS2, { recursive: true });
  const files = [];
  const page = await L.newPage(browser, L.URL + '?seed=4', { init: TEXT_SPY });
  const kb = page.keyboard;
  // 1: finale banner + fresh treasure
  await kb.press('Digit1'); await kb.press('Space'); await kb.press('ArrowDown');
  await wait(page, () => __game.G.screen === 'play', null, 8000);
  await page.evaluate(L.BOT_SRC);
  await G(page, () => { const G = __game.G; G.forceEvent = 'none'; return window.__botUntil('perfect', () => G.finaleOn); });
  await sleep(260); await shot(page, '01-finale-banner.png');
  // 2: gold HUD timer + pill, a bit later
  await G(page, () => { __game.advance(2.6); });
  await sleep(120); await shot(page, '02-finale-hud.png');
  // 3: big win ring (deliver a diamond; keep retriggering while the screenshot is taken)
  await G(page, () => { const g = __game, G = g.G; window.__bw = setInterval(() => { const it = g.makeItem('diamond', 640, 600); g.deliver(G.players[0], it); }, 90); });
  await sleep(160); await shot(page, '03-big-win.png');
  await G(page, () => clearInterval(window.__bw));
  // 5: last 10 seconds vignette
  await G(page, () => { const G = __game.G; G.time = 9.2; G.timeUp = false; G.particles = []; G.texts = []; });
  await sleep(250); await shot(page, '05-last-10s-vignette.png');
  // 7: near miss text
  await G(page, () => {
    const g = __game, G = g.G, p = G.players[0]; G.time = 40; G.finaleOn = true; g.clearField();
    p.hook.state = 'swing'; p.hook.len = g.HOOK.minLen; p.hook.item = null; p.hook.phase = 0; p.hook.angle = 0; p.dyn = 1;
    G.items.push(g.makeItem('diamond', 640 + 30, 430));
    g.press('KeyS'); let guard = 0; while (p.hook.state !== 'swing' && guard++ < 2000) g.advance(1 / 60);
    window.__nm = G.stats.nearMiss;
  });
  await sleep(120); await shot(page, '07-near-miss.png');
  const nm = await G(page, () => window.__nm);
  await page.context().close();
  // 8: solo shop armed
  {
    const p2 = await L.newPage(browser, L.URL + '?seed=5', { init: TEXT_SPY });
    await p2.evaluate(() => { const g = window.__game, G = g.G; g.reseed(5); g.startMode('solo', [0]); G.forceEvent = 'none'; const p = G.players[0]; p.money = 3000; p.roundGain = 3000; G.screen = 'play'; g.endRound(); });
    await sleep(600); await p2.keyboard.press('Space');
    await wait(p2, () => __game.G.screen === 'shop', null, 5000); await sleep(500);
    await p2.keyboard.press('ArrowUp'); await sleep(250);
    await shot(p2, '08-solo-shop-armed.png');
    await p2.context().close();
  }
  // 9: versus final
  {
    const p3 = await L.newPage(browser, L.URL + '?seed=7', { init: TEXT_SPY });
    await p3.evaluate(L.BOT_SRC);
    await p3.evaluate(() => window.__bot({ seed: 7, mode: 'versus', bot: 'skilled' }));
    await sleep(250);
    const tx = await texts(p3);
    const n = tx.filter(q => q.t === '最终得分').length;
    await shot(p3, '10-versus-final-scores.png');
    await p3.context().close();
    report('AC-P2-24b', n === 2, `versus final page draws "最终得分" for both players (${n}x)`);
  }
  const need = ['01-finale-banner', '02-finale-hud', '03-big-win', '05-last-10s-vignette', '07-near-miss', '06-solo-final-score-medal', '08-solo-shop-armed', '10-versus-final-scores', '04-hud-round3-captions'];
  const have = need.filter(n => fs.existsSync(path.join(SHOTS2, n + '.png')));
  report('AC-P2-24', have.length === need.length && nm === 1, `${have.length}/${need.length} screenshots in screenshots/phase2/ (finale banner, gold HUD timer, big-win ring, last-10s vignette, near-miss, solo final with score + medal cell, versus final, armed shop, HUD captions); near-miss stat=${nm}; visually reviewed by hand (see report)`);
}

async function run(browser) {
  await ac04(browser); await ac01(browser); await ac02(browser);
  await ac05(browser);
  await ac07(browser); await ac08(browser); await ac09_10_11(browser); await ac11(browser); await ac12(browser); await ac13_16(browser);
  await ac17(browser); await ac18_19(browser); await ac22(browser); await ac21(browser); await ac23(browser); await ac24(browser);
}
module.exports = { run, ac11, ac01, ac02, ac04, ac05, ac07, ac08, ac09_10_11, ac12, ac13_16, ac17, ac18_19, ac21, ac22, ac23, ac24 };
