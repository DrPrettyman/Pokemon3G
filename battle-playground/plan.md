# battle-playground — Remaining work

Working list of what still needs doing on the battle component. See `README.md` for what already ships and `CLAUDE.md` for architecture and conventions.

The battle pipeline is structurally complete: decomp-faithful script flow, verbatim FireRed text, ball-release sub-sequence, stat-change BG mask clipped to the battler, faint cadence, real healthbox + textbox chrome, and hit-flash → HP drain sequencing. Everything in this file is polish on top of that foundation; nothing is a hard blocker.

## Done — Frame-accurate battle sequence (FireRed fidelity)

- **Battle-script flow** matches `BattleScript_EffectHit` in `data/battle_scripts_1.s:239-272`: `attackcanceler` → `accuracycheck` → `attackstring` → calcs → `attackanimation` → `waitanimation` → `effectivenesssound` → `hitanimation` → `healthbarupdate` + `datahpupdate` → `critmessage` → `resultmessage` → `seteffectwithchance` → `tryfaintmon` → `moveendall`. Misses skip the animation (`BattleScript_PrintMoveMissed`); type immunities skip the animation via `Cmd_attackanimation`'s `MOVE_RESULT_NO_EFFECT` guard; confusion self-hit fuses `[cant_move, damage]` into two narration lines around a standard damage sequence with no move anim.
- **Ball-release sub-sequence** — `BattleScene.playBallRelease` runs the decomp's 3-part `SpriteCB_ReleaseMonFromBall` sequence (ball-open frames → particle burst → `BATTLER_AFFINE_EMERGE` scale-in) on both intro send-outs. The player-side trainer slide runs concurrent with the throw animation, with the ball released on frame 2 of the back-pic strip. Backed by `ball_poke.png` (16×48, 3-frame strip) and `ball_particles.png` (8-frame burst) from `extract_hud()` in `python-scripts/extract_battle_graphics.py`.
- **Stat-change BG mask clipped to the battler silhouette** — `statStageFlash(side, delta, statId)` uses a Phaser 4 filter-mask (`enableFilters()` + `filters.internal.addMask(battler)`) with 16 pre-composited 256×256 RGBA overlays from `src/assets/hud/stat_masks/` (8 palettes × up/down tilemaps). Pixel-perfect, alpha-aware, mirrors the decomp's `DISPCNT_OBJWIN_ON` + `CreateInvisibleSpriteCopy(..., ST_OAM_OBJ_WINDOW)` clip in `StatsChangeAnimation_Step1`. Fades in over 10 frames, holds 20, scrolls ±3 px/frame, fades out over 10 — matches `StatsChangeAnimation_Step2/3` in `src/battle_anim_utility_funcs.c`.
- **Real decomp text strings** — `src/runtime/battleStrings.ts` holds verbatim `STRINGID_*` templates copied from `src/battle_message.c` with file:line citations. `formatBattleString(id, ctx)` expands `{B_ATK_NAME_WITH_PREFIX}` / `{B_DEF_NAME_WITH_PREFIX}` / `{B_MOVE_NAME}` / `{B_BUFF1}` / `{B_BUFF2}`. `nameWithPrefix` mirrors `HANDLE_NICKNAME_STRING_CASE` (ALL CAPS, `"Foe "` / `"Wild "` prefixes per battle type). `BitmapFontPrinter` honors `\n` (line break) and `\f` (page break, auto-advances after 64 frames). Every line `BattleRunner.narrateEvent` emits goes through this.
- **Hit-flash strictly before HP drain** — `BattleRunner.playEvent(damage)` runs `hitFlash → clock.wait(HIT_FLASH_FRAMES) → drain → gate`. The Phase A `shake` stand-in is gone.
- **Faint sequencing** — `BattleRunner.playEvent(faint)` plays the cry first, waits `WAIT_LONG` (64 frames), runs the fall animation, then narrates `"X\nfainted!"` via the narrate-after branch. Matches `BattleScript_FaintTarget:2810`.
- **Real HUD chrome** — `BattleScene` preloads `healthbox_singles_player.png` (128×64), `healthbox_singles_opponent.png` (128×32), and `textbox.png` (128×128) from `graphics/battle_interface/`, and blits them directly. The HP bar fill rectangle sits inside the chrome's rail region at decomp-matched pixel offsets (`HEALTHBOX_LAYOUT`) and steps one bar-pixel per GBA frame. HP colors match `healthbar.pal` thresholds: green > 50%, yellow > 20%, red ≤ 20%. The placeholder flat rectangles are gone.
- **Decomp-correct font palette** — `python-scripts/extract_font.py` bakes the Gen 3 Latin font atlas with the FRLG `B_WIN_MSG` textbox colors: `(255,255,255)` white foreground, `(106,90,115)` purple-gray shadow, `(41,82,106)` dark-teal background (blends into the textbox chrome). See `sTextOnWindowsInfo_Normal[B_WIN_MSG]` at `src/battle_message.c:2408`.

