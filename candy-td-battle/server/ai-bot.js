import {
  CREEP_DEFS,
  DEFAULT_MAP_ID,
  DEMOLISH_COST,
  GRID_COLS,
  GRID_ROWS,
  SEND_DEFS,
  TOWER_DEFS,
  cellKey,
  cellToPixel,
  getBuffAt,
  getMapDef,
  getPositionAtProgress,
  getTowerLevelDef,
  isBuildableCell
} from '../public/js/shared/constants.js';

const MAP_SCORE_CACHE = new Map();

function computeMapCellScores(mapId) {
  const mapDef = getMapDef(mapId);
  if (MAP_SCORE_CACHE.has(mapDef.id)) {
    return MAP_SCORE_CACHE.get(mapDef.id);
  }

  const samples = [];
  const sampleCount = 80;
  for (let i = 0; i <= sampleCount; i++) {
    samples.push(getPositionAtProgress(mapDef.id, i / sampleCount));
  }

  const cells = [];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];

  for (let col = 0; col < GRID_COLS; col++) {
    for (let row = 0; row < GRID_ROWS; row++) {
      const key = cellKey(col, row);
      if (mapDef.pathCellSet.has(key)) continue;

      const pos = cellToPixel(col, row);
      let shortCov = 0;
      let longCov = 0;
      for (const s of samples) {
        const d = Math.hypot(s.x - pos.x, s.y - pos.y);
        if (d <= 155) shortCov += 1;
        if (d <= 300) longCov += 1;
      }

      let adjPath = 0;
      for (const [dc, dr] of dirs) {
        if (mapDef.pathCellSet.has(cellKey(col + dc, row + dr))) {
          adjPath += 1;
        }
      }

      const edgePenalty = col === 0 || col === GRID_COLS - 1 ? -4 : 0;
      const obs = mapDef.obstacleMap.get(key) || null;
      const shortScore = shortCov * 3 + adjPath * 5 + edgePenalty;
      const longScore = longCov * 2 + shortCov + adjPath * 2;

      cells.push({
        col,
        row,
        key,
        shortScore,
        longScore,
        isObstacle: Boolean(obs),
        buff: obs ? obs.buff : null
      });
    }
  }

  MAP_SCORE_CACHE.set(mapDef.id, cells);
  return cells;
}

export class CandyAIBot {
  constructor(difficulty = 'casual', mapId = DEFAULT_MAP_ID) {
    this.difficulty = difficulty === 'clever' ? 'clever' : 'casual';
    this.mapId = getMapDef(mapId).id;
    this.decisionIntervalTicks = this.difficulty === 'clever' ? 20 : 36;
    this.nextDecisionTick = 20;
    this.nextSendAllowedTick = this.difficulty === 'clever' ? 140 : 280;
  }

  _scoreBuffForTower(buff, towerType) {
    if (!buff) return 0;
    if (buff === 'range') {
      return towerType === 'lemon' || towerType === 'mint' ? 38 : 26;
    }
    if (buff === 'rate') {
      return towerType === 'strawberry' || towerType === 'lemon' ? 38 : 28;
    }
    if (buff === 'damage') {
      return towerType === 'lemon' || towerType === 'popcorn' ? 36 : 26;
    }
    if (buff === 'bounty') {
      return towerType === 'strawberry' || towerType === 'popcorn' ? 24 : 18;
    }
    return 0;
  }

  _findBuildCell(sim, player, towerType) {
    const scores = computeMapCellScores(sim.mapId);
    let best = null;
    let bestScore = -Infinity;

    for (const c of scores) {
      if (!isBuildableCell(sim.mapId, c.col, c.row, player.clearedObstacles)) continue;
      if (player.occupiedCells.has(c.key)) continue;

      const buff = getBuffAt(sim.mapId, c.col, c.row, player.clearedObstacles);
      const base = towerType === 'lemon' ? c.longScore : c.shortScore;
      const total = base + this._scoreBuffForTower(buff, towerType);
      if (total > bestScore) {
        bestScore = total;
        best = { col: c.col, row: c.row, score: total };
      }
    }
    return best;
  }

  _findObstacleToDemolish(sim, player) {
    const scores = computeMapCellScores(sim.mapId);
    let best = null;
    let bestScore = -Infinity;

    for (const c of scores) {
      if (!c.isObstacle || player.clearedObstacles.has(c.key)) continue;
      const total = c.shortScore + (c.buff === 'damage' || c.buff === 'rate' ? 18 : 12);
      if (total > bestScore) {
        bestScore = total;
        best = { col: c.col, row: c.row, buff: c.buff };
      }
    }
    return best;
  }

