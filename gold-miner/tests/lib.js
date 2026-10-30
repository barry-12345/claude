// Shared helpers for the test-suite: browser launch, URL, in-page bot driver (SPEC appendix A).
const path = require('path');
let chromium, devices;
try { ({ chromium, devices } = require('playwright')); }
catch (e) { ({ chromium, devices } = require(path.join(process.env.NODE_PATH || '/opt/node22/lib/node_modules', 'playwright'))); }

const ROOT = path.resolve(__dirname, '..');
const INDEX = process.env.GM_INDEX ? path.resolve(process.env.GM_INDEX) : path.join(ROOT, 'index.html');   // GM_INDEX (or run-all --wip) points the whole suite at wip/index.html
const URL = 'file://' + INDEX;
const URL1 = URL + '?rules=1';                                   // phase-1 rules (legacy path)
const BASELINE = 'file://' + path.join(__dirname, 'baseline.html');                 // before phase 1
const BASELINE1 = 'file://' + path.join(__dirname, 'baseline-phase1.html');         // accepted phase-1 build
const BASELINE2 = 'file://' + path.join(__dirname, 'baseline-phase2.html');         // accepted phase-2 build (touch work must not regress desktop)
const SHOTS = path.join(ROOT, 'screenshots');

async function launch() { return chromium.launch(); }

// Page that records pageerror / console.error. `errors` is the live array.
async function newPage(browser, url, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push('console.error: ' + m.text()); });
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto(url);
  await page.waitForFunction(() => window.__game);
  return page;
}

