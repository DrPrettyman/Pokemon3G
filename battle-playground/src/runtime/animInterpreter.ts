/**
 * Renderer-agnostic interpreter for decomp battle-animation command lists.
 *
 * This is the single source of truth for how the ~40 animation commands in
 * `pokedata3g/src/animations.json` are dispatched. The interpreter is a
 * stack-based program-counter machine:
 *
 *   - Each call stack frame holds a reference to a command array and a
 *     program counter. `call` pushes a new frame, `return` pops one, and
 *     `goto` / `jumpargeq` / `jumpifmoveturn` / `jumpifcontest` /
 *     `choosetwoturnanim` all replace the current frame's cmds+pc with a
 *     subroutine resolved by label.
 *   - `end` halts execution completely. Running off the end of the entry
 *     command list also halts.
 *   - `delay` defers to an injected `Clock` so tests can fast-forward.
 *   - Every other command is delegated to an `AnimInterpreterHost` so the
 *     Phaser renderer (and the unit-test mock) can each implement its own
 *     visuals without the interpreter knowing about Phaser.
 *
 * A hard step budget catches accidental infinite loops (self-goto without an
 * intervening `end`), which the decomp scripts would have hit as the GBA
 * frame tick but we'd otherwise spin forever on.
 */
import type { Clock } from "./clock";

export type Battler =
  | "ANIM_ATTACKER"
  | "ANIM_TARGET"
  | "ANIM_ATK_PARTNER"
  | "ANIM_DEF_PARTNER";

export interface AnimCommand {
  cmd: string;
  [key: string]: unknown;
}

/** Number of slots in `gBattleAnimArgs` in the decomp. */
export const ANIM_ARG_SLOTS = 16;

/** Decomp `ARG_RET_ID` macro — slot 7 is the conventional "return" arg. */
const ARG_RET_ID = 7;

/** Map string arg-id aliases (from animations.json) to numeric slots. */
const ARG_ID_ALIASES: Record<string, number> = {
  ARG_RET_ID: ARG_RET_ID,
};

/** Mutable state tracked across a single animation run. */
export interface AnimInterpreterState {
  /** 16-slot arg array mirroring decomp `gBattleAnimArgs`. */
  args: number[];
  /** `setalpha` was called and `blendoff` has not yet reset it. */
  blendEnabled: boolean;
  blendEva: number;
  blendEvb: number;
  /** Battler currently darkened by `monbg`, or null. */
  monBg: Battler | null;
  /** Battler currently pulled forward by `splitbgprio`, or null. */
  splitBgPrio: Battler | null;
  /** Animation background currently faded in (`fadetobg`), or null. */
  currentBg: string | null;
  /** Which turn of a two-turn move we're on (0 = turn 1, 1 = turn 2). */
  moveTurn: number;
  /** True if the interpreter is running inside a Contest (alters jumps). */
  inContest: boolean;
}

export function createInterpreterState(
  partial?: Partial<AnimInterpreterState>,
): AnimInterpreterState {
  return {
    args: new Array(ANIM_ARG_SLOTS).fill(0),
    blendEnabled: false,
    blendEva: 0,
    blendEvb: 0,
    monBg: null,
    splitBgPrio: null,
    currentBg: null,
    moveTurn: 0,
    inContest: false,
    ...partial,
  };
}

/**
 * Everything the interpreter asks of the outside world. Renderers implement
 * the visual commands; tests implement recording stubs. Handlers may return
 * a Promise — the interpreter awaits each one before advancing the PC.
 */
export interface AnimInterpreterHost {
  clock: Clock;
  /** Resolve a `call`/`goto`/`jump*` label into its command list. */
  resolveLabel(label: string): AnimCommand[] | null;

  // --- sprites / tasks ---
  createSprite(cmd: AnimCommand, state: AnimInterpreterState): void | Promise<void>;
  createVisualTask(cmd: AnimCommand, state: AnimInterpreterState): void | Promise<void>;
  loadSpriteGfx(tag: string): void | Promise<void>;
  unloadSpriteGfx(tag: string): void;

  // --- sound (stubbable; Phase G replaces with real samples) ---
  playSe(cmd: AnimCommand): void;

  // --- palette / blend ---
  setBlend(eva: number, evb: number, state: AnimInterpreterState): void;
  clearBlend(state: AnimInterpreterState): void;

  // --- BG compositing (Phase E fills these in) ---
  setMonBg(battler: Battler, state: AnimInterpreterState): void;
  clearMonBg(battler: Battler | null, state: AnimInterpreterState): void;
  setSplitBgPrio(battler: Battler, state: AnimInterpreterState): void;
  fadeToBg(bg: string, state: AnimInterpreterState): void | Promise<void>;
  restoreBg(state: AnimInterpreterState): void | Promise<void>;

  /** Resolves when all in-flight sprites / tasks have finished. */
  waitForAll(): Promise<void>;
}

function resolveArgId(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v in ARG_ID_ALIASES) return ARG_ID_ALIASES[v];
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return -1;
}

