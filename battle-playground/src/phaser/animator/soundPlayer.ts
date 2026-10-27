/**
 * Battle SFX playback for the decomp animation interpreter.
 *
 * The interpreter (src/runtime/animInterpreter.ts) fires a generic `playSe`
 * hook for every sound-related command. This module owns:
 *
 *   - Lazy loading of mp3s into the Phaser sound cache via Vite's asset glob.
 *   - Playback for `playsewithpan` / `waitplaysewithpan`.
 *   - Scheduled repeat playback for `loopsewithpan` (decoupled from the
 *     interpreter PC — it fires and forgets on the scene clock).
 *   - Continuous pan sweeps for `panse`.
 *
 * Pan handling follows the decomp's convention:
 *
 *   SOUND_PAN_ATTACKER = -64   (full left when attacker is on player side)
 *   SOUND_PAN_TARGET   = +63
 *
 * In Phaser/WebAudio pan is `[-1, 1]`. We treat the player side as the left
 * channel and the opponent side as the right channel, then flip any
 * attacker/target-relative pan so it's always spatially correct regardless
 * of which side launched the move.
 */
import * as Phaser from "phaser";

import type { Clock } from "../../runtime/clock";
import type { AnimCommand } from "../../runtime/animInterpreter";
import type { MoveAnimContext, Side } from "./types";
import soundIndexRaw from "../../assets/sounds/sound_index.json";

const soundIndex = soundIndexRaw as Record<string, string>;

/**
 * Vite asset map: filename stem (e.g. `se_m_tackle`) -> hashed URL. Mirrors
 * animLoader's sprite glob — eager so first playback has no await.
 */
const SFX_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob("../../assets/sounds/move_sfx/*.mp3", {
      eager: true,
      query: "?url",
      import: "default",
    }),
  ).map(([path, url]) => {
    const stem = path.split("/").pop()!.replace(/\.mp3$/, "");
    return [stem, url as string];
  }),
);

function cacheKey(seKey: string): string {
  return `sfx:${seKey.toLowerCase()}`;
}

/**
 * Decomp pan constants. We only translate the well-known symbolic values;
 * numeric pan (`-64..63`) falls through to the numeric branch below.
 */
function resolvePanValue(
  raw: unknown,
  ctx: MoveAnimContext,
  fallback: number,
): number {
  if (typeof raw === "number") {
    return raw;
  }
  if (typeof raw !== "string") {
    return fallback;
  }
  switch (raw) {
    case "SOUND_PAN_ATTACKER":
      return sideToPan(ctx.attackerSide);
    case "SOUND_PAN_TARGET":
      return sideToPan(ctx.targetSide);
    default: {
      // e.g. "SOUND_PAN_ATTACKER_MINUS_2" → evaluate the base then offset.
      const m = raw.match(/^SOUND_PAN_(ATTACKER|TARGET)_(PLUS|MINUS)_(\d+)$/);
      if (m) {
        const base =
          m[1] === "ATTACKER"
            ? sideToPan(ctx.attackerSide)
            : sideToPan(ctx.targetSide);
        const offset = Number(m[3]) * (m[2] === "PLUS" ? 1 : -1);
        return clampPan(base + offset);
      }
      const n = Number(raw);
      return Number.isFinite(n) ? n : fallback;
    }
  }
}

function sideToPan(side: Side): number {
  // Full left / full right on the decomp's -64..63 scale.
  return side === "player" ? -64 : 63;
}

function clampPan(v: number): number {
  if (v < -64) return -64;
  if (v > 63) return 63;
  return v;
}

/** Decomp pan (-64..63) → WebAudio pan (-1..1). */
function toAudioPan(decompPan: number): number {
  return clampPan(decompPan) / 64;
}

export class SoundPlayer {
  private scene: Phaser.Scene;
  private clock: Clock;
  /** Sounds currently playing — stopped on scene shutdown. */
  private active = new Set<Phaser.Sound.BaseSound>();
  /**
   * Per-sound-key decode promise. Phaser 4's WebAudio sound manager needs an
   * `AudioBuffer` in the audio cache — handing it a raw `HTMLAudioElement`
   * (the old implementation) made every playback throw
   * `AudioBufferSourceNode.buffer must be AudioBuffer`. We lazily fetch and
   * decode each mp3 on first use and memoise the in-flight promise so
   * concurrent playback requests only decode once.
   */
  private decodeCache = new Map<string, Promise<boolean>>();

