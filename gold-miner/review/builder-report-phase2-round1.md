# Phase 2 builder report, round 1 (claims to verify)

The Builder claims SPEC-phase2.md is fully implemented. `node tests/run-all.js` runs 58/58 in about 840 s; `node tests/run-all.js phase2` runs only the AC-P2 checks.

## Setup
- `tests/baseline-phase1.html` is the accepted phase-1 copy.
- The phase-1 suite now runs under `?rules=1`.
- The only phase-1 test change is in AC-03. It now compares winner/cleared/victory, plus the per-round results, instead of the full `G.final`, because `G.final` gained `scores` and `version`.

## Implementation, as claimed
- **Rulesets:** `RULESETS {1, 2}` with current rules `R`. `RULE_VERSION` defaults to 2 and `?rules=1` selects legacy. `R` is fixed at `startGame`. `__game.setRules(v)` works only on the start screen.
- **Named constants:** `SOLO_TARGETS_V2`, `VERSUS_TARGETS_V2`, `COOP_TARGETS_V2` and `STAR_MULT_V2 = [1.0, 1.25]`, set to the spec's updated numbers.
- **Field and economy:** identical to phase 1, with equality checked in the tests. The legend override was removed.
- **Golden finale:**
  - triggers once when `G.time` first drops to `15 × ROUND_TIME / 60` or below (`G.finaleOn`);
  - shows a banner and a 0.3 screen shake;
  - spawns `FINALE_N` weighted items at `y ≥ 430` via `freeSpot`;
  - gold types get ×1.5 after gold rush and the appraisal book (`stats.finaleBonus`);
  - visuals: a golden HUD timer, a "尾声 ×1.5" tag and a blackout halo.
- **Feel pack** (rules 2 only):
  - hitStop of 0.06 for grabs with value ≥ 300 (`updatePlay` is skipped during it);
  - big-win effects at ≥ $500: zoom, aura, coin particles;
  - rolling money display;
  - heavy-rope jitter and creak;
  - "差一点!" near miss;
  - heartbeat and vignette in the last 10 s;
  - heavy-item landing shake;
  - cosmetic randomness all goes through `fxRand`, never `Math.random`;
  - the V key toggles reduce-fx, stored in localStorage as `goldminer.reduceFx`.
- **Shop:** prices rise +30% per round in all modes.
- **Fix a:** the solo shop needs a double ↑ (`armed`, `armT` 1.5 s); ←/→ cancels; S/↓ on the ready card starts immediately.
- **Fixes b and c:** `G.soloSaved[]` with a "金牌保住" cell; HUD captions read "收入≥$X" at ≤ 70 px wide.
- **Fix d:** round 1 has at most 2 `rock_b`; `worthClear` is used, with left and right halves counted separately in versus.
- **Final score:** `G.final.scores [{player, score, rounds, char}]` plus `version`, shown large on the final screens.
- **`VERSUS_END_ON_ELIM` constant:** defaults to false. Setting it true ends versus on the first elimination. This was NOT tested.
- **New hooks:** `RULESETS`, `R`, `RULE_VERSION`, `setRules`, `finaleCount`, `spawnFinale`, `worthClear`, `starGoal`, `freeSpot`, `reachable`, `isReduceFx`, `reduceFx`, `fxRand`, `placeItem`, `clearField`.

## Results per acceptance criterion, as claimed (rules 2, seeds 1–50)
- **AC-P2-01:** 60/60 games with rules 2 and rules 1, 0 errors.
- **AC-P2-02:** `?rules=1` matches `baseline-phase1.html` in 20/20 versus/co-op games and 10/10 solo games.
- **AC-P2-03:** the phase-1 suite passes under rules 1.
- **AC-P2-04:** hooks present.
- **AC-P2-05:**

  | Mode | Random | Spam | Skilled | Perfect | Other |
  |---|---|---|---|---|---|
  | Solo | 0% | 2% | 48% | 100% | 11.0 stars; round 1 100% |
  | Versus (per player, n = 100) | 0% | 14% (limit ≤ 20%; known deviation) | 49% | 95% | — |
  | Co-op | 0% | 2% | 50% | 100% | — |

- **AC-P2-06:** average rounds cleared are ordered correctly.
- **AC-P2-07:** reduce-fx on and off give identical results (10/10).
- **AC-P2-08:** an average of 3.95 finale items in round 4; across 38 levels, 0 items are above 430, overlapping, unreachable or double-triggered.
- **AC-P2-09:** multipliers are correct: 350 / 525 / 788 / 1576.
- **AC-P2-10:** the co-op split is 263 / 262.
- **AC-P2-11:** finale items are reachable by a lone survivor.
- **AC-P2-12:** hitStop works.
- **AC-P2-13:** economy values equal phase 1. The item-count range check is literally false because the worth top-up overshoots; this is the same as phase 1.
- **AC-P2-14:** shop prices are correct.
- **AC-P2-15:** the worth guarantee holds; round 1 has ≤ 2 `rock_b`.
- **AC-P2-16:** scores and version are correct.
- **AC-P2-17:** the solo shop double-confirm works with real keys.
- **AC-P2-18:** "金牌保住" displays correctly.
- **AC-P2-19:** caption max width is 67.4 px.
- **AC-P2-20:** the perfect bot passes round 1 100% of the time.
- **AC-P2-21:** full games with real keys in 3 modes, including a money-injection variant to reach round 8.
- **AC-P2-22:** the V toggle persists.
- **AC-P2-23:** the live finale was observed.
- **AC-P2-24:** 10 screenshots are in `screenshots/phase2/` and were reviewed.

## Known issues, as stated
- Versus spam clears 14% of the time.
- The solo skilled rate of 48% is close to the 45% lower bound.
- The AC-P2-13 item-count wording.
- The full test run takes about 14 minutes.
- New audio is unheard.
