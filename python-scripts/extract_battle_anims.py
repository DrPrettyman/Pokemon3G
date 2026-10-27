"""
Extract Gen 3 battle animation sprite sheets and sprite templates from the
pokeemerald decomp for use in the battle-playground Phaser scene.

Emits three artefacts to battle-playground/src/assets/battle_anims/:
  sprites/<name>.png          RGBA copies with palette-index-0 transparent
  sprite_sheets.json          ANIM_TAG_* → { url, width, height, palette }
  sprite_templates.json       gFooSpriteTemplate → {
                                  tileTag, paletteTag,
                                  frameWidth, frameHeight,
                                  anims: [[{tileOffset, duration}, ...], ...],
                                  callback
                                }

The Phase 3 command interpreter loads `sprite_templates.json` at build time and
uses it to translate decomp `createsprite <template>` calls into Phaser sprite
spawns with the right frame dimensions and animation sequences.
"""
from __future__ import annotations
import json
import re
from pathlib import Path
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
DECOMP = REPO_ROOT / "python-scripts/raw-assets/decomp-hacks/emerald"
DECOMP_FIRERED = REPO_ROOT / "python-scripts/raw-assets/decomp-hacks/firered"

SPRITES_SRC = DECOMP / "graphics/battle_anims/sprites"
GRAPHICS_C = DECOMP / "src/graphics.c"
BATTLE_ANIM_DATA = DECOMP / "src/data/battle_anim.h"
BATTLE_ANIM_CONST = DECOMP / "include/constants/battle_anim.h"
# Sprite templates live in src/battle_anim_*.c. We parse BOTH emerald and
# firered because pokedata3g's animations.json was generated from FireRed
# scripts, which reference some templates only present in firered's source.
BATTLE_ANIM_SRC_DIRS = [
    DECOMP / "src",
    DECOMP_FIRERED / "src",
]

OUT_DIR = REPO_ROOT / "battle-playground/src/assets/battle_anims"
SPRITES_DST = OUT_DIR / "sprites"


# ---------------------------------------------------------------------------
#  Step 1 — copy PNGs with transparent palette-index 0
# ---------------------------------------------------------------------------

def copy_sprite_pngs() -> list[str]:
    SPRITES_DST.mkdir(parents=True, exist_ok=True)
    names: list[str] = []
    for png in sorted(SPRITES_SRC.glob("*.png")):
        img = Image.open(png)
        rgba = img.convert("RGBA")
        if img.mode == "P":
            indexed = img.load()
            px = rgba.load()
            for y in range(rgba.height):
                for x in range(rgba.width):
                    if indexed[x, y] == 0:
                        px[x, y] = (0, 0, 0, 0)
        (SPRITES_DST / png.name).unlink(missing_ok=True)
        rgba.save(SPRITES_DST / png.name)
        names.append(png.stem)
    return names


# ---------------------------------------------------------------------------
#  Step 2 — parse src/graphics.c for gfxSym -> filename
# ---------------------------------------------------------------------------

INCBIN_GFX_RE = re.compile(
    r'const u32 (gBattleAnimSpriteGfx_\w+)\[\]\s*=\s*'
    r'INCBIN_U32\("graphics/battle_anims/sprites/([^"]+)\.4bpp\.lz"\)'
)
INCBIN_PAL_RE = re.compile(
    r'const u32 (gBattleAnimSpritePal_\w+)\[\]\s*=\s*'
    r'INCBIN_U32\("graphics/battle_anims/sprites/([^"]+)\.gbapal\.lz"\)'
)


def parse_graphics_c() -> tuple[dict[str, str], dict[str, str]]:
    text = GRAPHICS_C.read_text()
    gfx = {sym: name for sym, name in INCBIN_GFX_RE.findall(text)}
    pal = {sym: name for sym, name in INCBIN_PAL_RE.findall(text)}
    return gfx, pal


# ---------------------------------------------------------------------------
#  Step 3 — parse src/data/battle_anim.h for ANIM_TAG_* bindings
# ---------------------------------------------------------------------------

