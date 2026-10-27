/**
 * Pixel-level positions inside the 128-wide FireRed healthbox chrome
 * sprites. Offsets are relative to the healthbox container's top-left
 * corner; the container itself is positioned absolutely in the scene
 * by the `HealthBox` constructor.
 *
 * Structure (both sides):
 *   Row 1: Name + gender symbol (left)  |  "Lv50" (right)
 *   Row 2: HP bar fill inside the chrome rail
 * Player only:
 *   Row 3: HP fraction text "20/55" (right-aligned)
 *   Beneath box: EXP bar (64 px wide)
 */

export interface HealthBoxLayout {
  width: number;
  height: number;
  nameX: number;
  nameY: number;
  levelX: number;
  levelY: number;
  hpBarX: number;
  hpBarY: number;
  hpBarWidth: number;
  hpBarHeight: number;
}

export interface PlayerHealthBoxLayout extends HealthBoxLayout {
  hpTextX: number;
  hpTextY: number;
  expBarX: number;
  expBarY: number;
  expBarWidth: number;
  expBarHeight: number;
}

export const PLAYER_HEALTHBOX_LAYOUT: PlayerHealthBoxLayout = {
  width: 128,
  height: 64,
  nameX: 19,
  nameY: 5,
  levelX: 80,
  levelY: 5,
  hpBarX: 48,
  hpBarY: 33,
  hpBarWidth: 48,
  hpBarHeight: 3,
  hpTextX: 42,
  hpTextY: 39,
  expBarX: 32,
  expBarY: 55,
  expBarWidth: 64,
  expBarHeight: 2,
};

export const OPPONENT_HEALTHBOX_LAYOUT: HealthBoxLayout = {
  width: 128,
  height: 32,
  nameX: 7,
  nameY: 4,
  levelX: 68,
  levelY: 4,
  hpBarX: 36,
  hpBarY: 23,
  hpBarWidth: 48,
  hpBarHeight: 3,
};

/** Decomp EXP bar fill color (blue). */
export const EXP_BAR_COLOR = 0x4098d8;
/** Decomp EXP bar width in pixels (B_EXPBAR_NUM_PIXELS). */
export const EXP_BAR_PIXELS = 64;
