'use strict';
// Scripted input driver shared by the browser (tests/online.js, O-02) and the vm host (O-02 / O-03 / O-04):
// every 37 ticks P1 / P2 fire in turn; a hook reeling in something worth < $50 uses dynamite; results: continue after 0.5 s;
// shop: each player buys the first affordable offer (moving right to it), then readies.
// The same source runs in both worlds through an adapter act(slot, action) and a tick function.
const DRIVER_SRC = `(function makeDriver(g, act, step) {
  const G = g.G;
  let tick = 0, shopRound = -1, shopDone = [false, false];
  const rounds = [];
  let lastScreen = '';
  function one() {
    if (G.screen === 'results' && lastScreen !== 'results') rounds.push(G.players.map(p => p.money));
    lastScreen = G.screen;
    if (G.screen === 'play') {
      if (tick % 37 === 0) act((tick / 37) % 2, 'fire');
      for (const p of G.players) { const h = p.hook; if (p.alive && h.state === 'retract' && h.item && (h.item.value || 0) < 50 && p.dyn > 0) act(p.id, 'dyn'); }
    } else if (G.screen === 'results') { if (G.resultsT > 0.5) act(0, 'next'); }
    else if (G.screen === 'shop') {
      if (shopRound !== G.round) { shopRound = G.round; shopDone = [false, false]; }
      if (G.t - G.shopStartT > 0.3) for (let i = 0; i < 2; i++) {
        const s = G.shop[i], p = G.players[i]; if (!s || shopDone[i]) continue;
        shopDone[i] = true;
        const j = s.offers.findIndex(o => o.price <= p.money);
        if (j >= 0) { for (let k = 0; k < j; k++) act(i, 'right'); act(i, 'ok'); }
        act(i, 'ready');
      }
    }
    step(); tick++;
  }
  return { run(maxTicks) { while (G.screen !== 'final' && tick < maxTicks) one(); return { rounds, final: G.final ? JSON.parse(JSON.stringify(G.final)) : null, ticks: tick, screen: G.screen }; }, one, get tick() { return tick; } };
})`;

// vm side: inputs go through __game.net.input (the room's path), ticks through __game.net.step
function runVm(gm, seed, maxTicks = 60 * 60 * 30) {
  const vm = require('vm');
  gm.g.reseed(seed); gm.g.startMode('versus', [0, 1]);
  const make = vm.runInContext(DRIVER_SRC, gm.ctx);
  const d = make(gm.g, (s, a) => gm.net.input(s, a), () => gm.net.step());
  return JSON.parse(JSON.stringify(d.run(maxTicks)));
}
// browser side: real key codes through __game.press, ticks through __game.advance
const BROWSER_SRC = `(seed) => {
  const g = window.__game, K = [{ fire: 'KeyS', dyn: 'KeyW', left: 'KeyA', right: 'KeyD', ok: 'KeyS', ready: 'KeyW' }, { fire: 'ArrowDown', dyn: 'ArrowUp', left: 'ArrowLeft', right: 'ArrowRight', ok: 'ArrowDown', ready: 'ArrowUp' }];
  g.reseed(seed); g.startMode('versus', [0, 1]);
  const make = ${DRIVER_SRC};
  const d = make(g, (s, a) => g.press(a === 'next' ? 'Space' : K[s][a]), () => g.advance(1 / 60));
  return d.run(60 * 60 * 30);
}`;

module.exports = { DRIVER_SRC, BROWSER_SRC, runVm };
