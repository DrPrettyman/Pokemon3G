/**
 * Intro beat 3 — player reveal. Unlike the opponent beat, the player side
 * is a composite: the trainer slide-off runs concurrently with the throw
 * animation and the ball is released mid-throw (frame 2 of 5). This test
 * walks the trace and asserts that `playBallRelease` lands on the player
 * anchor after the ball arc completes — and crucially, after a frame
 * budget smaller than "throw + full slide + arc" would take if the three
 * ran sequentially.
 */
import { describe, expect, it } from "vitest";
import { FakeClock } from "../support/fakeClock";
import { RecordingRenderer } from "../support/RecordingRenderer";
import {
  BALL_ARC_FRAMES,
  BALL_RELEASE_SCHEDULE,
  INTRO_MID_GAP_FRAMES,
  INTRO_PLAYER_SLIDE_FRAMES,
  THROW_ANIM_TOTAL_FRAMES,
} from "../../src/runtime/timings";

describe("intro player reveal", () => {
  it("runs throw + slide concurrently and ball-release lands at PLAYER_ANCHOR", async () => {
    const clock = new FakeClock();
    const renderer = new RecordingRenderer(clock);

    // BattleScene order (decomp-accurate):
    //   mid gap → throw anim (concurrent with slide tween) → arc → ball release
    await clock.wait(INTRO_MID_GAP_FRAMES);
    // Concurrent throw + slide: we wait for max(throw, slide) frames.
    await clock.wait(Math.max(THROW_ANIM_TOTAL_FRAMES, INTRO_PLAYER_SLIDE_FRAMES));
    await clock.wait(BALL_ARC_FRAMES);
    await renderer.playBallRelease(
      "player",
      { x: 64, y: 104 },
      BALL_RELEASE_SCHEDULE,
    );

    const openOp = renderer.ops.find((o) => o.op === "playBallRelease:open")!;
    expect(openOp).toBeDefined();
    expect(openOp.args.side).toBe("player");
    expect(openOp.args.pos).toEqual({ x: 64, y: 104 });

    // Sequential upper bound: throw + slide + arc + release if they ran back
    // to back. Concurrent lower bound: max(throw, slide) + arc + release.
    const sequentialUpper =
      INTRO_MID_GAP_FRAMES +
      THROW_ANIM_TOTAL_FRAMES +
      INTRO_PLAYER_SLIDE_FRAMES +
      BALL_ARC_FRAMES +
      BALL_RELEASE_SCHEDULE.openFrames +
      BALL_RELEASE_SCHEDULE.particleFrames +
      BALL_RELEASE_SCHEDULE.emergeFrames;
    expect(clock.nowFrames()).toBeLessThan(sequentialUpper);
  });
});
