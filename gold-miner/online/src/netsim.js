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

// A delayed, order-preserving pipe.  push(fn) runs fn after the simulated delay.  One queue and one timer, so messages that
// fall due in the same millisecond still run in the order they were sent (separate timers would not guarantee that).
class DelayLine {
  constructor(cfg, rnd = Math.random) { this.cfg = cfg; this.rnd = rnd; this.last = 0; this.q = []; this.timer = null; }
  push(fn) {
    const c = this.cfg, now = Date.now();
    let d = c.lat + (this.rnd() * 2 - 1) * c.jitter;
    const stall = !!(c.stallP && this.rnd() < c.stallP);
    if (stall) d += c.stallMs;
    const own = now + Math.max(0, d), at = Math.max(own, this.last);
    this.last = at;
    this.q.push({ at, fn });
    if (!this.timer) this._arm();
    return { stall, held: Math.round(at - now) };              // (tests) whether this message was stalled, and its total delay
  }
  _arm() {
    if (!this.q.length) { this.timer = null; return; }
    this.timer = setTimeout(() => {
      const now = Date.now();
      while (this.q.length && this.q[0].at <= now) this.q.shift().fn();
      this._arm();
    }, Math.max(0, this.q[0].at - Date.now()));
  }
  clear() { clearTimeout(this.timer); this.timer = null; this.q = []; }
}

module.exports = { parseNetSim, DelayLine };
