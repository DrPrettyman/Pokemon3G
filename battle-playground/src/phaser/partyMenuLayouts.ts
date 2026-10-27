/**
 * Party menu layout constants — lifted verbatim from the FireRed decomp.
 *
 * Sources:
 *   - `firered/src/data/party_menu.h` — sPartyMenuSpriteCoords, sPartyBoxInfoRects,
 *     sSinglePartyMenuWindowTemplate, sCancelButton_Tilemap
 *   - `firered/src/party_menu.c:1359` — UpdatePartySelectionSingleLayout
 *   - `firered/include/constants/party_menu.h` — PARTY_PAL_*, PARTY_LAYOUT_*
 */

/** Full GBA screen (the party menu takes over, unlike battle which uses 240×112). */
export const PARTY_SCREEN_WIDTH = 240;
export const PARTY_SCREEN_HEIGHT = 160;

// ─── Per-slot sprite coordinates ───────────────────────────────────────────
// From sPartyMenuSpriteCoords[PARTY_LAYOUT_SINGLE].
// Each slot has 4 coordinate pairs: mon, held-item, status-icon, pokeball.

export const SLOT_SPRITE_COORDS = [
  { mon: [16, 40],   item: [20, 50],   status: [56, 52],   ball: [16, 34] },   // slot 0 (left column)
  { mon: [104, 18],  item: [108, 28],  status: [144, 27],  ball: [102, 25] },  // slot 1
  { mon: [104, 42],  item: [108, 52],  status: [144, 51],  ball: [102, 49] },  // slot 2
  { mon: [104, 66],  item: [108, 76],  status: [144, 75],  ball: [102, 73] },  // slot 3
  { mon: [104, 90],  item: [108, 100], status: [144, 99],  ball: [102, 97] },  // slot 4
  { mon: [104, 114], item: [108, 124], status: [144, 123], ball: [102, 121] }, // slot 5
] as const;

// ─── Text offsets within each slot's window ────────────────────────────────
// From sPartyBoxInfoRects[PARTY_BOX_LEFT_COLUMN] and [PARTY_BOX_RIGHT_COLUMN].
// Offsets are relative to the window's top-left pixel.

export const LEFT_COLUMN_TEXT = {
  nickname: { x: 24, y: 11 },
  level:    { x: 32, y: 20 },
  gender:   { x: 64, y: 20 },
  hp:       { x: 38, y: 36 },
  maxHp:    { x: 53, y: 36 },
  hpBar:    { x: 24, y: 35, w: 48, h: 3 },
} as const;

export const RIGHT_COLUMN_TEXT = {
  nickname: { x: 22, y: 3 },
  level:    { x: 32, y: 12 },
  gender:   { x: 64, y: 12 },
  hp:       { x: 102, y: 12 },
  maxHp:    { x: 117, y: 12 },
  hpBar:    { x: 88, y: 10, w: 48, h: 3 },
} as const;

// ─── Window pixel positions ────────────────────────────────────────────────
// From sSinglePartyMenuWindowTemplate: tilemapLeft*8, tilemapTop*8.
// Width/height from the window template's tile dimensions * 8.

export const SLOT_WINDOWS = [
  { x: 8,  y: 24, w: 80,  h: 56 },   // slot 0 (left column, paletteNum=3)
  { x: 96, y: 8,  w: 144, h: 24 },   // slot 1 (paletteNum=4)
  { x: 96, y: 32, w: 144, h: 24 },   // slot 2 (paletteNum=5)
  { x: 96, y: 56, w: 144, h: 24 },   // slot 3 (paletteNum=6)
  { x: 96, y: 80, w: 144, h: 24 },   // slot 4 (paletteNum=7)
  { x: 96, y: 104, w: 144, h: 24 },  // slot 5 (paletteNum=8)
] as const;

// ─── Cancel button ─────────────────────────────────────────────────────────
// CopyToBgTilemapBufferRect_ChangePalette(1, sCancelButton_Tilemap, 23, 18, 7, 2, 17)
// → pixel position: 23*8=184, 18*8=144, 7*8=56 wide, 2*8=16 tall.

export const CANCEL_POS = { x: 184, y: 144, w: 56, h: 16 } as const;

// ─── Message area ──────────────────────────────────────────────────────────
// Window 6: bg=2, tilemapLeft=1, tilemapTop=15, width=28, height=4
// → pixel: 8, 120, 224×32.

export const MESSAGE_POS = { x: 8, y: 120, w: 224, h: 32 } as const;

// ─── HP bar colors ─────────────────────────────────────────────────────────
// From palette IDs: sHPBarGreenPalIds, sHPBarYellowPalIds, sHPBarRedPalIds.
// Each has two colors (fill, shadow); we use the fill color.

export const HP_BAR_GREEN  = 0x73ffac;  // palId 57: (115, 255, 172)
export const HP_BAR_YELLOW = 0xffe639;  // palId 73: (255, 230, 57)
export const HP_BAR_RED    = 0xff7331;  // palId 89: (255, 115, 49)

export function hpBarColor(hp: number, maxHp: number): number {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  if (ratio > 0.5) return HP_BAR_GREEN;
  if (ratio > 0.2) return HP_BAR_YELLOW;
  return HP_BAR_RED;
}

// ─── Gender colors ─────────────────────────────────────────────────────────
// sGenderMalePalIds = {59, 60}, sGenderFemalePalIds = {75, 76}

export const GENDER_MALE_COLOR   = "#41cdff";  // palId 59: (65, 205, 255)
export const GENDER_FEMALE_COLOR = "#ff9c94";  // palId 75: (255, 156, 148)

// ─── Texture keys ──────────────────────────────────────────────────────────
// Registered in PartyMenuScene.preload().

export const PARTY_KEY = {
  bg:             "party:bg",
  slotMain:       "party:slot_main",
  slotMainSel:    "party:slot_main_sel",
  slotMainFnt:    "party:slot_main_fnt",
  slotMainFntSel: "party:slot_main_fnt_sel",
  slotMainNohp:    "party:slot_main_nohp",
  slotMainNohpSel: "party:slot_main_nohp_sel",
  slotWide:       "party:slot_wide",
  slotWideSel:    "party:slot_wide_sel",
  slotWideFnt:    "party:slot_wide_fnt",
  slotWideFntSel: "party:slot_wide_fnt_sel",
  slotWideNohp:    "party:slot_wide_nohp",
  slotWideNohpSel: "party:slot_wide_nohp_sel",
  slotWideEmpty:  "party:slot_wide_empty",
  cancel:         "party:cancel",
  cancelSel:      "party:cancel_sel",
  pokeball:       "party:pokeball",
  pokeballSmall:  "party:pokeball_small",
  holdIcons:      "party:hold_icons",
  eggIcon:        "party:egg_icon",
  eggIcon2:       "party:egg_icon2",
  icon: (id: string) => `party:icon:${id}`,
  iconFrame2: (id: string) => `party:icon2:${id}`,
} as const;
