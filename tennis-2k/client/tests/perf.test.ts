import { describe, expect, it } from 'vitest';
import { PerfManager } from '../src/core/PerfManager.js';

describe('PerfManager DPR, Adaptive Tiers, and Refresh Cap', () => {
  it('caps active DPR at 2.0 regardless of high Retina devicePixelRatio', () => {
    const pm = new PerfManager();
    pm.setDevicePixelRatio(1);
    expect(pm.getActiveDpr()).toBe(1);

    pm.setDevicePixelRatio(3);
    expect(pm.getQualityTier()).toBe('HIGH');
    expect(pm.getActiveDpr()).toBe(2.0);
  });

  it('downgrades after 2s of >30% slow frames (>20ms), upgrades once after 8s stable, and never upgrades twice', () => {
    const pm = new PerfManager();
    pm.setDevicePixelRatio(3);

    // 2.5 seconds of 26ms frames -> HIGH -> MEDIUM
    for (let t = 0; t < 2500; t += 25) {
      pm.recordFrame(26, 25);
    }
    expect(pm.getQualityTier()).toBe('MEDIUM');
    expect(pm.getActiveDpr()).toBe(1.5);
    expect(pm.getUpgradeCount()).toBe(0);

    // 9 seconds of 10ms frames -> MEDIUM -> HIGH (upgradeCount becomes 1)
    for (let t = 0; t < 9000; t += 16) {
      pm.recordFrame(10, 16);
    }
    expect(pm.getQualityTier()).toBe('HIGH');
    expect(pm.getUpgradeCount()).toBe(1);

    // Second spike -> HIGH -> MEDIUM
    for (let t = 0; t < 2500; t += 25) {
      pm.recordFrame(26, 25);
    }
    expect(pm.getQualityTier()).toBe('MEDIUM');

    // Second recovery 10 seconds -> MUST NOT upgrade again (upgradeCount <= 1)
    for (let t = 0; t < 10000; t += 16) {
      pm.recordFrame(9, 16);
    }
    expect(pm.getQualityTier()).toBe('MEDIUM');
    expect(pm.getUpgradeCount()).toBe(1);
  });

  it('enables 60fps cap only when estHz > 105 (90/100Hz uncapped, 120/144Hz capped)', () => {
    for (const hz of [60, 90, 100]) {
      const pm = new PerfManager();
      const dt = 1000 / hz;
      for (let i = 0; i < 30; i++) {
        pm.recordRafDelta(dt);
      }
      expect(pm.isFpsCapEnabled()).toBe(false);
    }

    for (const hz of [120, 144]) {
      const pm = new PerfManager();
      const dt = 1000 / hz;
      for (let i = 0; i < 30; i++) {
        pm.recordRafDelta(dt);
      }
      expect(pm.isFpsCapEnabled()).toBe(true);
    }
  });

  it('recovers once on healthy 60Hz VSync (~16.67ms interval) after downgrade', () => {
    const pm = new PerfManager();
    pm.setDevicePixelRatio(2);
    for (let i = 0; i < 30; i++) pm.recordRafDelta(16.6667);

    // Simulate 2.8s GPU stall (20-frame warmup + 2.0s sustained >20ms) -> HIGH -> MEDIUM
    for (let t = 0; t < 2800; t += 33) {
      pm.recordFrame(4, 33, 33);
    }
    expect(pm.getQualityTier()).toBe('MEDIUM');

    // Recover for 9s at steady 60Hz VSync (16.67ms presentation interval, 3ms JS/GPU work)
    for (let t = 0; t < 9000; t += 16.6667) {
      pm.recordFrame(3, 16.6667, 16.6667);
    }
    expect(pm.getQualityTier()).toBe('HIGH');
    expect(pm.getUpgradeCount()).toBe(1);
  });

  it('keeps 144Hz capped at ~60fps without false-downgrading on alternating 13.89ms/20.83ms cadence', () => {
    const pm = new PerfManager();
    pm.setDevicePixelRatio(2);
    const rafStep = 1000 / 144;
    for (let i = 0; i < 30; i++) pm.recordRafDelta(rafStep);
    expect(pm.isFpsCapEnabled()).toBe(true);

    let nextRenderAtMs = 0;
    let lastRenderMs = 0;
    let rendered = 0;
    for (let now = 0; now <= 10000; now += rafStep) {
      if (now < nextRenderAtMs) continue;
      nextRenderAtMs += 1000 / 60;
      if (now - nextRenderAtMs > 34) nextRenderAtMs = now + 1000 / 60;
      const renderDtMs = Math.max(1, now - lastRenderMs);
      lastRenderMs = now;
      rendered += 1;
      pm.recordFrame(3.2, renderDtMs, renderDtMs);
    }

    expect(pm.getQualityTier()).toBe('HIGH');
    expect(pm.getMetrics().fps).toBeGreaterThanOrEqual(58);
    expect(pm.getMetrics().fps).toBeLessThanOrEqual(62);
    expect(rendered).toBeGreaterThanOrEqual(590);
    expect(rendered).toBeLessThanOrEqual(610);
  });
});
