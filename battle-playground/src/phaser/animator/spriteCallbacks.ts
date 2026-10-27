/**
 * TypeScript ports of the most-used decomp sprite-template callback functions.
 *
 * Each callback spawns a Phaser sprite, sets up its motion (tween / timer),
 * and returns a LiveEntity whose `done` promise resolves when the sprite is
 * destroyed. The MoveAnimator tracks these for waitforvisualfinish.
 *
 * Coverage target: the top ~15 callbacks cover ~80% of all createsprite calls
 * across the 355 moves in animations.json.
 */
import * as Phaser from "phaser";
import { tileOffsetToFrameIndex } from "../animLoader";
const TINT_FILL = Phaser.TintModes.FILL;
const TINT_MULTIPLY = Phaser.TintModes.MULTIPLY;
import type {
  LiveEntity,
  MoveAnimContext,
  ResolvedTemplate,
  SpriteCallback,
} from "./types";
import {
  driveParabolicArc,
  driveLinear,
  driveEllipse,
} from "./motionDriver";
import {
  buildParabolicArc,
  buildLinear,
  gbaSin,
} from "../../runtime/spriteMotion";
import { FRAME_MS } from "../../runtime/clock";

/** Convert a decomp animFrame for a template's first anim sequence into a
 *  Phaser frame index. Defaults to frame 0 if the template has no anim. */
function animFrameIndex(tmpl: ResolvedTemplate, seqIndex: number): number {
  const seq = tmpl.anims[seqIndex];
  if (!seq || seq.length === 0) return 0;
  return tileOffsetToFrameIndex(
    seq[0].tileOffset,
    tmpl.frameWidth,
    tmpl.frameHeight,
  );
}

/** Create a sprite and return a LiveEntity tied to its destroy event. */
function spawn(
  ctx: MoveAnimContext,
  tmpl: ResolvedTemplate,
  x: number,
  y: number,
  frameIndex = 0,
): { sprite: Phaser.GameObjects.Sprite; entity: LiveEntity } {
  const sprite = ctx.scene.add
    .sprite(x, y, tmpl.textureKey, frameIndex)
    .setDepth(30);
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  sprite.once(Phaser.GameObjects.Events.DESTROY, resolveDone);
  return { sprite, entity: { done } };
}

// ---------------------------------------------------------------------------
//  Callbacks
// ---------------------------------------------------------------------------

/**
 * AnimFallingRock — rocks falling onto the target in a slight arc.
 *
 * args[0] = x offset from target center
 * args[1] = which anim sequence (rock size / tint variant)
 * args[2] = horizontal drift while falling
 * args[3] = use average battler position (non-zero) or target directly (0)
 */
const AnimFallingRock: SpriteCallback = (ctx, tmpl) => {
  const [xOff = 0, which = 0, hDrift = 0] = ctx.args;
  const target = ctx.getBattlerPos("ANIM_TARGET");
  const startX = target.x + xOff;
  const startY = target.y - 60; // fall from above
  const { sprite, entity } = spawn(ctx, tmpl, startX, startY, animFrameIndex(tmpl, which));
  // Parabolic drop with a small downward peak (negative peakHeight pulls
  // the arc below the straight line, matching the decomp's gravity feel).
  const fall = driveParabolicArc(
    ctx.scene,
    sprite,
    buildParabolicArc(startX, startY, startX + hDrift, target.y - 4, 23, -4),
  );
  fall.done.then(() => {
    ctx.scene.tweens.add({
      targets: sprite,
      alpha: 0,
      y: target.y + 4,
      duration: 180,
      onComplete: () => sprite.destroy(),
    });
  });
  return entity;
};

/**
 * AnimRaiseSprite — sprite rises from below the battler then lingers briefly.
 * Used by Ancient Power etc. Simple upward drift.
 *
 * args[0] = x offset
 * args[1] = animation selector
 * args[2] = target battler (attacker or defender)
 */
