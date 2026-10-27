/**
 * `playBallRelease` records the three sub-phases `[open, particles, emerge]`
 * at frame offsets that match `BALL_RELEASE_SCHEDULE` — the renderer driving
 * the intro beats can't re-order these without the test catching it.
 */
import { describe, expect, it } from "vitest";
import { FakeClock } from "../support/fakeClock";
import { RecordingRenderer } from "../support/RecordingRenderer";
import { BALL_RELEASE_SCHEDULE } from "../../src/runtime/timings";

describe("playBallRelease", () => {
  it("records [open, particles, emerge] at the scheduled frame offsets", async () => {
    const clock = new FakeClock();
    const renderer = new RecordingRenderer(clock);
    await renderer.playBallRelease(
      "opponent",
      { x: 184, y: 56 },
      BALL_RELEASE_SCHEDULE,
    );
    const ops = renderer.ops.map((o) => ({ frame: o.frame, op: o.op }));
    expect(ops).toEqual([
      { frame: 0, op: "playBallRelease:open" },
      { frame: BALL_RELEASE_SCHEDULE.openFrames, op: "playBallRelease:particles" },
      {
        frame:
          BALL_RELEASE_SCHEDULE.openFrames + BALL_RELEASE_SCHEDULE.particleFrames,
        op: "playBallRelease:emerge",
      },
    ]);
    expect(clock.nowFrames()).toBe(
      BALL_RELEASE_SCHEDULE.openFrames +
        BALL_RELEASE_SCHEDULE.particleFrames +
        BALL_RELEASE_SCHEDULE.emergeFrames,
    );
  });
});
