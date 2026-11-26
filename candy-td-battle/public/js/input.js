import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  PEEK_SWITCH_DEBOUNCE_MS,
  SEND_ORDER,
  TOWER_ORDER,
  cellKey,
  getObstacleAt,
  isPointInLeftZone,
  isPointInRightZone,
  pixelToCell
} from './shared/constants.js';

export class InputController {
  constructor({
    canvas,
    stage,
    rightZone,
    leftZone,
    renderer,
    onSelectBuild,
    onPlaceTower,
    onSelectTower,
    onSelectObstacle,
    onHoverOpponentTower,
    onSendWave,
    onViewModeChange,
    onToggleHelp,
    onCloseHelp,
    isHelpOpen,
    onUnlockAudio
  }) {
    this.canvas = canvas;
    this.stage = stage;
    this.rightZone = rightZone;
    this.leftZone = leftZone;
    this.renderer = renderer;
    this.callbacks = {
      onSelectBuild,
      onPlaceTower,
      onSelectTower,
      onSelectObstacle,
      onHoverOpponentTower,
      onSendWave,
      onViewModeChange,
      onToggleHelp,
      onCloseHelp,
      isHelpOpen,
      onUnlockAudio
    };

    this.viewMode = 'self';
    this.wasInRightZone = false;
    this.wasInLeftZone = false;
    this.lastSwitchMs = 0;
    this.enabled = false;
    this._bind();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.wasInRightZone = false;
      this.wasInLeftZone = false;
      this.setViewMode('self');
    }
  }

  setViewMode(mode, { force = false } = {}) {
    const next = mode === 'opponent' ? 'opponent' : 'self';
    if (!force && next === this.viewMode) return;
    this.viewMode = next;
    this.renderer.setViewMode(next);
    if (next === 'opponent') {
      this.renderer.hoverCell = null;
    } else {
      this.renderer.hoverOpponentTowerId = null;
      this.callbacks.onHoverOpponentTower(null, null);
    }
    this.callbacks.onViewModeChange(next);
  }

  _toLogicalCoords(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: -1, y: -1 };
    return {
      x: ((clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((clientY - rect.top) / rect.height) * CANVAS_HEIGHT
    };
  }

  _bind() {
    const updateHoverFromPointer = (clientX, clientY) => {
      if (!this.enabled) return;
      const pt = this._toLogicalCoords(clientX, clientY);
      const inRight = isPointInRightZone(pt.x, pt.y);
      const inLeft = isPointInLeftZone(pt.x, pt.y);

      if (this.viewMode === 'self') {
        if (inRight && !this.wasInRightZone) {
          this.setViewMode('opponent');
        }
      } else {
        if (inLeft && !this.wasInLeftZone) {
          this.setViewMode('self');
        }
      }
      this.wasInRightZone = inRight;
      this.wasInLeftZone = inLeft;

      if (this.viewMode === 'opponent' || this.renderer.isPeekingProtected()) {
        this.renderer.hoverCell = null;
        const cell = pixelToCell(pt.x, pt.y);
        const oppTower = cell
          ? this.renderer.currSnapshot?.opponent?.towers?.find(
              (t) => t.col === cell.col && t.row === cell.row
            ) || null
          : null;
        const nextHoverId = oppTower ? oppTower.id : null;
        this.renderer.hoverOpponentTowerId = nextHoverId;
        this.callbacks.onHoverOpponentTower(oppTower, { x: pt.x, y: pt.y });
        return;
      }

      this.renderer.hoverOpponentTowerId = null;
      this.callbacks.onHoverOpponentTower(null, null);
      this.renderer.hoverCell = pixelToCell(pt.x, pt.y);
    };

    this.stage.addEventListener('mousemove', (e) => {
      updateHoverFromPointer(e.clientX, e.clientY);
    });

    // Leaving the stage does NOT snap back from locked opponent view!
    this.stage.addEventListener('mouseleave', () => {
      this.wasInRightZone = false;
      this.wasInLeftZone = false;
      this.renderer.hoverCell = null;
      if (this.viewMode === 'opponent') {
        this.renderer.hoverOpponentTowerId = null;
        this.callbacks.onHoverOpponentTower(null, null);
      }
    });

    if (this.rightZone) {
      this.rightZone.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onUnlockAudio();
        if (!this.enabled) return;
        this.setViewMode('opponent');
      });
    }

    if (this.leftZone) {
      this.leftZone.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onUnlockAudio();
        if (!this.enabled) return;
        this.setViewMode('self');
      });
    }

    // Canvas click (strictly blocked while in opponent view or transitioning!)
    this.canvas.addEventListener('mousedown', (e) => {
      this.callbacks.onUnlockAudio();
      if (!this.enabled) return;

      if (e.button === 2) {
        this.callbacks.onSelectBuild(null);
        this.callbacks.onSelectTower(null);
        this.callbacks.onSelectObstacle(null);
        return;
      }
      if (e.button !== 0) return;

      // Hard opponent-view protection: zero misbuild, zero demolish, zero spend
      if (this.viewMode === 'opponent' || this.renderer.isPeekingProtected()) {
        return;
      }

      const pt = this._toLogicalCoords(e.clientX, e.clientY);
      const cell = pixelToCell(pt.x, pt.y);
      if (!cell) {
        this.callbacks.onSelectTower(null);
        this.callbacks.onSelectObstacle(null);
        return;
      }

      const snap = this.renderer.currSnapshot;
      const existing = snap?.self?.towers?.find(
        (t) => t.col === cell.col && t.row === cell.row
      );

      if (existing) {
        this.callbacks.onSelectBuild(null);
        this.callbacks.onSelectObstacle(null);
        this.callbacks.onSelectTower(existing);
        return;
      }

      const clearedSet = new Set(snap?.self?.clearedObstacles || []);
      const obs = getObstacleAt(this.renderer.mapId, cell.col, cell.row);
      if (obs && !clearedSet.has(cellKey(obs.col, obs.row))) {
        this.callbacks.onSelectBuild(null);
        this.callbacks.onSelectTower(null);
        this.callbacks.onSelectObstacle(obs);
        return;
      }

      this.callbacks.onSelectObstacle(null);
      if (this.renderer.selectedBuildType) {
        this.callbacks.onPlaceTower(this.renderer.selectedBuildType, cell.col, cell.row);
      } else {
        this.callbacks.onSelectTower(null);
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      this.callbacks.onUnlockAudio();

      if (e.key === 'Escape' && this.callbacks.isHelpOpen && this.callbacks.isHelpOpen()) {
        this.callbacks.onCloseHelp();
        return;
      }

      if (!this.enabled) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (e.repeat) return;
        const now = performance.now();
        if (now - this.lastSwitchMs < PEEK_SWITCH_DEBOUNCE_MS) return;
        this.lastSwitchMs = now;
        this.setViewMode(this.viewMode === 'self' ? 'opponent' : 'self');
        return;
      }

      if (e.key === 'Escape') {
        if (this.viewMode === 'opponent') {
          this.setViewMode('self');
          return;
        }
        this.callbacks.onSelectBuild(null);
        this.callbacks.onSelectTower(null);
        this.callbacks.onSelectObstacle(null);
        return;
      }

      const idx = ['1', '2', '3', '4'].indexOf(e.key);
      if (idx !== -1) {
        if (this.viewMode === 'opponent') {
          this.setViewMode('self');
        }
        this.callbacks.onSelectBuild(TOWER_ORDER[idx]);
        return;
      }

      const sendIdx = ['Q', 'W', 'E', 'R', 'T'].indexOf(e.key.toUpperCase());
      if (sendIdx !== -1) {
        this.callbacks.onSendWave(SEND_ORDER[sendIdx]);
      }
    });
  }
}
