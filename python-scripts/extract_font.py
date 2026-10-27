"""
DEPRECATED — the playground now uses the real Pokemon Emerald OpenType
font at `pokefont/Emerald.ttf`, loaded via CSS `@font-face` and rendered
through Phaser `DOMElement`s. See `battle-playground/src/phaser/BitmapFont.ts`
and `battle-playground/src/styles.css` for the runtime path, and
`pokefont/README.md` for the font's build pipeline.

This script used to extract a 16x32 grid of 16x16 glyph cells from the
decomp's `latin_normal.png` into `battle-playground/src/assets/font/`,
but the bitmap atlas + per-glyph blitter has been removed in favor of
the TTF. The file is kept as a reference for how the decomp atlas was
laid out in case we ever need to regenerate a bitmap fallback.

Do not run this as part of the normal build.
"""
from __future__ import annotations
import json
import re
from pathlib import Path
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
FONT_PNG = REPO_ROOT / "python-scripts/raw-assets/decomp-hacks/emerald/graphics/fonts/latin_normal.png"
FONTS_C = REPO_ROOT / "python-scripts/raw-assets/decomp-hacks/emerald/src/fonts.c"
CHARMAP = REPO_ROOT / "python-scripts/raw-assets/decomp-hacks/emerald/charmap.txt"
OUT_DIR = REPO_ROOT / "battle-playground/src/assets/font"

CELL = 16
COLS = 16
ROWS = 32
# In the decomp the normal font advances 16 px per line (tile size * 2).
LINE_HEIGHT = 15
# Palette for the four 2bpp glyph indices, baked to the colors the FireRed
# battle textbox uses at runtime. The decomp's `sTextOnWindowsInfo_Normal[B_WIN_MSG]`
# in `src/battle_message.c:2408` sets:
#     fgColor=1, shadowColor=6, bgColor=15
# which resolves against the battle textbox palette
# (`graphics/battle_interface/textbox1.pal`) to:
#     idx 1 -> (255, 255, 255)  white foreground
#     idx 6 -> (106,  90, 115)  purple-gray shadow
#     idx 15 -> ( 41,  82, 106) dark teal textbox fill
#
# The extracted glyph atlas uses palette indices 1/2/3 (not 1/6/15 — the PNG
# is stored in a compact 4-color form). We map them straight onto the
# runtime colors so the rendered glyph slots match the decomp:
#     source idx 1 -> fg white
#     source idx 2 -> shadow purple-gray
#     source idx 3 -> dark teal (blends into the battle textbox)
PALETTE = [
    (0, 0, 0, 0),          # 0 transparent
    (255, 255, 255, 255),  # 1 fg
    (106, 90, 115, 255),   # 2 shadow
    (41, 82, 106, 255),    # 3 bg / blends with battle textbox fill
]


def parse_glyph_widths() -> list[int]:
    src = FONTS_C.read_text()
    m = re.search(
        r"gFontNormalLatinGlyphWidths\[\]\s*=\s*\{([^}]*)\}",
        src,
    )
    if not m:
        raise RuntimeError("gFontNormalLatinGlyphWidths not found in fonts.c")
    body = m.group(1)
    nums = [int(x) for x in re.findall(r"\d+", body)]
    if len(nums) != COLS * ROWS:
        raise RuntimeError(
            f"expected {COLS*ROWS} widths, got {len(nums)}"
        )
    return nums


def parse_ascii_charmap() -> dict[str, int]:
    """Return {ascii_char: pokemon_encoding_byte} for single-byte ASCII entries."""
    out: dict[str, int] = {}
    line_re = re.compile(r"^'(.)'\s*=\s*([0-9A-Fa-f]+)\s*$")
    for raw in CHARMAP.read_text().splitlines():
        line = raw.split("@")[0].strip()
        if not line:
            continue
        m = line_re.match(line)
        if not m:
            continue
        ch, hex_str = m.group(1), m.group(2)
        if len(hex_str) != 2:
            continue
        code = int(hex_str, 16)
        if ord(ch) < 128:  # ASCII only
            out[ch] = code
    return out


def render_atlas() -> Image.Image:
    src = Image.open(FONT_PNG)
    if src.mode != "P":
        raise RuntimeError(f"expected indexed PNG, got mode={src.mode}")
    if src.size != (CELL * COLS, CELL * ROWS):
        raise RuntimeError(f"unexpected font png size {src.size}")
    src_px = src.load()

    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    out_px = out.load()
    for y in range(src.height):
        for x in range(src.width):
            idx = src_px[x, y]
            if idx < 0 or idx >= len(PALETTE):
                idx = 0
            out_px[x, y] = PALETTE[idx]
    return out


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    widths = parse_glyph_widths()
    char_map = parse_ascii_charmap()
    atlas = render_atlas()

    atlas_path = OUT_DIR / "latin_normal.png"
    atlas.save(atlas_path)

    meta = {
        "cellWidth": CELL,
        "cellHeight": CELL,
        "cols": COLS,
        "rows": ROWS,
        "lineHeight": LINE_HEIGHT,
        "widths": widths,
        "charMap": {ch: code for ch, code in sorted(char_map.items())},
    }
    (OUT_DIR / "latin_normal.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=True) + "\n"
    )
    print(f"wrote {atlas_path} ({atlas.size[0]}x{atlas.size[1]})")
    print(f"wrote {OUT_DIR / 'latin_normal.json'} ({len(char_map)} ASCII chars)")


if __name__ == "__main__":
    main()
