/**
 * Layout constants for the battle HUD menus. Each constant bundles
 * the chrome texture key, cell positions, and navigation grid so
 * callers never deal with pixel offsets.
 *
 * Cell offsets come from the decomp `sTextOnWindowsInfo_Normal`
 * tables in `src/battle_message.c:2408-2527` combined with the
 * tilemap positions in `src/battle_bg.c:143-241`.
 */
import type { MenuLayout, PanelLayout } from "./hud_helpers";

/**
 * Action menu: B_WIN_ACTION_MENU (src/battle_bg.c:161).
 * 14×6 tile chrome (112×48 px) at screen (128, 112). Cell offsets
 * from gText_BattleMenu `FIGHT{CLEAR_TO 56}BAG\nPOKéMON{CLEAR_TO 56}RUN`.
 */
export const ACTION_MENU: MenuLayout = {
  chromeKey: "hud:menu_chrome_action",
  cells: [
    { id: "fight",   x: 16, y: 9,  maxWidth: 56, label: "FIGHT"   },
    { id: "bag",     x: 72, y: 9,  maxWidth: 40, label: "BAG"     },
    { id: "pokemon", x: 16, y: 25, maxWidth: 56, label: "POKéMON" },
    { id: "run",     x: 72, y: 25, maxWidth: 40, label: "RUN"     },
  ],
  grid: [
    ["fight",   "bag"],
    ["pokemon", "run"],
  ],
  defaultInitialId: "fight",
};

/**
 * Move-name list: B_WIN_MOVE_NAME_1..4 (src/battle_bg.c:170-211).
 * 20×6 tile chrome (160×48 px) at screen (0, 112). FONT_SMALL.
 */
export const MOVE_NAMES: MenuLayout = {
  chromeKey: "hud:menu_chrome_move_names",
  cells: [
    { id: "slot0", x: 16, y: 9,  maxWidth: 128, size: "small" },
    { id: "slot1", x: 88, y: 9,  maxWidth: 128, size: "small" },
    { id: "slot2", x: 16, y: 25, maxWidth: 128, size: "small" },
    { id: "slot3", x: 88, y: 25, maxWidth: 128, size: "small" },
  ],
  grid: [
    ["slot0", "slot1"],
    ["slot2", "slot3"],
  ],
  defaultInitialId: "slot0",
};

/**
 * Move-info pane: B_WIN_PP / B_WIN_PP_REMAINING / B_WIN_MOVE_TYPE
 * (src/battle_bg.c:213-241). 10×6 tile chrome (80×48 px) at
 * screen (160, 112). Not a menu — display-only panel.
 */
/**
 * Yes/No confirm: B_WIN_YESNO (src/battle_bg.c:269).
 * 6×6 tile chrome (48×48 px). Interior 4×4 tiles (32×32 px).
 * Decomp places it at tilemapLeft=25 tilemapTop=9 → screen (200, 72).
 * Anchor is caller-provided since the Y depends on context.
 */
export const YES_NO: MenuLayout = {
  chromeKey: "hud:menu_chrome_yesno",
  cells: [
    { id: "yes", x: 16, y: 9,  maxWidth: 24, label: "Yes" },
    { id: "no",  x: 16, y: 25, maxWidth: 24, label: "No"  },
  ],
  grid: [
    ["yes"],
    ["no"],
  ],
  defaultInitialId: "yes",
};

export const MOVE_INFO: PanelLayout = {
  chromeKey: "hud:menu_chrome_move_info",
  cells: [
    { id: "pp",    x: 8,  y: 10, maxWidth: 24, size: "small"  },
    { id: "ppNum", x: 42, y: 10, maxWidth: 48, size: "normal" },
    { id: "type",  x: 8,  y: 26, maxWidth: 72, size: "small"  },
  ],
};
