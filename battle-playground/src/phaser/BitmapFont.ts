/**
 * Pokémon Gen 3 Latin font — DOM-backed printer.
 *
 * We use the real game font converted to OpenType
 * (`src/assets/font/Emerald.ttf`, sourced from `pokefont/`) via CSS
 * `@font-face` + `@font-palette-values`. Rendering goes through a
 * Phaser 4 `DOMElement` so the CSS custom palette picks up in the
 * browser — canvas 2D `fillText` would ignore COLRv1 color glyphs and
 * we'd get the font's default black+light-gray palette on our dark-teal
 * battle textbox. The DOMElement layer is scaled by the Phaser game
 * zoom so the text stays in sync with the 3× stage.
 *
 * The class still exposes the same public API the rest of the scene
 * relies on: `print` / `printInstant` / `clear` / `destroy` and a
 * `container` GameObject for tweening (damage popup fade-out).
 *
 * Decomp text control characters honored:
 *   - `\n` — hard line break (inserted into the span as a real newline;
 *     the span uses `white-space: pre` so newlines render).
 *   - `\f` — page break; awaits a caller-supplied handler before
 *     clearing and printing the next page. The HUD installs a handler
 *     that shows the bouncing down-arrow sprite and waits for the
 *     player to press A (decomp `CHAR_PROMPT_CLEAR` / 0xFB in
 *     `include/characters.h`). Without a handler the printer resolves
 *     the page break immediately — useful for headless tests.
 */
import * as Phaser from "phaser";
import type { Clock } from "../runtime/clock";
import {
  TEXT_SPEED_FAST_FRAMES_PER_CHAR,
  TEXT_SPEED_MID_FRAMES_PER_CHAR,
} from "../runtime/timings";

/**
 * Decomp battle message window width — 208 px minus 2 px of gutter
 * each side (`src/battle_message.c:2411` sets `.x = 2, .y = 2`).
 * The Emerald font ships with 1em = 16 font units, so a `max-width`
 * expressed in CSS pixels lines up 1:1 with GBA pixels.
 */
export const BATTLE_MSG_MAX_WIDTH = 204;

/** Visible line spacing for 16px Emerald text. Matches decomp `lineSpacing = 2`. */
const LINE_HEIGHT_PX = 16;

/**
 * Default glyph-reveal cadence. Values from `sTextSpeedFrameDelays` in
 * FireRed `src/new_menu_helpers.c:27-31`:
 *
 *   [OPTIONS_TEXT_SPEED_SLOW] = 8
 *   [OPTIONS_TEXT_SPEED_MID]  = 4
 *   [OPTIONS_TEXT_SPEED_FAST] = 1
 *
 * We default to MID (matching FireRed's default save-state option) and
 * expose FAST as the "B held to skip" cadence.
 */
const DEFAULT_SLOW_FRAMES_PER_CHAR = TEXT_SPEED_MID_FRAMES_PER_CHAR;
const DEFAULT_FAST_FRAMES_PER_CHAR = TEXT_SPEED_FAST_FRAMES_PER_CHAR;

export type PrinterPalette = "dialogue" | "hud";

/**
 * Size variant. `"normal"` renders at the native Emerald.ttf 16×16
 * metrics, matching the decomp's `FONT_NORMAL` / `FONT_NORMAL_COPY_1`.
 * `"small"` is a CSS `scale(0.5)` reduction used to stand in for the
 * decomp's `FONT_SMALL` (`graphics/fonts/latin_small.png`, 8×8 glyphs)
 * without requiring a separate bitmap-font extraction step. Our
 * Emerald.ttf only ships the 16-px variant, so scaled-down glyphs
 * are pixel-aligned (Phaser already forces `image-rendering: pixelated`
 * on the canvas) and read as the right size visually.
 */
export type PrinterSize = "normal" | "small";

/**
 * Handler invoked when the printer hits a `\f` page-break. The printer
 * pauses glyph reveal, calls this, and only clears + starts the next
 * page once the returned promise resolves.
 *
 * The default handler resolves immediately — tests and any consumer
 * that doesn't need the A-press gate (damage popup, healthbox readout)
 * see the old "pages flatten" behavior. `HudTextbox` installs a real
 * handler that shows the bouncing arrow sprite and waits for input.
 */
export type PageBreakHandler = () => Promise<void>;

