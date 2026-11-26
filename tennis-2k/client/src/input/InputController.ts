import type {
  InputDiagnostics,
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

function mapActionCode(code: string): Exclude<ShotActionKey, 'none'> | null {
  if (code === 'KeyJ') return 'J';
  if (code === 'KeyK') return 'K';
  if (code === 'KeyL') return 'L';
  return null;
}

/**
 * V2 deterministic keyboard input sampler implementing all 4 CONTRACT §5.1 edge rules:
 * 1. Ignores browser keydown auto-repeat (`e.repeat === true`) for `actionPressed`.
 * 2. Latches a single-frame `{ action, actionPressed: true }` if keydown+keyup occur within one frame.
 * 3. Supports seamless switching between J/K/L while holding without old keyup clearing the new key.
 * 4. Full state clear + listener rebind + blur on `resetAndRebind()`.
 */
export class InputController implements ClientInputController {
  private readonly win: InputTargetEnv | null;
  private readonly doc: DocumentLike | null;

  private attached = false;
  private pressedKeys = new Set<string>();
  private rebindCount = 0;
  private lastResetReason: string | null = null;

  private allowArrowKeys = true;
  private captureActive = false;

  private heldActionOrder: Array<Exclude<ShotActionKey, 'none'>> = [];
  private currentAction: ShotActionKey = 'none';
  private pendingPressAction: Exclude<ShotActionKey, 'none'> | null = null;

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
    if (!action || e.repeat) {
      return;
    }

    // Rule 3: Pressing another shot key switches immediately & emits actionPressed;
    // ignore duplicate non-repeat keydown if already tracked in heldActionOrder.
    if (!this.heldActionOrder.includes(action)) {
      this.heldActionOrder.push(action);
      this.currentAction = action;
      this.pendingPressAction = action;
    }
  };

  private readonly handleKeyUp = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    const code = e.code;
    this.pressedKeys.delete(code);

    const action = mapActionCode(code);
    if (!action) {
      return;
    }

    const idx = this.heldActionOrder.indexOf(action);
    if (idx !== -1) {
      this.heldActionOrder.splice(idx, 1);
    }

    if (this.currentAction === action) {
      // Rule 3: Fall back to any remaining held shot key without re-emitting actionPressed
      this.currentAction =
        this.heldActionOrder.length > 0
          ? this.heldActionOrder[this.heldActionOrder.length - 1]
          : 'none';
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
    if (this.captureActive || reason !== 'window_focus') {
      const activeEl = this.doc?.activeElement;
      if (activeEl && typeof activeEl.blur === 'function') {
        activeEl.blur();
      }
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
    let actionPressed = false;

    if (this.captureActive) {
      if (this.pendingPressAction !== null) {
        action = this.pendingPressAction;
        actionPressed = true;
        this.pendingPressAction = null;
      } else {
        action = this.currentAction;
        actionPressed = false;
      }
    }

    return {
      seq,
      moveX,
      moveZ,
      aimX: moveX,
      aimZ: moveZ,
      action,
      actionPressed,
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
    this.heldActionOrder = [];
    this.currentAction = 'none';
    this.pendingPressAction = null;
  }
}
