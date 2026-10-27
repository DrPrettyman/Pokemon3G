"""
Extract Gen 3 battle background and HUD graphics into battle-playground/src/assets.

Composites each battle_environment directory's tiles.png + map.bin + palette.pal
into a ready-to-display RGB PNG. Also copies selected battle_interface PNGs.

Run with:  python3 python-scripts/extract_battle_graphics.py
"""
from __future__ import annotations
import json
import shutil
import struct
from pathlib import Path
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_SRC = REPO_ROOT / "python-scripts/raw-assets/decomp-hacks/emerald/graphics/battle_environment"
HUD_SRC = REPO_ROOT / "python-scripts/raw-assets/decomp-hacks/emerald/graphics/battle_interface"
# FireRed has the tilemap + split palettes for the battle textbox that
# Emerald's export is missing. We use FireRed for the textbox composition
# to match the dark-teal FRLG look (the playground targets FRLG).
HUD_SRC_FIRERED = REPO_ROOT / "python-scripts/raw-assets/decomp-hacks/firered/graphics/battle_interface"
FIRERED_FONTS_SRC = REPO_ROOT / "python-scripts/raw-assets/decomp-hacks/firered/graphics/fonts"
# Pokeball sprite strip + ball-open particle sheet come from FireRed since the
# intro/send-out code path we mirror (`SpriteCB_ReleaseMonFromBall`, BATTLE_SEQUENCE.md
# step 6 / 11) targets FRLG.
BALL_SRC = REPO_ROOT / "python-scripts/raw-assets/decomp-hacks/firered/graphics/interface/ball"
PARTICLES_SRC = REPO_ROOT / "python-scripts/raw-assets/decomp-hacks/firered/graphics/battle_anims/sprites/particles.png"
# Stat-change BG mask tiles, tilemaps, and per-stat palettes. The decomp
# composites these at runtime via `InitStatsChangeAnimation`
# (`src/battle_anim_utility_funcs.c:392`); we pre-composite them here so
# the Phaser renderer only has to alpha-fade a ready-made RGBA texture.
STAT_MASK_SRC = REPO_ROOT / "python-scripts/raw-assets/decomp-hacks/firered/graphics/battle_anims/masks"
WEATHER_SRC = REPO_ROOT / "python-scripts/raw-assets/decomp-hacks/emerald/graphics/weather"
ANIM_BG_SRC = REPO_ROOT / "python-scripts/raw-assets/decomp-hacks/emerald/graphics/battle_anims/backgrounds"
# Trainer sprites come from FireRed because (a) the player's back-pic throw
# animation is 5 frames in FRLG vs 4 in RSE, and (b) the "rival" concept is
# FireRed's — Emerald uses May/Brendan rivals which look different.
TRAINERS_SRC = REPO_ROOT / "python-scripts/raw-assets/decomp-hacks/firered/graphics/trainers"
BACKDROP_DST = REPO_ROOT / "battle-playground/src/assets/backdrops"
HUD_DST = REPO_ROOT / "battle-playground/src/assets/hud"
WEATHER_DST = REPO_ROOT / "battle-playground/src/assets/weather"
TRAINERS_DST = REPO_ROOT / "battle-playground/src/assets/trainers"
ANIM_BG_DST = REPO_ROOT / "battle-playground/src/assets/battle_anims/backgrounds"

MAP_WIDTH_TILES = 32   # GBA text-mode BG width
TILE_SIZE = 8
# Visible battle backdrop height in the original GBA scene.
RENDER_ROWS = 14


