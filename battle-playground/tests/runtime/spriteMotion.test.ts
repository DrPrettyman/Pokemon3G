/**
 * Unit tests for the pure-math sprite motion helpers.
 *
 * These run without any Phaser boot: every helper is `(spec, frame) =>
 * { x, y }`, so a `for` loop over frames is enough to verify shape,
 * endpoints, and symmetry invariants.
 */
import { describe, expect, it } from "vitest";
import {
  buildLinear,
  buildParabolicArc,
  circlePositionAt,
  ellipsePositionAt,
  gbaCos,
  gbaSin,
  growingCirclePositionAt,
  horizontalArcPositionAt,
  linearPositionAt,
  parabolicArcPositionAt,
  shakePositionAt,
  verticalArcPositionAt,
} from "../../src/runtime/spriteMotion";

describe("gbaSin / gbaCos — 256-step trig", () => {
  it("hits the cardinal points at indices 0, 64, 128, 192", () => {
    expect(gbaSin(0, 100)).toBe(0);
    expect(gbaSin(64, 100)).toBe(100);
    expect(gbaSin(128, 100)).toBe(0);
    expect(gbaSin(192, 100)).toBe(-100);

    expect(gbaCos(0, 100)).toBe(100);
    expect(gbaCos(64, 100)).toBe(0);
    expect(gbaCos(128, 100)).toBe(-100);
    expect(gbaCos(192, 100)).toBe(0);
  });

  it("wraps negative and overflow indices modulo 256", () => {
    expect(gbaSin(-64, 100)).toBe(-100);
    expect(gbaSin(256, 100)).toBe(0);
    expect(gbaSin(320, 100)).toBe(100);
  });

  it("returns amp=0 for any index when amplitude is zero", () => {
    for (let i = 0; i < 256; i += 17) {
      expect(gbaSin(i, 0)).toBe(0);
      expect(gbaCos(i, 0)).toBe(0);
    }
  });
});

describe("linearPositionAt", () => {
  it("starts at the start and ends at the end", () => {
    const spec = buildLinear(10, 20, 110, 120, 50);
    expect(linearPositionAt(spec, 0)).toEqual({ x: 10, y: 20 });
    expect(linearPositionAt(spec, 50)).toEqual({ x: 110, y: 120 });
  });

  it("hits the midpoint at frame = duration / 2", () => {
    const spec = buildLinear(0, 0, 100, 200, 10);
    expect(linearPositionAt(spec, 5)).toEqual({ x: 50, y: 100 });
  });

  it("clamps frames past duration to the end position", () => {
    const spec = buildLinear(0, 0, 100, 0, 10);
    expect(linearPositionAt(spec, 999)).toEqual({ x: 100, y: 0 });
  });

  it("returns the end position immediately for duration 0", () => {
    const spec = buildLinear(0, 0, 50, 50, 0);
    expect(linearPositionAt(spec, 0)).toEqual({ x: 50, y: 50 });
  });
});

describe("horizontalArcPositionAt / verticalArcPositionAt", () => {
  it("matches linear at the endpoints regardless of arc amplitude", () => {
    const spec = { ...buildLinear(0, 0, 100, 0, 20), arcAmpl: 30 };
    expect(horizontalArcPositionAt(spec, 0)).toEqual({ x: 0, y: 0 });
    expect(horizontalArcPositionAt(spec, 20)).toEqual({ x: 100, y: 0 });
    // Vertical arc puts the bump on X; endpoints still match linear.
    expect(verticalArcPositionAt(spec, 0)).toEqual({ x: 0, y: 0 });
    expect(verticalArcPositionAt(spec, 20)).toEqual({ x: 100, y: 0 });
  });

  it("peaks on the orthogonal axis around the midpoint", () => {
    const spec = { ...buildLinear(0, 0, 100, 0, 20), arcAmpl: 30 };
    const mid = horizontalArcPositionAt(spec, 10);
    expect(mid.x).toBe(50);
    // sin(0x40, 30) = 30 — ramp is 0 → 0x80 over duration, so half of that
    // at frame 10 puts us at idx 0x40, the sin peak.
    expect(mid.y).toBe(30);
  });

  it("horizontal vs vertical arc swap which axis gets the bump", () => {
    const spec = { ...buildLinear(0, 0, 100, 0, 20), arcAmpl: 20 };
    const hMid = horizontalArcPositionAt(spec, 10);
    const vMid = verticalArcPositionAt(spec, 10);
    expect(hMid.x).toBe(50);
    expect(hMid.y).toBe(20);
    expect(vMid.x).toBe(70);
    expect(vMid.y).toBe(0);
  });
});

