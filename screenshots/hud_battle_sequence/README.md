# Battle HUD Sequence — Reference vs Playground

This folder holds two aligned sequences of screenshots:

- **A\*.png** — unmodified Pokémon FireRed captures (ground truth).
- **B\*.png** — screenshots of the same moment from
  `battle-playground` (our Phaser reimplementation).

The three states cover the in-battle HUD lifecycle:

1. `1_what-will-mon-do` — waiting for the player action (root menu).
2. `2_select-move` — inside the FIGHT submenu (move list + info pane).
3. `3_mon-used-attack` — narration after the player commits a move.

Below is a **literal** description of what each screenshot shows so
future changes can be checked against a stable reference. Where a
fact comes from the decomp, the cite is in parentheses.

---

## A1 `A1_what-will-mon-do.png` — FireRed root menu

The full-width bottom HUD is one unified chrome: outer gold/yellow
border, inner thin white/cream border, interior split into two
regions by the inner border.

- **Left region (main message window, `B_WIN_MSG`)** —
  `src/battle_bg.c:143` `tilemapLeft=1, tilemapTop=15, width=28,
  height=4, paletteNum=0`.
  - Background: dark teal/blue (`textbox1.pal` index 7 ≈
    `rgb(82, 98, 156)`).
  - Two lines of text:
      `What will`
      `Bolin do?`
  - Font foreground: white, shadow: muted lavender/grey. Every
    glyph on both lines has the same palette — no grey first-char
    anomaly.
  - Content comes from `gText_WhatWillPkmnDo`
    (`src/battle_message.c:1278`): `"What will\n{B_ACTIVE_NAME_WITH_PREFIX} do?"`.

- **Right region (`B_WIN_ACTION_MENU`)** —
  `src/battle_bg.c:161` `tilemapLeft=17, tilemapTop=35, width=12,
  height=4, paletteNum=5`.
  - Background: **distinctly brighter/whiter than the left region**.
    Palette 5 is rewritten at runtime to near-white
    (`src/battle_bg.c:696-699` → `RGB(31,31,31)` highlight,
    `RGB(9,9,9)` dark text).
  - 2×2 grid of labels:
      `FIGHT    BAG`
      `POKéMON  RUN`
  - Label glyphs are drawn in dark navy with a pale shadow — the
    inverse of the dialogue palette — because
    `gText_BattleMenu` (`src/battle_message.c:1282`) prefixes
    `{PALETTE 5}{COLOR_HIGHLIGHT_SHADOW 13 14 15}`.
  - A **right-pointing triangle ▶** sits immediately to the left of
    `FIGHT`. It is **static BG tile content**, not a sprite —
    `ActionSelectionCreateCursorAt`
    (`src/battle_controller_player.c:1436-1444`) writes tile indices
    `1` and `2` into the BG0 tilemap at
    `(7*(cursor&1)+16, 35+(cursor&2))`. Tiles 1 and 2 live in the
    same `graphics/battle_interface/textbox.4bpp.lz` atlas used for
    the window chrome (`src/battle_bg.c:719`). There is **no white
    halo around the triangle** — its transparent cells sample the
    palette-5 background beneath.

No down-arrow is visible — the bouncing "press A to continue"
sprite is only used during page breaks (`\p` /
`CHAR_PROMPT_CLEAR`), not in the root menu.

## B1 `B1_what-will-mon-do.png` — Playground, current

**Differences vs A1 that need to be fixed:**

1. **No second window.** The menu labels `FIGHT / BAG / POKéMON /
   RUN` are drawn directly into the main `B_WIN_MSG` dialogue area,
   with no light-palette overlay box. There is no visual split
   between "dialogue text on the left" and "action menu on the
   right" — it is all one dark blue textbox with text scattered
   across it.

