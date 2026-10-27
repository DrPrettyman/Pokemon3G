/**
 * Phaser bridge for the renderer-agnostic `runInterpreter`.
 *
 * The interpreter (src/runtime/animInterpreter.ts) walks an animation command
 * list and fires host methods for every non-control-flow command. This class
 * implements that host against Phaser: createsprite spawns a real sprite via
 * the existing `spriteCallbacks` registry, createvisualtask runs a task via
 * `taskCallbacks`, `monbg` tints the target battler, `fadetobg` drops a
 * full-screen rect overlay and fades it in, etc.
 *
 * Label resolution uses pokedata3g's `getSubroutine` plus a lazy-built
 * move-by-label map so cross-move jumps (HydroPump → Surf, Sunny Day ↔
 * SunnyDay-like helpers) also resolve. If a label is unresolved the
 * interpreter silently falls through.
 *
 * Timing: every `delay` command goes through the injected `Clock` (Phase B
 * deliverable). Sprite callbacks still drive their own tweens via Phaser —
 * those tweens already run on the scene clock, so they pause with the scene.
 */
import * as Phaser from "phaser";
import { getMoveAnimation, getSubroutine } from "pokedata3g";
import type { Animation as PokedataAnimation, AnimCommand as PokedataAnimCommand } from "pokedata3g";
import type { Clock } from "../../runtime/clock";
import {
  createInterpreterState,
  runInterpreter,
  type AnimCommand as InterpCommand,
  type AnimInterpreterHost,
  type AnimInterpreterState,
  type Battler as InterpBattler,
} from "../../runtime/animInterpreter";
import { ensureSheetLoaded, resolveTemplate } from "../animLoader";
import type {
  LiveEntity,
  MoveAnimContext,
  ResolvedTemplate,
  Side,
} from "./types";
import { getSpriteCallback } from "./spriteCallbacks";
import { getTaskCallback } from "./taskCallbacks";
import { SoundPlayer } from "./soundPlayer";

/**
 * Minimal shape of the host scene's BG-layer compositing API. Declared
 * locally so MoveAnimator stays free of a direct `BattleScene` import (the
 * scene already depends on this module). BattleScene satisfies this
 * structurally.
 */
interface AnimBgHost {
  showAnimBg(bgId: string): Promise<void>;
  hideAnimBg(): Promise<void>;
  setMonBg(side: Side): void;
  clearMonBg(): void;
  setSplitBgPrio(side: Side): void;
  clearSplitBgPrio(): void;
}

function battlerToSide(
  battler: InterpBattler,
  attackerSide: Side,
  targetSide: Side,
): Side {
  return battler === "ANIM_ATTACKER" || battler === "ANIM_ATK_PARTNER"
    ? attackerSide
    : targetSide;
}

export interface PlayMoveOptions {
  attackerSide: Side;
  targetSide: Side;
  getBattlerPos: MoveAnimContext["getBattlerPos"];
  getBattlerSprite: MoveAnimContext["getBattlerSprite"];
  /** Which turn of a two-turn move (defaults to 0). */
  moveTurn?: number;
}

// Lazy move-label → commands index. Populated on first cross-move jump.
let movesByLabel: Map<string, PokedataAnimCommand[]> | null = null;
function getMoveByLabel(label: string): PokedataAnimCommand[] | null {
  if (!movesByLabel) {
    movesByLabel = new Map();
    // getMoveAnimation is keyed by move id; we don't have a bulk getter
    // exposed, but moves are small integers starting at 0. Iterate until
    // a miss streak indicates we're past the end.
    let misses = 0;
    for (let id = 0; id < 1024 && misses < 16; id++) {
      const anim = getMoveAnimation(id);
      if (!anim) {
        misses++;
        continue;
      }
      misses = 0;
      if (anim.label) movesByLabel.set(anim.label, anim.commands);
    }
  }
  return movesByLabel.get(label) ?? null;
}

