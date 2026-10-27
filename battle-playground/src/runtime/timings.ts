/**
 * Phase I — battle-flow timing constants.
 *
 * Every duration in the runner is keyed off whole GBA frames (59.7275 fps,
 * 16.7427 ms per frame). Nothing in the runner should pass a millisecond
 * value to the clock — route through a named constant here so the timings
 * stay documented and easy to tune to match the decomp.
 *
 * Frame counts come from the Emerald/FireRed decomps where possible — where
 * the decomp uses `gBattleCommunication[MULTISTRING_CHOOSER]` branches or
 * function-local delay constants, the names below cite the original symbol.
 *
 * Nothing in this file may import from `phaser`.
 */

/**
 * Decomp wait-time constants from `include/constants/battle.h`. Every
 * `waitmessage`/`pause` command in `data/battle_scripts_1.s` takes one
 * of these; the script's `B_WAIT_TIME_*` argument is stored directly
 * as a frame count and passed to `Cmd_waitmessage` / `Cmd_pause` in
 * `src/battle_script_commands.c`.
 */
/** `B_WAIT_TIME_LONG` — 64 frames (≈1.07 s). */
export const WAIT_LONG = 64;
/** `B_WAIT_TIME_MED` — 48 frames. */
export const WAIT_MED = 48;
/** `B_WAIT_TIME_SHORT` — 32 frames. */
export const WAIT_SHORT = 32;
/** `B_WAIT_TIME_SHORTEST` — 16 frames. */
export const WAIT_SHORTEST = 16;

/**
 * Between-command wait beats for the damaging-move script
 * `BattleScript_EffectHit` in `data/battle_scripts_1.s:239-272`. Each
 * constant cites the specific script line whose `waitmessage` /
 * `pause` it represents.
 *
 *   attackstring → ppreduce → critcalc → damagecalc → typecalc →
 *   adjustnormaldamage → attackanimation → waitanimation →
 *   effectivenesssound → hitanimation → waitstate → healthbarupdate →
 *   datahpupdate → critmessage → waitmessage(LONG) → resultmessage →
 *   waitmessage(LONG) → seteffectwithchance → tryfaintmon → moveendall
 *
 * Gaps where the script doesn't pause (e.g. between `attackstring`
 * and `attackanimation`) have no constant; pass `0` or omit the wait
 * at the runner call site.
 */

/**
 * Pause after the HP bar drain completes, before the next event types.
 * Matches `battle_scripts_1.s:265` — `waitmessage B_WAIT_TIME_LONG`
 * following `critmessage`/`resultmessage`. The bar-drain owns its own
 * duration (1 px per frame); this is just the "read the number" beat.
 */
export const POST_DAMAGE_PAUSE_FRAMES = WAIT_LONG;

/**
 * Gate between the damage drain and the "super effective!" line.
 * Matches `battle_scripts_1.s:267` — `waitmessage B_WAIT_TIME_LONG`
 * between `critmessage` and `resultmessage`. Was 60 frames; bumped to
 * match the decomp's 64.
 */
export const EFFECTIVENESS_GATE_FRAMES = WAIT_LONG;

/** How long the "super effective!" / "not very effective!" line holds. */
export const EFFECTIVENESS_DISPLAY_FRAMES = WAIT_MED;

/** "A critical hit!" beat. Matches `waitmessage B_WAIT_TIME_MED` after `critmessage`. */
export const CRITICAL_HIT_FRAMES = WAIT_MED;

/**
 * Total send-out sequence — used only as a ceiling. Decomp breaks it up
 * into the pokeball throw, the ball-open flash, the mon-materialize fade,
 * and the "Go!" text; see the constants below and `playIntro`.
 */
export const SEND_OUT_FRAMES = 96;

/** Number of frames the player back-pic throw animation takes (5 frames × ~6f each). */
export const THROW_ANIM_FRAME_COUNT = 5;
export const THROW_ANIM_FRAMES_PER_FRAME = 6; // → 30 total frames (≈0.5s)
export const THROW_ANIM_TOTAL_FRAMES =
  THROW_ANIM_FRAME_COUNT * THROW_ANIM_FRAMES_PER_FRAME;