TAG_GFX_ROW_RE = re.compile(
    r'\{\s*(gBattleAnimSpriteGfx_\w+)\s*,\s*(0x[0-9A-Fa-f]+|\d+)\s*,\s*(ANIM_TAG_\w+)\s*\}'
)
TAG_PAL_ROW_RE = re.compile(
    r'\{\s*(gBattleAnimSpritePal_\w+)\s*,\s*(ANIM_TAG_\w+)\s*\}'
)


def parse_battle_anim_data() -> tuple[dict[str, tuple[str, int]], dict[str, str]]:
    text = BATTLE_ANIM_DATA.read_text()
    tag_to_gfx: dict[str, tuple[str, int]] = {}
    for gfx_sym, size_str, tag in TAG_GFX_ROW_RE.findall(text):
        size = int(size_str, 0)
        tag_to_gfx[tag] = (gfx_sym, size)
    tag_to_pal: dict[str, str] = {}
    for pal_sym, tag in TAG_PAL_ROW_RE.findall(text):
        tag_to_pal[tag] = pal_sym
    return tag_to_gfx, tag_to_pal


# ---------------------------------------------------------------------------
#  Step 4 — emit sprite_sheets.json (ANIM_TAG_* -> sheet metadata)
# ---------------------------------------------------------------------------

def build_sprite_sheets(
    png_stems: list[str],
    gfx_sym_to_file: dict[str, str],
    tag_to_gfx: dict[str, tuple[str, int]],
) -> dict[str, dict]:
    stem_set = set(png_stems)
    sheets: dict[str, dict] = {}
    for tag, (gfx_sym, _byte_size) in tag_to_gfx.items():
        filename = gfx_sym_to_file.get(gfx_sym)
        if filename is None or filename not in stem_set:
            continue
        png_path = SPRITES_DST / f"{filename}.png"
        img = Image.open(png_path)
        sheets[tag] = {
            "file": f"{filename}.png",
            "width": img.width,
            "height": img.height,
        }
    return sheets


# ---------------------------------------------------------------------------
#  Step 5 — parse sprite templates + ANIMCMD sequences from src/battle_anim_*.c
# ---------------------------------------------------------------------------

# gOamData naming convention: gOamData_<Affine>_<BlendMode>_<W>x<H>
OAM_DIMS_RE = re.compile(r'gOamData_\w+?_(\d+)x(\d+)')

# SpriteTemplate struct bodies. Tolerant of whitespace + field ordering.
# The variable name doesn't always end in "SpriteTemplate" — e.g. some are
# named like gIceCrystalSpiralInwardLarge. Match any global g-prefixed name.
TEMPLATE_RE = re.compile(
    r'const\s+struct\s+SpriteTemplate\s+(g\w+)\s*=\s*\{([^}]*)\}\s*;',
    re.DOTALL,
)

# Individual fields inside a template body.
FIELD_RE = re.compile(r'\.(\w+)\s*=\s*([^,]+),')

# ANIMCMD_FRAME(tileOffset, duration [, hFlip [, vFlip]])
ANIMCMD_FRAME_RE = re.compile(
    r'ANIMCMD_FRAME\(\s*(\d+|0x[0-9A-Fa-f]+)\s*,\s*(\d+)'
)
# Any ANIMCMD_END / JUMP / LOOP marker for detecting sequence boundaries.
# A whole AnimCmd array definition.
ANIM_CMD_ARRAY_RE = re.compile(
    r'(?:static\s+)?const\s+union\s+AnimCmd\s+(\w+)\s*\[\s*\]\s*=\s*\{([^}]*)\}\s*;',
    re.DOTALL,
)
# An anims table referencing cmd arrays.
ANIMS_TABLE_RE = re.compile(
    r'(?:static\s+)?const\s+union\s+AnimCmd\s*\*\s*const\s+(\w+)\s*\[\s*\]\s*=\s*\{([^}]*)\}\s*;',
    re.DOTALL,
)


