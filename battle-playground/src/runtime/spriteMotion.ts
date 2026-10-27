/**
 * Sprite movement physics — TypeScript ports of the decomp's ~40
 * `TranslateSprite*` / `AnimTranslate*` helpers from `battle_anim_mons.c`.
 *
 * The decomp runs one per-frame C callback per sprite and updates the
 * sprite's `x2`/`y2` offsets in integer pixels. Porting those callbacks
 * directly would require every consumer to allocate per-sprite scratch
 * state; instead, this module exposes **pure functions of (spec, frame)**
 * that return the position at frame `t`. The Phaser integration in
 * `src/phaser/animator/motionDriver.ts` drives a per-frame timer that polls
 * these functions and writes back to the Phaser sprite.
 *
 * Keeping the math pure makes it unit-testable and — more importantly —
 * guarantees the runtime engine stays renderer-agnostic (no `phaser`
 * import in `src/runtime/`).
 *
 * ## Families implemented
 *
 *   - **Linear**    `linearPositionAt`      — start→end over N frames.
 *                   Used by projectiles (Water Gun, Ember) and hit splats.
 *   - **Arc**       `horizontalArcPositionAt` / `verticalArcPositionAt` —
 *                   linear motion plus a half-period sin bump on the
 *                   orthogonal axis. Matches the decomp's
 *                   `TranslateAnimHorizontalArc` / `…VerticalArc`.
 *   - **Parabola**  `parabolicArcPositionAt` — linear base with a symmetric
 *                   `4·h·t·(1-t)` peak. Used for falling / bouncing particles.
 *   - **Circle**    `circlePositionAt`      — equal-amplitude sin/cos orbit.
 *   - **Ellipse**   `ellipsePositionAt`     — independent X/Y amplitude
 *                   sin/cos orbit. Matches `TranslateSpriteInEllipse`.
 *   - **Growing**   `growingCirclePositionAt` — circle whose amplitude
 *                   grows each frame (`TranslateSpriteInGrowingCircle`).
 *   - **Slide**     `slidePositionAt`       — same as linear, alias kept
 *                   for call-site clarity when the spec is a bare delta.
 *
 * ## Angle convention
 *
 * The decomp `Sin(idx, amp)` takes an 8-bit angle (`0..255` maps to
 * `0..2π`) and returns `amp * sin(idx)` as a rounded integer. `gbaSin` /
 * `gbaCos` expose that convention so ports can translate line-for-line.
 */

/** Normalize `-0` to `+0` so `toBe(0)` assertions survive rounding. */
function norm(n: number): number {
  return n === 0 ? 0 : n;
}

/** 256-step sine matching the decomp `Sin(idx, amp)` convention. */
export function gbaSin(idx: number, amp: number): number {
  // The decomp table is 256 entries over a full cycle; negative indices
  // wrap — mask with 0xff so callers can pass unbounded counters.
  const i = ((idx % 256) + 256) % 256;
  return norm(Math.round(amp * Math.sin((i / 256) * 2 * Math.PI)));
}

/** 256-step cosine matching the decomp `Cos(idx, amp)` convention. */
export function gbaCos(idx: number, amp: number): number {
  const i = ((idx % 256) + 256) % 256;
  return norm(Math.round(amp * Math.cos((i / 256) * 2 * Math.PI)));
}

/** Clamp `t` to `[0, 1]` and return the linear interpolation fraction. */
function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// ---------------------------------------------------------------------------
//  Linear translation
// ---------------------------------------------------------------------------

export interface LinearTranslation {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** Total frames the motion runs for. */
  duration: number;
}

/**
 * Port of `TranslateSpriteLinear` / `AnimTranslateLinear` — returns the
 * integer pixel position at frame `frame ∈ [0, duration]`.
 */
