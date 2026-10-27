/**
 * TypeScript ports of the most-used `createvisualtask` / `AnimTask_*` functions
 * from the decomp. Tasks operate on the battler mon sprites directly (shake,
 * slide, tint, blend) rather than spawning particles.
 *
 * Each task starts its work immediately and returns a LiveEntity whose
 * `done` promise resolves when the work finishes.
 */
import * as Phaser from "phaser";
import type { LiveEntity, TaskCallback } from "./types";
import { driveLinear, driveShake } from "./motionDriver";
import { buildLinear, gbaSin } from "../../runtime/spriteMotion";
import { FRAME_MS } from "../../runtime/clock";

function makeEntity(done: Promise<void>): LiveEntity {
  return { done };
}

/**
 * AnimTask_ShakeMon — shake a battler's sprite N times.
 *
 * args[0] = battler (0 = attacker, 1 = target)
 * args[1] = x pixels
 * args[2] = y pixels
 * args[3] = total shakes
 * args[4] = frames per shake
 */
const AnimTask_ShakeMon: TaskCallback = (ctx, args) => {
  const [who = 1, xPx = 3, yPx = 0, shakes = 8, framesPer = 2] = args;
  const battler = who === 0 ? "ANIM_ATTACKER" : "ANIM_TARGET";
  const sprite = ctx.getBattlerSprite(battler);
  if (!sprite) return makeEntity(Promise.resolve());

  const origX = sprite.x;
  const origY = sprite.y;
  const handle = driveShake(ctx.scene, sprite, {
    anchorX: origX,
    anchorY: origY,
    amplitudeX: xPx,
    amplitudeY: yPx,
    shakeCount: shakes,
    framesPerStep: framesPer,
  });
  return makeEntity(handle.done);
};

/**
 * AnimTask_ShakeMonInPlace — like ShakeMon but doesn't reset position each tick.
 * Subtler, used for "reeling from impact" effects.
 */
const AnimTask_ShakeMonInPlace: TaskCallback = (ctx, args) => {
  return AnimTask_ShakeMon(ctx, args);
};

/**
 * DoHorizontalLunge — attacker mon lunges toward the target and back.
 *
 * args[0] = distance in pixels
 * args[1] = frames for the lunge
 */
const DoHorizontalLunge: TaskCallback = (ctx, args) => {
  const [distance = 12, frames = 4] = args;
  const sprite = ctx.getBattlerSprite("ANIM_ATTACKER");
  if (!sprite) return makeEntity(Promise.resolve());

  const origX = sprite.x;
  const origY = sprite.y;
  // Player attacks rightward, opponent leftward.
  const dir = ctx.attackerSide === "player" ? 1 : -1;
  const dx = distance * dir;
  const dy = dir > 0 ? -6 : 6;
  const duration = frames * 16.67;

  return makeEntity(
    new Promise<void>((resolve) => {
      ctx.scene.tweens.add({
        targets: sprite,
        x: origX + dx,
        y: origY + dy,
        duration,
        ease: "Sine.easeOut",
        yoyo: true,
        onComplete: () => {
          sprite.x = origX;
          sprite.y = origY;
          resolve();
        },
      });
    }),
  );
};

/** SlideMonToOffset — slide a mon by args[0], args[1] over args[2] frames. */
const SlideMonToOffset: TaskCallback = (ctx, args) => {
  const [dx = 0, dy = 0, frames = 8, who = 0] = args;
  const battler = who === 0 ? "ANIM_ATTACKER" : "ANIM_TARGET";
  const sprite = ctx.getBattlerSprite(battler);
  if (!sprite) return makeEntity(Promise.resolve());
  const handle = driveLinear(
    ctx.scene,
    sprite,
    buildLinear(sprite.x, sprite.y, sprite.x + dx, sprite.y + dy, frames),
  );
  return makeEntity(handle.done);
};

/** SlideMonToOriginalPos — inverse of SlideMonToOffset. Stored offsets aren't
 *  persisted, so we slide back to the battler's platform anchor. */
const SlideMonToOriginalPos: TaskCallback = (ctx, args) => {
  const [frames = 8, who = 0] = args;
  const battler = who === 0 ? "ANIM_ATTACKER" : "ANIM_TARGET";
  const sprite = ctx.getBattlerSprite(battler);
  if (!sprite) return makeEntity(Promise.resolve());
  const target = ctx.getBattlerPos(battler);
  const handle = driveLinear(
    ctx.scene,
    sprite,
    buildLinear(sprite.x, sprite.y, target.x, target.y, frames),
  );
  return makeEntity(handle.done);
};

