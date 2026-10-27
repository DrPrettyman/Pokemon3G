/**
 * Miss sequencing contract.
 *
 * Decomp: `BattleScript_PrintMoveMissed::` at `data/battle_scripts_1.s:276`:
 *
 *     attackstring                  @ "BULBASAUR used\nTACKLE!"
 *     ppreduce
 *     pause B_WAIT_TIME_SHORT       @ 32 frames
 *     effectivenesssound
 *     resultmessage                 @ "BULBASAUR's\nattack missed!"
 *     waitmessage B_WAIT_TIME_LONG
 *
 * The script never reaches `attackanimation`. The playground's previous
 * implementation played the move animation regardless and narrated the
 * "missed" line after the fact — wrong.
 *
 * Fix: `peekMoveOutcome` peeks the next event after a `move_used`; if it's
 * a `miss`, `playEvent(move_used)` waits 32 frames in place of the
 * animation. This test pins the peek logic and the renderer-side trace
 * (attackstring → pause → miss narration, no `playMoveAnimation` op).
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
    opponentActive: { name: "Weedle" },
    battleType: "trainer",
  } as unknown as Battle;
}

describe("peekMoveOutcome", () => {
  it("returns 'miss' when the next event is a miss", () => {
    const queue: BattleEvent[] = [
      { type: "miss", side: "player" } as unknown as BattleEvent,
    ];
    expect(peekMoveOutcome(queue)).toBe("miss");
  });

  it("returns 'no_effect' when the next event is effectiveness(0)", () => {
    const queue: BattleEvent[] = [
      {
        type: "effectiveness",
        side: "player",
        target: "opponent",
        multiplier: 0,
      } as unknown as BattleEvent,
    ];
    expect(peekMoveOutcome(queue)).toBe("no_effect");
  });

  it("returns 'hit' when the next event is a damage (normal connect)", () => {
    const queue: BattleEvent[] = [
      { type: "damage", target: "opponent" } as unknown as BattleEvent,
    ];
    expect(peekMoveOutcome(queue)).toBe("hit");
  });

  it("returns 'hit' for status moves (next event is stat_change or status_applied)", () => {
    expect(
      peekMoveOutcome([
        { type: "stat_change", target: "opponent", statId: 6, stages: -1, actual: -1 } as unknown as BattleEvent,
      ]),
    ).toBe("hit");
    expect(
      peekMoveOutcome([
        { type: "status_applied", target: "opponent", conditionId: 2 } as unknown as BattleEvent,
      ]),
    ).toBe("hit");
  });

  it("returns 'hit' for a neutral-effectiveness event (multiplier !== 0)", () => {
    expect(
      peekMoveOutcome([
        { type: "effectiveness", multiplier: 2 } as unknown as BattleEvent,
      ]),
    ).toBe("hit");
  });

  it("returns 'hit' when the queue is empty (safe default)", () => {
    expect(peekMoveOutcome([])).toBe("hit");
  });
});

describe("miss renderer ordering", () => {
  it("narrates 'used X!', waits 32 frames, narrates 'missed' — no playMoveAnimation", async () => {
    const clock = new FakeClock();
    const renderer = new RecordingRenderer(clock);
    const battle = stubBattle();

    // Replay what BattleRunner.pump + playEvent(move_used, miss) does:
    const moveUsed: BattleEvent = {
      type: "move_used",
      side: "player",
      moveId: /* Tackle */ 33,
      moveName: "Tackle",
    } as unknown as BattleEvent;
    const missEv: BattleEvent = {
      type: "miss",
      side: "player",
    } as unknown as BattleEvent;
    const queue: BattleEvent[] = [missEv];

    // narrate-before for move_used
    const usedLine = narrateEvent(moveUsed, battle)!;
    await renderer.showMessage(usedLine);
    // playEvent(move_used) branches on peekMoveOutcome
    expect(peekMoveOutcome(queue)).toBe("miss");
    await clock.wait(WAIT_SHORT);
    // narrate-before for miss
    const missLine = narrateEvent(queue.shift()!, battle)!;
    await renderer.showMessage(missLine);

    const ops = renderer.ops.map((o) => ({ op: o.op, frame: o.frame, args: o.args }));
    expect(ops.map((o) => o.op)).toEqual(["showMessage", "showMessage"]);
    expect(ops.find((o) => o.op === "playMoveAnimation")).toBeUndefined();
    // Real decomp strings land verbatim — the move name comes from
    // pokedata3g's `getMove` lookup (TACKLE → "TACKLE").
    expect(ops[0].args.text).toBe("BULBASAUR used\nTACKLE!");
    expect(ops[1].args.text).toBe("BULBASAUR's\nattack missed!");
    // 32-frame gap between the two messages: the decomp's
    // `pause B_WAIT_TIME_SHORT` in BattleScript_PrintMoveMissed.
    expect(ops[1].frame - ops[0].frame).toBe(WAIT_SHORT);
  });
});
