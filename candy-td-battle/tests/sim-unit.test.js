import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../server/simulation.js';
import { CandyAIBot } from '../server/ai-bot.js';
import {
  BUFF_TILE_DEFS,
  CREEP_DEFS,
  DEFAULT_MAP_ID,
  DEMOLISH_COST,
  ECO_PERIOD_TICKS,
  GRID_COLS,
  GRID_ROWS,
  INITIAL_ECO,
  INITIAL_GOLD,
  INITIAL_HP,
  MAP_DEFS,
  MAP_ORDER,
  MAX_MAIN_WAVES,
  SEND_DEFS,
  SEND_ORDER,
  TOWER_DEFS,
  cellKey,
  cellToPixel,
  getMapDef,
  getTowerLevelDef,
  getWaveConfig,
  getWaveIntervalTicks,
  isBuildableCell
} from '../public/js/shared/constants.js';

test('AC-06 (Geometry): All 8 MAP_DEFS satisfy grid bounds, orthogonal, non-intersecting, non-touching & 4 buff obstacles', () => {
  assert.equal(MAP_ORDER.length, 8);
  assert.equal(DEFAULT_MAP_ID, 'classic_s');

  const expectedCounts = {
    classic_s: { cells: 31, len: 1748, buildable: 127 },
    waffle_zig: { cells: 34, len: 1956, buildable: 124 },
    rainbow_m: { cells: 34, len: 1916, buildable: 124 },
    stair_cascade: { cells: 30, len: 1692, buildable: 128 },
    canyon_u: { cells: 35, len: 1972, buildable: 123 },
    crown_peaks: { cells: 36, len: 2028, buildable: 122 },
    horseshoe_ring: { cells: 34, len: 1916, buildable: 124 },
    cross_switch: { cells: 36, len: 2060, buildable: 122 }
  };

  for (const mapId of MAP_ORDER) {
    const map = getMapDef(mapId);
    assert.equal(map.id, mapId);
    assert.equal(map.waypoints[0][0], 0, `${mapId} entry must be col 0`);
    assert.equal(map.waypoints[map.waypoints.length - 1][0], GRID_COLS - 1, `${mapId} exit must be col 17`);

    // Walk segments in order and verify orthogonality, bounds, no self-intersection, and no non-adjacent touching
    const orderedCells = [];
    const seen = new Set();
    for (let i = 0; i < map.waypoints.length - 1; i++) {
      const [c1, r1] = map.waypoints[i];
      const [c2, r2] = map.waypoints[i + 1];
      assert.ok(c1 === c2 || r1 === r2, `${mapId} segment ${i} must be orthogonal`);
      assert.ok(c1 !== c2 || r1 !== r2, `${mapId} segment ${i} must be non-zero`);
      const dc = Math.sign(c2 - c1);
      const dr = Math.sign(r2 - r1);
      let c = c1;
      let r = r1;
      if (i === 0) {
        assert.ok(c >= 0 && c < GRID_COLS && r >= 0 && r < GRID_ROWS);
        orderedCells.push([c, r]);
        seen.add(cellKey(c, r));
      }
      while (c !== c2 || r !== r2) {
        c += dc;
        r += dr;
        assert.ok(c >= 0 && c < GRID_COLS && r >= 0 && r < GRID_ROWS, `${mapId} cell out of bounds (${c},${r})`);
        const k = cellKey(c, r);
        assert.equal(seen.has(k), false, `${mapId} path self-intersects at ${k}`);
        seen.add(k);
        orderedCells.push([c, r]);
      }
    }

    // Check non-adjacent touching (Manhattan distance 1 allowed only for consecutive path cells)
    for (let i = 0; i < orderedCells.length; i++) {
      for (let j = i + 2; j < orderedCells.length; j++) {
        const dist =
          Math.abs(orderedCells[i][0] - orderedCells[j][0]) +
          Math.abs(orderedCells[i][1] - orderedCells[j][1]);
        assert.ok(dist > 1, `${mapId} non-adjacent path cells touch: ${orderedCells[i]} and ${orderedCells[j]}`);
      }
    }

    // Check expected metrics
    const exp = expectedCounts[mapId];
    assert.equal(map.pathCellSet.size, exp.cells, `${mapId} path cells`);
    assert.equal(map.totalPathLength, exp.len, `${mapId} path length`);
    assert.equal(map.initialBuildableCount, exp.buildable, `${mapId} initial buildable count`);

    // Check 4 obstacles off path and covering all 4 buff types
    assert.equal(map.obstacles.length, 4);
    const buffs = new Set();
    const obsKeys = new Set();
    for (const obs of map.obstacles) {
      assert.ok(obs.col >= 0 && obs.col < GRID_COLS && obs.row >= 0 && obs.row < GRID_ROWS);
      const okKey = cellKey(obs.col, obs.row);
      assert.equal(map.pathCellSet.has(okKey), false, `${mapId} obstacle ${okKey} on path`);
      assert.equal(obsKeys.has(okKey), false, `${mapId} duplicate obstacle ${okKey}`);
      obsKeys.add(okKey);
      assert.ok(BUFF_TILE_DEFS[obs.buff], `${mapId} invalid buff ${obs.buff}`);
      buffs.add(obs.buff);
      assert.equal(isBuildableCell(mapId, obs.col, obs.row), false);
    }
    assert.equal(buffs.size, 4, `${mapId} must have all 4 unique buff types`);
  }
});

