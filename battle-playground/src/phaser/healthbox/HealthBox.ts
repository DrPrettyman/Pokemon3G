/**
 * Abstract base class for a Gen 3 in-battle healthbox. One instance
 * per Pokemon — constructed when a mon enters the battlefield, destroyed
 * when it leaves. Owns the chrome sprite, HP bar fill, name/level
 * printers, gender symbol, and the Pokemon reference that drives them.
 *
 * The Pokemon passed to the constructor is the source of truth. The
 * healthbox paints itself fully on construction (visible, name/level/
 * gender/HP snapped), then:
 *   - `refresh()` post-damage or post-EXP-gain animates the bar one
 *     bar-pixel per GBA frame toward the Pokemon's current state.
 *   - `refreshInstant()` re-snaps every field with no animation (used
 *     for level-ups mid-battle or pre-faint zeroing).
 *
 * The concrete `PlayerHealthBox` extends this with HP fraction text
 * and an EXP bar; `OpponentHealthBox` uses the base behaviour as-is.
 */
import * as Phaser from "phaser";
import type { Pokemon } from "pokedata3g";
import type { Clock } from "../../runtime/clock";
import { BitmapFontPrinter } from "../BitmapFont";
import type { HealthBoxLayout } from "./layouts";

export interface HealthBoxConfig {
  /** The Pokemon this healthbox is bound to for its entire lifetime. */
  pokemon: Pokemon;
  /** Texture key for the chrome sprite (e.g. `hud:healthbox_player`). */
  chromeKey: string;
  /** Top-left of the chrome in scene coordinates. */
  x: number;
  y: number;
  /** Depth band for the chrome container. Printers render one above. */
  depth?: number;
  layout: HealthBoxLayout;
}

/** Gen 3 HP bar pixel width — matches `HP_BAR_PIXELS` in timings.ts. */
const HP_BAR_PIXELS = 48;

export abstract class HealthBox {
  protected readonly scene: Phaser.Scene;
  protected readonly clock: Clock;
  protected readonly layout: HealthBoxLayout;
  readonly pokemon: Pokemon;

  protected readonly container: Phaser.GameObjects.Container;
  protected readonly hpFill: Phaser.GameObjects.Rectangle;
  protected readonly namePrinter: BitmapFontPrinter;
  protected readonly levelPrinter: BitmapFontPrinter;
  protected readonly genderEl: HTMLSpanElement;
  protected readonly genderDom: Phaser.GameObjects.DOMElement;

  /** Currently-displayed HP in HP units (not bar-pixels). */
  protected displayedHp = 0;
  /** In-flight HP animation; calls to `refresh()` await the previous one. */
  private hpAnimation: Promise<void> = Promise.resolve();
  private destroyed = false;

  constructor(scene: Phaser.Scene, clock: Clock, cfg: HealthBoxConfig) {
    this.scene = scene;
    this.clock = clock;
    this.layout = cfg.layout;
    this.pokemon = cfg.pokemon;

    const depth = cfg.depth ?? 75;
    this.container = scene.add.container(cfg.x, cfg.y).setDepth(depth);
    const chrome = scene.add.image(0, 0, cfg.chromeKey).setOrigin(0, 0);
    this.hpFill = scene.add
      .rectangle(
        this.layout.hpBarX,
        this.layout.hpBarY,
        this.layout.hpBarWidth,
        this.layout.hpBarHeight,
        0x40e040,
      )
      .setOrigin(0, 0);
    this.container.add([chrome, this.hpFill]);

    const textDepth = depth + 1;
    this.namePrinter = new BitmapFontPrinter(scene, clock, {
      x: cfg.x + this.layout.nameX,
      y: cfg.y + this.layout.nameY,
      depth: textDepth,
      palette: "hud",
      maxWidth: 56,
    });
    this.levelPrinter = new BitmapFontPrinter(scene, clock, {
      x: cfg.x + this.layout.levelX,
      y: cfg.y + this.layout.levelY,
      depth: textDepth,
      palette: "hud",
      maxWidth: 40,
    });

    this.genderEl = document.createElement("span");
    this.genderEl.className = "gender-symbol";
    this.genderDom = scene.add
      .dom(cfg.x + this.layout.nameX + 48, cfg.y + this.layout.nameY, this.genderEl)
      .setOrigin(0, 0)
      .setDepth(textDepth);
  }

  /**
   * Paint every field from the Pokemon and reveal the chrome. Subclasses
   * call this at the end of their own constructors (after their extras
   * are built) so the initial paint sees all fields wired up.
   */
  protected paintInitial(): void {
    this.paintName(this.pokemon.name);
    this.paintLevel(this.pokemon.level);
    this.paintGender(this.pokemon.gender);
    this.displayedHp = this.pokemon.currentHp;
    this.paintHpBar(this.pokemon.currentHp, this.pokemon.maxHp);
    this.paintHpText(this.pokemon.currentHp, this.pokemon.maxHp);
    this.onRefreshInstant();
    this.container.setVisible(true);
  }

