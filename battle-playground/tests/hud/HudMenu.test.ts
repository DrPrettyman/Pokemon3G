/**
 * Pure unit tests for `computeNextId` — the cursor navigation math
 * used by `runHudMenu`. No Phaser needed; we just verify the 2D grid
 * navigation matches the decomp (`battle_controller_player.c:246-285`).
 */
import { describe, expect, it } from "vitest";
import { computeNextId } from "../../src/phaser/hud_helpers/runHudMenu";

const ACTION_GRID = [
  ["fight", "bag"],
  ["pokemon", "run"],
] as const;

describe("computeNextId — 2x2 action menu", () => {
  it("RIGHT from col 0 goes to col 1, same row", () => {
    expect(computeNextId(ACTION_GRID, "fight", "right")).toBe("bag");
    expect(computeNextId(ACTION_GRID, "pokemon", "right")).toBe("run");
  });

  it("LEFT from col 1 goes to col 0, same row", () => {
    expect(computeNextId(ACTION_GRID, "bag", "left")).toBe("fight");
    expect(computeNextId(ACTION_GRID, "run", "left")).toBe("pokemon");
  });

  it("DOWN from row 0 goes to row 1, same col", () => {
    expect(computeNextId(ACTION_GRID, "fight", "down")).toBe("pokemon");
    expect(computeNextId(ACTION_GRID, "bag", "down")).toBe("run");
  });

  it("UP from row 1 goes to row 0, same col", () => {
    expect(computeNextId(ACTION_GRID, "pokemon", "up")).toBe("fight");
    expect(computeNextId(ACTION_GRID, "run", "up")).toBe("bag");
  });

  it("does NOT wrap at column/row boundaries", () => {
    expect(computeNextId(ACTION_GRID, "fight", "left")).toBe("fight");
    expect(computeNextId(ACTION_GRID, "fight", "up")).toBe("fight");
    expect(computeNextId(ACTION_GRID, "run", "right")).toBe("run");
    expect(computeNextId(ACTION_GRID, "run", "down")).toBe("run");
  });

  it("RIGHT onto a disabled cell keeps cursor in place", () => {
    const disabled = new Set(["bag"]);
    expect(computeNextId(ACTION_GRID, "fight", "right", disabled)).toBe("fight");
  });
});

const YN_GRID = [["yes"], ["no"]] as const;

describe("computeNextId — 1-column list (yes/no)", () => {
  it("DOWN / UP toggles between the two entries", () => {
    expect(computeNextId(YN_GRID, "yes", "down")).toBe("no");
    expect(computeNextId(YN_GRID, "no", "up")).toBe("yes");
  });

  it("clamps at the top/bottom", () => {
    expect(computeNextId(YN_GRID, "yes", "up")).toBe("yes");
    expect(computeNextId(YN_GRID, "no", "down")).toBe("no");
  });

  it("LEFT/RIGHT are no-ops in a 1-column list", () => {
    expect(computeNextId(YN_GRID, "yes", "left")).toBe("yes");
    expect(computeNextId(YN_GRID, "yes", "right")).toBe("yes");
  });
});

describe("computeNextId — grid with null slots", () => {
  it("does not move onto a null slot", () => {
    const grid = [
      ["a", "b"],
      ["c", null],
    ] as const;
    expect(computeNextId(grid, "b", "down")).toBe("b");
    expect(computeNextId(grid, "c", "right")).toBe("c");
  });
});

describe("computeNextId — A/B buttons are no-ops", () => {
  it("A does not change position", () => {
    expect(computeNextId(ACTION_GRID, "fight", "A")).toBe("fight");
  });
  it("B does not change position", () => {
    expect(computeNextId(ACTION_GRID, "fight", "B")).toBe("fight");
  });
});
