/**
 * Frame-locked clock abstraction.
 *
 * Durations are counted in integer GBA frames — 16.7427 ms each, 59.7275 fps.
 * The animation pipeline waits exclusively through a Clock; no `setTimeout`
 * calls are allowed outside this module.
 *
 *   - `PhaserClock` is the live implementation, backed by `scene.time` so
 *     it pauses when the scene pauses.
 *   - `WallClock` is a plain `performance.now()` + `setTimeout` fallback
 *     used by the runner before a Phaser scene has booted.
 *   - `FakeClock` (tests/support/fakeClock.ts) is the deterministic
 *     implementation used by snapshot tests.
 */
import type * as Phaser from "phaser";

/** Milliseconds per GBA frame (59.7275 fps). */
export const FRAME_MS = 1000 / 59.7275;

/** Round a millisecond value to the nearest whole GBA frame. */
export function msToFrames(ms: number): number {
  return Math.max(0, Math.round(ms / FRAME_MS));
}

export interface Clock {
  /** Current time measured in whole frames since clock start. */
  nowFrames(): number;
  /** Resolves after `frames` GBA frames have elapsed. */
  wait(frames: number): Promise<void>;
  /** Convenience for legacy code: wait `ms` milliseconds. */
  waitMs(ms: number): Promise<void>;
  /** Cancel any pending waits — called by BattleRunner.dispose(). */
  dispose(): void;
}

/**
 * Minimal setTimeout-backed clock. Kept as the default so BattleRunner can
 * exist before a Phaser scene is mounted, and as a non-Phaser fallback for
 * headless callers.
 */
export class WallClock implements Clock {
  private startMs = performance.now();
  private pending = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;

  nowFrames(): number {
    return Math.floor((performance.now() - this.startMs) / FRAME_MS);
  }

  wait(frames: number): Promise<void> {
    return this.waitMs(frames * FRAME_MS);
  }

  waitMs(ms: number): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return new Promise((resolve) => {
      const handle = setTimeout(() => {
        this.pending.delete(handle);
        resolve();
      }, ms);
      this.pending.add(handle);
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const h of this.pending) clearTimeout(h);
    this.pending.clear();
  }
}

/**
 * Phaser-backed clock. Delays snap to integer GBA frames and are scheduled
 * through `scene.time.delayedCall`, so they pause when the scene pauses and
 * are cleaned up when the scene shuts down.
 *
 * Call `dispose()` to abort any pending waits — in-flight promises resolve
 * early so callers bail out cleanly instead of hanging.
 */
export class PhaserClock implements Clock {
  private readonly startTimeMs: number;
  private readonly pending = new Set<Phaser.Time.TimerEvent>();
  private disposed = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.startTimeMs = scene.time.now;
  }

  nowFrames(): number {
    return Math.floor((this.scene.time.now - this.startTimeMs) / FRAME_MS);
  }

  wait(frames: number): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const whole = Math.max(0, Math.floor(frames));
    if (whole === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const ev = this.scene.time.delayedCall(whole * FRAME_MS, () => {
        this.pending.delete(ev);
        resolve();
      });
      this.pending.add(ev);
    });
  }

  waitMs(ms: number): Promise<void> {
    return this.wait(msToFrames(ms));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const ev of this.pending) ev.remove(false);
    this.pending.clear();
  }
}
