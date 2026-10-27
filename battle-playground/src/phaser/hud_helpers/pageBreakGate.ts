/**
 * Installs a page-break handler on a `BitmapFontPrinter`: when the
 * printer hits `\f`, a bouncing down-arrow (`HudCursor`) appears and
 * the flow pauses until A or B is pressed. Holding B accelerates
 * text via `printer.setSkip`.
 *
 * Returns a dispose function that tears down all subscriptions.
 */
import * as Phaser from "phaser";
import type { Clock } from "../../runtime/clock";
import type { BitmapFontPrinter } from "../BitmapFont";
import { HudCursor } from "./HudCursor";
import type { HudInput } from "./HudInput";

export interface PageBreakGateOptions {
  printer: BitmapFontPrinter;
  promptX: number;
  promptY: number;
}

export function installPageBreakGate(
  scene: Phaser.Scene,
  clock: Clock,
  input: HudInput,
  opts: PageBreakGateOptions,
): () => void {
  const { printer } = opts;
  let cursor: HudCursor | null = null;

  const unsubPress = input.onPress((btn) => {
    if (btn === "B") printer.setSkip(true);
  });
  const unsubRelease = input.onRelease((btn) => {
    if (btn === "B") printer.setSkip(false);
  });

  printer.setPageBreakHandler(async () => {
    cursor = new HudCursor(scene, clock, {
      x: opts.promptX,
      y: opts.promptY,
    });
    await input.waitForPress(["A", "B"]);
    cursor.destroy();
    cursor = null;
  });

  function dispose(): void {
    unsubPress();
    unsubRelease();
    cursor?.destroy();
    cursor = null;
    printer.setPageBreakHandler(null);
    printer.setSkip(false);
  }

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, dispose);
  return dispose;
}
