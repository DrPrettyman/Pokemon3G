"""Extract battle animations from the FireRed decomp into structured JSON.

Parses battle_anim_scripts.s (assembly macros) and supporting C/header files
to produce a JSON file with move, status, general, and special animation data
plus sprite tag-to-file mappings.

Run:
    python -m generate.battle_anims  (from python-scripts/)
"""

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from paths import DECOMP_DIR, EXTRACTED_ASSETS

DECOMP = Path(DECOMP_DIR) / "firered"
SCRIPTS_FILE = DECOMP / "data" / "battle_anim_scripts.s"
CONSTANTS_FILE = DECOMP / "include" / "constants" / "battle_anim.h"
GRAPHICS_C = DECOMP / "src" / "graphics.c"
DATA_ANIM_H = DECOMP / "src" / "data" / "battle_anim.h"

OUTPUT_FILE = os.path.join(EXTRACTED_ASSETS, "battle_anims.json")


# ---------------------------------------------------------------------------
# 1. Parse ANIM_TAG constants
# ---------------------------------------------------------------------------

def parse_anim_tags(path: Path) -> dict[str, int]:
    """Parse #define ANIM_TAG_* constants -> {name: numeric_id}."""
    tags = {}
    sprites_start = None
    with open(path) as f:
        for line in f:
            m = re.match(r"#define\s+(ANIM_SPRITES_START)\s+(\d+)", line)
            if m:
                sprites_start = int(m.group(2))
                continue
            m = re.match(r"#define\s+(ANIM_TAG_\w+)\s+\(ANIM_SPRITES_START\s*\+\s*(\d+)\)", line)
            if m:
                name = m.group(1)
                offset = int(m.group(2))
                tags[name] = sprites_start + offset
    return tags


def parse_bg_constants(path: Path) -> dict[str, int]:
    """Parse #define BG_* constants -> {name: numeric_id}."""
    bgs = {}
    with open(path) as f:
        for line in f:
            m = re.match(r"#define\s+(BG_\w+)\s+(\d+)", line)
            if m:
                bgs[m.group(1)] = int(m.group(2))
    return bgs


# ---------------------------------------------------------------------------
# 2. Parse graphics.c INCBIN -> tag variable to PNG file
# ---------------------------------------------------------------------------

def parse_graphics_incbin(path: Path) -> dict[str, str]:
    """Parse INCBIN_U32 lines -> {variable_name: png_filename}.

    e.g. gBattleAnimSpriteGfx_Bone -> bone.png
    """
    gfx_to_file = {}
    with open(path) as f:
        for line in f:
            m = re.match(
                r'const\s+u32\s+(gBattleAnimSpriteGfx_\w+)\[\]\s*=\s*INCBIN_U32\("(graphics/battle_anims/sprites/(\S+))\.4bpp\.lz"\)',
                line,
            )
            if m:
                var_name = m.group(1)
                png_name = m.group(3) + ".png"
                gfx_to_file[var_name] = png_name
    return gfx_to_file


# ---------------------------------------------------------------------------
# 3. Parse gBattleAnimPicTable -> tag to sprite file + size
# ---------------------------------------------------------------------------

def parse_pic_table(path: Path, gfx_to_file: dict[str, str]) -> dict[str, dict]:
    """Parse gBattleAnimPicTable[] -> {ANIM_TAG_NAME: {file, size_hex}}."""
    tag_info = {}
    in_table = False
    with open(path) as f:
        for line in f:
            if "gBattleAnimPicTable" in line and "[]" in line:
                in_table = True
                continue
            if in_table:
                if line.strip() == "};":
                    break
                m = re.match(
                    r"\s*\{(\w+),\s*(0x[\da-fA-F]+),\s*(\w+)\}",
                    line,
                )
                if m:
                    gfx_var = m.group(1)
                    size_hex = m.group(2)
                    tag_name = m.group(3)
                    png = gfx_to_file.get(gfx_var)
                    tag_info[tag_name] = {
                        "file": png,
                        "size": int(size_hex, 16),
                    }
    return tag_info


# ---------------------------------------------------------------------------
# 4. Parse palette table -> tag to palette file
# ---------------------------------------------------------------------------