const AnimRaiseSprite: SpriteCallback = (ctx, tmpl) => {
  const [xOff = 0, which = 0] = ctx.args;
  const pos = ctx.getBattlerPos("ANIM_TARGET");
  const x = pos.x + xOff;
  const startY = pos.y + 20;
  const { sprite, entity } = spawn(ctx, tmpl, x, startY, animFrameIndex(tmpl, which));
  ctx.scene.tweens.add({
    targets: sprite,
    y: startY - 50,
    alpha: 0,
    duration: 700,
    ease: "Quad.easeOut",
    onComplete: () => sprite.destroy(),
  });
  return entity;
};

/**
 * AnimParticleInVortex — particle swirls around a battler in a rough ellipse.
 * Used by Fire Spin, Sand Tomb, Whirlpool.
 *
 * args[0] = x offset
 * args[1] = y offset
 * args[2] = orbit speed
 * args[3] = duration in frames
 * args[6] = 0 for attacker, 1 for target
 */
const AnimParticleInVortex: SpriteCallback = (ctx, tmpl) => {
  const [xOff = 0, yOff = 0, speed = 4, dur = 40, , , who = 1] = ctx.args;
  const battler: "ANIM_ATTACKER" | "ANIM_TARGET" = who === 0 ? "ANIM_ATTACKER" : "ANIM_TARGET";
  const pos = ctx.getBattlerPos(battler);
  const centerX = pos.x + xOff;
  const centerY = pos.y + yOff;
  const { sprite, entity } = spawn(ctx, tmpl, centerX, centerY);

  // 256-step angle per frame: `speed` in the decomp is raw cycle-fraction
  // units; 4 means ~4/256 of a cycle per frame, i.e. a slow swirl.
  const vortex = driveEllipse(
    ctx.scene,
    sprite,
    {
      centerX,
      centerY,
      ampX: 20,
      ampY: 12,
      angularSpeed: speed,
      duration: dur,
    },
    (frame) => {
      // Vortices drift upward as they orbit — 0.6 px per frame matches the
      // decomp's y2 nudge in `AnimParticleInVortex`.
      sprite.y -= 0.6;
      // No-op to silence unused-arg linter when this lambda is compiled.
      void frame;
    },
  );

  vortex.done.then(() => {
    ctx.scene.tweens.add({
      targets: sprite,
      alpha: 0,
      duration: 180,
      onComplete: () => sprite.destroy(),
    });
  });

  return entity;
};

/**
 * AnimThrowProjectile — the archetypal "projectile flies from attacker to target".
 * Used by Ember, Bubble, Water Gun and many single-hit projectile moves.
 *
 * args[0] = initial x offset from attacker
 * args[1] = initial y offset from attacker
 * args[2] = target x offset
 * args[3] = target y offset
 * args[4] = duration in frames
 */
const AnimThrowProjectile: SpriteCallback = (ctx, tmpl) => {
  const [sxOff = 0, syOff = 0, txOff = 0, tyOff = 0, dur = 20] = ctx.args;
  const start = ctx.getBattlerPos("ANIM_ATTACKER");
  const end = ctx.getBattlerPos("ANIM_TARGET");
  const sx = start.x + sxOff;
  const sy = start.y + syOff;
  const ex = end.x + txOff;
  const ey = end.y + tyOff;
  const { sprite, entity } = spawn(ctx, tmpl, sx, sy);
  const handle = driveLinear(
    ctx.scene,
    sprite,
    buildLinear(sx, sy, ex, ey, dur),
  );
  handle.done.then(() => sprite.destroy());
  return entity;
};

/**
 * AnimHitSplatBasic — the impact splat that flashes on the target when a
 * contact move connects. Very common (>100 uses).
 *
 * args[0] = x offset
 * args[1] = y offset
 */
