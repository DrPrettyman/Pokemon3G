/**
 * Renderer-agnostic runtime types.
 *
 * `BattleRunner` drives pokedata3g's `Battle` class and emits abstract
 * `RunnerEvent`s. A `BattleAnimRenderer` implementation (currently Phaser,
 * tests use a RecordingRenderer) translates runner-initiated calls into
 * whatever the host rendering layer needs.
 *
 * Nothing in this file may import from `phaser` — the runtime engine stays
 * renderer-agnostic so move-animator traces can be snapshot-tested against a
 * mock renderer.
 */
import type {
  BattleOutcome,
  BattleSide,
  Pokemon,
  Weather,
} from "pokedata3g";

/** Opaque handle the renderer hands back when asked to spawn a sprite. */
export interface RendererSpriteHandle {
  destroy(): void;
}

/**
 * Frame-accurate intro schedule. The runner computes all offsets from
 * `src/runtime/timings.ts` so the renderer's animations and the runner's
 * concurrent cry playback stay in lock-step.
 */
export interface IntroSchedule {
  squareOffFrames: number;
  rivalSlideFrames: number;
  opponentFadeInFrames: number;
  midGapFrames: number;
  ballArcFrames: number;
  ballFlashFrames: number;
  throwFrames: number;
  playerSlideFrames: number;
  playerFadeInFrames: number;
}

export interface OutroSchedule {
  recallFrames: number;
  trainerSlideFrames: number;
}

/**
 * Ball-release sub-beats — mirrors `SpriteCB_ReleaseMonFromBall` in
 * `src/pokeball.c:763`. Each phase runs in sequence: ball-open sprite
 * frames → particle burst → mon scale-in. The renderer implementation
 * owns the tween math; the runner just waits `openFrames + particleFrames
 * + emergeFrames` worth of clock ticks in the outer beat.
 */
export interface BallReleaseSchedule {
  openFrames: number;
  particleFrames: number;
  emergeFrames: number;
}

/**
 * What `BattleRunner` expects from a rendering layer. The Phaser
 * implementation lives in `src/phaser/PhaserRenderer.ts`; tests substitute
 * a `RecordingRenderer` that captures every call as `{ frame, op, args }`.
 *
 * This contract is deliberately coarse today — Phase B+ will split the
 * high-level `playMoveAnimation` into the abstract per-command ops the
 * MoveAnimator already emits internally. Keep additions here minimal: if
 * something only the Phaser renderer needs appears, it probably belongs
 * behind `PhaserRenderer` instead.
 */
export interface BattleAnimRenderer {
  /** Swap the active Pokemon sprite for a side (used on switch). */
  setActiveSprite(side: BattleSide, url: string): void;
  /** Apply a weather overlay, or clear it when null. */
  setWeather(weather: Weather | null): void;

  /** Play the full decomp move-animation script for `moveId`. */
  playMoveAnimation(moveId: number, attacker: BattleSide): Promise<void>;

  /** Semantic FX — stand-ins until the command interpreter covers all cases. */
  lunge(side: BattleSide, tintHex?: number): void;
  shake(side: BattleSide): void;
  hitFlash(side: BattleSide): void;
  critFlash(): void;
  /**
   * Play the full faint sequence: white palette flash → fall → fade. Frame
   * count is driven by the runner's `Clock`; the renderer promise resolves
   * when the sprite is fully offscreen.
   */
  faintFall(side: BattleSide, frames: number): Promise<void>;

  /**
   * Point the side's healthbox at a live `Pokemon`. The healthbox reads
   * name / level / gender / currentHp / maxHp / exp directly off the
   * reference on subsequent refresh calls — the runner never pushes HP
   * values, it just mutates the `Battle` (which mutates the `Pokemon`)
   * and triggers a refresh.
   *
   * Called on switch-in and at battle start for both sides.
   */
  bindHealthbox(side: BattleSide, pokemon: Pokemon): void;
  /**
   * Animated refresh — drains (or rises) the HP bar one bar-pixel per
   * GBA frame toward `pokemon.currentHp`, then animates the EXP bar on
   * the player side if it drifted. Resolves when settled. Called in the
   * damage beat (post-hit-flash) and after an EXP/level-up gain.
   */
  refreshHealthbox(side: BattleSide): Promise<void>;
  /**
   * Snap every visible field to the bound Pokemon with no animation.
   * Used on switch-in (the healthbox should appear already-at-current-HP,
   * not drain from full) and before the faint-fall beat.
   */
  refreshHealthboxInstant(side: BattleSide): void;
  /** Phase I substep 2 — typewriter damage number over the target sprite. */
  showDamagePopup(side: BattleSide, amount: number): Promise<void>;

