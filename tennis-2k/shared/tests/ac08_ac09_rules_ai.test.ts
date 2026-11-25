import { describe, expect, it } from 'vitest';
import {
  COURT_DIM,
  applyScorePatch,
  awardPointToScore,
  computeAIInput,
  computeStatsSummary,
  createInitialScoreState,
  createMatchState,
  createRng,
  stepMatch,
  type AIDifficulty,
  type MatchState,
} from '../src/index.js';

function simulateHeadlessAIMatch(
  diff0: AIDifficulty,
  diff1: AIDifficulty,
  seed: number
): MatchState {
  let state = createMatchState({
    mode: 'single',
    court: 'hard',
    format: 'fast4',
    archetypes: ['allcourt', 'allcourt'],
    aiDifficulty: diff1,
    seed,
  });
  const rng = createRng(seed);
  const maxTicks = 60 * 600; // 10 min simulated max safety cap (Fast4 takes 5-8 min)

  for (let i = 0; i < maxTicks && state.phase !== 'match_over'; i++) {
    const in0 = computeAIInput(state, 0, diff0, rng);
    const in1 = computeAIInput(state, 1, diff1, rng);
    state = stepMatch(state, [in0, in1], COURT_DIM.FIXED_DT, rng).state;
  }
  return state;
}