def parse_palette_incbin(path: Path) -> dict[str, str]:
    """Parse INCBIN_U32 palette lines -> {variable_name: pal_filename}."""
    pal_to_file = {}
    with open(path) as f:
        for line in f:
            m = re.match(
                r'const\s+u32\s+(gBattleAnimSpritePal_\w+)\[\]\s*=\s*INCBIN_U32\("(graphics/battle_anims/sprites/(\S+))\.gbapal\.lz"\)',
                line,
            )
            if m:
                var_name = m.group(1)
                pal_name = m.group(3) + ".pal"
                pal_to_file[var_name] = pal_name
    return pal_to_file


def parse_pal_table(path: Path, pal_to_file: dict[str, str]) -> dict[str, str]:
    """Parse gBattleAnimPaletteTable[] -> {ANIM_TAG_NAME: pal_filename}."""
    tag_pals = {}
    in_table = False
    with open(path) as f:
        for line in f:
            if "gBattleAnimPaletteTable" in line and "[]" in line:
                in_table = True
                continue
            if in_table:
                if line.strip() == "};":
                    break
                m = re.match(r"\s*\{(\w+),\s*(\w+)\}", line)
                if m:
                    pal_var = m.group(1)
                    tag_name = m.group(2)
                    tag_pals[tag_name] = pal_to_file.get(pal_var)
    return tag_pals


# ---------------------------------------------------------------------------
# 4b. Parse battle background data
# ---------------------------------------------------------------------------

def parse_bg_incbin(path: Path) -> dict[str, str]:
    """Parse INCBIN_U32 lines for background assets -> {variable: filename}.

    Handles image (.4bpp.lz), palette (.gbapal.lz), and tilemap (.bin.lz).
    """
    var_to_file = {}
    with open(path) as f:
        for line in f:
            # Image
            m = re.match(
                r'const\s+u32\s+(gBattleAnimBg(?:Image|Palette|Tilemap)_\w+)\[\]\s*=\s*INCBIN_U32\("(graphics/battle_anims/backgrounds/(\S+?))\.(4bpp|gbapal|bin)\.lz"\)',
                line,
            )
            if m:
                var_name = m.group(1)
                basename = m.group(3)
                ext = m.group(4)
                if ext == "4bpp":
                    var_to_file[var_name] = basename + ".png"
                elif ext == "gbapal":
                    var_to_file[var_name] = basename + ".pal"
                elif ext == "bin":
                    var_to_file[var_name] = basename + ".bin"
    return var_to_file


def parse_bg_table(path: Path, var_to_file: dict[str, str]) -> dict[str, dict]:
    """Parse gBattleAnimBackgroundTable[] -> {BG_NAME: {image, palette, tilemap}}.

    Table uses C99 designated initializers: [BG_DARK] = {image, palette, tilemap}.
    """
    bg_table = {}
    in_table = False
    with open(path) as f:
        for line in f:
            if "gBattleAnimBackgroundTable" in line and "[]" in line:
                in_table = True
                continue
            if in_table:
                if line.strip() == "};":
                    break
                m = re.match(
                    r"\s*\[(BG_\w+)\]\s*=\s*\{(\w+),\s*(\w+),\s*(\w+)\}",
                    line,
                )
                if m:
                    bg_name = m.group(1)
                    image_var = m.group(2)
                    palette_var = m.group(3)
                    tilemap_var = m.group(4)
                    bg_table[bg_name] = {
                        "image": var_to_file.get(image_var),
                        "palette": var_to_file.get(palette_var),
                        "tilemap": var_to_file.get(tilemap_var),
                    }
    return bg_table


def build_backgrounds(
    bg_constants: dict[str, int],
    bg_table: dict[str, dict],
) -> dict[str, dict]:
    """Build clean background lookup: BG_NAME -> {id, image, palette, tilemap}."""
    result = {}
    for bg_name, bg_id in sorted(bg_constants.items(), key=lambda x: x[1]):
        entry = {"id": bg_id}
        table_entry = bg_table.get(bg_name)
        if table_entry:
            entry.update(table_entry)
        result[bg_name] = entry
    return result


# ---------------------------------------------------------------------------
# 5. Parse animation scripts
# ---------------------------------------------------------------------------

