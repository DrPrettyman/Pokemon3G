# FireRed Trainer Battle — Authoritative Sequence

This is the exact sequence of events during a Pokémon FireRed trainer battle, verified against the decomp source at `python-scripts/raw-assets/decomp-hacks/firered/`. Events on the same numbered line happen **simultaneously**; separate numbers are **strictly sequential**.

The running example is a Bug Catcher (Rick / Weedle) vs the player (Bulbasaur), with Weedle moving first and using String Shot, and Bulbasaur replying with Tackle.

---

## Battle intro

1. **Background slide-in.** The battle-BG window effect reveals the field. The opponent trainer sprite slides in from the left and the player trainer sprite slides in from the right at the same time, during the same task.
   - `src/battle_intro.c` — `HandleIntroSlide` → `sBattleIntroSlideFuncs[terrain]` (`BattleIntroSlide1/2/3`, lines 135–212)
   - `src/battle_main.c:2551` — `BattleIntroDrawTrainersOrMonsSprites` draws both trainer pics as sprites

2. **Party summary bars appear** (the six-ball party indicator for each side, trainer battles only).
   - `src/battle_main.c:2642` — `BattleIntroDrawPartySummaryScreens`

3. **Message:** `"Bug Catcher Rick would like to battle!"` — blocking; the state machine waits for the textbox to finish.
   - `src/battle_main.c:2715` — `BattleIntroPrintTrainerWantsToBattle` → `PrepareStringBattle(STRINGID_INTROMSG, …)`
   - `src/battle_message.c:1569` — `sText_Trainer1WantsToBattle`

4. **Message:** `"Bug Catcher Rick sent out Weedle!"` — this prints **before** any opponent send-out animation.
   - `src/battle_main.c:2739` — `BattleIntroPrintOpponentSendsOut` → `PrepareStringBattle(STRINGID_INTROSENDOUT, …)`
   - `src/battle_message.c:1607` — `sText_Trainer1SentOutPkmn`

5. **Opponent trainer sprite slides off to the right**, leaving the thrown Poké Ball sprite in place where the opposing mon will appear. The ball arcs in as part of the same emit.
   - `src/battle_main.c:2748` — `BattleIntroOpponentSendsOutMonAnimation`
   - `src/battle_controller_opponent.c:1626` — `OpponentHandleIntroTrainerBallThrow` (trainer sprite gets a linear-translation callback; `Task_StartSendOutAnim` spawns)

6. **Ball "bursts open" and Weedle emerges.** This is a real, distinct animation phase with ball-open frames, a particle burst, and a fade/affine-emerge on the mon sprite.
   - `src/pokeball.c:990` — `SpriteCB_OpponentMonSendOut` waits ~15 frames, then hands off to `SpriteCB_ReleaseMonFromBall`
   - `src/pokeball.c:763` — `SpriteCB_ReleaseMonFromBall`:
     - `StartSpriteAnim(sprite, 1)` — ball-open frames
     - `AnimateBallOpenParticles(...)` — white burst particles
     - `LaunchBallFadeMonTask(...)` — mon tint fades in with the ball color
     - `StartSpriteAffineAnim(..., BATTLER_AFFINE_EMERGE)` — mon scales up into place