  /** Snap every field to the Pokemon's current state. No animation. */
  refreshInstant(): void {
    const p = this.pokemon;
    this.paintName(p.name);
    this.paintLevel(p.level);
    this.paintGender(p.gender);
    this.displayedHp = p.currentHp;
    this.paintHpBar(p.currentHp, p.maxHp);
    this.paintHpText(p.currentHp, p.maxHp);
    this.onRefreshInstant();
  }

  /**
   * Read everything off the Pokemon. Name/level/gender paint instantly.
   * If HP differs from what's displayed, animate one bar-pixel per frame
   * until they match; if a subclass exposes an EXP bar and it drifted,
   * animate that afterwards. Resolves when everything has settled.
   */
  refresh(): Promise<void> {
    const p = this.pokemon;
    this.paintName(p.name);
    this.paintLevel(p.level);
    this.paintGender(p.gender);
    this.hpAnimation = this.hpAnimation.then(() => this.animateTo(p));
    return this.hpAnimation;
  }

  setVisible(visible: boolean): void {
    this.container.setVisible(visible);
    this.genderDom.setVisible(visible && this.genderEl.textContent !== "");
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.namePrinter.destroy();
    this.levelPrinter.destroy();
    this.genderDom.destroy();
    this.container.destroy();
    this.onDestroy();
  }

  // ---- Hooks for subclasses ----

  /** Called at the end of `refreshInstant` — subclass snaps extras. */
  protected onRefreshInstant(): void {}

  /**
   * Called by `animateTo` after the HP drain completes. Subclass may
   * animate additional fields (e.g. EXP bar) and return a promise.
   */
  protected animateExtras(_pokemon: Pokemon): Promise<void> {
    return Promise.resolve();
  }

  /** Called during an HP drain frame — subclass may update extras. */
  protected onHpStep(_currentHp: number, _maxHp: number): void {}

  protected onDestroy(): void {}

  // ---- Private painting helpers ----

  private paintName(name: string): void {
    this.namePrinter.printInstant(name);
  }

  private paintLevel(level: number): void {
    this.levelPrinter.printInstant(`Lv${level}`);
  }

  private paintGender(gender: "male" | "female" | null): void {
    if (gender === "male") {
      this.genderEl.textContent = "♂";
      this.genderEl.className = "gender-symbol gender-male";
      this.genderDom.setVisible(true);
    } else if (gender === "female") {
      this.genderEl.textContent = "♀";
      this.genderEl.className = "gender-symbol gender-female";
      this.genderDom.setVisible(true);
    } else {
      this.genderEl.textContent = "";
      this.genderDom.setVisible(false);
    }
  }

  /** Paint the bar rectangle width + threshold color for `hp/maxHp`. */
  private paintHpBar(hp: number, maxHp: number): void {
    const barPx =
      maxHp <= 0
        ? 0
        : Math.max(
            0,
            Math.min(HP_BAR_PIXELS, Math.round((hp / maxHp) * HP_BAR_PIXELS)),
          );
    this.hpFill.width = barPx;
    // Gen 3 HP bar thresholds from `graphics/battle_interface/healthbar.pal`:
    //   > 50% → bright green, > 20% → yellow, ≤ 20% → red.
    const ratio = maxHp > 0 ? hp / maxHp : 0;
    this.hpFill.fillColor =
      ratio > 0.5 ? 0x00e000 : ratio > 0.2 ? 0xf8b800 : 0xf85838;
  }

  /**
   * Default HP text paint is a no-op — the opponent healthbox has no
   * HP fraction text. `PlayerHealthBox` overrides this.
   */
  protected paintHpText(_hp: number, _maxHp: number): void {}

  /**
   * Drain (or rise) the bar one bar-pixel per GBA frame toward
   * `pokemon.currentHp`, then chain any subclass-provided extras
   * animation (e.g. EXP bar fill).
   */
  private async animateTo(pokemon: Pokemon): Promise<void> {
    if (this.destroyed) return;
    const fromHp = this.displayedHp;
    const toHp = pokemon.currentHp;
    const maxHp = pokemon.maxHp;
    if (fromHp !== toHp && maxHp > 0) {
      const fromPx = Math.round((fromHp / maxHp) * HP_BAR_PIXELS);
      const toPx = Math.round((toHp / maxHp) * HP_BAR_PIXELS);
      const frames = Math.max(1, Math.abs(fromPx - toPx));
      for (let f = 1; f <= frames && !this.destroyed; f++) {
        await this.clock.wait(1);
        const hp = Math.round(fromHp + ((toHp - fromHp) * f) / frames);
        this.displayedHp = Math.max(0, hp);
        this.paintHpBar(this.displayedHp, maxHp);
        this.paintHpText(this.displayedHp, maxHp);
        this.onHpStep(this.displayedHp, maxHp);
      }
    } else {
      // No drain — still re-paint in case maxHp changed (level-up).
      this.paintHpBar(toHp, maxHp);
      this.paintHpText(toHp, maxHp);
    }
    if (!this.destroyed) await this.animateExtras(pokemon);
  }
}
