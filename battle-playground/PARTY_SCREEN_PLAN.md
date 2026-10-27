# Party Screen — Phaser Implementation Plan

## Goal

Replace the React stub `src/ui/PartyScreen.tsx` with a Phaser-rendered party screen that faithfully reproduces the FireRed decomp's party menu. It must be reusable in two contexts:

1. **In-battle switch** — opened from the action menu's "POKeMON" option, or forced after a faint. Returns a party index or cancels.
2. **Overworld summary** — opened from the start menu. Shows full stats, allows reordering, item management, etc. (future scope — the initial build covers the in-battle switch case and the visual skeleton).

The party screen runs as a **separate Phaser scene** overlaid on top of the battle scene (or the overworld scene), driven by `HudInput` keyboard navigation, matching the existing battle HUD patterns (`Hud`, `HudWindow`, `runHudMenu`).

---

## Decomp Reference

**Primary sources:**
- `firered/src/party_menu.c` — all logic (~6000 lines)
- `firered/src/data/party_menu.h` — layout tables, window templates, sprite coords
- `firered/include/constants/party_menu.h` — menu types, actions, messages, ailments
- `firered/graphics/party_menu/` — BG tilemap, slot chromes, pokeball sprites, held item icons

### GBA Screen Layout (240x160, PARTY_LAYOUT_SINGLE)

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  ┌────────────┐  ┌──────────────────────────────┐    │
│  │  Slot 0    │  │  Slot 1 (wide)               │    │
│  │  (main,    │  │  icon  NAME    Lv##  HP/MAX  │    │
│  │   left     │  └──────────────────────────────┘    │
│  │   column)  │  ┌──────────────────────────────┐    │
│  │            │  │  Slot 2 (wide)               │    │
│  │  icon      │  └──────────────────────────────┘    │
│  │  NAME      │  ┌──────────────────────────────┐    │
│  │  Lv##      │  │  Slot 3 (wide)               │    │
│  │  HP/MAX    │  └──────────────────────────────┘    │
│  └────────────┘  ┌──────────────────────────────┐    │
│                  │  Slot 4 (wide)               │    │
│                  └──────────────────────────────┘    │
│                  ┌──────────────────────────────┐    │
│                  │  Slot 5 (wide)               │    │
│                  └──────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │  Message: "Choose a POKeMON."                │    │
│  └──────────────────────────────────────────────┘    │
│                                        [CANCEL]      │
└──────────────────────────────────────────────────────┘
```

### Decomp Coordinates (from `sPartyMenuSpriteCoords[PARTY_LAYOUT_SINGLE]`)

Each slot has 4 pairs: `[mon_x, mon_y, item_x, item_y, status_x, status_y, ball_x, ball_y]`

| Slot | Mon (x,y) | Item (x,y) | Status (x,y) | Ball (x,y) |
|------|-----------|------------|--------------|------------|
| 0    | 16, 40    | 20, 50     | 56, 52       | 16, 34     |
| 1    | 104, 18   | 108, 28    | 144, 27      | 102, 25    |
| 2    | 104, 42   | 108, 52    | 144, 51      | 102, 49    |
| 3    | 104, 66   | 108, 76    | 144, 75      | 102, 73    |
| 4    | 104, 90   | 108, 100   | 144, 99      | 102, 97    |
| 5    | 104, 114  | 108, 124   | 144, 123     | 102, 121   |

### Window Templates (from `sSinglePartyMenuWindowTemplate`)

| Window | BG | tilemapLeft | tilemapTop | Width | Height | Purpose |
|--------|----|------------|-----------|-------|--------|---------|
| 0      | 0  | 1          | 3         | 10    | 7      | Left column (slot 0) |
| 1      | 0  | 12         | 1         | 18    | 3      | Wide slot 1 |
| 2      | 0  | 12         | 4         | 18    | 3      | Wide slot 2 |
| 3      | 0  | 12         | 7         | 18    | 3      | Wide slot 3 |
| 4      | 0  | 12         | 10        | 18    | 3      | Wide slot 4 |
| 5      | 0  | 12         | 13        | 18    | 3      | Wide slot 5 |
| 6      | 2  | 1          | 15        | 28    | 4      | Message area |

(8 px per tile, so slot 0 = 8px left, 24px top, 80x56px; wide slots = 96px left, 144x24px each)

### Slot Text Layout (from `sPartyBoxInfoRects`)

**Left column (slot 0):** Nickname at (24,11), Level at (32,20), Gender at (64,20), HP at (38,36)/(53,36), HP bar at (24,35) w=48 h=3

**Right column (slots 1-5):** Nickname at (22,3), Level at (32,12), Gender at (64,12), HP at (102,12)/(117,12), HP bar at (88,10) w=48 h=3

### Navigation (from `UpdatePartySelectionSingleLayout`)

- **Up/Down**: Linear through slots 0→1→2→3→4→5→CANCEL, wrapping
- **Right from slot 0**: Jump to last-visited right slot (default: slot 1)
- **Left from any right slot**: Jump to slot 0, remember which right slot was active
- **A button**: Select current slot
- **B button**: Cancel (equivalent to selecting CANCEL)

### Selection Palette Flags

```c
#define PARTY_PAL_SELECTED     (1 << 0)  // currently highlighted
#define PARTY_PAL_FAINTED      (1 << 1)  // greyed out
#define PARTY_PAL_TO_SWITCH    (1 << 2)  // marked for switch
#define PARTY_PAL_NO_MON       (1 << 6)  // empty slot
```

The BG tilemap `bg.png` contains the slot chrome tiles. Different palette indices are loaded per slot to achieve selected/deselected/fainted coloring — the same tiles, different palettes.

### Status Ailment Icons

From `constants/party_menu.h`:
- 0: None, 1: PSN, 2: PRZ, 3: SLP, 4: FRZ, 5: BRN, 6: PKRS, 7: FNT

These map to the status icon sprite already extracted as `src/assets/hud/status.png` (7 frames: PSN, SLP, PRZ, BRN, FRZ, FNT, PKRS).

### Pokemon Icon Animation

- **Unselected**: Static, offset by (-4, 0) for right-column slots or (0, -4) for left-column
- **Selected**: Bouncing — y2 oscillates between -3 and +1 (via `SpriteCB_BouncePartyMonIcon`, which alternates each animation frame)

---

## Architecture Decision

### Separate Phaser Scene (overlay)

The party screen will be a **new Phaser Scene** (`PartyMenuScene`) that runs concurrently with `BattleScene`. Phaser supports multiple concurrent scenes. This matches the decomp's model (party menu is a separate BG/OBJ state machine) and keeps the battle scene clean.

**Why not a HudWindow inside BattleScene?**
- The party menu takes over the full 240x160 screen — it's not a small overlay like the action menu
- It has its own BG tilemap, its own sprite set (Pokemon icons, pokeballs, status icons), and its own input loop
- Keeping it in BattleScene would bloat that already-large class
- A separate scene can be reused in the overworld context with zero coupling to battle

**Integration flow:**
1. `BattleRunner` calls `requestSwitch()` callback
2. Host (App.tsx or PhaserBattle.tsx) launches `PartyMenuScene` via `scene.launch("PartyMenuScene", { party, disabledIndices, mode })`
3. `PartyMenuScene` runs its input loop, renders the full party UI
4. On select/cancel, the scene emits an event and stops itself
5. Host resolves the promise with the result

### File Structure

```
src/phaser/
  PartyMenuScene.ts          — The Phaser scene (BG, slots, input loop)
  partyMenuLayouts.ts        — Decomp coordinate constants & slot definitions