/**
 * AnimTask_ShakeMon2 — identical contract to ShakeMon but used for stronger
 * shakes (decomp splits the two for different damage tiers). We reuse the
 * same driver.
 */
const AnimTask_ShakeMon2: TaskCallback = (ctx, args) => {
  return AnimTask_ShakeMon(ctx, args);
};

/**
 * GBA BGR15 color → web RGB hex. Tasks accept a raw BGR15 word in args.
 */
function bgr15ToHex(bgr15: number): number {
  const r = ((bgr15 >> 0) & 0x1f) << 3;
  const g = ((bgr15 >> 5) & 0x1f) << 3;
  const b = ((bgr15 >> 10) & 0x1f) << 3;
  return (r << 16) | (g << 8) | b;
}

/** Which battler is affected by a palette-selector bitfield. Bits 7..10
 *  mark mon palettes in the decomp. If no mon bit is set, both mons get the
 *  blend (background-only blends are approximated by flashing both). */
function selectedBattlers(
  ctx: {
    getBattlerSprite: (
      b: "ANIM_ATTACKER" | "ANIM_TARGET",
    ) => Phaser.GameObjects.Image | null;
  },
  selector: number,
): Phaser.GameObjects.Image[] {
  const out: Phaser.GameObjects.Image[] = [];
  const atkBit = (selector & (1 << 7)) !== 0;
  const defBit = (selector & (1 << 8)) !== 0;
  if (atkBit || !(atkBit || defBit)) {
    const s = ctx.getBattlerSprite("ANIM_ATTACKER");
    if (s) out.push(s);
  }
  if (defBit || !(atkBit || defBit)) {
    const s = ctx.getBattlerSprite("ANIM_TARGET");
    if (s) out.push(s);
  }
  return out;
}

/** Wrap a `setTint`+`setTintFill` flash behind a yoyo counter tween and
 *  resolve when it completes. Shared by all the palette-blend tasks. */
function flashSprites(
  ctx: Parameters<TaskCallback>[0],
  sprites: Phaser.GameObjects.Image[],
  hex: number,
  frames: number,
  repeat = 0,
): LiveEntity {
  if (sprites.length === 0) return makeEntity(Promise.resolve());
  sprites.forEach((s) => {
    s.setTint(hex);
    s.setTintMode(Phaser.TintModes.FILL);
  });
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  ctx.scene.tweens.addCounter({
    from: 0,
    to: 1,
    duration: frames * FRAME_MS,
    yoyo: true,
    repeat,
    onComplete: () => {
      sprites.forEach((s) => {
        s.clearTint();
        s.setTintMode(Phaser.TintModes.MULTIPLY);
      });
      resolve();
    },
  });
  return makeEntity(done);
}

/**
 * AnimTask_BlendBattleAnimPal — blends the selected mon palette to a color.
 *
 * args[0] = palette selector
 * args[1] = start blend (0..16, ignored)
 * args[2] = end blend (0..16, ignored)
 * args[3] = fade frames
 * args[4] = color (BGR15)
 */
const AnimTask_BlendBattleAnimPal: TaskCallback = (ctx, args) => {
  const [sel = 0, , , frames = 8, color = 0x7fff] = args;
  return flashSprites(ctx, selectedBattlers(ctx, sel), bgr15ToHex(color), frames);
};

/** AnimTask_BlendBattleAnimPalExclude — same as above, but selector is an
 *  exclusion mask in the decomp. We treat it identically. */
const AnimTask_BlendBattleAnimPalExclude = AnimTask_BlendBattleAnimPal;

/**
 * AnimTask_BlendColorCycle — repeatedly blends target palette toward a color
 * and back.
 *
 * args[0] = palette selector
 * args[1] = delay (frames per half-cycle)
 * args[2] = cycles
 * args[5] = color (BGR15)
 */
const AnimTask_BlendColorCycle: TaskCallback = (ctx, args) => {
  const [sel = 0, delay = 2, cycles = 3, , , color = 0x7fff] = args;
  return flashSprites(
    ctx,
    selectedBattlers(ctx, sel),
    bgr15ToHex(color),
    Math.max(2, delay),
    Math.max(1, cycles) - 1,
  );
};

/** AnimTask_BlendMonInAndOut — one-off fade of a battler mon to a color
 *  and back. */
