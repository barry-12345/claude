import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../server/simulation.js';
import {
  CREEP_DEFS,
  ECO_PERIOD_TICKS,
  INITIAL_ECO,
  INITIAL_GOLD,
  INITIAL_HP,
  PATH_CELL_SET,
  OBSTACLE_MAP,
  TOWER_DEFS,
  TOTAL_PATH_LENGTH,
  cellToPixel,
  isBuildableCell
} from '../public/js/shared/constants.js';

test('Map geometry & buildable grid invariants', () => {
  assert.equal(TOTAL_PATH_LENGTH, 1748);
  assert.equal(PATH_CELL_SET.size, 31);
  assert.equal(OBSTACLE_MAP.size, 4);

  let buildableCount = 0;
  for (let c = 0; c < 18; c++) {
    for (let r = 0; r < 9; r++) {
      if (isBuildableCell(c, r)) buildableCount++;
    }
  }
  assert.equal(buildableCount, 127);

  // Path & obstacle cells must reject tower placement
  const sim = new GameSimulation({ seed: 42 });
  assert.equal(sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'strawberry', col: 0, row: 2 }).code, 'INVALID_CELL');
  assert.equal(sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'strawberry', col: 1, row: 6 }).code, 'INVALID_CELL');
  assert.equal(sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'strawberry', col: -1, row: 0 }).code, 'INVALID_CELL');
});

test('AC-04: Tower place, upgrade Lv1->Lv3, 70% sell refund & targeting', () => {
  const sim = new GameSimulation({ seed: 42 });
  sim.grantResources({ targetSlot: 0, gold: 320 });

  // Place strawberry ($80) at valid cell (3,3)
  const r1 = sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'strawberry', col: 3, row: 3 });
  assert.equal(r1.ok, true);
  assert.equal(sim.players[0].gold, 240);

  // Duplicate cell rejected
  const dup = sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'mint', col: 3, row: 3 });
  assert.equal(dup.code, 'CELL_OCCUPIED');

  // Insufficient gold for lemon ($190 -> gold 240 ok, wait test with $100)
  sim.grantResources({ targetSlot: 0, gold: 100 });
  const poor = sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'lemon', col: 5, row: 3 });
  assert.equal(poor.code, 'INSUFFICIENT_GOLD');
  assert.equal(sim.players[0].gold, 100);

  // Upgrade strawberry Lv1 -> Lv2 (+75) -> Lv3 (+140) => total invested 295
  sim.grantResources({ targetSlot: 0, gold: 500 });
  assert.equal(sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: r1.towerId }).level, 2);
  assert.equal(sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: r1.towerId }).level, 3);
  assert.equal(sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: r1.towerId }).code, 'MAX_LEVEL');
  assert.equal(sim.players[0].towers[0].invested, 295);

  // Change targeting
  assert.equal(sim.applyPlayerAction(0, { type: 'set_targeting', towerId: r1.towerId, targeting: 'strong' }).ok, true);
  assert.equal(sim.players[0].towers[0].targeting, 'strong');

  // Sell Lv3 strawberry -> Math.round(295 * 0.7) = 207
  const beforeSell = sim.players[0].gold;
  const sellRes = sim.applyPlayerAction(0, { type: 'sell_tower', towerId: r1.towerId });
  assert.equal(sellRes.ok, true);
  assert.equal(sellRes.refund, 207);
  assert.equal(sim.players[0].gold, beforeSell + 207);
  assert.equal(sim.players[0].towers.length, 0);
});

