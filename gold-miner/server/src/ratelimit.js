'use strict';

/**
 * 内存限流器(滑动窗口)。每条规则 { windowMs, max }。
 * now() 可注入,测试不需要真的等待。
 * 内存有界:最多 maxKeys 个键(超出时淘汰最久未活动的键);过期键最多每 sweepMs 清扫一次。
 */
class RateLimiter {
  constructor(rules, now = Date.now, { maxKeys = 50000, sweepMs = 30000 } = {}) {
    this.rules = rules;
    this.now = now;
    this.maxKeys = maxKeys;
    this.sweepMs = sweepMs;
    this.longest = Math.max(...rules.map((r) => r.windowMs));
    this.hits = new Map(); // key -> number[](时间戳,升序);Map 的插入顺序 = 最近活动顺序
    this.lastSweep = now();
  }

  _wait(arr, t) {
    let wait = 0;
    for (const r of this.rules) {
      let n = 0;
      let first = -1;
      for (let i = arr.length - 1; i >= 0 && arr[i] > t - r.windowMs; i--) {
        n++;
        first = i;
      }
      if (n >= r.max) wait = Math.max(wait, arr[first + (n - r.max)] + r.windowMs - t);
    }
    return wait;
  }

  _arr(key, t) {
    const arr = this.hits.get(key) || [];
    while (arr.length && arr[0] <= t - this.longest) arr.shift();
    return arr;
  }

  /** 只查看、不计数。返回 { ok:true } 或 { ok:false, retryAfter(秒) } */
  peek(key) {
    const t = this.now();
    const arr = this.hits.get(key);
    if (!arr) return { ok: true };
    const w = this._wait(this._arr(key, t), t);
    return w > 0 ? { ok: false, retryAfter: Math.max(1, Math.ceil(w / 1000)) } : { ok: true };
  }

  /** 记一次请求。返回 { ok:true } 或 { ok:false, retryAfter(秒) }。被拒绝的请求不计数。 */
  take(key) {
    const t = this.now();
    this._sweep(t);
    const arr = this._arr(key, t);
    const w = this._wait(arr, t);
    if (w > 0) return { ok: false, retryAfter: Math.max(1, Math.ceil(w / 1000)) };
    arr.push(t);
    this._touch(key, arr);
    return { ok: true };
  }

  /** 无条件记一次(用于"失败才计数"的场景) */
  record(key) {
    const t = this.now();
    this._sweep(t);
    const arr = this._arr(key, t);
    arr.push(t);
    this._touch(key, arr);
  }

  _touch(key, arr) {
    this.hits.delete(key);
    this.hits.set(key, arr);
    if (this.hits.size > this.maxKeys) {
      this.hits.delete(this.hits.keys().next().value); // 淘汰最久未活动的键
    }
  }

  _sweep(t) {
    if (t - this.lastSweep < this.sweepMs) return;
    this.lastSweep = t;
    for (const [k, arr] of this.hits) {
      if (!arr.length || arr[arr.length - 1] <= t - this.longest) this.hits.delete(k);
    }
  }
}

module.exports = { RateLimiter };