  _pickLv3Branch(sim, ai, tower) {
    const hasArmorOrBoss =
      sim.wave >= 8 ||
      ai.creeps.some((c) => c.armored || c.isBoss || c.shieldHits > 0);
    const hasShields = ai.creeps.some((c) => c.shieldHits > 0);

    if (tower.type === 'strawberry') {
      const hasShredder = ai.towers.some(
        (t) => t.type === 'strawberry' && t.level === 3 && t.branch === 'B'
      );
      return hasArmorOrBoss && !hasShredder ? 'B' : 'A';
    }
    if (tower.type === 'mint') {
      const hasFrost = ai.towers.some(
        (t) => t.type === 'mint' && t.level === 3 && t.branch === 'A'
      );
      return !hasFrost && ai.creeps.some((c) => c.type === 'neon_dasher' || c.type === 'dark_healer')
        ? 'A'
        : 'B';
    }
    if (tower.type === 'popcorn') {
      const hasLava = ai.towers.some(
        (t) => t.type === 'popcorn' && t.level === 3 && t.branch === 'A'
      );
      return (hasShields || sim.wave >= 7) && !hasLava ? 'A' : 'B';
    }
    if (tower.type === 'lemon') {
      if (sim.wave >= 9 || ai.creeps.some((c) => c.isBoss)) {
        return 'B';
      }
      if (sim.mapId === 'waffle_zig' || sim.mapId === 'cross_switch') {
        return 'A';
      }
      return 'B';
    }
    return 'A';
  }

  _countByType(towers) {
    const counts = { strawberry: 0, mint: 0, popcorn: 0, lemon: 0 };
    for (const t of towers) {
      counts[t.type] = (counts[t.type] || 0) + 1;
    }
    return counts;
  }