test('AC-05: Deterministic combat math — Mint slow & Lv3 +15% vuln, Popcorn 0.6x armor & splash, Lemon 104/189 & Lv3 pierce', () => {
  // 1. Mint Lv1 slow 35%, Lv3 slow 55% & +15% vuln from other towers
  {
    const sim = new GameSimulation({ seed: 42 });
    sim.nextWaveTick = 99999; // isolate
    sim.grantResources({ targetSlot: 0, gold: 2000 });
    const mintRes = sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'mint', col: 1, row: 1 });
    const creep = sim._spawnCreep(sim.players[0], { type: 'jelly', hpScale: 10, speedScale: 1, isSent: false });
    const p1 = cellToPixel(1, 2);
    creep.progress = 60 / TOTAL_PATH_LENGTH;
    creep.x = p1.x;
    creep.y = p1.y;

    // Step until mint projectile hits
    for (let i = 0; i < 15; i++) sim.step();
    assert.equal(creep.slowPct, 0.35);
    assert.ok(creep.slowTicks > 0);

    // Upgrade mint to Lv3
    sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: mintRes.towerId });
    sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: mintRes.towerId });
    // Clear slowTicks and place strawberry to verify 1.15x vuln
    creep.slowTicks = 0;
    creep.slowPct = 0;
    for (let i = 0; i < 25; i++) sim.step();
    assert.equal(creep.slowPct, 0.55);
    assert.ok(creep.vulnTicks > 0);

    // Apply strawberry Lv1 base hit (12) through _computeDamage
    const sbLv1 = TOWER_DEFS.strawberry.levels[0];
    const dmgWithVuln = sim._computeDamage('strawberry', sbLv1, creep, sbLv1.damage);
    assert.ok(Math.abs(dmgWithVuln - 12 * 1.15) < 1e-6);
  }

  // 2. Popcorn full splash on 5 clustered jelly creeps & 0.6x on toffee
  {
    const sim = new GameSimulation({ seed: 42 });
    sim.nextWaveTick = 99999;
    sim.grantResources({ targetSlot: 0, gold: 1000 });
    sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'popcorn', col: 2, row: 1 });

    const jellies = [];
    for (let i = 0; i < 5; i++) {
      const c = sim._spawnCreep(sim.players[0], { type: 'jelly', hpScale: 2, speedScale: 0, isSent: false });
      c.progress = (120 + i * 2) / TOTAL_PATH_LENGTH;
      const pos = cellToPixel(2, 2);
      c.x = pos.x + i * 2;
      c.y = pos.y;
      jellies.push(c);
    }
    const toffee = sim._spawnCreep(sim.players[0], { type: 'toffee', hpScale: 1, speedScale: 0, isSent: false });
    toffee.progress = 120 / TOTAL_PATH_LENGTH;
    const posT = cellToPixel(2, 2);
    toffee.x = posT.x;
    toffee.y = posT.y;

    for (let i = 0; i < 20; i++) sim.step();
    for (const j of jellies) {
      assert.ok(Math.abs((j.maxHp - j.hp) - 26) < 1e-6, `Expected 26 splash dmg, got ${j.maxHp - j.hp}`);
    }
    assert.ok(Math.abs((toffee.maxHp - toffee.hp) - 26 * 0.6) < 1e-6);
  }

  // 3. Lemon Lv1=104, Lv2=189 vs toffee, and Lv3 pierce 50%
  {
    const sim = new GameSimulation({ seed: 42 });
    sim.nextWaveTick = 99999;
    sim.grantResources({ targetSlot: 0, gold: 2000 });
    const lRes = sim.applyPlayerAction(0, { type: 'place_tower', towerType: 'lemon', col: 2, row: 1 });
    const t1 = sim._spawnCreep(sim.players[0], { type: 'toffee', hpScale: 10, speedScale: 0, isSent: false });
    t1.progress = 120 / TOTAL_PATH_LENGTH;
    const p2 = cellToPixel(2, 2);
    t1.x = p2.x;
    t1.y = p2.y;

    sim.step(); // tick 1 -> lemon fires immediately
    assert.ok(Math.abs((t1.maxHp - t1.hp) - 104) < 1e-6);

    // Upgrade to Lv2 and wait cooldown
    sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: lRes.towerId });
    const prevHp = t1.hp;
    for (let i = 0; i < 40; i++) sim.step();
    assert.ok(Math.abs((prevHp - t1.hp) - 189) < 1e-6);

    // Upgrade to Lv3 and place 2nd target within 140px
    sim.applyPlayerAction(0, { type: 'upgrade_tower', towerId: lRes.towerId });
    const t2 = sim._spawnCreep(sim.players[0], { type: 'jelly', hpScale: 10, speedScale: 0, isSent: false });
    t2.x = t1.x + 30;
    t2.y = t1.y;
    t2.progress = t1.progress - 0.01;
    const t2Before = t2.hp;
    // Wait until lemon Lv3 fires
    for (let i = 0; i < 35; i++) sim.step();
    assert.ok(Math.abs((t2Before - t2.hp) - 175 * 0.5) < 1e-6);
  }
});