7. **Pokédex entry recorded** for the newly seen foe (invisible to the player unless it's a first sighting cue; no UI event in a normal trainer battle).
   - `src/battle_main.c:2769` — `BattleIntroRecordMonsToDex`

8. **Message:** `"Go! Bulbasaur!"` — again, this prints **before** the player-side animation.
   - `src/battle_main.c:2793` — `BattleIntroPrintPlayerSendsOut`
   - `src/battle_message.c:1603` — `sText_GoPkmn`

9. **Player trainer sprite slides off to the left while throwing a Poké Ball.** (Unlike the opponent, the player side plays an explicit trainer throwing-pose animation and releases the ball mid-slide.)
   - `src/battle_main.c:2803` — `BattleIntroPlayerSendsOutMonAnimation`
   - `src/battle_controller_player.c` — `PlayerHandleIntroTrainerBallThrow` (sets trainer throw anim, spawns ball)

10. **Ball spins/arcs through the air** (tween + rotation; this is the ball's in-flight frames, distinct from the burst-open frames).
    - `src/pokeball.c` — `SpriteCB_PlayerMonSendOut_1` / `_2`

11. **Ball lands, "bursts open," and Bulbasaur emerges.** Same `SpriteCB_ReleaseMonFromBall` path as step 6.

12. **Per-switch-in effects resolve:** ability triggers (Intimidate / Trace / weather setters), entry hazards, held-item triggers. Speed order is recalculated.
    - `src/battle_main.c:2852` — `TryDoEventsBeforeFirstTurn`

13. **Action-select menu appears** (FIGHT / BAG / POKéMON / RUN).
    - `src/battle_main.c:2908` — `HandleTurnActionSelectionState`

---

## One turn — example: Weedle's String Shot vs Bulbasaur's Tackle

The player picks `FIGHT → Tackle`. Weedle is faster, so Weedle's move resolves first. Each move runs the standard attack script (`BattleScript_EffectHit` family) from `data/battle_scripts_1.s:239–272`, in this order:

### Weedle uses String Shot (a stat-drop move)

14. **Message:** `"Foe Weedle used String Shot!"` — printed **before** the animation.
    - `battle_scripts_1.s:249` — `attackstring`
    - `printfromtable sMoveUsedTexts` chooses the "Foe X used Y!" variant via `STRINGID_USEDMOVE`

15. **String Shot move animation plays** (the white web/strings flying toward Bulbasaur).
    - `battle_scripts_1.s:257` — `attackanimation`
    - `battle_scripts_1.s:258` — `waitanimation` blocks until it finishes
    - Anim script in `data/battle_anim_scripts.s` under `Move_STRING_SHOT`

16. **Stat-drop status animation plays on Bulbasaur** (the downward arrow / "stat fell" flash layered over the target). This runs inside `seteffectwithchance` when the effect resolves.
    - `battle_scripts_1.s:268` — `seteffectwithchance`
    - `src/battle_script_commands.c` — `SetMoveEffect` → `BattleScript_StatDown` → `statbuffchange` launches the stat-change animation
    - Status-anim table: `src/battle_anim_status_effects.c`

17. **Message:** `"Bulbasaur's Speed fell!"`
    - `BattleScript_StatDown` prints `STRINGID_PKMNSSTATCHANGED2` via `printfromtable` + `waitmessage`

(There is no HP bar update for String Shot — no damage.)

18. **End-of-move bookkeeping** (`tryfaintmon` no-ops, `moveendall` handles item/ability end-of-move triggers).
    - `battle_scripts_1.s:269`–`271`

### Bulbasaur uses Tackle (a damaging physical move)

19. **Message:** `"Bulbasaur used Tackle!"`
    - `battle_scripts_1.s:249` — `attackstring`

20. **Tackle move animation plays** (Bulbasaur's sprite lunges at Weedle).
    - `battle_scripts_1.s:257`–`258` — `attackanimation` + `waitanimation`
    - `Move_TACKLE` in `data/battle_anim_scripts.s`

21. **Effectiveness SFX** (plays *before* the hit flash; for Tackle vs Bug/Poison this is the neutral cue).
    - `battle_scripts_1.s:259` — `effectivenesssound`

22. **Hit-flash animation on Weedle** (the target sprite flickers white/black — this is the generic "I got hit" animation, separate from the move anim).
    - `battle_scripts_1.s:260` — `hitanimation BS_TARGET`
    - `src/battle_anim.c` — `HandleHitAnimation` / `AnimTask_AttackerStepBack` family

23. **Weedle's HP bar drains** (frame-locked tick-down).
    - `battle_scripts_1.s:262` — `healthbarupdate BS_TARGET`
    - `battle_scripts_1.s:263` — `datahpupdate BS_TARGET` commits the new HP value once the bar animation finishes

24. **Crit / effectiveness messages** if applicable (`"A critical hit!"`, `"It's super effective!"`, etc.). Skipped for a neutral non-crit Tackle.
    - `battle_scripts_1.s:264`–`267` — `critmessage`, `waitmessage`, `resultmessage`, `waitmessage`

25. **Faint check + end-of-move.**
    - `battle_scripts_1.s:269`–`271` — `tryfaintmon`, `moveendall`

26. **End-of-turn effects** (weather damage, poison/burn ticks, Leftovers, ability/residual damage, stat-stage wear, etc.).
    - `src/battle_util.c` — `DoFieldEndTurnEffects`, `DoBattlerEndTurnEffects`

27. **Action-select menu reappears** → repeat from step 13.

---

## Things the current battle-playground gets wrong

These are the deltas from playing the current prototype against the above. File these as concrete fixes:

1. **No ball-burst-open phase.** Step 6 / 11 is missing entirely — the mon sprite just appears. The decomp has a discrete ball-open animation (`StartSpriteAnim(sprite, 1)`), a particle burst (`AnimateBallOpenParticles`), and a fade/affine-emerge (`BATTLER_AFFINE_EMERGE`). These must run in order before the mon is shown in its idle pose.

2. **Message vs animation ordering is inverted in several places.** The decomp prints the send-out message **before** the trainer slide-out (`BattleIntroPrintOpponentSendsOut` → `BattleIntroOpponentSendsOutMonAnimation`), and prints `"Foe X used Y!"` **before** the move animation (`attackstring` at line 249 precedes `attackanimation` at line 257). Any ordering where the animation starts while the text is still typing is wrong.

3. **Player-side throw animation is missing.** Step 9 is a composite: the trainer sprite translates left **while** playing its throwing frames and releases the ball mid-slide. Not a simple slide-off.

4. **Status-change animation is not a standalone step.** The stat-drop animation (step 16) is emitted from inside `seteffectwithchance`, not as a separate scripted op. The "Speed fell!" message follows the animation — it does not run in parallel.

5. **HP bar drain is a frame-locked tween, not an instant snap.** `healthbarupdate` animates, and `datahpupdate` only commits the value once the tween completes (`battle_scripts_1.s:262`–`263`).

6. **Hit-flash on target is separate from the move animation.** `attackanimation` (the move visual) must fully complete (`waitanimation`) before `hitanimation BS_TARGET` starts. They don't overlap.

---

## Source-of-truth file map

| Event | File | Symbol |
|---|---|---|
| Background + trainer slide-in | `src/battle_intro.c` | `HandleIntroSlide`, `BattleIntroSlide1/2/3` |
| Draw trainer/mon sprites | `src/battle_main.c:2551` | `BattleIntroDrawTrainersOrMonsSprites` |
| Party summary bars | `src/battle_main.c:2642` | `BattleIntroDrawPartySummaryScreens` |
| "would like to battle" msg | `src/battle_main.c:2715` | `BattleIntroPrintTrainerWantsToBattle` |
| "sent out Weedle" msg | `src/battle_main.c:2739` | `BattleIntroPrintOpponentSendsOut` |
| Opponent trainer slide-out + ball | `src/battle_main.c:2748` | `BattleIntroOpponentSendsOutMonAnimation` |
| Opponent emit ball throw | `src/battle_controller_opponent.c:1626` | `OpponentHandleIntroTrainerBallThrow` |
| Ball burst-open + mon release | `src/pokeball.c:763` | `SpriteCB_ReleaseMonFromBall` |
| "Go X!" msg | `src/battle_main.c:2793` | `BattleIntroPrintPlayerSendsOut` |
| Player trainer throw + slide-out | `src/battle_main.c:2803` | `BattleIntroPlayerSendsOutMonAnimation` |
| Switch-in ability/item triggers | `src/battle_main.c:2852` | `TryDoEventsBeforeFirstTurn` |
| Action select | `src/battle_main.c:2908` | `HandleTurnActionSelectionState` |
| Standard move script | `data/battle_scripts_1.s:239` | `BattleScript_EffectHit` |
| Stat-drop effect + msg | `src/battle_script_commands.c` | `SetMoveEffect`, `BattleScript_StatDown` |
| Hit flash | `src/battle_anim.c` | `HandleHitAnimation` |
| Status anim registry | `src/battle_anim_status_effects.c` | — |