test('AC-03: 4 Towers Lv1/Lv2, 8 Lv3 branches, branch validation, and 70% sell refund', () => {
  // 1. Initial gold is $190, build/upgrade validation & 70% refund
  {
    const sim = new GameSimulation({ seed: 42, mapId: 'classic_s' });
    assert.equal(sim.players[0].gold, INITIAL_GOLD);
    assert.equal(INITIAL_GOLD, 190);
    assert.equal(sim.players[0].hp, INITIAL_HP);
    assert.equal(sim.players[0].eco, INITIAL_ECO);

    // Build Strawberry ($80) + Mint ($100) with $190 opening gold -> $10 left
    const sb = sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'strawberry', col: 3, row: 3 });
    const mt = sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'mint', col: 5, row: 3 });
    assert.equal(sb.ok, true);
    assert.equal(mt.ok, true);
    assert.equal(sim.players[0].gold, 10);

    // Path & obstacle rejection
    assert.equal(sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'strawberry', col: 0, row: 2 }).code, 'INVALID_CELL');
    assert.equal(sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'strawberry', col: 3, row: 4 }).code, 'INVALID_CELL');
    assert.equal(sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'strawberry', col: 3, row: 3 }).code, 'CELL_OCCUPIED');

    sim.grantResources({ targetSlot: 0, gold: 1000 });
    // Lv1 -> Lv2 (+75)
    const u2 = sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: sb.towerId });
    assert.equal(u2.ok, true);
    assert.equal(u2.level, 2);

    // Lv2 -> Lv3 without branch or invalid branch must return INVALID_BRANCH
    assert.equal(sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: sb.towerId }).code, 'INVALID_BRANCH');
    assert.equal(sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: sb.towerId, branch: 'C' }).code, 'INVALID_BRANCH');

    // Lv2 -> Lv3 branch A (+145 -> total 300)
    const u3 = sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: sb.towerId, branch: 'A' });
    assert.equal(u3.ok, true);
    assert.equal(u3.level, 3);
    assert.equal(u3.branch, 'A');
    assert.equal(sim.players[0].towers[0].invested, 300);

    // Max level guard
    assert.equal(sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: sb.towerId, branch: 'B' }).code, 'MAX_LEVEL');

    // Sell Lv3 strawberry -> Math.round(300 * 0.7) = 210
    const beforeSell = sim.players[0].gold;
    const sellRes = sim.applyPlayerAction(0, { type: 'sell_tower', towerId: sb.towerId });
    assert.equal(sellRes.ok, true);
    assert.equal(sellRes.refund, 210);
    assert.equal(sim.players[0].gold, beforeSell + 210);
  }

  // 2. Strawberry-A (gatling) stacking up to +100% and resetting on target switch
  {
    const sim = new GameSimulation({ seed: 42 });
    sim.nextWaveTick = 99999;
    sim.grantResources({ targetSlot: 0, gold: 2000 });
    const res = sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'strawberry', col: 2, row: 1 });
    sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: res.towerId });
    sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: res.towerId, branch: 'A' });

    const c1 = sim._spawnCreep(sim.players[0], { type: 'jelly', hpScale: 100, speedScale: 0, isSent: false });
    c1.progress = 120 / sim.mapDef.totalPathLength;
    const pos = cellToPixel(2, 2);
    c1.x = pos.x;
    c1.y = pos.y;

    // Fire 12 shots to exceed 10 stacks cap
    for (let i = 0; i < 65; i++) sim.step();
    const tower = sim.players[0].towers[0];
    assert.equal(tower.lockStacks, 10);

    // First shot on a new target must reset stacks to 0
    c1.hp = 0;
    const c2 = sim._spawnCreep(sim.players[0], { type: 'jelly', hpScale: 100, speedScale: 0, isSent: false });
    c2.progress = 120 / sim.mapDef.totalPathLength;
    c2.x = pos.x;
    c2.y = pos.y;
    const prevHp = c2.hp;
    for (let i = 0; i < 12; i++) sim.step();
    assert.ok(tower.lockStacks < 10);
    // Check that first damage tick was base 20 (plus maybe 1-2 more shots)
    assert.ok(prevHp - c2.hp >= 20 - 1e-6);
  }

  // 3. Strawberry-B (shredder) split 2x65% & shred debuff raising non-lemon armored mult to 0.85x / heavy 0.75x
  {
    const sim = new GameSimulation({ seed: 42 });
    sim.nextWaveTick = 99999;
    sim.grantResources({ targetSlot: 0, gold: 2000 });
    const res = sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'strawberry', col: 2, row: 1 });
    sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: res.towerId });
    sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: res.towerId, branch: 'B' });

    const primary = sim._spawnCreep(sim.players[0], { type: 'toffee', hpScale: 20, speedScale: 0, isSent: false });
    primary.progress = 120 / sim.mapDef.totalPathLength;
    const pos = cellToPixel(2, 2);
    primary.x = pos.x;
    primary.y = pos.y;

    const secondary = sim._spawnCreep(sim.players[0], { type: 'jelly', hpScale: 20, speedScale: 0, isSent: false });
    secondary.progress = 90 / sim.mapDef.totalPathLength;
    secondary.x = pos.x - 30;
    secondary.y = pos.y;

    for (let i = 0; i < 12; i++) sim.step();
    assert.ok(primary.shredTicks > 0, 'Primary target must receive shred debuff');
    assert.ok(secondary.maxHp - secondary.hp >= 22 * 0.65 * 2 - 1e-6, 'Secondary target must be hit by 2x 65% shrapnel');

    // Verify shred raises armored multiplier to 0.85x for strawberry/popcorn and 0.75x for heavyArmor
    const sbLv1 = TOWER_DEFS.strawberry.levels[0];
    assert.ok(Math.abs(sim._computeDamage('strawberry', sbLv1, primary, sbLv1.damage) - 11 * 0.85) < 1e-6);
    const titan = sim._spawnCreep(sim.players[0], { type: 'iron_titan', hpScale: 1, speedScale: 0, isSent: true });
    assert.ok(Math.abs(sim._computeDamage('strawberry', sbLv1, titan, sbLv1.damage) - 11 * 0.50) < 1e-6);
    titan.shredTicks = 30;
    assert.ok(Math.abs(sim._computeDamage('strawberry', sbLv1, titan, sbLv1.damage) - 11 * 0.75) < 1e-6);
  }

  // 4. Mint Lv1 +12% vuln, Mint-A Frost Nova freeze + 2.5s immunity, Mint-B +35% vuln & death shatter
  {
    const sim = new GameSimulation({ seed: 42 });
    sim.nextWaveTick = 99999;
    sim.grantResources({ targetSlot: 0, gold: 4000 });
    const mA = sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'mint', col: 1, row: 1 });
    const pos = cellToPixel(1, 2);
    const j1 = sim._spawnCreep(sim.players[0], { type: 'jelly', hpScale: 30, speedScale: 0, isSent: false });
    j1.progress = 60 / sim.mapDef.totalPathLength;
    j1.x = pos.x;
    j1.y = pos.y;

    for (let i = 0; i < 12; i++) sim.step();
    assert.equal(j1.vulnBonus, 0.12);
    assert.ok(j1.vulnTicks > 0);
    const sbLv1 = TOWER_DEFS.strawberry.levels[0];
    assert.ok(Math.abs(sim._computeDamage('strawberry', sbLv1, j1, sbLv1.damage) - 11 * 1.12) < 1e-6);

    // Upgrade Mint-A and fire 4th shot for Frost Nova
    sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: mA.towerId });
    sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: mA.towerId, branch: 'A' });
    let sawNova = false;
    let sawFreeze = false;
    for (let i = 0; i < 90; i++) {
      const evs = sim.step();
      if (evs.some((e) => e.type === 'frost_nova')) sawNova = true;
      if (j1.freezeTicks > 0) sawFreeze = true;
      if (sawNova && sawFreeze) break;
    }
    assert.equal(sawNova, true, 'Mint-A must trigger frost_nova every 4 shots');
    assert.equal(sawFreeze, true, 'Frost nova must freeze creep in range');

    // Wait until freeze ends and verify 50-tick freeze immunity window
    while (j1.freezeTicks > 0) sim.step();
    assert.equal(j1.freezeImmuneTicks, 50);

    // Mint-B (+35% vuln & death shatter 12% maxHp, capped at 120 vs Boss)
    const simB = new GameSimulation({ seed: 42 });
    simB.nextWaveTick = 99999;
    simB.grantResources({ targetSlot: 0, gold: 4000 });
    const mB = simB.applyPlayerAction(0, { type: 'place_tower', towerType: 'mint', col: 1, row: 1 });
    simB.applyPlayerAction(0, { type: 'upgrade_tower', towerId: mB.towerId });
    simB.applyPlayerAction(0, { type: 'upgrade_tower', towerId: mB.towerId, branch: 'B' });

    const victim = simB._spawnCreep(simB.players[0], { type: 'giant_cake', hpScale: 1, speedScale: 0, isSent: false }); // maxHp 800
    victim.progress = 80 / simB.mapDef.totalPathLength;
    victim.x = pos.x + 20;
    victim.y = pos.y;
    const bystander = simB._spawnCreep(simB.players[0], { type: 'jelly', hpScale: 20, speedScale: 0, isSent: false }); // maxHp 700
    bystander.progress = 50 / simB.mapDef.totalPathLength;
    bystander.x = pos.x - 10;
    bystander.y = pos.y;
    const bossBystander = simB._spawnCreep(simB.players[0], { type: 'giant_cake', hpScale: 2, speedScale: 0, isSent: false }); // maxHp 1600
    bossBystander.progress = 40 / simB.mapDef.totalPathLength;
    bossBystander.x = pos.x - 20;
    bossBystander.y = pos.y;

    for (let i = 0; i < 12; i++) simB.step();
    assert.equal(victim.vulnBonus, 0.35);
    assert.equal(victim.brittleMark, true);

    // Kill victim directly (remove towers & in-flight projectiles to isolate shatter damage)
    simB.players[0].towers = [];
    simB.players[0].projectiles = [];
    const byBefore = bystander.hp;
    const bossBefore = bossBystander.hp;
    victim.hp = 0;
    const evs = simB.step();
    assert.ok(evs.some((e) => e.type === 'brittle_shatter'));
    assert.ok(Math.abs((byBefore - bystander.hp) - 96) < 1e-6);
    assert.ok(Math.abs((bossBefore - bossBystander.hp) - 96) < 1e-6);

    // Test Boss cap 120 using a 2000 maxHp brittle creep (12% = 240 -> capped 120 on Boss)
    const bigVictim = simB._spawnCreep(simB.players[0], { type: 'giant_cake', hpScale: 2.5, speedScale: 0, isSent: false }); // maxHp 2000
    bigVictim.progress = 80 / simB.mapDef.totalPathLength;
    bigVictim.x = pos.x + 20;
    bigVictim.y = pos.y;
    bigVictim.brittleMark = true;
    const boss2Before = bossBystander.hp;
    bigVictim.hp = 0;
    simB.step();
    assert.ok(Math.abs((boss2Before - bossBystander.hp) - 120) < 1e-6);
  }

  // 5. Popcorn-A (caramel_lava) DoT bypasses shields at 50% & max 2 pools; Popcorn-B (pop_rocks) 4 bounces
  {
    const sim = new GameSimulation({ seed: 42 });
    sim.nextWaveTick = 99999;
    sim.grantResources({ targetSlot: 0, gold: 4000 });
    const pA = sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'popcorn', col: 2, row: 1 });
    sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: pA.towerId });
    sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: pA.towerId, branch: 'A' });

    const pos = cellToPixel(2, 2);
    // Add 3 overlapping lava zones directly and test shield creep vs unshielded creep
    for (let i = 0; i < 3; i++) {
      sim.players[0].lavaZones.push({ id: 900 + i, x: pos.x, y: pos.y, radius: 72, remainTicks: 70, towerBuff: null });
    }
    const shielded = sim._spawnCreep(sim.players[0], { type: 'shield_choco', hpScale: 1, speedScale: 0, isSent: true });
    shielded.progress = 120 / sim.mapDef.totalPathLength;
    shielded.x = pos.x;
    shielded.y = pos.y;
    const unshielded = sim._spawnCreep(sim.players[0], { type: 'jelly', hpScale: 10, speedScale: 0, isSent: false });
    unshielded.progress = 120 / sim.mapDef.totalPathLength;
    unshielded.x = pos.x;
    unshielded.y = pos.y;

    // Remove tower so only lava DoT hits
    sim.players[0].towers = [];
    const sBefore = shielded.hp;
    const uBefore = unshielded.hp;
    // Step 5 ticks -> triggers 1 lava tick (tick=5): max 2 pools * 6 = 12 for unshielded; 12 * 0.5 = 6 for shielded without losing shield!
    for (let i = 0; i < 5; i++) sim.step();
    assert.equal(shielded.shieldHits, 8, 'Lava DoT must NOT consume shields');
    assert.ok(Math.abs((sBefore - shielded.hp) - 6) < 1e-6);
    assert.ok(Math.abs((uBefore - unshielded.hp) - 12) < 1e-6);

    // Popcorn-B spawns 4 secondary projectiles
    const simB = new GameSimulation({ seed: 42 });
    simB.nextWaveTick = 99999;
    simB.grantResources({ targetSlot: 0, gold: 4000 });
    const pB = simB.applyPlayerAction(0, { type: 'place_tower', towerType: 'popcorn', col: 2, row: 1 });
    simB.applyPlayerAction(0, { type: 'upgrade_tower', towerId: pB.towerId });
    simB.applyPlayerAction(0, { type: 'upgrade_tower', towerId: pB.towerId, branch: 'B' });
    const target = simB._spawnCreep(simB.players[0], { type: 'jelly', hpScale: 10, speedScale: 0, isSent: false });
    target.progress = 120 / simB.mapDef.totalPathLength;
    target.x = pos.x;
    target.y = pos.y;
    let sawBounces = false;
    for (let i = 0; i < 20; i++) {
      simB.step();
      if (simB.players[0].projectiles.filter((p) => p.isSecondary).length === 4) {
        sawBounces = true;
        break;
      }
    }
    assert.equal(sawBounces, true, 'Popcorn-B must spawn 4 secondary pop rocks');
  }

  // 6. Lemon-A (rail_beam) pierces 3 extra targets (85/70/55%); Lemon-B (executioner) +25% Boss/Elite & <30% 1.75x execute
  {
    const simA = new GameSimulation({ seed: 42 });
    simA.nextWaveTick = 99999;
    simA.grantResources({ targetSlot: 0, gold: 4000 });
    const lA = simA.applyPlayerAction(0, { type: 'place_tower', towerType: 'lemon', col: 4, row: 1 });
    simA.applyPlayerAction(0, { type: 'upgrade_tower', towerId: lA.towerId });
    simA.applyPlayerAction(0, { type: 'upgrade_tower', towerId: lA.towerId, branch: 'A' });

    const primary = simA._spawnCreep(simA.players[0], { type: 'jelly', hpScale: 30, speedScale: 0, isSent: false });
    primary.progress = 240 / simA.mapDef.totalPathLength; // (4,2) directly below (4,1)
    const p42 = cellToPixel(4, 2);
    primary.x = p42.x;
    primary.y = p42.y;

    const extras = [1, 2, 3].map((k) => {
      const distAlong = 240 + k * 45;
      const c = simA._spawnCreep(simA.players[0], { type: 'jelly', hpScale: 20, speedScale: 0, isSent: false });
      c.progress = distAlong / simA.mapDef.totalPathLength;
      c.x = p42.x;
      c.y = p42.y + k * 45; // along vertical segment (4,2)->(4,6)
      return c;
    });
    const beforeExtras = extras.map((e) => e.hp);
    simA.step();
    assert.ok(Math.abs((primary.maxHp - primary.hp) - 175) < 1e-6);
    const mults = [0.85, 0.70, 0.55];
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs((beforeExtras[i] - extras[i].hp) - 175 * mults[i]) < 1e-6);
    }

    // Lemon-B Executioner
    const simB = new GameSimulation({ seed: 42 });
    simB.nextWaveTick = 99999;
    simB.grantResources({ targetSlot: 0, gold: 4000 });
    const lB = simB.applyPlayerAction(0, { type: 'place_tower', towerType: 'lemon', col: 4, row: 1 });
    simB.applyPlayerAction(0, { type: 'upgrade_tower', towerId: lB.towerId });
    simB.applyPlayerAction(0, { type: 'upgrade_tower', towerId: lB.towerId, branch: 'B' });

    const boss = simB._spawnCreep(simB.players[0], { type: 'giant_cake', hpScale: 10, speedScale: 0, isSent: false }); // armored + isBoss
    boss.progress = 240 / simB.mapDef.totalPathLength;
    boss.x = p42.x;
    boss.y = p42.y;
    const fullBefore = boss.hp;
    const ev1 = simB.step();
    // 190 * 1.9 (armored) * 1.25 (boss) = 451.25
    assert.ok(Math.abs((fullBefore - boss.hp) - 190 * 1.9 * 1.25) < 1e-6);
    assert.equal(ev1.some((e) => e.type === 'execute_hit'), false);

    // Drop HP below 30% and wait for next shot -> 1.75x execute!
    boss.hp = boss.maxHp * 0.25;
    const lowBefore = boss.hp;
    let executed = false;
    for (let i = 0; i < 35; i++) {
      const evs = simB.step();
      if (evs.some((e) => e.type === 'execute_hit')) {
        executed = true;
        break;
      }
    }
    assert.equal(executed, true);
    assert.ok(Math.abs((lowBefore - boss.hp) - 190 * 1.9 * 1.25 * 1.75) < 1e-6);
  }
});