  onTick(sim, aiSlot) {
    if (sim.phase !== 'PLAYING') return;
    if (sim.tick < this.nextDecisionTick) return;
    this.nextDecisionTick = sim.tick + this.decisionIntervalTicks;

    const ai = sim.players[aiSlot];
    const human = sim.players[1 - aiSlot];
    const counts = this._countByType(ai.towers);
    const hasArmoredIncoming =
      sim.wave >= 4 ||
      ai.creeps.some((c) => c.armored || c.shieldHits > 0) ||
      ai.spawnQueue.some((s) => CREEP_DEFS[s.type]?.armored);

    // 1. Opening ($190 -> Strawberry $80 + Mint $100) & Core Quartet Defense
    if (counts.strawberry === 0 && ai.gold >= TOWER_DEFS.strawberry.levels[0].cost) {
      const spot = this._findBuildCell(sim, ai, 'strawberry');
      if (spot) {
        sim.applyPlayerAction(aiSlot, {
          type: 'place_tower',
          towerType: 'strawberry',
          col: spot.col,
          row: spot.row
        });
        return;
      }
    }

    if (counts.mint === 0 && ai.gold >= TOWER_DEFS.mint.levels[0].cost) {
      const spot = this._findBuildCell(sim, ai, 'mint');
      if (spot) {
        sim.applyPlayerAction(aiSlot, {
          type: 'place_tower',
          towerType: 'mint',
          col: spot.col,
          row: spot.row
        });
        return;
      }
    }

    if (
      ai.towers.length >= 2 &&
      counts.popcorn === 0 &&
      ai.gold >= TOWER_DEFS.popcorn.levels[0].cost
    ) {
      const spot = this._findBuildCell(sim, ai, 'popcorn');
      if (spot) {
        sim.applyPlayerAction(aiSlot, {
          type: 'place_tower',
          towerType: 'popcorn',
          col: spot.col,
          row: spot.row
        });
        return;
      }
    }

    if (
      (hasArmoredIncoming || ai.towers.length >= 3) &&
      counts.lemon === 0 &&
      ai.gold >= TOWER_DEFS.lemon.levels[0].cost
    ) {
      const spot = this._findBuildCell(sim, ai, 'lemon');
      if (spot) {
        sim.applyPlayerAction(aiSlot, {
          type: 'place_tower',
          towerType: 'lemon',
          col: spot.col,
          row: spot.row
        });
        return;
      }
    }

    // 2. Demolish obstacle for buff tile mid-game
    if (
      ai.towers.length >= 2 &&
      ai.clearedObstacles.size < 2 &&
      ai.gold >= DEMOLISH_COST + 100
    ) {
      const obs = this._findObstacleToDemolish(sim, ai);
      if (obs) {
        const res = sim.applyPlayerAction(aiSlot, {
          type: 'demolish_obstacle',
          col: obs.col,
          row: obs.row
        });
        if (res.ok) return;
      }
    }

    // 3. Offense / Eco strategy (5 Dark/Neon Raid Forces, zero feint)
    if (sim.tick >= this.nextSendAllowedTick) {
      if (this.difficulty === 'casual') {
        if (
          sim.wave >= 8 &&
          ai.gold >= 340 &&
          (ai.sendCooldowns.express_healer || 0) <= sim.tick
        ) {
          const res = sim.applyPlayerAction(aiSlot, {
            type: 'send_wave',
            sendType: 'express_healer'
          });
          if (res.ok) {
            this.nextSendAllowedTick = sim.tick + 420;
            return;
          }
        }
        if (
          sim.wave >= 3 &&
          ai.gold >= 165 &&
          (ai.sendCooldowns.raid_dash || 0) <= sim.tick
        ) {
          const res = sim.applyPlayerAction(aiSlot, {
            type: 'send_wave',
            sendType: 'raid_dash'
          });
          if (res.ok) {
            this.nextSendAllowedTick = sim.tick + 320;
            return;
          }
        }
        if (ai.gold >= 135 && (ai.sendCooldowns.raid_swarm || 0) <= sim.tick) {
          const res = sim.applyPlayerAction(aiSlot, {
            type: 'send_wave',
            sendType: 'raid_swarm'
          });
          if (res.ok) {
            this.nextSendAllowedTick = sim.tick + 320;
            return;
          }
        }
      } else {
        // Clever Fox: scouts opponent defense gaps & deploys targeted Dark/Neon raids
        const humanHasPopcorn = human.towers.some((t) => t.type === 'popcorn');
        const humanHasMint = human.towers.some((t) => t.type === 'mint');
        const humanHasLemon = human.towers.some((t) => t.type === 'lemon');
        const humanStrawberryCount = human.towers.filter((t) => t.type === 'strawberry').length;

        if (
          sim.wave >= 6 &&
          ai.gold >= 520 &&
          (ai.sendCooldowns.express_titan || 0) <= sim.tick
        ) {
          const res = sim.applyPlayerAction(aiSlot, {
            type: 'send_wave',
            sendType: 'express_titan'
          });
          if (res.ok) {
            this.nextSendAllowedTick = sim.tick + 240;
            return;
          }
        }

        if (
          sim.wave >= 5 &&
          ai.gold >= 320 &&
          (ai.sendCooldowns.express_healer || 0) <= sim.tick
        ) {
          const res = sim.applyPlayerAction(aiSlot, {
            type: 'send_wave',
            sendType: 'express_healer'
          });
          if (res.ok) {
            this.nextSendAllowedTick = sim.tick + 220;
            return;
          }
        }

        if (
          humanHasLemon &&
          humanStrawberryCount <= 1 &&
          sim.wave >= 3 &&
          ai.gold >= 210 &&
          (ai.sendCooldowns.raid_shield || 0) <= sim.tick
        ) {
          const res = sim.applyPlayerAction(aiSlot, {
            type: 'send_wave',
            sendType: 'raid_shield'
          });
          if (res.ok) {
            this.nextSendAllowedTick = sim.tick + 160;
            return;
          }
        }

        if (
          !humanHasMint &&
          ai.gold >= 145 &&
          (ai.sendCooldowns.raid_dash || 0) <= sim.tick
        ) {
          const res = sim.applyPlayerAction(aiSlot, {
            type: 'send_wave',
            sendType: 'raid_dash'
          });
          if (res.ok) {
            this.nextSendAllowedTick = sim.tick + 120;
            return;
          }
        }

        if (
          (!humanHasPopcorn || ai.gold >= 120) &&
          ai.gold >= SEND_DEFS.raid_swarm.cost + 30 &&
          (ai.sendCooldowns.raid_swarm || 0) <= sim.tick
        ) {
          const res = sim.applyPlayerAction(aiSlot, {
            type: 'send_wave',
            sendType: 'raid_swarm'
          });
          if (res.ok) {
            this.nextSendAllowedTick = sim.tick + 100;
            return;
          }
        }
      }
    }

    // 4. Upgrade existing towers to Lv2 / Lv3 (choosing A/B branch)
    const upgradeCandidate = ai.towers
      .filter((t) => t.level < 3)
      .sort((a, b) => a.level - b.level)[0];

    if (upgradeCandidate) {
      const nextLv = upgradeCandidate.level + 1;
      const branch = nextLv === 3 ? this._pickLv3Branch(sim, ai, upgradeCandidate) : undefined;
      const nextDef = getTowerLevelDef(upgradeCandidate.type, nextLv, branch);
      if (nextDef && ai.gold >= nextDef.cost + (ai.towers.length < 4 ? 30 : 0)) {
        sim.applyPlayerAction(aiSlot, {
          type: 'upgrade_tower',
          towerId: upgradeCandidate.id,
          ...(branch ? { branch } : {})
        });
        return;
      }
    }

    // 5. Expand defense when gold overflows
    if (ai.towers.length < 14) {
      const pickType =
        counts.lemon < 2
          ? 'lemon'
          : counts.popcorn < 2
            ? 'popcorn'
            : counts.mint < 2
              ? 'mint'
              : 'strawberry';
      const cost = TOWER_DEFS[pickType].levels[0].cost;
      if (ai.gold >= cost) {
        const spot = this._findBuildCell(sim, ai, pickType);
        if (spot) {
          sim.applyPlayerAction(aiSlot, {
            type: 'place_tower',
            towerType: pickType,
            col: spot.col,
            row: spot.row
          });
        }
      }
    }
  }
}
