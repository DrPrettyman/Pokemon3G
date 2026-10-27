/**
 * Tackle — animator trace snapshot.
 *
 * Phase A scaffold: validates the BattleAnimRenderer contract against
 * a hand-authored trace. Phase B will replace the hand-authored
 * sequence with a recorded `MoveAnimator.play()` call against the
 * Tackle animation script, so this file's structure is already right.
 */
import { describe, expect, it } from "vitest";
import { FakeClock } from "../support/fakeClock";
import { RecordingRenderer } from "../support/RecordingRenderer";

describe("Tackle animation trace", () => {
  it("records a lunge + playMoveAnimation + hit sequence", async () => {
    const clock = new FakeClock();
    const renderer = new RecordingRenderer(clock);

    renderer.lunge("player", 0xa8a878);
    await renderer.playMoveAnimation(/* tackle */ 33, "player");
    await clock.wait(14);
    renderer.shake("opponent");
    renderer.hitFlash("opponent");

    expect(renderer.ops.map((o) => o.op)).toEqual([
      "lunge",
      "playMoveAnimation",
      "shake",
      "hitFlash",
    ]);
    expect(renderer.ops[2].frame).toBe(14);
  });
});