  /**
   * Print a narration line in the in-battle textbox and resolve when the
   * typewriter finishes. The runner awaits this so subsequent animations
   * never overlap the currently-typing message.
   */
  showMessage(text: string): Promise<void>;
  /** Clear the in-battle textbox contents immediately. */
  clearMessage(): void;

  /**
   * Phase D — cheap palette-blend stand-ins for the six most-noticeable
   * GBA palette tricks. None of these are the real palette engine; they are
   * `setTint` + alpha tweens that read as the right thing in motion.
   */
  paralysisFlash(side: BattleSide): void;
  burnPulse(side: BattleSide): void;
  chargeBrighten(side: BattleSide): void;
  setScreen(side: BattleSide, kind: "reflect" | "light_screen", on: boolean): void;
  statusFlash(side: BattleSide, conditionId: number): void;
  /**
   * Stat-change BG overlay. Mirrors `AnimTask_StatsChange` +
   * `InitStatsChangeAnimation` from the FireRed decomp
   * (`src/battle_anim_status_effects.c` / `battle_anim_utility_funcs.c`).
   *
   * The decomp fades a full-screen tilemap mask in on BG1, scrolls it
   * vertically by ±3 px/frame, then fades it out — the palette is
   * chosen per stat (Attack = red, Defense = green, Speed = blue, etc.),
   * and the direction (up/down) picks `stat_tilemap_{1,2}.bin`.
   *
   * A positive `delta` plays the up arrows, negative plays the down
   * arrows. `statId` is the pokedata3g stat id (2..8; 2=Attack, 3=Defense,
   * 4=Sp.Atk, 5=Sp.Def, 6=Speed, 7=Accuracy, 8=Evasion). Multi-stat
   * changes (statId undefined) fall back to the default palette.
   *
   * The renderer kicks off the animation synchronously; the runner
   * paces narration on `STAT_CHANGE_FLASH_FRAMES` so the line types as
   * the tail of the fade-out plays.
   */
  statStageFlash(side: BattleSide, delta: number, statId?: number): void;

  /**
   * Play the ball-release sub-sequence at `pos`: ball-open sprite frames
   * → particle burst → mon scale-in on `side`. Used by both intro beats
   * (opponent send-out step 6 / player send-out step 11 of
   * `BATTLE_SEQUENCE.md`) and, in future, by switch-in send-outs. The
   * renderer resolves once the emerge sub-phase finishes.
   */
  playBallRelease(
    side: BattleSide,
    pos: { x: number; y: number },
    schedule: BallReleaseSchedule,
  ): Promise<void>;

  /**
   * Battle open/close cinematics (see plan.md "Battle intro & outro").
   *
   * The intro is split into three beats so the runner can interleave
   * narration ("The battle begins!" / "Foe sent out X!" / "Go! Y!") with
   * the visual sequence instead of dumping all text after the visual.
   *
   *   1. `playIntroSquareOff` — snap the scene to the initial state
   *      (trainers on-platform, mons hidden). Returns immediately after
   *      the reset so the runner can type the "battle begins" line while
   *      the scene holds the static pose.
   *   2. `playIntroOpponentReveal` — rival trainer slides off and the
   *      opponent mon fades in. Typically awaited concurrently with the
   *      opponent-side send-out narration and the opponent cry.
   *   3. `playIntroPlayerReveal` — player throws the ball, the player mon
   *      materialises, and the player trainer slides off. Typically
   *      awaited concurrently with the player-side send-out narration and
   *      the player cry.
   */
  playIntroSquareOff(schedule: IntroSchedule): Promise<void>;
  playIntroOpponentReveal(schedule: IntroSchedule): Promise<void>;
  playIntroPlayerReveal(schedule: IntroSchedule): Promise<void>;
  playOutro(schedule: OutroSchedule): Promise<void>;