test('AC-04: 5 Dark/Neon Raid Forces, wave-synced HP, $0 bounty, shield/CC/healer/titan mechanics & no feint', () => {
  assert.deepEqual(SEND_ORDER, ['raid_swarm', 'raid_dash', 'raid_shield', 'express_healer', 'express_titan']);
  assert.equal('express_feint' in SEND_DEFS, false);

  const sim = new GameSimulation({ seed: 42 });
  sim.nextWaveTick = 99999;
  sim.grantResources({ targetSlot: 0, gold: 5000 });

  // Old express_feint must be rejected
  assert.equal(sim.applyPlayerAction(0, { type: 'send_wave', sendType: 'express_feint' }).code, 'INVALID_SEND_TYPE');

  // Wave 10 HP scaling check on raid_swarm (dark_pop base 44 * W10 scale 1.838)
  sim.jumpWave(10);
  const w10Scale = getWaveConfig(10).hpScale;
  assert.equal(w10Scale, 1.838);
  assert.equal(sim.applyPlayerAction(0, { type: 'send_wave', sendType: 'raid_swarm' }).ok, true);
  sim.step();
  const darkPop = sim.players[1].creeps.find((c) => c.type === 'dark_pop');
  assert.ok(darkPop);
  assert.ok(Math.abs(darkPop.maxHp - 44 * 1.838) < 1e-6);
  assert.equal(darkPop.bounty, 0, 'Sent dark creeps must have $0 bounty');

  // Verify $0 bounty when killed
  const p1GoldBefore = sim.players[1].gold;
  darkPop.hp = 0;
  sim.step();
  assert.equal(sim.players[1].gold, p1GoldBefore);

  // Express queue limit (max 2 pending) & 2A sendType visibility for defender
  const r1 = sim.applyPlayerAction(0, { type: 'send_wave', sendType: 'express_healer' });
  const r2 = sim.applyPlayerAction(0, { type: 'send_wave', sendType: 'express_titan' });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  // Reset cooldown to test queue full
  sim.players[0].sendCooldowns.express_healer = 0;
  const goldBeforeFull = sim.players[0].gold;
  const r3 = sim.applyPlayerAction(0, { type: 'send_wave', sendType: 'express_healer' });
  assert.equal(r3.code, 'EXPRESS_QUEUE_FULL');
  assert.equal(sim.players[0].gold, goldBeforeFull);

  const defSnap = sim.getClientSnapshot(1);
  assert.equal(defSnap.self.incomingAlerts.length, 2);
  assert.equal(defSnap.self.incomingAlerts[0].sendType, 'express_healer');
  assert.equal(defSnap.self.incomingAlerts[1].sendType, 'express_titan');

  // Neon dasher: immune to slow & freeze for progress < 0.30, 50% slowResist at >= 0.30
  const simMech = new GameSimulation({ seed: 42 });
  simMech.nextWaveTick = 99999;
  const dasher = simMech._spawnCreep(simMech.players[0], { type: 'neon_dasher', hpScale: 1, speedScale: 1, isSent: true });
  dasher.progress = 0.15;
  const mintLv1 = getTowerLevelDef('mint', 1);
  simMech._applyDamageToCreep(simMech.players[0], 'mint', mintLv1, dasher, 6);
  assert.equal(dasher.slowTicks, 0, 'Neon dasher immune to slow before 0.30 progress');
  dasher.progress = 0.35;
  simMech._applyDamageToCreep(simMech.players[0], 'mint', mintLv1, dasher, 6);
  assert.ok(dasher.slowTicks > 0);
  assert.ok(Math.abs(dasher.slowPct - 0.16) < 1e-6, 'Neon dasher slowPct halved from 0.32 to 0.16');

  // Shield choco: 8 shield hits intercept discrete damage (0 HP lost until shields = 0)
  const shieldChoco = simMech._spawnCreep(simMech.players[0], { type: 'shield_choco', hpScale: 1, speedScale: 0, isSent: true });
  const lemonLv1 = getTowerLevelDef('lemon', 1);
  for (let i = 0; i < 8; i++) {
    const res = simMech._applyDamageToCreep(simMech.players[0], 'lemon', lemonLv1, shieldChoco, lemonLv1.damage);
    assert.equal(res.shielded, true);
    assert.equal(shieldChoco.hp, shieldChoco.maxHp);
  }
  assert.equal(shieldChoco.shieldHits, 0);
  const resBreak = simMech._applyDamageToCreep(simMech.players[0], 'lemon', lemonLv1, shieldChoco, lemonLv1.damage);
  assert.equal(resBreak.shielded, false);
  assert.ok(shieldChoco.hp < shieldChoco.maxHp);

  // Dark healer: heals self (6%), natural jelly (6%), and other Boss (3%) within 135px every 20 ticks
  const simHeal = new GameSimulation({ seed: 42 });
  simHeal.nextWaveTick = 99999;
  const healer = simHeal._spawnCreep(simHeal.players[0], { type: 'dark_healer', hpScale: 1, speedScale: 0, isSent: true });
  const allyNat = simHeal._spawnCreep(simHeal.players[0], { type: 'jelly', hpScale: 10, speedScale: 0, isSent: false });
  const allyBoss = simHeal._spawnCreep(simHeal.players[0], { type: 'iron_titan', hpScale: 1, speedScale: 0, isSent: true });
  allyNat.x = healer.x + 50;
  allyNat.y = healer.y;
  allyBoss.x = healer.x - 50;
  allyBoss.y = healer.y;
  healer.hp = healer.maxHp * 0.5;
  allyNat.hp = allyNat.maxHp * 0.5;
  allyBoss.hp = allyBoss.maxHp * 0.5;

  for (let i = 0; i < 20; i++) simHeal.step();
  assert.ok(Math.abs(healer.hp - healer.maxHp * 0.56) < 1e-6);
  assert.ok(Math.abs(allyNat.hp - allyNat.maxHp * 0.56) < 1e-6);
  assert.ok(Math.abs(allyBoss.hp - allyBoss.maxHp * 0.53) < 1e-6);

  // Iron titan: heavyArmor 0.5x, 6 shields, slowResist 0.5
  const titan = simMech._spawnCreep(simMech.players[0], { type: 'iron_titan', hpScale: 1, speedScale: 0, isSent: true });
  assert.equal(titan.heavyArmor, true);
  assert.equal(titan.shieldHits, 6);
  assert.equal(titan.slowResist, 0.5);
  assert.ok(Math.abs(simMech._computeDamage('popcorn', getTowerLevelDef('popcorn', 1), titan, 100) - 50) < 1e-6);
});