2. **Wrong cursor graphic.** A **bouncing downward-pointing
   triangle** with a **solid white square around it** sits above
   `FIGHT`. Two bugs:
   - Graphic: should be a right-pointing **▶** (menu cursor, tile
     pair 1+2 from `textbox.4bpp`), not the down-arrow from
     `graphics/fonts/down_arrow_3.4bpp` which is the press-A text
     cursor.
   - Transparency: the sprite's background (index 0) is being
     rendered as solid white instead of transparent. The extracted
     PNG has an all-zero alpha channel for the background pixels
     but something in our blit path is ignoring it.

3. **Grey first character of line 2.** The `H` at the start of line
   2 (`HISCASH do?`) has a visibly different colour from the rest
   of the word — it looks pink/grey shadow instead of white fg,
   whereas the other glyphs are correctly rendered white. The
   reference A1 does not have this artefact.

---

## A2 `A2_select move.png` — FireRed move selection

When the player confirms `FIGHT`, the layout changes completely.
The dark blue `B_WIN_MSG` textbox **vanishes** from the bottom row
and is replaced by **two light-palette windows** drawn in its
place:

- **Left window — move name list** — four windows
  `B_WIN_MOVE_NAME_1..4` (`src/battle_bg.c:170-211`), each
  `width=8, height=2, paletteNum=5`. They are arranged in a 2×2
  grid at tilemap `(2,55) (11,55) (2,57) (11,57)`.
  - Same light-palette chrome as A1's action menu — pale cream
    interior, dark glyphs, gold/yellow outer border.
  - Four move labels (example capture): `TACKLE`, `SLEEP POWDER`,
    `LEECH SEED`, `VINE WHIP` — each in its own cell, drawn by
    `MoveSelectionDisplayMoveNames`
    (`src/battle_controller_player.c:1364-1379`).
  - A right-pointing **▶** sits to the left of the currently-hovered
    move (in A2, `VINE WHIP`). Again, BG tile pair from
    `MoveSelectionCreateCursorAt`
    (`src/battle_controller_player.c:1416`).

- **Right window — move info pane** — three tightly-packed windows
  at `(21,55)..(24,57)` (`src/battle_bg.c:213-241`):
  - `B_WIN_PP`       (3×2) — static label `PP`.
  - `B_WIN_PP_REMAINING` (5×2) — right-aligned `9/10`.
  - `B_WIN_MOVE_TYPE` (8×2) — `TYPE/GRASS` (or whatever type the
    hovered move has).
  - Drawn by `MoveSelectionDisplayPpString` (line 1381),
    `MoveSelectionDisplayPpNumber` (line 1387), and
    `MoveSelectionDisplayMoveType` (line 1402).
  - All palette 5 (light). The right window is visually **one
    physical box** (the three windows share chrome).
  - Contents **update live** as the cursor moves between the four
    move cells.

The left and right windows are visually **two separate boxes** —
both have their own gold outer border, inner cream border, and
pale interior. Between them is a thin strip of black (visible in
A2 between `VINE WHIP` and the `PP` label).

## B2 `B2_select-move.png` — Playground, current

**Differences vs A2 that need to be fixed:**

1. **No move-select windows at all.** The move labels are dumped as
   raw text on top of whatever is already in the `B_WIN_MSG`
   dialogue area. The "What will HISCASH do?" prompt stays visible
   underneath and overlaps the move names, producing a mangled
   rendering ("NSNORE", "NICKbEH do?").

2. **No move-info pane.** There is no PP / type display at all, so
   moving the cursor between slots has no visible feedback beyond
   the cursor position change.

3. **Wrong cursor graphic + white halo** (same as B1).

4. **The main dialogue text is still being drawn underneath the
   menu.** In FireRed, selecting `FIGHT` clears `B_WIN_MSG` and
   scrolls BG0 so the move-select UI takes over the full bottom
   strip (see `PlayerHandleChooseAction`,
   `src/battle_controller_player.c:2406-2429` — `BattlePutTextOnWindow(gText_EmptyString3, B_WIN_MSG)`).
   Our playground never clears the prompt.