const AnimHitSplatBasic: SpriteCallback = (ctx, tmpl) => {
  const [xOff = 0, yOff = 0] = ctx.args;
  const target = ctx.getBattlerPos("ANIM_TARGET");
  const { sprite, entity } = spawn(
    ctx,
    tmpl,
    target.x + xOff,
    target.y + yOff,
  );
  sprite.setScale(1.2);
  ctx.scene.tweens.add({
    targets: sprite,
    alpha: 0,
    scale: 0.8,
    duration: 240,
    ease: "Quad.easeOut",
    onComplete: () => sprite.destroy(),
  });
  return entity;
};

/**
 * AnimSpriteOnMonPos — sprite appears on a battler and holds briefly.
 */
const AnimSpriteOnMonPos: SpriteCallback = (ctx, tmpl) => {
  const [xOff = 0, yOff = 0, who = 1] = ctx.args;
  const battler: "ANIM_ATTACKER" | "ANIM_TARGET" = who === 0 ? "ANIM_ATTACKER" : "ANIM_TARGET";
  const pos = ctx.getBattlerPos(battler);
  const { sprite, entity } = spawn(ctx, tmpl, pos.x + xOff, pos.y + yOff);
  ctx.scene.tweens.add({
    targets: sprite,
    alpha: 0,
    duration: 600,
    delay: 200,
    onComplete: () => sprite.destroy(),
  });
  return entity;
};

/**
 * AnimSimplePaletteBlend — the decomp creates an invisible sprite that drives
 * a palette fade to a target color and back. In our renderer we don't have
 * per-palette indexing of mon colors, so we approximate it by flashing the
 * target mon sprite with the blended color via a tweened tint-fill.
 *
 * args[0] = palette selector (bitfield — usually ANIM_PAL_ATK/DEF)
 * args[1] = fade delay in frames
 * args[2] = start blend coefficient (0..16)
 * args[3] = end blend coefficient (0..16)
 * args[4] = blend color (GBA BGR15)
 */
const AnimSimplePaletteBlend: SpriteCallback = (ctx) => {
  const [sel = 0, , , , color = 0x7fff] = ctx.args;
  const hex = gbaToHex(color);
  const sprite = ctx.getBattlerSprite(selectorToBattler(sel, "ANIM_TARGET"));
  if (!sprite) return { done: Promise.resolve() };
  sprite.setTint(hex);
  sprite.setTintMode(TINT_FILL);
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  ctx.scene.tweens.addCounter({
    from: 0,
    to: 1,
    duration: 12 * FRAME_MS,
    yoyo: true,
    onComplete: () => {
      sprite.clearTint();
      sprite.setTintMode(TINT_MULTIPLY);
      resolve();
    },
  });
  return { done };
};

/**
 * AnimComplexPaletteBlend — cycles the palette blend between two y values
 * repeatedly before destroying. In the decomp, `data[1]` is a toggle and
 * `data[2]` counts cycles. We approximate with a repeating yoyo flash.
 *
 * args[0] = palette selector
 * args[1] = delay between flashes (frames)
 * args[2] = cycle count
 * args[3]..[6] = blend params (we use [6] as color)
 */
const AnimComplexPaletteBlend: SpriteCallback = (ctx) => {
  const [sel = 0, delay = 2, cycles = 4, , , , color = 0x7fff] = ctx.args;
  const hex = gbaToHex(color);
  const sprite = ctx.getBattlerSprite(selectorToBattler(sel, "ANIM_TARGET"));
  if (!sprite) return { done: Promise.resolve() };
  sprite.setTint(hex);
  sprite.setTintMode(TINT_FILL);
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  ctx.scene.tweens.addCounter({
    from: 0,
    to: 1,
    duration: Math.max(2, delay) * 2 * FRAME_MS,
    yoyo: true,
    repeat: Math.max(1, cycles) - 1,
    onComplete: () => {
      sprite.clearTint();
      sprite.setTintMode(TINT_MULTIPLY);
      resolve();
    },
  });
  return { done };
};

