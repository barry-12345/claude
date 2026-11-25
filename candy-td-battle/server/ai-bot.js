import {
  CREEP_DEFS,
  GRID_COLS,
  GRID_ROWS,
  SEND_DEFS,
  TOWER_DEFS,
  cellKey,
  isBuildableCell
} from '../public/js/shared/constants.js';

const GOLDEN_SPOTS = [
  [3, 3],
  [5, 5],
  [8, 5],
  [10, 2],
  [3, 1],
  [8, 2],
  [13, 2],
  [13, 4],
  [6, 5],
  [10, 5],
  [2, 3],
  [5, 3],
  [12, 2],
  [15, 4]
];

export class CandyAIBot {
  constructor(difficulty = 'casual') {
    this.difficulty = difficulty === 'clever' ? 'clever' : 'casual';
    this.decisionIntervalTicks = this.difficulty === 'clever' ? 20 : 36;
    this.nextDecisionTick = 20;
    this.nextSendAllowedTick = this.difficulty === 'clever' ? 160 : 320;
    this.feintToggle = false;
  }

  _findBuildCell(player) {
    for (const [col, row] of GOLDEN_SPOTS) {
      if (isBuildableCell(col, row) && !player.occupiedCells.has(cellKey(col, row))) {
        return { col, row };
      }
    }
    for (let col = 1; col < GRID_COLS - 1; col++) {
      for (let row = 1; row < GRID_ROWS - 1; row++) {
        if (isBuildableCell(col, row) && !player.occupiedCells.has(cellKey(col, row))) {
          return { col, row };
        }
      }
    }
    return null;
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
      ai.creeps.some((c) => c.armored) ||
      ai.spawnQueue.some((s) => CREEP_DEFS[s.type]?.armored);

    // 1. Defense priority: Strawberry -> Mint -> Lemon/Popcorn -> Upgrade -> More towers
    const spot = this._findBuildCell(ai);

    if (counts.strawberry === 0 && spot && ai.gold >= TOWER_DEFS.strawberry.levels[0].cost) {
      sim.applyPlayerAction(aiSlot, {
        type: 'place_tower',
        towerType: 'strawberry',
        col: spot.col,
        row: spot.row
      });
      return;
    }

    if (counts.mint === 0 && spot && ai.gold >= TOWER_DEFS.mint.levels[0].cost) {
      sim.applyPlayerAction(aiSlot, {
        type: 'place_tower',
        towerType: 'mint',
        col: spot.col,
        row: spot.row
      });
      return;
    }

    if (
      (hasArmoredIncoming || ai.towers.length >= 2) &&
      counts.lemon === 0 &&
      spot &&
      ai.gold >= TOWER_DEFS.lemon.levels[0].cost
    ) {
      sim.applyPlayerAction(aiSlot, {
        type: 'place_tower',
        towerType: 'lemon',
        col: spot.col,
        row: spot.row
      });
      return;
    }

    if (
      ai.towers.length >= 2 &&
      counts.popcorn === 0 &&
      spot &&
      ai.gold >= TOWER_DEFS.popcorn.levels[0].cost
    ) {
      sim.applyPlayerAction(aiSlot, {
        type: 'place_tower',
        towerType: 'popcorn',
        col: spot.col,
        row: spot.row
      });
      return;
    }

    // 2. Offense / Eco strategy
    if (sim.tick >= this.nextSendAllowedTick) {
      if (this.difficulty === 'casual') {
        if (sim.wave >= 7 && ai.gold >= 340 && (ai.sendCooldowns.express_party || 0) <= sim.tick) {
          const res = sim.applyPlayerAction(aiSlot, { type: 'send_wave', sendType: 'express_party' });
          if (res.ok) {
            this.nextSendAllowedTick = sim.tick + 400;
            return;
          }
        }
        if (ai.gold >= 130 && (ai.sendCooldowns.send_jelly || 0) <= sim.tick) {
          const res = sim.applyPlayerAction(aiSlot, { type: 'send_wave', sendType: 'send_jelly' });
          if (res.ok) {
            this.nextSendAllowedTick = sim.tick + 340; // ~17s
            return;
          }
        }
      } else {
        // Clever Fox: checks opponent weakness, mixes feint & real express
        const humanHasLemon = human.towers.some((t) => t.type === 'lemon');

        if (sim.wave >= 5 && ai.gold >= 380 && (ai.sendCooldowns.express_boss || 0) <= sim.tick && ai.gold >= 520) {
          const res = sim.applyPlayerAction(aiSlot, { type: 'send_wave', sendType: 'express_boss' });
          if (res.ok) {
            this.nextSendAllowedTick = sim.tick + 220;
            return;
          }
        }

        if (sim.wave >= 4 && ai.gold >= 260) {
          this.feintToggle = !this.feintToggle;
          if (this.feintToggle && (ai.sendCooldowns.express_feint || 0) <= sim.tick) {
            const res = sim.applyPlayerAction(aiSlot, { type: 'send_wave', sendType: 'express_feint' });
            if (res.ok) {
              this.nextSendAllowedTick = sim.tick + 180;
              return;
            }
          } else if ((ai.sendCooldowns.express_party || 0) <= sim.tick && ai.gold >= 280) {
            const res = sim.applyPlayerAction(aiSlot, { type: 'send_wave', sendType: 'express_party' });
            if (res.ok) {
              this.nextSendAllowedTick = sim.tick + 220;
              return;
            }
          }
        }

        if (!humanHasLemon && sim.wave >= 3 && ai.gold >= 220 && (ai.sendCooldowns.send_toffee || 0) <= sim.tick) {
          const res = sim.applyPlayerAction(aiSlot, { type: 'send_wave', sendType: 'send_toffee' });
          if (res.ok) {
            this.nextSendAllowedTick = sim.tick + 120;
            return;
          }
        }

        if (ai.gold >= 140 && (ai.sendCooldowns.send_gummy || 0) <= sim.tick) {
          const res = sim.applyPlayerAction(aiSlot, { type: 'send_wave', sendType: 'send_gummy' });
          if (res.ok) {
            this.nextSendAllowedTick = sim.tick + 100;
            return;
          }
        }

        if (ai.gold >= SEND_DEFS.send_jelly.cost + 40 && (ai.sendCooldowns.send_jelly || 0) <= sim.tick) {
          const res = sim.applyPlayerAction(aiSlot, { type: 'send_wave', sendType: 'send_jelly' });
          if (res.ok) {
            this.nextSendAllowedTick = sim.tick + 80;
            return;
          }
        }
      }
    }

    // 3. Upgrade existing core towers to Lv2 / Lv3
    const upgradeCandidate = ai.towers
      .filter((t) => t.level < 3)
      .sort((a, b) => a.level - b.level)[0];

    if (upgradeCandidate) {
      const nextLvCost = TOWER_DEFS[upgradeCandidate.type].levels[upgradeCandidate.level].cost;
      if (ai.gold >= nextLvCost + (ai.towers.length < 4 ? 40 : 0)) {
        sim.applyPlayerAction(aiSlot, { type: 'upgrade_tower', towerId: upgradeCandidate.id });
        return;
      }
    }

    // 4. Add more towers when gold overflows
    if (spot && ai.towers.length < 12) {
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
