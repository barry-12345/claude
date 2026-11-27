import {
  CREEP_DEFS,
  DEFAULT_MAP_ID,
  DEMOLISH_COST,
  ECO_PERIOD_TICKS,
  EXPRESS_ALERT_TICKS,
  GRID_COLS,
  GRID_ROWS,
  INITIAL_ECO,
  INITIAL_GOLD,
  INITIAL_HP,
  MAX_MAIN_WAVES,
  MAX_PENDING_EXPRESS,
  SELL_REFUND_RATE,
  SEND_DEFS,
  SEND_ORDER,
  TARGETING_MODES,
  TICK_RATE,
  TOWER_DEFS,
  TOWER_ORDER,
  WAVE_START_DELAY_TICKS,
  cellKey,
  cellToPixel,
  getBuffAt,
  getMapDef,
  getObstacleAt,
  getPositionAtProgress,
  getTowerLevelDef,
  getWaveConfig,
  getWaveIntervalTicks,
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
    clearedObstacles: new Set(),
    lavaZones: [],
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
      obstaclesCleared: 0,
      creepsKilled: 0,
      creepsSent: 0,
      expressSent: 0,
      goldEarned: 0,
      damageDealt: 0
    }
  };
}

export class GameSimulation {
  constructor(options = {}) {
    this.seed = Number.isInteger(options.seed) ? options.seed : 20261125;
    this.rng = createMulberry32(this.seed);
    this.mapDef = getMapDef(options.mapId || DEFAULT_MAP_ID);
    this.mapId = this.mapDef.id;
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
      case 'demolish_obstacle':
        return this._handleDemolishObstacle(player, action);
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
    if (!isBuildableCell(this.mapId, col, row, player.clearedObstacles)) {
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
    const buffTile = getBuffAt(this.mapId, col, row, player.clearedObstacles);
    const tower = {
      id: this.allocId(),
      type: towerType,
      col,
      row,
      level: 1,
      branch: null,
      buffTile,
      invested: lv1.cost,
      targeting: def.defaultTargeting,
      angle: 0,
      cooldownTicks: 0,
      shotCount: 0,
      recoil: 0,
      lastTargetId: null,
      lockStacks: 0,
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
      buffTile,
      x: tower.x,
      y: tower.y
    });

    return { ok: true, towerId: tower.id, buffTile };
  }

  _handleDemolishObstacle(player, { col, row }) {
    if (!Number.isInteger(col) || !Number.isInteger(row)) {
      return { ok: false, code: 'INVALID_OBSTACLE', message: '无效障碍物坐标' };
    }
    const obs = getObstacleAt(this.mapId, col, row);
    if (!obs) {
      return { ok: false, code: 'INVALID_OBSTACLE', message: '该格没有可拆除的甜品障碍物' };
    }
    const key = cellKey(col, row);
    if (player.clearedObstacles.has(key)) {
      return { ok: false, code: 'OBSTACLE_ALREADY_CLEARED', message: '该障碍物已拆除' };
    }
    if (player.gold < DEMOLISH_COST) {
      return { ok: false, code: 'INSUFFICIENT_GOLD', message: `金币不足（拆迁需 $${DEMOLISH_COST}）` };
    }

    player.gold -= DEMOLISH_COST;
    player.clearedObstacles.add(key);
    player.stats.obstaclesCleared += 1;
    const pos = cellToPixel(col, row);

    this.emitEvent('all', {
      type: 'obstacle_demolished',
      slot: player.slot,
      col,
      row,
      kind: obs.kind,
      buff: obs.buff,
      x: pos.x,
      y: pos.y
    });

    return { ok: true, col, row, buff: obs.buff };
  }

  _handleUpgradeTower(player, { towerId, branch }) {
    const tower = player.towers.find((t) => t.id === towerId);
    if (!tower) {
      return { ok: false, code: 'TOWER_NOT_FOUND', message: '未找到指定糖果塔' };
    }
    if (tower.level >= 3) {
      return { ok: false, code: 'MAX_LEVEL', message: '该糖果塔已满级' };
    }

    const def = TOWER_DEFS[tower.type];
    let nextLv = null;
    let chosenBranch = null;

    if (tower.level === 1) {
      nextLv = def.levels[1];
    } else if (tower.level === 2) {
      if (branch !== 'A' && branch !== 'B') {
        return { ok: false, code: 'INVALID_BRANCH', message: 'Lv3 转职必须选择分支 A 或 B' };
      }
      chosenBranch = branch;
      nextLv = def.branches[branch];
    }

    if (!nextLv) {
      return { ok: false, code: 'INVALID_BRANCH', message: '无效升级分支' };
    }
    if (player.gold < nextLv.cost) {
      return { ok: false, code: 'INSUFFICIENT_GOLD', message: '金币不足，无法升级' };
    }

    player.gold -= nextLv.cost;
    tower.level += 1;
    tower.branch = chosenBranch;
    tower.invested += nextLv.cost;
    tower.lastTargetId = null;
    tower.lockStacks = 0;
    player.stats.towersUpgraded += 1;

    this.emitEvent(player.slot, {
      type: 'tower_upgraded',
      slot: player.slot,
      towerId: tower.id,
      towerType: tower.type,
      level: tower.level,
      branch: tower.branch,
      x: tower.x,
      y: tower.y
    });

    return { ok: true, level: tower.level, branch: tower.branch };
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
        createdTick: this.tick,
        arriveTick,
        totalTicks: EXPRESS_ALERT_TICKS
      };
      opponent.incomingAlerts.push(alert);
      player.outgoingAlerts.push(alert);
      player.stats.expressSent += 1;

