/**
 * Player-side healthbox. Adds the HP fraction text ("20/55") and the
 * EXP bar beneath the chrome.
 */
import * as Phaser from "phaser";
import type { Pokemon } from "pokedata3g";
import { getExpTable } from "pokedata3g";
import type { Clock } from "../../runtime/clock";
import { BitmapFontPrinter } from "../BitmapFont";
import { HealthBox, type HealthBoxConfig } from "./HealthBox";
import {
  EXP_BAR_COLOR,
  EXP_BAR_PIXELS,
  PLAYER_HEALTHBOX_LAYOUT,
  type PlayerHealthBoxLayout,
} from "./layouts";

export interface PlayerHealthBoxConfig extends Omit<HealthBoxConfig, "layout"> {
  layout?: PlayerHealthBoxLayout;
}

function expFractionFor(p: Pokemon): number {
  if (p.level >= 100) return 1;
  const table = getExpTable(p.species.growthRate);
  if (!table) return 0;
  const levelStart = table[p.level - 1];
  const levelEnd = table[p.level];
  const span = levelEnd - levelStart;
  return span > 0 ? (p.exp - levelStart) / span : 0;
}

export class PlayerHealthBox extends HealthBox {
  private readonly hpTextPrinter: BitmapFontPrinter;
  private readonly expFill: Phaser.GameObjects.Rectangle;
  private readonly playerLayout: PlayerHealthBoxLayout;
  private displayedExpPx = 0;

  constructor(scene: Phaser.Scene, clock: Clock, cfg: PlayerHealthBoxConfig) {
    const layout = cfg.layout ?? PLAYER_HEALTHBOX_LAYOUT;
    super(scene, clock, { ...cfg, layout });
    this.playerLayout = layout;

    this.expFill = scene.add
      .rectangle(
        this.playerLayout.expBarX,
        this.playerLayout.expBarY,
        0,
        this.playerLayout.expBarHeight,
        EXP_BAR_COLOR,
      )
      .setOrigin(0, 0);
    this.container.add(this.expFill);

    this.hpTextPrinter = new BitmapFontPrinter(scene, clock, {
      x: cfg.x + this.playerLayout.hpTextX,
      y: cfg.y + this.playerLayout.hpTextY,
      depth: (cfg.depth ?? 75) + 1,
      palette: "hud",
      maxWidth: 80,
    });

    this.paintInitial();
  }

  protected override paintHpText(hp: number, maxHp: number): void {
    this.hpTextPrinter.printInstant(`${Math.max(0, hp)}/${maxHp}`);
  }

  protected override onRefreshInstant(): void {
    const frac = Math.max(0, Math.min(1, expFractionFor(this.pokemon)));
    const px = Math.round(frac * EXP_BAR_PIXELS);
    this.displayedExpPx = px;
    this.expFill.width = px;
  }

  protected override async animateExtras(pokemon: Pokemon): Promise<void> {
    const targetPx = Math.round(
      Math.max(0, Math.min(1, expFractionFor(pokemon))) * EXP_BAR_PIXELS,
    );
    if (targetPx === this.displayedExpPx) return;
    const from = this.displayedExpPx;
    const to = targetPx;
    const frames = Math.max(1, Math.abs(to - from));
    for (let f = 1; f <= frames; f++) {
      await this.clock.wait(1);
      const px = Math.round(from + ((to - from) * f) / frames);
      this.displayedExpPx = px;
      this.expFill.width = px;
    }
  }

  protected override onDestroy(): void {
    this.hpTextPrinter.destroy();
  }
}
