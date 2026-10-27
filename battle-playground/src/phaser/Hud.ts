/**
 * HUD facade — simple async methods, string returns.
 *
 * Wraps the internal hud_helpers (HudInput, HudWindow, runHudMenu,
 * pageBreakGate, BitmapFontPrinter) so callers never deal with pixel
 * offsets, cursor management, or teardown ceremony.
 *
 * Works in battle, overworld, shops — anywhere that needs a textbox
 * and menus.
 */
import * as Phaser from "phaser";
import type { Clock } from "../runtime/clock";
import { BitmapFontPrinter } from "./BitmapFont";
import type { PrinterPalette } from "./BitmapFont";
import { HudInput } from "./hud_helpers/HudInput";
import { HudWindow } from "./hud_helpers/HudWindow";
import { runHudMenu } from "./hud_helpers/runHudMenu";
import { installPageBreakGate } from "./hud_helpers/pageBreakGate";

import {
  ACTION_MENU,
  MOVE_NAMES,
  MOVE_INFO,
  YES_NO,
} from "./battleHudLayouts";


// ---- Public types ----

export interface HudConfig {
  /** Texture key for the textbox chrome image. */
  chromeKey: string;
  /** Top-left of the chrome in scene coordinates. */
  chromeX: number;
  chromeY: number;
  chromeDepth?: number;
  /** Top-left of the text area in scene coordinates. */
  textX: number;
  textY: number;
  textMaxWidth: number;
  textDepth?: number;
  textPalette?: PrinterPalette;
  /** Bouncing arrow prompt anchor (bottom-right of text area). */
  promptX: number;
  promptY: number;
  /**
   * Frames per character for typewriter reveal. Maps to the decomp's
   * OPTIONS_TEXT_SPEED_SLOW (8) / MID (4) / FAST (1). Defaults to 4.
   */
  charSpeed?: number;
}

export interface MoveOption {
  name: string;
  type: string;
  ppNow: number;
  ppMax: number;
  enabled?: boolean;
}

// ---- Class ----

