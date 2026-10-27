/**
 * Confusion self-hit contract.
 *
 * Decomp: when a confused Pokemon fails its snap-out roll, the script
 * prints two lines around the damage, with no move animation:
 *
 *     printstring STRINGID_PKMNISCONFUSED    @ "BULBASAUR is\nconfused!"
 *     waitmessage B_WAIT_TIME_LONG
 *     printstring STRINGID_ITHURTCONFUSION   @ "It hurt itself in its\nconfusion!"
 *     waitmessage B_WAIT_TIME_LONG
 *     datahpupdate BS_ATTACKER               @ self damage
 *
 * pokedata3g emits this pair as
 *     [cant_move{reason:"confusion", side: X}, damage{target: X, ...}]
 * The runner detects the pair and fuses them into a two-line narration
 * followed by a normal damage sequence (hit flash → HP drain → gate).
 *
 * This test asserts the narration strings, the absence of
 * `playMoveAnimation`, and that the hit flash still fires for the
 * self-damage beat.
 */
import { describe, expect, it } from "vitest";
import { FakeClock } from "../support/fakeClock";
import { RecordingRenderer } from "../support/RecordingRenderer";
import { formatBattleString } from "../../src/runtime/battleStrings";
import { HIT_FLASH_FRAMES } from "../../src/runtime/timings";

describe("confusion self-hit narration", () => {
  it("produces the 'is confused' and 'It hurt itself' lines verbatim", () => {
    expect(
      formatBattleString("STRINGID_PKMNISCONFUSED", {
        atkNameWithPrefix: "BULBASAUR",
      }),
    ).toBe("BULBASAUR is\nconfused!");
    expect(formatBattleString("STRINGID_ITHURTCONFUSION", {})).toBe(
      "It hurt itself in its\nconfusion!",
    );
  });
});

describe("confusion self-hit renderer trace", () => {
  it("narrates both lines, hit-flashes the confused mon, drains HP — no move anim", async () => {
    const clock = new FakeClock();
    const renderer = new RecordingRenderer(clock);

    // What BattleRunner.pump does for a confusion pair:
    //   1. narrate "BULBASAUR is\nconfused!"
    //   2. narrate "It hurt itself in its\nconfusion!"
    //   3. playEvent(damage) — hit flash, wait, drain
    await renderer.showMessage(
      formatBattleString("STRINGID_PKMNISCONFUSED", {
        atkNameWithPrefix: "BULBASAUR",
      }),
    );
    await renderer.showMessage(
      formatBattleString("STRINGID_ITHURTCONFUSION", {}),
    );
    renderer.hitFlash("player");
    await clock.wait(HIT_FLASH_FRAMES);
    // A single drain step (real runner loops bar-pixel-by-pixel).
    renderer.setHp("player", 40, 48);

    const ops = renderer.ops;
    expect(ops.map((o) => o.op)).toEqual([
      "showMessage",
      "showMessage",
      "hitFlash",
      "setHp",
    ]);
    expect(ops.find((o) => o.op === "playMoveAnimation")).toBeUndefined();
    expect(ops[0].args.text).toBe("BULBASAUR is\nconfused!");
    expect(ops[1].args.text).toBe("It hurt itself in its\nconfusion!");
    // hitFlash happens after both narration lines (narrate-before branch).
    expect(ops[2].frame).toBe(0);
    // setHp lands HIT_FLASH_FRAMES after the flash — the decomp's
    // `Cmd_hitanimation` → `Cmd_healthbarupdate` sequential gate.
    expect(ops[3].frame).toBe(HIT_FLASH_FRAMES);
  });
});