// In-page bot (SPEC appendix A) + whole-game driver. Installed as window.__bot.
const BOT_SRC = `(() => {
  const g = window.__game, G = g.G, H = g.HOOK, PIVOT_Y = 198, STEP = 1 / 60;
  function firstHit(p) {
    const a = p.hook.angle, sx = Math.sin(a), cy = Math.cos(a);
    let best = null, bd = 1e9;
    for (const it of G.items) {
      if (it.dead || it.grabbedBy >= 0) continue;
      const dx = it.x - p.x, dy = it.y - PIVOT_Y;
      const along = dx * sx + dy * cy; if (along <= 0) continue;
      const perp = Math.abs(dx * cy - dy * sx);
      if (perp < (it.hr || it.r) + H.radius - 2 && along < bd) { bd = along; best = it; }
    }
    return best;
  }
  const EV = { bag: 250, piggy: 400, egg: 260, chest: 700, hourglass: 150, clover: 150, lamp: 150, meteor: 450 };
  const val = it => it.value || EV[it.type] || 0;
  const BOTS = {
    spam:    { spam: true },                                       // phase 2: mash the fire key every 0.15-0.6 s
    random:  { miss: 1.00, lag: 0, cool: 0.50, thr: 60 },
    novice:  { miss: 0.35, lag: 8, cool: 0.70, thr: 40 },
    skilled: { miss: 0.10, lag: 4, cool: 0.35, thr: 60 },
    perfect: { miss: 0.00, lag: 0, cool: 0.00, thr: 60 },
  };
  function botTick(bt, cfg) {
    const p = bt.p, h = p.hook;
    if (cfg.spam) { if (--bt.sp <= 0) { PRESS(p.cfg.keys.fire); bt.sp = Math.floor((0.15 + Math.random() * 0.45) * 60); } return; }
    if (h.state === 'swing') {
      if (bt.cd > 0) { bt.cd -= STEP; return; }
      if (!bt.dec) { bt.dec = true; bt.rnd = Math.random() < cfg.miss ? Math.floor((0.3 + Math.random() * 1.7) * 60) : -1; }
      if (bt.rnd >= 0) { if (bt.rnd-- === 0) PRESS(p.cfg.keys.fire); return; }
      if (bt.wait > 0) { if (--bt.wait === 0) { PRESS(p.cfg.keys.fire); bt.wait = -1; } return; }
      const it = firstHit(p);
      if (it) {
        const v = val(it);
        if (v / Math.max(0.6, it.weight) >= cfg.thr || v >= 300) {
          const l = Math.floor(Math.random() * (cfg.lag + 1));
          if (l === 0) PRESS(p.cfg.keys.fire); else bt.wait = l;
        }
      }
    } else {
      bt.cd = cfg.cool; bt.dec = false; bt.rnd = -1;
      if (h.state === 'retract' && h.item && p.dyn > 0 && h.item.weight >= 4 && val(h.item) < 100 && h.len > 200) PRESS(p.cfg.keys.dyn);
    }
  }
  let PRESS = code => g.press(code);             // swapped for a "request a real key press" function in the real-time test
  const mkBts = () => G.players.map(p => ({ p, wait: -1, cd: 0, rnd: -1, dec: false, sp: 30 }));
  const mk = name => ({ cfg: BOTS[name || 'skilled'], bts: mkBts(), round: G.round });
  // one frame of the whole-game driver (SPEC appendix A): bots play, results/shop are skipped with real key codes
  function frame(st, out) {
    if (st.round !== G.round) { st.round = G.round; st.bts = mkBts(); }   // fresh bot state every round
    if (G.screen === 'play') { for (const bt of st.bts) if (bt.p.alive) botTick(bt, st.cfg); }
    else if (G.screen === 'results' && G.resultsT > 0.5) {
      out.rounds.push(G.players.map(p => p.money).concat([G.teamMoney]));
      if (g.isSolo()) out.stars.push(G.results[0].stars);
      g.press('Space');
    } else if (G.screen === 'shop' && G.t - G.shopStartT > 0.3) {
      if (G.shop.some(s => s && s.offers.some(o => o.id === 'shield'))) out.shieldShop++;
      g.press('KeyW');
      if (!g.isSolo()) g.press('ArrowUp'); else if (g.R && g.R.polish) g.press('KeyW');   // rule 2: the solo shop needs "ready" twice
    }
  }
  const newOut = () => ({ rounds: [], bolts: 0, tugSeen: false, assistSeen: false, shieldShop: 0, diceShield: 0, stars: [], frames: 0 });
  function watch(out, last) {
    if (G.tug) out.tugSeen = true;
    for (const p of G.players) if (p.hook.state === 'tug' || p.hook.state === 'assist') out.assistSeen = true;
    if (G.screen === 'intro' && last !== 'intro') {
      out.bolts += G.items.filter(i => i.type === 'bolt').length;
      for (const p of G.players) if (p.diceGain === 'shield') out.diceShield++;
    }
  }
  function drive(st, out, until, hook) {
    let guard = 0, last = '';
    while (G.screen !== 'final' && !(until && until()) && guard++ < 60 * 60 * 40) {
      watch(out, last); frame(st, out); last = G.screen;
      if (hook) hook();
      g.advance(STEP); out.frames++;
    }
    out.screen = G.screen; out.round = G.round; out.cleared = G.cleared;
    out.final = G.final ? JSON.parse(JSON.stringify(G.final)) : null;
    out.per = G.mode === 'versus' ? G.players.map(p => (p.alive ? G.round : p.elimRound - 1)) : [G.cleared];   // rounds cleared per participant (versus: survivor = G.round, eliminated = elimRound - 1; spec 5.6)
    out.stats = G.stats ? Object.assign({}, G.stats) : null; out.mode = G.mode;
    return out;
  }
  // Plays a whole game synchronously. opt: { seed, mode, bot, chars, hook }
  window.__bot = function (opt) {
    g.reseed(opt.seed); g.startMode(opt.mode, opt.chars || (opt.mode === 'solo' ? [0] : [0, 1]));
    return drive(mk(opt.bot), newOut(), null, opt.hook);
  };
  // Continue the game that is already running until until() is true (or final).
  window.__botUntil = (bot, until, hook) => drive(mk(bot), newOut(), until, hook);
  // Real-time mode: the bot only *requests* key presses (window.__want); the test presses them with page.keyboard.
  window.__rtBot = function (name) {
    const st = mk(name); PRESS = code => { window.__want = code; };
    (function loop() { if (G.screen === 'play' && !G.paused) for (const bt of st.bts) if (bt.p.alive) botTick(bt, st.cfg); requestAnimationFrame(loop); })();
  };
})();`;

module.exports = { INDEX, launch, newPage, devices, URL, URL1, BASELINE, BASELINE1, BASELINE2, SHOTS, ROOT, BOT_SRC };

// tiny assertion/reporting helper
const results = [];
module.exports.report = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id}  ${detail}`); return ok; };
module.exports.results = results;