  constructor(scene: Phaser.Scene, clock: Clock) {
    this.scene = scene;
    this.clock = clock;
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.dispose());
    scene.events.once(Phaser.Scenes.Events.DESTROY, () => this.dispose());
  }

  /**
   * Interpreter entry point. Routes on `cmd.cmd` — the interpreter funnels
   * every sound opcode through `host.playSe`.
   */
  playSe(cmd: AnimCommand, ctx: MoveAnimContext): void {
    switch (cmd.cmd) {
      case "playsewithpan":
      case "waitplaysewithpan": {
        const pan = resolvePanValue(cmd.pan, ctx, 0);
        this.playOnce(String(cmd.se ?? ""), pan);
        break;
      }
      case "loopsewithpan": {
        const pan = resolvePanValue(cmd.pan, ctx, 0);
        const wait = Math.max(0, Number(cmd.wait ?? 0));
        const times = Math.max(1, Number(cmd.times ?? 1));
        void this.playLoop(String(cmd.se ?? ""), pan, wait, times);
        break;
      }
      case "panse": {
        const current = resolvePanValue(cmd.currentPan, ctx, 0);
        const target = resolvePanValue(cmd.targetPan, ctx, 0);
        const step = Number(cmd.incrementPan ?? 1);
        const delay = Math.max(0, Number(cmd.delay ?? 0));
        this.playSweep(String(cmd.se ?? ""), current, target, step, delay);
        break;
      }

      // The interpreter currently pipes these through playSe but Phase G
      // doesn't need them yet — the async playback already decouples sound
      // from the animation PC so `waitsound` is a safe no-op until the
      // timings pass (Phase I) wires it up properly.
      case "waitsound":
      case "setpan":
      case "panse_adjustnone":
      case "panse_adjustall":
      case "createsoundtask":
        break;

      default:
        break;
    }
  }

  /**
   * Ensure the mp3 for `seKey` is decoded into an `AudioBuffer` sitting in
   * the Phaser audio cache. Returns `true` once the buffer is cached, or
   * `false` if we couldn't load/decode the file (missing url, network
   * error, unsupported codec).
   */
  private ensureDecoded(seKey: string): Promise<boolean> {
    const key = cacheKey(seKey);
    if (this.scene.cache.audio.exists(key)) return Promise.resolve(true);
    const existing = this.decodeCache.get(key);
    if (existing) return existing;
    const url = this.resolveUrl(seKey);
    if (!url) return Promise.resolve(false);
    const mgr = this.scene.sound as unknown as { context?: AudioContext };
    const audioCtx = mgr.context;
    if (!audioCtx) {
      // No WebAudio context (HTML5 audio backend). Fall back to the old
      // HTMLAudioElement path, which works for that backend.
      const audio = new Audio(url);
      this.scene.cache.audio.add(key, audio);
      return Promise.resolve(true);
    }
    const p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buf) => audioCtx.decodeAudioData(buf))
      .then((audioBuffer) => {
        if (!this.scene.cache.audio.exists(key)) {
          this.scene.cache.audio.add(key, audioBuffer);
        }
        return true;
      })
      .catch((err) => {
        console.debug("[SoundPlayer] decode failed:", seKey, err);
        this.decodeCache.delete(key);
        return false;
      });
    this.decodeCache.set(key, p);
    return p;
  }

  private playOnce(seKey: string, decompPan: number): void {
    void this.loadAndPlay(seKey, decompPan);
  }

  /**
   * Async version of `playOnce` that returns the sound handle once playback
   * has started. Used by `playSweep` which needs the handle to update pan
   * over time. The sync `playOnce` wrapper above just fires and forgets.
   */
  private async loadAndPlay(
    seKey: string,
    decompPan: number,
  ): Promise<Phaser.Sound.BaseSound | null> {
    if (!seKey) return null;
    const ok = await this.ensureDecoded(seKey);
    if (!ok) return null;
    const key = cacheKey(seKey);
    try {
      const sound = this.scene.sound.add(key) as Phaser.Sound.BaseSound & {
        setPan?: (v: number) => void;
      };
      if (typeof sound.setPan === "function") {
        sound.setPan(toAudioPan(decompPan));
      }
      sound.play();
      this.active.add(sound);
      sound.once(Phaser.Sound.Events.COMPLETE, () => {
        this.active.delete(sound);
        sound.destroy();
      });
      return sound;
    } catch (err) {
      console.debug("[SoundPlayer] playback failed:", seKey, err);
      return null;
    }
  }

  private async playLoop(
    seKey: string,
    pan: number,
    waitFrames: number,
    times: number,
  ): Promise<void> {
    for (let i = 0; i < times; i++) {
      this.playOnce(seKey, pan);
      if (i < times - 1 && waitFrames > 0) {
        await this.clock.wait(waitFrames);
      }
    }
  }

  private async playSweep(
    seKey: string,
    startPan: number,
    endPan: number,
    step: number,
    delayFrames: number,
  ): Promise<void> {
    if (!Number.isFinite(step) || step === 0) {
      this.playOnce(seKey, startPan);
      return;
    }
    const sound = (await this.loadAndPlay(seKey, startPan)) as
      | (Phaser.Sound.BaseSound & { setPan?: (v: number) => void })
      | null;
    if (!sound) return;

    const dir = endPan >= startPan ? Math.abs(step) : -Math.abs(step);
    let pan = startPan;
    while ((dir > 0 && pan < endPan) || (dir < 0 && pan > endPan)) {
      if (delayFrames > 0) {
        await this.clock.wait(delayFrames);
      } else {
        // Yield to the event loop so `panse` doesn't busy-loop when delay=0.
        await Promise.resolve();
      }
      pan += dir;
      if ((dir > 0 && pan > endPan) || (dir < 0 && pan < endPan)) pan = endPan;
      if (typeof sound.setPan === "function") {
        sound.setPan(toAudioPan(pan));
      }
      // If the sound finished before we got here, stop sweeping.
      if (!this.active.has(sound)) return;
    }
  }

  private resolveUrl(seKey: string): string | null {
    const rel = soundIndex[seKey];
    if (!rel) return null;
    const stem = rel.split("/").pop()!.replace(/\.mp3$/, "");
    return SFX_URLS[stem] ?? null;
  }

  private dispose(): void {
    for (const sound of this.active) {
      try {
        sound.stop();
        sound.destroy();
      } catch {
        // ignore — scene tearing down
      }
    }
    this.active.clear();
  }
}