Constants in [src/runtime/timings.ts](src/runtime/timings.ts) are keyed to the decomp `B_WAIT_TIME_*` family with script-line citations: `WAIT_LONG=64`, `WAIT_MED=48`, `WAIT_SHORT=32`, `HIT_FLASH_FRAMES=12`, `STAT_CHANGE_FLASH_FRAMES=40` (10 fade-in + 20 hold + 10 fade-out), `FAINT_CRY_HOLD_FRAMES=WAIT_LONG`.

Test suite: 69/69 green. New tests in `tests/animator/`: `BallRelease`, `IntroOpponentReveal`, `IntroPlayerReveal`, `DamageSequence`, `StatChangeSequence`, `MissSequence`, `NoEffectSequence`, `ConfusionSelfHit`, `BattleStrings`.

### Carry-forward fidelity items

Small follow-ups behind the landed work:

- **Sharp (±2) stat-change beat** reuses the non-sharp 40-frame budget. Decomp extends to ~56 frames (13 fade-in, 30 hold, 13 fade-out) for the sharp path — add a `STAT_CHANGE_FLASH_FRAMES_SHARP` and pick based on `Math.abs(stages) >= 2`.
- **Stat mask scroll** uses a scene `update` listener rather than the frame-locked `motionDriver` ticker. Folds into §7 (Motion driver frame-lock precision).
- **Healthbox HP number digit atlas.** The player-side healthbox prints HP text via the Emerald TTF (`hud` palette), which works but diverges from the decomp's `numbers1.png` digit atlas (88×8, 10 × 8×8 digits). The EXP bar now draws and animates one bar-pixel per GBA frame, so that sub-item is landed.
- **Healthbox pixel offsets are empirical** — the layout constants in `src/phaser/healthbox/layouts.ts` were measured by inspecting the extracted PNGs, not read from the decomp's `sHealthboxCoords` or `UpdateHpTextInHealthbox` tables. Positions may be 1-2 px off; re-check against the decomp if the HP bar visually floats.
- **Trainer-intro strings** — `"{B_TRAINER1_CLASS} {B_TRAINER1_NAME}\nwould like to battle!"` needs trainer class/name wiring from the playground host. Currently both wild and trainer intros fall back to the wild `"Wild X appeared!"` template.
- **`effectivenesssound` SE cue** is unimplemented — `data/battle_scripts_1.s:259` plays a different SE per type-effectiveness multiplier. Folds into §4 (Cry / SoundPlayer).

## 1. Authentic red-laser recall animation

`BattleScene.playOutro` currently shrinks + fades both mons as a stand-in for the Pokeball recall. The real animation is a red-laser tween from the decomp (`AnimRecallPokemon` and friends in `battle_anim_*.c`).

**Work**
- Find the decomp template(s) in `python-scripts/raw-assets/decomp-hacks/{firered,emerald}/src/battle_anim_*.c` and port the sprite callback into `src/phaser/animator/spriteCallbacks.ts` using the existing motion helpers in `src/runtime/spriteMotion.ts`.
- Confirm the laser sprite sheet is present in `src/assets/battle_anims/sprite_sheets.json`; extract it via `python-scripts/extract_battle_anims.py` if not.
- Replace the `tweens.add({ alpha: 0, scale: 0.2, ... })` block in `BattleScene.playOutro` with a `MoveAnimator`-driven play of the recall script, keyed to `OUTRO_RECALL_FRAMES` from `src/runtime/timings.ts`.