describe("parabolicArcPositionAt", () => {
  it("peaks exactly at the midpoint", () => {
    const spec = buildParabolicArc(0, 100, 100, 100, 20, 40);
    const mid = parabolicArcPositionAt(spec, 10);
    expect(mid.x).toBe(50);
    // baseline y=100, peakHeight=40 → y = 100 - 4*40*0.5*0.5 = 60
    expect(mid.y).toBe(60);
  });

  it("returns to the linear baseline at the endpoints", () => {
    const spec = buildParabolicArc(0, 100, 100, 200, 10, 30);
    expect(parabolicArcPositionAt(spec, 0)).toEqual({ x: 0, y: 100 });
    expect(parabolicArcPositionAt(spec, 10)).toEqual({ x: 100, y: 200 });
  });

  it("negative peakHeight flips the arc downward", () => {
    const spec = buildParabolicArc(0, 0, 100, 0, 20, -40);
    const mid = parabolicArcPositionAt(spec, 10);
    expect(mid.y).toBe(40);
  });
});

describe("ellipse / circle / growing-circle", () => {
  it("ellipse traces cardinal points of its axes", () => {
    const spec = {
      centerX: 50,
      centerY: 50,
      ampX: 20,
      ampY: 10,
      angularSpeed: 64, // one quarter cycle per frame
      duration: 4,
      startAngle: 0,
    };
    // frame 0: sin=0, cos=1 → (50+0, 50+10) = (50, 60)
    expect(ellipsePositionAt(spec, 0)).toEqual({ x: 50, y: 60 });
    // frame 1 (angle 64): sin=1, cos=0 → (50+20, 50+0) = (70, 50)
    expect(ellipsePositionAt(spec, 1)).toEqual({ x: 70, y: 50 });
    // frame 2 (angle 128): sin=0, cos=-1 → (50+0, 50-10) = (50, 40)
    expect(ellipsePositionAt(spec, 2)).toEqual({ x: 50, y: 40 });
  });

  it("circle is an ellipse with equal X/Y amplitude", () => {
    const spec = {
      centerX: 0,
      centerY: 0,
      radius: 15,
      angularSpeed: 64,
      duration: 4,
    };
    expect(circlePositionAt(spec, 0)).toEqual({ x: 0, y: 15 });
    expect(circlePositionAt(spec, 1)).toEqual({ x: 15, y: 0 });
  });

  it("growing-circle radius increases each frame", () => {
    const spec = {
      centerX: 0,
      centerY: 0,
      radius: 10,
      angularSpeed: 64,
      duration: 8,
      amplitudeGrowth: 2,
    };
    // frame 0: radius = 10 → (0, 10)
    expect(growingCirclePositionAt(spec, 0)).toEqual({ x: 0, y: 10 });
    // frame 1: radius = 12, angle 64 → (12, 0)
    expect(growingCirclePositionAt(spec, 1)).toEqual({ x: 12, y: 0 });
    // frame 2: radius = 14, angle 128 → (0, -14)
    expect(growingCirclePositionAt(spec, 2)).toEqual({ x: 0, y: -14 });
  });
});

describe("shakePositionAt", () => {
  it("flips direction every framesPerStep frames", () => {
    const spec = {
      anchorX: 100,
      anchorY: 50,
      amplitudeX: 4,
      amplitudeY: 0,
      shakeCount: 4,
      framesPerStep: 2,
    };
    expect(shakePositionAt(spec, 0)).toEqual({ x: 104, y: 50 });
    expect(shakePositionAt(spec, 1)).toEqual({ x: 104, y: 50 });
    expect(shakePositionAt(spec, 2)).toEqual({ x: 96, y: 50 });
    expect(shakePositionAt(spec, 3)).toEqual({ x: 96, y: 50 });
    expect(shakePositionAt(spec, 4)).toEqual({ x: 104, y: 50 });
  });

  it("returns to anchor once shakeCount steps have elapsed", () => {
    const spec = {
      anchorX: 10,
      anchorY: 20,
      amplitudeX: 3,
      amplitudeY: 1,
      shakeCount: 3,
      framesPerStep: 2,
    };
    // 3 shakes × 2 frames = 6 total
    expect(shakePositionAt(spec, 6)).toEqual({ x: 10, y: 20 });
    expect(shakePositionAt(spec, 50)).toEqual({ x: 10, y: 20 });
  });
});

describe("integration — linear driver matches per-frame polling", () => {
  it("linearPositionAt at every frame traces a monotonic path", () => {
    const spec = buildLinear(0, 0, 60, 60, 30);
    let last = -1;
    for (let f = 0; f <= 30; f++) {
      const p = linearPositionAt(spec, f);
      expect(p.x).toBeGreaterThanOrEqual(last);
      expect(p.x).toBe(p.y); // symmetric
      last = p.x;
    }
  });
});
