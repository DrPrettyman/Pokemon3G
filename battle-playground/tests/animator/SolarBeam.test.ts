/**
 * Solar Beam — animator trace snapshot.
 *
 * Phase A scaffold. Solar Beam is the canonical two-turn test case:
 * the charge turn should emit brightness ramp ops (Phase D) and the
 * release turn should emit the beam + impact. Phase B wires the real
 * MoveAnimator trace; for now this file exercises the two-call shape.
 */
import { describe, expect, it } from "vitest";
import { FakeClock } from "../support/fakeClock";
import { RecordingRenderer } from "../support/RecordingRenderer";

describe("Solar Beam animation trace", () => {
  it("records a two-turn charge + release", async () => {
    const clock = new FakeClock();
    const renderer = new RecordingRenderer(clock);

    // Turn 1 — charge
    renderer.lunge("player", 0x78c850);
    await renderer.playMoveAnimation(/* solar beam charge */ 76, "player");
    await clock.wait(60);

    // Turn 2 — release + impact
    await renderer.playMoveAnimation(/* solar beam release */ 76, "player");
    renderer.shake("opponent");
    renderer.hitFlash("opponent");

    const ops = renderer.ops.map((o) => o.op);
    expect(ops).toEqual([
      "lunge",
      "playMoveAnimation",
      "playMoveAnimation",
      "shake",
      "hitFlash",
    ]);
    expect(renderer.ops[2].frame).toBe(60);
  });
});