**Verification:** outro visually matches Emerald's recall for both player and opponent mons.

## 2. Long-tail sprite callbacks

`src/assets/battle_anims/sprite_templates.json` references **288** unique callback names. `SPRITE_CALLBACKS` in `src/phaser/animator/spriteCallbacks.ts` has **14** unique implementations (plus ~20 aliases pointing at those). Anything unregistered falls through to `FallbackFlash`, which spawns the template's sprite at the target and fades it out — reads as a generic flash.

Callbacks land in priority order as specific moves need them. The fallback is intentional: it's always obvious when a move hits unported code.

**Work per callback**
- Read the C function in `decomp-hacks/firered/src/battle_anim_*.c` (or emerald). Note which `sprite->data[0..7]` slots it sets and which `Translate*` helper it ends with.
- Port to TypeScript in `src/phaser/animator/spriteCallbacks.ts` using the motion helpers from `src/runtime/spriteMotion.ts` and the `motionDriver.ts` wrappers.
- Register in `SPRITE_CALLBACKS`. Add aliases for any near-identical variants.
- If the move already has a snapshot test in `tests/animator/`, re-run `npm test -- --update` to stabilise the new trace. If not, add one.

**Verification:** the move in question plays without `FallbackFlash` in the console; snapshot tests stay green.

## 3. Real palette engine

Every palette trick in the project today is a `setTint` + `FILL`-mode approximation. Twenty-two call sites across `BattleScene.ts`, `spriteCallbacks.ts`, and `taskCallbacks.ts` tint sprites to mimic palette blends. This gets the color right but misses the shading ramps — moves that rely on genuine palette cycling (anything using `AnimTask_BlendColorCycle` or the `_PaletteBlend` tasks on a palette that has more than two ramp shades) look flat.

Related gaps that all want the same plumbing:
- `BattleScene.setMonBg` uses a flat `0x606060` darken instead of reading `blendEva`/`blendEvb` from the interpreter state (which `animInterpreter.ts` already tracks but nothing downstream consumes).
- `setSplitBgPrio` bumps depth by +10 rather than doing per-sprite BG-1 vs BG-2 targeting.
- `AnimSimplePaletteBlend` / `AnimComplexPaletteBlend` honour only bits 7..8 of the selector mask (attacker / target mon); background and partner bits are ignored.

**Work**
- Extend `python-scripts/extract_battle_anims.py` to emit each anim sprite's `.pal` next to its PNG so the renderer can read the source palette at load time.
- Build a `paletteEngine.ts` that owns per-palette LUTs and exposes `blend(palette, target, eva, evb)` / `cycle(palette, colors)` / etc. Lives under `src/phaser/` — runtime engine stays palette-unaware.
- Replace the `setTint` sites in `BattleScene.ts` and the two animator files with palette-engine calls. Keep the method names on `BattleAnimRenderer` unchanged so `BattleRunner` sees no diff.
- `setMonBg` reads `eva`/`evb` off the interpreter state and blends the target's palette toward black instead of flat-tinting.
- Selector-mask handling in the palette blend callbacks is rewritten to iterate the full bit set.

**Verification:** visual comparison against decomp captures for a palette-cycling move and a `setMonBg`-heavy move (e.g. any move that opens with a target dimming beat).

## 4. Cry playback through `SoundPlayer`

`src/battle/cries.ts` constructs a fresh `new Audio(path)` on every cry. This bypasses the `SoundPlayer` in `src/phaser/animator/soundPlayer.ts` and is silently blocked by browser autoplay policy before the first user gesture (noticeable on the opening intro cry).

**Work**
- Add `playCry(speciesId, volume?)` to `SoundPlayer`.
- Preload cry mp3s into the Phaser sound cache at `BattleScene.preload` using `import.meta.glob` against the cries directory (matches how `soundPlayer.ts` handles `SE_M_*`).
- Replace `playCry` calls in `BattleRunner.pump` (send_out + faint branches and the concurrent intro-cry scheduler) with `SoundPlayer.playCry`.
- Delete `src/battle/cries.ts`.

