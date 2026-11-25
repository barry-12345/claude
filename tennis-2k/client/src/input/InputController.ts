import type {
  InputDiagnostics,
  InputPhase,
  PlayerInputFrame,
  ShotActionKey,
} from '@court2k/shared';
import type { ClientInputController } from '../contracts.js';

export interface InputTargetEnv {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

export interface DocumentLike {
  visibilityState?: string;
  activeElement?: { blur?: () => void } | null;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

const GAMEPLAY_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyJ',
  'KeyK',
  'KeyL',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);

function mapActionCode(code: string): ShotActionKey | null {
  if (code === 'KeyJ') return 'J';
  if (code === 'KeyK') return 'K';
  if (code === 'KeyL') return 'L';
  return null;
}

export class InputController implements ClientInputController {
  private readonly win: InputTargetEnv | null;
  private readonly doc: DocumentLike | null;

  private attached = false;
  private pressedKeys = new Set<string>();
  private rebindCount = 0;
  private lastResetReason: string | null = null;

  private allowArrowKeys = true;
  private captureActive = false;

  private currentAction: ShotActionKey = 'none';
  private heldSent = false;
  private pendingReleaseAction: ShotActionKey | null = null;
  private queuedTapAction: ShotActionKey | null = null;

  private onEscapeCb: (() => void) | null = null;

  private readonly handleKeyDown = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    const code = e.code;

    if (code === 'Escape' && !e.repeat) {
      if (this.captureActive) {
        e.preventDefault?.();
        this.onEscapeCb?.();
      }
      return;
    }

    if (!this.captureActive) {
      return;
    }

    if (GAMEPLAY_CODES.has(code)) {
      e.preventDefault?.();
    }

    this.pressedKeys.add(code);

    const action = mapActionCode(code);
    if (action && !e.repeat && this.currentAction === 'none') {
      this.currentAction = action;
      this.heldSent = false;
      this.pendingReleaseAction = null;
      this.queuedTapAction = null;
    }
  };

  private readonly handleKeyUp = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    const code = e.code;
    this.pressedKeys.delete(code);

    const action = mapActionCode(code);
    if (action && this.currentAction === action) {
      if (this.heldSent) {
        this.pendingReleaseAction = action;
      } else {
        this.queuedTapAction = action;
      }
      this.currentAction = 'none';
      this.heldSent = false;
    }
  };

  private readonly handleBlur = (): void => {
    this.resetAndRebind('window_blur');
  };

  private readonly handleFocus = (): void => {
    this.resetAndRebind('window_focus');
  };

  private readonly handleVisibilityChange = (): void => {
    const vis = this.doc?.visibilityState;
    if (vis === 'hidden') {
      this.resetAndRebind('visibility_hidden');
    } else if (vis === 'visible') {
      this.resetAndRebind('visibility_visible');
    }
  };

  constructor(
    win: InputTargetEnv | null = typeof window !== 'undefined' ? window : null,
    doc: DocumentLike | null = typeof document !== 'undefined' ? (document as unknown as DocumentLike) : null
  ) {
    this.win = win;
    this.doc = doc;
  }

  public setEscapeHandler(cb: (() => void) | null): void {
    this.onEscapeCb = cb;
  }

  public setAllowArrowKeys(allow: boolean): void {
    this.allowArrowKeys = allow;
  }

  public setCaptureActive(active: boolean): void {
    this.captureActive = active;
    if (!active) {
      this.clearHeldState();
    }
  }

  public attach(): void {
    if (this.attached || !this.win) {
      return;
    }
    this.win.addEventListener('keydown', this.handleKeyDown);
    this.win.addEventListener('keyup', this.handleKeyUp);
    this.win.addEventListener('blur', this.handleBlur);
    this.win.addEventListener('focus', this.handleFocus);
    this.doc?.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.attached = true;
  }

  public detach(): void {
    if (!this.attached || !this.win) {
      return;
    }
    this.win.removeEventListener('keydown', this.handleKeyDown);
    this.win.removeEventListener('keyup', this.handleKeyUp);
    this.win.removeEventListener('blur', this.handleBlur);
    this.win.removeEventListener('focus', this.handleFocus);
    this.doc?.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.attached = false;
  }

  public resetAndRebind(reason: string): void {
    this.clearHeldState();
    this.rebindCount += 1;
    this.lastResetReason = reason;
    this.detach();
    this.attach();
    const activeEl = this.doc?.activeElement;
    if (activeEl && typeof activeEl.blur === 'function') {
      activeEl.blur();
    }
  }

  public sampleFrame(seq: number): PlayerInputFrame {
    let moveX = 0;
    let moveZ = 0;

    if (this.captureActive) {
      const left = this.pressedKeys.has('KeyA') || (this.allowArrowKeys && this.pressedKeys.has('ArrowLeft'));
      const right = this.pressedKeys.has('KeyD') || (this.allowArrowKeys && this.pressedKeys.has('ArrowRight'));
      const up = this.pressedKeys.has('KeyW') || (this.allowArrowKeys && this.pressedKeys.has('ArrowUp'));
      const down = this.pressedKeys.has('KeyS') || (this.allowArrowKeys && this.pressedKeys.has('ArrowDown'));

      if (left) moveX -= 1;
      if (right) moveX += 1;
      if (up) moveZ -= 1;
      if (down) moveZ += 1;
    }

    let action: ShotActionKey = 'none';
    let phase: InputPhase = 'idle';

    if (this.captureActive) {
      if (this.queuedTapAction) {
        action = this.queuedTapAction;
        phase = 'hold';
        this.pendingReleaseAction = this.queuedTapAction;
        this.queuedTapAction = null;
      } else if (this.pendingReleaseAction) {
        action = this.pendingReleaseAction;
        phase = 'release';
        this.pendingReleaseAction = null;
      } else if (this.currentAction !== 'none') {
        action = this.currentAction;
        phase = 'hold';
        this.heldSent = true;
      }
    }

    return {
      seq,
      moveX,
      moveZ,
      aimX: moveX,
      aimZ: moveZ,
      action,
      phase,
    };
  }

  public getDiagnostics(): InputDiagnostics {
    return {
      attached: this.attached,
      pressedCount: this.pressedKeys.size,
      rebindCount: this.rebindCount,
      lastResetReason: this.lastResetReason,
    };
  }

  private clearHeldState(): void {
    this.pressedKeys.clear();
    this.currentAction = 'none';
    this.heldSent = false;
    this.pendingReleaseAction = null;
    this.queuedTapAction = null;
  }
}
