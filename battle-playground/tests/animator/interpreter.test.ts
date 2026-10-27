/**
 * Unit tests for the renderer-agnostic animation interpreter.
 *
 * These tests drive `runInterpreter` with a hand-crafted mock host that
 * records every dispatched command, so they verify control flow, argument
 * slot handling, blend/BG state tracking, and clock-driven delays without
 * booting Phaser.
 */
import { describe, expect, it } from "vitest";
import { FakeClock } from "../support/fakeClock";
import {
  createInterpreterState,
  runInterpreter,
  type AnimCommand,
  type AnimInterpreterHost,
  type AnimInterpreterState,
} from "../../src/runtime/animInterpreter";

interface MockHarness {
  host: AnimInterpreterHost;
  log: string[];
  clock: FakeClock;
}

function makeHost(subs: Record<string, AnimCommand[]> = {}): MockHarness {
  const log: string[] = [];
  const clock = new FakeClock();
  const host: AnimInterpreterHost = {
    clock,
    resolveLabel: (label) => subs[label] ?? null,
    createSprite: (cmd) => {
      log.push(`createsprite:${String(cmd.template)}`);
    },
    createVisualTask: (cmd) => {
      log.push(`task:${String(cmd.func)}`);
    },
    loadSpriteGfx: (tag) => {
      log.push(`load:${tag}`);
    },
    unloadSpriteGfx: (tag) => {
      log.push(`unload:${tag}`);
    },
    playSe: (cmd) => {
      log.push(`se:${cmd.cmd}`);
    },
    setBlend: (eva, evb, state) => {
      state.blendEnabled = true;
      state.blendEva = eva;
      state.blendEvb = evb;
      log.push(`setalpha:${eva},${evb}`);
    },
    clearBlend: (state) => {
      state.blendEnabled = false;
      log.push(`blendoff`);
    },
    setMonBg: (battler, state) => {
      state.monBg = battler;
      log.push(`monbg:${battler}`);
    },
    clearMonBg: (_battler, state) => {
      state.monBg = null;
      log.push(`clearmonbg`);
    },
    setSplitBgPrio: (battler, state) => {
      state.splitBgPrio = battler;
      log.push(`splitbgprio:${battler}`);
    },
    fadeToBg: (bg, state) => {
      state.currentBg = bg;
      log.push(`fadetobg:${bg}`);
    },
    restoreBg: (state) => {
      state.currentBg = null;
      log.push(`restorebg`);
    },
    waitForAll: async () => {
      log.push("waitforvisualfinish");
    },
  };
  return { host, log, clock };
}

describe("runInterpreter — control flow", () => {
  it("halts at `end`", async () => {
    const { host, log } = makeHost();
    const cmds: AnimCommand[] = [
      { cmd: "createvisualtask", func: "A" },
      { cmd: "end" },
      { cmd: "createvisualtask", func: "B" },
    ];
    await runInterpreter(cmds, host);
    expect(log).toEqual(["task:A"]);
  });

  it("runs off the end of the command list cleanly", async () => {
    const { host, log } = makeHost();
    await runInterpreter(
      [{ cmd: "createvisualtask", func: "only" }],
      host,
    );
    expect(log).toEqual(["task:only"]);
  });

  it("`call` pushes, then resumes after the subroutine", async () => {
    const { host, log } = makeHost({
      sub: [{ cmd: "createvisualtask", func: "inner" }],
    });
    await runInterpreter(
      [
        { cmd: "createvisualtask", func: "before" },
        { cmd: "call", label: "sub" },
        { cmd: "createvisualtask", func: "after" },
      ],
      host,
    );
    expect(log).toEqual(["task:before", "task:inner", "task:after"]);
  });

  it("`goto` replaces the current frame — no return", async () => {
    const { host, log } = makeHost({
      tail: [
        { cmd: "createvisualtask", func: "tail1" },
        { cmd: "end" },
      ],
    });
    await runInterpreter(
      [
        { cmd: "createvisualtask", func: "head" },
        { cmd: "goto", label: "tail" },
        { cmd: "createvisualtask", func: "unreachable" },
      ],
      host,
    );
    expect(log).toEqual(["task:head", "task:tail1"]);
  });

  it("unknown label silently falls through", async () => {
    const { host, log } = makeHost();
    await runInterpreter(
      [
        { cmd: "goto", label: "does_not_exist" },
        { cmd: "createvisualtask", func: "after" },
      ],
      host,
    );
    expect(log).toEqual(["task:after"]);
  });

  it("`jumpargeq` jumps when the slot matches", async () => {
    const { host, log } = makeHost({
      branch: [{ cmd: "createvisualtask", func: "taken" }],
    });
    await runInterpreter(
      [
        { cmd: "setarg", argId: 7, value: 2 },
        { cmd: "jumpargeq", argId: "ARG_RET_ID", value: 2, label: "branch" },
        { cmd: "createvisualtask", func: "not_taken" },
      ],
      host,
    );
    expect(log).toEqual(["task:taken"]);
  });

  it("`jumpargeq` falls through when the slot does not match", async () => {
    const { host, log } = makeHost({
      branch: [{ cmd: "createvisualtask", func: "taken" }],
    });
    await runInterpreter(
      [
        { cmd: "setarg", argId: 7, value: 1 },
        { cmd: "jumpargeq", argId: "ARG_RET_ID", value: 2, label: "branch" },
        { cmd: "createvisualtask", func: "fallthrough" },
      ],
      host,
    );
    expect(log).toEqual(["task:fallthrough"]);
  });

  it("`choosetwoturnanim` picks label1 on turn 0 and label2 on turn 1", async () => {
    const subs = {
      one: [{ cmd: "createvisualtask", func: "one" } as AnimCommand],
      two: [{ cmd: "createvisualtask", func: "two" } as AnimCommand],
    };

    const turn0 = makeHost(subs);
    await runInterpreter(
      [{ cmd: "choosetwoturnanim", label1: "one", label2: "two" }],
      turn0.host,
      createInterpreterState({ moveTurn: 0 }),
    );
    expect(turn0.log).toEqual(["task:one"]);

    const turn1 = makeHost(subs);
    await runInterpreter(
      [{ cmd: "choosetwoturnanim", label1: "one", label2: "two" }],
      turn1.host,
      createInterpreterState({ moveTurn: 1 }),
    );
    expect(turn1.log).toEqual(["task:two"]);
  });

  it("`jumpifcontest` only jumps when the state flag is set", async () => {
    const subs = {
      contest: [{ cmd: "createvisualtask", func: "contest" } as AnimCommand],
    };

    const normal = makeHost(subs);
    await runInterpreter(
      [
        { cmd: "jumpifcontest", label: "contest" },
        { cmd: "createvisualtask", func: "normal" },
      ],
      normal.host,
    );
    expect(normal.log).toEqual(["task:normal"]);

    const contest = makeHost(subs);
    await runInterpreter(
      [
        { cmd: "jumpifcontest", label: "contest" },
        { cmd: "createvisualtask", func: "normal" },
      ],
      contest.host,
      createInterpreterState({ inContest: true }),
    );
    expect(contest.log).toEqual(["task:contest"]);
  });

  it("bails out on a self-looping goto via the step budget", async () => {
    const { host } = makeHost({
      loop: [{ cmd: "goto", label: "loop" }],
    });
    await expect(
      runInterpreter([{ cmd: "goto", label: "loop" }], host),
    ).rejects.toThrow(/step budget/);
  });
});