/**
 * How long the pokeball arc from the thrower to the target platform takes.
 * Matches `AnimBallThrow` / `TASK_THROW_BALL` in `pokeball.c`.
 */
export const BALL_ARC_FRAMES = 24;
/** Flash when the ball pops open and the mon materializes out of it. */
export const BALL_OPEN_FLASH_FRAMES = 10;

/**
 * Ball-release phase counts — `SpriteCB_ReleaseMonFromBall`
 * (`src/pokeball.c:763` in the FireRed decomp). The decomp runs a 3-part
 * sequence in sequence: the ball sprite cycles through its open frames,
 * a white particle burst radiates out, and the mon scales in via
 * `BATTLER_AFFINE_EMERGE`. Named constants here so the renderer and
 * the runner stay in lock-step.
 */
export const BALL_OPEN_FRAMES = 8;
export const BALL_PARTICLES_FRAMES = 16;
export const BALL_EMERGE_FRAMES = 10;
export const BALL_RELEASE_SCHEDULE = {
  openFrames: BALL_OPEN_FRAMES,
  particleFrames: BALL_PARTICLES_FRAMES,
  emergeFrames: BALL_EMERGE_FRAMES,
} as const;

/**
 * `hitanimation BS_TARGET` beat from `data/battle_scripts_1.s:260`. The
 * target sprite flickers white/black for ~12 frames before the HP drain
 * starts — strictly after the move animation's `waitanimation`.
 */
export const HIT_FLASH_FRAMES = 12;

/**
 * Stat-change BG-overlay beat. Matches `StatsChangeAnimation_Step2` in
 * `src/battle_anim_utility_funcs.c`: a 10-frame fade-in, 20-frame hold,
 * 10-frame fade-out of the full-screen arrow mask = 40 frames total for
 * the non-sharp case. Narration fires on the "narrate after" branch so
 * the line types as the fade-out tail plays.
 */
export const STAT_CHANGE_FLASH_FRAMES = 40;

/** Intro: opening beat with trainers squared off. */
export const INTRO_SQUARE_OFF_FRAMES = 18;
/** Intro: rival slide-off duration. */
export const INTRO_RIVAL_SLIDE_FRAMES = 30;
/** Intro: opponent mon materialize duration (after rival is gone). */
export const INTRO_OPPONENT_FADEIN_FRAMES = 20;
/** Intro: gap between opponent appearing and the player throw starting. */
export const INTRO_MID_GAP_FRAMES = 12;
/** Intro: player trainer slide-off once the throw finishes. */
export const INTRO_PLAYER_SLIDE_FRAMES = 20;
/** Intro: player mon materialize duration. */
export const INTRO_PLAYER_FADEIN_FRAMES = 18;

/** Outro: recall shrink/fade. */
export const OUTRO_RECALL_FRAMES = 28;
/** Outro: trainers slide back in. */
export const OUTRO_TRAINER_SLIDE_FRAMES = 30;
/** Outro: "Good battle!" (or host dialogue) hold. */
export const OUTRO_DIALOGUE_FRAMES = 120;

/**
 * Faint sequence — from `BattleScript_FaintTarget` at
 * `data/battle_scripts_1.s:2810`:
 *   `playfaintcry` → `pause B_WAIT_TIME_LONG (64)` → `dofaintanimation`
 *   → `cleareffectsonfaint` → `printstring STRINGID_TARGETFAINTED`
 *
 * The cry fires first, then a 64-frame hold, then the fall animation.
 * `FAINT_CRY_HOLD_FRAMES` is the post-cry pause, now retuned from a
 * placeholder 18 to the decomp's `B_WAIT_TIME_LONG` (64).
 */
export const FAINT_CRY_HOLD_FRAMES = WAIT_LONG;
export const FAINT_FALL_FRAMES = 48;
export const FAINT_POST_FRAMES = WAIT_SHORTEST;