describe('AC-08 & AC-09: Scoring State Machines, Stats & 3-Tier AI Benchmark', () => {
  it('verifies Fast4 gold point (40-40), 4-2 win, and 3-3 7-point tiebreak', () => {
    let score = createInitialScoreState('fast4');
    // Reach 40-40
    score = awardPointToScore(score, 0);
    score = awardPointToScore(score, 0);
    score = awardPointToScore(score, 0);
    score = awardPointToScore(score, 1);
    score = awardPointToScore(score, 1);
    score = awardPointToScore(score, 1);
    expect(score.isDecidingPoint).toBe(true);
    expect(score.keyPointLabel).toBe('DECIDING_POINT');

    // Next point wins game 1-0
    score = awardPointToScore(score, 0);
    expect(score.games).toEqual([1, 0]);
    expect(score.points).toEqual([0, 0]);
    expect(score.server).toBe(1);

    // 4-2 finish
    let s42 = createInitialScoreState('fast4');
    for (let g = 0; g < 3; g++) {
      for (let p = 0; p < 4; p++) s42 = awardPointToScore(s42, 0);
    }
    for (let g = 0; g < 2; g++) {
      for (let p = 0; p < 4; p++) s42 = awardPointToScore(s42, 1);
    }
    for (let p = 0; p < 3; p++) s42 = awardPointToScore(s42, 0);
    expect(s42.keyPointLabel).toBe('MATCH_POINT');
    s42 = awardPointToScore(s42, 0);
    expect(s42.games).toEqual([4, 2]);
    expect(s42.winner).toBe(0);

    // 3-3 tiebreak
    let tb = createInitialScoreState('fast4');
    for (let g = 0; g < 3; g++) {
      for (let p = 0; p < 4; p++) tb = awardPointToScore(tb, 0);
      for (let p = 0; p < 4; p++) tb = awardPointToScore(tb, 1);
    }
    expect(tb.games).toEqual([3, 3]);
    expect(tb.isTiebreak).toBe(true);
    expect(tb.keyPointLabel).toBe('TIEBREAK');

    // Serve rotation in tiebreak: P0 (0-0) -> P1 (1-0) -> P1 (1-1) -> P0 (2-1)
    expect(tb.server).toBe(0);
    tb = awardPointToScore(tb, 0);
    expect(tb.server).toBe(1);
    tb = awardPointToScore(tb, 1);
    expect(tb.server).toBe(1);
    tb = awardPointToScore(tb, 0);
    expect(tb.server).toBe(0);

    for (let p = 0; p < 5; p++) tb = awardPointToScore(tb, 0); // 7-1
    expect(tb.games).toEqual([4, 3]);
    expect(tb.winner).toBe(0);
  });

  it('verifies Super Tiebreak 9-9 -> 11-9 and break point / patch helpers', () => {
    let st = createInitialScoreState('super_tiebreak');
    for (let i = 0; i < 9; i++) {
      st = awardPointToScore(st, 0);
      st = awardPointToScore(st, 1);
    }
    expect(st.points).toEqual([9, 9]);
    expect(st.winner).toBeNull();
    st = awardPointToScore(st, 0);
    expect(st.keyPointLabel).toBe('MATCH_POINT');
    expect(st.winner).toBeNull();
    st = awardPointToScore(st, 0);
    expect(st.points).toEqual([11, 9]);
    expect(st.winner).toBe(0);

    // Stats summary handles zero denominators safely
    expect(
      computeStatsSummary({
        aces: 0,
        doubleFaults: 0,
        firstServesIn: 0,
        firstServesTotal: 0,
        winners: 0,
        unforcedErrors: 0,
        perfectShots: 0,
        totalMeterShots: 0,
      })
    ).toEqual({ firstServePct: 0, perfectPct: 0 });

    expect(
      computeStatsSummary({
        aces: 2,
        doubleFaults: 1,
        firstServesIn: 7,
        firstServesTotal: 10,
        winners: 5,
        unforcedErrors: 2,
        perfectShots: 9,
        totalMeterShots: 20,
      })
    ).toEqual({ firstServePct: 70, perfectPct: 45 });

    const base = createMatchState({
      mode: 'single',
      court: 'hard',
      format: 'fast4',
      archetypes: ['allcourt', 'allcourt'],
      aiDifficulty: 'rookie',
      seed: 1,
    });
    const patched = applyScorePatch(base, { points: [1, 3], server: 0 });
    expect(patched.score.keyPointLabel).toBe('BREAK_POINT');
    expect(patched.score.courtSide).toBe('deuce');

    // Regression: applyScorePatch from dirty hawkeye/rally/meter/slide state resets all transient fields
    const dirty = createMatchState({
      mode: 'single',
      court: 'hard',
      format: 'fast4',
      archetypes: ['allcourt', 'allcourt'],
      aiDifficulty: 'rookie',
      seed: 2,
    });
    dirty.phase = 'hawkeye';
    dirty.phaseTimer = 1.25;
    dirty.hawkeye.active = true;
    dirty.hawkeye.elapsedSec = 0.9;
    dirty.players[0].meter.active = true;
    dirty.players[0].meter.action = 'J';
    dirty.players[0].meter.progress = 0.6;
    dirty.players[1].isSliding = true;
    dirty.players[1].slideTimer = 0.2;
    dirty.ball.active = true;
    dirty.ball.bounces = 2;
    dirty.ball.firstBouncePos = { x: 2, y: COURT_DIM.BALL_RADIUS, z: -8 };
    dirty.ball.predictedLanding = { x: 2.1, y: COURT_DIM.BALL_RADIUS, z: -8.1 };
    dirty.ball.lastHitter = 0;

    const cleanPatched = applyScorePatch(dirty, { games: [3, 2], points: [3, 0], server: 1 });
    expect(cleanPatched.phase).toBe('serve_ready');
    expect(cleanPatched.phaseTimer).toBe(0);
    expect(cleanPatched.hawkeye.active).toBe(false);
    expect(cleanPatched.hawkeye.elapsedSec).toBe(0);
    expect(cleanPatched.players[0].meter.active).toBe(false);
    expect(cleanPatched.players[0].meter.progress).toBe(0);
    expect(cleanPatched.players[1].isSliding).toBe(false);
    expect(cleanPatched.ball.active).toBe(false);
    expect(cleanPatched.ball.bounces).toBe(0);
    expect(cleanPatched.ball.firstBouncePos).toBeNull();
    expect(cleanPatched.ball.predictedLanding).toBeNull();
    expect(cleanPatched.ball.lastHitter).toBeNull();
  });

  it('is 100% deterministic for identical seed', () => {
    const a = simulateHeadlessAIMatch('pro', 'rookie', 1234);
    const b = simulateHeadlessAIMatch('pro', 'rookie', 1234);
    expect(a.tick).toBe(b.tick);
    expect(a.score).toEqual(b.score);
    expect(a.stats).toEqual(b.stats);
  });

  it('satisfies AC-09 30-match win rate ladder and strictly decreasing UE rate', () => {
    let proWinsVsRookie = 0;
    let rookieUE = 0;
    let rookieShots = 0;
    let proUE1 = 0;
    let proShots1 = 0;

    for (let i = 0; i < 30; i++) {
      const m = simulateHeadlessAIMatch('pro', 'rookie', 1000 + i);
      expect(m.phase).toBe('match_over');
      if (m.score.winner === 0) proWinsVsRookie++;
      proUE1 += m.stats[0].unforcedErrors + m.stats[0].doubleFaults;
      proShots1 += m.stats[0].totalMeterShots;
      rookieUE += m.stats[1].unforcedErrors + m.stats[1].doubleFaults;
      rookieShots += m.stats[1].totalMeterShots;
    }

    let legendWinsVsPro = 0;
    let proUE2 = 0;
    let proShots2 = 0;
    let legendUE = 0;
    let legendShots = 0;

    for (let i = 0; i < 30; i++) {
      const m = simulateHeadlessAIMatch('legend', 'pro', 2000 + i);
      expect(m.phase).toBe('match_over');
      if (m.score.winner === 0) legendWinsVsPro++;
      legendUE += m.stats[0].unforcedErrors + m.stats[0].doubleFaults;
      legendShots += m.stats[0].totalMeterShots;
      proUE2 += m.stats[1].unforcedErrors + m.stats[1].doubleFaults;
      proShots2 += m.stats[1].totalMeterShots;
    }

    const proWinRate = proWinsVsRookie / 30;
    const legendWinRate = legendWinsVsPro / 30;
    const rookieUERate = rookieUE / Math.max(1, rookieShots);
    const proUERate = (proUE1 + proUE2) / Math.max(1, proShots1 + proShots2);
    const legendUERate = legendUE / Math.max(1, legendShots);

    console.info(
      `[AC-09 Benchmark] Pro vs Rookie: ${(proWinRate * 100).toFixed(1)}% (${proWinsVsRookie}/30) | Legend vs Pro: ${(legendWinRate * 100).toFixed(1)}% (${legendWinsVsPro}/30) | UE Rate: rookie=${(rookieUERate * 100).toFixed(2)}% (${rookieUE}/${rookieShots}), pro=${(proUERate * 100).toFixed(2)}% (${proUE1 + proUE2}/${proShots1 + proShots2}), legend=${(legendUERate * 100).toFixed(2)}% (${legendUE}/${legendShots})`
    );

    expect(proWinRate).toBeGreaterThanOrEqual(0.75);
    expect(legendWinRate).toBeGreaterThanOrEqual(0.7);
    expect(rookieUERate).toBeGreaterThan(proUERate);
    expect(proUERate).toBeGreaterThan(legendUERate);
  });
});
