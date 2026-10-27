/**
 * HUD overlay window — chrome image + text cells + static cursor.
 *
 * Models one decomp `WindowTemplate` (`src/battle_bg.c`). The chrome
 * is a pre-composited PNG of the `gUserFrames` 9-slice frame, and
 * each text cell gets its own `BitmapFontPrinter`.
 *
 * The cursor is a static 8×16 right-arrow sprite (tiles 1+2 from
 * `battle_interface/textbox.png`), positioned 8 px left of the
 * active cell.
 */
import * as Phaser from "phaser";
import type { Clock } from "../../runtime/clock";
import { BitmapFontPrinter } from "../BitmapFont";
import type { PanelLayout } from "./layout";

export const HUD_MENU_CURSOR_KEY = "hud:menu_cursor";

export interface HudWindowOptions {
  layout: PanelLayout;
  x: number;
  y: number;
  depth?: number;
}

export class HudWindow {
  private readonly chrome: Phaser.GameObjects.Image;
  private readonly printers = new Map<string, BitmapFontPrinter>();
  private readonly cellPositions = new Map<string, { x: number; y: number }>();
  private readonly cursor: Phaser.GameObjects.Image;
  private readonly baseX: number;
  private readonly baseY: number;
  private destroyed = false;

  constructor(
    scene: Phaser.Scene,
    clock: Clock,
    opts: HudWindowOptions,
  ) {
    const depth = opts.depth ?? 90;
    this.baseX = opts.x;
    this.baseY = opts.y;

    this.chrome = scene.add
      .image(opts.x, opts.y, opts.layout.chromeKey)
      .setOrigin(0, 0)
      .setDepth(depth);

    const palette = opts.layout.palette ?? "hud";
    for (const cell of opts.layout.cells) {
      this.cellPositions.set(cell.id, { x: cell.x, y: cell.y });
      const printer = new BitmapFontPrinter(scene, clock, {
        x: opts.x + cell.x,
        y: opts.y + cell.y,
        maxWidth: cell.maxWidth,
        depth: depth + 1,
        palette,
        size: cell.size ?? "normal",
      });
      this.printers.set(cell.id, printer);
      if (cell.label) printer.printInstant(cell.label);
    }

    this.cursor = scene.add
      .image(0, 0, HUD_MENU_CURSOR_KEY)
      .setOrigin(0, 0)
      .setDepth(depth + 2)
      .setVisible(false);
  }

  printCell(id: string, text: string): void {
    this.printers.get(id)?.printInstant(text);
  }

  clearCell(id: string): void {
    this.printers.get(id)?.clear();
  }

  setCursor(id: string): void {
    const pos = this.cellPositions.get(id);
    if (!pos) return;
    this.cursor
      .setPosition(this.baseX + pos.x - 8, this.baseY + pos.y)
      .setVisible(true);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const p of this.printers.values()) p.destroy();
    this.printers.clear();
    this.cursor.destroy();
    this.chrome.destroy();
  }
}
