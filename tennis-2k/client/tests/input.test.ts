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

describe('InputController & resetAndRebind self-healing', () => {
  it('samples WASD + J/K/L and W+K dropshot intent cleanly', () => {
    const bus = new MockEventBus();
    const ic = new InputController(bus, bus);
    ic.attach();
    ic.setCaptureActive(true);

    bus.emit('keydown', { code: 'KeyW' });
    bus.emit('keydown', { code: 'KeyK' });
    const holdFrame = ic.sampleFrame(1);
    expect(holdFrame).toEqual({
      seq: 1,
      moveX: 0,
      moveZ: -1,
      aimX: 0,
      aimZ: -1,
      action: 'K',
      phase: 'hold',
    });

    bus.emit('keyup', { code: 'KeyK' });
    const releaseFrame = ic.sampleFrame(2);
    expect(releaseFrame.phase).toBe('release');
    expect(releaseFrame.action).toBe('K');
    expect(releaseFrame.aimZ).toBe(-1);

    const idleFrame = ic.sampleFrame(3);
    expect(idleFrame.phase).toBe('idle');
    expect(idleFrame.action).toBe('none');
  });

  it('clears stuck keys, blurs active element, rebinds listeners, and responds immediately on blur/FULL_SYNC', () => {
    const bus = new MockEventBus();
    const blurSpy = vi.fn();
    bus.activeElement = { blur: blurSpy };

    const ic = new InputController(bus, bus);
    ic.attach();
    ic.setCaptureActive(true);

    // Hold D and J, then simulate window blur (e.g. tab switch / disconnect)
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

    // Stuck key must be gone
    const afterBlur = ic.sampleFrame(10);
    expect(afterBlur.moveX).toBe(0);
    expect(afterBlur.action).toBe('none');
    expect(afterBlur.phase).toBe('idle');

    // Explicit FULL_SYNC reset and immediate fresh key press works
    ic.resetAndRebind('FULL_SYNC');
    expect(ic.getDiagnostics().rebindCount).toBe(2);

    bus.emit('keydown', { code: 'KeyA' });
    bus.emit('keydown', { code: 'KeyL' });
    const fresh = ic.sampleFrame(1);
    expect(fresh.moveX).toBe(-1);
    expect(fresh.action).toBe('L');
    expect(fresh.phase).toBe('hold');
  });

  it('handles ultra-fast keydown+keyup tap within single frame without dropping shot', () => {
    const bus = new MockEventBus();
    const ic = new InputController(bus, bus);
    ic.attach();
    ic.setCaptureActive(true);

    bus.emit('keydown', { code: 'KeyJ' });
    bus.emit('keyup', { code: 'KeyJ' });

    const f1 = ic.sampleFrame(1);
    expect(f1.phase).toBe('hold');
    expect(f1.action).toBe('J');

    const f2 = ic.sampleFrame(2);
    expect(f2.phase).toBe('release');
    expect(f2.action).toBe('J');
  });
});