const AnimTask_BlendMonInAndOut: TaskCallback = (ctx, args) => {
  const [who = 1, color = 0x7fff, , , cycles = 1] = args;
  const battler = who === 0 ? "ANIM_ATTACKER" : "ANIM_TARGET";
  const sprite = ctx.getBattlerSprite(battler);
  if (!sprite) return makeEntity(Promise.resolve());
  return flashSprites(ctx, [sprite], bgr15ToHex(color), 6, Math.max(1, cycles) - 1);
};

/** AnimTask_InvertScreenColor — one-frame white flash on all battlers. */
const AnimTask_InvertScreenColor: TaskCallback = (ctx) => {
  const sprites: Phaser.GameObjects.Image[] = [];
  const a = ctx.getBattlerSprite("ANIM_ATTACKER");
  const t = ctx.getBattlerSprite("ANIM_TARGET");
  if (a) sprites.push(a);
  if (t) sprites.push(t);
  return flashSprites(ctx, sprites, 0xffffff, 4);
};

/** AnimTask_SetGrayscaleOrOriginalPal — desaturate a mon for the rest of
 *  the script or restore it. We approximate with a persistent gray tint. */
const AnimTask_SetGrayscaleOrOriginalPal: TaskCallback = (ctx, args) => {
  const [who = 1, grayFlag = 1] = args;
  const battler = who % 2 === 0 ? "ANIM_ATTACKER" : "ANIM_TARGET";
  const sprite = ctx.getBattlerSprite(battler);
  if (!sprite) return makeEntity(Promise.resolve());
  if (grayFlag) {
    sprite.setTint(0x808080);
    sprite.setTintMode(Phaser.TintModes.MULTIPLY);
  } else {
    sprite.clearTint();
  }
  return makeEntity(Promise.resolve());
};

/**
 * AnimTask_ScaleMonAndRestore — scale a mon sprite by a delta, hold, then
 * restore. decomp stores deltas in 1/256 units; we convert to a multiplier.
 *
 * args[0] = x scale delta
 * args[1] = y scale delta
 * args[2] = duration in frames
 * args[3] = battler
 */
const AnimTask_ScaleMonAndRestore: TaskCallback = (ctx, args) => {
  const [dx = 0x20, dy = 0x20, dur = 8, who = 1] = args;
  const battler = who === 0 ? "ANIM_ATTACKER" : "ANIM_TARGET";
  const sprite = ctx.getBattlerSprite(battler);
  if (!sprite) return makeEntity(Promise.resolve());
  const origX = sprite.scaleX;
  const origY = sprite.scaleY;
  const targetX = origX + dx / 256;
  const targetY = origY + dy / 256;
  return makeEntity(
    new Promise<void>((resolve) => {
      ctx.scene.tweens.add({
        targets: sprite,
        scaleX: targetX,
        scaleY: targetY,
        duration: dur * FRAME_MS,
        yoyo: true,
        onComplete: () => {
          sprite.setScale(origX, origY);
          resolve();
        },
      });
    }),
  );
};

/**
 * AnimTask_SwayMon — mon sways on an axis in a sine pattern for N cycles.
 *
 * args[0] = axis (0=x, 1=y)
 * args[1] = amplitude pixels
 * args[2] = wave speed (angle advance per frame)
 * args[3] = number of cycles
 * args[4] = battler
 */
const AnimTask_SwayMon: TaskCallback = (ctx, args) => {
  const [axis = 0, amp = 4, speed = 6, cycles = 2, who = 1] = args;
  const battler = who === 0 ? "ANIM_ATTACKER" : "ANIM_TARGET";
  const sprite = ctx.getBattlerSprite(battler);
  if (!sprite) return makeEntity(Promise.resolve());
  const origX = sprite.x;
  const origY = sprite.y;
  const duration = Math.max(1, cycles) * Math.ceil(256 / Math.max(1, speed));
  let frame = 0;
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  const timer = ctx.scene.time.addEvent({
    delay: FRAME_MS,
    loop: true,
    callback: () => {
      frame++;
      const off = gbaSin(frame * speed, amp);
      sprite.x = axis === 0 ? origX + off : origX;
      sprite.y = axis === 1 ? origY + off : origY;
      if (frame >= duration) {
        timer.remove();
        sprite.x = origX;
        sprite.y = origY;
        resolve();
      }
    },
  });
  return makeEntity(done);
};

/**
 * AnimTask_RotateMonSpriteToSide — rotate a mon sprite to a target angle,
 * optionally holding or restoring.
 *
 * args[0] = rotation amount (decomp: 1/65536 rotations ≈ 360°/65536)
 * args[1] = frames
 * args[2] = battler
 * args[3] = restore flag
 */
