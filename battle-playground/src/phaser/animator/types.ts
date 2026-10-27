/**
 * Shared types for the decomp move-animation interpreter.
 *
 * The interpreter executes a list of AnimCommand objects (from animations.json)
 * inside a MoveAnimContext. Commands can:
 *   - sleep (delay)
 *   - spawn sprites via templates (createsprite)
 *   - run task functions (createvisualtask)
 *   - pause until all in-flight sprites finish (waitforvisualfinish)
 *
 * Each spawned sprite gets a Promise that resolves when the sprite is
 * destroyed so waitforvisualfinish can await all of them at once.
 */
import * as Phaser from "phaser";

export type Battler = "ANIM_ATTACKER" | "ANIM_TARGET" | "ANIM_ATK_PARTNER" | "ANIM_DEF_PARTNER";
export type Side = "player" | "opponent";

/** Runtime position of a battler in scene coordinates (GBA-native, 256x112). */
export interface BattlerPos {
  x: number;
  y: number;
}

/** A live sprite/tween that the interpreter is tracking. */
export interface LiveEntity {
  /** Resolves when the entity finishes (sprite destroyed / task complete). */
  done: Promise<void>;
}

export interface MoveAnimContext {
  scene: Phaser.Scene;
  /** Convert a Battler symbol to the concrete side for this move. */
  attackerSide: Side;
  targetSide: Side;
  /** Battler → position getter (scene-local coords). */
  getBattlerPos: (battler: Battler) => BattlerPos;
  /** The Phaser.GameObject for the attacker/target mon — used by callbacks
   *  that move the mon itself (DoHorizontalLunge, SlideMon*). */
  getBattlerSprite: (battler: Battler) => Phaser.GameObjects.Image | null;

  /** In-flight entities waitforvisualfinish must await. */
  alive: Set<LiveEntity>;

  /** Current createsprite args (mirrors decomp gBattleAnimArgs). */
  args: number[];

  /** Optional subroutines referenced by `call`. */
  subroutines: Record<string, AnimCommand[]>;
}

/** One command from animations.json — shape is `{cmd, ...extras}`. */
export interface AnimCommand {
  cmd: string;
  [key: string]: unknown;
}

/** A handler returns void or a promise the outer loop awaits. */
export type CommandHandler = (
  cmd: AnimCommand,
  ctx: MoveAnimContext,
) => void | Promise<void>;

/** A sprite callback implements one `gXxxSpriteTemplate.callback`. */
export type SpriteCallback = (
  ctx: MoveAnimContext,
  template: ResolvedTemplate,
) => LiveEntity | null;

/** A task callback implements one `AnimTask_Xxx` function. */
export type TaskCallback = (
  ctx: MoveAnimContext,
  args: number[],
) => LiveEntity;

/** Sprite template with concrete frame dims and its first anim sequence. */
export interface ResolvedTemplate {
  name: string;
  tileTag: string;
  textureKey: string; // Phaser texture key after ensureSheetLoaded
  frameWidth: number;
  frameHeight: number;
  anims: { tileOffset: number; duration: number }[][];
  callback: string;
}
