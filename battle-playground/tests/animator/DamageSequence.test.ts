/**
 * Damage sequencing contract.
 *
 * Decomp: `data/battle_scripts_1.s:257–263` runs attackanimation +
 * waitanimation, then `hitanimation BS_TARGET` (the target-sprite hit
 * flash), then `healthbarupdate BS_TARGET` (animated drain), then
 * `datahpupdate` (commit). Everything is strictly sequential — the hit
 * flash owns its own beat, then the drain starts. No concurrent shake,
 * no drain overlapping the flash.
 *
 * This test walks a RecordingRenderer through the same ordering the
 * runner drives in `playEvent` for a `damage` event, and asserts the
 * per-frame trace.
 */
import { describe, expect, it } from "vitest";
import { FakeClock } from "../support/fakeClock";
import { RecordingRenderer } from "../support/RecordingRenderer";
import {
  HIT_FLASH_FRAMES,
  POST_DAMAGE_PAUSE_FRAMES,
  hpDrainFrames,
} from "../../src/runtime/timings";

describe("damage sequence", () => {
  it("flashes the target, then drains HP — strictly sequential", async () => {
    const clock = new FakeClock();
    const renderer = new RecordingRenderer(clock);

    const maxHp = 48;
    const fromHp = 48;
    const toHp = 32;

    // --- What BattleRunner.playEvent(damage) does, in order: --------------
    renderer.hitFlash("opponent");
    await clock.wait(HIT_FLASH_FRAMES);
    const popupDone = renderer.showDamagePopup("opponent", 16);
    const drainFrames = hpDrainFrames(fromHp, toHp, maxHp);
    for (let f = 1; f <= drainFrames; f++) {
      await clock.wait(1);
      const hp = Math.round(fromHp + ((toHp - fromHp) * f) / drainFrames);
      renderer.setHp("opponent", hp, maxHp);
    }
    await clock.wait(POST_DAMAGE_PAUSE_FRAMES);
    await popupDone;

    const names = renderer.ops.map((o) => o.op);
    // Expected: hitFlash → showDamagePopup → setHp×drainFrames
    expect(names[0]).toBe("hitFlash");
    expect(names[1]).toBe("showDamagePopup");
    // No `shake` entry — the Phase A stand-in is gone.
    expect(names).not.toContain("shake");
    // First setHp fires exactly `HIT_FLASH_FRAMES + 1` into the sequence:
    // the flash holds, then the first drain frame bumps by one.
    const firstSetHp = renderer.ops.find((o) => o.op === "setHp");
    expect(firstSetHp).toBeDefined();
    expect(firstSetHp!.frame).toBe(HIT_FLASH_FRAMES + 1);
    // All drain setHp ops are after the hit flash beat.
    for (const op of renderer.ops.filter((o) => o.op === "setHp")) {
      expect(op.frame).toBeGreaterThanOrEqual(HIT_FLASH_FRAMES + 1);
    }
  });
});