const AnimTask_RotateMonSpriteToSide: TaskCallback = (ctx, args) => {
  const [rotAmount = 4096, frames = 12, who = 0, restore = 0] = args;
  const battler = who === 0 ? "ANIM_ATTACKER" : "ANIM_TARGET";
  const sprite = ctx.getBattlerSprite(battler);
  if (!sprite) return makeEntity(Promise.resolve());
  const dir = ctx.attackerSide === "player" ? 1 : -1;
  const target = sprite.rotation + (rotAmount / 65536) * Math.PI * 2 * dir;
  const origRotation = sprite.rotation;
  return makeEntity(
    new Promise<void>((resolve) => {
      ctx.scene.tweens.add({
        targets: sprite,
        rotation: target,
        duration: frames * FRAME_MS,
        yoyo: restore !== 0,
        onComplete: () => {
          if (restore !== 0) sprite.setRotation(origRotation);
          resolve();
        },
      });
    }),
  );
};

/**
 * AnimTask_HorizontalShake — shake the target (or everything) horizontally.
 *
 * args[0] = target type (0=attacker, 1=target, MAX_BATTLERS=all terrain)
 * args[1] = shake distance
 * args[2] = duration in frames
 */
const AnimTask_HorizontalShake: TaskCallback = (ctx, args) => {
  const [who = 1, dist = 4, dur = 16] = args;
  const battler = who === 0 ? "ANIM_ATTACKER" : "ANIM_TARGET";
  const sprite = ctx.getBattlerSprite(battler);
  if (!sprite) return makeEntity(Promise.resolve());
  const origX = sprite.x;
  const origY = sprite.y;
  const handle = driveShake(ctx.scene, sprite, {
    anchorX: origX,
    anchorY: origY,
    amplitudeX: dist,
    amplitudeY: 0,
    shakeCount: Math.max(2, Math.floor(dur / 2)),
    framesPerStep: 2,
  });
  return makeEntity(handle.done);
};

/** AnimTask_ShakeTargetBasedOnMovePowerOrDmg — maps onto ShakeMon in our port
 *  (we don't track exact damage-proportional amplitude). */
const AnimTask_ShakeTargetBasedOnMovePowerOrDmg = AnimTask_ShakeMon;

/** AnimTask_ShakeBattleTerrain — shakes both battlers as a stand-in for the
 *  full terrain/BG shake the decomp performs on BG layer sprites. */
const AnimTask_ShakeBattleTerrain: TaskCallback = (ctx, args) => {
  const [dist = 4, dur = 20] = args;
  const a = ctx.getBattlerSprite("ANIM_ATTACKER");
  const t = ctx.getBattlerSprite("ANIM_TARGET");
  const handles: Promise<void>[] = [];
  [a, t].forEach((sprite) => {
    if (!sprite) return;
    const handle = driveShake(ctx.scene, sprite, {
      anchorX: sprite.x,
      anchorY: sprite.y,
      amplitudeX: dist,
      amplitudeY: 0,
      shakeCount: Math.max(2, Math.floor(dur / 2)),
      framesPerStep: 2,
    });
    handles.push(handle.done);
  });
  return makeEntity(Promise.all(handles).then(() => undefined));
};

/** Fallback no-op for unknown task functions — completes immediately. */
const FallbackTask: TaskCallback = () => makeEntity(Promise.resolve());

export const TASK_CALLBACKS: Record<string, TaskCallback> = {
  AnimTask_ShakeMon,
  AnimTask_ShakeMon2,
  AnimTask_ShakeMonInPlace,
  AnimTask_ShakeTargetInPattern: AnimTask_ShakeMon,
  AnimTask_ShakeTargetBasedOnMovePowerOrDmg,
  AnimTask_ShakeBattleTerrain,
  AnimTask_HorizontalShake,
  AnimTask_BlendBattleAnimPal,
  AnimTask_BlendBattleAnimPalExclude,
  AnimTask_BlendColorCycle,
  AnimTask_BlendMonInAndOut,
  AnimTask_InvertScreenColor,
  AnimTask_SetGrayscaleOrOriginalPal,
  AnimTask_ScaleMonAndRestore,
  AnimTask_SwayMon,
  AnimTask_RotateMonSpriteToSide,
  DoHorizontalLunge,
  SlideMonToOffset,
  SlideMonToOriginalPos,
};

export function getTaskCallback(name: string): TaskCallback {
  return TASK_CALLBACKS[name] ?? FallbackTask;
}
