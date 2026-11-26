import { PHYSICS_CONSTANTS } from './constants.js';
import { clamp } from './physics.js';
import type { ArchetypeConfig, ShotQuality } from './types.js';

/**
 * Compute maximum movement speed (m/s) from player SPD rating.
 */
export function computePlayerMaxSpeed(speedRating: number): number {
  return 5.4 + (speedRating - 60) * 0.048;
}

/**
 * Compute shot velocity multiplier from player POW rating.
 */
export function computePowerMultiplier(powerRating: number): number {
  return 1.0 + (powerRating - 80) * 0.008;
}

/**
 * Compute spin multiplier from player SPN rating.
 */
export function computeSpinMultiplier(spinRating: number): number {
  return 1.0 + (spinRating - 80) * 0.01;
}

/**
 * Compute net/dropshot accuracy multiplier from player NET rating.
 */
export function computeNetAccuracyMultiplier(netRating: number): number {
  return 1.0 + (netRating - 75) * 0.012;
}

/**
 * Compute comfortable CLEAN contact radius (m) from player CTL rating.
 */
export function computeComfortRadius(controlRating: number): number {
  return (
    PHYSICS_CONSTANTS.BASE_COMFORT_RADIUS_M +
    (controlRating - 75) * PHYSICS_CONSTANTS.COMFORT_RADIUS_PER_CTL_M
  );
}

/**
 * Compute landing scatter (m) for a given ShotQuality and player CTL rating.
 */
export function computeControlScatterM(quality: ShotQuality, controlRating: number): number {
  if (quality === 'CLEAN') {
    return 0.03;
  }
  if (quality === 'SOLID') {
    return Math.max(0.14, 0.28 - (controlRating - 75) * 0.006);
  }
  return Math.max(0.38, 0.68 - (controlRating - 75) * 0.012);
}

/**
 * Compute out-of-bounds probability when pushing sidelines under STRETCH quality.
 */
export function computeStretchSidelineErrorProb(controlRating: number): number {
  return clamp(0.14 - (controlRating - 75) * 0.004, 0.04, 0.22);
}

/**
 * Compute natural corner fault probability for extreme-corner flat 1st serve.
 */
export function computeFirstServeCornerFaultProb(controlRating: number): number {
  return clamp(0.10 - (controlRating - 75) * 0.003, 0.03, 0.16);
}

/**
 * Evaluate V2 position-based ShotQuality ('CLEAN' | 'SOLID' | 'STRETCH').
 */
export function computePositionShotQuality(
  contactDistM: number,
  archetype: ArchetypeConfig,
  isSliding: boolean
): { quality: ShotQuality; comfortRadiusM: number } {
  const comfortRadiusM = computeComfortRadius(archetype.control);
  let quality: ShotQuality;
  if (isSliding || contactDistM > PHYSICS_CONSTANTS.BASE_REACH_RADIUS_M) {
    quality = 'STRETCH';
  } else if (contactDistM <= comfortRadiusM) {
    quality = 'CLEAN';
  } else {
    quality = 'SOLID';
  }
  return { quality, comfortRadiusM };
}
