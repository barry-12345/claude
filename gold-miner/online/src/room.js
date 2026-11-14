'use strict';
// One room = two seats + one game context (the index.html script in a vm).
// The room controller owns everything that is not a game rule: seats, pause / resume countdown, offline freeze,
// "continue" votes on the results page (6 s auto-advance), "play again", leaving, idle clean-up.
const crypto = require('crypto');
const { newSeatToken } = require('./protocol');
const { diff } = require('./delta');
const { plain } = require('./sim-host');

const HIST = 30, CATCHUP = 18;                 // lag compensation: look-back window / catch-up ticks
const COUNTDOWN_TICKS = 180;                   // 3 s before a resume
const RESULTS_AUTO = 6;                        // seconds on the results page

class Room {
  constructor(srv, code, opts = {}) {
    this.srv = srv; this.cfg = srv.cfg; this.clock = srv.clock; this.code = code;
    const now = this.clock.now();
    this.created = now; this.lastActivity = now; this.emptySince = null; this.finalAt = null;
    this.seats = [null, null];
    this.phase = 'waiting';                    // waiting | game | closed
    this.game = srv.host.createGame({ fast: this.cfg.fast });
    this.k = 0; this.lastTickAt = now;
    this.pause = null;                         // { by, reason: 'player'|'away'|'offline', resumeAt: tick|null, prev, endOffer }
    this.nextSeed = opts.seed != null ? opts.seed : null;
    this.seed = null;
    this.queue = [];                           // inputs, processed at the start of the next tick in arrival order
    this.fires = [];                           // fire confirmations for the next snapshot
    this.prevSnap = null; this.urgent = false; this.lastScreen = this.game.G.screen;
    this.stats = { tickMs: 0, ticks: 0 };
  }
  get G() { return this.game.G; }
  get net() { return this.game.net; }

  // ---- seats
  addSeat(slot, name) {
    const token = newSeatToken();
    this.seats[slot] = { token, name: name || '', conn: null, online: false, offlineSince: this.clock.now(), again: false, next: false };
    this.net.setNames(this.seats.map(s => (s ? s.name : '')));
    return token;
  }
  attach(slot, conn) {
    const s = this.seats[slot];
    if (s.conn && s.conn !== conn) {           // the same seat opened in another tab: the newer connection wins
      const old = s.conn; old.room = null; old.slot = -1;
      this.srv.send(old, { t: 'error', code: 'bad_seat' });
      this.srv.closeConn(old, 4001, 'taken over');
    }
    s.conn = conn; s.online = true; s.offlineSince = null;
    conn.room = this; conn.slot = slot; conn.synced = false;
    this.lastActivity = this.clock.now();
    this.srv.send(conn, { t: 'welcome', you: slot, room: this.code, seat: s.token, build: this.game.build, fast: !!this.cfg.fast, rate: { tick: 60, snap: 30 }, k: this.k });
    this.seatChanged();
  }
  detach(conn) {
    const s = this.seats[conn.slot];
    if (!s || s.conn !== conn) return;
    s.conn = null; s.online = false; s.offlineSince = this.clock.now();
    conn.room = null;
    this.seatChanged();
  }
  online(slot) { const s = this.seats[slot]; return !!(s && s.online); }
  bothOnline() { return this.online(0) && this.online(1); }
  seatChanged() {
    const G = this.G;
    if (this.phase === 'waiting') { if (this.seats[1] && this.bothOnline()) this.newGame(); }
    else if (this.phase === 'game') {
      const off = [0, 1].find(i => !this.online(i));
      if (G.screen === 'select') {             // character select: an absent player's confirmation is cleared
        if (off !== undefined && G.sel[off]) { G.sel[off].ready = false; G.selT = 0; }
      } else if (off !== undefined) {
        if (!this.pause || this.pause.reason !== 'offline') {
          const prev = this.pause && this.pause.resumeAt == null ? this.pause : null;
          this.pause = { by: off, reason: 'offline', resumeAt: null, prev, endOffer: false };
          if (!G.paused) this.game.g.pauseGame();
        } else this.pause.by = off;
      } else if (this.pause && this.pause.reason === 'offline') {
        if (this.pause.prev) this.pause = this.pause.prev;                     // it was paused by a player before: stays paused
        else this.pause.resumeAt = this.k + COUNTDOWN_TICKS;                  // both back: 3 s countdown
      }
    }
    this.emptySince = this.seats.some(s => s && s.online) ? null : (this.emptySince || this.clock.now());
    this.sendRoom(); this.urgent = true;
  }
  newGame() {
    const seed = this.nextSeed != null ? this.nextSeed : crypto.randomInt(2 ** 31);
    this.nextSeed = null; this.seed = seed;
    this.phase = 'game'; this.pause = null; this.finalAt = null;
    for (const s of this.seats) if (s) { s.again = false; s.next = false; }
    this.net.enterSelect(seed);
    this.net.setNames(this.seats.map(s => (s ? s.name : '')));
    this.lastScreen = this.G.screen;
    this.sendRoom(); this.urgent = true;
  }
  toWaiting() {                                // "end the game": the round is void, both go back to the waiting room
    const G = this.G;
    this.phase = 'waiting'; this.pause = null;
    G.paused = false; G.screen = 'start'; G.players = []; G.items = []; G.tug = null;
    this.sendRoom(); this.urgent = true;
  }
  setSeed(seed) {                              // tests: seed for the next game, or the current one while still on character select
    this.nextSeed = seed;
    if (this.phase === 'game' && this.G.screen === 'select') { this.game.g.reseed(seed); this.seed = seed; this.nextSeed = null; }
  }