describe("runInterpreter — state tracking", () => {
  it("`delay` advances the clock in whole frames", async () => {
    const { host, clock } = makeHost();
    await runInterpreter(
      [
        { cmd: "delay", frames: 8 },
        { cmd: "delay", frames: 4 },
      ],
      host,
    );
    expect(clock.nowFrames()).toBe(12);
  });

  it("`createsprite` copies args into state.args", async () => {
    const { host } = makeHost();
    const state = createInterpreterState();
    await runInterpreter(
      [
        {
          cmd: "createsprite",
          template: "gFooSpriteTemplate",
          args: [1, 2, 3, 4],
        },
      ],
      host,
      state,
    );
    expect(state.args.slice(0, 4)).toEqual([1, 2, 3, 4]);
  });

  it("`setarg` writes a single slot without touching others", async () => {
    const { host } = makeHost();
    const state = createInterpreterState();
    state.args[0] = 99;
    await runInterpreter(
      [{ cmd: "setarg", argId: 3, value: 7 }],
      host,
      state,
    );
    expect(state.args[0]).toBe(99);
    expect(state.args[3]).toBe(7);
  });

  it("`setalpha` / `blendoff` toggle the blend flag", async () => {
    const { host } = makeHost();
    const state = createInterpreterState();
    await runInterpreter(
      [
        { cmd: "setalpha", eva: 12, evb: 8 },
        { cmd: "blendoff" },
      ],
      host,
      state,
    );
    expect(state.blendEnabled).toBe(false);
  });

  it("tracks monbg and splitbgprio state", async () => {
    const { host } = makeHost();
    const state = createInterpreterState();
    await runInterpreter(
      [
        { cmd: "monbg", battler: "ANIM_TARGET" },
        { cmd: "splitbgprio", battler: "ANIM_TARGET" },
        { cmd: "clearmonbg", battler: "ANIM_TARGET" },
      ],
      host,
      state,
    );
    expect(state.monBg).toBeNull();
    expect(state.splitBgPrio).toBe("ANIM_TARGET");
  });

  it("tracks fadetobg / restorebg currentBg", async () => {
    const { host } = makeHost();
    const state = createInterpreterState();
    await runInterpreter(
      [
        { cmd: "fadetobg", bg: "BG_DRILL" },
      ],
      host,
      state,
    );
    expect(state.currentBg).toBe("BG_DRILL");

    await runInterpreter([{ cmd: "restorebg" }], host, state);
    expect(state.currentBg).toBeNull();
  });

  it("initial state is fully reset by createInterpreterState", () => {
    const state: AnimInterpreterState = createInterpreterState();
    expect(state.args).toHaveLength(16);
    expect(state.args.every((v) => v === 0)).toBe(true);
    expect(state.blendEnabled).toBe(false);
    expect(state.monBg).toBeNull();
    expect(state.splitBgPrio).toBeNull();
    expect(state.currentBg).toBeNull();
    expect(state.moveTurn).toBe(0);
    expect(state.inContest).toBe(false);
  });
});
