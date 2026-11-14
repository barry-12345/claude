'use strict';
// Message validation (client -> server).  Everything is checked for type, presence and length; anything else is `bad_message`.
const crypto = require('crypto');

const PROTO = 1;
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';           // 31 symbols: no 0/O/1/I/L
const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
const SEAT_RE = /^[A-Za-z0-9_-]{43}$/;                         // 32 random bytes, base64url
const ACTIONS = new Set(['fire', 'dyn', 'left', 'right', 'ok', 'back', 'pick', 'ready', 'next', 'pause', 'resume', 'away', 'again', 'leave', 'endgame']);
const ERRORS = ['version', 'room_not_found', 'room_full', 'bad_seat', 'rate_limited', 'bad_message', 'server_full', 'origin'];

function newRoomCode(inUse) {
  for (;;) {
    let s = '';
    for (let i = 0; i < 6; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!inUse || !inUse(s)) return s;
  }
}
const newSeatToken = () => crypto.randomBytes(32).toString('base64url');

// nickname: trimmed, at most 8 characters (code points), control characters removed
function cleanName(v) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  const s = Array.from(v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim());
  return s.length > 8 ? null : s.join('');
}

// returns { ok: true, msg } with a normalised message, or { ok: false }
function parse(text) {
  let m;
  try { m = JSON.parse(text); } catch (e) { return { ok: false }; }
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return { ok: false };
  switch (m.t) {
    case 'create': case 'join': {
      if (typeof m.proto !== 'number' || typeof m.build !== 'string' || m.build.length > 32) return { ok: false };
      const name = cleanName(m.name); if (name === null) return { ok: false };
      const out = { t: m.t, proto: m.proto, build: m.build, name };          // any other field (e.g. a "mode") is ignored
      if (m.t === 'join') { if (typeof m.room !== 'string' || !CODE_RE.test(m.room)) return { ok: false }; out.room = m.room; }
      if (m.t === 'create' && Number.isInteger(m.seed) && m.seed >= 0 && m.seed < 2 ** 31) out.seed = m.seed;   // honoured only with ONLINE_TEST_HOOKS
      return { ok: true, msg: out };
    }
    case 'resume':
      if (typeof m.proto !== 'number' || typeof m.build !== 'string' || m.build.length > 32) return { ok: false };
      if (typeof m.room !== 'string' || !CODE_RE.test(m.room) || typeof m.seat !== 'string' || !SEAT_RE.test(m.seat)) return { ok: false };
      return { ok: true, msg: { t: 'resume', proto: m.proto, build: m.build, room: m.room, seat: m.seat } };
    case 'in': {
      if (!Number.isInteger(m.s) || m.s < 0 || typeof m.a !== 'string' || !ACTIONS.has(m.a)) return { ok: false };
      const out = { t: 'in', s: m.s, a: m.a };
      if (m.at !== undefined) { if (typeof m.at !== 'number' || !Number.isFinite(m.at)) return { ok: false }; out.at = m.at; }
      if (m.i !== undefined) { if (!Number.isInteger(m.i) || m.i < 0 || m.i > 20) return { ok: false }; out.i = m.i; }
      return { ok: true, msg: out };
    }
    case 'ping':
      if (typeof m.c !== 'number' || !Number.isFinite(m.c)) return { ok: false };
      return { ok: true, msg: { t: 'ping', c: m.c } };
  }
  return { ok: false };
}

module.exports = { PROTO, ALPHABET, CODE_RE, SEAT_RE, ACTIONS, ERRORS, newRoomCode, newSeatToken, cleanName, parse };