/**
 * AnimMovePowderParticle — spore/sleep/poison powder particle that drifts
 * downward in a slight sine-wave swish. Lifetime set by args[2].
 *
 * args[0] = x offset around target
 * args[1] = y offset above target
 * args[2] = lifetime in frames
 */
const AnimMovePowderParticle: SpriteCallback = (ctx, tmpl) => {
  const [xOff = 0, yOff = -12, dur = 40] = ctx.args;
  const target = ctx.getBattlerPos("ANIM_TARGET");
  const startX = target.x + xOff;
  const startY = target.y + yOff;
  const { sprite, entity } = spawn(ctx, tmpl, startX, startY);
  let frame = 0;
  const timer = ctx.scene.time.addEvent({
    delay: FRAME_MS,
    loop: true,
    callback: () => {
      frame++;
      sprite.y = startY + frame * 0.8;
      sprite.x = startX + gbaSin(frame * 4, 4);
      if (frame >= dur) {
        timer.remove();
        ctx.scene.tweens.add({
          targets: sprite,
          alpha: 0,
          duration: 120,
          onComplete: () => sprite.destroy(),
        });
      }
    },
  });
  return entity;
};

/**
 * AnimFirePlume — a flame particle bursts outward from the target/attacker,
 * accelerating. Used by Ember, Fire Blast etc.
 *
 * args[0] = x offset
 * args[1] = y offset
 * args[2] = lifetime in frames
 * args[3] = accel duration
 * args[4] = x accel rate (fixed 1/16 px per frame)
 * args[5] = y accel rate
 */
const AnimFirePlume: SpriteCallback = (ctx, tmpl) => {
  const [xOff = 0, yOff = 0, life = 30, , xRate = 2, yRate = -3] = ctx.args;
  const target = ctx.getBattlerPos("ANIM_TARGET");
  const startX = target.x + xOff;
  const startY = target.y + yOff;
  const { sprite, entity } = spawn(ctx, tmpl, startX, startY);
  let frame = 0;
  let vx = 0;
  let vy = 0;
  const timer = ctx.scene.time.addEvent({
    delay: FRAME_MS,
    loop: true,
    callback: () => {
      frame++;
      vx += xRate / 16;
      vy += yRate / 16;
      sprite.x += vx;
      sprite.y += vy;
      if (frame >= life) {
        timer.remove();
        sprite.destroy();
      }
    },
  });
  return entity;
};

/** AnimLargeFlame — identical model to AnimFirePlume but larger sprite. */
const AnimLargeFlame = AnimFirePlume;

/**
 * AnimOverheatFlame — a flame that travels along a vector computed from
 * angle + distance, then fizzles. Uses sin/cos on args[1].
 *
 * args[0] = scale factor (unused in our port)
 * args[1] = angle (0..255)
 * args[2] = distance (fixed 1/16 px per frame)
 * args[3] = duration in frames
 */
const AnimOverheatFlame: SpriteCallback = (ctx, tmpl) => {
  const [, angle = 0, dist = 16, dur = 40] = ctx.args;
  const center = ctx.getBattlerPos("ANIM_ATTACKER");
  const { sprite, entity } = spawn(ctx, tmpl, center.x, center.y);
  const vx = gbaSin(angle + 64, dist) / 16;
  const vy = gbaSin(angle, dist) / 16;
  let frame = 0;
  const timer = ctx.scene.time.addEvent({
    delay: FRAME_MS,
    loop: true,
    callback: () => {
      frame++;
      sprite.x += vx;
      sprite.y += vy;
      if (frame >= dur) {
        timer.remove();
        ctx.scene.tweens.add({
          targets: sprite,
          alpha: 0,
          duration: 120,
          onComplete: () => sprite.destroy(),
        });
      }
    },
  });
  return entity;
};

