# Touch builder report, round 2 (claims to verify)

## Fixes, as claimed
1. **Must-fix tap guard:** on touch, a 450 ms tap-only guard (`G.tapGuardUntil`) starts after every screen change. It covers start, select, results, shop and final. Intro and play are exempt. Final-screen buttons were not moved.
   - Test T-17 uses real taps. Double taps at 150 and 400 ms on "查看最终结果" stay on the final screen. "再来一局" after 1 s goes to the intro, still solo, round 1. A double tap on "返回主菜单" at 160 ms stays on start. A tap on the solo card after 0.6 s goes to select.
2. **Shop cooldown:** a 0.35 s cooldown per card after a purchase.
   - Test T-18: 3 taps within 93–98 ms buy 1 item; a fourth tap 0.5 s later buys a second.
3. **Pause on hidden:** on touch, the game pauses when the page becomes hidden during intro or play.
   - Test T-19: the pause menu shows on return; desktop is unaffected.
4. **DPR step-down:** only play frames are sampled, 0.5 s of frames are discarded after each step, and there is a 1 s warm-up per round. `G.dprReason` is exposed.
   - Test T-20 on Pixel 7: at CPU×2 the DPR stays at 2 at 59.9 fps. At CPU×4 the median is 59.9 fps, the DPR drops to 1, and `dprReason` shows avg 32 ms, from 1.5 to 1, round 4.
5. **Desktop shop text:** restored.
   - Test T-21: with a frozen clock, `?touch=0` versus baseline-phase2 is pixel-identical on 7/7 screens (intro, play, results, shop, shop-reroll, shop-armed, final).

## Tests
- A full run was 79/80; the only failure was T-11, from the new purchase cooldown.
- The T-11 assertion was then fixed by adding a 450 ms wait before tapping the buy button. After that, T-11 passed alone, and the touch group passed 21/21. The full suite was NOT re-run after this.
- The `tapId` helper now waits out the guard; `{now:true}` taps immediately.

## Known issues, as stated
- The final and results buttons still overlap; only the guard prevents the misfire.
- At CPU×4 the DPR still drops all the way to 1.
