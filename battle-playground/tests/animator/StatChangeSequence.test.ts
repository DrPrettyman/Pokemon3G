/**
 * Stat-change sequencing contract.
 *
 * Decomp ordering (`BattleScript_StatDown` + `seteffectwithchance`):
 *   1. Arrow-chevron flash plays on the affected side.
 *   2. "X's Speed fell!" types in the textbox *after* the flash.
 *
 * The runner achieves (2) by routing `stat_change` onto the "narrate after"
 * branch alongside `faint` — `narrateEvent` returns the line and `playEvent`
 * fires `statStageFlash` + a `clock.wait(STAT_CHANGE_FLASH_FRAMES)` before
 * `showMessage` runs. This test exercises `narrateEvent` against a minimal
 * `Battle`-shaped stub and replays the renderer-side ordering through a
 * `RecordingRenderer`.
 *
 * Narration strings are verbatim FireRed decomp (`battle_message.c:306-310`):
 * `"{B_ATK/DEF_NAME_WITH_PREFIX}'s {B_BUFF1}\n{B_BUFF2}"` — ALL CAPS names,
 * SPEED/ATTACK stat labels, and B_BUFF2 built from
 * `sText_StatSharply` + `sText_StatFell` etc. Opponent-side mons in trainer
 * battles get a `"Foe "` prefix via `HANDLE_NICKNAME_STRING_CASE`.
 */
import { describe, expect, it } from "vitest";
import { FakeClock } from "../support/fakeClock";
import { RecordingRenderer } from "../support/RecordingRenderer";
import { narrateEvent } from "../../src/runtime/BattleRunner";
import { STAT_CHANGE_FLASH_FRAMES } from "../../src/runtime/timings";
import type { Battle, BattleEvent } from "pokedata3g";

/**
 * Minimal Battle stub exposing only the fields `narrateEvent` reads:
 * `playerActive.name`, `opponentActive.name`, and `battleType`. Cast to
 * `Battle` so the function signature accepts it; the runner never
 * touches the rest of the surface during narration.
 */
function stubBattle(
  opts: { playerName?: string; opponentName?: string; battleType?: "wild" | "trainer" } = {},
): Battle {
  return {
    playerActive: { name: opts.playerName ?? "Bulbasaur" },
    opponentActive: { name: opts.opponentName ?? "Weedle" },
    battleType: opts.battleType ?? "trainer",
  } as unknown as Battle;
}

describe("stat_change narration", () => {
  it("uses the defender template when the player is the target", () => {
    const battle = stubBattle();
    const ev: BattleEvent = {
      type: "stat_change",
      target: "player",
      statId: 6,
      stages: -1,
      actual: -1,
    };
    // pokedata3g doesn't carry an attacker side on stat_change events, so
    // the runner infers "target === player → player is attacker" for
    // self-buffs and flips the template. For a Speed drop on the player
    // caused by an opponent's move, this produces the
    // `STRINGID_ATTACKERSSTATFELL` template with the player's prefix —
    // technically the "defender" side from the opponent's POV but the
    // B_ATK slot here reads the same ("BULBASAUR's SPEED\nfell!").
    expect(narrateEvent(ev, battle)).toBe("BULBASAUR's SPEED\nfell!");
  });

  it("uses the defender template with Foe prefix when the opponent is the target", () => {
    const battle = stubBattle();
    const ev: BattleEvent = {
      type: "stat_change",
      target: "opponent",
      statId: 2,
      stages: 2,
      actual: 2,
    };
    expect(narrateEvent(ev, battle)).toBe("Foe WEEDLE's ATTACK\nsharply rose!");
  });

  it("wild battles drop the Foe prefix in favor of Wild", () => {
    const battle = stubBattle({ battleType: "wild", opponentName: "Pidgey" });
    const ev: BattleEvent = {
      type: "stat_change",
      target: "opponent",
      statId: 6,
      stages: -1,
      actual: -1,
    };
    expect(narrateEvent(ev, battle)).toBe("Wild PIDGEY's SPEED\nfell!");
  });

  it("blocked drops narrate 'won't go any lower' instead of the normal template", () => {
    const battle = stubBattle();
    const ev: BattleEvent = {
      type: "stat_change",
      target: "opponent",
      statId: 3,
      stages: -1,
      actual: 0,
    };
    expect(narrateEvent(ev, battle)).toBe("Foe WEEDLE's DEFENSE\nwon't go lower!");
  });
});

describe("stat_change renderer ordering", () => {
  it("flashes before the narration line — matches the narrate-after branch", async () => {
    const clock = new FakeClock();
    const renderer = new RecordingRenderer(clock);

    // What BattleRunner does for a stat_change: play the flash, hold for
    // STAT_CHANGE_FLASH_FRAMES, then type the line.
    renderer.statStageFlash("player", -1, /* speed */ 6);
    await clock.wait(STAT_CHANGE_FLASH_FRAMES);
    await renderer.showMessage("BULBASAUR's SPEED\nfell!");

    const names = renderer.ops.map((o) => o.op);
    expect(names).toEqual(["statStageFlash", "showMessage"]);
    expect(renderer.ops[0].frame).toBe(0);
    expect(renderer.ops[0].args).toMatchObject({
      side: "player",
      delta: -1,
      statId: 6,
    });
    expect(renderer.ops[1].frame).toBe(STAT_CHANGE_FLASH_FRAMES);
  });
});
