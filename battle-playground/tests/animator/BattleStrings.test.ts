/**
 * `battleStrings.ts` formatting contract.
 *
 * Every entry in `BATTLE_STRINGS` is a verbatim copy from
 * `python-scripts/raw-assets/decomp-hacks/firered/src/battle_message.c`. This
 * test locks down the substitution logic so regressions in the helper
 * (wrong placeholder name, missing prefix, mixed-case stat label) show
 * up here rather than surfacing in a live battle.
 *
 * Prefix rules mirror `HANDLE_NICKNAME_STRING_CASE` (`battle_message.c:1813`):
 * non-player battlers in trainer battles get "Foe ", wild battlers get
 * "Wild ", and all names render in ALL CAPS to match the Gen 3 textbox.
 */
import { describe, expect, it } from "vitest";
import {
  formatBattleString,
  nameWithPrefix,
  withStatChange,
} from "../../src/runtime/battleStrings";

describe("nameWithPrefix", () => {
  it("uppercases the player's own mon name with no prefix", () => {
    expect(nameWithPrefix("player", "Bulbasaur", false)).toBe("BULBASAUR");
  });

  it("prefixes opponent mons with 'Foe ' in trainer battles", () => {
    expect(nameWithPrefix("opponent", "Weedle", false)).toBe("Foe WEEDLE");
  });

  it("prefixes opponent mons with 'Wild ' in wild encounters", () => {
    expect(nameWithPrefix("opponent", "Pidgey", true)).toBe("Wild PIDGEY");
  });
});

describe("formatBattleString", () => {
  it("STRINGID_USEDMOVE — Bulbasaur used Tackle!", () => {
    expect(
      formatBattleString("STRINGID_USEDMOVE", {
        atkNameWithPrefix: "BULBASAUR",
        moveName: "TACKLE",
      }),
    ).toBe("BULBASAUR used\nTACKLE!");
  });

  it("STRINGID_ATTACKMISSED — Foe WEEDLE's attack missed!", () => {
    expect(
      formatBattleString("STRINGID_ATTACKMISSED", {
        atkNameWithPrefix: "Foe WEEDLE",
      }),
    ).toBe("Foe WEEDLE's\nattack missed!");
  });

  it("STRINGID_ITDOESNTAFFECT — with defender prefix", () => {
    expect(
      formatBattleString("STRINGID_ITDOESNTAFFECT", {
        defNameWithPrefix: "Foe GASTLY",
      }),
    ).toBe("It doesn't affect\nFoe GASTLY…");
  });

  it("STRINGID_PKMNISPARALYZED — paralysis can't move", () => {
    expect(
      formatBattleString("STRINGID_PKMNISPARALYZED", {
        atkNameWithPrefix: "BULBASAUR",
      }),
    ).toBe("BULBASAUR is paralyzed!\nIt can't move!");
  });

  it("STRINGID_PKMNFAINTED_TARGET — keeps the page-break sentinel", () => {
    const out = formatBattleString("STRINGID_PKMNFAINTED_TARGET", {
      defNameWithPrefix: "Foe WEEDLE",
    });
    expect(out).toBe("Foe WEEDLE\nfainted!\f");
    // `\f` is the runner's page-break sentinel; the bitmap font printer
    // waits 64 frames on it and then clears the textbox.
    expect(out.includes("\f")).toBe(true);
  });

  it("STRINGID_DEFENDERSSTATFELL via withStatChange — Foe WEEDLE's SPEED fell!", () => {
    const ctx = withStatChange(
      { defNameWithPrefix: "Foe WEEDLE" },
      /* statId = speed */ 6,
      /* stages = -1 */ -1,
    );
    expect(formatBattleString("STRINGID_DEFENDERSSTATFELL", ctx)).toBe(
      "Foe WEEDLE's SPEED\nfell!",
    );
  });

  it("stat rise with +2 stages uses the 'sharply rose!' verb phrase", () => {
    const ctx = withStatChange(
      { atkNameWithPrefix: "BULBASAUR" },
      /* statId = attack */ 2,
      /* stages = +2 */ 2,
    );
    expect(formatBattleString("STRINGID_ATTACKERSSTATROSE", ctx)).toBe(
      "BULBASAUR's ATTACK\nsharply rose!",
    );
  });

  it("leaves unknown placeholders in-place so missing context is visible", () => {
    expect(formatBattleString("STRINGID_USEDMOVE", {})).toBe(
      "{B_ATK_NAME_WITH_PREFIX} used\n{B_MOVE_NAME}!",
    );
  });
});