export interface PrinterOptions {
  /** Top-left of the text area, in GBA-native pixels. */
  x: number;
  y: number;
  /** Max width before the browser wraps the text (defaults to BATTLE_MSG_MAX_WIDTH). */
  maxWidth?: number;
  /** Render depth — defaults to 100 so text sits above the textbox chrome. */
  depth?: number;
  /** Which `@font-palette-values` block to apply. Defaults to `dialogue`. */
  palette?: PrinterPalette;
  /** "normal" (16-px, default) or "small" (CSS 0.5× scale, stand-in for FONT_SMALL). */
  size?: PrinterSize;
  /** Frames per glyph reveal. `fast` flag on `print()` picks between the two. */
  slowFramesPerChar?: number;
  fastFramesPerChar?: number;
}

/**
 * Typewriter printer tied to a Phaser scene and a Clock. Create one per
 * text surface (dialogue textbox, healthbox name, HP readout, damage
 * popup). Call `print(text)` to reveal a string one glyph per tick;
 * call `printInstant(text)` for no-delay paint; call `clear()` to wipe.
 *
 * Internally we mount a `<div class="gba-text dialogue">` into a
 * Phaser DOMElement, and build one `<div class="gba-text-line">`
 * child per line of text (split on `\n`). Each line is its own
 * paint context, which is necessary for Chrome/Blink to apply
 * `font-palette` uniformly to every glyph — if we used a single
 * `<span>` with `white-space: pre-wrap` and `\n` inside, the first
 * glyph after each hard line break would render with the font's
 * default CPAL palette instead of our override (visible as a grey
 * first character on the second line).
 *
 * Typewriter reveals work by appending characters into the active
 * line's `textContent`, never by creating/destroying the line
 * nodes mid-reveal. `\f` splits the input into pages and the
 * printer waits between them.
 */
export class BitmapFontPrinter {
  /**
   * The Phaser GameObject backing this printer. Exposed readonly so
   * callers can tween its `alpha` / position for popup effects (damage
   * popup). It's a `DOMElement` under the hood, but typed as
   * `GameObject` so the rest of the scene can treat it generically.
   */
  readonly container: Phaser.GameObjects.DOMElement;
  private readonly root: HTMLDivElement;
  private readonly opts: Required<PrinterOptions>;
  private printToken = 0;
  private pageBreakHandler: PageBreakHandler = () => Promise.resolve();
  /**
   * When `true`, an in-flight `print()` that hasn't completed yet
   * starts reading glyphs at the FAST cadence (1 frame/char) instead
   * of the caller-selected SLOW cadence. `HudInput` flips this on the
   * B button edge so holding B accelerates text in real time, matching
   * the decomp's text-skip behavior.
   */
  private skipEngaged = false;

  constructor(
    _scene: Phaser.Scene,
    private readonly clock: Clock,
    options: PrinterOptions,
  ) {
    this.opts = {
      maxWidth: BATTLE_MSG_MAX_WIDTH,
      depth: 100,
      palette: "dialogue",
      size: "normal",
      slowFramesPerChar: DEFAULT_SLOW_FRAMES_PER_CHAR,
      fastFramesPerChar: DEFAULT_FAST_FRAMES_PER_CHAR,
      ...options,
    };

    // Build a root `<div>` up front; Phaser wraps it in a DOMElement
    // and positions/scales it via the scene's transform pipeline.
    // Lines are appended as child divs, one per `\n`-delimited line,
    // so `font-palette` applies per-line without Blink's line-break
    // palette-reset bug kicking in.
    const root = document.createElement("div");
    const sizeClass = this.opts.size === "small" ? " small" : "";
    root.className = `gba-text ${this.opts.palette}${sizeClass}`;
    root.style.display = "inline-block";
    root.style.maxWidth = `${this.opts.maxWidth}px`;
    root.style.wordBreak = "normal";
    root.style.overflowWrap = "normal";
    // `pre` (not `pre-wrap`) inside each line div — the root holds
    // the lines stacked vertically, no wrap across them.
    root.style.whiteSpace = "normal";
    this.root = root;

    this.container = _scene.add
      .dom(this.opts.x, this.opts.y, root)
      .setOrigin(0, 0)
      .setDepth(this.opts.depth);
  }

  private makeLineDiv(): HTMLDivElement {
    const line = document.createElement("div");
    line.className = "gba-text-line";
    // Min-height keeps empty lines taking their full glyph slot.
    line.style.minHeight = `${LINE_HEIGHT_PX}px`;
    line.style.lineHeight = `${LINE_HEIGHT_PX}px`;
    line.style.whiteSpace = "pre";
    // Set font-palette inline as a defense in depth — Chrome
    // sometimes paints the first glyph of a freshly-mounted node
    // with the font's default CPAL palette before a class-based
    // `font-palette: var(--…)` rule applies, leaving that single
    // glyph in the wrong color (e.g. the "T" of "TRUBBISH" line
    // 2 of "What will\nTRUBBISH do?"). An inline `setProperty`
    // commits the override before any text is laid out.
    const fp =
      this.opts.palette === "dialogue" ? "--battle-msg" : "--battle-hud";
    line.style.setProperty("font-palette", fp);
    // Hide overflow so the clip-path reveal works.
    line.style.overflow = "hidden";
    return line;
  }