function resolveValue(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    if (v === "TRUE") return 1;
    if (v === "FALSE") return 0;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Hard cap to catch runaway scripts. One real animation tops out around a
 *  few thousand commands including all inlined subroutines, so 100k is a
 *  wide safety margin. */
const MAX_STEPS = 100_000;

/**
 * Run an animation to completion.
 *
 * @param entry  the command list to start with (typically a move's
 *               `commands` field from animations.json)
 * @param host   dispatch surface for non-control-flow commands
 * @param state  optional initial interpreter state — a fresh one is created
 *               if omitted. The same state object is returned, mutated.
 */
export async function runInterpreter(
  entry: AnimCommand[],
  host: AnimInterpreterHost,
  state: AnimInterpreterState = createInterpreterState(),
): Promise<AnimInterpreterState> {
  interface Frame {
    cmds: AnimCommand[];
    pc: number;
  }
  const stack: Frame[] = [{ cmds: entry, pc: 0 }];
  let halt = false;
  let steps = 0;

  const jumpTo = (label: string): void => {
    const sub = host.resolveLabel(label);
    if (!sub) return;
    const frame = stack[stack.length - 1];
    frame.cmds = sub;
    frame.pc = 0;
  };

  while (!halt && stack.length > 0) {
    if (++steps > MAX_STEPS) {
      throw new Error(
        "animInterpreter: step budget exceeded (likely infinite loop)",
      );
    }
    const frame = stack[stack.length - 1];
    if (frame.pc >= frame.cmds.length) {
      stack.pop();
      continue;
    }
    const cmd = frame.cmds[frame.pc++];

    switch (cmd.cmd) {
      case "end":
        halt = true;
        break;

      case "return":
        stack.pop();
        break;

      case "goto":
        jumpTo(String(cmd.label ?? ""));
        break;

      case "call": {
        const sub = host.resolveLabel(String(cmd.label ?? ""));
        if (sub) stack.push({ cmds: sub, pc: 0 });
        break;
      }

      case "jumpargeq": {
        const slot = resolveArgId(cmd.argId);
        const want = resolveValue(cmd.value);
        if (slot >= 0 && slot < ANIM_ARG_SLOTS && state.args[slot] === want) {
          jumpTo(String(cmd.label ?? ""));
        }
        break;
      }

      case "jumpifmoveturn": {
        if (state.moveTurn === resolveValue(cmd.value)) {
          jumpTo(String(cmd.label ?? ""));
        }
        break;
      }

      case "jumpifcontest":
        if (state.inContest) jumpTo(String(cmd.label ?? ""));
        break;

      case "choosetwoturnanim":
        jumpTo(
          String(
            (state.moveTurn === 0 ? cmd.label1 : cmd.label2) ?? "",
          ),
        );
        break;

      case "setarg": {
        const slot = resolveArgId(cmd.argId);
        if (slot >= 0 && slot < ANIM_ARG_SLOTS) {
          state.args[slot] = resolveValue(cmd.value);
        }
        break;
      }

      case "delay": {
        const f = Number(cmd.frames ?? 0);
        if (f > 0) await host.clock.wait(f);
        break;
      }

      case "waitforvisualfinish":
        await host.waitForAll();
        break;

      case "loadspritegfx":
        await host.loadSpriteGfx(String(cmd.tag ?? ""));
        break;

      case "unloadspritegfx":
        host.unloadSpriteGfx(String(cmd.tag ?? ""));
        break;

      case "setalpha":
        host.setBlend(
          Number(cmd.eva ?? 0),
          Number(cmd.evb ?? 0),
          state,
        );
        break;

      case "blendoff":
        host.clearBlend(state);
        break;

      case "monbg":
      case "monbg_static":
        host.setMonBg(
          (cmd.battler as Battler | undefined) ?? "ANIM_TARGET",
          state,
        );
        break;

      case "clearmonbg":
      case "clearmonbg_static":
        host.clearMonBg(
          (cmd.battler as Battler | undefined) ?? null,
          state,
        );
        break;

      case "splitbgprio":
      case "splitbgprio_foes":
      case "splitbgprio_all":
        host.setSplitBgPrio(
          (cmd.battler as Battler | undefined) ?? "ANIM_TARGET",
          state,
        );
        break;

      case "fadetobg":
      case "fadetobgfromset":
        await host.fadeToBg(String(cmd.bg ?? ""), state);
        break;

      case "restorebg":
        await host.restoreBg(state);
        break;

      // BG fades are awaited inline by fadetobg/restorebg, so these
      // explicit waits are no-ops.
      case "waitbgfadein":
      case "waitbgfadeout":
        break;

      // Sound commands — stubbed for Phase B, wired up in Phase G.
      case "playsewithpan":
      case "loopsewithpan":
      case "waitplaysewithpan":
      case "waitsound":
      case "panse":
      case "panse_adjustnone":
      case "panse_adjustall":
      case "setpan":
      case "createsoundtask":
        host.playSe(cmd);
        break;

      case "createsprite": {
        const rawArgs = Array.isArray(cmd.args) ? (cmd.args as unknown[]) : [];
        for (let i = 0; i < ANIM_ARG_SLOTS; i++) {
          if (i < rawArgs.length) {
            const v = rawArgs[i];
            state.args[i] = typeof v === "number" ? v : 0;
          }
        }
        await host.createSprite(cmd, state);
        break;
      }

      case "createvisualtask":
        await host.createVisualTask(cmd, state);
        break;

      // visible/invisible affect a single battler's sprite — their effect
      // is cosmetic and deferred until the callbacks that own the battler
      // sprite support it. Safe no-op for now.
      case "visible":
      case "invisible":
        break;

      default:
        // Unknown command — no-op so animations play through rather than
        // hang on a single misspelled opcode.
        break;
    }
  }
  return state;
}