def parse_anim_scripts(path: Path) -> dict:
    """Parse battle_anim_scripts.s into structured data.

    Returns {
        "move_table": [label, ...],           # index = move_id
        "status_table": [label, ...],
        "general_table": [label, ...],
        "special_table": [label, ...],
        "labels": {label: [commands...]},      # every label's commands
    }
    """
    with open(path) as f:
        lines = f.readlines()

    # --- Pass 1: extract index tables ---
    move_table = []
    status_table = []
    general_table = []
    special_table = []
    current_table = None

    for line in lines:
        stripped = line.strip()

        if stripped.startswith("gBattleAnims_Moves::"):
            current_table = move_table
            continue
        elif stripped.startswith("gBattleAnims_StatusConditions::"):
            current_table = status_table
            continue
        elif stripped.startswith("gBattleAnims_General::"):
            current_table = general_table
            continue
        elif stripped.startswith("gBattleAnims_Special::"):
            current_table = special_table
            continue

        if current_table is not None:
            m = re.match(r"\s*\.4byte\s+(\w+)", stripped)
            if m:
                label = m.group(1)
                if label == "Move_COUNT":
                    current_table = None
                    continue
                current_table.append(label)
                continue
            # End of table on non-.4byte, non-empty, non-.align, non-comment line
            if stripped and not stripped.startswith(".align") and not stripped.startswith("@"):
                current_table = None

    # --- Pass 2: parse all labels and their commands ---
    labels = {}
    current_label = None
    current_commands = []

    for raw_line in lines:
        line = raw_line.strip()

        # Skip includes, section directives, .align, table entries
        if not line or line.startswith("#include") or line.startswith(".include"):
            continue
        if line.startswith(".section") or line.startswith(".align"):
            continue
        if line.startswith(".4byte") or line.startswith(".2byte"):
            continue

        # Label definition
        m = re.match(r"^(\w+):(?:\s*@.*)?$", line)
        if m:
            # Save previous label
            if current_label and current_commands:
                labels[current_label] = current_commands
            current_label = m.group(1)
            current_commands = []
            continue

        # Skip pure comments
        if line.startswith("@"):
            continue

        # Strip inline comments
        line = re.sub(r"\s*@.*$", "", line).strip()
        if not line:
            continue

        # Parse command
        cmd = parse_command(line)
        if cmd:
            current_commands.append(cmd)

    # Save last label
    if current_label and current_commands:
        labels[current_label] = current_commands

    return {
        "move_table": move_table,
        "status_table": status_table,
        "general_table": general_table,
        "special_table": special_table,
        "labels": labels,
    }


