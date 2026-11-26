import { describe, expect, it, vi } from 'vitest';
import { InputController, type DocumentLike, type InputTargetEnv } from '../src/input/InputController.js';

class MockEventBus implements InputTargetEnv, DocumentLike {
  public visibilityState = 'visible';
  public activeElement: { blur: () => void } | null = null;
  private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, payload: Record<string, unknown> = {}): void {
    const ev = { preventDefault: vi.fn(), repeat: false, ...payload } as unknown as Event;
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      if (typeof listener === 'function') listener(ev);
      else listener.handleEvent(ev);
    }
  }
}

describe('InputController V2 edge rules & resetAndRebind self-healing', () => {
  it('samples WASD + J/K/L and W+K dropshot intent with actionPressed edge', () => {
    const bus = new MockEventBus();
    const ic = new InputController(bus, bus);
    ic.attach();
    ic.setCaptureActive(true);

    bus.emit('keydown', { code: 'KeyW' });
    bus.emit('keydown', { code: 'KeyK' });
    const f1 = ic.sampleFrame(1);
    expect(f1).toEqual({
      seq: 1,
      moveX: 0,
      moveZ: -1,
      aimX: 0,
      aimZ: -1,
      action: 'K',
      actionPressed: true,
    });

    // Holding K on next frame keeps action='K' but actionPressed=false
    const f2 = ic.sampleFrame(2);
    expect(f2.action).toBe('K');
    expect(f2.actionPressed).toBe(false);
    expect(f2.aimZ).toBe(-1);

    bus.emit('keyup', { code: 'KeyK' });
    const f3 = ic.sampleFrame(3);
    expect(f3.action).toBe('none');
    expect(f3.actionPressed).toBe(false);
  });

  it('Rule 1: ignores browser keydown e.repeat === true for actionPressed', () => {
    const bus = new MockEventBus();
    const ic = new InputController(bus, bus);
    ic.attach();
    ic.setCaptureActive(true);

    bus.emit('keydown', { code: 'KeyJ', repeat: false });
    expect(ic.sampleFrame(1)).toMatchObject({ action: 'J', actionPressed: true });

    // Auto-repeat keydown events must NOT re-emit actionPressed
    bus.emit('keydown', { code: 'KeyJ', repeat: true });
    expect(ic.sampleFrame(2)).toMatchObject({ action: 'J', actionPressed: false });

    bus.emit('keydown', { code: 'KeyJ', repeat: true });
    expect(ic.sampleFrame(3)).toMatchObject({ action: 'J', actionPressed: false });
  });

  it('Rule 2: latches ultra-fast single-frame keydown+keyup tap for exactly 1 frame', () => {
    const bus = new MockEventBus();
    const ic = new InputController(bus, bus);
    ic.attach();
    ic.setCaptureActive(true);

    bus.emit('keydown', { code: 'KeyJ' });
    bus.emit('keyup', { code: 'KeyJ' });

    const f1 = ic.sampleFrame(1);
    expect(f1.action).toBe('J');
    expect(f1.actionPressed).toBe(true);

    const f2 = ic.sampleFrame(2);
    expect(f2.action).toBe('none');
    expect(f2.actionPressed).toBe(false);
  });

  it('Rule 3: seamlessly switches shot key while holding and ignores old keyup clearing new key', () => {
    const bus = new MockEventBus();
    const ic = new InputController(bus, bus);
    ic.attach();
    ic.setCaptureActive(true);

    // Hold J
    bus.emit('keydown', { code: 'KeyJ' });
    expect(ic.sampleFrame(1)).toMatchObject({ action: 'J', actionPressed: true });

    // Press K while still holding J -> immediate switch with actionPressed=true
    bus.emit('keydown', { code: 'KeyK' });
    // Release old key J BEFORE sampling -> must NOT clear K!
    bus.emit('keyup', { code: 'KeyJ' });
    expect(ic.sampleFrame(2)).toMatchObject({ action: 'K', actionPressed: true });
    expect(ic.sampleFrame(3)).toMatchObject({ action: 'K', actionPressed: false });

    // Hold L while still holding K, then release L -> falls back to K without re-emitting actionPressed
    bus.emit('keydown', { code: 'KeyL' });
    expect(ic.sampleFrame(4)).toMatchObject({ action: 'L', actionPressed: true });
    bus.emit('keyup', { code: 'KeyL' });
    expect(ic.sampleFrame(5)).toMatchObject({ action: 'K', actionPressed: false });

    // Release K -> none
    bus.emit('keyup', { code: 'KeyK' });
    expect(ic.sampleFrame(6)).toMatchObject({ action: 'none', actionPressed: false });
  });

  it('Rule 4: resetAndRebind clears stuck keys, pending press latch, blurs activeElement, and rebinds', () => {
    const bus = new MockEventBus();
    const blurSpy = vi.fn();
    bus.activeElement = { blur: blurSpy };

    const ic = new InputController(bus, bus);
    ic.attach();
    ic.setCaptureActive(true);

    bus.emit('keydown', { code: 'KeyD' });
    bus.emit('keydown', { code: 'KeyJ' });
    expect(ic.getDiagnostics().pressedCount).toBe(2);

    bus.emit('blur');
    const diag = ic.getDiagnostics();
    expect(diag.attached).toBe(true);
    expect(diag.pressedCount).toBe(0);
    expect(diag.rebindCount).toBe(1);
    expect(diag.lastResetReason).toBe('window_blur');
    expect(blurSpy).toHaveBeenCalledTimes(1);

    const afterBlur = ic.sampleFrame(10);
    expect(afterBlur.moveX).toBe(0);
    expect(afterBlur.action).toBe('none');
    expect(afterBlur.actionPressed).toBe(false);

    // Explicit FULL_SYNC reset clears single-frame pending latch too
    bus.emit('keydown', { code: 'KeyK' });
    bus.emit('keyup', { code: 'KeyK' });
    ic.resetAndRebind('FULL_SYNC');
    expect(ic.getDiagnostics().rebindCount).toBe(2);
    expect(ic.sampleFrame(11)).toMatchObject({ action: 'none', actionPressed: false });

    bus.emit('keydown', { code: 'KeyA' });
    bus.emit('keydown', { code: 'KeyL' });
    const fresh = ic.sampleFrame(12);
    expect(fresh.moveX).toBe(-1);
    expect(fresh.action).toBe('L');
    expect(fresh.actionPressed).toBe(true);
  });

  it('does not blur lobby input elements on window_focus when captureActive is false', () => {
    const bus = new MockEventBus();
    const blurSpy = vi.fn();
    bus.activeElement = { blur: blurSpy };

    const ic = new InputController(bus, bus);
    ic.attach();
    ic.setCaptureActive(false);

    bus.emit('focus');
    expect(blurSpy).not.toHaveBeenCalled();

    ic.setCaptureActive(true);
    bus.emit('focus');
    expect(blurSpy).toHaveBeenCalledTimes(1);
  });
});
