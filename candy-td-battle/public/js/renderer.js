import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  CELL_H,
  CELL_W,
  FLOAT_TEXT_POOL_MAX,
  GRID_COLS,
  GRID_HEIGHT,
  GRID_ROWS,
  GRID_WIDTH,
  GRID_X0,
  GRID_Y0,
  MAX_DPR,
  OBSTACLES,
  PARTICLE_POOL_MAX,
  PATH_CELL_SET,
  PATH_POINTS_PX,
  PEEK_ENTER_MS,
  PEEK_EXIT_MS,
  TOWER_DEFS,
  TOWER_ORDER,
  cellKey,
  cellToPixel,
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

    this.mapCache = null;
    this.towerBaseSprites = new Map();

    // Fixed-cap circular pools (no GC spikes)
    this.particles = Array.from({ length: PARTICLE_POOL_MAX }, () => ({ active: false }));
    this.particleCursor = 0;
    this.activeParticleCount = 0;

    this.floatTexts = Array.from({ length: FLOAT_TEXT_POOL_MAX }, () => ({ active: false }));
    this.floatTextCursor = 0;
    this.activeFloatTextCount = 0;

    // Transient visual effects (lasers, feint bubbles, splashes)
    this.lasers = [];
    this.splashRings = [];
    this.feintBubbles = [];

    // Snapshot & interpolation
    this.mySlot = 0;
    this.prevSnapshot = null;
    this.currSnapshot = null;
    this.lastSnapTime = performance.now();

    // Peek camera state
    this.peekActive = false;
    this.peekProgress = 0;

    // Interaction state
    this.hoverCell = null;
    this.selectedBuildType = null;
    this.selectedTowerId = null;

    // Telemetry
    this.fps = 60;
    this.renderMs = 0;
    this._frameCount = 0;
    this._fpsWindowStart = performance.now();

    this.resize();
    this._buildStaticMapCache();
    this._buildTowerBaseSprites();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.canvas.width = Math.round(CANVAS_WIDTH * this.dpr);
    this.canvas.height = Math.round(CANVAS_HEIGHT * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  _createOffscreen(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.round(w * this.dpr);
    c.height = Math.round(h * this.dpr);
    const octx = c.getContext('2d');
    octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return { canvas: c, ctx: octx };
  }

  _buildStaticMapCache() {
    const { canvas, ctx } = this._createOffscreen(CANVAS_WIDTH, CANVAS_HEIGHT);
    this.mapCache = canvas;

    // Soft pastel backdrop
    const bgGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    bgGrad.addColorStop(0, '#F7FCF1');
    bgGrad.addColorStop(1, '#EBF7E6');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Subtle safety corridor tint (x: 1144..1204)
    ctx.fillStyle = 'rgba(255, 240, 246, 0.55)';
    ctx.fillRect(GRID_X0 + GRID_WIDTH, GRID_Y0, 60, GRID_HEIGHT);

    // Board outer macaron tray
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
        const isPath = PATH_CELL_SET.has(cellKey(col, row));
        if (!isPath) {
          ctx.fillStyle = (col + row) % 2 === 0 ? '#ECF7E8' : '#E3F2DC';
          ctx.fillRect(x, y, CELL_W, CELL_H);
          ctx.strokeStyle = 'rgba(182, 214, 168, 0.35)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, CELL_W - 1, CELL_H - 1);

          // Tiny sugar clover dot on select tiles
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

    // Outer caramel crust
    ctx.beginPath();
    PATH_POINTS_PX.forEach((pt, idx) => {
      if (idx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.strokeStyle = '#E9C99B';
    ctx.lineWidth = 46;
    ctx.stroke();

    // Inner vanilla cream
    ctx.strokeStyle = '#FFF3DA';
    ctx.lineWidth = 38;
    ctx.stroke();

    // Center dashed sugar ribbon
    ctx.setLineDash([8, 12]);
    ctx.strokeStyle = 'rgba(255, 175, 198, 0.5)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Entry arch at (0,2)
    const entry = PATH_POINTS_PX[0];
    this._drawCandyGate(ctx, entry.x - 22, entry.y);

    // Exit Candy Castle at (17,5)
    const exit = PATH_POINTS_PX[PATH_POINTS_PX.length - 1];
    this._drawCandyCastle(ctx, exit.x + 8, exit.y);

    // 4 Dessert Obstacles
    for (const obs of OBSTACLES) {
      const p = cellToPixel(obs.col, obs.row);
      this._drawObstacle(ctx, obs.kind, p.x, p.y);
    }
  }

  _drawCandyGate(ctx, x, y) {
    ctx.save();
    ctx.fillStyle = 'rgba(130, 82, 108, 0.14)';
    ctx.beginPath();
    ctx.ellipse(x + 8, y + 18, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Candy cane pillars
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

    // Castle body
    this._roundRect(ctx, x - 18, y - 10, 36, 28, 7);
    ctx.fillStyle = '#FFF5FA';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#FF9AB5';
    ctx.stroke();

    // Turret roofs
    ctx.fillStyle = '#FF6B8B';
    ctx.beginPath();
    ctx.moveTo(x - 20, y - 10);
    ctx.lineTo(x, y - 28);
    ctx.lineTo(x + 20, y - 10);
    ctx.closePath();
    ctx.fill();

    // Golden heart jewel
    ctx.fillStyle = '#FFD147';
    ctx.beginPath();
    ctx.arc(x, y - 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawObstacle(ctx, kind, x, y) {
    ctx.save();
    // Soft grass pad
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
      // cotton cloud bush
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
    for (const type of TOWER_ORDER) {
      const def = TOWER_DEFS[type];
      for (let level = 1; level <= 3; level++) {
        const key = `${type}_${level}`;
        const size = 84;
        const { canvas, ctx } = this._createOffscreen(size, size);
        const cx = size / 2;
        const cy = size / 2;

        // Dual translucent shadow (no shadowBlur!)
        ctx.fillStyle = 'rgba(110, 68, 92, 0.12)';
        ctx.beginPath();
        ctx.ellipse(cx, cy + 16, 21 + level * 1.5, 8.5, 0, 0, Math.PI * 2);
        ctx.fill();

        // Cushion pad
        ctx.fillStyle = level === 3 ? '#FFF3C2' : '#FFFFFF';
        ctx.beginPath();
        ctx.arc(cx, cy + 2, 20 + level * 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = level === 3 ? 2.5 : 2;
        ctx.strokeStyle = level === 3 ? '#F4B43A' : def.color;
        ctx.stroke();

        // Inner candy dome
        ctx.fillStyle = def.color;
        ctx.beginPath();
        ctx.arc(cx, cy, 15 + level * 1.4, 0, Math.PI * 2);
        ctx.fill();

        // Frosting ring for Lv2 & Lv3
        if (level >= 2) {
          ctx.strokeStyle = def.accent;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(cx, cy, 12 + level * 1.1, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Glossy candy highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.58)';
        ctx.beginPath();
        ctx.ellipse(cx - 5, cy - 6, 6, 3.2, -0.5, 0, Math.PI * 2);
        ctx.fill();

        // Level stars badge
        for (let s = 0; s < level; s++) {
          const sx = cx - ((level - 1) * 5) + s * 10;
          const sy = cy + 18;
          ctx.fillStyle = '#FFD147';
          ctx.beginPath();
          ctx.arc(sx, sy, 3.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#9E6700';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }

        this.towerBaseSprites.set(key, canvas);
      }
    }
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
    this.lasers = [];
    this.splashRings = [];
    this.feintBubbles = [];
    for (let i = 0; i < PARTICLE_POOL_MAX; i++) this.particles[i].active = false;
    for (let i = 0; i < FLOAT_TEXT_POOL_MAX; i++) this.floatTexts[i].active = false;
    this.activeParticleCount = 0;
    this.activeFloatTextCount = 0;
    this.hoverCell = null;
    this.selectedBuildType = null;
    this.selectedTowerId = null;
    this.peekActive = false;
    this.peekProgress = 0;
  }

  pushSnapshot(snap) {
    this.prevSnapshot = this.currSnapshot || snap;
    this.currSnapshot = snap;
    this.lastSnapTime = performance.now();
  }

  handleEvents(events) {
    for (const ev of events) {
      if (ev.type === 'tower_built') {
        const side = this._sideForSlot(ev.slot);
        this._burstParticles(ev.x, ev.y, '#FF9AB5', 14, 70, side);
        this.spawnFloatText(ev.x, ev.y - 16, '✨ 建塔!', '#E84E73', 1.0, 14, side);
      } else if (ev.type === 'tower_upgraded') {
        const side = this._sideForSlot(ev.slot);
        this._burstParticles(ev.x, ev.y, '#FFD147', 18, 85, side);
        this.spawnFloatText(ev.x, ev.y - 18, `⭐ Lv.${ev.level}!`, '#D48A00', 1.0, 14, side);
      } else if (ev.type === 'tower_sold') {
        const side = this._sideForSlot(ev.slot);
        this._burstParticles(ev.x, ev.y, '#FFE08A', 12, 65, side);
        this.spawnFloatText(ev.x, ev.y - 14, `+$${ev.refund}`, '#269B66', 1.0, 14, side);
      } else if (ev.type === 'eco_payout') {
        const side = this._sideForSlot(ev.slot);
        this.spawnFloatText(640, 128, `+$${ev.amount} Eco 💰`, '#138A78', 1.4, 20, side);
      } else if (ev.type === 'crit_hit') {
        const side = this._sideForSlot(ev.slot);
        this.spawnFloatText(ev.x, ev.y - 18, `🍓 暴击 ${ev.damage}!`, '#E83E6B', 0.9, 14, side);
      } else if (ev.type === 'life_lost') {
        const side = this._sideForSlot(ev.slot);
        this._burstParticles(ev.x, ev.y, '#FF4D6D', 14, 75, side);
        this.spawnFloatText(ev.x - 10, ev.y - 24, `-${ev.amount} ❤️`, '#D9264E', 1.2, 16, side);
      } else if (ev.type === 'tower_shot' && ev.towerType === 'lemon') {
        const side = this._sideForSlot(ev.slot);
        this.lasers.push({
          fromX: ev.fromX,
          fromY: ev.fromY,
          toX: ev.toX,
          toY: ev.toY,
          pierceX: ev.pierceX,
          pierceY: ev.pierceY,
          side,
          life: 1.0
        });
        if (ev.armoredHit) {
          this._burstParticles(ev.toX, ev.toY, '#FFD147', 8, 60, side);
        }
      } else if (ev.type === 'mint_splash') {
        const side = this._sideForSlot(ev.slot);
        this.splashRings.push({ x: ev.x, y: ev.y, r: ev.radius, color: '#38C6B4', side, life: 1 });
        this._burstParticles(ev.x, ev.y, '#88F2E6', 6, 45, side);
      } else if (ev.type === 'popcorn_boom') {
        const side = this._sideForSlot(ev.slot);
        this.splashRings.push({ x: ev.x, y: ev.y, r: ev.radius, color: '#FF944D', side, life: 1 });
        this._burstParticles(ev.x, ev.y, '#FFB84D', 10, 75, side);
      } else if (ev.type === 'creep_pop') {
        const side = this._sideForSlot(ev.slot);
        this._burstParticles(ev.x, ev.y, '#FF85A1', 8, 55, side);
        this.spawnFloatText(ev.x, ev.y - 12, `+$${ev.bounty}`, '#B87400', 0.75, 12, side);
      } else if (ev.type === 'macaron_cracked') {
        const side = this._sideForSlot(ev.slot);
        this._burstParticles(ev.x, ev.y, '#C8B6FF', 12, 80, side);
      } else if (ev.type === 'express_arrived_real') {
        const side = this._sideForSlot(ev.targetSlot);
        const entry = PATH_POINTS_PX[0];
        this._burstParticles(entry.x + 12, entry.y, '#FF6B8B', 22, 110, side);
      } else if (ev.type === 'express_arrived_feint') {
        const side = this._sideForSlot(ev.targetSlot);
        const entry = PATH_POINTS_PX[0];
        const colors = ['#FF6B8B', '#FFD147', '#38C6B4', '#9B72F2', '#FF944D'];
        for (let i = 0; i < 34; i++) {
          const c = colors[i % colors.length];
          this._burstParticles(entry.x + 18, entry.y - 6, c, 1, 140, side);
        }
        this.feintBubbles.push({
          side,
          x: entry.x + 120,
          y: entry.y - 44,
          life: 2.2,
          maxLife: 2.2,
          text: '😜 空快递盒！骗到你啦~'
        });
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

  setPeekActive(active) {
    this.peekActive = Boolean(active);
  }

  isPeekingProtected() {
    return this.peekActive || this.peekProgress > 0.05;
  }

  render(nowMs, dtSec) {
    const tStart = performance.now();

    // Update FPS
    this._frameCount += 1;
    if (nowMs - this._fpsWindowStart >= 500) {
      this.fps = Math.round((this._frameCount * 1000) / (nowMs - this._fpsWindowStart));
      this._frameCount = 0;
      this._fpsWindowStart = nowMs;
    }

    // Update peek tween (260ms enter / 200ms exit)
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

      // Soft pink-lavender dashed border during peek
      ctx.strokeStyle = 'rgba(155, 114, 242, 0.78)';
      ctx.lineWidth = 6;
      ctx.setLineDash([14, 10]);
      ctx.strokeRect(10, 62, CANVAS_WIDTH - 20, 520);
      ctx.setLineDash([]);

      // Smooth sliding peek status pill
      this._roundRect(ctx, CANVAS_WIDTH / 2 - 205, 64, 410, 30, 15);
      ctx.fillStyle = 'rgba(124, 77, 199, 0.94)';
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('👀 正在偷看对手战场（移开鼠标或松开 Space 立即回防）', CANVAS_WIDTH / 2, 84);
      ctx.restore();
    }

    this.renderMs = Number((performance.now() - tStart).toFixed(2));
  }

  _renderBattlefield(ctx, side, prevSide, tick, interp, nowMs, isSelf) {
    // Layer 1: Static Map Cache (1 drawImage!)
    ctx.drawImage(this.mapCache, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Placement hover preview (only on self when not peeking)
    if (isSelf && !this.isPeekingProtected() && this.selectedBuildType && this.hoverCell) {
      const { col, row } = this.hoverCell;
      const occupied = side.towers.some((t) => t.col === col && t.row === row);
      const def = TOWER_DEFS[this.selectedBuildType];
      const canPlace = isBuildableCell(col, row) && !occupied && side.gold >= def.levels[0].cost;
      const px = GRID_X0 + col * CELL_W;
      const py = GRID_Y0 + row * CELL_H;
      const center = cellToPixel(col, row);

      ctx.save();
      ctx.fillStyle = canPlace ? 'rgba(56, 198, 180, 0.28)' : 'rgba(255, 91, 125, 0.30)';
      ctx.fillRect(px + 2, py + 2, CELL_W - 4, CELL_H - 4);
      ctx.strokeStyle = canPlace ? '#28A898' : '#E84E73';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 2, py + 2, CELL_W - 4, CELL_H - 4);

      ctx.beginPath();
      ctx.arc(center.x, center.y, def.levels[0].range, 0, Math.PI * 2);
      ctx.fillStyle = canPlace ? 'rgba(56, 198, 180, 0.10)' : 'rgba(255, 91, 125, 0.08)';
      ctx.fill();
      ctx.strokeStyle = canPlace ? 'rgba(56, 198, 180, 0.55)' : 'rgba(255, 91, 125, 0.55)';
      ctx.setLineDash([6, 6]);
      ctx.stroke();
      ctx.restore();
    }

    // Selected tower range circle
    if (isSelf && this.selectedTowerId) {
      const sel = side.towers.find((t) => t.id === this.selectedTowerId);
      if (sel) {
        const range = TOWER_DEFS[sel.type].levels[sel.level - 1].range;
        const pos = cellToPixel(sel.col, sel.row);
        ctx.save();
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, range, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(155, 114, 242, 0.10)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(155, 114, 242, 0.65)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Towers (Layer 2 cached bases + animated barrels)
    const timeSec = nowMs * 0.001;
    for (const t of side.towers) {
      const pos = cellToPixel(t.col, t.row);
      const sprite = this.towerBaseSprites.get(`${t.type}_${t.level}`);
      const breath = 1 + 0.025 * Math.sin(timeSec * 3.4 + t.id);

      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.scale(breath, breath);
      if (sprite) {
        ctx.drawImage(sprite, -42, -42, 84, 84);
      }

      // Rotating turret head with recoil
      ctx.rotate(t.angle || 0);
      const recoilOffset = -(t.recoil || 0) * 5;
      ctx.translate(recoilOffset, 0);
      this._drawTowerBarrel(ctx, t.type, t.level);
      ctx.restore();
    }

    // Creeps (interpolated)
    const prevMap = new Map();
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

    // Pink Express Delivery Truck incoming at entry (supports up to 2 queued)
    if (side.incomingAlerts && side.incomingAlerts.length > 0) {
      const count = Math.min(2, side.incomingAlerts.length);
      for (let i = 0; i < count; i++) {
        this._drawExpressTruck(ctx, side.incomingAlerts[i], tick, timeSec, i);
      }
    }
  }

  _drawTowerBarrel(ctx, type, level) {
    const def = TOWER_DEFS[type];
    ctx.fillStyle = '#FFFDF9';
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2;

    if (type === 'strawberry') {
      this._roundRect(ctx, 2, -5 - level * 0.5, 16 + level * 2, 10 + level, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#FF4F79';
      ctx.beginPath();
      ctx.arc(16 + level * 2, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'mint') {
      ctx.fillStyle = '#B8F9EF';
      ctx.beginPath();
      ctx.arc(4, 0, 9 + level, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(10 + level, 0, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'popcorn') {
      this._roundRect(ctx, 0, -7, 17 + level * 2, 14, 4);
      ctx.fillStyle = '#FFF0D4';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#FF944D';
      ctx.fillRect(6, -5, 4, 10);
    } else if (type === 'lemon') {
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

  _drawCreep(ctx, c, x, y, timeSec) {
    const bounce = Math.sin(timeSec * 8 + c.id) * 1.8;
    ctx.save();
    ctx.translate(x, y + bounce);

    // Shadow
    ctx.fillStyle = 'rgba(95, 58, 82, 0.16)';
    ctx.beginPath();
    ctx.ellipse(0, 14 - bounce, 12, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Overtime Rainbow aura
    if (c.rainbow) {
      const hue = (timeSec * 180 + c.id * 40) % 360;
      ctx.strokeStyle = `hsla(${hue}, 90%, 66%, 0.85)`;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(0, 0, 21, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Slow frost aura
    if (c.slowTicks > 0) {
      ctx.strokeStyle = 'rgba(56, 198, 180, 0.8)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Vulnerability ring (Lv3 Mint)
    if (c.vulnTicks > 0) {
      ctx.strokeStyle = 'rgba(155, 114, 242, 0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(0, 0, 21, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

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
      // 3-tier Wedding Cake Boss
      ctx.fillStyle = '#FFE4EE';
      this._roundRect(ctx, -21, -2, 42, 16, 5);
      ctx.fill();
      ctx.fillStyle = '#FFFDF9';
      this._roundRect(ctx, -16, -13, 32, 12, 4);
      ctx.fill();
      ctx.fillStyle = '#FFC2D6';
      this._roundRect(ctx, -10, -21, 20, 9, 4);
      ctx.fill();
      // Golden crown
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

    // Crisp HP bar
    const barW = c.type === 'giant_cake' ? 38 : 26;
    const barY = c.type === 'giant_cake' ? -34 : -21;
    const ratio = Math.max(0, Math.min(1, c.hp / Math.max(1, c.maxHp)));
    ctx.fillStyle = 'rgba(58, 36, 54, 0.55)';
    this._roundRect(ctx, -barW / 2 - 1, barY - 1, barW + 2, 6, 3);
    ctx.fill();
    ctx.fillStyle = ratio > 0.45 ? '#5CE0B8' : '#FF5D84';
    if (barW * ratio > 0.5) {
      this._roundRect(ctx, -barW / 2, barY, barW * ratio, 4, 2);
      ctx.fill();
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

  _drawProjectile(ctx, p) {
    ctx.save();
    if (p.type === 'strawberry') {
      ctx.fillStyle = p.isCrit ? '#FF2E63' : '#FF6B8B';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.isCrit ? 6.5 : 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFF';
      ctx.beginPath();
      ctx.arc(p.x - 1.5, p.y - 1.5, 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.type === 'mint') {
      ctx.fillStyle = '#89F7EA';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#38C6B4';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (p.type === 'popcorn') {
      const arcLift = Math.sin(Math.min(1, p.progress) * Math.PI) * (p.isSecondary ? 14 : 26);
      ctx.fillStyle = 'rgba(110, 68, 40, 0.2)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 4, 5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFD26A';
      ctx.beginPath();
      ctx.arc(p.x, p.y - arcLift, p.isSecondary ? 4.5 : 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FF944D';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawExpressTruck(ctx, alert, tick, timeSec, queueIdx = 0) {
    const entry = PATH_POINTS_PX[0];
    const remainTicks = Math.max(0, alert.arriveTick - tick);
    const ratio = 1 - remainTicks / Math.max(1, alert.totalTicks || 60);
    const truckX = entry.x - 36 + ratio * 38 - queueIdx * 34;
    const truckY = entry.y - 36 + queueIdx * 4 + Math.sin(timeSec * 14 + queueIdx) * 1.4;
    const secLabel = (remainTicks / 20).toFixed(1);

    ctx.save();
    ctx.translate(truckX, truckY);

    // Pink truck body
    this._roundRect(ctx, -20, -14, 34, 22, 6);
    ctx.fillStyle = '#FF7DA5';
    ctx.fill();
    ctx.strokeStyle = '#FFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Cab
    this._roundRect(ctx, 11, -9, 13, 17, 4);
    ctx.fillStyle = '#FFC2D6';
    ctx.fill();
    ctx.stroke();

    // Wheels
    ctx.fillStyle = '#4A3548';
    ctx.beginPath();
    ctx.arc(-10, 10, 5, 0, Math.PI * 2);
    ctx.arc(13, 10, 5, 0, Math.PI * 2);
    ctx.fill();

    // Countdown bubble
    this._roundRect(ctx, -18, -36, 44, 18, 9);
    ctx.fillStyle = '#4A3548';
    ctx.fill();
    ctx.fillStyle = '#FFD147';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`🚚 ${secLabel}s`, 4, -23);

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
    this.feintBubbles = this.feintBubbles.filter((b) => {
      b.life -= dtSec;
      return b.life > 0;
    });
  }

  _renderEffectsForSide(ctx, side) {
    // Particles belonging solely to this side's battlefield
    for (let i = 0; i < PARTICLE_POOL_MAX; i++) {
      const p = this.particles[i];
      if (!p.active || p.side !== side) continue;
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Lasers belonging solely to this side's battlefield
    for (const l of this.lasers) {
      if (l.side !== side) continue;
      ctx.save();
      ctx.globalAlpha = l.life;
      ctx.strokeStyle = '#FFD147';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(l.fromX, l.fromY);
      ctx.lineTo(l.toX, l.toY);
      if (l.pierceX !== null && l.pierceY !== null) {
        ctx.lineTo(l.pierceX, l.pierceY);
      }
      ctx.stroke();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    }

    // Splash rings belonging solely to this side's battlefield
    for (const s of this.splashRings) {
      if (s.side !== side) continue;
      ctx.save();
      ctx.globalAlpha = s.life * 0.55;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (1 - s.life * 0.35), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Floating texts belonging solely to this side's battlefield
    ctx.textAlign = 'center';
    for (let i = 0; i < FLOAT_TEXT_POOL_MAX; i++) {
      const ft = this.floatTexts[i];
      if (!ft.active || ft.side !== side) continue;
      ctx.globalAlpha = Math.min(1, (ft.life / ft.maxLife) * 1.4);
      ctx.font = `800 ${ft.fontSize}px sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#FFFFFF';
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.globalAlpha = 1;

    // Feint playful bubbles belonging solely to the defender's battlefield
    for (const b of this.feintBubbles) {
      if (b.side !== side) continue;
      ctx.save();
      ctx.globalAlpha = Math.min(1, b.life * 1.5);
      this._roundRect(ctx, b.x - 118, b.y - 22, 236, 40, 20);
      ctx.fillStyle = '#FFF6FB';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#FF6B8B';
      ctx.stroke();
      ctx.fillStyle = '#D63864';
      ctx.font = '800 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(b.text, b.x, b.y + 4);
      ctx.restore();
    }
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