test('AC-05: Smooth W1-W15 EHP monotonic (+22%..+28%), W10/W15 Bosses & W16+ gentle overtime', () => {
  function calcWaveEhp(w) {
    const cfg = getWaveConfig(w);
    let totalEhp = 0;
    for (const g of cfg.groups) {
      const def = CREEP_DEFS[g.type];
      const ehpPerUnit = def.hp * cfg.hpScale * (def.armored ? 1.4 : 1.0);
      totalEhp += g.count * ehpPerUnit;
    }
    return totalEhp;
  }

  let prevEhp = calcWaveEhp(1);
  for (let w = 2; w <= MAX_MAIN_WAVES; w++) {
    const ehp = calcWaveEhp(w);
    const growthPct = ((ehp - prevEhp) / prevEhp) * 100;
    assert.ok(
      growthPct >= 22.0 && growthPct <= 28.0,
      `Wave ${w} EHP growth ${growthPct.toFixed(2)}% outside [22.0%, 28.0%]`
    );
    prevEhp = ehp;
  }

  // W10 first boss & W15 dual boss
  assert.equal(getWaveConfig(10).groups.some((g) => g.type === 'giant_cake' && g.count === 1), true);
  assert.equal(getWaveConfig(15).groups.some((g) => g.type === 'giant_cake' && g.count === 2), true);

  // W16+ overtime scaling & interval contraction 20s -> 18s -> 16s
  const w16 = getWaveConfig(16);
  const w17 = getWaveConfig(17);
  const w18 = getWaveConfig(18);
  assert.equal(w16.isOvertime, true);
  assert.ok(Math.abs(w16.hpScale - 2.579 * 1.2) < 1e-6);
  assert.ok(Math.abs(w17.hpScale - 2.579 * Math.pow(1.2, 2)) < 1e-6);
  assert.ok(Math.abs(w18.hpScale - 2.579 * Math.pow(1.2, 3)) < 1e-6);
  assert.equal(getWaveIntervalTicks(14), 440);
  assert.equal(getWaveIntervalTicks(15), 400);
  assert.equal(getWaveIntervalTicks(16), 360);
  assert.equal(getWaveIntervalTicks(17), 320);
});