  /** Abort any running print and wipe the current text. */
  clear(): void {
    this.printToken++;
    this.root.textContent = "";
  }

  /**
   * Reveal `text` one character per tick. Control characters:
   *   - `\n` renders as a hard line break.
   *   - `\f` splits the text into pages; the printer waits 64 frames
   *     after each page, clears, and prints the next.
   *
   * Resolves when the final page finishes OR when a subsequent
   * `print`/`clear` interrupts this one (callers don't hang; check
   * `printToken` before branching on success).
   */
  async print(text: string, fast = false): Promise<void> {
    this.clear();
    const token = ++this.printToken;
    const slow = this.opts.slowFramesPerChar;
    const pickFrames = () =>
      fast || this.skipEngaged ? this.opts.fastFramesPerChar : slow;
    const pages = text.split("\f");

    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      if (token !== this.printToken) return;
      if (pageIdx > 0) {
        // Wait for the caller's page-break handler (HUD: press A). If
        // the printer is interrupted mid-handler, bail out without
        // clearing content — whoever bumped `printToken` owns the
        // next render.
        await this.pageBreakHandler();
        if (token !== this.printToken) return;
        this.root.textContent = "";
      }
      const lines = pages[pageIdx].split("\n");
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        if (token !== this.printToken) return;
        const lineText = lines[lineIdx];
        // Paint the entire line up front, then reveal it
        // character-by-character via `clip-path: inset()`. Two
        // benefits over the previous "append chars" approach:
        //
        //   1. Text content is set exactly ONCE, so Blink lays
        //      out every glyph in a single pass and `font-palette`
        //      applies uniformly. The bug where the first glyph
        //      of a freshly-painted text node uses the font's
        //      default CPAL palette (visible as a grey "T" on
        //      "What will\nTRUBBISH do?") cannot recur — every
        //      glyph is part of the initial layout, never added
        //      after the fact.
        //   2. No per-tick DOM mutation, so cheaper at runtime.
        //
        // Reveal cadence is one character per `pickFrames()` tick;
        // the clip ratio steps in `1 / lineText.length` increments
        // so the revealed area grows by ~one glyph per tick (close
        // enough to the decomp's per-glyph advance for our
        // proportional Emerald font).
        const lineDiv = this.makeLineDiv();
        lineDiv.textContent = lineText;
        // Start fully clipped — no character visible yet.
        lineDiv.style.clipPath = "inset(0 100% 0 0)";
        this.root.appendChild(lineDiv);

        const charCount = lineText.length;
        for (let i = 0; i < charCount; i++) {
          if (token !== this.printToken) return;
          const revealed = (i + 1) / charCount;
          const rightInset = (1 - revealed) * 100;
          lineDiv.style.clipPath = `inset(0 ${rightInset}% 0 0)`;
          await this.clock.wait(pickFrames());
        }
        // Drop the clip once the line is fully revealed.
        lineDiv.style.clipPath = "none";
      }
    }
  }

  /**
   * Install the handler invoked at each `\f` page break. Pass `null`
   * to restore the default no-op. `HudTextbox` calls this in its
   * constructor to wire the bouncing arrow + A-press gate.
   */
  setPageBreakHandler(handler: PageBreakHandler | null): void {
    this.pageBreakHandler = handler ?? (() => Promise.resolve());
  }

  /**
   * Toggle the "B held = FAST cadence" override on an in-flight print.
   * The HUD input layer calls `setSkip(true)` on B-down and `setSkip(false)`
   * on B-up so holding B accelerates the current message in real time.
   */
  setSkip(on: boolean): void {
    this.skipEngaged = on;
  }

  /**
   * Paint `text` instantly. Page breaks (`\f`) are flattened — only the
   * last page is shown, since an instant paint has no time axis to
   * step through them. Used by the healthbox (name + HP readout) and
   * the damage popup.
   */
  printInstant(text: string): void {
    this.clear();
    this.printToken++;
    const pages = text.split("\f");
    const lastPage = pages[pages.length - 1];
    for (const lineText of lastPage.split("\n")) {
      const lineDiv = this.makeLineDiv();
      lineDiv.textContent = lineText;
      this.root.appendChild(lineDiv);
    }
  }

  destroy(): void {
    this.printToken++;
    this.container.destroy();
  }
}