src/assets/hud/
  party_bg.png               — Extracted party menu BG (from decomp bg.png + tilemap)
  party_slot_main.png         — Left column slot chrome
  party_slot_wide.png         — Right column slot chrome
  party_slot_wide_empty.png   — Empty right column slot
  party_pokeball.png          — Pokeball icon (32x32, 2 frames: closed/selected)
  party_pokeball_small.png    — Small pokeball for cancel button
  party_hold_icons.png        — Held item indicator (2 frames: item/mail)
```

---

## Implementation Steps

### Phase 1: Asset Extraction

**Task 1.1** — Add party menu extraction to `python-scripts/extract_battle_graphics.py`

New function `extract_party_menu()` that reads from `firered/graphics/party_menu/` and outputs to `battle-playground/src/assets/hud/`:

- `party_bg.png` — The BG tilemap rendered to a 240x160 image. The decomp stores this as `bg.png` (an 8x8-tile tileset) + `bg.bin` (a tilemap). We need to composite them into a flat image using the same approach `extract_battle_graphics.py` already uses for other tilemaps (read the .bin, index into the tileset, blit tiles onto a canvas).
- Copy directly: `pokeball.png` → `party_pokeball.png` (32x32, 2 frames vertically)
- Copy directly: `pokeball_small.png` → `party_pokeball_small.png`
- Copy directly: `hold_icons.png` → `party_hold_icons.png`

The slot chrome tiles are part of the BG tilemap — in the decomp, `slot_main.bin`/`slot_wide.bin`/etc. are tilemap patches that get blitted onto the BG at runtime to draw each slot's box. We can either:
- **(A)** Render each slot chrome as a standalone PNG (pre-composited from bg.png tiles + slot .bin tilemaps)
- **(B)** Render the full BG with all slot chromes baked in, and just change palette/tint at runtime for selected/fainted states

**Decision: Option B** — render the full default BG as one image. At runtime, overlay tinted rectangles or alpha-blend for selected/fainted states. This is simpler and matches how the battle healthbox chrome works (one pre-composited image, not tiles).

However, we also need the **individual slot chrome images** for the selected/fainted palette variants. The decomp achieves this by swapping palette indices on the same tiles. In Phaser, the cleanest equivalent is:
- Extract slot chromes as individual PNGs (one for left-column, one for wide) in the "default" palette
- At runtime, apply Phaser tint or swap between pre-tinted variants

**Revised plan**: Extract **3 variants of each slot type** (default, selected, fainted) using the decomp's palette colors. This is the approach used for the healthbox chrome — pre-composited PNGs, no runtime palette tricks.

Assets to extract:
1. `party_bg.png` — Full 240x160 BG (blue gradient background, no slot boxes)
2. `party_slot_main.png` — Left column box, default state (80x56)
3. `party_slot_main_sel.png` — Left column box, selected state
4. `party_slot_main_fnt.png` — Left column box, fainted state
5. `party_slot_wide.png` — Right column box, default state (144x24)
6. `party_slot_wide_sel.png` — Right column box, selected state
7. `party_slot_wide_fnt.png` — Right column box, fainted state
8. `party_slot_wide_empty.png` — Empty right column slot
9. `party_pokeball.png` — Copy of pokeball.png (32x32, 2 frames)
10. `party_pokeball_small.png` — Copy of pokeball_small.png
11. `party_hold_icons.png` — Copy of hold_icons.png
12. `party_cancel.png` — Cancel button chrome (rendered from cancel_button.bin + bg tiles)
13. `party_cancel_sel.png` — Cancel button, selected state

**Task 1.2** — Pokemon icon sprites

Pokemon icons are 32x32 2-frame animations from the decomp. The `pokedata3g` data already has `icon` and `icon-frame2` sprite paths per species. These are DS-style sprites served from `/sprites/`. We need to resolve them at runtime via `pokemon.getIcon()` → path → URL, same pattern as `spriteUrlFor()`.

The icons will be loaded as Phaser textures on-demand when the party screen opens (like how battle sprites are loaded).

### Phase 2: Scene Skeleton

**Task 2.1** — Create `src/phaser/partyMenuLayouts.ts`

Constants file with all decomp coordinates, mirroring `battleHudLayouts.ts`:

```typescript
// Screen dimensions (full GBA screen, not just battle area)
export const PARTY_SCREEN_WIDTH = 240;
export const PARTY_SCREEN_HEIGHT = 160;

