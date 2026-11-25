import {
  CELL_W,
  CELL_H,
  CREEP_DEFS,
  ECO_PERIOD_TICKS,
  EXPRESS_ALERT_TICKS,
  GRID_COLS,
  GRID_ROWS,
  INITIAL_ECO,
  INITIAL_GOLD,
  INITIAL_HP,
  MAX_MAIN_WAVES,
  MAX_PENDING_EXPRESS,
  OVERTIME_INTERVAL_TICKS,
  SELL_REFUND_RATE,
  SEND_DEFS,
  SEND_ORDER,
  TARGETING_MODES,
  TICK_RATE,
  TOTAL_PATH_LENGTH,
  TOWER_DEFS,
  TOWER_ORDER,
  WAVE_INTERVAL_TICKS,
  WAVE_START_DELAY_TICKS,
  cellKey,
  cellToPixel,
  getPositionAtProgress,
  getWaveConfig,
  isBuildableCell
} from '../public/js/shared/constants.js';

export function createMulberry32(seed) {
  let state = (seed >>> 0) || 1;
  return function nextRand() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createEmptyPlayerState(slot) {
  const sendCooldowns = {};
  for (const key of SEND_ORDER) {
    sendCooldowns[key] = 0;
  }
  return {
    slot,
    hp: INITIAL_HP,
    gold: INITIAL_GOLD,
    eco: INITIAL_ECO,
    towers: [],
    occupiedCells: new Set(),
    creeps: [],
    projectiles: [],
    spawnQueue: [],
    incomingAlerts: [],
    outgoingAlerts: [],
    sendCooldowns,
    stats: {
      towersBuilt: 0,
      towersUpgraded: 0,
      towersSold: 0,
      creepsKilled: 0,
      creepsSent: 0,
      expressSent: 0,
      feintsSent: 0,
      feintsArrived: 0,
      goldEarned: 0,
      damageDealt: 0
    }
  };
}

export class GameSimulation {
  constructor(options = {}) {
    this.seed = Number.isInteger(options.seed) ? options.seed : 20261125;
    this.rng = createMulberry32(this.seed);
    this.tick = 0;
    this.phase = 'PLAYING';
    this.wave = 0;
    this.nextWaveTick = WAVE_START_DELAY_TICKS;
    this.nextEntityId = 1;
    this.players = [createEmptyPlayerState(0), createEmptyPlayerState(1)];
    this.endedResult = null;
    this.tickEvents = [];
  }

  setSeed(seed) {
    this.seed = (Number(seed) >>> 0) || 1;
    this.rng = createMulberry32(this.seed);
  }

  allocId() {
    return this.nextEntityId++;
  }

  emitEvent(viewerScope, payload) {
    this.tickEvents.push({ viewerScope, ...payload });
  }

  applyPlayerAction(slot, action) {
    if (this.phase !== 'PLAYING') {
      return { ok: false, code: 'INVALID_PHASE', message: '当前不在对局进行阶段' };
    }
    const player = this.players[slot];
    if (!player) {
      return { ok: false, code: 'INVALID_PLAYER', message: '玩家槽位无效' };
    }
    if (!action || typeof action !== 'object') {
      return { ok: false, code: 'INVALID_ACTION', message: '指令格式无效' };
    }

    switch (action.type) {
      case 'place_tower':
        return this._handlePlaceTower(player, action);
      case 'upgrade_tower':
        return this._handleUpgradeTower(player, action);
      case 'sell_tower':
        return this._handleSellTower(player, action);
      case 'set_targeting':
        return this._handleSetTargeting(player, action);
      case 'send_wave':
        return this._handleSendWave(player, action);
      default:
        return { ok: false, code: 'UNKNOWN_ACTION', message: '未知操作指令' };
    }
  }

  _handlePlaceTower(player, { towerType, col, row }) {
    const def = TOWER_DEFS[towerType];
    if (!def) {
      return { ok: false, code: 'INVALID_TOWER_TYPE', message: '未知糖果塔类型' };
    }
    if (!isBuildableCell(col, row)) {
      return { ok: false, code: 'INVALID_CELL', message: '该位置不可建造糖果塔' };
    }
    const key = cellKey(col, row);
    if (player.occupiedCells.has(key)) {
      return { ok: false, code: 'CELL_OCCUPIED', message: '该格已有糖果塔' };
    }
    const lv1 = def.levels[0];
    if (player.gold < lv1.cost) {
      return { ok: false, code: 'INSUFFICIENT_GOLD', message: '金币不足' };
    }

    player.gold -= lv1.cost;
    const pos = cellToPixel(col, row);
    const tower = {
      id: this.allocId(),
      type: towerType,
      col,
      row,
      level: 1,
      invested: lv1.cost,
      targeting: def.defaultTargeting,
      angle: 0,
      cooldownTicks: 0,
      shotCount: 0,
      recoil: 0,
      x: pos.x,
      y: pos.y
    };
    player.towers.push(tower);
    player.occupiedCells.add(key);
    player.stats.towersBuilt += 1;

    this.emitEvent(player.slot, {
      type: 'tower_built',
      slot: player.slot,
      towerId: tower.id,
      towerType,
      x: tower.x,
      y: tower.y
    });

    return { ok: true, towerId: tower.id };
  }

  _handleUpgradeTower(player, { towerId }) {
    const tower = player.towers.find((t) => t.id === towerId);
    if (!tower) {
      return { ok: false, code: 'TOWER_NOT_FOUND', message: '未找到指定糖果塔' };
    }
    if (tower.level >= 3) {
      return { ok: false, code: 'MAX_LEVEL', message: '该糖果塔已满级' };
    }
    const def = TOWER_DEFS[tower.type];
    const nextLv = def.levels[tower.level]; // index 1 for lv2, index 2 for lv3
    if (player.gold < nextLv.cost) {
      return { ok: false, code: 'INSUFFICIENT_GOLD', message: '金币不足，无法升级' };
    }

    player.gold -= nextLv.cost;
    tower.level += 1;
    tower.invested += nextLv.cost;
    player.stats.towersUpgraded += 1;

    this.emitEvent(player.slot, {
      type: 'tower_upgraded',
      slot: player.slot,
      towerId: tower.id,
      level: tower.level,
      x: tower.x,
      y: tower.y
    });

    return { ok: true, level: tower.level };
  }

  _handleSellTower(player, { towerId }) {
    const idx = player.towers.findIndex((t) => t.id === towerId);
    if (idx === -1) {
      return { ok: false, code: 'TOWER_NOT_FOUND', message: '未找到指定糖果塔' };
    }
    const tower = player.towers[idx];
    const refund = Math.round(tower.invested * SELL_REFUND_RATE);
    player.gold += refund;
    player.occupiedCells.delete(cellKey(tower.col, tower.row));
    player.towers.splice(idx, 1);
    player.stats.towersSold += 1;

    this.emitEvent(player.slot, {
      type: 'tower_sold',
      slot: player.slot,
      towerId: tower.id,
      refund,
      x: tower.x,
      y: tower.y
    });

    return { ok: true, refund };
  }

  _handleSetTargeting(player, { towerId, targeting }) {
    if (!TARGETING_MODES.includes(targeting)) {
      return { ok: false, code: 'INVALID_TARGETING', message: '无效的目标优先级' };
    }
    const tower = player.towers.find((t) => t.id === towerId);
    if (!tower) {
      return { ok: false, code: 'TOWER_NOT_FOUND', message: '未找到指定糖果塔' };
    }
    tower.targeting = targeting;
    return { ok: true };
  }

  _handleSendWave(player, { sendType }) {
    const def = SEND_DEFS[sendType];
    if (!def) {
      return { ok: false, code: 'INVALID_SEND_TYPE', message: '未知派怪类型' };
    }
    const readyTick = player.sendCooldowns[sendType] || 0;
    if (this.tick < readyTick) {
      return { ok: false, code: 'COOLDOWN_ACTIVE', message: '技能冷却中' };
    }
    const opponent = this.players[1 - player.slot];
    if (def.isExpress) {
      const pendingCount = opponent.incomingAlerts.filter((a) => a.arriveTick > this.tick).length;
      if (pendingCount >= MAX_PENDING_EXPRESS) {
        return { ok: false, code: 'EXPRESS_QUEUE_FULL', message: '对手快递道路正忙（最多 2 辆排队）' };
      }
    }
    if (player.gold < def.cost) {
      return { ok: false, code: 'INSUFFICIENT_GOLD', message: '金币不足' };
    }

    player.gold -= def.cost;
    player.eco += def.eco;
    player.sendCooldowns[sendType] = this.tick + def.cooldownTicks;

    if (def.isExpress) {
      const alertId = this.allocId();
      const arriveTick = this.tick + EXPRESS_ALERT_TICKS;
      const alert = {
        id: alertId,
        fromSlot: player.slot,
        toSlot: opponent.slot,
        sendType,
        isFake: Boolean(def.isFake),
        createdTick: this.tick,
        arriveTick,
        totalTicks: EXPRESS_ALERT_TICKS
      };
      opponent.incomingAlerts.push(alert);
      player.outgoingAlerts.push(alert);
      player.stats.expressSent += 1;
      if (def.isFake) {
        player.stats.feintsSent += 1;
      }

      // STRICT ANTI-LEAK: Defender event NEVER contains sendType or isFake!
      this.emitEvent(opponent.slot, {
        type: 'express_started',
        target: 'self',
        id: alertId,
        arriveTick,
        totalTicks: EXPRESS_ALERT_TICKS
      });
      this.emitEvent(player.slot, {
        type: 'express_started',
        target: 'opponent',
        id: alertId,
        sendType,
        isFake: Boolean(def.isFake),
        arriveTick,
        totalTicks: EXPRESS_ALERT_TICKS
      });
    } else {
      let delay = 0;
      let totalCount = 0;
      for (const group of def.spawns) {
        for (let i = 0; i < group.count; i++) {
          opponent.spawnQueue.push({
            dueTick: this.tick + delay,
            type: group.type,
            hpScale: 1 + Math.max(0, this.wave - 1) * 0.04,
            speedScale: 1,
            isSent: true,
            rainbow: false
          });
          delay += group.intervalTicks;
          totalCount += 1;
        }
      }
      player.stats.creepsSent += totalCount;
      this.emitEvent(player.slot, {
        type: 'wave_sent',
        sendType,
        ecoGain: def.eco
      });
    }

    return { ok: true, eco: player.eco };
  }

  _scheduleWaveForBoth(waveNum) {
    const cfg = getWaveConfig(waveNum);
    this.wave = waveNum;
    const interval = waveNum >= MAX_MAIN_WAVES ? OVERTIME_INTERVAL_TICKS : WAVE_INTERVAL_TICKS;
    this.nextWaveTick = this.tick + interval;

    for (const player of this.players) {
      let delay = 0;
      for (const group of cfg.groups) {
        for (let i = 0; i < group.count; i++) {
          player.spawnQueue.push({
            dueTick: this.tick + delay,
            type: group.type,
            hpScale: cfg.hpScale,
            speedScale: cfg.speedScale,
            isSent: false,
            rainbow: cfg.isOvertime
          });
          delay += group.intervalTicks;
        }
      }
    }

    this.emitEvent('all', {
      type: 'wave_started',
      wave: waveNum,
      isOvertime: cfg.isOvertime
    });
  }

  _spawnCreep(player, spec) {
    const def = CREEP_DEFS[spec.type];
    if (!def) return null;
    const pos = getPositionAtProgress(0);
    const maxHp = def.hp * (spec.hpScale || 1);
    const creep = {
      id: this.allocId(),
      type: spec.type,
      hp: maxHp,
      maxHp,
      baseSpeed: def.speed,
      speedScale: spec.speedScale || 1,
      progress: 0,
      slowPct: 0,
      slowTicks: 0,
      vulnTicks: 0,
      armored: def.armored,
      cracked: false,
      isSent: Boolean(spec.isSent),
      rainbow: Boolean(spec.rainbow),
      leakDamage: def.leakDamage,
      bounty: spec.isSent ? def.sendBounty : def.naturalBounty,
      x: pos.x,
      y: pos.y,
      angle: pos.angle
    };
    player.creeps.push(creep);
    return creep;
  }

  step() {
    this.tickEvents = [];
    if (this.phase !== 'PLAYING') {
      return this.tickEvents;
    }

    this.tick += 1;

    // 1. Eco payout every 120 ticks (6.0s)
    if (this.tick > 0 && this.tick % ECO_PERIOD_TICKS === 0) {
      for (const player of this.players) {
        player.gold += player.eco;
        player.stats.goldEarned += player.eco;
        this.emitEvent(player.slot, {
          type: 'eco_payout',
          slot: player.slot,
          amount: player.eco
        });
      }
    }

    // 2. Natural wave schedule
    if (this.tick >= this.nextWaveTick) {
      this._scheduleWaveForBoth(this.wave + 1);
    }

    // 3. Process Express arrivals
    for (const defender of this.players) {
      const remaining = [];
      for (const alert of defender.incomingAlerts) {
        if (this.tick >= alert.arriveTick) {
          const sender = this.players[alert.fromSlot];
          if (sender) {
            sender.outgoingAlerts = sender.outgoingAlerts.filter((a) => a.id !== alert.id);
          }
          if (alert.isFake) {
            if (sender) sender.stats.feintsArrived += 1;
            this.emitEvent('all', {
              type: 'express_arrived_feint',
              targetSlot: defender.slot,
              id: alert.id
            });
          } else {
            const def = SEND_DEFS[alert.sendType];
            let delay = 0;
            let count = 0;
            if (def && def.spawns) {
              for (const group of def.spawns) {
                for (let i = 0; i < group.count; i++) {
                  defender.spawnQueue.push({
                    dueTick: this.tick + delay,
                    type: group.type,
                    hpScale: 1 + Math.max(0, this.wave - 1) * 0.05,
                    speedScale: 1,
                    isSent: true,
                    rainbow: false
                  });
                  delay += group.intervalTicks;
                  count += 1;
                }
              }
            }
            if (sender) sender.stats.creepsSent += count;
            this.emitEvent('all', {
              type: 'express_arrived_real',
              targetSlot: defender.slot,
              id: alert.id,
              sendType: alert.sendType
            });
          }
        } else {
          remaining.push(alert);
        }
      }
      defender.incomingAlerts = remaining;
    }

    // 4. Spawn queued creeps
    for (const player of this.players) {
      if (player.spawnQueue.length === 0) continue;
      const keep = [];
      for (const item of player.spawnQueue) {
        if (item.dueTick <= this.tick) {
          this._spawnCreep(player, item);
        } else {
          keep.push(item);
        }
      }
      player.spawnQueue = keep;
    }

    // 5. Move creeps
    for (const player of this.players) {
      const survivors = [];
      for (const creep of player.creeps) {
        if (creep.slowTicks > 0) {
          creep.slowTicks -= 1;
          if (creep.slowTicks <= 0) {
            creep.slowPct = 0;
          }
        }
        if (creep.vulnTicks > 0) {
          creep.vulnTicks -= 1;
        }
        if (creep.type === 'macaron_stack' && !creep.cracked && creep.hp < creep.maxHp * 0.5) {
          creep.cracked = true;
          creep.baseSpeed = CREEP_DEFS.macaron_stack.crackedSpeed;
          this.emitEvent('all', {
            type: 'macaron_cracked',
            slot: player.slot,
            creepId: creep.id,
            x: creep.x,
            y: creep.y
          });
        }
        const effectiveSpeed =
          creep.baseSpeed *
          creep.speedScale *
          (1 - (creep.slowTicks > 0 ? creep.slowPct : 0));
        creep.progress += effectiveSpeed / (TOTAL_PATH_LENGTH * TICK_RATE);

        if (creep.progress >= 1) {
          player.hp = Math.max(0, player.hp - creep.leakDamage);
          const endPos = getPositionAtProgress(1);
          this.emitEvent('all', {
            type: 'life_lost',
            slot: player.slot,
            amount: creep.leakDamage,
            hp: player.hp,
            x: endPos.x,
            y: endPos.y
          });
        } else {
          const pos = getPositionAtProgress(creep.progress);
          creep.x = pos.x;
          creep.y = pos.y;
          creep.angle = pos.angle;
          survivors.push(creep);
        }
      }
      player.creeps = survivors;
    }

    // 6. Towers target & shoot
    for (const player of this.players) {
      for (const tower of player.towers) {
        if (tower.recoil > 0) {
          tower.recoil = Math.max(0, tower.recoil - 0.25);
        }
        if (tower.cooldownTicks > 0) {
          tower.cooldownTicks -= 1;
        }
        if (tower.cooldownTicks > 0) continue;

        const def = TOWER_DEFS[tower.type];
        const lvDef = def.levels[tower.level - 1];
        const target = this._acquireTarget(tower, lvDef.range, player.creeps);
        if (!target) continue;

        tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
        tower.cooldownTicks += TICK_RATE / lvDef.rate;
        tower.shotCount += 1;
        tower.recoil = 1;

        this._fireTower(player, tower, def, lvDef, target);
      }
    }

    // 7. Advance projectiles & apply hits
    for (const player of this.players) {
      this._stepProjectiles(player);
      this._cleanupDeadCreeps(player);
    }

    // 8. Check win/loss
    const p0 = this.players[0];
    const p1 = this.players[1];
    if (p0.hp <= 0 || p1.hp <= 0) {
      let winnerSlot = 0;
      if (p0.hp <= 0 && p1.hp > 0) {
        winnerSlot = 1;
      } else if (p1.hp <= 0 && p0.hp > 0) {
        winnerSlot = 0;
      } else {
        if (p1.hp !== p0.hp) {
          winnerSlot = p1.hp > p0.hp ? 1 : 0;
        } else if (p1.eco !== p0.eco) {
          winnerSlot = p1.eco > p0.eco ? 1 : 0;
        } else {
          winnerSlot = p1.stats.creepsKilled > p0.stats.creepsKilled ? 1 : 0;
        }
      }
      this.phase = 'ENDED';
      this.endedResult = {
        winnerSlot,
        loserSlot: 1 - winnerSlot,
        reason: 'hp_zero',
        endTick: this.tick,
        wave: this.wave,
        stats: [
          { slot: 0, hp: p0.hp, eco: p0.eco, gold: p0.gold, ...p0.stats },
          { slot: 1, hp: p1.hp, eco: p1.eco, gold: p1.gold, ...p1.stats }
        ]
      };
      this.emitEvent('all', {
        type: 'match_ended',
        endedResult: this.endedResult
      });
    }

    return this.tickEvents;
  }

  _acquireTarget(tower, range, creeps) {
    let best = null;
    let bestScore = -Infinity;
    for (const c of creeps) {
      if (c.hp <= 0) continue;
      const dist = Math.hypot(c.x - tower.x, c.y - tower.y);
      if (dist > range) continue;

      let score;
      if (tower.targeting === 'strong') {
        score = c.hp * 1000 + c.progress;
      } else if (tower.targeting === 'close') {
        score = -dist * 1000 + c.progress;
      } else {
        score = c.progress;
      }
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  _computeDamage(towerType, lvDef, creep, baseDamage) {
    let mult = 1.0;
    if (towerType === 'lemon') {
      if (creep.armored) {
        mult *= lvDef.armoredBonus;
      }
    } else if (creep.armored) {
      mult *= 0.6;
    }

    if (towerType !== 'mint' && creep.vulnTicks > 0) {
      mult *= 1.15;
    }
    return baseDamage * mult;
  }

  _applyDamageToCreep(player, towerType, lvDef, creep, baseDamage, isCrit = false) {
    if (!creep || creep.hp <= 0) return 0;
    const dmg = this._computeDamage(towerType, lvDef, creep, baseDamage);
    creep.hp -= dmg;
    player.stats.damageDealt += dmg;

    if (towerType === 'mint') {
      if (lvDef.slowPct >= creep.slowPct || creep.slowTicks <= 0) {
        creep.slowPct = lvDef.slowPct;
        creep.slowTicks = lvDef.slowTicks;
      } else {
        creep.slowTicks = Math.max(creep.slowTicks, Math.floor(lvDef.slowTicks * 0.7));
      }
      if (lvDef.vulnBonus > 0) {
        creep.vulnTicks = Math.max(creep.vulnTicks, lvDef.slowTicks);
      }
    }

    if (isCrit) {
      this.emitEvent('all', {
        type: 'crit_hit',
        slot: player.slot,
        x: creep.x,
        y: creep.y,
        damage: Math.round(dmg)
      });
    }

    return dmg;
  }

  _fireTower(player, tower, def, lvDef, target) {
    if (tower.type === 'lemon') {
      // Instant hitscan laser
      const dmg1 = this._applyDamageToCreep(player, 'lemon', lvDef, target, lvDef.damage, false);
      let pierceTarget = null;
      if (lvDef.pierceCount >= 2 && lvDef.pierceMult > 0) {
        let bestDist = Infinity;
        for (const c of player.creeps) {
          if (c.id === target.id || c.hp <= 0) continue;
          const d = Math.hypot(c.x - target.x, c.y - target.y);
          if (d <= 140 && d < bestDist) {
            bestDist = d;
            pierceTarget = c;
          }
        }
        if (pierceTarget) {
          this._applyDamageToCreep(
            player,
            'lemon',
            lvDef,
            pierceTarget,
            lvDef.damage * lvDef.pierceMult,
            false
          );
        }
      }

      this.emitEvent('all', {
        type: 'tower_shot',
        slot: player.slot,
        towerId: tower.id,
        towerType: 'lemon',
        level: tower.level,
        fromX: tower.x,
        fromY: tower.y,
        toX: target.x,
        toY: target.y,
        armoredHit: target.armored,
        damage: Math.round(dmg1),
        pierceX: pierceTarget ? pierceTarget.x : null,
        pierceY: pierceTarget ? pierceTarget.y : null
      });
      return;
    }

    const isCrit =
      tower.type === 'strawberry' &&
      lvDef.critEvery &&
      tower.shotCount % lvDef.critEvery === 0;
    const baseDmg = isCrit ? lvDef.damage * lvDef.critMult : lvDef.damage;

    const speedMap = {
      strawberry: 640,
      mint: 460,
      popcorn: 340
    };

    player.projectiles.push({
      id: this.allocId(),
      type: tower.type,
      level: tower.level,
      towerId: tower.id,
      sourceX: tower.x,
      sourceY: tower.y,
      x: tower.x,
      y: tower.y,
      targetId: target.id,
      targetX: target.x,
      targetY: target.y,
      speed: speedMap[tower.type] || 500,
      progress: 0,
      damage: baseDmg,
      splashRadius: lvDef.splashRadius || 0,
      slowPct: lvDef.slowPct || 0,
      slowTicks: lvDef.slowTicks || 0,
      vulnBonus: lvDef.vulnBonus || 0,
      bounceCount: lvDef.bounceCount || 0,
      bounceMult: lvDef.bounceMult || 0,
      isCrit,
      isSecondary: false
    });

    this.emitEvent('all', {
      type: 'tower_shot',
      slot: player.slot,
      towerId: tower.id,
      towerType: tower.type,
      level: tower.level,
      fromX: tower.x,
      fromY: tower.y,
      toX: target.x,
      toY: target.y,
      isCrit
    });
  }

  _stepProjectiles(player) {
    const remaining = [];
    for (const proj of player.projectiles) {
      if (!proj.isSecondary && proj.targetId) {
        const liveTarget = player.creeps.find((c) => c.id === proj.targetId && c.hp > 0);
        if (liveTarget) {
          proj.targetX = liveTarget.x;
          proj.targetY = liveTarget.y;
        }
      }

      const dx = proj.targetX - proj.x;
      const dy = proj.targetY - proj.y;
      const dist = Math.hypot(dx, dy);
      const stepDist = proj.speed / TICK_RATE;

      if (dist <= stepDist || dist < 4) {
        proj.x = proj.targetX;
        proj.y = proj.targetY;
        this._resolveProjectileHit(player, proj);
      } else {
        proj.x += (dx / dist) * stepDist;
        proj.y += (dy / dist) * stepDist;
        const totalDist = Math.max(1, Math.hypot(proj.targetX - proj.sourceX, proj.targetY - proj.sourceY));
        proj.progress = Math.min(1, 1 - dist / totalDist);
        remaining.push(proj);
      }
    }
    player.projectiles = remaining;
  }

  _resolveProjectileHit(player, proj) {
    const def = TOWER_DEFS[proj.type];
    const lvDef = def.levels[proj.level - 1];

    if (proj.type === 'strawberry') {
      const target = player.creeps.find((c) => c.id === proj.targetId && c.hp > 0);
      if (target) {
        this._applyDamageToCreep(player, 'strawberry', lvDef, target, proj.damage, proj.isCrit);
      }
      return;
    }

    if (proj.type === 'mint' || proj.type === 'popcorn') {
      const radius = proj.isSecondary ? 55 : proj.splashRadius;
      for (const c of player.creeps) {
        if (c.hp <= 0) continue;
        const d = Math.hypot(c.x - proj.x, c.y - proj.y);
        if (d <= radius) {
          this._applyDamageToCreep(player, proj.type, lvDef, c, proj.damage, false);
        }
      }

      this.emitEvent('all', {
        type: proj.type === 'mint' ? 'mint_splash' : 'popcorn_boom',
        slot: player.slot,
        x: proj.x,
        y: proj.y,
        radius,
        isSecondary: proj.isSecondary
      });

      // Popcorn Lv3 secondary bounces
      if (proj.type === 'popcorn' && !proj.isSecondary && proj.bounceCount > 0) {
        const nearby = player.creeps
          .filter((c) => c.hp > 0 && Math.hypot(c.x - proj.x, c.y - proj.y) <= 130)
          .slice(0, proj.bounceCount);
        for (let i = 0; i < proj.bounceCount; i++) {
          const angle = (Math.PI * 2 * i) / proj.bounceCount + this.rng() * 0.4;
          const fallbackX = proj.x + Math.cos(angle) * 46;
          const fallbackY = proj.y + Math.sin(angle) * 46;
          const tgt = nearby[i];
          player.projectiles.push({
            id: this.allocId(),
            type: 'popcorn',
            level: proj.level,
            towerId: proj.towerId,
            sourceX: proj.x,
            sourceY: proj.y,
            x: proj.x,
            y: proj.y,
            targetId: tgt ? tgt.id : null,
            targetX: tgt ? tgt.x : fallbackX,
            targetY: tgt ? tgt.y : fallbackY,
            speed: 280,
            progress: 0,
            damage: proj.damage * proj.bounceMult,
            splashRadius: 55,
            slowPct: 0,
            slowTicks: 0,
            vulnBonus: 0,
            bounceCount: 0,
            bounceMult: 0,
            isCrit: false,
            isSecondary: true
          });
        }
      }
    }
  }

  _cleanupDeadCreeps(player) {
    const alive = [];
    for (const c of player.creeps) {
      if (c.hp <= 0.0001) {
        player.gold += c.bounty;
        player.stats.creepsKilled += 1;
        player.stats.goldEarned += c.bounty;
        this.emitEvent('all', {
          type: 'creep_pop',
          slot: player.slot,
          creepId: c.id,
          creepType: c.type,
          bounty: c.bounty,
          x: c.x,
          y: c.y
        });
      } else {
        alive.push(c);
      }
    }
    player.creeps = alive;
  }

  // Test hook helpers (only called when CANDY_ALLOW_TEST_HOOKS=1)
  grantResources({ targetSlot, gold, eco, hp }) {
    const p = this.players[targetSlot];
    if (!p) return false;
    if (typeof gold === 'number' && Number.isFinite(gold)) p.gold = Math.max(0, Math.round(gold));
    if (typeof eco === 'number' && Number.isFinite(eco)) p.eco = Math.max(0, Math.round(eco));
    if (typeof hp === 'number' && Number.isFinite(hp)) p.hp = Math.max(0, Math.round(hp));
    return true;
  }

  jumpWave(waveNum) {
    const w = Math.max(1, Math.floor(Number(waveNum) || 1));
    for (const p of this.players) {
      p.spawnQueue = p.spawnQueue.filter((s) => s.isSent);
    }
    this._scheduleWaveForBoth(w);
    return w;
  }

  spawnStress({ towers = 15, creeps = 45 } = {}) {
    const p0 = this.players[0];
    const towerCount = Math.min(40, Math.max(0, Math.floor(towers)));
    const creepCount = Math.min(120, Math.max(0, Math.floor(creeps)));
    const types = TOWER_ORDER;

    let placed = 0;
    for (let col = 0; col < GRID_COLS && placed < towerCount; col++) {
      for (let row = 0; row < GRID_ROWS && placed < towerCount; row++) {
        if (!isBuildableCell(col, row)) continue;
        const key = cellKey(col, row);
        if (p0.occupiedCells.has(key)) continue;
        const type = types[placed % types.length];
        const def = TOWER_DEFS[type];
        const pos = cellToPixel(col, row);
        p0.towers.push({
          id: this.allocId(),
          type,
          col,
          row,
          level: 3,
          invested: def.levels[2].totalCost,
          targeting: def.defaultTargeting,
          angle: 0,
          cooldownTicks: 0,
          shotCount: 0,
          recoil: 0,
          x: pos.x,
          y: pos.y
        });
        p0.occupiedCells.add(key);
        placed += 1;
      }
    }

    const creepTypes = ['jelly', 'gummy_pack', 'toffee', 'macaron_stack', 'giant_cake'];
    for (let i = 0; i < creepCount; i++) {
      const cType = creepTypes[i % creepTypes.length];
      const creep = this._spawnCreep(p0, {
        type: cType,
        hpScale: 1.5,
        speedScale: 1,
        isSent: false,
        rainbow: i % 5 === 4
      });
      if (creep) {
        creep.progress = (i / Math.max(1, creepCount)) * 0.65;
        const pos = getPositionAtProgress(creep.progress);
        creep.x = pos.x;
        creep.y = pos.y;
        creep.angle = pos.angle;
      }
    }
    return { placedTowers: placed, spawnedCreeps: creepCount };
  }

  _serializePlayerForViewer(player, isSelf) {
    const cooldowns = {};
    if (isSelf) {
      for (const key of SEND_ORDER) {
        cooldowns[key] = Math.max(0, (player.sendCooldowns[key] || 0) - this.tick);
      }
    }

    const base = {
      hp: player.hp,
      gold: player.gold,
      eco: player.eco,
      towers: player.towers.map((t) => ({
        id: t.id,
        type: t.type,
        col: t.col,
        row: t.row,
        level: t.level,
        invested: t.invested,
        targeting: t.targeting,
        angle: Number(t.angle.toFixed(3)),
        recoil: Number((t.recoil || 0).toFixed(2))
      })),
      creeps: player.creeps.map((c) => ({
        id: c.id,
        type: c.type,
        hp: Math.round(c.hp * 10) / 10,
        maxHp: Math.round(c.maxHp * 10) / 10,
        progress: Number(c.progress.toFixed(5)),
        slowTicks: c.slowTicks,
        vulnTicks: c.vulnTicks,
        armored: c.armored,
        cracked: c.cracked,
        rainbow: c.rainbow,
        x: Number(c.x.toFixed(1)),
        y: Number(c.y.toFixed(1)),
        angle: Number(c.angle.toFixed(3))
      })),
      projectiles: player.projectiles.map((p) => ({
        id: p.id,
        type: p.type,
        level: p.level,
        x: Number(p.x.toFixed(1)),
        y: Number(p.y.toFixed(1)),
        sourceX: Number(p.sourceX.toFixed(1)),
        sourceY: Number(p.sourceY.toFixed(1)),
        targetX: Number(p.targetX.toFixed(1)),
        targetY: Number(p.targetY.toFixed(1)),
        progress: Number(p.progress.toFixed(3)),
        isCrit: p.isCrit,
        isSecondary: p.isSecondary
      })),
      // STRICT ANTI-LEAK: incomingAlerts NEVER includes isFake or sendType
      incomingAlerts: player.incomingAlerts.map((a) => ({
        id: a.id,
        arriveTick: a.arriveTick,
        totalTicks: a.totalTicks
      }))
    };

    if (isSelf) {
      base.sendCooldowns = cooldowns;
      base.outgoingAlerts = player.outgoingAlerts.map((a) => ({
        id: a.id,
        sendType: a.sendType,
        arriveTick: a.arriveTick,
        totalTicks: a.totalTicks
      }));
    }

    return base;
  }

  getClientSnapshot(viewerSlot, roomPhaseOverride = null) {
    const selfPlayer = this.players[viewerSlot];
    const oppPlayer = this.players[1 - viewerSlot];
    const ecoRem = ECO_PERIOD_TICKS - (this.tick % ECO_PERIOD_TICKS);

    return {
      type: 'game_snapshot',
      tick: this.tick,
      phase: roomPhaseOverride || this.phase,
      wave: this.wave,
      isOvertime: this.wave > MAX_MAIN_WAVES,
      nextWaveInTicks: Math.max(0, this.nextWaveTick - this.tick),
      ecoPayoutInTicks: ecoRem === 0 ? ECO_PERIOD_TICKS : ecoRem,
      self: this._serializePlayerForViewer(selfPlayer, true),
      opponent: this._serializePlayerForViewer(oppPlayer, false),
      endedResult: this.endedResult
    };
  }

  // Test-only full snapshot (only accessible when CANDY_ALLOW_TEST_HOOKS=1)
  getTestSnapshot(viewerSlot = 0) {
    const snap = this.getClientSnapshot(viewerSlot);
    snap.testRawIncomingAlerts = [
      this.players[viewerSlot].incomingAlerts.map((a) => ({ ...a })),
      this.players[1 - viewerSlot].incomingAlerts.map((a) => ({ ...a }))
    ];
    return snap;
  }
}