def parse_command(line: str) -> dict | None:
    """Parse a single assembly macro command into a dict."""
    # Split into command name and args
    m = re.match(r"(\w+)\s*(.*)", line)
    if not m:
        return None

    cmd_name = m.group(1)
    args_str = m.group(2).strip()

    # Split args on comma, respecting that some args may have spaces
    if args_str:
        args = [a.strip() for a in args_str.split(",")]
    else:
        args = []

    # Clean up arg values - strip ANIM_ prefix for readability where appropriate
    def clean_arg(a: str) -> str | int:
        # Try to parse as integer
        try:
            return int(a)
        except ValueError:
            pass
        # Try hex
        if a.startswith("0x") or a.startswith("0X"):
            try:
                return int(a, 16)
            except ValueError:
                pass
        # Signed values like +2, -5
        if re.match(r"^[+-]\d+$", a):
            return int(a)
        return a

    cleaned = [clean_arg(a) for a in args]

    # Build command dict based on command type
    if cmd_name == "loadspritegfx":
        return {"cmd": "loadspritegfx", "tag": args[0] if args else None}

    elif cmd_name == "unloadspritegfx":
        return {"cmd": "unloadspritegfx", "tag": args[0] if args else None}

    elif cmd_name == "createsprite":
        return {
            "cmd": "createsprite",
            "template": args[0] if len(args) > 0 else None,
            "battler": args[1] if len(args) > 1 else None,
            "subpriority": cleaned[2] if len(args) > 2 else None,
            "args": cleaned[3:],
        }

    elif cmd_name == "createvisualtask":
        return {
            "cmd": "createvisualtask",
            "func": args[0] if len(args) > 0 else None,
            "priority": cleaned[1] if len(args) > 1 else None,
            "args": cleaned[2:],
        }

    elif cmd_name == "delay":
        return {"cmd": "delay", "frames": cleaned[0] if cleaned else None}

    elif cmd_name in ("waitforvisualfinish", "blendoff", "end", "return",
                       "nop", "nop2", "restorebg", "waitbgfadeout",
                       "waitbgfadein", "waitsound", "splitbgprio_all",
                       "stopsound"):
        return {"cmd": cmd_name}

    elif cmd_name == "playse":
        return {"cmd": "playse", "se": args[0] if args else None}

    elif cmd_name == "playsewithpan":
        return {
            "cmd": "playsewithpan",
            "se": args[0] if len(args) > 0 else None,
            "pan": cleaned[1] if len(args) > 1 else None,
        }

    elif cmd_name == "loopsewithpan":
        return {
            "cmd": "loopsewithpan",
            "se": args[0] if len(args) > 0 else None,
            "pan": cleaned[1] if len(args) > 1 else None,
            "wait": cleaned[2] if len(args) > 2 else None,
            "times": cleaned[3] if len(args) > 3 else None,
        }

    elif cmd_name == "waitplaysewithpan":
        return {
            "cmd": "waitplaysewithpan",
            "se": args[0] if len(args) > 0 else None,
            "pan": cleaned[1] if len(args) > 1 else None,
            "wait": cleaned[2] if len(args) > 2 else None,
        }

    elif cmd_name in ("monbg", "clearmonbg", "monbg_static", "clearmonbg_static"):
        return {"cmd": cmd_name, "battler": args[0] if args else None}

    elif cmd_name == "setalpha":
        return {
            "cmd": "setalpha",
            "eva": cleaned[0] if len(cleaned) > 0 else None,
            "evb": cleaned[1] if len(cleaned) > 1 else None,
        }

    elif cmd_name == "call":
        return {"cmd": "call", "label": args[0] if args else None}

    elif cmd_name == "goto":
        return {"cmd": "goto", "label": args[0] if args else None}

    elif cmd_name == "setarg":
        return {
            "cmd": "setarg",
            "argId": cleaned[0] if len(cleaned) > 0 else None,
            "value": cleaned[1] if len(cleaned) > 1 else None,
        }

    elif cmd_name == "choosetwoturnanim":
        return {
            "cmd": "choosetwoturnanim",
            "label1": args[0] if len(args) > 0 else None,
            "label2": args[1] if len(args) > 1 else None,
        }

    elif cmd_name == "jumpifmoveturn":
        return {
            "cmd": "jumpifmoveturn",
            "value": cleaned[0] if len(cleaned) > 0 else None,
            "label": args[1] if len(args) > 1 else None,
        }

    elif cmd_name == "jumpargeq":
        return {
            "cmd": "jumpargeq",
            "argId": cleaned[0] if len(cleaned) > 0 else None,
            "value": cleaned[1] if len(cleaned) > 1 else None,
            "label": args[2] if len(args) > 2 else None,
        }

    elif cmd_name in ("jumpreteq", "jumprettrue", "jumpretfalse"):
        # Convenience macros that expand to jumpargeq
        if cmd_name == "jumpreteq":
            return {
                "cmd": "jumpargeq",
                "argId": "ARG_RET_ID",
                "value": cleaned[0] if len(cleaned) > 0 else None,
                "label": args[1] if len(args) > 1 else None,
            }
        elif cmd_name == "jumprettrue":
            return {
                "cmd": "jumpargeq",
                "argId": "ARG_RET_ID",
                "value": "TRUE",
                "label": args[0] if args else None,
            }
        elif cmd_name == "jumpretfalse":
            return {
                "cmd": "jumpargeq",
                "argId": "ARG_RET_ID",
                "value": "FALSE",
                "label": args[0] if args else None,
            }

    elif cmd_name in ("fadetobg", "changebg"):
        return {"cmd": cmd_name, "bg": args[0] if args else None}

    elif cmd_name == "fadetobgfromset":
        return {
            "cmd": "fadetobgfromset",
            "bgOpponent": args[0] if len(args) > 0 else None,
            "bgPlayer": args[1] if len(args) > 1 else None,
            "bgContest": args[2] if len(args) > 2 else None,
        }

    elif cmd_name == "setpan":
        return {"cmd": "setpan", "pan": cleaned[0] if cleaned else None}

    elif cmd_name in ("panse", "panse_adjustnone", "panse_adjustall"):
        return {
            "cmd": cmd_name,
            "se": args[0] if len(args) > 0 else None,
            "currentPan": cleaned[1] if len(cleaned) > 1 else None,
            "targetPan": cleaned[2] if len(cleaned) > 2 else None,
            "incrementPan": cleaned[3] if len(cleaned) > 3 else None,
            "delay": cleaned[4] if len(cleaned) > 4 else None,
        }

    elif cmd_name == "setbldcnt":
        return {"cmd": "setbldcnt", "bldcnt": cleaned[0] if cleaned else None}

    elif cmd_name == "createsoundtask":
        return {
            "cmd": "createsoundtask",
            "func": args[0] if len(args) > 0 else None,
            "args": cleaned[1:],
        }

    elif cmd_name in ("splitbgprio", "splitbgprio_foes"):
        return {"cmd": cmd_name, "battler": args[0] if args else None}

    elif cmd_name in ("invisible", "visible"):
        return {"cmd": cmd_name, "battler": args[0] if args else None}

    elif cmd_name in ("teamattack_moveback", "teamattack_movefwd"):
        return {"cmd": cmd_name, "battler": args[0] if args else None}

    elif cmd_name == "jumpifcontest":
        return {"cmd": "jumpifcontest", "label": args[0] if args else None}

    # Fallback: unknown command
    return {"cmd": cmd_name, "args": cleaned} if cleaned else {"cmd": cmd_name}