// Slot types
export type SlotType = "main" | "wide" | "empty";

// Per-slot sprite coordinates (from sPartyMenuSpriteCoords[PARTY_LAYOUT_SINGLE])
export const SLOT_COORDS = [
  { mon: [16, 40],  item: [20, 50],  status: [56, 52],  ball: [16, 34] },
  { mon: [104, 18], item: [108, 28], status: [144, 27], ball: [102, 25] },
  { mon: [104, 42], item: [108, 52], status: [144, 51], ball: [102, 49] },
  { mon: [104, 66], item: [108, 76], status: [144, 75], ball: [102, 73] },
  { mon: [104, 90], item: [108, 100], status: [144, 99], ball: [102, 97] },
  { mon: [104, 114], item: [108, 124], status: [144, 123], ball: [102, 121] },
] as const;

// Text offsets within each slot's window (from sPartyBoxInfoRects)
export const LEFT_TEXT = {
  nickname: { x: 24, y: 11 }, level: { x: 32, y: 20 },
  gender: { x: 64, y: 20 }, hp: { x: 38, y: 36 },
  maxHp: { x: 53, y: 36 }, hpBar: { x: 24, y: 35, w: 48, h: 3 },
};
export const WIDE_TEXT = {
  nickname: { x: 22, y: 3 }, level: { x: 32, y: 12 },
  gender: { x: 64, y: 12 }, hp: { x: 102, y: 12 },
  maxHp: { x: 117, y: 12 }, hpBar: { x: 88, y: 10, w: 48, h: 3 },
};