test('AC-07: Obstacle demolition ($60), 4 buff tile effects, $0 bounty on dark creeps, and buff persists after sell', () => {
  const sim = new GameSimulation({ seed: 42, mapId: 'classic_s' });
  sim.nextWaveTick = 99999;

  // Classic_s obstacles: [3,4] range, [6,3] rate, [11,4] damage, [15,3] bounty
  // Not enough gold ($50 < $60)
  sim.grantResources({ targetSlot: 0, gold: 50 });
  assert.equal(sim.applyPlayerAction(0, { type: 'demolish_obstacle', col: 3, row: 4 }).code, 'INSUFFICIENT_GOLD');
  assert.equal(sim.applyPlayerAction(0, { type: 'demolish_obstacle', col: 0, row: 0 }).code, 'INVALID_OBSTACLE');

  sim.grantResources({ targetSlot: 0, gold: 3000 });
  const d1 = sim.applyPlayerAction(0, { type: 'demolish_obstacle', col: 3, row: 4 });
  assert.equal(d1.ok, true);
  assert.equal(d1.buff, 'range');
  assert.equal(sim.players[0].gold, 3000 - DEMOLISH_COST);

  // Duplicate demolish fails; P2 board unaffected
  assert.equal(sim.applyPlayerAction(0, { type: 'demolish_obstacle', col: 3, row: 4 }).code, 'OBSTACLE_ALREADY_CLEARED');
  assert.equal(sim.players[1].clearedObstacles.size, 0);
  assert.equal(isBuildableCell('classic_s', 3, 4, sim.players[1].clearedObstacles), false);

  // Demolish other 3 obstacles
  sim.applyPlayerAction(0, { type: 'demolish_obstacle', col: 6, row: 3 }); // rate
  sim.applyPlayerAction(0, { type: 'demolish_obstacle', col: 11, row: 4 }); // damage
  sim.applyPlayerAction(0, { type: 'demolish_obstacle', col: 15, row: 3 }); // bounty

  // Place towers on all 4 buff tiles
  const tRange = sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'strawberry', col: 3, row: 4 });
  const tRate = sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'strawberry', col: 6, row: 3 });
  const tDmg = sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'lemon', col: 11, row: 4 });
  const tBounty = sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'lemon', col: 15, row: 3 });

  assert.equal(tRange.buffTile, 'range');
  assert.equal(tRate.buffTile, 'rate');
  assert.equal(tDmg.buffTile, 'damage');
  assert.equal(tBounty.buffTile, 'bounty');

  const towerRange = sim.players[0].towers.find((t) => t.id === tRange.towerId);
  const towerRate = sim.players[0].towers.find((t) => t.id === tRate.towerId);
  const sbLv1 = getTowerLevelDef('strawberry', 1);
  const effRange = sim._getEffectiveTowerStats(towerRange, sbLv1);
  const effRate = sim._getEffectiveTowerStats(towerRate, sbLv1);
  assert.ok(Math.abs(effRange.range - 150 * 1.2) < 1e-6);
  assert.ok(Math.abs(effRate.rate - 2.6 * 1.2) < 1e-6);

  // Damage buff tile x1.15
  const jelly = sim._spawnCreep(sim.players[0], { type: 'jelly', hpScale: 10, speedScale: 0, isSent: false });
  const posDmg = cellToPixel(11, 4);
  jelly.x = posDmg.x;
  jelly.y = posDmg.y;
  const jBefore = jelly.hp;
  sim._applyDamageToCreep(sim.players[0], 'lemon', getTowerLevelDef('lemon', 1), jelly, 68, { tileDmgMult: 1.15 });
  assert.ok(Math.abs((jBefore - jelly.hp) - 68 * 1.15) < 1e-6);

  // Bounty tile +$3 on natural kill, +$0 on dark sent kill
  const natVictim = sim._spawnCreep(sim.players[0], { type: 'jelly', hpScale: 1, speedScale: 0, isSent: false });
  natVictim.hp = 10;
  const darkVictim = sim._spawnCreep(sim.players[0], { type: 'dark_pop', hpScale: 1, speedScale: 0, isSent: true });
  darkVictim.hp = 10;
  const goldBeforeKill = sim.players[0].gold;
  sim._applyDamageToCreep(sim.players[0], 'lemon', getTowerLevelDef('lemon', 1), natVictim, 68, { towerBuff: 'bounty' });
  sim._applyDamageToCreep(sim.players[0], 'lemon', getTowerLevelDef('lemon', 1), darkVictim, 68, { towerBuff: 'bounty' });
  sim._cleanupDeadCreeps(sim.players[0]);
  assert.equal(sim.players[0].gold, goldBeforeKill + CREEP_DEFS.jelly.naturalBounty + 3 + 0);

  // Sell tower on buff tile -> buff tile persists for next tower
  sim.applyPlayerAction(0, { type: 'sell_tower', towerId: tRange.towerId });
  assert.equal(sim.players[0].clearedObstacles.has(cellKey(3, 4)), true);
  const rebuilt = sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'mint', col: 3, row: 4 });
  assert.equal(rebuilt.ok, true);
  assert.equal(rebuilt.buffTile, 'range');
});