# ---------------------------------------------------------------------------
# 6. Inline subroutine calls for a flattened view
# ---------------------------------------------------------------------------

def resolve_animation(label: str, all_labels: dict, depth: int = 0) -> list[dict]:
    """Resolve a label into a flat list of commands, inlining call/goto."""
    if depth > 20 or label not in all_labels:
        return []

    result = []
    for cmd in all_labels[label]:
        if cmd["cmd"] == "call":
            sub_label = cmd["label"]
            result.extend(resolve_animation(sub_label, all_labels, depth + 1))
        elif cmd["cmd"] == "goto":
            sub_label = cmd["label"]
            result.extend(resolve_animation(sub_label, all_labels, depth + 1))
            break  # goto doesn't return
        else:
            result.append(cmd)
            if cmd["cmd"] == "end":
                break
    return result


# ---------------------------------------------------------------------------
# 7. Build sprite tag summary
# ---------------------------------------------------------------------------

def build_sprite_tags(
    anim_tags: dict[str, int],
    pic_table: dict[str, dict],
    pal_table: dict[str, str],
) -> dict[str, dict]:
    """Build a clean sprite tag lookup: tag_name -> {id, file, palette, size}."""
    result = {}
    for tag_name, tag_id in sorted(anim_tags.items(), key=lambda x: x[1]):
        entry = {"id": tag_id}
        pic = pic_table.get(tag_name)
        if pic:
            entry["file"] = pic["file"]
            entry["size"] = pic["size"]
        pal = pal_table.get(tag_name)
        if pal:
            entry["palette"] = pal
        # Only include tags that have actual sprite data
        if "file" in entry:
            result[tag_name] = entry
    return result


# ---------------------------------------------------------------------------
# 8. Collect which sprites and sounds each move uses
# ---------------------------------------------------------------------------