// Window pixel positions (tilemapLeft*8, tilemapTop*8)
export const SLOT_WINDOWS = [
  { x: 8,  y: 24, w: 80,  h: 56 },  // slot 0 (left column)
  { x: 96, y: 8,  w: 144, h: 24 },  // slot 1
  { x: 96, y: 32, w: 144, h: 24 },  // slot 2
  { x: 96, y: 56, w: 144, h: 24 },  // slot 3
  { x: 96, y: 80, w: 144, h: 24 },  // slot 4
  { x: 96, y: 104, w: 144, h: 24 }, // slot 5
];

// Cancel button position
export const CANCEL_POS = { x: 198, y: 148 };

// Message area
export const MESSAGE_POS = { x: 8, y: 120, w: 224, h: 32 };

// Navigation grid (decomp UpdatePartySelectionSingleLayout)
// Left→Right from slot 0 jumps to lastVisitedRightSlot
// Left from any right slot jumps to slot 0
```

**Task 2.2** — Create `src/phaser/PartyMenuScene.ts`

A new Phaser Scene with key `"PartyMenuScene"`. Structure:

```typescript
interface PartyMenuSceneData {
  party: Party;
  disabledIndices: number[];   // fainted or otherwise unavailable
  mode: "switch" | "summary";  // switch = in-battle, summary = overworld
  message?: string;            // bottom text, default "Choose a POKeMON."
}

class PartyMenuScene extends Phaser.Scene {
  // Lifecycle
  init(data: PartyMenuSceneData): void;
  preload(): void;     // Load party menu chrome + pokemon icons
  create(): void;      // Build BG, slots, sprites, start input loop