export class MoveAnimator {
  private readonly soundPlayer: SoundPlayer;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly clock: Clock,
  ) {
    this.soundPlayer = new SoundPlayer(scene, clock);
  }

  /**
   * Structural cast to the host scene's BG compositing surface. Phase E
   * routes monbg/splitbgprio/fadetobg through BattleScene instead of the
   * per-animator stand-ins that landed in Phase B.
   */
  private get bgHost(): AnimBgHost {
    return this.scene as unknown as AnimBgHost;
  }

  /** Play a full move animation and resolve when it completes. */
  async play(animation: PokedataAnimation, opts: PlayMoveOptions): Promise<void> {
    const ctx: MoveAnimContext = {
      scene: this.scene,
      attackerSide: opts.attackerSide,
      targetSide: opts.targetSide,
      getBattlerPos: opts.getBattlerPos,
      getBattlerSprite: opts.getBattlerSprite,
      alive: new Set<LiveEntity>(),
      args: [],
      subroutines: {},
    };

    const state = createInterpreterState({ moveTurn: opts.moveTurn ?? 0 });
    // Share the args array so sprite callbacks read the same slots that the
    // interpreter writes via `setarg` and `createsprite`.
    ctx.args = state.args;

    const host = this.createHost(ctx);

    try {
      await runInterpreter(
        animation.commands as InterpCommand[],
        host,
        state,
      );
    } catch (err) {
      console.warn("[MoveAnimator] error playing animation:", animation.name, err);
    }
    // Ensure nothing is left dangling after the script ends.
    await this.waitForAll(ctx);
    // Clear any leftover BG state so the next animation starts clean.
    const bgHost = this.bgHost;
    bgHost.clearMonBg();
    bgHost.clearSplitBgPrio();
    await bgHost.hideAnimBg();
  }

  // -------------------------------------------------------------------------
  // Interpreter host
  // -------------------------------------------------------------------------

  private createHost(ctx: MoveAnimContext): AnimInterpreterHost {
    return {
      clock: this.clock,
      resolveLabel: (label) => {
        const sub = getSubroutine(label);
        if (sub) return sub as InterpCommand[];
        const move = getMoveByLabel(label);
        if (move) return move as InterpCommand[];
        return null;
      },
      createSprite: async (cmd) => {
        const template = String(cmd.template ?? "");
        let resolved: ResolvedTemplate | null = null;
        try {
          resolved = await this.resolveTemplateForSpawn(template);
        } catch (err) {
          console.debug(`[MoveAnimator] failed to resolve template ${template}:`, err);
          return;
        }
        if (!resolved) return;
        try {
          const cb = getSpriteCallback(resolved.callback);
          const entity = cb(ctx, resolved);
          if (entity) ctx.alive.add(entity);
        } catch (err) {
          console.debug(`[MoveAnimator] callback ${resolved.callback} threw:`, err);
        }
      },
      createVisualTask: (cmd) => {
        const func = String(cmd.func ?? "");
        const rawArgs = Array.isArray(cmd.args) ? (cmd.args as unknown[]) : [];
        const numericArgs = rawArgs.map((v) =>
          typeof v === "number"
            ? v
            : v === "ANIM_ATTACKER"
              ? 0
              : v === "ANIM_TARGET"
                ? 1
                : 0,
        );
        try {
          const task = getTaskCallback(func);
          const entity = task(ctx, numericArgs);
          ctx.alive.add(entity);
        } catch (err) {
          console.debug(`[MoveAnimator] task ${func} threw:`, err);
        }
      },
      loadSpriteGfx: async (tag) => {
        const raw = lookupAnyTemplateForTag(tag);
        if (!raw || !raw.frameWidth || !raw.frameHeight) return;
        await ensureSheetLoaded(
          ctx.scene,
          tag,
          raw.frameWidth,
          raw.frameHeight,
        ).catch(() => undefined);
      },
      unloadSpriteGfx: () => {
        // Phaser keeps textures cached for the whole scene; no-op.
      },
      playSe: (cmd) => {
        this.soundPlayer.playSe(cmd, ctx);
      },
      setBlend: (eva, evb, state) => {
        state.blendEnabled = true;
        state.blendEva = eva;
        state.blendEvb = evb;
      },
      clearBlend: (state) => {
        state.blendEnabled = false;
        state.blendEva = 0;
        state.blendEvb = 0;
      },
      setMonBg: (battler, state) => {
        state.monBg = battler;
        const side = battlerToSide(battler, ctx.attackerSide, ctx.targetSide);
        this.bgHost.setMonBg(side);
      },
      clearMonBg: (_battler, state) => {
        state.monBg = null;
        this.bgHost.clearMonBg();
      },
      setSplitBgPrio: (battler, state) => {
        state.splitBgPrio = battler;
        const side = battlerToSide(battler, ctx.attackerSide, ctx.targetSide);
        this.bgHost.setSplitBgPrio(side);
      },
      fadeToBg: async (bg, state) => {
        state.currentBg = bg;
        await this.bgHost.showAnimBg(bg);
      },
      restoreBg: async (state) => {
        state.currentBg = null;
        await this.bgHost.hideAnimBg();
      },
      waitForAll: () => this.waitForAll(ctx),
    };
  }

  // -------------------------------------------------------------------------
  // Phaser-specific helpers
  // -------------------------------------------------------------------------

  async waitForAll(ctx: MoveAnimContext): Promise<void> {
    if (ctx.alive.size === 0) return;
    const pending = Array.from(ctx.alive).map((e) => e.done);
    ctx.alive.clear();
    await Promise.all(pending);
  }

  async resolveTemplateForSpawn(name: string): Promise<ResolvedTemplate | null> {
    const raw = resolveTemplate(name);
    if (!raw || !raw.frameWidth || !raw.frameHeight) return null;
    const key = await ensureSheetLoaded(
      this.scene,
      raw.tileTag,
      raw.frameWidth,
      raw.frameHeight,
    );
    return {
      name,
      tileTag: raw.tileTag,
      textureKey: key,
      frameWidth: raw.frameWidth,
      frameHeight: raw.frameHeight,
      anims: raw.anims,
      callback: raw.callback,
    };
  }

}

/** Best-effort template lookup given just the tag (for loadspritegfx). */
function lookupAnyTemplateForTag(tag: string): {
  frameWidth: number | null;
  frameHeight: number | null;
} | null {
  const templates = (
    globalThis as unknown as {
      __animTemplateCache?: Record<
        string,
        { tileTag: string; frameWidth: number; frameHeight: number }
      >;
    }
  ).__animTemplateCache;
  if (templates && templates[tag]) return templates[tag];
  return null;
}

// Silence unused-import complaints in case AnimInterpreterState is only used
// transitively. Keeping the explicit import here makes the contract obvious.
export type { AnimInterpreterState };