5. **Grey first character of line 2** on the leftover dialogue text.

---

## A3 `A3_mon-used-attack.png` — FireRed narration

After the action menu closes and the move runs, the HUD returns to
a single dark textbox:

- Only `B_WIN_MSG` is drawn (the action-menu and move-select
  windows are hidden). Dark teal background, same chrome as A1's
  left region.
- Two lines of narration:
    `Bolin used`
    `VINE WHIP!`
  Text is `gText_UsedMove` /
  `STRINGID_USEDMOVE = "{B_ATK_NAME_WITH_PREFIX} used\n{B_MOVE_NAME}!"`
  (`src/battle_message.c:421`).
- No cursor of any kind — the down-arrow appears only at an
  explicit page break, which this string doesn't have.
- First character of the second line is **white, not grey** — no
  artefact.

## B3 `B3_mon-used-attack.png` — Playground, current

**Differences vs A3 that need to be fixed:**

1. **Grey first character of line 2** — the `S` of `SNORE!` is
   rendered in a distinctly darker/pink-grey colour versus the
   rest of the word. Compare to A3 where `V` of `VINE WHIP!` is
   the same white as the rest of the line.

2. **Size/alignment drift** — minor. The B capture shows a
   slightly taller textbox area than the A capture, but this is an
   artefact of the scaling used when exporting and is not a bug in
   the renderer.

---

## Summary of bugs to fix

| ID | Where | Bug |
|----|-------|-----|
| **BUG-1** | Action menu (B1) | Labels are drawn into the main dialogue window instead of a separate light-palette window on the right. |
| **BUG-2** | Move-select (B2) | Move labels are drawn on top of the still-visible dialogue text. No separate left-window chrome. |
| **BUG-3** | Move-select (B2) | No PP / TYPE info pane exists at all. |
| **BUG-4** | Menu cursor (B1, B2) | Using the bouncing down-arrow sprite from `down_arrow_3.png` instead of the static right-pointing BG tile pair (tiles 1+2 of `textbox.4bpp`). |
| **BUG-5** | Menu cursor (B1, B2) | The cursor sprite has a solid white background where it should be transparent. |
| **BUG-6** | Narration (B1/B2/B3) | First character of the second line of any two-line message is rendered grey/shadow-only instead of with the normal fg palette. |
| **BUG-7** | Move-select transition | Entering move-select does not clear `B_WIN_MSG` — the "What will X do?" prompt stays visible under the move list. |

---

## Implementation plan

### Decomp facts driving the design

- **Action menu chrome is a separate window overlaid on the bottom HUD**,
  not a re-skin of the same tilemap region as `B_WIN_MSG`.
  `LoadBattleMenuWindowGfx` (`src/battle_bg.c:691-710`) calls
  `LoadUserWindowGfx(2, 0x012, BG_PLTT_ID(1))` twice, which loads
  `gUserFrames[frameType]` tiles (`src/text_window_graphics.c:42-53`).
  `gUserFrames[0]` points at
  `graphics/text_window/type1.4bpp` + `type1.gbapal` — a 24×24 px
  (3×3 tile) 9-slice frame with a **pure-white interior (palette
  index 1)** and a dark navy / purple border.
- **Move-select uses nine windows** (`src/battle_bg.c:170-241`):
  - Left "names" group: `B_WIN_MOVE_NAME_1..4` at
    `(2,55)`, `(11,55)`, `(2,57)`, `(11,57)`, each `8×2` tiles.
    The decomp draws these as one visual window with four text cells
    inside.
  - Right "info" group: `B_WIN_PP` `(21,55) 3×2`,
    `B_WIN_PP_REMAINING` `(24,55) 5×2`, `B_WIN_MOVE_TYPE`
    `(21,57) 8×2`. One visual right box with three text cells.
  - All of these windows also render with the `type1` chrome + palette.
