/**
 * Deterministic clock for snapshot tests.
 *
 * All waits resolve synchronously but advance an internal frame counter,
 * so `RecordingRenderer` can tag each op with the frame at which it
 * fired. Phase B will swap the drain pump's `clock.wait` calls to an
 * integer-frame API and this clock will become the single source of
 * truth for test timing.
 */
import type { Clock } from "../../src/runtime/clock";
import { FRAME_MS } from "../../src/runtime/clock";

export class FakeClock implements Clock {
  private frame = 0;
  private disposed = false;

  nowFrames(): number {
    return this.frame;
  }

  async wait(frames: number): Promise<void> {
    if (this.disposed) return;
    this.frame += Math.max(0, Math.floor(frames));
  }

  async waitMs(ms: number): Promise<void> {
    if (this.disposed) return;
    this.frame += Math.max(0, Math.floor(ms / FRAME_MS));
  }

  dispose(): void {
    this.disposed = true;
  }
}
