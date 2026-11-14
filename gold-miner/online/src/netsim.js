'use strict';
// Test-only network simulation, applied on the server to both directions of every connection.
//   NET_SIM='lat=100,jitter=50,stall=0.02:300'
//   lat/jitter: each message is delayed lat ± jitter ms (uniform), order preserved (a message never overtakes the previous one);
//   stall=p:ms: with probability p a message is held back ms extra (and, order being preserved, everything after it): a TCP retransmit.
// Forced off when NODE_ENV=production.
function parseNetSim(str) {
  if (!str || process.env.NODE_ENV === 'production') return null;
  const o = { lat: 0, jitter: 0, stallP: 0, stallMs: 0 };
  for (const part of String(str).split(',')) {
    const [k, v] = part.split('=').map(s => s && s.trim());
    if (k === 'lat') o.lat = +v || 0;
    else if (k === 'jitter') o.jitter = +v || 0;
    else if (k === 'stall') { const [p, ms] = String(v).split(':'); o.stallP = +p || 0; o.stallMs = +ms || 0; }
  }
  return o.lat || o.jitter || o.stallP ? o : null;
}

// A delayed, order-preserving pipe.  push(fn) runs fn after the simulated delay.
class DelayLine {
  constructor(cfg, rnd = Math.random) { this.cfg = cfg; this.rnd = rnd; this.last = 0; this.timers = new Set(); }
  push(fn) {
    const c = this.cfg, now = Date.now();
    let d = c.lat + (this.rnd() * 2 - 1) * c.jitter;
    if (c.stallP && this.rnd() < c.stallP) d += c.stallMs;
    const at = Math.max(now + Math.max(0, d), this.last);
    this.last = at;
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, at - now);
    this.timers.add(t);
  }
  clear() { for (const t of this.timers) clearTimeout(t); this.timers.clear(); }
}

module.exports = { parseNetSim, DelayLine };
