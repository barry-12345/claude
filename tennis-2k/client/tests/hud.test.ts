import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialScoreState, createMatchState } from '@court2k/shared';
import { formatPostMatchScoreSummary, HudView, KEY_POINT_LABELS } from '../src/ui/HudView.js';

class MockClassList {
  private set = new Set<string>();
  add(...names: string[]): void {
    names.forEach((n) => this.set.add(n));
  }
  remove(...names: string[]): void {
    names.forEach((n) => this.set.delete(n));
  }
  toggle(name: string, force?: boolean): boolean {
    if (force === true) {
      this.set.add(name);
      return true;
    }
    if (force === false) {
      this.set.delete(name);
      return false;
    }
    if (this.set.has(name)) {
      this.set.delete(name);
      return false;
    }
    this.set.add(name);
    return true;
  }
  contains(name: string): boolean {
    return this.set.has(name);
  }
}

class MockElement {
  public id = '';
  public type = '';
  public textContent = '';
  public onclick: (() => void) | null = null;
  public children: MockElement[] = [];
  public classList = new MockClassList();
  private _className = '';
  public innerHTML = '';

  constructor(public readonly tagName: string) {}

  get className(): string {
    return this._className;
  }

  set className(val: string) {
    this._className = val;
    this.classList = new MockClassList();
    val
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => this.classList.add(c));
  }

  appendChild(child: MockElement): MockElement {
    this.children.push(child);
    return child;
  }

  querySelector(): MockElement {
    return new MockElement('button');
  }

  remove(): void {}

  collectHtml(): string {
    return [this.innerHTML, this.textContent, ...this.children.map((c) => c.collectHtml())].join('\n');
  }
}

describe('V2 HudView & Post-match score summary formatting', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('renders SUPER_TIEBREAK banner, V2 bottom hint without Takeover, and CLEAN 甜点率 in post-match table', () => {
    vi.stubGlobal('document', {
      createElement: (tag: string) => new MockElement(tag),
    });

    expect(KEY_POINT_LABELS.SUPER_TIEBREAK).toBe('SUPER TIEBREAK · 超级抢十');

    const root = new MockElement('div');
    const hud = new HudView(
      root as unknown as HTMLElement,
      {
        onToggleMute: () => {},
        onRequestPause: () => {},
        onRequestResume: () => {},
        onRequestRematch: () => {},
        onExitToLobby: () => {},
      },
      false
    );
    hud.setMatchVisible(true);

    const state = createMatchState({
      mode: 'single',
      court: 'hard',
      format: 'super_tiebreak',
      archetypes: ['allcourt', 'defender'],
      aiDifficulty: 'rookie',
      seed: 42,
    });
    state.players[0].stance.armedAction = 'K';

    hud.updateMatchHud(state, 0, false, [false, false], 'normal');
    const activeHtml = root.collectHtml();
    expect(activeHtml).toContain('SUPER TIEBREAK · 超级抢十');
    expect(activeHtml).toContain('WASD/方向键');
    expect(activeHtml).toContain('不按键放球');
    expect(activeHtml).not.toMatch(/takeover|火热|绿条/i);

    // Match over stats table must show CLEAN 甜点率 (not Perfect 绿条率)
    state.phase = 'match_over';
    state.score.winner = 0;
    state.score.points = [10, 6];
    state.stats[0].cleanShots = 15;
    state.stats[0].totalShots = 20;
    state.stats[1].cleanShots = 8;
    state.stats[1].totalShots = 20;

    hud.updateMatchHud(state, 0, false, [false, false], 'normal');
    const postHtml = root.collectHtml();
    expect(postHtml).toContain('CLEAN 甜点率');
    expect(postHtml).toContain('75%');
    expect(postHtml).toContain('40%');
    expect(postHtml).not.toContain('Perfect');
    expect(postHtml).not.toContain('绿条');
  });
});