- **The menu cursor is a BG tilemap glyph, not a sprite.**
  `ActionSelectionCreateCursorAt` (`src/battle_controller_player.c:1436-1444`)
  writes tile indices `1` and `2` from the `textbox.4bpp` tileset
  vertically stacked at the target cell. Those two tiles together
  form the right-pointing ▶ triangle. The tile *background* is
  palette index 1 (pure white) and the triangle strokes are
  indices 9 (dark navy) and 7 (light grey shadow). In-game the
  cursor lands on top of a white interior so the white background
  is invisible, which is why A1 shows no halo — NOT because the
  sprite itself has alpha zero.
- **The bouncing press-A arrow is a completely different graphic**
  (`graphics/fonts/down_arrow_3.4bpp`, animated by `SpriteCB_TextCursor`
  in `src/text.c:1284`). It is only used at explicit page breaks
  (`\p` / `CHAR_PROMPT_CLEAR`), not for menu selection.
- **The main textbox is cleared during move selection.**
  `PlayerHandleChooseAction` blanks `B_WIN_MSG` via
  `BattlePutTextOnWindow(gText_EmptyString3, B_WIN_MSG)`
  (`src/battle_controller_player.c:2411`) before the move-select
  screen draws.

### Asset work (Python, one-time)

We already have `python-scripts/extract_battle_graphics.py::_composite_textbox`
which cooks the dark-blue main textbox chrome from the decomp tilemap.
Add three new compositors in the same module:

1. `_render_user_window(width_tiles, height_tiles)` — a 9-slice
   compositor that reads
   `python-scripts/raw-assets/decomp-hacks/firered/graphics/text_window/type1.png`
   (a 3×3-tile indexed PNG) and renders a (width × height) tile
   frame with the type1 border chrome. Palette index 0 of the
   source tile sheet is treated as transparent in the output; the
   remaining indices keep their RGB as-is so the pale cream
   interior and navy border match the decomp exactly.
   - For sizes > 3 tiles on either axis, the middle tiles are
     tiled. For size exactly 3 tiles on an axis, the middle tile
     row/col is omitted. (Decomp 9-slice math.)
2. `_extract_menu_cursor()` — re-extract tiles 1 and 2 from
   `graphics/battle_interface/textbox.png`, stack them 8×16, and
   **mark palette index 1 (pure white background) as alpha 0** so
   the cursor can sit over any background (including our
   non-decomp dark dialogue region if we ever want) without
   showing a white halo. Only the ▶ shape stays opaque.

New generated files:

```
battle-playground/src/assets/hud/
  menu_chrome_action.png       # 96x32, action menu frame (12x4 tiles)
  menu_chrome_move_names.png   # 144x32, move-name frame   (18x4 tiles)
  menu_chrome_move_info.png    # 88x32, move-info frame    (11x4 tiles)
  menu_cursor.png              # 8x16, re-exported with transparent bg
```

The three chrome sizes are pre-computed from the `B_WIN_*` template
dimensions above (each with a one-tile padding on every side for
the 9-slice border, so the interior matches the decomp's 12×4 /
16×4 / 8×4 text windows).

### Font bug (BUG-6)

The grey first-char-of-line-2 artefact is a Chrome rendering bug
with `font-palette` on CSS `@font-palette-values` when a span
contains multiple lines split by `\n` + `white-space: pre-wrap`:
Blink treats the first glyph after a line break as occupying a
different paint context and falls back to the font's default CPAL
palette (black fg + light-grey shadow), which in our override only
supplies the shadow color — hence the glyph looks "all grey".

Fix: stop relying on `\n` + `pre-wrap`. Build the printer content
as a vertical stack of per-line `<div class="gba-text-line">`
children. Each line is its own paint context, so `font-palette`
applies uniformly. The reveal loop advances line-by-line and char-
by-char inside each line.

### New runtime component: `HudWindow`

