const MUTE_KEY = 'candy_td_muted';
const THROTTLED_SOUNDS = new Set(['pop', 'frost', 'boom', 'laser', 'shield_hit', 'heal_pulse']);
const AUDIO_COOLDOWN_MS = 65;

export class CandyAudio {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    try {
      this.muted = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
    this.eventLog = [];
    this._lastPlayAt = new Map();
  }

  _ensureContext() {
    if (typeof window === 'undefined') return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!this.ctx) {
      this.ctx = new AC();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.25;
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  unlock() {
    const ctx = this._ensureContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
      }
    } catch {
      // Fallback to in-memory mute state when storage is restricted
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : 0.25, this.ctx.currentTime);
    }
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  _tone({ type = 'sine', freq = 520, freqEnd = null, duration = 0.1, gain = 0.28, delay = 0 }) {
    const ctx = this._ensureContext();
    if (!ctx || !this.masterGain || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + duration);
    }
    g.gain.setValueAtTime(0.001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  play(name) {
    const now = Date.now();
    if (THROTTLED_SOUNDS.has(name)) {
      const last = this._lastPlayAt.get(name) || 0;
      if (now - last < AUDIO_COOLDOWN_MS) {
        return false;
      }
      this._lastPlayAt.set(name, now);
    }

    this.eventLog.push({ name, at: now });
    if (this.eventLog.length > 50) this.eventLog.shift();

    if (this.muted) return false;

    switch (name) {
      case 'build':
        this._tone({ type: 'triangle', freq: 420, freqEnd: 660, duration: 0.11, gain: 0.3 });
        break;
      case 'upgrade':
        this._tone({ type: 'triangle', freq: 523, duration: 0.08, gain: 0.25, delay: 0 });
        this._tone({ type: 'triangle', freq: 659, duration: 0.08, gain: 0.25, delay: 0.07 });
        this._tone({ type: 'triangle', freq: 784, duration: 0.14, gain: 0.28, delay: 0.14 });
        break;
      case 'demolish':
        this._tone({ type: 'sawtooth', freq: 240, freqEnd: 110, duration: 0.11, gain: 0.22, delay: 0 });
        this._tone({ type: 'triangle', freq: 740, freqEnd: 1120, duration: 0.12, gain: 0.2, delay: 0.07 });
        break;
      case 'coin':
        this._tone({ type: 'sine', freq: 880, duration: 0.07, gain: 0.22, delay: 0 });
        this._tone({ type: 'sine', freq: 1175, duration: 0.12, gain: 0.22, delay: 0.06 });
        break;
      case 'pop':
        this._tone({ type: 'sine', freq: 540, freqEnd: 290, duration: 0.06, gain: 0.12 });
        break;
      case 'frost':
        this._tone({ type: 'triangle', freq: 920, freqEnd: 1320, duration: 0.1, gain: 0.14 });
        break;
      case 'frost_nova':
        this._tone({ type: 'sine', freq: 1200, freqEnd: 620, duration: 0.22, gain: 0.2, delay: 0 });
        this._tone({ type: 'triangle', freq: 1480, freqEnd: 980, duration: 0.18, gain: 0.16, delay: 0.04 });
        break;
      case 'boom':
        this._tone({ type: 'sawtooth', freq: 190, freqEnd: 75, duration: 0.15, gain: 0.18 });
        break;
      case 'laser':
        this._tone({ type: 'sawtooth', freq: 1240, freqEnd: 410, duration: 0.12, gain: 0.16 });
        break;
      case 'execute':
        this._tone({ type: 'sawtooth', freq: 1480, freqEnd: 280, duration: 0.16, gain: 0.24, delay: 0 });
        this._tone({ type: 'triangle', freq: 980, freqEnd: 1560, duration: 0.12, gain: 0.2, delay: 0.05 });
        break;
      case 'shield_hit':
        this._tone({ type: 'sine', freq: 1080, freqEnd: 820, duration: 0.06, gain: 0.14 });
        break;
      case 'shield_break':
        this._tone({ type: 'triangle', freq: 980, freqEnd: 340, duration: 0.16, gain: 0.22, delay: 0 });
        this._tone({ type: 'sine', freq: 1420, freqEnd: 620, duration: 0.12, gain: 0.16, delay: 0.04 });
        break;
      case 'heal_pulse':
        this._tone({ type: 'sine', freq: 520, freqEnd: 780, duration: 0.15, gain: 0.14 });
        break;
      case 'express_honk':
        this._tone({ type: 'square', freq: 440, duration: 0.09, gain: 0.16, delay: 0 });
        this._tone({ type: 'square', freq: 554, duration: 0.14, gain: 0.16, delay: 0.11 });
        break;
      case 'hurt':
        this._tone({ type: 'sawtooth', freq: 310, freqEnd: 180, duration: 0.14, gain: 0.2 });
        break;
      case 'win':
        this._tone({ type: 'triangle', freq: 523, duration: 0.12, gain: 0.28, delay: 0 });
        this._tone({ type: 'triangle', freq: 659, duration: 0.12, gain: 0.28, delay: 0.12 });
        this._tone({ type: 'triangle', freq: 784, duration: 0.12, gain: 0.28, delay: 0.24 });
        this._tone({ type: 'triangle', freq: 1046, duration: 0.26, gain: 0.3, delay: 0.36 });
        break;
      case 'lose':
        this._tone({ type: 'triangle', freq: 440, duration: 0.14, gain: 0.24, delay: 0 });
        this._tone({ type: 'triangle', freq: 370, duration: 0.16, gain: 0.24, delay: 0.14 });
        this._tone({ type: 'triangle', freq: 294, duration: 0.25, gain: 0.24, delay: 0.3 });
        break;
      default:
        break;
    }
  }
}