def parse_oam_dimensions(oam_name: str) -> tuple[int, int] | None:
    m = OAM_DIMS_RE.search(oam_name)
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def parse_battle_anim_sources() -> dict[str, dict]:
    """Walk emerald + firered src/battle_anim*.c to collect sprite templates."""
    cmd_arrays: dict[str, list[dict]] = {}  # name → list of {tileOffset,duration}
    anims_tables: dict[str, list[str]] = {}  # name → list of cmd array names
    templates: dict[str, dict] = {}

    sources: list[Path] = []
    for d in BATTLE_ANIM_SRC_DIRS:
        if d.exists():
            sources.extend(sorted(d.glob("battle_anim*.c")))
    for src in sources:
        text = src.read_text()

        # Parse individual AnimCmd arrays.
        for name, body in ANIM_CMD_ARRAY_RE.findall(text):
            frames = []
            for offset_str, dur_str in ANIMCMD_FRAME_RE.findall(body):
                frames.append({
                    "tileOffset": int(offset_str, 0),
                    "duration": int(dur_str),
                })
            if frames:
                cmd_arrays[name] = frames

        # Parse anims tables (pointer arrays into AnimCmd arrays).
        for name, body in ANIMS_TABLE_RE.findall(text):
            refs = [
                w.strip()
                for w in re.findall(r'\b(\w+)\b', body)
                if w.strip() and not w.strip().startswith("0")
            ]
            anims_tables[name] = refs

        # Parse sprite templates.
        for tmpl_name, body in TEMPLATE_RE.findall(text):
            fields: dict[str, str] = {}
            for key, value in FIELD_RE.findall(body + ","):
                fields[key] = value.strip().rstrip(",").strip()
            tile_tag = fields.get("tileTag", "").strip()
            pal_tag = fields.get("paletteTag", "").strip()
            oam = fields.get("oam", "").strip().lstrip("&")
            anims_ref = fields.get("anims", "").strip()
            callback = fields.get("callback", "").strip()
            dims = parse_oam_dimensions(oam)
            templates[tmpl_name] = {
                "tileTag": tile_tag,
                "paletteTag": pal_tag,
                "oam": oam,
                "frameWidth": dims[0] if dims else None,
                "frameHeight": dims[1] if dims else None,
                "animsRef": anims_ref,
                "callback": callback,
            }

    # Resolve anims references into concrete frame lists.
    for tmpl in templates.values():
        ref = tmpl.pop("animsRef", "")
        if not ref or ref.endswith("NULL"):
            tmpl["anims"] = []
            continue
        refs = anims_tables.get(ref)
        if refs is None:
            # Might be a direct AnimCmd pointer (single-sequence template).
            if ref in cmd_arrays:
                tmpl["anims"] = [cmd_arrays[ref]]
            else:
                tmpl["anims"] = []
            continue
        sequences = []
        for cmd_name in refs:
            if cmd_name in cmd_arrays:
                sequences.append(cmd_arrays[cmd_name])
        tmpl["anims"] = sequences

    return templates


# ---------------------------------------------------------------------------
#  Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("Copying sprite PNGs...")
    png_stems = copy_sprite_pngs()
    print(f"  {len(png_stems)} sprites copied to {SPRITES_DST}")

    print("Parsing graphics.c ...")
    gfx_sym_to_file, pal_sym_to_file = parse_graphics_c()
    print(f"  gfx symbols: {len(gfx_sym_to_file)}  pal symbols: {len(pal_sym_to_file)}")

    print("Parsing battle_anim.h ...")
    tag_to_gfx, tag_to_pal = parse_battle_anim_data()
    print(f"  tag→gfx: {len(tag_to_gfx)}  tag→pal: {len(tag_to_pal)}")

    print("Building sprite_sheets.json ...")
    sheets = build_sprite_sheets(png_stems, gfx_sym_to_file, tag_to_gfx)
    (OUT_DIR / "sprite_sheets.json").write_text(json.dumps(sheets, indent=2))
    print(f"  {len(sheets)} anim tags bound to sprite sheets")

    print("Parsing sprite templates from src/battle_anim_*.c ...")
    templates = parse_battle_anim_sources()
    (OUT_DIR / "sprite_templates.json").write_text(json.dumps(templates, indent=2))
    print(f"  {len(templates)} sprite templates extracted")

    # Sanity check on a known template.
    rocks = templates.get("gFallingRockSpriteTemplate")
    if rocks:
        print(
            f"  e.g. gFallingRockSpriteTemplate -> "
            f"tileTag={rocks['tileTag']} frame={rocks['frameWidth']}x{rocks['frameHeight']} "
            f"anims={len(rocks['anims'])}"
        )

    print("Done.")


if __name__ == "__main__":
    main()