```
src/phaser/hud/
  HudWindow.ts          NEW  chrome-image + BitmapFontPrinter pair
  HudMenu.ts            MODIFIED  takes an HudWindow (not raw scene coords)
  HudCursor.ts          REMOVED from menus; kept only for the textbox page-break
  HudTextbox.ts         UNCHANGED
```

`HudWindow` represents one FireRed `WindowTemplate` rendered as a
Phaser scene: a chrome `Image` plus one or more `BitmapFontPrinter`
instances for text cells inside. The class owns:

- `show(x, y)` — create and position the chrome image at the given
  screen coordinates. Hides the main dialogue printer if
  `hideDialogueUnder=true` (used when entering move-select so the
  "What will X do?" text doesn't bleed through).
- `printCell(id, text)` — print into a named text cell. Cells are
  configured at construction (`{id, x, y, maxWidth}`).
- `setCursor(cellId)` — position the static right-arrow cursor at
  cell `cellId`.
- `hideCursor()`.
- `destroy()` — tear down chrome + printers + cursor.

The action menu and each of the two move-select panes become
three `HudWindow` instances. `HudMenu` stays the navigation state
machine and now operates on cell IDs from a shared `HudWindow`
instead of individual printers.

### `BattleScene.promptAction`

1. Clear the dialogue textbox? No — the decomp leaves the
   "What will Bolin do?" text visible in `B_WIN_MSG` while the
   action menu appears next to it. Keep the left region text.
2. Create `HudWindow("action")` at pixel `(136, 120)`, size 96×32.
   It overlays the right ~96 px of the main textbox chrome.
3. Cells: `fight` at `(16, 4)`, `bag` at `(56, 4)`,
   `pokemon` at `(16, 20)`, `run` at `(56, 20)` — offsets relative
   to the window top-left so they line up with the decomp
   `gText_BattleMenu` `CLEAR_TO 56` spacing.
4. `HudMenu` drives cursor nav; `setCursor("fight")` / etc paints
   the ▶ 8 px to the left of the active cell.

### `BattleScene.promptMove`

1. Hide (scroll away) the dialogue printer — cover `B_WIN_MSG`
   with a full-width dark rectangle so the narration text is not
   visible. (A faithful BG scroll is out of scope; an opaque
   rectangle over the main textbox interior reads the same at
   this resolution.)
2. Create two `HudWindow`s:
   - `names` — pixel position `(8, 120)` size 144×32. Cells:
     `slot0 (16, 4)`, `slot1 (80, 4)`, `slot2 (16, 20)`,
     `slot3 (80, 20)`.
   - `info` — pixel position `(152, 120)` size 88×32. Cells:
     `pp (4, 4)`, `ppNum (24, 4)`, `type (4, 20)`.
3. Print all four move names at construction. Print PP and TYPE
   for the initial cursor slot.
4. Install a cursor listener: when `HudMenu` moves to a new slot,
   re-print the PP and TYPE cells with the new move's values.
5. On confirm / cancel, destroy both `HudWindow`s and restore the
   dialogue printer's visibility.

### Menu cursor

`HudMenu` no longer creates a `HudCursor` (which is the bouncing
down-arrow). Instead it asks its `HudWindow` to
`setCursor(cellId)`. The cursor image is a static `Phaser.Image`
using `menu_cursor.png` (the re-extracted transparent-bg version),
positioned 8 px to the left of the cell's glyph origin. The
bouncing `HudCursor` class stays but is used ONLY by `HudTextbox`
for the page-break prompt at the end of `\f` pages.

### Verification

1. `npx tsc --noEmit` clean.
2. `npx vitest run` — all 84 existing tests pass. Add a smoke
   test for `HudWindow` cell-position math (pure, no Phaser).
3. Run `npm run dev` and visually diff:
   - A1 vs B1: action menu chrome + right-arrow cursor, no white
     halo, no grey first char.
   - A2 vs B2: two distinct light boxes, four move names on the
     left, PP + TYPE on the right updating per cursor move,
     dialogue text not visible underneath.
   - A3 vs B3: narration renders with no grey first char.

