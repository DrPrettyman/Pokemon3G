/**
 * Type-immunity sequencing contract.
 *
 * Decomp: `Cmd_attackanimation` at `battle_script_commands.c:1685`:
 *
 *     if (!(gMoveResultFlags & MOVE_RESULT_NO_EFFECT))
 *         BtlController_EmitMoveAnimation(...);
 *     else
 *         BattleScriptPush(..., BattleScript_Pausex20);
 *
 * A type-immune move skips the animation entirely and pauses 32 frames
 * in its place, then hits `resultmessage` which prints
 * `STRINGID_ITDOESNTAFFECT`. Tackle vs Gastly should NEVER show the
 * Tackle visual.
 *
 * The playground detects this by peeking the event queue: if the next
 * event after `move_used` is an `effectiveness` with `multiplier === 0`,
 * we skip the animation and wait 32 frames in its place.
 */
import { describe, expect, it } from "vitest";
import { FakeClock } from "../support/fakeClock";
import { RecordingRenderer } from "../support/RecordingRenderer";
import { peekMoveOutcome, narrateEvent } from "../../src/runtime/BattleRunner";
import { WAIT_SHORT } from "../../src/runtime/timings";
import type { Battle, BattleEvent } from "pokedata3g";

function stubBattle(): Battle {
  return {
    playerActive: { name: "Bulbasaur" },
    opponentActive: { name: "Gastly" },
    battleType: "trainer",
  } as unknown as Battle;
}

describe("no-effect (type immunity) sequence", () => {
  it("skips the move animation and narrates 'It doesn't affect Foe GASTLY…'", async () => {
    const clock = new FakeClock();
    const renderer = new RecordingRenderer(clock);
    const battle = stubBattle();

    const moveUsed: BattleEvent = {
      type: "move_used",
      side: "player",
      moveId: 33, // Tackle (Normal)
      moveName: "Tackle",
    } as unknown as BattleEvent;
    const noEffectEv: BattleEvent = {
      type: "effectiveness",
      side: "player",
      target: "opponent",
      multiplier: 0,
    } as unknown as BattleEvent;
    const queue: BattleEvent[] = [noEffectEv];

    // 1. narrate-before the move_used line
    const usedLine = narrateEvent(moveUsed, battle)!;
    await renderer.showMessage(usedLine);
    // 2. peekMoveOutcome detects no_effect and skips the animation
    expect(peekMoveOutcome(queue)).toBe("no_effect");
    await clock.wait(WAIT_SHORT); // BattleScript_Pausex20
    // 3. narrate-before the effectiveness line
    const effLine = narrateEvent(queue.shift()!, battle)!;
    await renderer.showMessage(effLine);

    const ops = renderer.ops.map((o) => ({ op: o.op, frame: o.frame, args: o.args }));
    expect(ops.map((o) => o.op)).toEqual(["showMessage", "showMessage"]);
    expect(ops.find((o) => o.op === "playMoveAnimation")).toBeUndefined();
    expect(ops[0].args.text).toBe("BULBASAUR used\nTACKLE!");
    expect(ops[1].args.text).toBe("It doesn't affect\nFoe GASTLY…");
    expect(ops[1].frame - ops[0].frame).toBe(WAIT_SHORT);
  });
});
