import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  SEND_ORDER,
  TOWER_ORDER,
  isPointInPeekZone,
  pixelToCell
} from './shared/constants.js';

export class InputController {
  constructor({ canvas, stage, peekZone, renderer, onSelectBuild, onPlaceTower, onSelectTower, onSendWave, onPeekChange, onUnlockAudio }) {
    this.canvas = canvas;
    this.stage = stage;
    this.peekZone = peekZone;
    this.renderer = renderer;
    this.callbacks = {
      onSelectBuild,
      onPlaceTower,
      onSelectTower,
      onSendWave,
      onPeekChange,
      onUnlockAudio
    };

    this.hoverPeekZone = false;
    this.spaceHeld = false;
    this.enabled = false;
    this._bind();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.hoverPeekZone = false;
      this.spaceHeld = false;
      this._syncPeek();
    }
  }

  _toLogicalCoords(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: -1, y: -1 };
    return {
      x: ((clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((clientY - rect.top) / rect.height) * CANVAS_HEIGHT
    };
  }

  _syncPeek() {
    const active = this.enabled && (this.hoverPeekZone || this.spaceHeld);
    this.renderer.setPeekActive(active);
    this.peekZone.classList.toggle('active', active);
    this.callbacks.onPeekChange(active);
  }

  _bind() {
    // Unified stage-level coordinate tracking for peek hotzone (prevents edge lock-in)
    const updateHoverFromPointer = (clientX, clientY) => {
      if (!this.enabled) return;
      const pt = this._toLogicalCoords(clientX, clientY);
      const nowInPeek = isPointInPeekZone(pt.x, pt.y);
      if (nowInPeek !== this.hoverPeekZone) {
        this.hoverPeekZone = nowInPeek;
        this._syncPeek();
      }
      if (this.renderer.isPeekingProtected()) {
        this.renderer.hoverCell = null;
        return;
      }
      this.renderer.hoverCell = pixelToCell(pt.x, pt.y);
    };

    this.stage.addEventListener('mousemove', (e) => {
      updateHoverFromPointer(e.clientX, e.clientY);
    });

    this.stage.addEventListener('mouseleave', () => {
      this.renderer.hoverCell = null;
      if (this.hoverPeekZone) {
        this.hoverPeekZone = false;
        this._syncPeek();
      }
    });

    // Canvas click (strictly blocked during peek!)
    this.canvas.addEventListener('mousedown', (e) => {
      this.callbacks.onUnlockAudio();
      if (!this.enabled) return;

      if (e.button === 2) {
        this.callbacks.onSelectBuild(null);
        this.callbacks.onSelectTower(null);
        return;
      }
      if (e.button !== 0) return;

      // Hard peek protection: NEVER build/select/spend while peeking
      if (this.renderer.isPeekingProtected()) {
        return;
      }

      const pt = this._toLogicalCoords(e.clientX, e.clientY);
      const cell = pixelToCell(pt.x, pt.y);
      if (!cell) {
        this.callbacks.onSelectTower(null);
        return;
      }

      const snap = this.renderer.currSnapshot;
      const existing = snap?.self?.towers?.find(
        (t) => t.col === cell.col && t.row === cell.row
      );

      if (existing) {
        this.callbacks.onSelectBuild(null);
        this.callbacks.onSelectTower(existing);
        return;
      }

      if (this.renderer.selectedBuildType) {
        this.callbacks.onPlaceTower(this.renderer.selectedBuildType, cell.col, cell.row);
      } else {
        this.callbacks.onSelectTower(null);
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      this.callbacks.onUnlockAudio();
      if (!this.enabled) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (!this.spaceHeld) {
          this.spaceHeld = true;
          this._syncPeek();
        }
        return;
      }

      if (e.key === 'Escape') {
        this.callbacks.onSelectBuild(null);
        this.callbacks.onSelectTower(null);
        return;
      }

      const idx = ['1', '2', '3', '4'].indexOf(e.key);
      if (idx !== -1) {
        this.callbacks.onSelectBuild(TOWER_ORDER[idx]);
        return;
      }

      const sendIdx = ['Q', 'W', 'E', 'R', 'T', 'F'].indexOf(e.key.toUpperCase());
      if (sendIdx !== -1) {
        this.callbacks.onSendWave(SEND_ORDER[sendIdx]);
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceHeld = false;
        this._syncPeek();
      }
    });

    window.addEventListener('blur', () => {
      this.spaceHeld = false;
      this.hoverPeekZone = false;
      this._syncPeek();
    });
  }
}