/**
 * AnimRazorLeafParticle — leaf flies in straight line for args[2] frames,
 * then rotates while drifting upward before expiring.
 *
 * args[0] = x velocity (fixed / 16)
 * args[1] = y velocity (fixed / 16)
 * args[2] = phase-1 duration in frames
 */
const AnimRazorLeafParticle: SpriteCallback = (ctx, tmpl) => {
  const [vx = 6, vy = -2, phase1 = 20] = ctx.args;
  const attacker = ctx.getBattlerPos("ANIM_ATTACKER");
  const { sprite, entity } = spawn(ctx, tmpl, attacker.x, attacker.y);
  const dir = ctx.attackerSide === "player" ? 1 : -1;
  const dx = (vx / 16) * dir;
  const dy = vy / 16;
  let frame = 0;
  const timer = ctx.scene.time.addEvent({
    delay: FRAME_MS,
    loop: true,
    callback: () => {
      frame++;
      sprite.x += dx;
      sprite.y += dy;
      if (frame > phase1) {
        sprite.setRotation(sprite.rotation + 0.2);
        sprite.y -= 0.3;
      }
      if (frame >= phase1 + 60) {
        timer.remove();
        sprite.destroy();
      }
    },
  });
  return entity;
};

/**
 * AnimNeedleArmSpike — straight-line spike from attacker to target with
 * rotation set to face travel direction.
 *
 * args[0] = which mon (attacker=0/target=1)
 * args[1] = travel mode (unused — we always use linear)
 * args[2] = x offset
 * args[3] = y offset
 * args[4] = duration in frames
 */
const AnimNeedleArmSpike: SpriteCallback = (ctx, tmpl) => {
  const [, , xOff = 0, yOff = 0, dur = 16] = ctx.args;
  const start = ctx.getBattlerPos("ANIM_ATTACKER");
  const end = ctx.getBattlerPos("ANIM_TARGET");
  const sx = start.x + xOff;
  const sy = start.y + yOff;
  const ex = end.x;
  const ey = end.y;
  const { sprite, entity } = spawn(ctx, tmpl, sx, sy);
  sprite.setRotation(Math.atan2(ey - sy, ex - sx));
  const handle = driveLinear(ctx.scene, sprite, buildLinear(sx, sy, ex, ey, dur));
  handle.done.then(() => sprite.destroy());
  return entity;
};

/**
 * AnimLightning — a static lightning bolt that plays its sprite animation
 * once then destroys. Decomp keys destruction on `sprite.animEnded`.
 *
 * args[0] = x offset
 * args[1] = y offset
 */
const AnimLightning: SpriteCallback = (ctx, tmpl) => {
  const [xOff = 0, yOff = -16] = ctx.args;
  const target = ctx.getBattlerPos("ANIM_TARGET");
  const { sprite, entity } = spawn(ctx, tmpl, target.x + xOff, target.y + yOff);
  ctx.scene.tweens.add({
    targets: sprite,
    alpha: { from: 1, to: 0 },
    duration: 18 * FRAME_MS,
    onComplete: () => sprite.destroy(),
  });
  return entity;
};

/**
 * AnimBubble — rises upward with side-to-side sway. The decomp uses an
 * affine scale animation on the sprite; we approximate with a tween scale.
 *
 * args[0] = x offset from attacker
 * args[1] = y offset from attacker
 */
const AnimBubble: SpriteCallback = (ctx, tmpl) => {
  const [xOff = 0, yOff = 0] = ctx.args;
  const pos = ctx.getBattlerPos("ANIM_ATTACKER");
  const startX = pos.x + xOff;
  const startY = pos.y + yOff;
  const { sprite, entity } = spawn(ctx, tmpl, startX, startY);
  sprite.setScale(0.6);
  ctx.scene.tweens.add({
    targets: sprite,
    scale: 1.1,
    duration: 40 * FRAME_MS,
  });
  let frame = 0;
  const timer = ctx.scene.time.addEvent({
    delay: FRAME_MS,
    loop: true,
    callback: () => {
      frame++;
      sprite.y = startY - frame * 0.8;
      sprite.x = startX + gbaSin(frame * 6, 3);
      if (frame >= 40) {
        timer.remove();
        ctx.scene.tweens.add({
          targets: sprite,
          alpha: 0,
          duration: 120,
          onComplete: () => sprite.destroy(),
        });
      }
    },
  });
  return entity;
};