      // Decision 2A: 3s express alert explicitly includes sendType so defender sees 💚 / 🛡️ icon
      this.emitEvent(opponent.slot, {
        type: 'express_started',
        target: 'self',
        id: alertId,
        sendType,
        arriveTick,
        totalTicks: EXPRESS_ALERT_TICKS
      });
      this.emitEvent(player.slot, {
        type: 'express_started',
        target: 'opponent',
        id: alertId,
        sendType,
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
            syncWaveScale: true,
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
    this.nextWaveTick = this.tick + getWaveIntervalTicks(waveNum);

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
    const pos = getPositionAtProgress(this.mapId, 0);
    const hpScale = spec.syncWaveScale
      ? getWaveConfig(Math.max(1, this.wave)).hpScale
      : spec.hpScale || 1;
    const maxHp = def.hp * hpScale;
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
      slowResist: def.slowResist || 0,
      ccImmuneBeforeProgress: def.ccImmuneBeforeProgress || 0,
      freezeTicks: 0,
      freezeImmuneTicks: 0,
      shredTicks: 0,
      vulnTicks: 0,
      vulnBonus: 0,
      brittleMark: false,
      armored: Boolean(def.armored),
      heavyArmor: Boolean(def.heavyArmor),
      shieldHits: def.shieldHits || 0,
      maxShieldHits: def.shieldHits || 0,
      isBoss: Boolean(def.isBoss),
      isDark: Boolean(def.isDark),
      cracked: false,
      isSent: Boolean(spec.isSent),
      rainbow: Boolean(spec.rainbow),
      leakDamage: def.leakDamage,
      bounty: spec.isSent ? 0 : def.naturalBounty,
      killedByBountyTile: false,
      healCooldownTicks: def.healPeriodTicks || 0,
      healPulseTicks: 0,
      x: pos.x,
      y: pos.y,
      angle: pos.angle
    };
    player.creeps.push(creep);
    return creep;
  }