**Verification:** no `new Audio(` anywhere under `src/`; intro cries still fire at the same frame offsets; cries survive a fresh page load before user gesture (via Phaser's audio context unlock).

## 5. Sound interpreter gaps

Three animation commands are stubbed in `src/phaser/animator/soundPlayer.ts`:

- **`waitsound`** is a no-op because `SoundPlayer.playOnce` is fire-and-forget — there's nothing for `waitsound` to join. Track the latest play promise on `SoundPlayer` and have `waitsound` await it. A handful of charge moves gate visuals on SFX completion.
- **`setpan`** should retarget the most recent still-playing sound when the interpreter hits it. Today it returns without doing anything.
- **`createsoundtask`** should route through a task registry starting with `AnimTask_CreateSmallSoundWaves` and similar cosmetic cues.

All three are visible as case stubs around line 150 of `soundPlayer.ts`.

## 6. Page-break input gate + real idle-prompt string

The `BitmapFontPrinter` (now DOM-backed, rendering `pokefont/Emerald.ttf` via `@font-face`) honors `\n` and treats `\f` as an auto-advance after 64 frames. In the real game `\p` gates on an A-press — wire a keyboard/click handler through `PhaserBattle` so pages advance on input rather than on a timer, and resolve the page-wait promise when the host presses A.

Also, the idle "What will you do?" line in `PhaserBattle.tsx` is improvised copy. The decomp prints `STRINGID_WHATWILLPKMNDO` via `BattleIntroPrintActionPrompt`; add the STRINGID to `battleStrings.ts` and replace the hardcoded string.

## 7. Motion driver frame-lock precision

`motionDriver.ts` ticks motion specs via `scene.time.addEvent({ delay: FRAME_MS, loop: true })`. Phaser's scheduler rounds each tick to the nearest game update, so at 60fps the cadence is close but not exact. Swap the tick source to `scene.events.on('update', ...)` polling with an accumulated elapsed-ms delta so every spec advances exactly one frame per render frame.

## 8. Small cleanups

- **`DoHorizontalLunge`** (`src/phaser/animator/taskCallbacks.ts:61`) uses a native Phaser yoyo tween instead of two `driveLinear` calls. One-liner refactor for consistency with the rest of the motion pipeline.
- **`AnimLightning`** fades over a hardcoded 18 frames; should be gated on `sprite.animEnded` once the anim sequence driver exposes that event cleanly.
- **`AnimTask_ShakeBattleTerrain`** shakes the two battler sprites only; the real decomp shakes the BG layer containers (which exist — `BattleScene` already has them set up for `fadetobg`). Retarget the shake to the BG layer.
- **Pokeball arc** in `BattleScene.playIntro` uses `Math.sin(t * π)` for the y bump. The decomp's `AnimBallThrowPath` uses a gravity-with-horizontal-velocity integration — not visually different at 24 frames, but worth aligning if doubles land (where arc length varies by target).
- **Damage popup positioning** in `BattleScene.showDamagePopup` uses `anchor.x - text.length * 5` which centres on the feet anchor, not the sprite midpoint. Read the sprite bounding box so tall mons (Onix, Wailord) don't show the number down by their knees.

## Out of scope

Intentionally not part of this component. If the host game needs any of these, they ship as siblings outside `<PhaserBattle>`.

- **Safari Zone encounters.** Different action surface (`Ball / Bait / Rock / Run`) and bookkeeping (`catchFactor` / `escapeFactor` / `goNearCounter` / `pkblThrowCounter`). The host needs a separate `<SafariScreen>` backed by `pokedata3g`'s `SafariBattle` class. It can reuse this project's backdrop layer, a HP-free healthbox, and the cry / sprite loader, but not the move animator or `BattleRunner`.
- **Double battles.** `pokedata3g`'s `Battle` is single-battle only. When doubles land upstream, `<PhaserBattle>` will need a second platform position pair and the renderer will need multi-target move ops.
- **Contests.** `pokedata3g` has a `Contest` class and a `contestAnimationMapper`; that belongs behind a separate `<ContestScreen>`, not here.
- **Overworld integration.** The playground is a standalone demo. Moving between an overworld map and a battle is the host game's problem. `<PhaserBattle>` just renders one battle and resolves `onComplete(outcome)`.
