'use strict';
// Snapshot deltas (the client half is netPatch() in index.html).
//   object:  { s: {key: new value}, d: {key: sub-delta}, x: [deleted keys] }
//   array of the same length whose elements are objects:  { a: {index: sub-delta} }
//   array of objects that all carry a numeric `id` (the items):  { i: { '-': [ids], u: {id: sub-delta}, '+': [new elements] } }
//     (only when "drop deleted, keep order, append new ones" reproduces the new order; otherwise the array is replaced)
// diff() returns undefined when nothing changed.

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function equal(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false; return true; }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) { if (!Object.prototype.hasOwnProperty.call(b, k) || !equal(a[k], b[k])) return false; }
  return true;
}
const hasIds = arr => arr.length > 0 && arr.every(e => isObj(e) && typeof e.id === 'number');

function diffIdList(a, b) {
  const bIds = new Set(b.map(e => e.id)), aMap = new Map(a.map(e => [e.id, e]));
  const kept = a.filter(e => bIds.has(e.id)).map(e => e.id);
  const added = b.filter(e => !aMap.has(e.id));
  const order = kept.concat(added.map(e => e.id));
  if (order.length !== b.length || order.some((id, i) => id !== b[i].id)) return null;   // reordered: caller replaces
  const del = a.filter(e => !bIds.has(e.id)).map(e => e.id), upd = {};
  let nu = 0;
  for (const e of b) { const o = aMap.get(e.id); if (!o) continue; const d = diff(o, e); if (d !== undefined) { upd[e.id] = d; nu++; } }
  if (!del.length && !nu && !added.length) return undefined;
  const r = {};
  if (del.length) r['-'] = del;
  if (nu) r.u = upd;
  if (added.length) r['+'] = added;
  return { i: r };
}

function diff(a, b) {
  if (equal(a, b)) return undefined;
  if (Array.isArray(a) && Array.isArray(b)) {
    if ((hasIds(a) || !a.length) && hasIds(b)) { const d = diffIdList(a, b); if (d !== null) return d === undefined ? undefined : d; }
    if (a.length === b.length && a.length && a.every(isObj) && b.every(isObj)) {
      const out = {}; let n = 0;
      for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i]); if (d !== undefined) { out[i] = d; n++; } }
      return n ? { a: out } : undefined;
    }
    return REPLACE;
  }
  if (isObj(a) && isObj(b)) {
    const s = {}, d = {}, x = [];
    let ns = 0, nd = 0;
    for (const k of Object.keys(b)) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) { s[k] = b[k]; ns++; continue; }
      const sub = diff(a[k], b[k]);
      if (sub === undefined) continue;
      if (sub === REPLACE) { s[k] = b[k]; ns++; } else { d[k] = sub; nd++; }
    }
    for (const k of Object.keys(a)) if (!Object.prototype.hasOwnProperty.call(b, k)) x.push(k);
    const r = {};
    if (ns) r.s = s;
    if (nd) r.d = d;
    if (x.length) r.x = x;
    return r;
  }
  return REPLACE;
}
const REPLACE = Symbol('replace');

// top-level helper: always an object delta (snapshots are objects)
function snapDiff(prev, next) {
  const d = diff(prev, next);
  return d === undefined ? {} : d;
}

// reference implementation of the patch (same algorithm as netPatch in index.html; used by the tests)
function patch(base, d) {
  if (d && d.i) {
    const del = new Set(d.i['-'] || []), upd = d.i.u || {}, out = [];
    for (const el of base) { if (del.has(el.id)) continue; out.push(upd[el.id] ? patch(el, upd[el.id]) : el); }
    for (const el of d.i['+'] || []) out.push(el);
    return out;
  }
  if (d && d.a) { const out = base.slice(); for (const i in d.a) out[i] = patch(base[i], d.a[i]); return out; }
  const out = Object.assign({}, base);
  if (d.s) for (const k in d.s) out[k] = d.s[k];
  if (d.d) for (const k in d.d) out[k] = patch(base[k], d.d[k]);
  if (d.x) for (const k of d.x) delete out[k];
  return out;
}

module.exports = { diff: snapDiff, patch, equal };