test('Eco 120-tick payout ledger works cleanly with $190 start', () => {
  const sim = new GameSimulation({ seed: 42 });
  sim.nextWaveTick = 99999;
  for (let i = 0; i < ECO_PERIOD_TICKS - 1; i++) sim.step();
  assert.equal(sim.players[0].gold, INITIAL_GOLD);
  sim.step();
  assert.equal(sim.players[0].gold, INITIAL_GOLD + INITIAL_ECO);
});

test('AC-06 (AI Matrix): CandyAIBot builds >=2 legal towers and increases Eco on all 8 maps (400 ticks)', () => {
  for (const mapId of MAP_ORDER) {
    const sim = new GameSimulation({ seed: 42, mapId });
    const ai = new CandyAIBot('clever', mapId);
    for (let t = 0; t < 400; t++) {
      ai.onTick(sim, 1);
      sim.step();
    }
    const aiPlayer = sim.players[1];
    assert.ok(aiPlayer.towers.length >= 2, `${mapId}: AI built only ${aiPlayer.towers.length} towers`);
    assert.ok(aiPlayer.eco > INITIAL_ECO, `${mapId}: AI eco did not increase (${aiPlayer.eco})`);
    for (const tw of aiPlayer.towers) {
      assert.equal(isBuildableCell(mapId, tw.col, tw.row, aiPlayer.clearedObstacles), true, `${mapId}: illegal AI tower cell (${tw.col},${tw.row})`);
    }
  }
});