export class Hud {
  private readonly input: HudInput;
  private readonly printer: BitmapFontPrinter;
  private readonly textboxChrome: Phaser.GameObjects.Container;
  private readonly disposePageBreak: () => void;
  private readonly chromeY: number;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly clock: Clock,
    cfg: HudConfig,
  ) {
    this.chromeY = cfg.chromeY;

    this.textboxChrome = scene.add
      .container(cfg.chromeX, cfg.chromeY)
      .setDepth(cfg.chromeDepth ?? 80);
    const chrome = scene.add
      .image(0, 0, cfg.chromeKey)
      .setOrigin(0, 0);
    this.textboxChrome.add(chrome);

    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.load("16px Emerald").catch(() => undefined);
    }

    this.printer = new BitmapFontPrinter(scene, clock, {
      x: cfg.textX,
      y: cfg.textY,
      maxWidth: cfg.textMaxWidth,
      depth: cfg.textDepth ?? 100,
      palette: cfg.textPalette ?? "dialogue",
      ...(cfg.charSpeed != null ? { slowFramesPerChar: cfg.charSpeed } : {}),
    });

    this.input = new HudInput(scene);
    this.disposePageBreak = installPageBreakGate(scene, clock, this.input, {
      printer: this.printer,
      promptX: cfg.promptX,
      promptY: cfg.promptY,
    });
  }

  // ---- Text ----

  /** Typewriter-reveal text in the textbox. Handles \\f page breaks. */
  async dialogue(text: string, fast = false): Promise<void> {
    await this.printer.print(text, fast);
  }

  /** Instantly paint text in the textbox (no typewriter). */
  dialogueInstant(text: string): void {
    this.printer.printInstant(text);
  }

  /** Clear the textbox. */
  dialogueClear(): void {
    this.printer.clear();
  }

  // ---- Menus ----

  /**
   * Text in textbox + small Yes/No chrome above-right.
   * B returns "no".
   */
  async yesNoQuestion(text: string): Promise<"yes" | "no"> {
    await this.printer.print(text);

    const window = new HudWindow(this.scene, this.clock, {
      layout: YES_NO,
      x: 192,
      y: this.chromeY - 48,
      depth: 90,
    });
    try {
      const result = await runHudMenu(window, this.input, {
        grid: YES_NO.grid,
        initialId: YES_NO.defaultInitialId,
        cancellable: true,
      });
      return "cancel" in result ? "no" : (result.id as "yes" | "no");
    } finally {
      window.destroy();
    }
  }

  /**
   * "What will\\n<name> do?" + 2x2 action menu.
   * Returns "fight", "bag", "switch", or "run".
   *
   * All four options are always selectable — the decomp doesn't grey
   * out any action at this stage. The battle script validates the
   * choice afterwards and shows the appropriate rejection message
   * (e.g. "Can't escape!" / "X is trapped!").
   */
  async battleOptions(
    pokemonName: string,
  ): Promise<"fight" | "bag" | "switch" | "run"> {
    this.printer.printInstant(`What will\n${pokemonName} do?`);

    const window = new HudWindow(this.scene, this.clock, {
      layout: ACTION_MENU,
      x: 128,
      y: this.chromeY,
      depth: 90,
    });
    try {
      const result = await runHudMenu(window, this.input, {
        grid: ACTION_MENU.grid,
        initialId: ACTION_MENU.defaultInitialId,
      });
      if ("cancel" in result) return "fight";
      const id = result.id;
      return id === "pokemon" ? "switch" : (id as "fight" | "bag" | "run");
    } finally {
      window.destroy();
    }
  }

  /**
   * Move-select: 2x2 move grid + info pane showing PP and type.
   * Returns the move name, or "" on cancel (B).
   */
  async moveOptions(moves: MoveOption[]): Promise<string> {
    const priorChromeVisible = this.textboxChrome.visible;
    this.textboxChrome.setVisible(false);
    this.printer.clear();

    const namesWindow = new HudWindow(this.scene, this.clock, {
      layout: MOVE_NAMES,
      x: 0,
      y: this.chromeY,
      depth: 90,
    });
    const infoWindow = new HudWindow(this.scene, this.clock, {
      layout: MOVE_INFO,
      x: 160,
      y: this.chromeY,
      depth: 90,
    });

    const disabled = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const id = `slot${i}`;
      const m = moves[i];
      namesWindow.printCell(id, m?.name ?? "-");
      if (!m || m.enabled === false) disabled.add(id);
    }

    const paintInfo = (slotIndex: number): void => {
      const m = moves[slotIndex];
      if (!m) {
        infoWindow.clearCell("pp");
        infoWindow.clearCell("ppNum");
        infoWindow.clearCell("type");
        return;
      }
      infoWindow.printCell("pp", "PP");
      infoWindow.printCell("ppNum", `${m.ppNow}/${m.ppMax}`);
      infoWindow.printCell("type", `TYPE/${m.type}`);
    };

    const initialSlot =
      [0, 1, 2, 3].find((i) => !disabled.has(`slot${i}`)) ?? 0;
    paintInfo(initialSlot);

    try {
      const result = await runHudMenu(namesWindow, this.input, {
        grid: MOVE_NAMES.grid,
        initialId: `slot${initialSlot}`,
        disabled: disabled.size > 0 ? disabled : undefined,
        cancellable: true,
        onCursorChange: (id) =>
          paintInfo(parseInt(id.replace("slot", ""), 10)),
      });
      if ("cancel" in result) return "";
      const slotIndex = parseInt(result.id.replace("slot", ""), 10);
      return moves[slotIndex]?.name ?? "";
    } finally {
      namesWindow.destroy();
      infoWindow.destroy();
      this.textboxChrome.setVisible(priorChromeVisible);
    }
  }

  /**
   * Text in textbox + scrollable option list chrome above-right.
   * Returns the selected option string, or "" on B.
   *
   * If the list is longer than `maxVisible` (default 4), the list
   * scrolls: moving past the bottom visible row shifts the viewport
   * down, and vice versa.
   */
  async multiQuestion(
    text: string,
    options: string[],
    maxVisible = 4,
  ): Promise<string> {
    if (options.length === 0) return "";
    await this.printer.print(text);

    const visible = Math.min(options.length, maxVisible);
    const rowHeight = 16;
    const chromeHeight = visible * rowHeight + 16; // 8px border top + bottom
    const chromeWidth = 80; // 10 tiles — fits most item/option names

    // Build a dynamic layout for the visible rows
    const cells = Array.from({ length: visible }, (_, i) => ({
      id: `opt${i}`,
      x: 16,
      y: 9 + i * rowHeight,
      maxWidth: chromeWidth - 24,
    }));
    const layout = {
      chromeKey: "hud:menu_chrome_yesno", // reuse the 9-slice chrome
      cells,
    };

    // We need a chrome that's the right size. For now reuse the
    // yes/no chrome key — it's a 9-slice so Phaser will render it
    // at whatever size the PNG is. For proper dynamic sizing we'd
    // need a dynamically-rendered 9-slice. For now, generate a
    // layout with the right cells and build a window from it.
    // TODO: dynamic 9-slice chrome rendering for arbitrary sizes
    const window = new HudWindow(this.scene, this.clock, {
      layout,
      x: 240 - chromeWidth - 8,
      y: this.chromeY - chromeHeight,
      depth: 90,
    });

    let scrollOffset = 0;
    let cursorIndex = 0;

    const repaint = () => {
      for (let i = 0; i < visible; i++) {
        const optIndex = scrollOffset + i;
        window.printCell(
          `opt${i}`,
          optIndex < options.length ? options[optIndex] : "",
        );
      }
      window.setCursor(`opt${cursorIndex - scrollOffset}`);
    };
    repaint();

    try {
      for (;;) {
        const btn = await this.input.waitForPress([
          "up", "down", "A", "B",
        ]);
        if (btn === "A") {
          return options[cursorIndex];
        }
        if (btn === "B") {
          return "";
        }
        if (btn === "down" && cursorIndex < options.length - 1) {
          cursorIndex++;
          if (cursorIndex >= scrollOffset + visible) {
            scrollOffset = cursorIndex - visible + 1;
            repaint();
          } else {
            window.setCursor(`opt${cursorIndex - scrollOffset}`);
          }
        }
        if (btn === "up" && cursorIndex > 0) {
          cursorIndex--;
          if (cursorIndex < scrollOffset) {
            scrollOffset = cursorIndex;
            repaint();
          } else {
            window.setCursor(`opt${cursorIndex - scrollOffset}`);
          }
        }
      }
    } finally {
      window.destroy();
    }
  }

  // ---- Chrome visibility ----

  setChromeVisible(visible: boolean): void {
    this.textboxChrome.setVisible(visible);
  }

  get chromeVisible(): boolean {
    return this.textboxChrome.visible;
  }

  // ---- Lifecycle ----

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.disposePageBreak();
    this.input.dispose();
    this.printer.destroy();
    this.textboxChrome.destroy();
  }
}