  // ---- messages
  roomMsg() {
    const now = this.clock.now(), pz = this.pause;
    const m = { t: 'room', phase: this.phase, seats: this.seats.map(s => (s ? { name: s.name, online: s.online, again: s.again, next: s.next } : null)) };
    if (pz) {
      m.pause = { by: pz.by, reason: pz.reason, resumeAt: pz.resumeAt };
      if (pz.reason === 'offline') {
        const s = this.seats[pz.by];
        m.pause.left = s && s.offlineSince != null ? Math.max(0, this.cfg.seatTimeout - (now - s.offlineSince)) : this.cfg.seatTimeout;
        m.pause.endOffer = !!pz.endOffer;
      }
    }
    return m;
  }
  sendRoom() { const m = this.roomMsg(); for (const s of this.seats) if (s && s.conn) this.srv.send(s.conn, m); }
  close(reason) {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    const m = { t: 'room', phase: 'closed', reason };
    for (const s of this.seats) if (s && s.conn) { const c = s.conn; this.srv.send(c, m); c.room = null; s.conn = null; this.srv.closeConn(c, 1000, 'room closed'); }
    this.srv.deleteRoom(this);
  }

  // ---- input
  push(conn, m) { this.queue.push({ conn, slot: conn.slot, m }); }
  process(conn, slot, m, now) {
    const G = this.G, a = m.a, pz = this.pause, seat = this.seats[slot];
    if (conn) conn.ackSeq = m.s;
    this.lastActivity = this.clock.now();
    if (a === 'leave') { this.close('left'); return; }
    if (this.phase !== 'game') return;
    const live = G.screen === 'intro' || G.screen === 'play';
    switch (a) {
      case 'pause': case 'away':
        if (!live || (pz && (pz.reason === 'offline' || pz.resumeAt == null))) return;
        this.pause = { by: slot, reason: a === 'away' ? 'away' : 'player', resumeAt: null, prev: null };
        if (!G.paused) this.game.g.pauseGame();
        this.sendRoom(); this.urgent = true; return;
      case 'resume':
        if (!pz || pz.reason === 'offline' || pz.resumeAt != null || !this.bothOnline()) return;
        pz.resumeAt = this.k + COUNTDOWN_TICKS; this.sendRoom(); this.urgent = true; return;
      case 'endgame': {
        if (!pz || pz.reason !== 'offline' || !pz.endOffer || pz.by === slot) return;
        this.toWaiting(); return;
      }
      case 'again':
        if (G.screen !== 'final' || pz) return;
        seat.again = true;
        if (this.seats.every(s => s && s.again)) this.newGame(); else this.sendRoom();
        return;
      case 'next':
        if (G.screen !== 'results' || pz) return;
        if (!seat.next) { seat.next = true; this.sendRoom(); }
        return;
    }
    if (pz || G.paused) return;
    if (a === 'fire') { this.fire(slot, m, now); return; }
    this.net.input(slot, a, m.i);
  }
  // lag-compensated fire: aim with the swing phase the player saw at tick `at`, then let this hook catch up
  fire(slot, m, now = this.k) {
    const G = this.G, net = this.net;
    let r = null, back = false;
    if (typeof m.at === 'number' && G.screen === 'play' && !G.tug) {
      const a = Math.min(m.at, now);
      if (now - a <= HIST) {
        const byK = new Map(net.hookHistory(slot).map(e => [e.k, e]));
        const lo = Math.floor(a), hi = Math.ceil(a);
        let ok = true;
        for (let t = lo; t <= now; t++) { const e = byK.get(t); if (!e || !e.ok) { ok = false; break; } }
        if (ok) {
          const e0 = byK.get(lo), e1 = byK.get(hi), ph = e0.ph + (e1.ph - e0.ph) * (a - lo);
          r = net.fireBackdated(slot, ph, Math.min(CATCHUP, Math.round(now - a)), a); back = true;
        }
      }
    }
    if (!back) r = net.input(slot, 'fire');    // plain fire (outside the window, or the hook was not swinging the whole time; also tug presses)
    if (r) this.fires.push({ p: slot, fireAt: r.fireAt, seq: m.s, ang: Math.round(r.ang * 1e6) / 1e6, back });
    return r ? Object.assign({ back }, plain(r)) : null;
  }