def render_environment(env_dir: Path, out_path: Path) -> None:
    # The decomp exports tiles.png as an indexed PNG with the full sub-palettes
    # already flattened into the embedded palette, so converting straight to
    # RGB gives us ready-to-sample pixels. The tilemap's sub_pal field is only
    # meaningful at runtime on hardware — we ignore it here.
    tiles_rgb = Image.open(env_dir / "tiles.png").convert("RGB")
    tile_px = tiles_rgb.load()
    tw, th = tiles_rgb.size
    tiles_per_row = tw // TILE_SIZE
    total_tiles = tiles_per_row * (th // TILE_SIZE)

    map_bytes = (env_dir / "map.bin").read_bytes()
    num_entries = len(map_bytes) // 2
    if num_entries == 0:
        raise RuntimeError(f"{env_dir}: empty map.bin")

    map_height = num_entries // MAP_WIDTH_TILES
    render_rows = min(RENDER_ROWS, map_height)

    out = Image.new("RGB", (MAP_WIDTH_TILES * TILE_SIZE, render_rows * TILE_SIZE))
    out_px = out.load()

    for row in range(render_rows):
        for col in range(MAP_WIDTH_TILES):
            val = struct.unpack_from("<H", map_bytes, (row * MAP_WIDTH_TILES + col) * 2)[0]
            tile = val & 0x3FF
            hflip = (val >> 10) & 1
            vflip = (val >> 11) & 1
            if tile >= total_tiles:
                continue
            tx = (tile % tiles_per_row) * TILE_SIZE
            ty = (tile // tiles_per_row) * TILE_SIZE
            for py in range(TILE_SIZE):
                sy = (TILE_SIZE - 1 - py) if vflip else py
                for px in range(TILE_SIZE):
                    sx = (TILE_SIZE - 1 - px) if hflip else px
                    out_px[col * TILE_SIZE + px, row * TILE_SIZE + py] = tile_px[tx + sx, ty + sy]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.save(out_path)


def extract_backdrops() -> list[dict]:
    BACKDROP_DST.mkdir(parents=True, exist_ok=True)
    index: list[dict] = []
    for env_dir in sorted(ENV_SRC.iterdir()):
        if not env_dir.is_dir():
            continue
        env_id = env_dir.name
        out_path = BACKDROP_DST / f"{env_id}.png"
        try:
            render_environment(env_dir, out_path)
            label = env_id.replace("_", " ").title()
            index.append({"id": env_id, "label": label})
            print(f"  backdrop: {env_id}")
        except Exception as exc:
            print(f"  SKIP {env_id}: {exc}")
    (BACKDROP_DST / "index.json").write_text(json.dumps(index, indent=2))
    return index


HUD_FILES = [
    "healthbox_singles_player.png",
    "healthbox_singles_opponent.png",
    "hpbar.png",
    "expbar.png",
    "status.png",
    "numbers1.png",
]


def extract_hud() -> None:
    HUD_DST.mkdir(parents=True, exist_ok=True)
    for name in HUD_FILES:
        src = HUD_SRC / name
        if not src.exists():
            print(f"  SKIP hud/{name}: not found")
            continue
        dst = HUD_DST / name
        # Convert indexed PNGs to RGBA with palette index 0 → transparent.
        # GBA sprites use index 0 as the transparency sentinel; a naive
        # `.convert("RGBA")` leaves it as opaque black, which is why the
        # healthboxes used to render with a solid black background.
        img = _indexed_to_rgba(Image.open(src))
        img.save(dst)
        print(f"  hud: {name}")

    # Battle textbox — composited from the real decomp tilemap, NOT a raw
    # copy of the tile sheet (the old behavior tile-sprited the sheet and
    # produced a garbled strip). Mirrors `LoadBattleTextboxAndBackground`
    # at `src/battle_bg.c:717`: tiles + tilemap + (pal1 concat pal2).
    _composite_textbox().save(HUD_DST / "textbox.png")
    print("  hud: textbox.png (composited)")

    # User-window chrome for the 2x2 action menu and the move-select
    # screen. `LoadBattleMenuWindowGfx` (`src/battle_bg.c:691-710`) calls
    # `LoadUserWindowGfx(..., BG_PLTT_ID(1))`, which reads
    # `gUserFrames[frameType]` — the `graphics/text_window/type*.4bpp`
    # 3x3-tile 9-slice frame. We pre-composite one PNG per HUD window
    # size at build time so the runtime just blits them.
    #
    # Sizes come directly from `gStandardBattleWindowTemplates` in
    # `src/battle_bg.c` — each frame wraps one decomp window group
    # with a 1-tile 9-slice border on every side, so frame dimensions
    # are `(interior + 2) × (interior + 2)` tiles.
    #
    #   B_WIN_ACTION_MENU   (17,35) w=12 h=4    → frame 14×6 tiles (112×48 px)
    #
    # The move-select frames together tile cols 0..29 of the screen
    # (240 px = full GBA width). Inspecting the decomp tilemap
    # (`graphics/battle_interface/textbox.bin` rows 54..59) shows
    # that the names frame begins at col 0 (NOT col 1): tile 0x12
    # at (54, 0) is a top-left user-window corner, tiles 0x15 at
    # (55..58, 0) are the left edge, tile 0x18 at (59, 0) is the
    # bottom-left corner. The names frame interior is cols 1..18
    # (18 tiles wide), with MOVE_NAME_1..4 covering cols 2..9 and
    # 11..18 and a one-tile gutter at col 10. Total names frame =
    # 20×6 tiles = 160×48 px, anchored at screen x=0.
    #
    # The info frame covers cols 20..29 (border-inclusive):
    # interior cols 21..28 (the 8-tile wide B_WIN_* group) with
    # borders at 20 and 29. Total info frame = 10×6 tiles = 80×48
    # px, anchored at screen x=160. Together: 160 + 80 = 240 px.
    _render_user_window(14, 6).save(HUD_DST / "menu_chrome_action.png")
    print("  hud: menu_chrome_action.png")
    _render_user_window(20, 6).save(HUD_DST / "menu_chrome_move_names.png")
    print("  hud: menu_chrome_move_names.png")
    _render_user_window(10, 6).save(HUD_DST / "menu_chrome_move_info.png")
    print("  hud: menu_chrome_move_info.png")
    _render_user_window(6, 6).save(HUD_DST / "menu_chrome_yesno.png")
    print("  hud: menu_chrome_yesno.png")

    # Menu selection cursor — tiles 1 and 2 from the battle textbox
    # tileset, stacked vertically to form the ▶ right-arrow. The
    # in-tileset background is palette index 1 (pure white), which in
    # the real game is invisible because the cursor lands on a
    # palette-5 white interior. In the playground we want it to sit
    # cleanly over any background, so we explicitly make index 1
    # transparent here. See `ActionSelectionCreateCursorAt` in
    # `src/battle_controller_player.c:1436-1444`.
    _extract_menu_cursor().save(HUD_DST / "menu_cursor.png")
    print("  hud: menu_cursor.png")

    # "Press A to continue" bouncing arrow. Source: the indexed PNG
    # `graphics/fonts/down_arrow_3.png` (loaded as `sDoubleArrowTiles1`
    # in `src/text.c:32`). Palette index 0 is the GBA transparency
    # sentinel; a naive `.convert("RGBA")` expands idx 0 to its
    # palette RGB (which happens to be white), producing a solid white
    # halo around the arrow — the bug in the original hand-extracted
    # file. Honor the idx-0 transparency here.
    _indexed_to_rgba(
        Image.open(FIRERED_FONTS_SRC / "down_arrow_3.png"),
    ).save(HUD_DST / "press_a_arrow.png")
    print("  hud: press_a_arrow.png")

    # Poke Ball strip (16x48 = 3 frames of 16x16: closed / half-open / open).
    # Palette index 0 is background — drop it so the ball renders with alpha.
    ball_src = BALL_SRC / "poke.png"
    if ball_src.exists():
        rgba = _indexed_to_rgba(Image.open(ball_src))
        rgba.save(HUD_DST / "ball_poke.png")
        print("  hud: ball_poke.png")
    else:
        print(f"  SKIP hud/ball_poke.png: {ball_src} not found")

    # Ball-open particle strip (8x64 = 8 frames of 8x8). Used by
    # `AnimateBallOpenParticles` in `src/battle_anim_special.c:1427`, emitted
    # from `SpriteCB_ReleaseMonFromBall` (`src/pokeball.c:763`). We emit it as
    # a spritesheet so the renderer can cycle the frames during the burst.
    if PARTICLES_SRC.exists():
        rgba = _indexed_to_rgba(Image.open(PARTICLES_SRC))
        rgba.save(HUD_DST / "ball_particles.png")
        print("  hud: ball_particles.png")
    else:
        print(f"  SKIP hud/ball_particles.png: {PARTICLES_SRC} not found")

    # Stat-change BG masks — 16 pre-composited 256x256 RGBA PNGs
    # (up × 8 palettes + down × 8 palettes). `statStageFlash` fades one
    # of these in over the scene as a full-screen overlay.
    extract_stat_masks()


def _composite_textbox() -> Image.Image:
    """Composite the FRLG battle textbox into a flat 240×48 RGBA PNG.

    Mirrors `LoadBattleTextboxAndBackground` in `src/battle_bg.c:717`:

        LZDecompressVram(gBattleInterface_Textbox_Gfx,  BG_CHAR_ADDR(0));
        CopyToBgTilemapBuffer(0, gBattleInterface_Textbox_Tilemap, 0, 0x000);
        LoadCompressedPalette(gBattleInterface_Textbox_Pal, BG_PLTT_ID(0),
                              2 * PLTT_SIZE_4BPP);

    The runtime loads TWO 16-color palettes (`textbox1.pal` + `textbox2.pal`
    concatenated per `graphics_file_rules.mk:139`) into adjacent palette
    slots. The tile sheet's palette-index pixels reference this 32-color
    block, so loading only `textbox1.pal` (as the old extraction did)
    leaves stray colors — notably a bright red at pal index 2 that showed
    up as red fragments in the old `textbox.png`.

    The tilemap is a full 32×64 tile grid (4096 bytes = 2048 entries).
    Only rows 14..19 × cols 0..29 form the visible battle textbox
    chrome; rows 14/19 are the top/bottom borders and rows 15..18 are
    the interior that `B_WIN_MSG` (`src/battle_bg.c:143`) carves out at
    runtime for text rendering. We crop to that region on output.

    Output: 240×48 RGBA, suitable for a single static Image blit at
    `x=8, y=STAGE_HEIGHT` inside the playground's 256×160 stage.
    """
    tiles_path = HUD_SRC_FIRERED / "textbox.png"
    tilemap_path = HUD_SRC_FIRERED / "textbox.bin"
    pal1_path = HUD_SRC_FIRERED / "textbox1.pal"
    pal2_path = HUD_SRC_FIRERED / "textbox2.pal"
    for p in (tiles_path, tilemap_path, pal1_path, pal2_path):
        if not p.exists():
            raise RuntimeError(f"missing textbox asset: {p}")

    indexed = Image.open(tiles_path)
    if indexed.mode != "P":
        raise RuntimeError(f"{tiles_path}: expected indexed PNG")

    # Swap the tile sheet's embedded palette for the concatenated
    # `textbox1 + textbox2` palette (32 colors). Pillow wants a padded
    # 256-entry (768-byte) palette — pad with zeros.
    pal1 = _load_jasc_palette(pal1_path)
    pal2 = _load_jasc_palette(pal2_path)
    combined = pal1 + pal2
    flat: list[int] = []
    for r, g, b in combined:
        flat.extend([r, g, b])
    flat.extend([0] * (768 - len(flat)))
    indexed.putpalette(flat)

    # Keep a reference to the indexed pixels so we can honor the GBA
    # convention that palette index 0 is fully transparent. Everywhere
    # else we sample the RGB conversion for speed.
    indexed_px = indexed.load()
    rgb = indexed.convert("RGB")
    rgb_px = rgb.load()
    tiles_per_row = rgb.size[0] // TILE_SIZE

    tilemap_bytes = tilemap_path.read_bytes()
    # Visible battle textbox chrome: tilemap rows 14..19 × cols 0..29 =
    # 30 tiles × 6 tiles = 240 × 48 pixels (full GBA width × our
    # playground's TEXTBOX_HEIGHT).
    ROW_START, ROW_END = 14, 20
    COL_START, COL_END = 0, 30
    out_w = (COL_END - COL_START) * TILE_SIZE
    out_h = (ROW_END - ROW_START) * TILE_SIZE
    out = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))
    out_px = out.load()

    for row in range(ROW_START, ROW_END):
        for col in range(COL_START, COL_END):
            val = struct.unpack_from(
                "<H", tilemap_bytes, (row * MAP_WIDTH_TILES + col) * 2
            )[0]
            tile = val & 0x3FF
            hflip = (val >> 10) & 1
            vflip = (val >> 11) & 1
            # Sub-palette bits (12..15) are addressed as part of the
            # concatenated 32-color palette via the runtime
            # `LoadCompressedPalette(..., 2 * PLTT_SIZE_4BPP)`. In this
            # tilemap every entry uses bank 0, so we ignore the bits.
            tx = (tile % tiles_per_row) * TILE_SIZE
            ty = (tile // tiles_per_row) * TILE_SIZE
            dx = (col - COL_START) * TILE_SIZE
            dy = (row - ROW_START) * TILE_SIZE
            for py in range(TILE_SIZE):
                sy = (TILE_SIZE - 1 - py) if vflip else py
                for px in range(TILE_SIZE):
                    sx = (TILE_SIZE - 1 - px) if hflip else px
                    if indexed_px[tx + sx, ty + sy] == 0:
                        continue  # palette index 0 → transparent
                    r, g, b = rgb_px[tx + sx, ty + sy]
                    out_px[dx + px, dy + py] = (r, g, b, 255)

    return out


def _render_user_window(width_tiles: int, height_tiles: int) -> Image.Image:
    """9-slice-composite the `type1` user window into a flat RGBA PNG.

    Source: `python-scripts/raw-assets/decomp-hacks/firered/graphics/text_window/type1.png`,
    a 24×24 (3×3 tile) indexed PNG whose tiles form a standard
    nine-slice frame:

        0 1 2   ← top border row   (TL, T,  TR)
        3 4 5   ← interior row     (L,  mid, R)
        6 7 8   ← bottom row       (BL, B,  BR)

    The indexed source uses palette index 0 as its transparent
    sentinel (decomp convention), so we honor that in the output.

    `width_tiles`/`height_tiles` must be at least 3 — the middle row
    and column are tiled as many times as needed to fill the frame.
    The interior tile (`4`) is a flat pale cream, matching the
    action-menu background in FireRed screenshot captures.
    """
    src_path = (
        REPO_ROOT
        / "python-scripts/raw-assets/decomp-hacks/firered/graphics/text_window/type1.png"
    )
    if not src_path.exists():
        raise RuntimeError(f"missing user window asset: {src_path}")
    if width_tiles < 3 or height_tiles < 3:
        raise ValueError("user window must be at least 3x3 tiles")

    indexed = Image.open(src_path)
    if indexed.mode != "P":
        raise RuntimeError(f"{src_path}: expected indexed PNG")
    rgb = indexed.convert("RGB")
    indexed_px = indexed.load()
    rgb_px = rgb.load()

    def blit_tile(dst_px, dx: int, dy: int, tile_x: int, tile_y: int) -> None:
        tx = tile_x * TILE_SIZE
        ty = tile_y * TILE_SIZE
        for py in range(TILE_SIZE):
            for px in range(TILE_SIZE):
                if indexed_px[tx + px, ty + py] == 0:
                    continue  # palette index 0 → transparent
                r, g, b = rgb_px[tx + px, ty + py]
                dst_px[dx + px, dy + py] = (r, g, b, 255)

    out = Image.new(
        "RGBA",
        (width_tiles * TILE_SIZE, height_tiles * TILE_SIZE),
        (0, 0, 0, 0),
    )
    out_px = out.load()
    last_col = width_tiles - 1
    last_row = height_tiles - 1
    for row in range(height_tiles):
        for col in range(width_tiles):
            if col == 0:
                src_tx = 0
            elif col == last_col:
                src_tx = 2
            else:
                src_tx = 1
            if row == 0:
                src_ty = 0
            elif row == last_row:
                src_ty = 2
            else:
                src_ty = 1
            blit_tile(out_px, col * TILE_SIZE, row * TILE_SIZE, src_tx, src_ty)
    return out


def _extract_menu_cursor() -> Image.Image:
    """Extract tiles 1 and 2 from `battle_interface/textbox.png`.

    Decomp `ActionSelectionCreateCursorAt`
    (`src/battle_controller_player.c:1436-1444`) writes tile indices
    `1` and `2` vertically at the active menu cell. Those two tiles
    together form the right-pointing ▶ cursor: tile 1 is the top
    half (triangle entering from the left), tile 2 is the bottom
    half (triangle tapering down).

    The in-tileset background is palette index 1 (pure white). We
    mark that as transparent in the output so the cursor can be
    placed over any background — in the decomp this happens to be
    invisible against the white action-menu chrome, but in our
    renderer we sometimes draw it against the dark dialogue chrome
    too (e.g. during debug) and a fully-opaque white halo would be
    ugly. The dark stroke pixels (indices 7 and 9) stay opaque in
    their original colors.
    """
    src_path = HUD_SRC_FIRERED / "textbox.png"
    if not src_path.exists():
        raise RuntimeError(f"missing textbox asset: {src_path}")
    indexed = Image.open(src_path)
    if indexed.mode != "P":
        raise RuntimeError(f"{src_path}: expected indexed PNG")
    rgb = indexed.convert("RGB")
    indexed_px = indexed.load()
    rgb_px = rgb.load()
    tiles_per_row = indexed.size[0] // TILE_SIZE

    out = Image.new("RGBA", (TILE_SIZE, TILE_SIZE * 2), (0, 0, 0, 0))
    out_px = out.load()
    for slot, tile_index in enumerate((1, 2)):
        tx = (tile_index % tiles_per_row) * TILE_SIZE
        ty = (tile_index // tiles_per_row) * TILE_SIZE
        for py in range(TILE_SIZE):
            for px in range(TILE_SIZE):
                idx = indexed_px[tx + px, ty + py]
                # Palette index 0 (transparent sentinel) AND index 1
                # (pure white background) both become alpha 0 — only
                # the dark stroke survives in the output sprite.
                if idx == 0 or idx == 1:
                    continue
                r, g, b = rgb_px[tx + px, ty + py]
                out_px[px, slot * TILE_SIZE + py] = (r, g, b, 255)
    return out


def extract_stat_masks() -> None:
    """Composite the 16 stat-change BG masks (2 tilemaps × 8 palettes).

    Mirrors `InitStatsChangeAnimation` / `StatsChangeAnimation_Step2` in
    `src/battle_anim_utility_funcs.c`:

      - `stat.png` supplies the 4bpp tiles (`gBattleStatMask_Gfx`).
      - `stat_tilemap_1.bin` / `stat_tilemap_2.bin` are the "up arrows"
        and "down arrows" tilemaps (`gBattleStatMask{1,2}_Tilemap`).
      - `stat{1..8}.pal` are the per-stat color ramps
        (`gBattleStatMask{1..8}_Pal`) — the palette swap is what makes an
        Attack-up look green and a Speed-up look blue.

    Output: one RGBA PNG per (direction, palette) pair, clipped to the
    visible GBA battle area (256×160 — we emit 256×256 so a scrolling
    `tileSprite` can wrap cleanly).
    """
    if not STAT_MASK_SRC.exists():
        print(f"  SKIP stat masks: {STAT_MASK_SRC} not found")
        return

    dst = HUD_DST / "stat_masks"
    dst.mkdir(parents=True, exist_ok=True)

    tiles_path = STAT_MASK_SRC / "stat.png"
    tiles_indexed = Image.open(tiles_path)
    if tiles_indexed.mode != "P":
        raise RuntimeError(f"{tiles_path}: expected indexed PNG")

    tilemaps = {
        "up": (STAT_MASK_SRC / "stat_tilemap_1.bin").read_bytes(),
        "down": (STAT_MASK_SRC / "stat_tilemap_2.bin").read_bytes(),
    }

    for pal_index in range(1, 9):
        pal_path = STAT_MASK_SRC / f"stat{pal_index}.pal"
        if not pal_path.exists():
            print(f"  SKIP stat_masks/stat{pal_index}.pal: not found")
            continue
        colors = _load_jasc_palette(pal_path)
        # Swap the tiles PNG's embedded palette for this stat's palette
        # so the compositor samples the right colors.
        flat: list[int] = []
        for r, g, b in colors:
            flat.extend([r, g, b])
        flat.extend([0] * (768 - len(flat)))
        tiles_indexed.putpalette(flat)
        # Keep a reference to the indexed pixels so we can preserve the
        # "palette index 0 is transparent" convention.
        indexed_px = tiles_indexed.load()
        tiles_rgb = tiles_indexed.convert("RGB")
        tile_rgb_px = tiles_rgb.load()
        tw, th = tiles_rgb.size
        tiles_per_row = tw // TILE_SIZE

        for direction, tilemap_bytes in tilemaps.items():
            # 32 tiles wide × 32 tiles tall = 256×256 full plane.
            out = Image.new("RGBA", (MAP_WIDTH_TILES * TILE_SIZE, 32 * TILE_SIZE), (0, 0, 0, 0))
            out_px = out.load()
            for row in range(32):
                for col in range(MAP_WIDTH_TILES):
                    val = struct.unpack_from(
                        "<H", tilemap_bytes, (row * MAP_WIDTH_TILES + col) * 2
                    )[0]
                    tile = val & 0x3FF
                    hflip = (val >> 10) & 1
                    vflip = (val >> 11) & 1
                    tx = (tile % tiles_per_row) * TILE_SIZE
                    ty = (tile // tiles_per_row) * TILE_SIZE
                    for py in range(TILE_SIZE):
                        sy = (TILE_SIZE - 1 - py) if vflip else py
                        for px in range(TILE_SIZE):
                            sx = (TILE_SIZE - 1 - px) if hflip else px
                            # Palette index 0 is the "hole" in the mask —
                            # the decomp blends it as fully transparent.
                            if indexed_px[tx + sx, ty + sy] == 0:
                                continue
                            r, g, b = tile_rgb_px[tx + sx, ty + sy]
                            out_px[col * TILE_SIZE + px, row * TILE_SIZE + py] = (r, g, b, 255)
            out_name = f"stat_mask_{direction}_{pal_index}.png"
            out.save(dst / out_name)
            print(f"  stat_masks: {out_name}")


WEATHER_FILES = [
    "rain.png",
    "sandstorm.png",
    "snow0.png",
    "snow1.png",
    "cloud.png",
    "ash.png",
    "fog_horizontal.png",
    "fog_diagonal.png",
]


def extract_weather() -> None:
    """Copy decomp weather sprites with palette index 0 made transparent."""
    WEATHER_DST.mkdir(parents=True, exist_ok=True)
    for name in WEATHER_FILES:
        src = WEATHER_SRC / name
        if not src.exists():
            print(f"  SKIP weather/{name}: not found")
            continue
        img = Image.open(src)
        # Convert to RGBA, with palette index 0 -> fully transparent.
        if img.mode == "P":
            rgba = img.convert("RGBA")
            px = rgba.load()
            # Use the original indexed image to find color-0 pixels.
            indexed = img.load()
            for y in range(rgba.height):
                for x in range(rgba.width):
                    if indexed[x, y] == 0:
                        px[x, y] = (0, 0, 0, 0)
            img = rgba
        else:
            img = img.convert("RGBA")
        (WEATHER_DST / name).unlink(missing_ok=True)
        img.save(WEATHER_DST / name)
        print(f"  weather: {name}")


def _indexed_to_rgba(img: Image.Image) -> Image.Image:
    """Convert an indexed PNG to RGBA with palette-index-0 → transparent."""
    rgba = img.convert("RGBA")
    if img.mode == "P":
        indexed = img.load()
        px = rgba.load()
        for y in range(rgba.height):
            for x in range(rgba.width):
                if indexed[x, y] == 0:
                    px[x, y] = (0, 0, 0, 0)
    return rgba


def extract_trainers() -> None:
    """
    Extract trainer sprites used by the battle intro/outro sequences.

    - Player back-pic: FireRed's `red_back_pic.png` — a 64x320 strip of 5
      64x64 frames showing the throw animation (idle → wind up → release).
      Sliced into individual frames for Phaser.
    - Rival front-pic: FireRed's `rival_early_front_pic.png` — classic
      blue/purple Blue (Gary) sprite, single 64x64 frame.

    Writes:
      trainers/player_back/frame_0.png .. frame_4.png
      trainers/rival_front.png
      trainers/index.json  (manifest with frame counts)
    """
    TRAINERS_DST.mkdir(parents=True, exist_ok=True)
    player_dst = TRAINERS_DST / "player_back"
    player_dst.mkdir(parents=True, exist_ok=True)

    # --- Player back-pic (5-frame vertical strip) ---
    player_src = TRAINERS_SRC / "back_pics" / "red_back_pic.png"
    strip = Image.open(player_src)
    frame_w, frame_h = 64, 64
    n_frames = strip.height // frame_h
    assert strip.width == frame_w, f"unexpected player strip width: {strip.width}"
    assert n_frames == 5, f"expected 5 frames, got {n_frames}"

    # Emit the full strip as a single RGBA PNG so Phaser can load it as a
    # spritesheet (`load.spritesheet(key, url, { frameWidth, frameHeight })`).
    strip_rgba = _indexed_to_rgba(strip)
    strip_rgba.save(TRAINERS_DST / "player_back_strip.png")

    # Also emit per-frame files in case a different consumer wants them
    # addressed individually.
    for i in range(n_frames):
        frame_indexed = strip.crop((0, i * frame_h, frame_w, (i + 1) * frame_h))
        frame_rgba = _indexed_to_rgba(frame_indexed)
        frame_rgba.save(player_dst / f"frame_{i}.png")
    print(f"  trainers: player_back ({n_frames} frames + strip)")

    # --- Rival front-pic (single 64x64 frame) ---
    rival_src = TRAINERS_SRC / "front_pics" / "rival_early_front_pic.png"
    rival = _indexed_to_rgba(Image.open(rival_src))
    rival.save(TRAINERS_DST / "rival_front.png")
    print(f"  trainers: rival_front")

    # --- Manifest ---
    manifest = {
        "player_back": {
            "frameCount": n_frames,
            "frameWidth": frame_w,
            "frameHeight": frame_h,
            "strip": "player_back_strip.png",
            "files": [f"player_back/frame_{i}.png" for i in range(n_frames)],
            "sourceRom": "firered",
            "sourceFile": "graphics/trainers/back_pics/red_back_pic.png",
        },
        "rival_front": {
            "frameCount": 1,
            "frameWidth": 64,
            "frameHeight": 64,
            "files": ["rival_front.png"],
            "sourceRom": "firered",
            "sourceFile": "graphics/trainers/front_pics/rival_early_front_pic.png",
        },
    }
    (TRAINERS_DST / "index.json").write_text(json.dumps(manifest, indent=2))


# -----------------------------------------------------------------------------
# Battle animation backgrounds
# -----------------------------------------------------------------------------
#
# Mirrors `gBattleAnimBackgroundTable` in
# decomp-hacks/emerald/src/data/battle_anim.h. Each logical BG_* id resolves to
# (image, tilemap, palette_override). The image is a 4bpp-indexed tiles.png and
# the tilemap is a packed 16-bit-per-entry binary. Palette overrides are JASC
# .pal text files that replace the tile PNG's embedded palette (matches the
# runtime behavior of `LoadCompressedPalette` at BG_PLTT_ID(2)).
#
# Output: one RGBA PNG per BG_* id (32x14 tiles = 256x112 px — same visible
# slice as the backdrop extractor) and an `index.json` mapping id → filename.

ANIM_BG_TABLE: list[tuple[str, str, str, str | None]] = [
    # (BG_* id,              image,        tilemap,                  palette override or None)
    ("BG_NONE",              "dark",       "dark",                    None),
    ("BG_DARK",              "dark",       "dark",                    None),
    ("BG_GHOST",             "ghost",      "ghost",                   None),
    ("BG_PSYCHIC",           "psychic",    "psychic",                 None),
    ("BG_IMPACT_OPPONENT",   "impact",     "impact_opponent",         None),
    ("BG_IMPACT_PLAYER",     "impact",     "impact_player",           None),
    ("BG_IMPACT_CONTESTS",   "impact",     "impact_contests",         None),
    ("BG_DRILL",             "drill",      "drill",                   None),
    ("BG_DRILL_CONTESTS",    "drill",      "drill_contests",          None),
    ("BG_HIGHSPEED_OPPONENT","highspeed",  "highspeed_opponent",      None),
    ("BG_HIGHSPEED_PLAYER",  "highspeed",  "highspeed_player",        None),
    ("BG_THUNDER",           "thunder",    "thunder",                 None),
    ("BG_GUILLOTINE_OPPONENT","guillotine","guillotine_opponent",     None),
    ("BG_GUILLOTINE_PLAYER", "guillotine", "guillotine_player",       None),
    ("BG_GUILLOTINE_CONTESTS","guillotine","guillotine_contests",     None),
    ("BG_ICE",               "ice",        "ice",                     None),
    ("BG_COSMIC",            "cosmic",     "cosmic",                  None),
    ("BG_IN_AIR",            "in_air",     "in_air",                  None),
    ("BG_SKY",               "drill",      "drill",                   "sky"),
    ("BG_SKY_CONTESTS",      "drill",      "drill_contests",          "sky"),
    ("BG_AURORA",            "aurora",     "aurora",                  None),
    ("BG_FISSURE",           "fissure",    "fissure",                 None),
    ("BG_BUG_OPPONENT",      "highspeed",  "highspeed_opponent",      "bug"),
    ("BG_BUG_PLAYER",        "highspeed",  "highspeed_player",        "bug"),
    ("BG_SOLAR_BEAM_OPPONENT","impact",    "impact_opponent",         "solarbeam"),
    ("BG_SOLAR_BEAM_PLAYER", "impact",     "impact_player",           "solarbeam"),
    ("BG_SOLAR_BEAM_CONTESTS","impact",    "impact_contests",         "solarbeam"),
]


def _load_jasc_palette(pal_path: Path) -> list[tuple[int, int, int]]:
    lines = pal_path.read_text().splitlines()
    # Header: "JASC-PAL", "0100", "<count>", then RGB triples.
    colors: list[tuple[int, int, int]] = []
    for line in lines[3:]:
        parts = line.strip().split()
        if len(parts) != 3:
            continue
        r, g, b = (int(p) for p in parts)
        colors.append((r, g, b))
    # Pad to 16 entries just in case.
    while len(colors) < 16:
        colors.append((0, 0, 0))
    return colors[:16]


def _composite_anim_bg(
    image_name: str,
    tilemap_name: str,
    palette_override: str | None,
    render_rows: int = RENDER_ROWS,
) -> Image.Image:
    """Composite an anim-BG tilemap against its tileset, honoring palette overrides.

    Tiles are 4bpp (16-color). If a palette override is present, it replaces
    the embedded palette before sampling. The tilemap is 16 bits per entry with
    hflip/vflip bits; sub-palette bits are ignored (anim BGs only use one
    palette slot at runtime).
    """
    img_path = ANIM_BG_SRC / f"{image_name}.png"
    bin_path = ANIM_BG_SRC / f"{tilemap_name}.bin"
    indexed = Image.open(img_path)
    if indexed.mode != "P":
        raise RuntimeError(f"{img_path}: expected indexed PNG")

    if palette_override is not None:
        colors = _load_jasc_palette(ANIM_BG_SRC / f"{palette_override}.pal")
        flat: list[int] = []
        for r, g, b in colors:
            flat.extend([r, g, b])
        # Pad to 256 palette entries (Pillow wants a full palette).
        flat.extend([0] * (768 - len(flat)))
        indexed.putpalette(flat)

    tiles_rgb = indexed.convert("RGB")
    tile_px = tiles_rgb.load()
    tw, th = tiles_rgb.size
    tiles_per_row = tw // TILE_SIZE
    total_tiles = tiles_per_row * (th // TILE_SIZE)

    map_bytes = bin_path.read_bytes()
    num_entries = len(map_bytes) // 2
    if num_entries == 0:
        raise RuntimeError(f"{bin_path}: empty tilemap")
    map_height = num_entries // MAP_WIDTH_TILES
    rows = min(render_rows, map_height)

    out = Image.new("RGB", (MAP_WIDTH_TILES * TILE_SIZE, rows * TILE_SIZE))
    out_px = out.load()
    for row in range(rows):
        for col in range(MAP_WIDTH_TILES):
            val = struct.unpack_from("<H", map_bytes, (row * MAP_WIDTH_TILES + col) * 2)[0]
            tile = val & 0x3FF
            hflip = (val >> 10) & 1
            vflip = (val >> 11) & 1
            if tile >= total_tiles:
                continue
            tx = (tile % tiles_per_row) * TILE_SIZE
            ty = (tile // tiles_per_row) * TILE_SIZE
            for py in range(TILE_SIZE):
                sy = (TILE_SIZE - 1 - py) if vflip else py
                for px in range(TILE_SIZE):
                    sx = (TILE_SIZE - 1 - px) if hflip else px
                    out_px[col * TILE_SIZE + px, row * TILE_SIZE + py] = tile_px[tx + sx, ty + sy]
    return out


def extract_anim_backgrounds() -> None:
    ANIM_BG_DST.mkdir(parents=True, exist_ok=True)
    index: dict[str, str] = {}
    for bg_id, image_name, tilemap_name, palette_override in ANIM_BG_TABLE:
        out_name = bg_id.lower().removeprefix("bg_") + ".png"
        out_path = ANIM_BG_DST / out_name
        try:
            img = _composite_anim_bg(image_name, tilemap_name, palette_override)
            img.save(out_path)
            index[bg_id] = out_name
            print(f"  anim_bg: {bg_id} -> {out_name}")
        except Exception as exc:
            print(f"  SKIP {bg_id}: {exc}")
    (ANIM_BG_DST / "index.json").write_text(json.dumps(index, indent=2))


PARTY_MENU_SRC = REPO_ROOT / "python-scripts/raw-assets/decomp-hacks/firered/graphics/party_menu"


def extract_party_menu() -> None:
    """Extract party menu chrome assets from the FireRed decomp.

    The party menu BG (``bg.bin`` tilemap) is composited against the
    ``bg.png`` tileset.  Slot chrome tilemaps (``slot_main.bin``,
    ``slot_wide.bin``, etc.) are raw ``u8`` tile indices (loaded with
    ``INCBIN_U8`` in the decomp) — **not** standard u16 BG tilemap
    entries.  Each byte is an index into ``bg.png``; the window's
    ``paletteNum`` selects a 16-color sub-palette at runtime, and
    ``LoadPartyBoxPalette`` swaps specific offsets ({4,5,6} and
    {1,7,8}) to achieve the selected/fainted/default coloring.

    We pre-render each slot chrome variant as a flat RGBA PNG so the
    Phaser party scene can swap images at runtime with zero palette
    tricks — the same approach used for the battle healthbox chrome.

    Sources:
        ``firered/src/party_menu.c`` — ``LoadPartyBoxPalette``
        ``firered/src/data/party_menu.h`` — palette ID tables + slot tilemaps
    """
    HUD_DST.mkdir(parents=True, exist_ok=True)

    tileset = Image.open(PARTY_MENU_SRC / "bg.png")
    if tileset.mode != "P":
        raise RuntimeError("party_menu/bg.png: expected indexed PNG")
    full_pal = tileset.getpalette()
    tiles_per_row = tileset.size[0] // TILE_SIZE
    tileset_px = tileset.load()

    def pal_color(idx: int) -> tuple[int, int, int]:
        return (full_pal[idx * 3], full_pal[idx * 3 + 1], full_pal[idx * 3 + 2])

    MAGENTA = (255, 0, 255)

    # ── Palette swap tables (from sPartyBox*PalIds* in data/party_menu.h) ──
    # Offsets 4,5,6 = main chrome, offsets 1,7,8 = secondary chrome.
    PAL_DEFAULT_1  = [52, 53, 54]       # sPartyBoxEmptySlotPalIds1
    PAL_DEFAULT_2  = [49, 55, 56]       # sPartyBoxEmptySlotPalIds2
    PAL_SELECTED_1 = [116, 117, 118]    # sPartyBoxCurrSelectionPalIds1
    PAL_SELECTED_2 = [97, 103, 104]     # sPartyBoxCurrSelectionPalIds2
    PAL_FAINTED_1  = [84, 85, 86]       # sPartyBoxFaintedPalIds1
    PAL_FAINTED_2  = [81, 87, 88]       # sPartyBoxFaintedPalIds2
    PAL_FNTSEL_1   = [148, 149, 150]    # sPartyBoxCurrSelectionFaintedPalIds
    PAL_FNTSEL_2   = [97, 103, 104]     # sPartyBoxCurrSelectionPalIds2

    STATES = [
        ("",         PAL_DEFAULT_1,  PAL_DEFAULT_2),
        ("_sel",     PAL_SELECTED_1, PAL_SELECTED_2),
        ("_fnt",     PAL_FAINTED_1,  PAL_FAINTED_2),
        ("_fnt_sel", PAL_FNTSEL_1,   PAL_FNTSEL_2),
    ]

    def _build_swap(p1: list[int], p2: list[int]) -> dict[int, tuple[int, int, int]]:
        swaps: dict[int, tuple[int, int, int]] = {}
        for i, pid in enumerate(p1):
            swaps[4 + i] = pal_color(pid)
        for off, pid in zip([1, 7, 8], p2):
            swaps[off] = pal_color(pid)
        return swaps

    def _render_slot(bin_path: Path, w: int, h: int,
                     swap: dict[int, tuple[int, int, int]]) -> Image.Image:
        data = bin_path.read_bytes()
        out = Image.new("RGBA", (w * TILE_SIZE, h * TILE_SIZE), (0, 0, 0, 0))
        out_px = out.load()
        for i, tile_idx in enumerate(data):
            col, row = i % w, i // w
            if row >= h:
                break
            tx = (tile_idx % tiles_per_row) * TILE_SIZE
            ty = (tile_idx // tiles_per_row) * TILE_SIZE
            dx, dy = col * TILE_SIZE, row * TILE_SIZE
            for py in range(TILE_SIZE):
                for px in range(TILE_SIZE):
                    raw = tileset_px[tx + px, ty + py]
                    if raw == 0:
                        continue
                    offset = raw % 16
                    c = swap.get(offset, pal_color(raw))
                    if c == MAGENTA:
                        continue
                    out_px[dx + px, dy + py] = (*c, 255)
        return out

    # ── Full BG (u16 tilemap) ──
    bg_data = (PARTY_MENU_SRC / "bg.bin").read_bytes()
    bg = Image.new("RGBA", (240, 160), (0, 0, 0, 0))
    bg_px = bg.load()
    for row in range(20):
        for col in range(30):
            off = (row * 32 + col) * 2
            if off + 1 >= len(bg_data):
                continue
            val = struct.unpack_from("<H", bg_data, off)[0]
            tile = val & 0x3FF
            hflip = (val >> 10) & 1
            vflip = (val >> 11) & 1
            pal_bank = (val >> 12) & 0xF
            tx = (tile % tiles_per_row) * TILE_SIZE
            ty = (tile // tiles_per_row) * TILE_SIZE
            dx, dy = col * TILE_SIZE, row * TILE_SIZE
            for py in range(TILE_SIZE):
                sy = (TILE_SIZE - 1 - py) if vflip else py
                for px in range(TILE_SIZE):
                    sx = (TILE_SIZE - 1 - px) if hflip else px
                    raw = tileset_px[tx + sx, ty + sy]
                    if raw == 0:
                        continue
                    c = pal_color(pal_bank * 16 + (raw % 16))
                    if c == MAGENTA:
                        continue
                    bg_px[dx + px, dy + py] = (*c, 255)
    bg.save(HUD_DST / "party_bg.png")
    print("  party_bg.png (240×160)")

    # ── Slot chrome variants ──
    # slot_main.bin: 10 cols × 7 rows  (window width=10, height=7)
    # slot_wide.bin: 18 cols × 3 rows  (window width=18, height=3)
    for name, bin_name, w, h in [
        ("slot_main", "slot_main.bin", 10, 7),
        ("slot_wide", "slot_wide.bin", 18, 3),
    ]:
        for suffix, p1, p2 in STATES:
            img = _render_slot(PARTY_MENU_SRC / bin_name, w, h, _build_swap(p1, p2))
            out_name = f"party_{name}{suffix}.png"
            img.save(HUD_DST / out_name)
            print(f"  {out_name} ({img.size[0]}×{img.size[1]})")

    # Empty slot (one variant only)
    img = _render_slot(
        PARTY_MENU_SRC / "slot_wide_empty.bin", 18, 3,
        _build_swap(PAL_DEFAULT_1, PAL_DEFAULT_2),
    )
    img.save(HUD_DST / "party_slot_wide_empty.png")
    print(f"  party_slot_wide_empty.png ({img.size[0]}×{img.size[1]})")

    # Cancel button: 7 cols × 2 rows
    # (CopyToBgTilemapBufferRect_ChangePalette(1, sCancelButton_Tilemap, 23, 18, 7, 2, 17))
    for suffix, p1, p2 in [STATES[0], STATES[1]]:
        img = _render_slot(
            PARTY_MENU_SRC / "cancel_button.bin", 7, 2, _build_swap(p1, p2),
        )
        out_name = f"party_cancel{suffix}.png"
        img.save(HUD_DST / out_name)
        print(f"  {out_name} ({img.size[0]}×{img.size[1]})")

    # ── Copy OBJ sprites (indexed→RGBA with idx-0 transparency) ──
    for src_name, dst_name in [
        ("pokeball.png",       "party_pokeball.png"),
        ("pokeball_small.png", "party_pokeball_small.png"),
        ("hold_icons.png",     "party_hold_icons.png"),
    ]:
        src = PARTY_MENU_SRC / src_name
        if src.exists():
            _indexed_to_rgba(Image.open(src)).save(HUD_DST / dst_name)
            print(f"  {dst_name}")
        else:
            print(f"  SKIP {dst_name}: {src} not found")


def main() -> None:
    print("Rendering battle backdrops...")
    index = extract_backdrops()
    print(f"Rendered {len(index)} backdrops -> {BACKDROP_DST}")
    print("Copying HUD assets...")
    extract_hud()
    print("Copying weather sprites...")
    extract_weather()
    print("Extracting trainer sprites...")
    extract_trainers()
    print("Extracting battle anim backgrounds...")
    extract_anim_backgrounds()
    print("Extracting party menu assets...")
    extract_party_menu()
    print("Done.")


if __name__ == "__main__":
    main()