/** AnimWaterDrop — same kinematic profile as Bubble, just a different sprite. */
const AnimWaterDrop = AnimBubble;

/** AnimBlackBall — dark orb that flies from attacker to target. Aliased to
 *  the shared projectile path. */
const AnimBlackBall = AnimThrowProjectile;

/** AnimSnowflake — drifts downward toward target with a slight sine sway. */
const AnimSnowflake: SpriteCallback = (ctx, tmpl) => {
  const [xOff = 0, yOff = -40, dur = 50] = ctx.args;
  const target = ctx.getBattlerPos("ANIM_TARGET");
  const startX = target.x + xOff;
  const startY = target.y + yOff;
  const { sprite, entity } = spawn(ctx, tmpl, startX, startY);
  let frame = 0;
  const timer = ctx.scene.time.addEvent({
    delay: FRAME_MS,
    loop: true,
    callback: () => {
      frame++;
      sprite.y = startY + frame * 0.8;
      sprite.x = startX + gbaSin(frame * 3, 6);
      sprite.setRotation(sprite.rotation + 0.05);
      if (frame >= dur) {
        timer.remove();
        sprite.destroy();
      }
    },
  });
  return entity;
};

/**
 * AnimWavyMusicNotes — a musical note that travels toward target while
 * drifting on a sine wave. Used by Sing, Perish Song, Heal Bell, etc.
 *
 * args[0] = which anim sequence (note shape/color)
 * args[1] = palette cycle index (unused here)
 * args[2] = cycle duration in frames
 */
/**
 * SlideMonToOffset — linearly translate the attacker (or target) mon from
 * its current position to `(+x, +y)` over `duration` frames, then
 * leave it there. Used by many contact moves to slide the attacker
 * toward the defender (e.g. Wing Attack, Tackle).
 *
 * Decomp: battle_anim_mon_movement.c `SlideMonToOffset`.
 * args: [who, dx, dy, mirrorV, duration]
 *   who      — 0 = attacker, 1 = target
 *   dx, dy   — pixel offset (dx is mirrored for opponent side;
 *              dy is mirrored iff mirrorV==1)
 *   duration — frames
 */
const SlideMonToOffset: SpriteCallback = (ctx, _tmpl) => {
  const [who = 0, rawDx = 0, rawDy = 0, mirrorV = 0, duration = 1] = ctx.args;
  const battler: "ANIM_ATTACKER" | "ANIM_TARGET" =
    who === 0 ? "ANIM_ATTACKER" : "ANIM_TARGET";
  const side =
    battler === "ANIM_ATTACKER" ? ctx.attackerSide : ctx.targetSide;
  const mon = ctx.getBattlerSprite(battler);
  if (!mon) return null;
  const dx = side === "opponent" ? -rawDx : rawDx;
  const dy = side === "opponent" && mirrorV === 1 ? -rawDy : rawDy;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  ctx.scene.tweens.add({
    targets: mon,
    x: mon.x + dx,
    y: mon.y + dy,
    duration: Math.max(1, duration) * FRAME_MS,
    ease: "Linear",
    onComplete: () => resolveDone(),
  });
  return { done };
};

