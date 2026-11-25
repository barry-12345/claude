export type QualityTier = 'HIGH' | 'MEDIUM' | 'LOW';

export interface QualityPreset {
  readonly dprCap: number;
  readonly shadowMapSize: number;
  readonly particleScale: number;
}

export const QUALITY_PRESETS: Readonly<Record<QualityTier, QualityPreset>> = {
  HIGH: { dprCap: 2.0, shadowMapSize: 1024, particleScale: 1.0 },
  MEDIUM: { dprCap: 1.5, shadowMapSize: 512, particleScale: 0.5 },
  LOW: { dprCap: 1.0, shadowMapSize: 0, particleScale: 0.0 },
};

const WINDOW_SIZE = 60;
const REFRESH_SAMPLE_TARGET = 30;

export interface PerfMetrics {
  qualityTier: QualityTier;
  activeDpr: number;
  estHz: number;
  fpsCapEnabled: boolean;
  upgradeCount: number;
  fps: number;
  avgFrameMs: number;
  maxFrameMs: number;
  p95FrameMs: number;
}

export class PerfManager {
  private tier: QualityTier = 'HIGH';
  private upgradeCount = 0;
  private hasDowngraded = false;

  private frames: number[] = [];
  private downgradeAccumSec = 0;
  private upgradeAccumSec = 0;

  private refreshSamplesMs: number[] = [];
  private estHz = 60;
  private fpsCapEnabled = false;
  private simulatedHz: number | null = null;

  private spikeFrameMs: number | null = null;
  private spikeRemainingMs = 0;

  private deviceDpr = 1;
  private fps = 60;

  public setDevicePixelRatio(dpr: number): void {
    this.deviceDpr = Math.max(1, Number.isFinite(dpr) ? dpr : 1);
  }

  public getQualityTier(): QualityTier {
    return this.tier;
  }

  public getPreset(): QualityPreset {
    return QUALITY_PRESETS[this.tier];
  }

  public getActiveDpr(): number {
    return Math.min(this.deviceDpr, QUALITY_PRESETS[this.tier].dprCap, 2.0);
  }

  public getEstHz(): number {
    return this.estHz;
  }

  public isFpsCapEnabled(): boolean {
    return this.fpsCapEnabled;
  }

  public getUpgradeCount(): number {
    return this.upgradeCount;
  }

  /**
   * Sample display refresh rate from initial RAF deltas (only caps at 60fps when estHz > 105).
   */
  public recordRafDelta(deltaMs: number): void {
    if (this.simulatedHz !== null) {
      return;
    }
    if (!Number.isFinite(deltaMs) || deltaMs < 3 || deltaMs > 50) {
      return;
    }
    if (this.refreshSamplesMs.length < REFRESH_SAMPLE_TARGET) {
      this.refreshSamplesMs.push(deltaMs);
      if (this.refreshSamplesMs.length >= 10) {
        const sorted = [...this.refreshSamplesMs].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const rawHz = Math.round(1000 / Math.max(4, median));
        this.estHz = rawHz;
        this.fpsCapEnabled = rawHz > 105;
      }
    }
  }

  public simulateRefreshRate(hz: number): void {
    const clean = Math.max(30, Math.round(hz));
    this.simulatedHz = clean;
    this.estHz = clean;
    this.fpsCapEnabled = clean > 105;
  }

  public simulatePerfSpike(frameMs: number, durationMs: number): void {
    if (durationMs <= 0) {
      this.spikeFrameMs = null;
      this.spikeRemainingMs = 0;
      return;
    }
    this.spikeFrameMs = Math.max(1, frameMs);
    this.spikeRemainingMs = durationMs;
  }

  /**
   * Record one rendered/simulated frame duration and evaluate adaptive tier changes.
   * `realDeltaMs` represents actual wall-clock elapsed time for timer accumulation.
   */
  public recordFrame(frameMs: number, realDeltaMs = frameMs): void {
    const dtMs = Math.max(1, Math.min(250, realDeltaMs));
    let effectiveMs = Math.max(0.5, frameMs);

    if (this.spikeFrameMs !== null && this.spikeRemainingMs > 0) {
      effectiveMs = this.spikeFrameMs;
      this.spikeRemainingMs = Math.max(0, this.spikeRemainingMs - dtMs);
      if (this.spikeRemainingMs <= 0) {
        this.spikeFrameMs = null;
      }
    }

    this.frames.push(effectiveMs);
    if (this.frames.length > WINDOW_SIZE) {
      this.frames.shift();
    }

    const dtSec = dtMs / 1000;
    const avgMs = this.computeAverage(this.frames);
    this.fps = avgMs > 0 ? Math.min(240, Math.round(1000 / avgMs)) : 60;

    if (this.frames.length < 20) {
      return;
    }

    const slowCount = this.frames.reduce((acc, v) => (v > 20 ? acc + 1 : acc), 0);
    const slowRatio = slowCount / this.frames.length;

    if (slowRatio > 0.3 && this.tier !== 'LOW') {
      this.downgradeAccumSec += dtSec;
      this.upgradeAccumSec = 0;
      if (this.downgradeAccumSec >= 2.0) {
        this.tier = this.tier === 'HIGH' ? 'MEDIUM' : 'LOW';
        this.hasDowngraded = true;
        this.downgradeAccumSec = 0;
        this.upgradeAccumSec = 0;
      }
      return;
    }

    this.downgradeAccumSec = 0;

    if (this.hasDowngraded && this.upgradeCount < 1 && this.tier !== 'HIGH') {
      const p95 = this.computeP95(this.frames);
      if (avgMs < 13.5 && p95 < 16.5) {
        this.upgradeAccumSec += dtSec;
        if (this.upgradeAccumSec >= 8.0) {
          this.tier = this.tier === 'LOW' ? 'MEDIUM' : 'HIGH';
          this.upgradeCount += 1;
          this.upgradeAccumSec = 0;
          this.downgradeAccumSec = 0;
        }
      } else {
        this.upgradeAccumSec = 0;
      }
    }
  }

  public getMetrics(): PerfMetrics {
    const avgFrameMs = this.computeAverage(this.frames);
    const maxFrameMs = this.frames.length > 0 ? Math.max(...this.frames) : 0;
    const p95FrameMs = this.computeP95(this.frames);
    return {
      qualityTier: this.tier,
      activeDpr: this.getActiveDpr(),
      estHz: this.estHz,
      fpsCapEnabled: this.fpsCapEnabled,
      upgradeCount: this.upgradeCount,
      fps: this.fps,
      avgFrameMs: Number(avgFrameMs.toFixed(1)),
      maxFrameMs: Number(maxFrameMs.toFixed(1)),
      p95FrameMs: Number(p95FrameMs.toFixed(1)),
    };
  }

  private computeAverage(arr: number[]): number {
    if (arr.length === 0) return 16.6;
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
  }

  private computeP95(arr: number[]): number {
    if (arr.length === 0) return 16.6;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return sorted[idx];
  }
}
