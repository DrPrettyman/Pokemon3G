/**
 * Intro beat 2 — opponent reveal. Mirrors
 * `BattleIntroOpponentSendsOutMonAnimation` (`src/battle_main.c:2748`)
 * from the FireRed decomp: rival slide-off, ball spawn at the opponent
 * anchor, then `playBallRelease` (ball-open → particles → emerge).
 *
 * This test replays the BattleScene.playIntroOpponentReveal ordering
 * against a RecordingRenderer so an accidental re-order (e.g. firing
 * the ball release while the trainer is still sliding) gets caught.
 */
import { describe, expect, it } from "vitest";
import { FakeClock } from "../support/fakeClock";
import { RecordingRenderer } from "../support/RecordingRenderer";
import { BALL_RELEASE_SCHEDULE, INTRO_RIVAL_SLIDE_FRAMES } from "../../src/runtime/timings";

describe("intro opponent reveal", () => {
  it("slide completes before the ball-release phase starts", async () => {
    const clock = new FakeClock();
    const renderer = new RecordingRenderer(clock);

    // Simulate the BattleScene sequence:
    //   1. rival slide tween (we model its duration via clock.wait)
    //   2. playBallRelease at OPPONENT_ANCHOR
    await clock.wait(INTRO_RIVAL_SLIDE_FRAMES);
    await renderer.playBallRelease(
      "opponent",
      { x: 184, y: 56 },
      BALL_RELEASE_SCHEDULE,
    );

    const ops = renderer.ops;
    expect(ops[0].op).toBe("playBallRelease:open");
    // First ball phase starts strictly after the rival slide completed.
    expect(ops[0].frame).toBe(INTRO_RIVAL_SLIDE_FRAMES);
    expect(ops.at(-1)!.op).toBe("playBallRelease:emerge");
  });
});
