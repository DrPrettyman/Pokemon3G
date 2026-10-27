/**
 * Phaser driver that ticks a sprite through a `spriteMotion` spec.
 *
 * `spriteMotion` exposes pure functions `(spec, frame) => { x, y }`. A
 * driver schedules a `scene.time.addEvent` loop at one GBA frame cadence
 * (`FRAME_MS`), polls the math each tick, writes back to a Phaser sprite,
 * and resolves a promise when the duration elapses. All driver loops
 * respect scene pause/shutdown because they run on `scene.time`.
 *
 * Kept tiny on purpose: the motion math lives in `src/runtime/` so tests
 * can exercise it without booting Phaser, and each sprite callback just
 * chooses a spec + driver. No bespoke tweens in the callbacks.
 */
import * as Phaser from "phaser";
import { FRAME_MS } from "../../runtime/clock";
import type {
  LinearTranslation,
  ArcTranslation,
  ParabolicArc,
  EllipseMotion,
  CircleMotion,
  GrowingCircleMotion,
  ShakeMotion,
} from "../../runtime/spriteMotion";
import {
  linearPositionAt,
  horizontalArcPositionAt,
  verticalArcPositionAt,
  parabolicArcPositionAt,
  ellipsePositionAt,
  circlePositionAt,
  growingCirclePositionAt,
  shakePositionAt,
} from "../../runtime/spriteMotion";

/** Any Phaser display object with mutable `x`/`y`. */
type Movable = Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject;

export interface MotionDriverHandle {
  /** Resolves when the driver completes naturally. */
  done: Promise<void>;
  /** Cancel the driver immediately (resolves the promise). */
  cancel(): void;
}

interface DriveOptions<Spec> {
  scene: Phaser.Scene;
  target: Movable;
  spec: Spec;
  /** Positions → sprite x/y. Defaults to the generic poller for the spec family. */
  positionAt: (spec: Spec, frame: number) => { x: number; y: number };
  /** Optional per-frame hook for custom behavior (alpha, scale, etc.). */
  onFrame?: (frame: number, duration: number) => void;
}

function drive<Spec extends { duration: number }>(
  opts: DriveOptions<Spec>,
): MotionDriverHandle {
  const { scene, target, spec, positionAt, onFrame } = opts;
  let frame = 0;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const duration = Math.max(0, Math.floor(spec.duration));

  // Seed position at frame 0 so there's no flicker before the first tick.
  const seed = positionAt(spec, 0);
  target.x = seed.x;
  target.y = seed.y;
  if (onFrame) onFrame(0, duration);

  if (duration === 0) {
    resolveDone();
    return { done, cancel: () => undefined };
  }

  const timer = scene.time.addEvent({
    delay: FRAME_MS,
    loop: true,
    callback: () => {
      frame++;
      const pos = positionAt(spec, frame);
      target.x = pos.x;
      target.y = pos.y;
      if (onFrame) onFrame(frame, duration);
      if (frame >= duration) {
        timer.remove();
        resolveDone();
      }
    },
  });

  return {
    done,
    cancel: () => {
      timer.remove();
      resolveDone();
    },
  };
}

export function driveLinear(
  scene: Phaser.Scene,
  target: Movable,
  spec: LinearTranslation,
  onFrame?: (f: number, d: number) => void,
): MotionDriverHandle {
  return drive({ scene, target, spec, positionAt: linearPositionAt, onFrame });
}

export function driveHorizontalArc(
  scene: Phaser.Scene,
  target: Movable,
  spec: ArcTranslation,
  onFrame?: (f: number, d: number) => void,
): MotionDriverHandle {
  return drive({
    scene,
    target,
    spec,
    positionAt: horizontalArcPositionAt,
    onFrame,
  });
}

export function driveVerticalArc(
  scene: Phaser.Scene,
  target: Movable,
  spec: ArcTranslation,
  onFrame?: (f: number, d: number) => void,
): MotionDriverHandle {
  return drive({
    scene,
    target,
    spec,
    positionAt: verticalArcPositionAt,
    onFrame,
  });
}

export function driveParabolicArc(
  scene: Phaser.Scene,
  target: Movable,
  spec: ParabolicArc,
  onFrame?: (f: number, d: number) => void,
): MotionDriverHandle {
  return drive({
    scene,
    target,
    spec,
    positionAt: parabolicArcPositionAt,
    onFrame,
  });
}

export function driveEllipse(
  scene: Phaser.Scene,
  target: Movable,
  spec: EllipseMotion,
  onFrame?: (f: number, d: number) => void,
): MotionDriverHandle {
  return drive({ scene, target, spec, positionAt: ellipsePositionAt, onFrame });
}

export function driveCircle(
  scene: Phaser.Scene,
  target: Movable,
  spec: CircleMotion,
  onFrame?: (f: number, d: number) => void,
): MotionDriverHandle {
  return drive({ scene, target, spec, positionAt: circlePositionAt, onFrame });
}

export function driveGrowingCircle(
  scene: Phaser.Scene,
  target: Movable,
  spec: GrowingCircleMotion,
  onFrame?: (f: number, d: number) => void,
): MotionDriverHandle {
  return drive({
    scene,
    target,
    spec,
    positionAt: growingCirclePositionAt,
    onFrame,
  });
}

export function driveShake(
  scene: Phaser.Scene,
  target: Movable,
  spec: ShakeMotion,
): MotionDriverHandle {
  return drive({
    scene,
    target,
    spec: { ...spec, duration: spec.shakeCount * spec.framesPerStep },
    positionAt: (s, f) => shakePositionAt(s as ShakeMotion, f),
  });
}
