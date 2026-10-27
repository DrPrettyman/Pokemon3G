/**
 * Rock Throw — animator trace snapshot.
 *
 * Phase A scaffold: see Tackle.test.ts for the upgrade plan. Phase B
 * replaces the hand-authored ops with a MoveAnimator trace.
 */
import { describe, expect, it } from "vitest";
import { FakeClock } from "../support/fakeClock";
import { RecordingRenderer } from "../support/RecordingRenderer";

describe("Rock Throw animation trace", () => {
  it("records lunge + move + impact", async () => {
    const clock = new FakeClock();
    const renderer = new RecordingRenderer(clock);

    renderer.lunge("opponent", 0xb8a038);
    await renderer.playMoveAnimation(/* rock throw */ 88, "opponent");
    await clock.wait(20);
    renderer.shake("player");
    renderer.hitFlash("player");

    const ops = renderer.ops;
    expect(ops).toHaveLength(4);
    expect(ops[0]).toMatchObject({ op: "lunge", args: { side: "opponent" } });
    expect(ops[1].op).toBe("playMoveAnimation");
    expect(ops[2].op).toBe("shake");
    expect(ops[2].frame).toBe(20);
  });
});