/**
 * SlideMonToOriginalPos — return the attacker/target mon from its current
 * offset back to its anchor over `duration` frames. Pairs with
 * `SlideMonToOffset` to finish a contact lunge.
 *
 * Decomp: battle_anim_mon_movement.c `SlideMonToOriginalPos`.
 * args: [who, axisMask, duration]
 *   who      — 0 = attacker, 1 = target
 *   axisMask — 0 reset both axes, 1 reset only x, 2 reset only y
 *   duration — frames
 */
const SlideMonToOriginalPos: SpriteCallback = (ctx, _tmpl) => {
  const [who = 0, axisMask = 0, duration = 1] = ctx.args;
  const battler: "ANIM_ATTACKER" | "ANIM_TARGET" =
    who === 0 ? "ANIM_ATTACKER" : "ANIM_TARGET";
  const mon = ctx.getBattlerSprite(battler);
  if (!mon) return null;
  const anchor = ctx.getBattlerPos(battler);
  // axisMask bits: 0 = reset both, 1 = reset x only, 2 = reset y only
  const toX = axisMask === 2 ? mon.x : anchor.x;
  const toY = axisMask === 1 ? mon.y : anchor.y;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  ctx.scene.tweens.add({
    targets: mon,
    x: toX,
    y: toY,
    duration: Math.max(1, duration) * FRAME_MS,
    ease: "Linear",
    onComplete: () => resolveDone(),
  });
  return { done };
};

const AnimWavyMusicNotes: SpriteCallback = (ctx, tmpl) => {
  const [which = 0, , cycle = 40] = ctx.args;
  const start = ctx.getBattlerPos("ANIM_ATTACKER");
  const end = ctx.getBattlerPos("ANIM_TARGET");
  const { sprite, entity } = spawn(
    ctx,
    tmpl,
    start.x,
    start.y,
    animFrameIndex(tmpl, which),
  );
  const dur = Math.max(20, cycle);
  const baseY = start.y;
  const dx = (end.x - start.x) / dur;
  const dy = (end.y - start.y) / dur;
  let frame = 0;
  const timer = ctx.scene.time.addEvent({
    delay: FRAME_MS,
    loop: true,
    callback: () => {
      frame++;
      sprite.x = start.x + dx * frame;
      sprite.y = baseY + dy * frame + gbaSin(frame * 8, 6);
      if (frame >= dur) {
        timer.remove();
        sprite.destroy();
      }
    },
  });
  return entity;
};

// ---------------------------------------------------------------------------
//  Palette-blend helpers
// ---------------------------------------------------------------------------

/** GBA BGR15 (0bbbbbgggggrrrrr) → web RGB888. */
function gbaToHex(bgr15: number): number {
  const r = ((bgr15 >> 0) & 0x1f) << 3;
  const g = ((bgr15 >> 5) & 0x1f) << 3;
  const b = ((bgr15 >> 10) & 0x1f) << 3;
  return (r << 16) | (g << 8) | b;
}

/** Pick which battler a palette selector bitfield is targeting. The decomp
 *  selectors are bitfields over `ANIM_PAL_*` — we only care about whether the
 *  attacker or defender bit is set; fall back to the supplied default. */
function selectorToBattler(
  selector: number,
  fallback: "ANIM_ATTACKER" | "ANIM_TARGET",
): "ANIM_ATTACKER" | "ANIM_TARGET" {
  // Bits 7..8 in the decomp mark attacker/target palettes respectively.
  const attackerBit = (selector & (1 << 7)) !== 0;
  const targetBit = (selector & (1 << 8)) !== 0;
  if (targetBit && !attackerBit) return "ANIM_TARGET";
  if (attackerBit && !targetBit) return "ANIM_ATTACKER";
  return fallback;
}