def collect_resources(commands: list[dict]) -> dict:
    """Extract sprite tags, sound effects, and backgrounds referenced by a command list."""
    sprites = set()
    sounds = set()
    backgrounds = set()
    for cmd in commands:
        if cmd["cmd"] == "loadspritegfx" and cmd.get("tag"):
            sprites.add(cmd["tag"])
        se = cmd.get("se")
        if se and isinstance(se, str) and se.startswith("SE_"):
            sounds.add(se)
        # Collect backgrounds from fadetobg, changebg, fadetobgfromset
        if cmd["cmd"] in ("fadetobg", "changebg"):
            bg = cmd.get("bg")
            if bg and isinstance(bg, str) and bg.startswith("BG_"):
                backgrounds.add(bg)
        elif cmd["cmd"] == "fadetobgfromset":
            for key in ("bgOpponent", "bgPlayer", "bgContest"):
                bg = cmd.get(key)
                if bg and isinstance(bg, str) and bg.startswith("BG_"):
                    backgrounds.add(bg)
    return {
        "sprites": sorted(sprites),
        "sounds": sorted(sounds),
        "backgrounds": sorted(backgrounds),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("Parsing ANIM_TAG constants...")
    anim_tags = parse_anim_tags(CONSTANTS_FILE)
    print(f"  {len(anim_tags)} tags")

    print("Parsing graphics.c INCBIN...")
    gfx_to_file = parse_graphics_incbin(GRAPHICS_C)
    print(f"  {len(gfx_to_file)} sprite graphics")

    pal_to_file = parse_palette_incbin(GRAPHICS_C)
    print(f"  {len(pal_to_file)} sprite palettes")

    print("Parsing sprite sheet table...")
    pic_table = parse_pic_table(DATA_ANIM_H, gfx_to_file)
    print(f"  {len(pic_table)} entries")

    print("Parsing palette table...")
    pal_table = parse_pal_table(DATA_ANIM_H, pal_to_file)
    print(f"  {len(pal_table)} entries")

    print("Parsing background constants...")
    bg_constants = parse_bg_constants(CONSTANTS_FILE)
    print(f"  {len(bg_constants)} BG_* constants")

    print("Parsing background INCBIN...")
    bg_var_to_file = parse_bg_incbin(GRAPHICS_C)
    print(f"  {len(bg_var_to_file)} background assets")

    print("Parsing background table...")
    bg_table = parse_bg_table(DATA_ANIM_H, bg_var_to_file)
    print(f"  {len(bg_table)} entries")

    print("Parsing animation scripts...")
    scripts = parse_anim_scripts(SCRIPTS_FILE)
    print(f"  {len(scripts['move_table'])} moves")
    print(f"  {len(scripts['status_table'])} status conditions")
    print(f"  {len(scripts['general_table'])} general animations")
    print(f"  {len(scripts['special_table'])} special animations")
    print(f"  {len(scripts['labels'])} total labels")

    # Build sprite tag info
    sprite_tags = build_sprite_tags(anim_tags, pic_table, pal_table)

    # Build background info
    backgrounds = build_backgrounds(bg_constants, bg_table)

    # Build move animations with inlined subroutines
    print("Resolving animations...")

    def build_anim_entry(label, name):
        flat = resolve_animation(label, scripts["labels"])
        resources = collect_resources(flat)
        entry = {
            "name": name,
            "label": label,
            "commands": scripts["labels"].get(label, []),
            "sprites": resources["sprites"],
            "sounds": resources["sounds"],
        }
        if resources["backgrounds"]:
            entry["backgrounds"] = resources["backgrounds"]
        return entry

    move_anims = {}
    for i, label in enumerate(scripts["move_table"]):
        move_name = label.replace("Move_", "")
        move_anims[str(i)] = build_anim_entry(label, move_name)

    status_anims = {}
    status_names = [
        "POISON", "CONFUSION", "BURN", "INFATUATION",
        "SLEEP", "PARALYSIS", "FREEZE", "CURSE", "NIGHTMARE",
    ]
    for i, label in enumerate(scripts["status_table"]):
        name = status_names[i] if i < len(status_names) else label.replace("Status_", "")
        status_anims[str(i)] = build_anim_entry(label, name)

    general_anims = {}
    for i, label in enumerate(scripts["general_table"]):
        general_anims[str(i)] = build_anim_entry(label, label.replace("General_", ""))

    special_anims = {}
    for i, label in enumerate(scripts["special_table"]):
        special_anims[str(i)] = build_anim_entry(label, label.replace("Special_", ""))

    # Include subroutine labels (referenced by call/goto but not in any table)
    table_labels = set(scripts["move_table"] + scripts["status_table"] +
                       scripts["general_table"] + scripts["special_table"])
    subroutines = {}
    for label, commands in scripts["labels"].items():
        if label not in table_labels:
            subroutines[label] = commands

    # Contest move variants: moves with jumpifcontest branch to a different label
    contest_move_anims = {}
    for move_id_str, entry in move_anims.items():
        for cmd in entry["commands"]:
            if cmd.get("cmd") == "jumpifcontest" and cmd.get("label"):
                contest_label = cmd["label"]
                if contest_label in scripts["labels"]:
                    contest_move_anims[move_id_str] = build_anim_entry(
                        contest_label, entry["name"] + "_Contest"
                    )
                break

    output = {
        "spriteTags": sprite_tags,
        "backgrounds": backgrounds,
        "moves": move_anims,
        "contestMoves": contest_move_anims,
        "status": status_anims,
        "general": general_anims,
        "special": special_anims,
        "subroutines": subroutines,
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    # Summary stats
    total_anims = len(move_anims) + len(status_anims) + len(general_anims) + len(special_anims)
    moves_with_bg = sum(1 for m in move_anims.values() if m.get("backgrounds"))
    print(f"\nWrote {OUTPUT_FILE}")
    print(f"  {total_anims} animations ({len(move_anims)} moves, {len(status_anims)} status, "
          f"{len(general_anims)} general, {len(special_anims)} special)")
    print(f"  {len(subroutines)} subroutines")
    print(f"  {len(sprite_tags)} sprite tags with files")
    print(f"  {len(backgrounds)} backgrounds ({moves_with_bg} moves use backgrounds)")


if __name__ == "__main__":
    main()