  // ---- one server tick (60 Hz)
  tick() {
    const t0 = process.hrtime.bigint();
    this.k++; this.lastTickAt = this.clock.now();
    const G = this.G, net = this.net;
    const q = this.queue; this.queue = [];
    for (const e of q) { if (this.phase === 'closed') return; this.process(e.conn, e.slot, e.m, this.k - 1); }
    if (this.phase === 'closed') return;
    const pz = this.pause;
    if (pz && pz.resumeAt != null && this.k >= pz.resumeAt) {
      this.pause = null; this.game.g.resumeGame(); this.sendRoom(); this.urgent = true;
    }
    if (this.phase === 'game' && !this.pause) {
      net.step();
      if (G.screen === 'results') {
        const votes = this.seats.every(s => s && s.next);
        if ((votes && G.resultsT > 0.4) || G.resultsT >= RESULTS_AUTO) net.input(0, 'next');
      }
    }
    if (G.screen !== this.lastScreen) {
      if (G.screen === 'results') for (const s of this.seats) if (s) s.next = false;
      if (G.screen === 'final') { this.finalAt = this.clock.now(); for (const s of this.seats) if (s) s.again = false; }
      this.lastScreen = G.screen; this.urgent = true; this.sendRoom();
    }
    net.record(this.k);
    if (this.k % 2 === 0 || this.urgent) this.broadcast();
    this.stats.tickMs += Number(process.hrtime.bigint() - t0) / 1e6; this.stats.ticks++;
  }
  snapshot() { return plain(this.net.snapshot()); }
  broadcast() {
    this.urgent = false;
    const S = this.snapshot(), fx = plain(this.net.fxDrain());
    const d = this.prevSnap ? diff(this.prevSnap, S) : null;
    this.prevSnap = S;
    const fires = this.fires; this.fires = [];
    for (const s of this.seats) {
      if (!s || !s.conn) continue;
      const c = s.conn, m = { t: 'snap', k: this.k };
      if (!c.synced || !d) { m.full = 1; m.d = S; c.synced = true; } else m.d = d;
      if (fx.length) m.fx = fx;
      m.ack = c.ackSeq == null ? -1 : c.ackSeq;
      if (fires.length) m.fire = fires;
      this.srv.send(c, m);
    }
  }
  serverTick() { return this.k + Math.min(1, (this.clock.now() - this.lastTickAt) * 60 / 1000); }   // fractional, for pong

  // ---- housekeeping (called often): seat timeouts, the "end game" offer, idle rooms
  maintain(now) {
    const cfg = this.cfg;
    if (this.phase === 'closed') return;
    for (let i = 0; i < 2; i++) {
      const s = this.seats[i];
      if (s && !s.online && s.offlineSince != null && now - s.offlineSince >= cfg.seatTimeout) { this.close('timeout'); return; }
    }
    const pz = this.pause;
    if (pz && pz.reason === 'offline' && !pz.endOffer) {
      const s = this.seats[pz.by];
      if (s && s.offlineSince != null && now - s.offlineSince >= cfg.endOfferAfter) { pz.endOffer = true; this.sendRoom(); }
    }
    if (this.phase === 'waiting' && !this.seats[1] && now - this.created >= cfg.idleWaiting) { this.close('expired'); return; }
    if (this.emptySince != null && now - this.emptySince >= cfg.idleEmpty) { this.close('expired'); return; }
    if (this.G.screen === 'final' && this.phase === 'game' && now - Math.max(this.finalAt || 0, this.lastActivity) >= cfg.idleFinal) { this.close('expired'); return; }
    if (now - this.created >= cfg.maxAge) { this.close('expired'); return; }
  }
  inProgress() { return this.phase === 'game' && ['intro', 'play', 'results', 'shop'].includes(this.G.screen); }
  info() {
    return { code: this.code, phase: this.phase, screen: this.G.screen, k: this.k, seed: this.seed, paused: !!this.pause, pause: this.pause ? { by: this.pause.by, reason: this.pause.reason, resumeAt: this.pause.resumeAt, endOffer: !!this.pause.endOffer } : null,
      seats: this.seats.map(s => (s ? { name: s.name, online: s.online, again: s.again, next: s.next } : null)), tickMs: this.stats.ticks ? this.stats.tickMs / this.stats.ticks : 0 };
  }
}

module.exports = { Room, HIST, CATCHUP, COUNTDOWN_TICKS, RESULTS_AUTO };