  /**
   * Show the decomp action menu (FIGHT / BAG / POKéMON / RUN) and resolve
   * with the player's choice. The renderer is responsible for rendering
   * the textbox prompt (typically `"What will\n{ACTIVE} do?"` via a
   * `STRINGID_WHATWILLPKMNDO` expansion) plus the 2x2 cursor grid, and
   * handling keyboard input until the player confirms.
   *
   * Mirrors the `HandleInputChooseAction` input loop in FireRed
   * `src/battle_controller_player.c:219-310`.
   */
  promptAction(ctx: ActionPromptCtx): Promise<HudAction>;

  /**
   * Show the 4-slot move menu for the active mon and resolve with the
   * chosen move slot, or `"cancel"` if the player pressed B to back
   * out to the root action menu. Mirrors `HandleInputChooseMove` in
   * the same decomp source.
   */
  promptMove(moves: MoveChoice[]): Promise<{ moveSlot: number } | "cancel">;

  dispose(): void;
}

/**
 * Player-facing choice returned from `renderer.promptAction`. Maps 1:1
 * onto the decomp `B_ACTION_USE_MOVE` / `USE_ITEM` / `SWITCH` / `RUN`
 * constants (`include/constants/battle.h`). `"fight"` is the entry to
 * a subsequent `promptMove` call; the runner stitches the two halves
 * together into a `RuntimeAction`.
 */
export type HudAction = "fight" | "bag" | "pokemon" | "run";

/**
 * Context required to render the "What will X do?" prompt — just the
 * active mon's name (already prefixed + ALL CAPS via `nameWithPrefix`).
 *
 * The decomp's `HandleInputChooseAction` doesn't grey out any slot —
 * all four actions are always selectable. Validation happens after
 * the player picks (e.g. "Can't escape!" on flee attempt in a trainer
 * battle).
 */
export interface ActionPromptCtx {
  activeMonName: string;
}

/**
 * One slot in the 4-entry move menu. `enabled=false` renders the label
 * in the "disabled" palette (no PP, Disabled by Torment, etc) — mirrors
 * `MoveSelectionDisplayMoveNames` in the decomp.
 */
export interface MoveChoice {
  moveSlot: number;
  name: string;
  /** ALL-CAPS type label for the move-info pane ("GRASS", "FIRE", ...). */
  typeName: string;
  currentPp: number;
  maxPp: number;
  enabled: boolean;
}

/** Snapshot of one active Pokemon used by the UI layer. */
export interface ActiveSnapshot {
  name: string;
  level: number;
  currentHp: number;
  maxHp: number;
  speciesId: number;
  formIndex?: number;
  isShiny: boolean;
  isFainted: boolean;
  partyIndex: number;
  /** "male", "female", or null (genderless). */
  gender: "male" | "female" | null;
  /** EXP bar fill fraction (0..1). 1 at level 100. Player-side only. */
  expFraction: number;
  /** Live Pokemon reference so the UI can look up sprites/moves. */
  ref: Pokemon;
}

export interface BattleSnapshot {
  player: ActiveSnapshot;
  opponent: ActiveSnapshot;
  weather: Weather | null;
  turn: number;
  outcome: BattleOutcome | null;
  /** Which side (if any) is waiting for a replacement Pokemon. */
  awaitingReplacement: BattleSide | null;
  /**
   * Trainer vs wild encounter — mirrors `Battle.battleType`. The HUD
   * uses this to decide whether to prefix the opponent's name with
   * "Foe " (trainer battle) or "Wild " (wild encounter), matching the
   * decomp's `HANDLE_NICKNAME_STRING_CASE` macro.
   */
  battleType: "wild" | "trainer";
}

export type BattlePhase =
  | "intro"
  | "playing-events"
  | "waiting-for-input"
  | "awaiting-replacement"
  | "outro"
  | "ended";

/**
 * Events emitted by `BattleRunner` to its subscribers. The UI re-renders
 * from these — it never reads `Battle` directly.
 */
export type RunnerEvent =
  | { type: "snapshot"; snapshot: BattleSnapshot }
  | { type: "phase"; phase: BattlePhase }
  | { type: "narration"; line: string }
  | { type: "available-moves"; moves: number[] }
  | { type: "available-switches"; switches: number[] };

/**
 * A player-initiated action for the current turn. Mirrors pokedata3g's
 * `TurnAction` shape at the level `BattleRunner.submitAction` accepts.
 */
export type RuntimeAction =
  | { type: "move"; moveSlot: number }
  | { type: "switch"; partyIndex: number }
  | { type: "item"; itemId: number; targetIndex: number; moveSlot?: number }
  | { type: "flee" };