export function linearPositionAt(
  spec: LinearTranslation,
  frame: number,
): { x: number; y: number } {
  if (spec.duration <= 0) return { x: spec.endX, y: spec.endY };
  const t = clamp01(frame / spec.duration);
  return {
    x: Math.round(spec.startX + (spec.endX - spec.startX) * t),
    y: Math.round(spec.startY + (spec.endY - spec.startY) * t),
  };
}

/**
 * Alias for call-site readability when the spec is a bare delta (e.g. the
 * `SlideMonToOffset` task). The arguments are the same.
 */
export const slidePositionAt = linearPositionAt;

// ---------------------------------------------------------------------------
//  Arc translation (linear + orthogonal sin bump)
// ---------------------------------------------------------------------------

export interface ArcTranslation extends LinearTranslation {
  /**
   * Signed amplitude of the perpendicular sin bump. Positive values push
   * the sprite away from the line connecting start→end in the +axis
   * direction at the midpoint; negative values push it the other way.
   */
  arcAmpl: number;
}

/**
 * Port of `TranslateAnimHorizontalArc` — linear X motion plus a
 * half-period sin bump in Y (0 at the endpoints, max at the midpoint).
 *
 * The decomp ramps the sin index from 0 to 0x80 across the duration:
 * `data[6] = 0x8000 / speed; data[7] += data[6]; Sin(data[7] >> 8, ampl)`.
 * At duration end, `data[7] >> 8` equals `0x80` — i.e. half a cycle.
 */
export function horizontalArcPositionAt(
  spec: ArcTranslation,
  frame: number,
): { x: number; y: number } {
  const base = linearPositionAt(spec, frame);
  const t = clamp01(frame / Math.max(1, spec.duration));
  const angle = Math.floor(0x80 * t);
  return { x: base.x, y: base.y + gbaSin(angle, spec.arcAmpl) };
}

/** Port of `TranslateAnimVerticalArc` — linear Y with a sin bump in X. */
export function verticalArcPositionAt(
  spec: ArcTranslation,
  frame: number,
): { x: number; y: number } {
  const base = linearPositionAt(spec, frame);
  const t = clamp01(frame / Math.max(1, spec.duration));
  const angle = Math.floor(0x80 * t);
  return { x: base.x + gbaSin(angle, spec.arcAmpl), y: base.y };
}

// ---------------------------------------------------------------------------
//  Parabolic arc
// ---------------------------------------------------------------------------

export interface ParabolicArc extends LinearTranslation {
  /** Peak height above the linear baseline, in pixels (positive = upward). */
  peakHeight: number;
}

/**
 * Symmetric parabolic arc: linear base with a `4 · h · t · (1 - t)` bump
 * subtracted from Y (so positive `peakHeight` rises). Used by falling /
 * bouncing particles like `AnimFallingRock` and the Pokeball toss.
 */
export function parabolicArcPositionAt(
  spec: ParabolicArc,
  frame: number,
): { x: number; y: number } {
  const base = linearPositionAt(spec, frame);
  const t = clamp01(frame / Math.max(1, spec.duration));
  const bump = 4 * spec.peakHeight * t * (1 - t);
  return { x: base.x, y: Math.round(base.y - bump) };
}

// ---------------------------------------------------------------------------
//  Ellipse / circle
// ---------------------------------------------------------------------------

export interface EllipseMotion {
  centerX: number;
  centerY: number;
  ampX: number;
  ampY: number;
  /** 256-step angle delta per frame. Decomp's `sCircleSpeed`. */
  angularSpeed: number;
  /** Total frames the motion runs for. */
  duration: number;
  /** Starting 256-step angle (default 0). */
  startAngle?: number;
}

/**
 * Port of `TranslateSpriteInEllipse` — `x = cx + sin(θ)·ampX`,
 * `y = cy + cos(θ)·ampY`, with θ stepping `angularSpeed` per frame.
 * The decomp wraps the angle to `[0, 0x100)` each frame; `gbaSin/Cos`
 * already masks so we don't need an explicit wrap.
 */
