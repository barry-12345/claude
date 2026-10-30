# Builder report, round 1 (to be verified, not taken as fact)

- Claim: all of SPEC.md is implemented, with no TODOs or placeholders. Edits are in place in /home/user/gold-miner/index.html.
- Claim: `node tests/run-all.js` passes 29/29 checks in about 272 s. Test groups: `node tests/run-all.js logic | keys | shots`.
- Claim: `tests/baseline.html` is an untouched copy of index.html from before any edits.

## Implementation, as claimed
- **Constants:**
  - `SOLO_TARGETS` uses the spec's standard values.
  - New: `STAR_MULT = [1.5, 2]`, `MENU_ORDER`, `SOLO_CFG` (x = 640, P1 keys), `STAR_DISCOUNT`, `SOLO_SHOP_N = 6`.
- **Seeding:** `?seed=N` sets `Math.random = mulberry(N)`.
- **Mode logic:** new `isSolo()`; `targets()` returns `SOLO_TARGETS` in solo; `starsFor` is a pure function; new state `G.stars`, `G.soloCum`, `G.liveStars`, `G.ghostRec`.
- **Regression safety:** the random 0.5 order draw in `updatePlay` happens only in versus and co-op. Solo iterates players directly. No `Math.random()` calls were added, removed or reordered on the versus/co-op paths.
- **Solo gameplay:**
  - one centred player;
  - level-generation worth factor 2.1;
  - the shield is excluded from the shop and from the dice;
  - live star float text ("★2!" / "★3!");
  - solo branches in `endRound`, `afterResults` and `finishGame`;
  - the best record is stored under the localStorage key `goldminer.soloBest`, compared by rounds cleared, then stars, then money.
- **Solo shop:**
  - fixed at 6 offers, with star discounts; 3 stars also gives +1 dynamite;
  - reroll price is `30 + 15 × round`, then +30 per reroll, multiplied by the discount and rounded to 5;
  - rerolls exclude buffs already bought and an owned medal;
  - card indices: 0–5 offers, 6 = reroll card (`rerollIdx`), 7 = ready.
- **Input:**
  - menu A/D and arrows move one card relatively, with no wraparound;
  - Digit1/2/3 and Numpad1/2/3 pick a mode directly;
  - in solo, arrows are normalised to WASD in select, play and shop;
  - the solo select screen uses only the first selection box.
- **Drawing:**
  - 3 menu cards, `RULES.solo`, single-column controls;
  - solo select screen;
  - solo HUD: left panel with a record flag, right panel with 3 stars and the "纪录同期" ghost value;
  - solo intro, results (stars stamp in one by one, delta against the record), centred single shop, final screen with an 8-cell per-round star bar and "新纪录!";
  - solo money float text moved to the left of the miner;
  - title and menu text changed to "单人 / 双人同屏".
- **Hooks:**
  - all 46 existing `__game` members are kept;
  - 13 new ones: `reseed(n)`, `startMode(mode, chars)`, `SOLO_TARGETS`, `STAR_MULT`, `MENU_ORDER`, `PIVOT_Y`, `W`, `H`, `isSolo`, `starsFor`, `loadSoloBest`, `saveSoloBest`, `targets`;
  - new state fields: `G.shop[0].discount`, `rerolls`, `rerollPrice`, `rerollIdx`, offer `basePrice`, `G.results[0].stars`;
  - `shopAction(0, 'reroll')`.

## Results per acceptance criterion, as claimed
- **AC-01:** 60/60 games across 3 modes × seeds 1–20 reach the final screen; 0 page or console errors.
- **AC-02:** hooks present.
- **AC-03:** versus and co-op × seeds 1–10: 20/20 games byte-identical to the baseline (154 round results plus `G.final`).
- **AC-04:** the tables are deep-equal to the baseline; same-seed co-op best `{"cleared":8,"money":27865}`; `soloBest` is not written.
- **AC-05 to AC-08:** mode select, the remembered mode and both key sets pass via `page.keyboard.press`.
- **AC-09:** solo game through real keys with `?fast=1&seed=3`. Random spam failed round 1. AC-09b used real keys plus money injection through `G` to reach the 8-round final.
- **AC-10:** at normal speed, seeds 1/2/3 earned 3/3/3 stars in round 1 (income 2310/2370/2392). Buying with ↓ worked and ↑ readied. Moving the shop selection with → was not exercised because the first offer was affordable.
- **AC-11:** pause, restart and main menu work.
- **AC-12,** seeds 1–50, with no tuning changes:

  | Bot | Result | Requirement |
  |---|---|---|
  | Random spam | clears 8 rounds 2%, ≥3 rounds 44% | ≤10%, ≤65% |
  | Novice | passes round 1 90%, clears all 30–80% band at 42% | ≥85%, 30–80% |
  | Skilled | clears all 98%, average 13.98 stars | ≥90%, 11–19 |
  | Perfect | clears all 98%, average 18.40 stars | ≥95%, ≥15 |

- **AC-13:** 13 star boundary cases pass.
- **AC-14:** no lightning bottles in 16,172 solo items; no shields in 2000 shops or 3000 dice rolls; no tug or assist in 200 games.
- **AC-15:** 0 unreachable items; `levelWorth ≥ need` in 398/400 levels (lowest ratio 0.92).
- **AC-16:** discounts are correct.
- **AC-17:** reroll pricing, exclusions and the insufficient-money case are correct.
- **AC-18:** medal behaviour is correct.
- **AC-19:** best-record logic is correct.
- **AC-20:** exactly one player and one shop throughout.
- **AC-21:** 7 required screenshots plus 3 extras in `/home/user/gold-miner/screenshots/`, reviewed. Three visual fixes were made: the float text overlapping the miner's head, a crowded intro star line, and a tombstone sandwiching the sun.

## Known issues, as stated
- The miner's body is at x = 590 and the winch and hook at 640, so the miner looks slightly left of centre.
- With a discount, the reroll price increase is not exactly +30 because of rounding (70 → 95).
- A round saved by the medal counts as cleared. The spec is silent on this.
- The "通过!" stamp slightly overlaps the panel top edge, intentionally.
- The novice bot's 90% round-1 pass rate is close to the 85% threshold.
- The full test run takes about 4.5 min.
- The shop could in theory show fewer than 6 offers after many buys and rerolls; this was not observed.
- Audio is unverified.
