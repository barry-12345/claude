# Touch phase (2.5) builder report, round 1 (claims to verify)

The Builder claims:

- **Tests:** SPEC-touch.md is fully implemented. `node tests/run-all.js` runs 75/75 in about 1104 s, including touch T-01 to T-16; the phase-1 and phase-2 suites still pass. `node tests/run-all.js touch` runs only the touch group.
- **Baseline:** `tests/baseline-phase2.html` is the accepted phase-2 copy.
- **Scope of changes:** everything is in index.html. Touch code only calls existing handlers, adds no `Math.random` calls, and leaves desktop visuals unchanged.

## Implementation, as claimed
- **Detection:** `TOUCH_UI` is computed per the spec formula, with a `?touch=0|1` override, stored in `G.touchUI`. `__game.setTouchUI` works only on the start screen.
- **Solo only on touch:** versus and co-op cards are not drawn; `G.mode` is always solo and `menuMode` is 0. Digit2/3, Numpad2/3 and the arrow and A/D keys don't switch modes. localStorage `goldminer.mode` is neither read nor written on touch.
- **Viewport and CSS:** viewport and web-app meta tags, `touch-action: none`, a fixed body. Touch events are non-passive with `preventDefault`; gesture events and dblclick are blocked; taps use `pointerdown`. Fullscreen triggers on `pointerup`; without `requestFullscreen`, a "添加到主屏幕可全屏游玩" hint shows instead.
- **Safe areas:** read via a hidden div, with a `?safe=l,t,r,b` override, exposed as `__game.safeInsets()`.
- **Portrait:** shows the "请横屏游玩" overlay and pauses during intro or play; turning back to landscape leaves the pause menu open.
- **Hit areas:** `UI.btn` hit areas are rebuilt every frame, with a minimum of 100×100 game px on touch. `__game.uiButtons()` lists them. Each pointer is handled independently; tapping the field fires.
- **Sky-band buttons:** dynamite at (40,92) 120×90, fullscreen at (1040,92), pause at (1150,92).
- **Touch HUD:** re-laid out for touch.
- **Fonts:** `TOUCH_FONT = {hud:30, label:22, body:20, float:28, legend:16}`. Deco text is exempt. `G.minFont` and `G.hudFont` are tracked per frame.
- **Touch versions of every screen:** menu, select, results, shop (tap to select, tap again to buy, ready is a double tap), pause (with sound and effects toggles), final, and intro (tap to skip).
- **Audio:** unlocked on the first `pointerup`/`touchend`, with a silent buffer; suspended when the page is hidden.
- **Performance:** DPR steps down 2 → 1.5 → 1 if the frame time stays above 22 ms for 2 s. Particles are capped at 300, or 150 with reduced effects.
- **Desktop text fix:** `rulesFor('solo')` now writes the star thresholds from `R.starMult`, giving 1.05 / 1.3.

## Results per criterion, as claimed
- **T-01:** detection correct on iPhone 13, Pixel 7, desktop and a touch laptop; overrides work.
- **T-02:** a full touch-only solo game, twice each on iPhone 13 and Pixel 7, with 0 errors. The money-injection variant reaches all 8 rounds.
- **T-03:** only the solo card on touch; tapping where the versus/co-op cards are on desktop does nothing; the stored versus preference is preserved.
- **T-04:** with a keyboard attached on iPhone 13, the mode never leaves solo.
- **T-05:** `minFont` is 20 at 3 viewports; HUD fonts are 34 / 30 / 38; the desktop font set is identical to baseline phase 2.
- **T-06:** 210 buttons, all at least 44 CSS px; safe areas respected at 47 and 59 px. The 667×375 + safe-area combination was not tested; there buttons would be about 39 px.
- **T-07:** a field tap fires the hook on the next frame.
- **T-08:** multi-touch: dynamite works while another finger holds the field.
- **T-09:** the portrait overlay pauses the game.
- **T-10:** zoom and scroll prevention verified.
- **T-11:** all menus work by tap, including the shop double-tap and the toggles.
- **T-12:** audio unlocks on the first tap.
- **T-13:** 59.9 fps median; with 4× CPU throttling also 59.9 fps, with DPR dropping to 1.
- **T-14:** keyboard still works on touch devices; desktop golden comparison 15/15 against baseline phase 2.
- **T-15:** 18 screenshots plus a portrait shot in `screenshots/touch/`, all reviewed; 4 layout fixes made.
- **T-16:** fullscreen fallback and particle caps verified.

## Known issues, as stated
- Playwright device sizes differ from the spec, so viewports were overridden.
- No real-device safe-area or iOS audio/fullscreen check.
- The DPR step-down is aggressive, going straight to 1.
- The touch menu puts the solo card below the rules panel.
- Phase-3 mobile name entry is not in scope.
