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
});
