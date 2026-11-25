import { PHYSICS_CONSTANTS, SHOT_METER_MULT } from './constants.js';
import type { ArchetypeConfig, ShotQuality, ShotType } from './types.js';

/**
 * Compute base green window half-width from player TIM rating.
 */
export function computeBaseGreenHalfWidth(timingRating: number): number {
  return 0.055 + (timingRating - 75) * 0.0012;
}

/**
 * Evaluate 2K shot meter quality with unconditional priority rule for progress >= 1.18.
 */
export function computeShotQuality(
  progress: number,
  archetype: ArchetypeConfig,
  ctx: { shotType: ShotType; isTakeover: boolean; isSliding: boolean }
): { quality: ShotQuality; effectiveHalfWidth: number; error: number } {
  const baseWidth = computeBaseGreenHalfWidth(archetype.timing);
  const mShot = SHOT_METER_MULT[ctx.shotType];
  const mTakeover = ctx.isTakeover ? PHYSICS_CONSTANTS.TAKEOVER_WIDTH_MULT : 1.0;
  const mPressure = ctx.isSliding ? 0.78 : 1.0;

  const effectiveHalfWidth = baseWidth * mShot * mTakeover * mPressure;
  const error = Math.abs(progress - PHYSICS_CONSTANTS.METER_SWEET_CENTER);

  if (progress >= PHYSICS_CONSTANTS.METER_MAX_PROGRESS) {
    return {
      quality: 'VERY_LATE',
      effectiveHalfWidth,
      error,
    };
  }

  let quality: ShotQuality;
  if (error <= effectiveHalfWidth) {
    quality = 'PERFECT';
  } else if (error <= 2.4 * effectiveHalfWidth) {
    quality = 'GOOD';
  } else if (error <= 4.0 * effectiveHalfWidth) {
    quality = progress < PHYSICS_CONSTANTS.METER_SWEET_CENTER ? 'EARLY' : 'LATE';
  } else {
    quality = progress < PHYSICS_CONSTANTS.METER_SWEET_CENTER ? 'VERY_EARLY' : 'VERY_LATE';
  }

  return {
    quality,
    effectiveHalfWidth,
    error,
  };
}

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
