import { ROOM_CODE_ALPHABET } from './constants.js';
import type { PRNG } from './types.js';

/**
 * Create a deterministic Mulberry32 PRNG instance. Never uses Math.random().
 */
export function createRng(seed: number): PRNG {
  let state = seed >>> 0;
  const initialSeed = state;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const range = (min: number, max: number): number => min + next() * (max - min);

  return {
    next,
    range,
    getSeed: () => initialSeed,
  };
}

/**
 * Generate a 4-character room code from the unambiguous 32-char alphabet.
 */
export function generateRoomCode(rng: PRNG): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    const idx = Math.floor(rng.next() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[idx];
  }
  return code;
}