  // Internal
  private buildSlot(index: number, pokemon: Pokemon | null): void;
  private updateSlotVisual(index: number, selected: boolean): void;
  private runInputLoop(): Promise<number | null>;
}
```

**Preload assets:**
- Party BG, slot chromes (all variants), cancel button, pokeball sprites
- Pokemon icon textures for each party member (loaded via URL from `pokemon.getIcon()`)
- Status icon spritesheet (already loaded as `hud:status` if battle scene ran, otherwise load fresh)
- Held item icons
- Menu cursor, Emerald font (shared with battle HUD)

**Create flow:**
1. Add BG image (full 240x160)
2. For each party slot (0-5):
   - If slot has a Pokemon: add slot chrome image (default/fainted variant based on HP), add Pokemon icon sprite (32x32), add BitmapFontPrinter for nickname/level/HP, add HP bar rectangle, add status icon if applicable, add held item icon if applicable, add pokeball sprite
   - If slot is empty: add empty slot chrome
3. Add cancel button chrome + text
4. Add message area with BitmapFontPrinter ("Choose a POKeMON.")
5. Highlight slot 0 (or first non-disabled slot)
6. Start input loop

**Input loop** (modeled on `runHudMenu` but with custom navigation):

```typescript
async runInputLoop(): Promise<number | null> {
  const input = new HudInput(this);
  let currentSlot = 0;  // 0-5 = party slots, 6 = cancel
  let lastRightSlot = 1;

  // Highlight initial slot
  this.updateSlotVisual(currentSlot, true);

  for (;;) {
    const btn = await input.waitForPress(["up","down","left","right","A","B"]);

    if (btn === "A") {
      if (currentSlot === 6) return null;  // cancel
      if (!this.disabled.has(currentSlot)) return currentSlot;
      continue;  // can't select disabled slot
    }
    if (btn === "B") return null;  // cancel

    const prevSlot = currentSlot;
    // Navigation logic from UpdatePartySelectionSingleLayout
    switch (btn) {
      case "up":
        if (currentSlot === 0) currentSlot = 6;      // wrap to cancel
        else if (currentSlot === 6) currentSlot = this.partySize - 1;
        else currentSlot--;
        break;
      case "down":
        if (currentSlot === 6) currentSlot = 0;      // wrap to top
        else if (currentSlot === this.partySize - 1) currentSlot = 6;
        else currentSlot++;
        break;
      case "right":
        if (currentSlot === 0 && this.partySize > 1) {
          currentSlot = lastRightSlot;
        }
        break;
      case "left":
        if (currentSlot > 0 && currentSlot < 6) {
          lastRightSlot = currentSlot;
          currentSlot = 0;
        }
        break;
    }

    if (prevSlot !== currentSlot) {
      this.updateSlotVisual(prevSlot, false);
      this.updateSlotVisual(currentSlot, true);
      // Play SE_SELECT equivalent
    }
  }
}
```

**Slot visual update:**
- Swap slot chrome between default/selected/fainted variants
- Pokemon icon: selected → bouncing animation, deselected → static with offset
- Pokeball sprite: selected → open frame, deselected → closed frame

### Phase 3: Integration

**Task 3.1** — Wire into `BattleStage.tsx`

Add `PartyMenuScene` to the Phaser game config's scene list. Add new methods to `BattleStageHandle`:

```typescript
promptPartySwitch(party: Party, disabledIndices: number[]): Promise<number | null>;
```

This launches `PartyMenuScene`, awaits its result event, and stops it.

**Task 3.2** — Update `PhaserBattle.tsx`

Change `onRequestSwitch` from a React-overlay callback to an internal Phaser call:

```typescript
// Before: host renders React PartyScreen overlay
onRequestSwitch: () => Promise<number | null>