export function ellipsePositionAt(
  spec: EllipseMotion,
  frame: number,
): { x: number; y: number } {
  const angle = (spec.startAngle ?? 0) + spec.angularSpeed * frame;
  return {
    x: spec.centerX + gbaSin(angle, spec.ampX),
    y: spec.centerY + gbaCos(angle, spec.ampY),
  };
}

export interface CircleMotion {
  centerX: number;
  centerY: number;
  radius: number;
  angularSpeed: number;
  duration: number;
  startAngle?: number;
}

/** Port of `TranslateSpriteInCircle` — equal X/Y amplitude ellipse. */
export function circlePositionAt(
  spec: CircleMotion,
  frame: number,
): { x: number; y: number } {
  return ellipsePositionAt(
    {
      centerX: spec.centerX,
      centerY: spec.centerY,
      ampX: spec.radius,
      ampY: spec.radius,
      angularSpeed: spec.angularSpeed,
      duration: spec.duration,
      startAngle: spec.startAngle,
    },
    frame,
  );
}

export interface GrowingCircleMotion extends CircleMotion {
  /** Radius delta per frame (fixed-point `data[6] >> 8` in the decomp). */
  amplitudeGrowth: number;
}

/**
 * Port of `TranslateSpriteInGrowingCircle`. The decomp stores amplitude
 * as a fixed-point `data[6]` and reads `(data[6] >> 8) + sAmplitude` each
 * frame; we collapse that to plain integer growth per frame.
 */
export function growingCirclePositionAt(
  spec: GrowingCircleMotion,
  frame: number,
): { x: number; y: number } {
  const radius = spec.radius + Math.round(spec.amplitudeGrowth * frame);
  return circlePositionAt(
    { ...spec, radius },
    frame,
  );
}

// ---------------------------------------------------------------------------
//  Shakes / oscillation
// ---------------------------------------------------------------------------

export interface ShakeMotion {
  /** Anchor X — the sprite returns to this at the end of each half-cycle. */
  anchorX: number;
  anchorY: number;
  amplitudeX: number;
  amplitudeY: number;
  /** Total number of direction flips. */
  shakeCount: number;
  /** Frames per direction flip. */
  framesPerStep: number;
}

/**
 * Square-wave shake — mirrors `AnimTask_ShakeMon`. At each `framesPerStep`
 * boundary the sprite flips to `anchor ± amplitude` on the opposite side.
 * Returns to anchor once `shakeCount` flips have elapsed.
 */
export function shakePositionAt(
  spec: ShakeMotion,
  frame: number,
): { x: number; y: number } {
  const totalFrames = spec.shakeCount * spec.framesPerStep;
  if (frame >= totalFrames || frame < 0) {
    return { x: spec.anchorX, y: spec.anchorY };
  }
  const step = Math.floor(frame / spec.framesPerStep);
  const dir = step % 2 === 0 ? 1 : -1;
  return {
    x: spec.anchorX + spec.amplitudeX * dir,
    y: spec.anchorY + spec.amplitudeY * dir,
  };
}

// ---------------------------------------------------------------------------
//  Construction helpers
// ---------------------------------------------------------------------------

/**
 * Build a `ParabolicArc` that starts at `(sx, sy)`, lands at `(ex, ey)`,
 * and peaks `peakHeight` above the linear midpoint over `duration` frames.
 */
export function buildParabolicArc(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  duration: number,
  peakHeight: number,
): ParabolicArc {
  return {
    startX: sx,
    startY: sy,
    endX: ex,
    endY: ey,
    duration,
    peakHeight,
  };
}

/** Convenience factory mirroring the decomp's `InitAnimLinearTranslation`. */
export function buildLinear(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  duration: number,
): LinearTranslation {
  return {
    startX: sx,
    startY: sy,
    endX: ex,
    endY: ey,
    duration,
  };
}