/** Status message "X was poisoned!", etc. — 64-frame hold per decomp waitmessage. */
export const STATUS_APPLIED_FRAMES = WAIT_LONG;
/** End-of-turn status damage tick (burn pulse / poison shake). */
export const STATUS_DAMAGE_FRAMES = 32;

/** "X can't move!" + paralysis/sleep/freeze flash. */
export const CANT_MOVE_FRAMES = 36;

/** Charge-move first turn pause ("Solar Beam is taking in sunlight!"). */
export const MOVE_CHARGING_FRAMES = 42;

/** Weather set / cleared beat. */
export const WEATHER_SET_FRAMES = 48;
export const WEATHER_END_FRAMES = 30;

/** Reflect / Light Screen put-up / down. */
export const SCREEN_START_FRAMES = 30;
export const SCREEN_END_FRAMES = 18;

/** Battle start / end pacing. */
export const BATTLE_START_FRAMES = 42;
export const BATTLE_END_FRAMES = 84;

/** Stat change beat ("X's Attack rose!"). */
export const STAT_CHANGE_FRAMES = 28;

/** Generic fallback for any not-yet-specialised event. */
export const FALLBACK_EVENT_FRAMES = 32;

/**
 * Gen 3 HP bar pixel width in `graphics/battle_interface/hpbar_anim.png`.
 * The runner drives the HP drain at 1 bar-pixel per GBA frame (substep 3).
 */
export const HP_BAR_PIXELS = 48;
/** How many HP points are consumed per HP-bar pixel at max HP. */
export function hpDrainFrames(fromHp: number, toHp: number, maxHp: number): number {
  if (maxHp <= 0) return 0;
  const fromPx = Math.round((fromHp / maxHp) * HP_BAR_PIXELS);
  const toPx = Math.round((toHp / maxHp) * HP_BAR_PIXELS);
  return Math.max(1, Math.abs(fromPx - toPx));
}

/** Damage popup: frames per digit reveal (substep 2). */
export const DAMAGE_POPUP_FRAMES_PER_DIGIT = 1;
/** Damage popup: frames the fully-revealed number stays on screen. */
export const DAMAGE_POPUP_HOLD_FRAMES = 30;
/** Damage popup: fade-out frames. */
export const DAMAGE_POPUP_FADE_FRAMES = 14;

/**
 * Text-speed table — `sTextSpeedFrameDelays` in FireRed
 * `src/new_menu_helpers.c:27-31`. Frame delay between glyph reveals
 * at each option-menu text-speed setting.
 *   [SLOW] = 8, [MID] = 4, [FAST] = 1
 *
 * We default to MID for the dialogue printer (matching FireRed's default
 * save-state setting) and expose FAST as the "B-held text skip" cadence.
 */
export const TEXT_SPEED_SLOW_FRAMES_PER_CHAR = 8;
export const TEXT_SPEED_MID_FRAMES_PER_CHAR = 4;
export const TEXT_SPEED_FAST_FRAMES_PER_CHAR = 1;

/**
 * HUD / menu timings. None of these are invented — every constant cites
 * its FireRed source. See `src/phaser/hud/*` for callers.
 */

/**
 * Per-state hold for the bouncing "press A" down-arrow sprite callback.
 * `CURSOR_DELAY` in `src/text.c:11` — held for 8 frames per state, 4
 * states per cycle (y2 = 0 → 1 → 2 → 1), total 32-frame period.
 */
export const HUD_CURSOR_FRAME_STEP = 8;

/**
 * Minimum gap between consecutive menu-nav key presses. The decomp's
 * `JOY_NEW` semantics (`include/global.h:120`) treat a key as "new" only
 * on the edge-transition from released → pressed, so holding an arrow
 * does not auto-repeat. We debounce off the same `newKeys` edge — one
 * frame is enough because `HudInput` tracks edges directly, but we keep
 * the constant named so test/tuning stays legible.
 */
export const HUD_MENU_DEBOUNCE_FRAMES = 1;