test('AC-06: Eco 120-tick payout ledger & low send bounty anti-feed', () => {
  const sim = new GameSimulation({ seed: 42 });
  sim.nextWaveTick = 99999;
  assert.equal(sim.players[0].gold, INITIAL_GOLD);
  assert.equal(sim.players[0].eco, INITIAL_ECO);

  // Tick 1..119: no eco payout yet
  for (let i = 0; i < 119; i++) sim.step();
  assert.equal(sim.players[0].gold, INITIAL_GOLD);

  // Tick 120: +25
  sim.step();
  assert.equal(sim.players[0].gold, INITIAL_GOLD + 25);

  // Send 4x jelly ($50, +5 eco -> eco becomes 30)
  const sendRes = sim.applyPlayerAction(0, { type: 'send_wave', sendType: 'send_jelly' });
  assert.equal(sendRes.ok, true);
  assert.equal(sim.players[0].eco, 30);
  assert.equal(sim.players[0].gold, INITIAL_GOLD + 25 - 50);

  // Tick 240: +30 eco payout
  for (let i = 0; i < 120; i++) sim.step();
  assert.equal(sim.players[0].gold, INITIAL_GOLD + 25 - 50 + 30);

  // Check opponent bounty for 4 sent jellies = 4 * 4 = $16 vs $50 cost (32%)
  assert.equal(CREEP_DEFS.jelly.sendBounty * 4, 16);
});

test('AC-07: Express 3s alert anti-leak & feint zero-damage + cooldown', () => {
  const sim = new GameSimulation({ seed: 42 });
  sim.nextWaveTick = 99999;
  sim.grantResources({ targetSlot: 0, gold: 1000 });

  // Send real express_party and feint express_feint
  const r1 = sim.applyPlayerAction(0, { type: 'send_wave', sendType: 'express_party' });
  const r2 = sim.applyPlayerAction(0, { type: 'send_wave', sendType: 'express_feint' });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);

  // 3rd express must fail with EXPRESS_QUEUE_FULL without deducting gold
  const goldAfterTwo = sim.players[0].gold;
  const r3 = sim.applyPlayerAction(0, { type: 'send_wave', sendType: 'express_boss' });
  assert.equal(r3.code, 'EXPRESS_QUEUE_FULL');
  assert.equal(sim.players[0].gold, goldAfterTwo);

  // Inspect defender client snapshot for all 59 ticks before arriveTick
  for (let t = 0; t < 59; t++) {
    const events = sim.step();
    const defSnap = sim.getClientSnapshot(1);
    assert.equal(defSnap.self.incomingAlerts.length, 2);
    for (const alert of defSnap.self.incomingAlerts) {
      assert.equal('isFake' in alert, false);
      assert.equal('sendType' in alert, false);
      assert.deepEqual(Object.keys(alert).sort(), ['arriveTick', 'id', 'totalTicks']);
    }
    for (const ev of events) {
      if (ev.viewerScope === 1) {
        assert.equal('isFake' in ev, false);
        assert.equal('sendType' in ev, false);
      }
    }
  }

  // Tick 60: both arrive!
  const arriveEvents = sim.step();
  assert.ok(arriveEvents.some((e) => e.type === 'express_arrived_real' && e.targetSlot === 1));
  assert.ok(arriveEvents.some((e) => e.type === 'express_arrived_feint' && e.targetSlot === 1));

  // Verify feint-only sends 0 creeps and deals 0 damage
  const simFeint = new GameSimulation({ seed: 99 });
  simFeint.nextWaveTick = 99999;
  simFeint.applyPlayerAction(0, { type: 'send_wave', sendType: 'express_feint' });
  assert.equal(simFeint.players[0].eco, INITIAL_ECO + 5);
  assert.equal(simFeint.players[0].gold, INITIAL_GOLD - 65);
  for (let t = 0; t < 300; t++) simFeint.step();
  assert.equal(simFeint.players[1].creeps.length, 0);
  assert.equal(simFeint.players[1].hp, INITIAL_HP);
});

test('AC-08: Wave 15 boss & Wave 16+ overtime scaling', () => {
  const sim = new GameSimulation({ seed: 42 });
  sim.jumpWave(15);
  for (let t = 0; t < 100; t++) sim.step();
  assert.ok(sim.players[0].creeps.some((c) => c.type === 'giant_cake'));

  sim.jumpWave(16);
  sim.step();
  assert.equal(sim.wave, 16);
  const otCreep = sim.players[0].creeps.find((c) => c.rainbow === true);
  assert.ok(otCreep, 'Overtime wave 16+ must spawn rainbow frenzied creeps');
  assert.ok(otCreep.speedScale > 1);
});
