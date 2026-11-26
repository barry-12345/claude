import type { CourtId, KeyPointLabel, ShotQuality, ShotType } from '@court2k/shared';

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.72, this.ctx.currentTime, 0.01);
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public unlock(): void {
    try {
      const ctx = this.ensureContext();
      if (ctx && ctx.state === 'suspended') {
        void ctx.resume();
      }
    } catch {
      // Ignore AudioContext restriction errors in headless/locked environments
    }
  }

  public playShotHit(shotType: ShotType, quality: ShotQuality, court: CourtId): void {
    const ctx = this.ensureReady();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const isServe = shotType === 'serve_flat' || shotType === 'serve_kick';
    const isSlice = shotType === 'slice' || shotType === 'dropshot';
    const isStretch = quality === 'STRETCH';

    // Core racquet thump
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isSlice ? 'triangle' : 'sine';
    const startFreq = isServe ? 260 : isSlice ? 190 : isStretch ? 175 : 225;
    const endFreq = isServe ? 75 : isStretch ? 68 : 85;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.085);

    const vol = (isServe ? 0.42 : isSlice ? 0.26 : 0.34) * (isStretch ? 0.78 : 1.0);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.1);

    // String pop noise
    this.playNoiseBurst(
      isSlice ? 2600 : court === 'hard' ? 1900 : 1450,
      isServe ? 0.08 : 0.055,
      (isSlice ? 0.14 : 0.22) * (isStretch ? 0.72 : 1.0)
    );

    // CLEAN sweet-spot chime
    if (quality === 'CLEAN') {
      const chime = ctx.createOscillator();
      const chimeGain = ctx.createGain();
      chime.type = 'triangle';
      chime.frequency.setValueAtTime(680, now);
      chime.frequency.exponentialRampToValueAtTime(1020, now + 0.13);
      chimeGain.gain.setValueAtTime(0.2, now);
      chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      chime.connect(chimeGain);
      chimeGain.connect(this.masterGain);
      chime.start(now);
      chime.stop(now + 0.19);
    }
  }

  public playBounce(court: CourtId, inBounds: boolean): void {
    const ctx = this.ensureReady();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';

    const baseFreq = court === 'hard' ? 165 : court === 'clay' ? 122 : 138;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.065);

    gain.gain.setValueAtTime(inBounds ? 0.22 : 0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.075);

    if (court === 'clay') {
      this.playNoiseBurst(900, 0.06, 0.09);
    }
  }

  public playNetLet(): void {
    const ctx = this.ensureReady();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.14);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playHawkeyePulse(isIn: boolean): void {
    const ctx = this.ensureReady();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const sweep = ctx.createOscillator();
    const sg = ctx.createGain();
    sweep.type = 'sine';
    sweep.frequency.setValueAtTime(440, now);
    sweep.frequency.linearRampToValueAtTime(isIn ? 880 : 280, now + 0.35);
    sg.gain.setValueAtTime(0.18, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    sweep.connect(sg);
    sg.connect(this.masterGain);
    sweep.start(now);
    sweep.stop(now + 0.46);
  }

  public playPointScored(playerWon: boolean, keyPoint: KeyPointLabel): void {
    const ctx = this.ensureReady();
    if (!ctx || !this.masterGain) return;

    // Crowd applause burst
    this.playNoiseBurst(1200, playerWon ? 0.55 : 0.3, playerWon ? 0.14 : 0.07);

    if (keyPoint !== 'NONE' || playerWon) {
      const now = ctx.currentTime;
      const notes = playerWon ? [523.25, 659.25] : [392.0, 329.63];
      notes.forEach((freq, idx) => {
        if (!this.masterGain) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.09);
        g.gain.setValueAtTime(0.13, now + idx * 0.09);
        g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.2);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(now + idx * 0.09);
        osc.stop(now + idx * 0.09 + 0.22);
      });
    }
  }

  public playCountdownTick(finalTick: boolean): void {
    const ctx = this.ensureReady();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(finalTick ? 880 : 587.33, now);
    g.gain.setValueAtTime(0.15, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + (finalTick ? 0.22 : 0.1));
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + (finalTick ? 0.24 : 0.12));
  }

  public dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.masterGain = null;
      this.noiseBuffer = null;
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;

    this.ctx = new AudioCtor();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 0.72;
    this.masterGain.connect(this.ctx.destination);

    // Prebuild 0.6s white noise buffer
    const len = Math.floor(this.ctx.sampleRate * 0.6);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buf;
    return this.ctx;
  }

  private ensureReady(): AudioContext | null {
    if (this.muted) return null;
    try {
      const ctx = this.ensureContext();
      if (!ctx || ctx.state !== 'running') return null;
      return ctx;
    } catch {
      return null;
    }
  }

  private playNoiseBurst(filterFreq: number, durationSec: number, gainPeak: number): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 1.2;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainPeak, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

    src.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    src.start(now);
    src.stop(now + durationSec + 0.02);
  }
}
