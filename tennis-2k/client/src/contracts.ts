import type * as THREE from 'three';
import type {
  ArchetypeConfig,
  InputDiagnostics,
  PlayerInputFrame,
  PlayerState,
  ScorePatch,
  TestStateSnapshot,
} from '@court2k/shared';

export interface PlayerAvatarController {
  readonly root: THREE.Group;
  setArchetype(config: ArchetypeConfig): void;
  updatePose(player: PlayerState, dt: number): void;
  dispose(): void;
}

export interface ClientInputController {
  attach(): void;
  detach(): void;
  resetAndRebind(reason: string): void;
  sampleFrame(seq: number): PlayerInputFrame;
  getDiagnostics(): InputDiagnostics;
}

export interface Court2KTestHook {
  getState(): Readonly<TestStateSnapshot>;
  setSeed(seed: number): void;
  setScore(patch: ScorePatch): void;
  setTakeover(playerIndex: 0 | 1, value: number): void;
  triggerHawkeyeShot(opts: { inBounds: boolean; distCm: number; line?: 'sideline' | 'baseline' }): void;
  fastForwardPause(seconds: number): void;
  simulatePerfSpike(frameMs: number, durationMs: number): void;
  simulateRefreshRate(hz: number): void;
  simulateDisconnect(reconnectAfterMs: number): void;
}
