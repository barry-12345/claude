import {
  BUFF_TILE_DEFS,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  CELL_H,
  CELL_W,
  DEFAULT_MAP_ID,
  FLOAT_TEXT_POOL_MAX,
  GRID_COLS,
  GRID_HEIGHT,
  GRID_ROWS,
  GRID_WIDTH,
  GRID_X0,
  GRID_Y0,
  MAX_DPR,
  PARTICLE_POOL_MAX,
  PEEK_ENTER_MS,
  PEEK_EXIT_MS,
  SEND_DEFS,
  TOWER_DEFS,
  TOWER_ORDER,
  cellKey,
  cellToPixel,
  getBuffAt,
  getMapDef,
  getObstacleAt,
  getTowerLevelDef,
  isBuildableCell
} from './shared/constants.js';

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export class CandyRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

    this.mapId = DEFAULT_MAP_ID;
    this.mapCache = null;
    this.cachedMapId = null;
    this.cachedDpr = null;

    this.towerBaseSprites = new Map();
    this.obstacleSprites = new Map();
    this.buffTileSprites = new Map();
    this.shieldBadgeSprites = new Map();

    // Fixed-cap circular pools (no GC spikes)
    this.particles = Array.from({ length: PARTICLE_POOL_MAX }, () => ({ active: false }));
    this.particleCursor = 0;
    this.activeParticleCount = 0;

    this.floatTexts = Array.from({ length: FLOAT_TEXT_POOL_MAX }, () => ({ active: false }));
    this.floatTextCursor = 0;
    this.activeFloatTextCount = 0;

    // Transient visual effects
    this.lasers = [];
    this.splashRings = [];

    // Snapshot & interpolation
    this.mySlot = 0;
    this.prevSnapshot = null;
    this.currSnapshot = null;
    this.lastSnapTime = performance.now();
    this._prevCreepMap = new Map();
    this._selfClearedSet = new Set();
    this._oppClearedSet = new Set();

    // Locked Dual-Side View camera state
    this.viewMode = 'self';
    this.peekActive = false;
    this.peekProgress = 0;

    // Interaction state
    this.hoverCell = null;
    this.selectedBuildType = null;
    this.selectedTowerId = null;
    this.selectedObstacleKey = null;
    this.hoverOpponentTowerId = null;

    // Telemetry
    this.fps = 60;
    this.renderMs = 0;
    this._frameCount = 0;
    this._fpsWindowStart = performance.now();

    this.resize();
    this._ensureStaticMapCache(this.mapId);
    this._buildTowerBaseSprites();
    this._buildObstacleAndBuffSprites();
    this._buildShieldBadgeSprites();
  }

  resize() {
    const nextDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.dpr = nextDpr;
    this.canvas.width = Math.round(CANVAS_WIDTH * this.dpr);
    this.canvas.height = Math.round(CANVAS_HEIGHT * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.cachedDpr !== null && this.cachedDpr !== nextDpr) {
      this._ensureStaticMapCache(this.mapId, true);
      this._buildTowerBaseSprites();
      this._buildObstacleAndBuffSprites();
      this._buildShieldBadgeSprites();
    }
  }

  _createOffscreen(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.round(w * this.dpr);
    c.height = Math.round(h * this.dpr);
    const octx = c.getContext('2d');
    octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return { canvas: c, ctx: octx };
  }

  setMapId(mapId) {
    const resolved = getMapDef(mapId).id;
    if (resolved !== this.mapId || this.cachedMapId !== resolved) {
      this.mapId = resolved;
      this._ensureStaticMapCache(resolved, true);
    }
  }

  _ensureStaticMapCache(mapId, force = false) {
    const resolved = getMapDef(mapId).id;
    if (!force && this.mapCache && this.cachedMapId === resolved && this.cachedDpr === this.dpr) {
      return;
    }
    this.cachedMapId = resolved;
    this.cachedDpr = this.dpr;
    const mapDef = getMapDef(resolved);

    const { canvas, ctx } = this._createOffscreen(CANVAS_WIDTH, CANVAS_HEIGHT);
    this.mapCache = canvas;

    // Soft pastel backdrop
    const bgGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    bgGrad.addColorStop(0, '#F7FCF1');
    bgGrad.addColorStop(1, '#EBF7E6');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Subtle symmetric safety corridor tints on left & right (100px each)
    ctx.fillStyle = 'rgba(255, 240, 246, 0.55)';
    ctx.fillRect(0, GRID_Y0, 64, GRID_HEIGHT);
    ctx.fillRect(GRID_X0 + GRID_WIDTH + 36, GRID_Y0, 64, GRID_HEIGHT);

    // Board outer macaron tray (centered x: 100..1180)
    this._roundRect(ctx, GRID_X0 - 8, GRID_Y0 - 8, GRID_WIDTH + 16, GRID_HEIGHT + 16, 18);
    ctx.fillStyle = '#FFFDF9';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#F2D6E2';
    ctx.stroke();

    // Grass checkerboard tiles
    for (let col = 0; col < GRID_COLS; col++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        const x = GRID_X0 + col * CELL_W;
        const y = GRID_Y0 + row * CELL_H;
        const isPath = mapDef.pathCellSet.has(cellKey(col, row));
        if (!isPath) {
          ctx.fillStyle = (col + row) % 2 === 0 ? '#ECF7E8' : '#E3F2DC';
          ctx.fillRect(x, y, CELL_W, CELL_H);
          ctx.strokeStyle = 'rgba(182, 214, 168, 0.35)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, CELL_W - 1, CELL_H - 1);

          if ((col * 7 + row * 13) % 11 === 0) {
            ctx.fillStyle = 'rgba(255, 184, 206, 0.45)';
            ctx.beginPath();
            ctx.arc(x + CELL_W * 0.28, y + CELL_H * 0.32, 2.2, 0, Math.PI * 2);
            ctx.arc(x + CELL_W * 0.33, y + CELL_H * 0.36, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    // Caramel & Vanilla frosting path
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    mapDef.pointsPx.forEach((pt, idx) => {
      if (idx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.strokeStyle = '#E9C99B';
    ctx.lineWidth = 46;
    ctx.stroke();

    ctx.strokeStyle = '#FFF3DA';
    ctx.lineWidth = 38;
    ctx.stroke();

    ctx.setLineDash([8, 12]);
    ctx.strokeStyle = 'rgba(255, 175, 198, 0.5)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Entry arch & Exit Candy Castle (obstacles are NOT baked — drawn dynamically per side)
    const entry = mapDef.pointsPx[0];
    this._drawCandyGate(ctx, entry.x - 22, entry.y);
    const exit = mapDef.pointsPx[mapDef.pointsPx.length - 1];
    this._drawCandyCastle(ctx, exit.x + 8, exit.y);
  }

  _drawCandyGate(ctx, x, y) {
    ctx.save();
    ctx.fillStyle = 'rgba(130, 82, 108, 0.14)';
    ctx.beginPath();
    ctx.ellipse(x + 8, y + 18, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FF8FA8';
    this._roundRect(ctx, x - 4, y - 18, 8, 34, 4);
    ctx.fill();
    ctx.fillStyle = '#FFF9FC';
    ctx.fillRect(x - 3, y - 12, 6, 5);
    ctx.fillRect(x - 3, y, 6, 5);

    ctx.fillStyle = '#FFD147';
    ctx.beginPath();
    ctx.arc(x, y - 20, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawCandyCastle(ctx, x, y) {
    ctx.save();
    ctx.fillStyle = 'rgba(130, 82, 108, 0.14)';
    ctx.beginPath();
    ctx.ellipse(x, y + 19, 24, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    this._roundRect(ctx, x - 18, y - 10, 36, 28, 7);
    ctx.fillStyle = '#FFF5FA';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#FF9AB5';
    ctx.stroke();

    ctx.fillStyle = '#FF6B8B';
    ctx.beginPath();
    ctx.moveTo(x - 20, y - 10);
    ctx.lineTo(x, y - 28);
    ctx.lineTo(x + 20, y - 10);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#FFD147';
    ctx.beginPath();
    ctx.arc(x, y - 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _buildObstacleAndBuffSprites() {
    this.obstacleSprites.clear();
    this.buffTileSprites.clear();

    const kinds = ['lollipop', 'cake', 'pudding', 'cotton'];
    const buffs = Object.keys(BUFF_TILE_DEFS);

    // Buff ground tiles
    for (const buff of buffs) {
      const bDef = BUFF_TILE_DEFS[buff];
      const { canvas, ctx } = this._createOffscreen(CELL_W, CELL_H);
      ctx.fillStyle = bDef.bgColor;
      this._roundRect(ctx, 3, 3, CELL_W - 6, CELL_H - 6, 8);
      ctx.fill();
      ctx.strokeStyle = bDef.borderColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Inner crystal diamond
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.moveTo(CELL_W / 2, 11);
      ctx.lineTo(CELL_W / 2 + 12, CELL_H / 2);
      ctx.lineTo(CELL_W / 2, CELL_H - 11);
      ctx.lineTo(CELL_W / 2 - 12, CELL_H / 2);
      ctx.closePath();
      ctx.fill();

      // Corner badge
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(CELL_W - 12, CELL_H - 12, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = bDef.borderColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(bDef.icon, CELL_W - 12, CELL_H - 11.5);

      this.buffTileSprites.set(buff, canvas);
    }

    // 1B: Obstacles with explicit corner buff preview badge
    for (const kind of kinds) {
      for (const buff of buffs) {
        const bDef = BUFF_TILE_DEFS[buff];
        const { canvas, ctx } = this._createOffscreen(CELL_W, CELL_H);
        const cx = CELL_W / 2;
        const cy = CELL_H / 2;
        this._drawObstacleShape(ctx, kind, cx, cy);

        // Explicit 1B preview badge in bottom-right corner
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(CELL_W - 12, CELL_H - 12, 10.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = bDef.borderColor;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(bDef.icon, CELL_W - 12, CELL_H - 11.5);

        this.obstacleSprites.set(`${kind}_${buff}`, canvas);
      }
    }
  }

  _drawObstacleShape(ctx, kind, x, y) {
    ctx.save();
    ctx.fillStyle = 'rgba(145, 198, 130, 0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y + 16, 20, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    if (kind === 'lollipop') {
      ctx.fillStyle = '#F7EFE6';
      ctx.fillRect(x - 2.5, y - 2, 5, 20);
      ctx.fillStyle = '#FF6B8B';
      ctx.beginPath();
      ctx.arc(x, y - 8, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFF8FB';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y - 8, 8, 0, Math.PI * 1.5);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.beginPath();
      ctx.arc(x - 5, y - 13, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'cake') {
      this._roundRect(ctx, x - 17, y - 4, 34, 20, 6);
      ctx.fillStyle = '#FCE1B6';
      ctx.fill();
      ctx.strokeStyle = '#E0AE75';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      this._roundRect(ctx, x - 18, y - 9, 36, 10, 5);
      ctx.fillStyle = '#FFFDF9';
      ctx.fill();
      ctx.fillStyle = '#FF5D84';
      ctx.beginPath();
      ctx.arc(x, y - 12, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#47C98A';
      ctx.fillRect(x - 1, y - 20, 3, 4);
    } else if (kind === 'pudding') {
      ctx.fillStyle = '#7CE8D8';
      ctx.beginPath();
      ctx.moveTo(x - 16, y + 14);
      ctx.quadraticCurveTo(x - 14, y - 12, x, y - 12);
      ctx.quadraticCurveTo(x + 14, y - 12, x + 16, y + 14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#38C6B4';
      ctx.beginPath();
      ctx.ellipse(x, y - 9, 10, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.arc(x - 5, y - 3, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const puffs = [
        [x - 9, y + 4, 10],
        [x + 9, y + 4, 10],
        [x, y - 4, 12]
      ];
      ctx.fillStyle = '#FFDDF0';
      for (const [px, py, pr] of puffs) {
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.beginPath();
      ctx.arc(x - 4, y - 8, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _buildTowerBaseSprites() {
    this.towerBaseSprites.clear();
    for (const type of TOWER_ORDER) {
      const def = TOWER_DEFS[type];
      const configs = [
        { key: `${type}_1`, level: 1, branch: null },
        { key: `${type}_2`, level: 2, branch: null },
        { key: `${type}_3_A`, level: 3, branch: 'A' },
        { key: `${type}_3_B`, level: 3, branch: 'B' }
      ];
      for (const { key, level, branch } of configs) {
        const size = 84;
        const { canvas, ctx } = this._createOffscreen(size, size);
        const cx = size / 2;
        const cy = size / 2;

        ctx.fillStyle = 'rgba(110, 68, 92, 0.12)';
        ctx.beginPath();
        ctx.ellipse(cx, cy + 16, 21 + level * 1.5, 8.5, 0, 0, Math.PI * 2);
        ctx.fill();

        const ringColor =
          level < 3
            ? def.color
            : branch === 'A'
              ? '#FF7B39'
              : '#8E5BF5';
        ctx.fillStyle = level === 3 ? (branch === 'A' ? '#FFF1DC' : '#F4ECFF') : '#FFFFFF';
        ctx.beginPath();
        ctx.arc(cx, cy + 2, 20 + level * 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = level === 3 ? 2.8 : 2;
        ctx.strokeStyle = ringColor;
        ctx.stroke();

        ctx.fillStyle = def.color;
        ctx.beginPath();
        ctx.arc(cx, cy, 15 + level * 1.4, 0, Math.PI * 2);
        ctx.fill();

        if (level >= 2) {
          ctx.strokeStyle = level === 3 ? (branch === 'A' ? '#FFE28A' : '#D5B8FF') : def.accent;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(cx, cy, 12 + level * 1.1, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.fillStyle = 'rgba(255, 255, 255, 0.58)';
        ctx.beginPath();
        ctx.ellipse(cx - 5, cy - 6, 6, 3.2, -0.5, 0, Math.PI * 2);
        ctx.fill();

        for (let s = 0; s < level; s++) {
          const sx = cx - (level - 1) * 5 + s * 10;
          const sy = cy + 18;
          ctx.fillStyle = level === 3 && branch === 'B' ? '#B98EFF' : '#FFD147';
          ctx.beginPath();
          ctx.arc(sx, sy, 3.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#6B3D5E';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }

        if (level === 3 && branch) {
          ctx.fillStyle = branch === 'A' ? '#FF6A2B' : '#7B4AE2';
          ctx.beginPath();
          ctx.arc(cx + 15, cy - 15, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(branch, cx + 15, cy - 14.5);
        }

        this.towerBaseSprites.set(key, canvas);
      }
    }
  }

  _buildShieldBadgeSprites() {
    this.shieldBadgeSprites.clear();
    for (let n = 1; n <= 16; n++) {
      const w = 24;
      const h = 12;
      const { canvas, ctx } = this._createOffscreen(w, h);
      ctx.fillStyle = '#1462B8';
      this._roundRect(ctx, 0, 0, w, h, 5);
      ctx.fill();
      // Small vector diamond shield emblem on left
      ctx.fillStyle = '#6CE0FF';
      ctx.beginPath();
      ctx.moveTo(6, 2.5);
      ctx.lineTo(9, 4.5);
      ctx.lineTo(8, 8.5);
      ctx.lineTo(6, 9.8);
      ctx.lineTo(4, 8.5);
      ctx.lineTo(3, 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), 15.5, 6.2);
      this.shieldBadgeSprites.set(n, canvas);
    }
  }

  _pushCapped(list, item, cap) {
    if (list.length >= cap) {
      list.shift();
    }
    list.push(item);
  }

  setPlayerSlot(slot) {
    this.mySlot = Number(slot) || 0;
  }

  _sideForSlot(slot) {
    return slot === this.mySlot ? 'self' : 'opponent';
  }

  resetMatchState() {
    this.prevSnapshot = null;
    this.currSnapshot = null;
    this._prevCreepMap.clear();
    this._selfClearedSet.clear();
    this._oppClearedSet.clear();
    this.lasers = [];
    this.splashRings = [];
    for (let i = 0; i < PARTICLE_POOL_MAX; i++) this.particles[i].active = false;
    for (let i = 0; i < FLOAT_TEXT_POOL_MAX; i++) this.floatTexts[i].active = false;
    this.activeParticleCount = 0;
    this.activeFloatTextCount = 0;
    this.hoverCell = null;
    this.selectedBuildType = null;
    this.selectedTowerId = null;
    this.selectedObstacleKey = null;
    this.hoverOpponentTowerId = null;
    this.viewMode = 'self';
    this.peekActive = false;
    this.peekProgress = 0;
  }

  pushSnapshot(snap) {
    if (snap.mapId && snap.mapId !== this.mapId) {
      this.setMapId(snap.mapId);
    }
    if (snap.opponentLite && snap.opponent) {
      const prevOpp = this.currSnapshot?.opponent;
      snap.opponent.creeps = prevOpp?.creeps || [];
      snap.opponent.projectiles = prevOpp?.projectiles || [];
      snap.opponent.lavaZones = prevOpp?.lavaZones || [];
    }
    this._selfClearedSet.clear();
    for (const k of snap.self?.clearedObstacles || []) {
      this._selfClearedSet.add(k);
    }
    this._oppClearedSet.clear();
    for (const k of snap.opponent?.clearedObstacles || []) {
      this._oppClearedSet.add(k);
    }
    this.prevSnapshot = this.currSnapshot || snap;
    this.currSnapshot = snap;
    this.lastSnapTime = performance.now();
  }

  handleEvents(events) {
    const mapDef = getMapDef(this.mapId);
    const entry = mapDef.pointsPx[0];

    for (const ev of events) {
      if (ev.type === 'tower_built') {
        const side = this._sideForSlot(ev.slot);
        this._burstParticles(ev.x, ev.y, '#FF9AB5', 14, 70, side);
        this.spawnFloatText(ev.x, ev.y - 16, '✨ 建塔!', '#E84E73', 1.0, 14, side);
      } else if (ev.type === 'tower_upgraded') {
        const side = this._sideForSlot(ev.slot);
        this._burstParticles(ev.x, ev.y, '#FFD147', 18, 85, side);
        const branchText = ev.branch ? `-${ev.branch}` : '';
        this.spawnFloatText(ev.x, ev.y - 18, `⭐ Lv.${ev.level}${branchText}!`, '#D48A00', 1.0, 14, side);
      } else if (ev.type === 'tower_sold') {
        const side = this._sideForSlot(ev.slot);
        this._burstParticles(ev.x, ev.y, '#FFE08A', 12, 65, side);
        this.spawnFloatText(ev.x, ev.y - 14, `+$${ev.refund}`, '#269B66', 1.0, 14, side);
      } else if (ev.type === 'obstacle_demolished') {
        const side = this._sideForSlot(ev.slot);
        const bDef = BUFF_TILE_DEFS[ev.buff];
        this._burstParticles(ev.x, ev.y, bDef ? bDef.borderColor : '#FFD147', 18, 90, side);
        if (bDef) {
          this.spawnFloatText(ev.x, ev.y - 16, `✨ ${bDef.icon} ${bDef.name}`, bDef.color, 1.3, 13, side);
        }
      } else if (ev.type === 'eco_payout') {
        const side = this._sideForSlot(ev.slot);
        this.spawnFloatText(640, 128, `+$${ev.amount} Eco 💰`, '#138A78', 1.4, 20, side);
      } else if (ev.type === 'execute_hit') {
        const side = this._sideForSlot(ev.slot);
        this._burstParticles(ev.x, ev.y, '#FF385C', 14, 80, side);
        this.spawnFloatText(ev.x, ev.y - 20, `🎯 处决 ${ev.damage}!`, '#D91A44', 1.0, 15, side);
      } else if (ev.type === 'shield_hit') {
        const side = this._sideForSlot(ev.slot);
        this._burstParticles(ev.x, ev.y, '#4BA3FF', 5, 40, side);
      } else if (ev.type === 'shield_break') {
        const side = this._sideForSlot(ev.slot);
        this._burstParticles(ev.x, ev.y, '#70D6FF', 16, 95, side);
        this.spawnFloatText(ev.x, ev.y - 18, '💥 破盾!', '#1F7AE0', 0.9, 13, side);
      } else if (ev.type === 'frost_nova') {
        const side = this._sideForSlot(ev.slot);
        this._pushCapped(this.splashRings, { x: ev.x, y: ev.y, r: ev.range, color: '#64E9FF', side, life: 1 }, 40);
        this._burstParticles(ev.x, ev.y, '#9EF8FF', 16, 85, side);
      } else if (ev.type === 'brittle_shatter') {
        const side = this._sideForSlot(ev.slot);
        this._pushCapped(this.splashRings, { x: ev.x, y: ev.y, r: ev.radius, color: '#A58BF5', side, life: 1 }, 40);
        this._burstParticles(ev.x, ev.y, '#C2A8FF', 14, 80, side);
      } else if (ev.type === 'healer_pulse') {
        const side = this._sideForSlot(ev.slot);
        this._pushCapped(this.splashRings, { x: ev.x, y: ev.y, r: ev.radius, color: '#39FF9C', side, life: 1 }, 40);
      } else if (ev.type === 'life_lost') {
        const side = this._sideForSlot(ev.slot);
        this._burstParticles(ev.x, ev.y, '#FF4D6D', 14, 75, side);
        this.spawnFloatText(ev.x - 10, ev.y - 24, `-${ev.amount} ❤️`, '#D9264E', 1.2, 16, side);
      } else if (ev.type === 'tower_shot' && ev.towerType === 'lemon') {
        const side = this._sideForSlot(ev.slot);
        this._pushCapped(
          this.lasers,
          {
            fromX: ev.fromX,
            fromY: ev.fromY,
            toX: ev.beamEndX || ev.toX,
            toY: ev.beamEndY || ev.toY,
            branch: ev.branch || null,
            side,
            life: 1.0
          },
          32
        );
        if (ev.armoredHit) {
          this._burstParticles(ev.toX, ev.toY, '#FFD147', 8, 60, side);
        }
      } else if (ev.type === 'mint_splash') {
        const side = this._sideForSlot(ev.slot);
        this._pushCapped(this.splashRings, { x: ev.x, y: ev.y, r: ev.radius, color: '#38C6B4', side, life: 1 }, 40);
        this._burstParticles(ev.x, ev.y, '#88F2E6', 6, 45, side);
      } else if (ev.type === 'popcorn_boom') {
        const side = this._sideForSlot(ev.slot);
        this._pushCapped(this.splashRings, { x: ev.x, y: ev.y, r: ev.radius, color: '#FF944D', side, life: 1 }, 40);
        this._burstParticles(ev.x, ev.y, '#FFB84D', 10, 75, side);
      } else if (ev.type === 'creep_pop') {
        const side = this._sideForSlot(ev.slot);
        if (ev.isDark) {
          this._burstParticles(ev.x, ev.y, '#B75CFF', 10, 65, side);
          this.spawnFloatText(ev.x, ev.y - 12, '暗袭清除', '#9B4DFF', 0.75, 11, side);
        } else {
          this._burstParticles(ev.x, ev.y, '#FF85A1', 8, 55, side);
          const bonusStr = ev.bonusBounty > 0 ? ` (+$${ev.bonusBounty})` : '';
          this.spawnFloatText(ev.x, ev.y - 12, `+$${ev.bounty}${bonusStr}`, '#B87400', 0.75, 12, side);
        }
      } else if (ev.type === 'macaron_cracked') {
        const side = this._sideForSlot(ev.slot);
        this._burstParticles(ev.x, ev.y, '#C8B6FF', 12, 80, side);
      } else if (ev.type === 'express_arrived_real') {
        const side = this._sideForSlot(ev.targetSlot);
        this._burstParticles(entry.x + 12, entry.y, '#B75CFF', 24, 115, side);
      }
    }
  }

  _burstParticles(x, y, color, count, speedMax, side = 'self') {
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.particleCursor];
      this.particleCursor = (this.particleCursor + 1) % PARTICLE_POOL_MAX;
      const angle = Math.random() * Math.PI * 2;
      const spd = 24 + Math.random() * speedMax;
      p.active = true;
      p.side = side;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * spd;
      p.vy = Math.sin(angle) * spd - 20;
      p.size = 2.5 + Math.random() * 3.5;
      p.color = color;
      p.life = 0.45 + Math.random() * 0.35;
      p.maxLife = p.life;
    }
  }

  spawnFloatText(x, y, text, color = '#4A3548', life = 1.0, fontSize = 14, side = 'self') {
    const ft = this.floatTexts[this.floatTextCursor];
    this.floatTextCursor = (this.floatTextCursor + 1) % FLOAT_TEXT_POOL_MAX;
    ft.active = true;
    ft.side = side;
    ft.x = x;
    ft.y = y;
    ft.vy = -34;
    ft.text = text;
    ft.color = color;
    ft.life = life;
    ft.maxLife = life;
    ft.fontSize = fontSize;
  }

  setViewMode(mode) {
    this.viewMode = mode === 'opponent' ? 'opponent' : 'self';
    this.peekActive = this.viewMode === 'opponent';
  }

  setPeekActive(active) {
    this.setViewMode(active ? 'opponent' : 'self');
  }

  isPeekingProtected() {
    return this.viewMode === 'opponent' || this.peekProgress > 0.05;
  }

  render(nowMs, dtSec) {
    const tStart = performance.now();

    this._frameCount += 1;
    if (nowMs - this._fpsWindowStart >= 500) {
      this.fps = Math.round((this._frameCount * 1000) / (nowMs - this._fpsWindowStart));
      this._frameCount = 0;
      this._fpsWindowStart = nowMs;
    }

    const dtMs = dtSec * 1000;
    if (this.peekActive && this.peekProgress < 1) {
      this.peekProgress = Math.min(1, this.peekProgress + dtMs / PEEK_ENTER_MS);
    } else if (!this.peekActive && this.peekProgress > 0) {
      this.peekProgress = Math.max(0, this.peekProgress - dtMs / PEEK_EXIT_MS);
    }
    const easedPeek = easeOutCubic(this.peekProgress);

    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const snap = this.currSnapshot;
    const prev = this.prevSnapshot || snap;
    const interp = snap ? Math.min(1.15, (nowMs - this.lastSnapTime) / 50) : 0;

    if (!snap) {
      ctx.drawImage(this.mapCache, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      this._drawObstaclesAndBuffs(ctx, new Set());
      this.renderMs = Number((performance.now() - tStart).toFixed(2));
      return;
    }

    this._stepPoolsAndEffects(dtSec);

    const selfShift = -easedPeek * CANVAS_WIDTH;
    const oppShift = (1 - easedPeek) * CANVAS_WIDTH;

    if (easedPeek < 0.999) {
      ctx.save();
      ctx.translate(selfShift, 0);
      this._renderBattlefield(ctx, snap.self, prev?.self, snap.tick, interp, nowMs, true);
      this._renderEffectsForSide(ctx, 'self');
      ctx.restore();
    }

    if (easedPeek > 0.001) {
      ctx.save();
      ctx.translate(oppShift, 0);
      this._renderBattlefield(ctx, snap.opponent, prev?.opponent, snap.tick, interp, nowMs, false);
      this._renderEffectsForSide(ctx, 'opponent');

      ctx.strokeStyle = 'rgba(155, 114, 242, 0.72)';
      ctx.lineWidth = 5;
      ctx.setLineDash([14, 10]);
      ctx.strokeRect(10, 62, CANVAS_WIDTH - 20, 520);
      ctx.setLineDash([]);
      ctx.restore();
    }

    this.renderMs = Number((performance.now() - tStart).toFixed(2));
  }

  _drawObstaclesAndBuffs(ctx, clearedSet) {
    const mapDef = getMapDef(this.mapId);
    for (const obs of mapDef.obstacles) {
      const key = cellKey(obs.col, obs.row);
      const px = GRID_X0 + obs.col * CELL_W;
      const py = GRID_Y0 + obs.row * CELL_H;
      if (clearedSet.has(key)) {
        const tileSprite = this.buffTileSprites.get(obs.buff);
        if (tileSprite) {
          ctx.drawImage(tileSprite, px, py, CELL_W, CELL_H);
        }
      } else {
        const obsSprite = this.obstacleSprites.get(`${obs.kind}_${obs.buff}`);
        if (obsSprite) {
          ctx.drawImage(obsSprite, px, py, CELL_W, CELL_H);
        }
      }
    }
  }

  _renderBattlefield(ctx, side, prevSide, tick, interp, nowMs, isSelf) {
    // Layer 1: Static Map Cache
    ctx.drawImage(this.mapCache, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Dynamic Obstacles (1B buff badges) & Cleared Buff Tiles
    const clearedSet = isSelf ? this._selfClearedSet : this._oppClearedSet;
    this._drawObstaclesAndBuffs(ctx, clearedSet);

    // Selected obstacle highlight
    if (isSelf && !this.isPeekingProtected() && this.selectedObstacleKey) {
      const [sc, sr] = this.selectedObstacleKey.split(',').map(Number);
      if (Number.isInteger(sc) && Number.isInteger(sr)) {
        const ox = GRID_X0 + sc * CELL_W;
        const oy = GRID_Y0 + sr * CELL_H;
        ctx.strokeStyle = '#FFD147';
        ctx.lineWidth = 3;
        ctx.strokeRect(ox + 2, oy + 2, CELL_W - 4, CELL_H - 4);
      }
    }

    // Caramel Lava Zones
    if (side.lavaZones && side.lavaZones.length > 0) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#FFD147';
      ctx.fillStyle = '#FF7A2F';
      for (const z of side.lavaZones) {
        const fade = Math.min(1, z.remainTicks / 15);
        const pulse = 1 + 0.04 * Math.sin(nowMs * 0.008 + z.id);
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.radius * pulse, 0, Math.PI * 2);
        ctx.globalAlpha = 0.42 * fade;
        ctx.fill();
        ctx.globalAlpha = 0.7 * fade;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Placement hover preview (only on self when not peeking)
    if (isSelf && !this.isPeekingProtected() && this.selectedBuildType && this.hoverCell) {
      const { col, row } = this.hoverCell;
      const occupied = side.towers.some((t) => t.col === col && t.row === row);
      const def = TOWER_DEFS[this.selectedBuildType];
      const canPlace =
        isBuildableCell(this.mapId, col, row, clearedSet) &&
        !occupied &&
        side.gold >= def.levels[0].cost;
      const px = GRID_X0 + col * CELL_W;
      const py = GRID_Y0 + row * CELL_H;
      const center = cellToPixel(col, row);
      const buff = getBuffAt(this.mapId, col, row, clearedSet);
      const previewRange = def.levels[0].range * (buff === 'range' ? 1.2 : 1);

      ctx.save();
      ctx.fillStyle = canPlace ? 'rgba(56, 198, 180, 0.28)' : 'rgba(255, 91, 125, 0.30)';
      ctx.fillRect(px + 2, py + 2, CELL_W - 4, CELL_H - 4);
      ctx.strokeStyle = canPlace ? '#28A898' : '#E84E73';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 2, py + 2, CELL_W - 4, CELL_H - 4);

      ctx.beginPath();
      ctx.arc(center.x, center.y, previewRange, 0, Math.PI * 2);
      ctx.fillStyle = canPlace ? 'rgba(56, 198, 180, 0.10)' : 'rgba(255, 91, 125, 0.08)';
      ctx.fill();
      ctx.strokeStyle = canPlace ? 'rgba(56, 198, 180, 0.55)' : 'rgba(255, 91, 125, 0.55)';
      ctx.setLineDash([6, 6]);
      ctx.stroke();
      ctx.restore();
    } else if (isSelf && !this.isPeekingProtected() && this.hoverCell && !this.selectedBuildType) {
      const obs = getObstacleAt(this.mapId, this.hoverCell.col, this.hoverCell.row);
      if (obs && !clearedSet.has(cellKey(obs.col, obs.row))) {
        const ox = GRID_X0 + obs.col * CELL_W;
        const oy = GRID_Y0 + obs.row * CELL_H;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 180, 60, 0.85)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(ox + 2, oy + 2, CELL_W - 4, CELL_H - 4);
        ctx.restore();
      }
    }

    // Selected own tower range circle
    if (isSelf && this.selectedTowerId) {
      const sel = side.towers.find((t) => t.id === this.selectedTowerId);
      if (sel) {
        this._drawRangeCircle(ctx, sel, 'rgba(155, 114, 242, 0.10)', 'rgba(155, 114, 242, 0.65)');
      }
    }

    // Hovered opponent tower range circle (locked opponent view)
    if (!isSelf && this.hoverOpponentTowerId) {
      const hov = side.towers.find((t) => t.id === this.hoverOpponentTowerId);
      if (hov) {
        this._drawRangeCircle(ctx, hov, 'rgba(155, 114, 242, 0.11)', 'rgba(155, 114, 242, 0.72)');
      }
    }

    // Towers
    const timeSec = nowMs * 0.001;
    for (const t of side.towers) {
      const pos = cellToPixel(t.col, t.row);
      const spriteKey = t.level === 3 ? `${t.type}_3_${t.branch || 'A'}` : `${t.type}_${t.level}`;
      const sprite = this.towerBaseSprites.get(spriteKey);
      const breath = 1 + 0.025 * Math.sin(timeSec * 3.4 + t.id);

      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.scale(breath, breath);
      if (sprite) {
        ctx.drawImage(sprite, -42, -42, 84, 84);
      }

      ctx.rotate(t.angle || 0);
      const recoilOffset = -(t.recoil || 0) * 5;
      ctx.translate(recoilOffset, 0);
      this._drawTowerBarrel(ctx, t.type, t.level, t.branch);
      ctx.restore();
    }

    // Creeps (interpolated)
    const prevMap = this._prevCreepMap;
    prevMap.clear();
    if (prevSide && prevSide.creeps) {
      for (const pc of prevSide.creeps) prevMap.set(pc.id, pc);
    }
    for (const c of side.creeps) {
      const pc = prevMap.get(c.id);
      const ix = pc ? pc.x + (c.x - pc.x) * interp : c.x;
      const iy = pc ? pc.y + (c.y - pc.y) * interp : c.y;
      this._drawCreep(ctx, c, ix, iy, timeSec);
    }

    // Projectiles
    for (const p of side.projectiles || []) {
      this._drawProjectile(ctx, p);
    }

    // 2A Express Delivery Trucks incoming at map entry
    if (side.incomingAlerts && side.incomingAlerts.length > 0) {
      const count = Math.min(2, side.incomingAlerts.length);
      for (let i = 0; i < count; i++) {
        this._drawExpressTruck(ctx, side.incomingAlerts[i], tick, timeSec, i);
      }
    }
  }

  _drawRangeCircle(ctx, tower, fill, stroke) {
    const lvDef = getTowerLevelDef(tower.type, tower.level, tower.branch);
    if (!lvDef) return;
    const range = lvDef.range * (tower.buffTile === 'range' ? 1.2 : 1);
    const pos = cellToPixel(tower.col, tower.row);
    ctx.save();
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, range, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.restore();
  }

  _drawTowerBarrel(ctx, type, level, branch) {
    const def = TOWER_DEFS[type];
    ctx.fillStyle = '#FFFDF9';
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2;

    if (type === 'strawberry') {
      if (level === 3 && branch === 'A') {
        // Gatling twin barrel
        ctx.fillStyle = '#FFF5F8';
        this._roundRect(ctx, 2, -7, 22, 5, 2.5);
        ctx.fill();
        ctx.stroke();
        this._roundRect(ctx, 2, 2, 22, 5, 2.5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#FF5526';
        ctx.beginPath();
        ctx.arc(23, -4.5, 2.8, 0, Math.PI * 2);
        ctx.arc(23, 4.5, 2.8, 0, Math.PI * 2);
        ctx.fill();
      } else if (level === 3 && branch === 'B') {
        // Flared scatter barrel
        ctx.fillStyle = '#F7ECFF';
        ctx.strokeStyle = '#9B59F6';
        ctx.beginPath();
        ctx.moveTo(2, -5);
        ctx.lineTo(22, -9);
        ctx.lineTo(22, 9);
        ctx.lineTo(2, 5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        this._roundRect(ctx, 2, -5 - level * 0.5, 16 + level * 2, 10 + level, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#FF4F79';
        ctx.beginPath();
        ctx.arc(16 + level * 2, 0, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (type === 'mint') {
      if (level === 3 && branch === 'A') {
        ctx.fillStyle = '#C9FAFF';
        ctx.strokeStyle = '#2BB8E8';
        ctx.beginPath();
        ctx.arc(4, 0, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(14, 0, 4.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (level === 3 && branch === 'B') {
        ctx.fillStyle = '#E5D8FF';
        ctx.strokeStyle = '#7E57EB';
        ctx.beginPath();
        ctx.moveTo(18, 0);
        ctx.lineTo(5, -10);
        ctx.lineTo(-4, 0);
        ctx.lineTo(5, 10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = '#B8F9EF';
        ctx.beginPath();
        ctx.arc(4, 0, 9 + level, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(10 + level, 0, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (type === 'popcorn') {
      if (level === 3 && branch === 'A') {
        this._roundRect(ctx, 0, -9, 23, 18, 5);
        ctx.fillStyle = '#FFE4C7';
        ctx.fill();
        ctx.strokeStyle = '#FF5D26';
        ctx.stroke();
        ctx.fillStyle = '#FF6A2B';
        ctx.beginPath();
        ctx.arc(13, 0, 5, 0, Math.PI * 2);
        ctx.fill();
      } else if (level === 3 && branch === 'B') {
        this._roundRect(ctx, 0, -8, 22, 16, 4);
        ctx.fillStyle = '#FFF5DE';
        ctx.fill();
        ctx.strokeStyle = '#9B59F6';
        ctx.stroke();
        ctx.fillStyle = '#FFD147';
        ctx.beginPath();
        ctx.arc(18, -4, 3.2, 0, Math.PI * 2);
        ctx.arc(18, 4, 3.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        this._roundRect(ctx, 0, -7, 17 + level * 2, 14, 4);
        ctx.fillStyle = '#FFF0D4';
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#FF944D';
        ctx.fillRect(6, -5, 4, 10);
      }
    } else if (type === 'lemon') {
      if (level === 3 && branch === 'A') {
        // Twin rail prongs
        ctx.fillStyle = '#FFFCE0';
        ctx.strokeStyle = '#38B6FF';
        this._roundRect(ctx, 2, -7, 30, 4.5, 2);
        ctx.fill();
        ctx.stroke();
        this._roundRect(ctx, 2, 2.5, 30, 4.5, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#38B6FF';
        ctx.fillRect(8, -2, 12, 4);
      } else if (level === 3 && branch === 'B') {
        // Executioner long scope sniper
        this._roundRect(ctx, 2, -4, 34, 8, 4);
        ctx.fillStyle = '#FFF6D6';
        ctx.fill();
        ctx.strokeStyle = '#E83B5E';
        ctx.stroke();
        ctx.fillStyle = '#FF385C';
        ctx.beginPath();
        ctx.arc(33, 0, 4.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        this._roundRect(ctx, 2, -4, 24 + level * 3, 8, 4);
        ctx.fillStyle = '#FFFAD2';
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#FFD147';
        ctx.beginPath();
        ctx.arc(24 + level * 3, 0, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _drawCreep(ctx, c, x, y, timeSec) {
    const frozen = c.freezeTicks > 0;
    const bounce = frozen ? 0 : Math.sin(timeSec * 8 + c.id) * 1.8;
    ctx.save();
    ctx.translate(x, y + bounce);

    ctx.fillStyle = 'rgba(95, 58, 82, 0.16)';
    ctx.beginPath();
    ctx.ellipse(0, 14 - bounce, 12, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    if (c.rainbow) {
      const hue = (timeSec * 180 + c.id * 40) % 360;
      ctx.strokeStyle = `hsla(${hue}, 90%, 66%, 0.85)`;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (c.slowTicks > 0 && !frozen) {
      ctx.strokeStyle = 'rgba(56, 198, 180, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (c.vulnTicks > 0) {
      ctx.strokeStyle = 'rgba(155, 114, 242, 0.88)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(0, 0, 21, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Healer green aura pulse
    if (c.healPulseTicks > 0) {
      ctx.strokeStyle = 'rgba(57, 255, 156, 0.65)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 28 + (12 - c.healPulseTicks) * 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Natural Creeps
    if (c.type === 'jelly') {
      ctx.fillStyle = '#FF6B8B';
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(-4, -4, 3.5, 0, Math.PI * 2);
      ctx.fill();
      this._drawCuteEyes(ctx, 0, 1);
    } else if (c.type === 'gummy_pack') {
      ctx.fillStyle = '#FF8AD4';
      ctx.beginPath();
      ctx.arc(-9, -6, 5, 0, Math.PI * 2);
      ctx.arc(9, -6, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, 11.5, 0, Math.PI * 2);
      ctx.fill();
      this._drawCuteEyes(ctx, 0, 1);
    } else if (c.type === 'toffee') {
      this._roundRect(ctx, -14, -14, 28, 28, 6);
      ctx.fillStyle = '#D4943A';
      ctx.fill();
      ctx.strokeStyle = '#FFE28A';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.fillRect(-10, -10, 8, 4);
      this._drawCuteEyes(ctx, 0, 1);
    } else if (c.type === 'macaron_stack') {
      ctx.fillStyle = c.cracked ? '#FF9EB8' : '#A58BF5';
      this._roundRect(ctx, -16, -12, 32, 9, 4);
      ctx.fill();
      ctx.fillStyle = '#FFFDF5';
      ctx.fillRect(-15, -3, 30, 5);
      ctx.fillStyle = c.cracked ? '#FF7B9C' : '#8C6FE8';
      this._roundRect(ctx, -16, 2, 32, 9, 4);
      ctx.fill();
      if (c.cracked) {
        ctx.strokeStyle = '#FFF0F5';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-6, -11);
        ctx.lineTo(0, -4);
        ctx.lineTo(6, -10);
        ctx.stroke();
      }
      this._drawCuteEyes(ctx, 0, -6);
    } else if (c.type === 'giant_cake') {
      ctx.fillStyle = '#FFE4EE';
      this._roundRect(ctx, -21, -2, 42, 16, 5);
      ctx.fill();
      ctx.fillStyle = '#FFFDF9';
      this._roundRect(ctx, -16, -13, 32, 12, 4);
      ctx.fill();
      ctx.fillStyle = '#FFC2D6';
      this._roundRect(ctx, -10, -21, 20, 9, 4);
      ctx.fill();
      ctx.fillStyle = '#FFD147';
      ctx.beginPath();
      ctx.moveTo(-7, -21);
      ctx.lineTo(-4, -29);
      ctx.lineTo(0, -23);
      ctx.lineTo(4, -29);
      ctx.lineTo(7, -21);
      ctx.closePath();
      ctx.fill();
      this._drawCuteEyes(ctx, 0, -6);
    }
    // Dark / Neon Raid Forces
    else if (c.type === 'dark_pop') {
      ctx.fillStyle = '#2B1638';
      ctx.strokeStyle = '#FF4FD8';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(0, 0, 11.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      this._drawNeonEyes(ctx, 0, 1, '#FF80E6');
    } else if (c.type === 'neon_dasher') {
      ctx.fillStyle = '#181A36';
      ctx.strokeStyle = '#3BF2FF';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-10, -10);
      ctx.lineTo(-5, 0);
      ctx.lineTo(-10, 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      this._drawNeonEyes(ctx, 2, 0, '#78FAFF');
    } else if (c.type === 'shield_choco') {
      this._roundRect(ctx, -14, -14, 28, 28, 6);
      ctx.fillStyle = '#25172E';
      ctx.fill();
      ctx.strokeStyle = '#4BA3FF';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      this._drawNeonEyes(ctx, 0, 0, '#7CC4FF');
    } else if (c.type === 'dark_healer') {
      ctx.fillStyle = '#1F132B';
      ctx.strokeStyle = '#39FF9C';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Healing cross emblem
      ctx.fillStyle = '#39FF9C';
      ctx.fillRect(-3, -10, 6, 20);
      ctx.fillRect(-10, -3, 20, 6);
      this._drawNeonEyes(ctx, 0, -5, '#E4FFF1');
    } else if (c.type === 'iron_titan') {
      this._roundRect(ctx, -20, -18, 40, 36, 9);
      ctx.fillStyle = '#1A1324';
      ctx.fill();
      ctx.strokeStyle = '#FF7A2F';
      ctx.lineWidth = 3.2;
      ctx.stroke();
      // Obsidian horns
      ctx.fillStyle = '#FF7A2F';
      ctx.beginPath();
      ctx.moveTo(-14, -18);
      ctx.lineTo(-18, -26);
      ctx.lineTo(-7, -18);
      ctx.moveTo(14, -18);
      ctx.lineTo(18, -26);
      ctx.lineTo(7, -18);
      ctx.fill();
      this._drawNeonEyes(ctx, 0, -2, '#FFB347');
    }

    // Hit-count shield hexagon ring
    if (c.shieldHits > 0) {
      const sr = c.isBoss ? 26 : 20;
      ctx.strokeStyle = '#52C8FF';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI / 3) * i - Math.PI / 6;
        const hx = Math.cos(ang) * sr;
        const hy = Math.sin(ang) * sr;
        if (i === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // Shred armor-break mark
    if (c.shredTicks > 0) {
      ctx.strokeStyle = '#FF5533';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-9, -8);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-8, 7);
      ctx.stroke();
    }

    // Frozen ice block overlay
    if (frozen) {
      const fr = c.isBoss ? 22 : 16;
      this._roundRect(ctx, -fr, -fr, fr * 2, fr * 2, 6);
      ctx.fillStyle = 'rgba(136, 238, 255, 0.45)';
      ctx.fill();
      ctx.strokeStyle = '#BDF9FF';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Crisp HP bar + optional shield counter pill
    const barW = c.isBoss ? 38 : 26;
    const barY = c.isBoss ? -33 : -22;
    const ratio = Math.max(0, Math.min(1, c.hp / Math.max(1, c.maxHp)));
    ctx.fillStyle = 'rgba(58, 36, 54, 0.65)';
    this._roundRect(ctx, -barW / 2 - 1, barY - 1, barW + 2, 6, 3);
    ctx.fill();
    ctx.fillStyle = c.isDark ? '#D27DFF' : ratio > 0.45 ? '#5CE0B8' : '#FF5D84';
    if (barW * ratio > 0.5) {
      this._roundRect(ctx, -barW / 2, barY, barW * ratio, 4, 2);
      ctx.fill();
    }

    if (c.shieldHits > 0) {
      const badge = this.shieldBadgeSprites.get(c.shieldHits);
      if (badge) {
        ctx.drawImage(badge, -12, barY - 14, 24, 12);
      } else {
        ctx.fillStyle = '#1462B8';
        this._roundRect(ctx, -11, barY - 13, 22, 11, 5);
        ctx.fill();
        ctx.fillStyle = '#D6F3FF';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`S${c.shieldHits}`, 0, barY - 4.5);
      }
    }

    ctx.restore();
  }

  _drawCuteEyes(ctx, ox, oy) {
    ctx.fillStyle = '#3F273B';
    ctx.beginPath();
    ctx.arc(ox - 4, oy, 1.8, 0, Math.PI * 2);
    ctx.arc(ox + 4, oy, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawNeonEyes(ctx, ox, oy, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ox - 4, oy, 2.0, 0, Math.PI * 2);
    ctx.arc(ox + 4, oy, 2.0, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawProjectile(ctx, p) {
    if (p.type === 'strawberry') {
      ctx.fillStyle = p.isSecondary ? '#C97BFF' : p.branch === 'A' ? '#FF385C' : '#FF6B8B';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.isSecondary ? 3.5 : 4.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFF';
      ctx.beginPath();
      ctx.arc(p.x - 1.5, p.y - 1.5, 1.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.type === 'mint') {
      ctx.fillStyle = p.branch === 'B' ? '#C7B0FF' : '#89F7EA';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = p.branch === 'B' ? '#7E57EB' : '#38C6B4';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (p.type === 'popcorn') {
      const arcLift = Math.sin(Math.min(1, p.progress) * Math.PI) * (p.isSecondary ? 14 : 26);
      ctx.fillStyle = 'rgba(110, 68, 40, 0.2)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 4, 5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.branch === 'A' ? '#FF8038' : '#FFD26A';
      ctx.beginPath();
      ctx.arc(p.x, p.y - arcLift, p.isSecondary ? 4.5 : 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = p.branch === 'A' ? '#FF3E1D' : '#FF944D';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
  }

  // 2A: Express Truck displays explicit 💚 奶妈车 or 🛡️ 铁王八 icon
  _drawExpressTruck(ctx, alert, tick, timeSec, queueIdx = 0) {
    const mapDef = getMapDef(this.mapId);
    const entry = mapDef.pointsPx[0];
    const remainTicks = Math.max(0, alert.arriveTick - tick);
    const ratio = 1 - remainTicks / Math.max(1, alert.totalTicks || 60);
    const truckX = entry.x - 36 + ratio * 38 - queueIdx * 36;
    const truckY = entry.y - 36 + queueIdx * 4 + Math.sin(timeSec * 14 + queueIdx) * 1.4;
    const secLabel = (remainTicks / 20).toFixed(1);
    const def = SEND_DEFS[alert.sendType];
    const icon = def ? def.icon : '🚚';
    const bodyColor = alert.sendType === 'express_titan' ? '#FF7A2F' : '#39D98A';

    ctx.save();
    ctx.translate(truckX, truckY);

    this._roundRect(ctx, -20, -14, 34, 22, 6);
    ctx.fillStyle = '#251731';
    ctx.fill();
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    this._roundRect(ctx, 11, -9, 13, 17, 4);
    ctx.fillStyle = bodyColor;
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#4A3548';
    ctx.beginPath();
    ctx.arc(-10, 10, 5, 0, Math.PI * 2);
    ctx.arc(13, 10, 5, 0, Math.PI * 2);
    ctx.fill();

    this._roundRect(ctx, -24, -37, 56, 19, 9);
    ctx.fillStyle = '#251731';
    ctx.fill();
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${icon} ${secLabel}s`, 4, -24);

    ctx.restore();
  }

  _stepPoolsAndEffects(dtSec) {
    let activePart = 0;
    for (let i = 0; i < PARTICLE_POOL_MAX; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life -= dtSec;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      activePart++;
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.vy += 120 * dtSec;
    }
    this.activeParticleCount = activePart;

    let activeText = 0;
    for (let i = 0; i < FLOAT_TEXT_POOL_MAX; i++) {
      const ft = this.floatTexts[i];
      if (!ft.active) continue;
      ft.life -= dtSec;
      if (ft.life <= 0) {
        ft.active = false;
        continue;
      }
      activeText++;
      ft.y += ft.vy * dtSec;
    }
    this.activeFloatTextCount = activeText;

    this.lasers = this.lasers.filter((l) => {
      l.life -= dtSec * 5.5;
      return l.life > 0;
    });
    this.splashRings = this.splashRings.filter((s) => {
      s.life -= dtSec * 3.2;
      return s.life > 0;
    });
  }

  _renderEffectsForSide(ctx, side) {
    for (let i = 0; i < PARTICLE_POOL_MAX; i++) {
      const p = this.particles[i];
      if (!p.active || p.side !== side) continue;
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const l of this.lasers) {
      if (l.side !== side) continue;
      ctx.globalAlpha = l.life;
      ctx.strokeStyle = l.branch === 'A' ? '#38B6FF' : l.branch === 'B' ? '#FF385C' : '#FFD147';
      ctx.lineWidth = l.branch ? 5 : 4;
      ctx.beginPath();
      ctx.moveTo(l.fromX, l.fromY);
      ctx.lineTo(l.toX, l.toY);
      ctx.stroke();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    ctx.lineWidth = 3;
    for (const s of this.splashRings) {
      if (s.side !== side) continue;
      ctx.globalAlpha = s.life * 0.55;
      ctx.strokeStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (1 - s.life * 0.35), 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    for (let i = 0; i < FLOAT_TEXT_POOL_MAX; i++) {
      const ft = this.floatTexts[i];
      if (!ft.active || ft.side !== side) continue;
      ctx.globalAlpha = Math.min(1, (ft.life / ft.maxLife) * 1.4);
      ctx.font = `800 ${ft.fontSize}px sans-serif`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillText(ft.text, ft.x + 1, ft.y + 1);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.globalAlpha = 1;
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