test('V2.1 AC-06: Dual-side W20 stress (25 Lv3 towers + 80 creeps per side, 200 ticks) meets avg <= 4ms & P95 <= 8ms', () => {
  const sim = new GameSimulation({ seed: 42, mapId: 'classic_s' });
  sim.nextWaveTick = 99999;
  sim.grantResources({ targetSlot: 0, hp: 5000, gold: 10000 });
  sim.grantResources({ targetSlot: 1, hp: 5000, gold: 10000 });

  const stressInfo = sim.spawnStress({ towers: 25, creeps: 80, bothSides: true });
  assert.equal(stressInfo.placedTowers, 25);
  assert.equal(stressInfo.spawnedCreeps, 80);
  assert.equal(stressInfo.oppPlacedTowers, 25);
  assert.equal(stressInfo.oppSpawnedCreeps, 80);
  assert.equal(sim.players[0].towers.length, 25);
  assert.equal(sim.players[1].towers.length, 25);

  const durations = [];
  for (let i = 0; i < 200; i++) {
    // Keep creeps alive if depleted so pressure remains realistic across 200 ticks
    if (sim.players[0].creeps.length < 40) {
      sim._spawnCreep(sim.players[0], { type: 'iron_titan', hpScale: 3, speedScale: 1, isSent: true });
    }
    if (sim.players[1].creeps.length < 40) {
      sim._spawnCreep(sim.players[1], { type: 'iron_titan', hpScale: 3, speedScale: 1, isSent: true });
    }
    const t0 = performance.now();
    sim.step();
    durations.push(performance.now() - t0);
  }

  const avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
  const sorted = [...durations].sort((a, b) => a - b);
  const p95Ms = sorted[Math.floor(sorted.length * 0.95)];
  console.log(`[AC-06] 200 ticks dual-side stress: avg=${avgMs.toFixed(3)}ms, p95=${p95Ms.toFixed(3)}ms`);
  assert.ok(avgMs <= 4, `Expected avgMs <= 4ms, got ${avgMs.toFixed(3)}ms`);
  assert.ok(p95Ms <= 8, `Expected p95Ms <= 8ms, got ${p95Ms.toFixed(3)}ms`);
});