  _getEffectiveTowerStats(tower, lvDef) {
    return {
      range: lvDef.range * (tower.buffTile === 'range' ? 1.20 : 1),
      rate: lvDef.rate * (tower.buffTile === 'rate' ? 1.20 : 1),
      tileDmgMult: tower.buffTile === 'damage' ? 1.15 : 1
    };
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

    // 3. Process Express arrivals (3s warning -> spawns dark/neon raid squad)
    for (const defender of this.players) {
      const remaining = [];
      for (const alert of defender.incomingAlerts) {
        if (this.tick >= alert.arriveTick) {
          const sender = this.players[alert.fromSlot];
          if (sender) {
            sender.outgoingAlerts = sender.outgoingAlerts.filter((a) => a.id !== alert.id);
          }
          const def = SEND_DEFS[alert.sendType];
          let delay = 0;
          let count = 0;
          if (def && def.spawns) {
            for (const group of def.spawns) {
              for (let i = 0; i < group.count; i++) {
                defender.spawnQueue.push({
                  dueTick: this.tick + delay,
                  type: group.type,
                  syncWaveScale: true,
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

    // 5. Move creeps, tick debuffs, healer aura & lava DoT
    for (const player of this.players) {
      // Lava zones tick down & apply DoT every 5 ticks (0.25s)
      const activeLava = [];
      for (const z of player.lavaZones) {
        z.remainTicks -= 1;
        if (z.remainTicks > 0) {
          activeLava.push(z);
        }
      }
      player.lavaZones = activeLava;

      if (this.tick % 5 === 0 && player.lavaZones.length > 0) {
        for (const creep of player.creeps) {
          if (creep.hp <= 0) continue;
          let hitPools = 0;
          let bestPoolBuff = null;
          for (const z of player.lavaZones) {
            const dx = creep.x - z.x;
            const dy = creep.y - z.y;
            if (dx * dx + dy * dy <= z.radius * z.radius) {
              hitPools += 1;
              if (z.towerBuff === 'bounty') bestPoolBuff = 'bounty';
              if (hitPools >= 2) break; // max 2 overlapping lava pools
            }
          }
          if (hitPools > 0) {
            const shieldMult = creep.shieldHits > 0 ? 0.5 : 1.0;
            const burnDmg = hitPools * (24 * 0.25) * shieldMult;
            creep.hp -= burnDmg;
            player.stats.damageDealt += burnDmg;
            if (creep.hp <= 0.0001 && bestPoolBuff === 'bounty' && !creep.isSent) {
              creep.killedByBountyTile = true;
            }
          }
        }
      }

      // Healer aura (every 20 ticks = 1.0s)
      for (const creep of player.creeps) {
        if (creep.hp <= 0) continue;
        if (creep.healPulseTicks > 0) {
          creep.healPulseTicks -= 1;
        }
        if (creep.type === 'dark_healer') {
          creep.healCooldownTicks -= 1;
          if (creep.healCooldownTicks <= 0) {
            const hDef = CREEP_DEFS.dark_healer;
            const healRadiusSq = hDef.healRadius * hDef.healRadius;
            creep.healCooldownTicks = hDef.healPeriodTicks;
            creep.healPulseTicks = 12;
            for (const ally of player.creeps) {
              if (ally.hp <= 0.0001) continue;
              const dx = ally.x - creep.x;
              const dy = ally.y - creep.y;
              if (dx * dx + dy * dy <= healRadiusSq) {
                const pct = ally.id !== creep.id && ally.isBoss ? hDef.healPctBoss : hDef.healPctNormal;
                ally.hp = Math.min(ally.maxHp, ally.hp + ally.maxHp * pct);
              }
            }
            this.emitEvent('all', {
              type: 'healer_pulse',
              slot: player.slot,
              creepId: creep.id,
              x: creep.x,
              y: creep.y,
              radius: hDef.healRadius
            });
          }
        }
      }

      const survivors = [];
      for (const creep of player.creeps) {
        if (creep.hp <= 0.0001) {
          survivors.push(creep); // cleaned up in _cleanupDeadCreeps after towers/projs
          continue;
        }
        if (creep.slowTicks > 0) {
          creep.slowTicks -= 1;
          if (creep.slowTicks <= 0) {
            creep.slowPct = 0;
          }
        }
        if (creep.vulnTicks > 0) {
          creep.vulnTicks -= 1;
          if (creep.vulnTicks <= 0) {
            creep.vulnBonus = 0;
          }
        }
        if (creep.shredTicks > 0) {
          creep.shredTicks -= 1;
        }
        if (creep.freezeImmuneTicks > 0) {
          creep.freezeImmuneTicks -= 1;
        }
        if (creep.freezeTicks > 0) {
          creep.freezeTicks -= 1;
          if (creep.freezeTicks <= 0) {
            creep.freezeImmuneTicks = 50; // 2.5s freeze immunity window
          }
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

        if (creep.freezeTicks <= 0) {
          const effectiveSpeed =
            creep.baseSpeed *
            creep.speedScale *
            (1 - (creep.slowTicks > 0 ? creep.slowPct : 0));
          creep.progress += effectiveSpeed / (this.mapDef.totalPathLength * TICK_RATE);
        }

        if (creep.progress >= 1) {
          player.hp = Math.max(0, player.hp - creep.leakDamage);
          const endPos = getPositionAtProgress(this.mapId, 1);
          this.emitEvent('all', {
            type: 'life_lost',
            slot: player.slot,
            amount: creep.leakDamage,
            hp: player.hp,
            x: endPos.x,
            y: endPos.y
          });
        } else {
          const pos = getPositionAtProgress(this.mapId, creep.progress);
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
        const lvDef = getTowerLevelDef(tower.type, tower.level, tower.branch);
        if (!lvDef) continue;
        const eff = this._getEffectiveTowerStats(tower, lvDef);
        const target = this._acquireTarget(tower, eff.range, player.creeps);
        if (!target) continue;

        tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
        tower.cooldownTicks += TICK_RATE / eff.rate;
        tower.shotCount += 1;
        tower.recoil = 1;

        this._fireTower(player, tower, def, lvDef, eff, target);
      }
    }

    // 7. Advance projectiles & apply hits & clean dead creeps
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
        mapId: this.mapId,
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
    const rangeSq = range * range;
    const isClose = tower.targeting === 'close';
    const isStrong = tower.targeting === 'strong';
    for (const c of creeps) {
      if (c.hp <= 0.0001) continue;
      const dx = c.x - tower.x;
      const dy = c.y - tower.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > rangeSq) continue;

      let score;
      if (isStrong) {
        score = c.hp * 1000 + c.progress;
      } else if (isClose) {
        score = -Math.sqrt(distSq) * 1000 + c.progress;
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

  _computeDamage(towerType, lvDef, creep, baseDamage, { tileDmgMult = 1, specialMult = 1 } = {}) {
    let armorMult = 1.0;
    if (creep.armored) {
      if (towerType === 'lemon') {
        armorMult = lvDef.armoredBonus;
      } else if (creep.shredTicks > 0) {
        armorMult = creep.heavyArmor ? 0.75 : 0.85;
      } else if (creep.heavyArmor) {
        armorMult = 0.50;
      } else {
        armorMult = TOWER_DEFS[towerType].armoredMultiplier;
      }
    }

    const vulnMult =
      towerType !== 'mint' && creep.vulnTicks > 0 && creep.vulnBonus > 0
        ? 1 + creep.vulnBonus
        : 1.0;

    return baseDamage * tileDmgMult * armorMult * vulnMult * specialMult;
  }

  _applyMintEffects(lvDef, creep) {
    const isCcImmune = creep.ccImmuneBeforeProgress > 0 && creep.progress < creep.ccImmuneBeforeProgress;
    if (!isCcImmune) {
      const effectiveSlow = lvDef.slowPct * (1 - (creep.slowResist || 0));
      if (effectiveSlow >= creep.slowPct || creep.slowTicks <= 0) {
        creep.slowPct = effectiveSlow;
        creep.slowTicks = lvDef.slowTicks;
      } else {
        creep.slowTicks = Math.max(creep.slowTicks, Math.floor(lvDef.slowTicks * 0.7));
      }
    }
    if (lvDef.vulnBonus > 0) {
      creep.vulnTicks = Math.max(creep.vulnTicks, lvDef.slowTicks);
      creep.vulnBonus = Math.max(creep.vulnBonus, lvDef.vulnBonus);
    }
    if (lvDef.branch === 'B') {
      creep.brittleMark = true;
    }
  }

  _applyDamageToCreep(player, towerType, lvDef, creep, baseDamage, options = {}) {
    if (!creep || creep.hp <= 0.0001) return { dmg: 0, shielded: false, executed: false };
    const {
      tileDmgMult = 1,
      specialMult = 1,
      towerBuff = null
    } = options;

    // Discrete direct hit shield interception BEFORE HP damage
    if (creep.shieldHits > 0) {
      creep.shieldHits = Math.max(0, creep.shieldHits - 1);
      if (towerType === 'mint') {
        this._applyMintEffects(lvDef, creep);
      }
      if (towerType === 'strawberry' && lvDef.branch === 'B' && lvDef.shredTicks) {
        creep.shredTicks = Math.max(creep.shredTicks, lvDef.shredTicks);
      }
      this.emitEvent('all', {
        type: creep.shieldHits === 0 ? 'shield_break' : 'shield_hit',
        slot: player.slot,
        creepId: creep.id,
        remain: creep.shieldHits,
        x: creep.x,
        y: creep.y
      });
      return { dmg: 0, shielded: true, executed: false };
    }

    let effSpecialMult = specialMult;
    let executed = false;
    if (towerType === 'lemon' && lvDef.branch === 'B') {
      if (creep.isBoss || creep.maxHp >= 400) {
        effSpecialMult *= lvDef.bossEliteBonus; // 1.25
      }
      if (creep.hp / Math.max(1, creep.maxHp) < lvDef.executeThreshold) {
        effSpecialMult *= lvDef.executeMult; // 1.75
        executed = true;
      }
    }

    const dmg = this._computeDamage(towerType, lvDef, creep, baseDamage, {
      tileDmgMult,
      specialMult: effSpecialMult
    });
    creep.hp -= dmg;
    player.stats.damageDealt += dmg;

    if (creep.hp <= 0.0001 && towerBuff === 'bounty' && !creep.isSent) {
      creep.killedByBountyTile = true;
    }

    if (towerType === 'mint') {
      this._applyMintEffects(lvDef, creep);
    }
    if (towerType === 'strawberry' && lvDef.branch === 'B' && lvDef.shredTicks) {
      creep.shredTicks = Math.max(creep.shredTicks, lvDef.shredTicks);
    }

    if (executed) {
      this.emitEvent('all', {
        type: 'execute_hit',
        slot: player.slot,
        x: creep.x,
        y: creep.y,
        damage: Math.round(dmg)
      });
    }

    return { dmg, shielded: false, executed };
  }

  _fireTower(player, tower, def, lvDef, eff, target) {
    if (tower.type === 'lemon') {
      const hitRes = this._applyDamageToCreep(player, 'lemon', lvDef, target, lvDef.damage, {
        tileDmgMult: eff.tileDmgMult,
        towerBuff: tower.buffTile
      });

      let beamEndX = target.x;
      let beamEndY = target.y;
      const piercedPts = [];

      if (tower.level === 3 && tower.branch === 'A') {
        const dx = target.x - tower.x;
        const dy = target.y - tower.y;
        const d0 = Math.max(1, Math.hypot(dx, dy));
        const ux = dx / d0;
        const uy = dy / d0;
        const maxRayDist = d0 + lvDef.beamExtendPx;
        beamEndX = tower.x + ux * maxRayDist;
        beamEndY = tower.y + uy * maxRayDist;

        const candidates = [];
        for (const c of player.creeps) {
          if (c.id === target.id || c.hp <= 0.0001) continue;
          const rx = c.x - tower.x;
          const ry = c.y - tower.y;
          const projDist = rx * ux + ry * uy;
          if (projDist < 0 || projDist > maxRayDist) continue;
          const perpDist = Math.abs(rx * -uy + ry * ux);
          if (perpDist <= lvDef.beamWidth) {
            candidates.push({ creep: c, projDist });
          }
        }
        candidates.sort((a, b) => a.projDist - b.projDist);
        const maxTargets = lvDef.pierceMults.length;
        for (let i = 0; i < Math.min(maxTargets, candidates.length); i++) {
          const pc = candidates[i].creep;
          this._applyDamageToCreep(
            player,
            'lemon',
            lvDef,
            pc,
            lvDef.damage * lvDef.pierceMults[i],
            {
              tileDmgMult: eff.tileDmgMult,
              towerBuff: tower.buffTile
            }
          );
          piercedPts.push({ x: pc.x, y: pc.y });
        }
      }

      this.emitEvent('all', {
        type: 'tower_shot',
        slot: player.slot,
        towerId: tower.id,
        towerType: 'lemon',
        level: tower.level,
        branch: tower.branch,
        fromX: tower.x,
        fromY: tower.y,
        toX: target.x,
        toY: target.y,
        beamEndX,
        beamEndY,
        armoredHit: target.armored,
        damage: Math.round(hitRes.dmg),
        executed: hitRes.executed,
        piercedCount: piercedPts.length
      });
      return;
    }

    let specialMult = 1.0;
    if (tower.type === 'strawberry' && tower.level === 3 && tower.branch === 'A') {
      if (tower.lastTargetId === target.id) {
        tower.lockStacks = Math.min(lvDef.maxStacks, (tower.lockStacks || 0) + 1);
      } else {
        tower.lastTargetId = target.id;
        tower.lockStacks = 0;
      }
      specialMult = 1 + lvDef.stackBonusPerShot * tower.lockStacks;
    }

    // Mint-A Frost Nova every 4th shot
    if (
      tower.type === 'mint' &&
      tower.level === 3 &&
      tower.branch === 'A' &&
      tower.shotCount % lvDef.novaEvery === 0
    ) {
      const novaRangeSq = eff.range * eff.range;
      for (const c of player.creeps) {
        if (c.hp <= 0.0001) continue;
        const dx = c.x - tower.x;
        const dy = c.y - tower.y;
        if (dx * dx + dy * dy > novaRangeSq) continue;
        if (c.ccImmuneBeforeProgress > 0 && c.progress < c.ccImmuneBeforeProgress) continue;
        if (c.freezeTicks > 0 || c.freezeImmuneTicks > 0) continue;
        c.freezeTicks = c.isBoss || c.slowResist > 0 ? lvDef.bossFreezeTicks : lvDef.freezeTicks;
      }
      this.emitEvent('all', {
        type: 'frost_nova',
        slot: player.slot,
        towerId: tower.id,
        x: tower.x,
        y: tower.y,
        range: eff.range
      });
    }

    const speedMap = {
      strawberry: 640,
      mint: 460,
      popcorn: 340
    };

    player.projectiles.push({
      id: this.allocId(),
      type: tower.type,
      level: tower.level,
      branch: tower.branch,
      towerId: tower.id,
      towerBuff: tower.buffTile,
      tileDmgMult: eff.tileDmgMult,
      specialMult,
      sourceX: tower.x,
      sourceY: tower.y,
      x: tower.x,
      y: tower.y,
      targetId: target.id,
      targetX: target.x,
      targetY: target.y,
      speed: speedMap[tower.type] || 500,
      progress: 0,
      damage: lvDef.damage,
      splashRadius: lvDef.splashRadius || 0,
      bounceCount: lvDef.bounceCount || 0,
      bounceMult: lvDef.bounceMult || 0,
      bounceRadius: lvDef.bounceRadius || 55,
      isSecondary: false
    });

    this.emitEvent('all', {
      type: 'tower_shot',
      slot: player.slot,
      towerId: tower.id,
      towerType: tower.type,
      level: tower.level,
      branch: tower.branch,
      fromX: tower.x,
      fromY: tower.y,
      toX: target.x,
      toY: target.y
    });
  }

  _stepProjectiles(player) {
    const creepById = new Map();
    for (const c of player.creeps) {
      if (c.hp > 0.0001) {
        creepById.set(c.id, c);
      }
    }

    const current = player.projectiles;
    player.projectiles = [];
    const remaining = [];
    for (const proj of current) {
      if (proj.targetId && (!proj.isSecondary || proj.type === 'strawberry')) {
        const liveTarget = creepById.get(proj.targetId);
        if (liveTarget && liveTarget.hp > 0.0001) {
          proj.targetX = liveTarget.x;
          proj.targetY = liveTarget.y;
        }
      }

      const dx = proj.targetX - proj.x;
      const dy = proj.targetY - proj.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const stepDist = proj.speed / TICK_RATE;

      if (dist <= stepDist || dist < 4) {
        proj.x = proj.targetX;
        proj.y = proj.targetY;
        this._resolveProjectileHit(player, proj, creepById);
      } else {
        proj.x += (dx / dist) * stepDist;
        proj.y += (dy / dist) * stepDist;
        const sdx = proj.targetX - proj.sourceX;
        const sdy = proj.targetY - proj.sourceY;
        const totalDist = Math.max(1, Math.sqrt(sdx * sdx + sdy * sdy));
        proj.progress = Math.min(1, 1 - dist / totalDist);
        remaining.push(proj);
      }
    }
    player.projectiles = remaining.concat(player.projectiles);
  }

  _resolveProjectileHit(player, proj, creepById = null) {
    const lvDef = getTowerLevelDef(proj.type, proj.level, proj.branch);
    if (!lvDef) return;

    if (proj.type === 'strawberry') {
      const target = creepById
        ? creepById.get(proj.targetId)
        : player.creeps.find((c) => c.id === proj.targetId);
      if (target && target.hp > 0.0001) {
        this._applyDamageToCreep(player, 'strawberry', lvDef, target, proj.damage, {
          tileDmgMult: proj.tileDmgMult,
          specialMult: proj.specialMult,
          towerBuff: proj.towerBuff
        });
      }

      // Strawberry-B Shredder: split 2 shrapnel at 1 nearby different target
      if (!proj.isSecondary && proj.level === 3 && proj.branch === 'B' && lvDef.splitCount > 0) {
        let bestAlt = null;
        let bestDistSq = 150 * 150;
        for (const c of player.creeps) {
          if (c.hp <= 0.0001 || c.id === proj.targetId) continue;
          const dx = c.x - proj.x;
          const dy = c.y - proj.y;
          const dSq = dx * dx + dy * dy;
          if (dSq <= bestDistSq) {
            bestDistSq = dSq;
            bestAlt = c;
          }
        }
        if (bestAlt) {
          for (let i = 0; i < lvDef.splitCount; i++) {
            player.projectiles.push({
              id: this.allocId(),
              type: 'strawberry',
              level: proj.level,
              branch: proj.branch,
              towerId: proj.towerId,
              towerBuff: proj.towerBuff,
              tileDmgMult: proj.tileDmgMult,
              specialMult: lvDef.splitMult, // 0.65
              sourceX: proj.x,
              sourceY: proj.y,
              x: proj.x + (i === 0 ? -4 : 4),
              y: proj.y + (i === 0 ? -4 : 4),
              targetId: bestAlt.id,
              targetX: bestAlt.x,
              targetY: bestAlt.y,
              speed: 580,
              progress: 0,
              damage: proj.damage,
              splashRadius: 0,
              bounceCount: 0,
              bounceMult: 0,
              isSecondary: true
            });
          }
        }
      }
      return;
    }

    if (proj.type === 'mint' || proj.type === 'popcorn') {
      const radius = proj.isSecondary ? proj.bounceRadius || 55 : proj.splashRadius;
      const radiusSq = radius * radius;
      for (const c of player.creeps) {
        if (c.hp <= 0.0001) continue;
        const dx = c.x - proj.x;
        const dy = c.y - proj.y;
        if (dx * dx + dy * dy <= radiusSq) {
          this._applyDamageToCreep(player, proj.type, lvDef, c, proj.damage, {
            tileDmgMult: proj.tileDmgMult,
            specialMult: proj.specialMult,
            towerBuff: proj.towerBuff
          });
        }
      }

      this.emitEvent('all', {
        type: proj.type === 'mint' ? 'mint_splash' : 'popcorn_boom',
        slot: player.slot,
        x: proj.x,
        y: proj.y,
        radius,
        branch: proj.branch,
        isSecondary: proj.isSecondary
      });

      // Popcorn-A Caramel Lava Pool
      if (proj.type === 'popcorn' && !proj.isSecondary && proj.level === 3 && proj.branch === 'A') {
        if (player.lavaZones.length >= 24) {
          player.lavaZones.shift();
        }
        player.lavaZones.push({
          id: this.allocId(),
          x: proj.x,
          y: proj.y,
          radius: lvDef.lavaRadius,
          remainTicks: lvDef.lavaDurationTicks,
          towerBuff: proj.towerBuff
        });
      }

      // Popcorn-B Pop Rocks: 4 secondary bounces
      if (
        proj.type === 'popcorn' &&
        !proj.isSecondary &&
        proj.level === 3 &&
        proj.branch === 'B' &&
        proj.bounceCount > 0
      ) {
        const bounceRangeSq = 150 * 150;
        const nearby = [];
        for (const c of player.creeps) {
          if (c.hp <= 0.0001) continue;
          const dx = c.x - proj.x;
          const dy = c.y - proj.y;
          if (dx * dx + dy * dy <= bounceRangeSq) {
            nearby.push(c);
            if (nearby.length >= proj.bounceCount) break;
          }
        }
        for (let i = 0; i < proj.bounceCount; i++) {
          const angle = (Math.PI * 2 * i) / proj.bounceCount + this.rng() * 0.4;
          const fallbackX = proj.x + Math.cos(angle) * 48;
          const fallbackY = proj.y + Math.sin(angle) * 48;
          const tgt = nearby[i % nearby.length] || null;
          player.projectiles.push({
            id: this.allocId(),
            type: 'popcorn',
            level: proj.level,
            branch: proj.branch,
            towerId: proj.towerId,
            towerBuff: proj.towerBuff,
            tileDmgMult: proj.tileDmgMult,
            specialMult: proj.bounceMult,
            sourceX: proj.x,
            sourceY: proj.y,
            x: proj.x,
            y: proj.y,
            targetId: tgt ? tgt.id : null,
            targetX: tgt ? tgt.x : fallbackX,
            targetY: tgt ? tgt.y : fallbackY,
            speed: 300,
            progress: 0,
            damage: proj.damage,
            splashRadius: lvDef.bounceRadius || 55,
            bounceCount: 0,
            bounceMult: 0,
            bounceRadius: lvDef.bounceRadius || 55,
            isSecondary: true
          });
        }
      }
    }
  }

  _cleanupDeadCreeps(player) {
    let changed = true;
    while (changed) {
      changed = false;
      const alive = [];
      const newlyDead = [];
      for (const c of player.creeps) {
        if (c.hp <= 0.0001) {
          newlyDead.push(c);
          changed = true;
        } else {
          alive.push(c);
        }
      }
      player.creeps = alive;

      for (const c of newlyDead) {
        const bonusBounty = !c.isSent && c.killedByBountyTile ? 3 : 0;
        const totalBounty = c.bounty + bonusBounty;
        player.gold += totalBounty;
        player.stats.creepsKilled += 1;
        player.stats.goldEarned += totalBounty;
        this.emitEvent('all', {
          type: 'creep_pop',
          slot: player.slot,
          creepId: c.id,
          creepType: c.type,
          isDark: c.isDark,
          bounty: totalBounty,
          bonusBounty,
          x: c.x,
          y: c.y
        });

        if (c.brittleMark) {
          const shatterDef = TOWER_DEFS.mint.branches.B;
          const shatterRadiusSq = shatterDef.shatterRadius * shatterDef.shatterRadius;
          const rawShatter = c.maxHp * shatterDef.shatterPct;
          for (const other of player.creeps) {
            if (other.hp <= 0.0001) continue;
            const dx = other.x - c.x;
            const dy = other.y - c.y;
            if (dx * dx + dy * dy <= shatterRadiusSq) {
              if (other.shieldHits > 0) {
                other.shieldHits -= 1;
                this.emitEvent('all', {
                  type: other.shieldHits === 0 ? 'shield_break' : 'shield_hit',
                  slot: player.slot,
                  creepId: other.id,
                  remain: other.shieldHits,
                  x: other.x,
                  y: other.y
                });
              } else {
                const dmg = other.isBoss ? Math.min(shatterDef.shatterBossCap, rawShatter) : rawShatter;
                other.hp -= dmg;
                player.stats.damageDealt += dmg;
              }
            }
          }
          this.emitEvent('all', {
            type: 'brittle_shatter',
            slot: player.slot,
            x: c.x,
            y: c.y,
            radius: shatterDef.shatterRadius
          });
        }
      }
    }
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

  _populateStressSide(player, towerCount, creepCount) {
    const combos = [];
    for (const type of TOWER_ORDER) {
      combos.push({ type, branch: 'A' });
      combos.push({ type, branch: 'B' });
    }

    let placed = 0;
    for (let col = 0; col < GRID_COLS && placed < towerCount; col++) {
      for (let row = 0; row < GRID_ROWS && placed < towerCount; row++) {
        if (!isBuildableCell(this.mapId, col, row, player.clearedObstacles)) continue;
        const key = cellKey(col, row);
        if (player.occupiedCells.has(key)) continue;
        const { type, branch } = combos[placed % combos.length];
        const def = TOWER_DEFS[type];
        const lv3 = def.branches[branch];
        const pos = cellToPixel(col, row);
        player.towers.push({
          id: this.allocId(),
          type,
          col,
          row,
          level: 3,
          branch,
          buffTile: getBuffAt(this.mapId, col, row, player.clearedObstacles),
          invested: lv3.totalCost,
          targeting: def.defaultTargeting,
          angle: 0,
          cooldownTicks: 0,
          shotCount: 0,
          recoil: 0,
          lastTargetId: null,
          lockStacks: 0,
          x: pos.x,
          y: pos.y
        });
        player.occupiedCells.add(key);
        placed += 1;
      }
    }

    const creepTypes = [
      'jelly',
      'gummy_pack',
      'toffee',
      'macaron_stack',
      'giant_cake',
      'dark_pop',
      'neon_dasher',
      'shield_choco',
      'dark_healer',
      'iron_titan'
    ];
    for (let i = 0; i < creepCount; i++) {
      const cType = creepTypes[i % creepTypes.length];
      const def = CREEP_DEFS[cType];
      const creep = this._spawnCreep(player, {
        type: cType,
        hpScale: 1.8,
        speedScale: 1,
        isSent: def.isDark,
        rainbow: i % 8 === 7
      });
      if (creep) {
        creep.progress = (i / Math.max(1, creepCount)) * 0.72;
        const pos = getPositionAtProgress(this.mapId, creep.progress);
        creep.x = pos.x;
        creep.y = pos.y;
        creep.angle = pos.angle;
      }
    }

    // Spawn 2 caramel lava pools on path for rendering stress test
    for (const prog of [0.22, 0.52]) {
      const lp = getPositionAtProgress(this.mapId, prog);
      player.lavaZones.push({
        id: this.allocId(),
        x: lp.x,
        y: lp.y,
        radius: 72,
        remainTicks: 70,
        towerBuff: null
      });
    }

    return placed;
  }

  spawnStress({ towers = 15, creeps = 45, bothSides = false, oppTowers, oppCreeps } = {}) {
    const towerCount = Math.min(40, Math.max(0, Math.floor(towers)));
    const creepCount = Math.min(120, Math.max(0, Math.floor(creeps)));
    const placed = this._populateStressSide(this.players[0], towerCount, creepCount);

    let oppPlaced = 0;
    let oppSpawned = 0;
    if (bothSides) {
      const oppTC = Math.min(40, Math.max(0, Math.floor(oppTowers !== undefined ? oppTowers : towerCount)));
      const oppCC = Math.min(120, Math.max(0, Math.floor(oppCreeps !== undefined ? oppCreeps : creepCount)));
      oppPlaced = this._populateStressSide(this.players[1], oppTC, oppCC);
      oppSpawned = oppCC;
    }

    return {
      placedTowers: placed,
      spawnedCreeps: creepCount,
      lavaZones: this.players[0].lavaZones.length,
      bothSides: Boolean(bothSides),
      oppPlacedTowers: oppPlaced,
      oppSpawnedCreeps: oppSpawned
    };
  }

  _serializePlayerForViewer(player, isSelf, { lite = false } = {}) {
    const base = {
      hp: player.hp,
      gold: player.gold,
      eco: player.eco,
      clearedObstacles: Array.from(player.clearedObstacles),
      towers: player.towers.map((t) => ({
        id: t.id,
        type: t.type,
        col: t.col,
        row: t.row,
        level: t.level,
        branch: t.branch || null,
        buffTile: t.buffTile || null,
        invested: t.invested,
        targeting: t.targeting,
        angle: Number(t.angle.toFixed(3)),
        recoil: Number((t.recoil || 0).toFixed(2))
      })),
      // Decision 2A: express alerts expose sendType directly so defender sees 💚 / 🛡️ icon
      incomingAlerts: player.incomingAlerts.map((a) => ({
        id: a.id,
        sendType: a.sendType,
        arriveTick: a.arriveTick,
        totalTicks: a.totalTicks
      }))
    };

    if (!lite) {
      base.lavaZones = player.lavaZones.map((z) => ({
        id: z.id,
        x: Number(z.x.toFixed(1)),
        y: Number(z.y.toFixed(1)),
        radius: z.radius,
        remainTicks: z.remainTicks
      }));
      base.creeps = player.creeps.map((c) => ({
        id: c.id,
        type: c.type,
        hp: Math.round(c.hp * 10) / 10,
        maxHp: Math.round(c.maxHp * 10) / 10,
        progress: Number(c.progress.toFixed(5)),
        slowTicks: c.slowTicks,
        freezeTicks: c.freezeTicks,
        shredTicks: c.shredTicks,
        vulnTicks: c.vulnTicks,
        vulnBonus: c.vulnBonus,
        armored: c.armored,
        heavyArmor: c.heavyArmor,
        shieldHits: c.shieldHits,
        maxShieldHits: c.maxShieldHits,
        isBoss: c.isBoss,
        isDark: c.isDark,
        isSent: c.isSent,
        healPulseTicks: c.healPulseTicks,
        cracked: c.cracked,
        rainbow: c.rainbow,
        x: Number(c.x.toFixed(1)),
        y: Number(c.y.toFixed(1)),
        angle: Number(c.angle.toFixed(3))
      }));
      base.projectiles = player.projectiles.map((p) => ({
        id: p.id,
        type: p.type,
        level: p.level,
        branch: p.branch || null,
        x: Number(p.x.toFixed(1)),
        y: Number(p.y.toFixed(1)),
        sourceX: Number(p.sourceX.toFixed(1)),
        sourceY: Number(p.sourceY.toFixed(1)),
        targetX: Number(p.targetX.toFixed(1)),
        targetY: Number(p.targetY.toFixed(1)),
        progress: Number(p.progress.toFixed(3)),
        isSecondary: p.isSecondary
      }));
    }

    if (isSelf) {
      const cooldowns = {};
      for (const key of SEND_ORDER) {
        cooldowns[key] = Math.max(0, (player.sendCooldowns[key] || 0) - this.tick);
      }
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

  getClientSnapshot(viewerSlot, roomPhaseOverride = null, { opponentLite = false } = {}) {
    const selfPlayer = this.players[viewerSlot];
    const oppPlayer = this.players[1 - viewerSlot];
    const ecoRem = ECO_PERIOD_TICKS - (this.tick % ECO_PERIOD_TICKS);

    const snap = {
      type: 'game_snapshot',
      mapId: this.mapId,
      tick: this.tick,
      phase: roomPhaseOverride || this.phase,
      wave: this.wave,
      isOvertime: this.wave > MAX_MAIN_WAVES,
      nextWaveInTicks: Math.max(0, this.nextWaveTick - this.tick),
      ecoPayoutInTicks: ecoRem === 0 ? ECO_PERIOD_TICKS : ecoRem,
      self: this._serializePlayerForViewer(selfPlayer, true, { lite: false }),
      opponent: this._serializePlayerForViewer(oppPlayer, false, { lite: Boolean(opponentLite) }),
      endedResult: this.endedResult
    };
    if (opponentLite) {
      snap.opponentLite = true;
    }
    return snap;
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