// After: stage launches PartyMenuScene internally
// The prop is kept for hosts that want to override with custom UI,
// but the default implementation uses the Phaser scene
```

Actually, the cleaner approach is: keep the existing `onRequestSwitch` callback contract, but provide a **default implementation** that uses the Phaser party scene. The host (App.tsx) can still override with a React overlay if desired.

In the default flow:
1. `BattleRunner` selects "pokemon" from action menu → calls `requestSwitch()`
2. `PhaserBattle`'s default `requestSwitch` implementation calls `stageRef.current.promptPartySwitch(player.party, disabledIndices)`
3. `promptPartySwitch` launches `PartyMenuScene` over the battle scene, awaits result
4. Returns party index or null

**Task 3.3** — Update `App.tsx`

Remove the React `<PartyScreen>` overlay rendering. The Phaser scene handles it now. Keep the `onRequestSwitch` prop for backwards compatibility but provide the Phaser-native default.

**Task 3.4** — Update the React stub `src/ui/PartyScreen.tsx`

Keep the file but update the doc comment to note it's a **fallback for non-Phaser hosts**. The real party screen is `PartyMenuScene`. The React component can remain as a simple accessible fallback for hosts that don't use the Phaser stage.

### Phase 4: Polish

**Task 4.1** — HP bar rendering

HP bar fill with color thresholds matching the decomp:
- Green: HP > 50%
- Yellow: 20% < HP <= 50%
- Red: HP <= 20%

Implement as a Phaser Rectangle with width proportional to `currentHp/maxHp * barPixelWidth`, color set by threshold. Same approach as the battle healthbox HP bar in `BattleScene.ts`.

**Task 4.2** — Pokemon icon bounce animation

Selected icon oscillates y between -3 and +1 using a Phaser tween or manual frame update via the Clock. Match the decomp's `SpriteCB_BouncePartyMonIcon` timing.

**Task 4.3** — Status condition icons

Use the existing `status.png` spritesheet. Map `Pokemon.statusConditions` to the decomp's ailment frame indices:
- PSN (frame 0), SLP (frame 1), PRZ (frame 2), BRN (frame 3), FRZ (frame 4), FNT (frame 5), PKRS (frame 6)

Only show the first non-volatile status (or FNT if fainted).

**Task 4.4** — Held item indicator

Show the held item icon sprite from `party_hold_icons.png` at the item coordinates if `pokemon.heldItemId != null`.

**Task 4.5** — Sound effects

Play cursor-move SE on slot change, confirm SE on A, cancel SE on B. Reuse whatever SE system the battle HUD uses.

---

## What This Plan Does NOT Cover (Future Scope)

- **Summary mode**: Detailed stat view when selecting a Pokemon in overworld. Requires its own sub-scene with multiple pages (Info, Skills, Moves, Ribbons, etc.) — the decomp's `pokemon_summary_screen.c` is another ~5000 lines.
- **Party reordering (Switch action)**: In the overworld, you can select two Pokemon and swap their positions. The decomp handles this via `PARTY_ACTION_SWITCH` + `slotId2`. Can be added later.
- **Item give/take**: Using items from the bag on party Pokemon. The `BagScreen` integration would trigger this.
- **Move management**: Viewing/reordering moves from the party screen.
- **Egg slots**: Showing eggs with no HP bar and "EGG" text instead of species name.
- **DOUBLE/MULTI layouts**: Only SINGLE layout is implemented initially.

---

## Risks & Open Questions

1. **Pokemon icon loading**: Icons are 32x32 PNGs served from `/sprites/`. We need to dynamically load them in `preload()` based on the current party. Phaser's loader is async, so this is straightforward — but we need to handle the case where icons aren't available (show a placeholder).

2. **BG tilemap compositing**: The decomp's `bg.png` is a tileset, not a flat image. `bg.bin` is the tilemap. The extraction script needs to composite these. The existing `extract_battle_graphics.py` already handles similar tilemap→image rendering for battle backdrops, so the pattern is established.

3. **Palette swapping for slot states**: The decomp uses GBA palette swaps to recolor slot chromes. We're pre-rendering variants instead. Need to identify the exact palette colors from the decomp's `gPartyMenuBg_Pal` (11 palettes) to get accurate selected/fainted/default colors.

4. **Scene lifecycle**: When `PartyMenuScene` runs alongside `BattleScene`, we need to make sure:
   - Battle scene pauses its input handling (the `HudInput` listeners shouldn't fire)
   - The party scene renders on top (higher camera depth or scene order)
   - Returning to battle restores state cleanly

5. **Font availability**: `PartyMenuScene` needs `Emerald.ttf` loaded. If running without the battle scene (overworld), the font must be loaded independently. The CSS `@font-face` declaration in `styles.css` handles this globally — Phaser's DOMElement approach will pick it up.
