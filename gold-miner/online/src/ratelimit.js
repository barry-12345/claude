'use strict';
// Rate limiting with an injectable clock (same idea as server/src/ratelimit.js, written separately so the two services stay independent).

// Sliding-window counter per key: allow at most `limit` events per `windowMs`.
class WindowLimiter {
  constructor(limit, windowMs, clock) {
    this.limit = limit; this.windowMs = windowMs; this.clock = clock; this.map = new Map(); this.lastSweep = 0;
  }
  _list(key, now) {
    let l = this.map.get(key);
    if (!l) { l = []; this.map.set(key, l); }
    while (l.length && l[0] <= now - this.windowMs) l.shift();
    return l;
  }
  // would one more event be allowed?  { ok, retry (seconds until a slot frees) }
  peek(key) {
    const now = this.clock.now(), l = this._list(key, now);
    if (l.length < this.limit) return { ok: true, retry: 0 };
    return { ok: false, retry: Math.max(1, Math.ceil((l[0] + this.windowMs - now) / 1000)) };
  }
  record(key) { const now = this.clock.now(); this._list(key, now).push(now); this._sweep(now); }
  hit(key) { const r = this.peek(key); if (r.ok) this.record(key); return r; }   // check and count in one go
  _sweep(now) {
    if (now - this.lastSweep < 30000) return;
    this.lastSweep = now;
    for (const [k, l] of this.map) { while (l.length && l[0] <= now - this.windowMs) l.shift(); if (!l.length) this.map.delete(k); }
    if (this.map.size > 50000) { const it = this.map.keys(); while (this.map.size > 50000) this.map.delete(it.next().value); }
  }
}

// Token bucket: `rate` tokens per second, at most `burst` stored.
class TokenBucket {
  constructor(rate, burst, clock) { this.rate = rate; this.burst = burst; this.clock = clock; this.tokens = burst; this.t = clock.now(); }
  take() {
    const now = this.clock.now();
    this.tokens = Math.min(this.burst, this.tokens + (now - this.t) * this.rate / 1000); this.t = now;
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    return false;
  }
}

module.exports = { WindowLimiter, TokenBucket };
