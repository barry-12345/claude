import { describe, expect, it } from 'vitest';
import { createInitialScoreState } from '@court2k/shared';
import { formatPostMatchScoreSummary } from '../src/ui/HudView.js';

describe('Post-match score summary formatting', () => {
  it('formats super_tiebreak final score using tiebreak points (e.g. 11 - 9) instead of 1 - 0', () => {
    const score = createInitialScoreState('super_tiebreak');
    score.games = [1, 0];
    score.points = [11, 9];
    score.winner = 0;

    expect(formatPostMatchScoreSummary(score, 0)).toBe('11 - 9');
    expect(formatPostMatchScoreSummary(score, 1)).toBe('9 - 11');
  });

  it('formats fast4 regular and tiebreak final scores accurately', () => {
    const reg = createInitialScoreState('fast4');
    reg.games = [4, 2];
    reg.winner = 0;
    expect(formatPostMatchScoreSummary(reg, 0)).toBe('4 - 2');

    const tb = createInitialScoreState('fast4');
    tb.games = [4, 3];
    tb.points = [7, 5];
    tb.isTiebreak = true;
    tb.winner = 0;
    expect(formatPostMatchScoreSummary(tb, 0)).toBe('4 - 3 (7-5)');
  });
});
