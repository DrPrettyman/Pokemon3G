/**
 * Bouncing "press A to continue" down-arrow sprite.
 *
 * Ports `SpriteCB_TextCursor` from FireRed `src/text.c:1284-1310`: a
 * 16×16 sprite that cycles y2 through {0, 1, 2, 1} pixels, each state
 * held for `CURSOR_DELAY = 8` frames (`src/text.c:11`). Total period
 * is 32 frames.
 *
 * The graphic comes from `graphics/fonts/down_arrow_3.png`, copied
 * into `src/assets/hud/press_a_arrow.png` by the decomp-asset
 * extraction step. Only the `_3` variant is used — `_4` is a
 * horizontal-scroll arrow the decomp picks based on `sheetId`, and
 * we never need it for a plain page-break prompt.
 *
 * The creator sits at `(x + 3, y + 4)` relative to the passed-in
 * origin, matching `CreateTextCursorSprite` at `src/text.c:1318`.
 */
import * as Phaser from "phaser";
import type { Clock } from "../../runtime/clock";
import { HUD_CURSOR_FRAME_STEP } from "../../runtime/timings";

export const HUD_PRESS_A_ARROW_KEY = "hud:press_a_arrow";

/** Y-offset per animation state. Decomp `SpriteCB_TextCursor` switch. */
const Y_OFFSETS = [0, 1, 2, 1] as const;

export interface HudCursorOptions {
  /**
   * Anchor position in the scene's GBA-native coordinate space. The
   * decomp offsets the sprite by (x+3, y+4) from whichever corner it
   * was asked to mount against; pass the pre-offset coordinate here
   * (i.e. already add 3/4 at the call site) so this class stays a
   * pure animator.
   */
  x: number;
  y: number;
  /** Render depth — default sits above the textbox chrome (80) but
   *  below dialogue glyphs (100), so the arrow paints on the chrome
   *  frame without overlapping typed text. */
  depth?: number;
}

export class HudCursor {
  private readonly image: Phaser.GameObjects.Image;
  private readonly baseY: number;
  private state = 0;
  private running = true;

  constructor(
    scene: Phaser.Scene,
    private readonly clock: Clock,
    opts: HudCursorOptions,
  ) {
    this.baseY = opts.y;
    this.image = scene.add
      .image(opts.x, opts.y, HUD_PRESS_A_ARROW_KEY)
      .setOrigin(0, 0)
      .setDepth(opts.depth ?? 90);
    void this.tick();
  }

  private async tick(): Promise<void> {
    while (this.running) {
      this.image.y = this.baseY + Y_OFFSETS[this.state];
      await this.clock.wait(HUD_CURSOR_FRAME_STEP);
      this.state = (this.state + 1) % Y_OFFSETS.length;
    }
  }

  destroy(): void {
    this.running = false;
    this.image.destroy();
  }
}