/**
 * Fallback for unknown sprite-template callbacks.
 *
 * The decomp has ~290 unique sprite callbacks; ~52 are ported in this file.
 * Until the rest land, every un-ported template used to get a 260ms static
 * fade-out here, which read on screen as a one-frame flash — the tornado on
 * Wing Attack, the ice shard on Ice Beam, the claw on Slash, etc. all died
 * before a player could even perceive them.
 *
 * This improved fallback at least cycles the template's first anim sequence
 * through its intended per-frame durations so the user sees the sprite's
 * real appearance instead of a static flash. It does not replicate the
 * decomp's sprite motion (tweens, arcs, oscillations) — porting the exact
 * callback is still required for correct spatial behaviour. The sprite is
 * anchored at ANIM_TARGET; it plays the sequence once, lingers for a few
 * frames, then fades out.
 */
const FallbackFlash: SpriteCallback = (ctx, tmpl) => {
  const target = ctx.getBattlerPos("ANIM_TARGET");
  const { sprite, entity } = spawn(ctx, tmpl, target.x, target.y);

  const seq = (tmpl.anims ?? []).find((s) => s && s.length > 0);
  if (!seq || seq.length === 0) {
    // No anim data at all — keep the legacy 260ms fade-out.
    ctx.scene.tweens.add({
      targets: sprite,
      alpha: 0,
      duration: 260,
      onComplete: () => sprite.destroy(),
    });
    return entity;
  }

  // Build a one-shot Phaser animation from the decomp sequence. Each entry
  // is `{tileOffset, duration}` where duration is GBA frames (~16.67ms).
  // Phaser's Animation.frames takes per-frame durations in milliseconds.
  const frames = seq.map((f) => ({
    key: tmpl.textureKey,
    frame: tileOffsetToFrameIndex(f.tileOffset, tmpl.frameWidth, tmpl.frameHeight),
    duration: Math.max(1, f.duration) * FRAME_MS,
  }));
  const animKey = `fallback:${tmpl.name}`;
  if (!ctx.scene.anims.exists(animKey)) {
    ctx.scene.anims.create({
      key: animKey,
      frames,
      repeat: 0,
    });
  }
  sprite.play(animKey);
  sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
    ctx.scene.tweens.add({
      targets: sprite,
      alpha: 0,
      duration: 120,
      onComplete: () => sprite.destroy(),
    });
  });
  return entity;
};

export const SPRITE_CALLBACKS: Record<string, SpriteCallback> = {
  AnimFallingRock,
  AnimRockFragment: AnimFallingRock,
  AnimRockTomb: AnimFallingRock,
  AnimRockBlastRock: AnimFallingRock,
  AnimRockScatter: AnimFallingRock,
  AnimRaiseSprite,
  AnimWeatherBallDown: AnimRaiseSprite,
  AnimParticleInVortex,
  AnimThrowProjectile,
  AnimHitSplatBasic,
  AnimSpriteOnMonPos,
  AnimSimplePaletteBlend,
  AnimComplexPaletteBlend,
  AnimMovePowderParticle,
  AnimFirePlume,
  AnimLargeFlame,
  AnimFireSpiralInward: AnimFirePlume,
  AnimDragonFireToTarget: AnimFirePlume,
  AnimOverheatFlame,
  AnimRazorLeafParticle,
  AnimLeafBlade: AnimRazorLeafParticle,
  AnimTwister: AnimParticleInVortex,
  AnimNeedleArmSpike,
  AnimLightning,
  AnimSparkElectricityFlashing: AnimLightning,
  AnimBubble,
  AnimSmallBubblePair: AnimBubble,
  AnimWaterDrop,
  AnimBlackBall,
  AnimBlackSmoke: AnimRaiseSprite,
  AnimSnowflake,
  AnimWavyMusicNotes,
  AnimPerishSongMusicNote: AnimWavyMusicNotes,
  AnimHealBellMusicNote: AnimWavyMusicNotes,
  SlideMonToOffset,
  SlideMonToOffsetAndBack: SlideMonToOffset,
  SlideMonToOriginalPos,
};

export function getSpriteCallback(name: string): SpriteCallback {
  return SPRITE_CALLBACKS[name] ?? FallbackFlash;
}
