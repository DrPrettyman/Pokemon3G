#!/usr/bin/env python3
"""
Build item icon sprites by applying JASC palettes to indexed PNGs from the
pokeemerald / pokefirered decomp assets.

For each item in our data, produces a 24x24 RGBA PNG with index 0 as transparent.
Output: extracted-assets/sprites/item/<identifier>.png
"""

import os
import sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from paths import ITEM_SPRITES_RAW, SPRITES_DIR

from extract import csv_data

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
EMERALD = os.path.join(ITEM_SPRITES_RAW, "emerald")
FIRERED = os.path.join(ITEM_SPRITES_RAW, "firered")
OUTPUT_DIR = os.path.join(SPRITES_DIR, "item")

# ---------------------------------------------------------------------------
# Palette-only → icon template mapping
# When a .pal has no matching .png, which icon file does it use?
# ---------------------------------------------------------------------------
PALETTE_TO_ICON = {
    # Status heals
    "awakening": "status_heal",
    "burn_heal": "status_heal",
    "ice_heal": "status_heal",
    "paralyze_heal": "status_heal",
    # Potions (large bottle shape)
    "full_restore": "large_potion",
    "hyper_potion": "large_potion",
    "max_potion": "large_potion",
    "super_potion": "large_potion",
    # Ethers / Elixirs
    "elixir": "ether",
    "max_elixir": "ether",
    "max_ether": "ether",
    # Repels
    "max_repel": "repel",
    "super_repel": "repel",
    # Vitamins
    "calcium": "vitamin",
    "carbos": "vitamin",
    "iron": "vitamin",
    "protein": "vitamin",
    "zinc": "vitamin",
    # Battle stat items
    "dire_hit": "battle_stat_item",
    "guard_spec": "battle_stat_item",
    "x_accuracy": "battle_stat_item",
    "x_attack": "battle_stat_item",
    "x_defend": "battle_stat_item",
    "x_special": "battle_stat_item",
    "x_speed": "battle_stat_item",
    # Flutes
    "black_flute": "flute",
    "blue_flute": "flute",
    "red_flute": "flute",
    "white_flute": "flute",
    "yellow_flute": "flute",
    # Scarves
    "blue_scarf": "scarf",
    "green_scarf": "scarf",
    "pink_scarf": "scarf",
    "red_scarf": "scarf",
    "yellow_scarf": "scarf",
    # Shards
    "blue_shard": "shard",
    "green_shard": "shard",
    "red_shard": "shard",
    "yellow_shard": "shard",
    # Orbs
    "blue_orb": "orb",
    "red_orb": "orb",
    # Herbs
    "mental_herb": "in_battle_herb",
    "white_herb": "in_battle_herb",
    # Powders
    "energy_powder": "powder",
    "heal_powder": "powder",
    # Fossils
    "hoenn_fossil": "root_fossil",
    "kanto_fossil": "helix_fossil",
    # Gems
    "ruby": "gem",
    "sapphire": "gem",
    # Misc
    "mushroom": "tiny_mushroom",
    "shell": "shoal_shell",
    "shoal_salt": "shoal_shell",
    "star": "star_piece",
    "key": "basement_key",
    "old_key": "basement_key",
    "lava_cookie_and_letter": "lava_cookie",
    "black_type_enhancing_item": "black_glasses",
    # TMs / HMs — all use tm_hm (firered) or tm/hm (emerald)
    "dark_tm_hm": "tm_hm",
    "dragon_tm_hm": "tm_hm",
    "electric_tm_hm": "tm_hm",
    "fighting_tm_hm": "tm_hm",
    "fire_tm_hm": "tm_hm",
    "flying_tm_hm": "tm_hm",
    "ghost_tm_hm": "tm_hm",
    "grass_tm_hm": "tm_hm",
    "ground_tm_hm": "tm_hm",
    "ice_tm_hm": "tm_hm",
    "normal_tm_hm": "tm_hm",
    "poison_tm_hm": "tm_hm",
    "psychic_tm_hm": "tm_hm",
    "rock_tm_hm": "tm_hm",
    "steel_tm_hm": "tm_hm",
    "water_tm_hm": "tm_hm",
}

# ---------------------------------------------------------------------------
# Decomp palette name → veekun item identifier(s)
# Most map by simple underscore→hyphen, but some need explicit overrides.
# ---------------------------------------------------------------------------
DECOMP_TO_IDENTIFIER = {
    # Fossils have decomp-specific names
    "hoenn_fossil": None,       # ambiguous — handled per-game below
    "kanto_fossil": None,       # ambiguous
    "claw_fossil": "claw-fossil",
    "root_fossil": "root-fossil",
    "dome_fossil": "dome-fossil",
    "helix_fossil": "helix-fossil",
    "old_amber": "old-amber",
    # Multi-item palettes
    "lava_cookie_and_letter": None,  # skip — lava_cookie has its own
    # Type enhancers with different decomp names
    "black_type_enhancing_item": None,  # black_glasses has its own icon+pal
    # TMs/HMs handled separately
    # Items that exist as icons but not in our Gen 3 data
    "question_mark": None,
    "return_to_field_arrow": None,
    "berry_pouch": None,
    "tm_case": None,
    "fame_checker": None,
    "teachy_tv": None,
    "vs_seeker": None,
    "powder_jar": None,
    "contest_pass": None,
    "pokeblock_case": None,
    "magma_emblem": None,
    "old_sea_map": None,
}


def parse_jasc_pal(path):
    """Parse a JASC-PAL file into a list of (R, G, B) tuples."""
    with open(path) as f:
        lines = f.read().strip().split("\n")
    assert lines[0] == "JASC-PAL", f"Not a JASC-PAL file: {path}"
    count = int(lines[2])
    colors = []
    for i in range(count):
        parts = lines[3 + i].split()
        colors.append((int(parts[0]), int(parts[1]), int(parts[2])))
    return colors


def apply_palette(icon_path, pal_path):
    """
    Load an indexed PNG, replace its palette with a JASC .pal file,
    and return an RGBA image with index 0 as transparent.
    """
    img = Image.open(icon_path)
    assert img.mode == "P", f"Expected indexed image, got {img.mode}: {icon_path}"

    palette = parse_jasc_pal(pal_path)
    indices = np.array(img)

    # Build RGBA output
    h, w = indices.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    for idx, (r, g, b) in enumerate(palette):
        mask = indices == idx
        rgba[mask] = [r, g, b, 255 if idx != 0 else 0]

    return Image.fromarray(rgba, "RGBA")


def apply_embedded_palette(icon_path):
    """Load an indexed PNG and convert to RGBA with index 0 as transparent."""
    img = Image.open(icon_path)
    if img.mode == "P":
        pal = img.getpalette()
        indices = np.array(img)
        h, w = indices.shape
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        num_colors = len(pal) // 3
        for idx in range(num_colors):
            mask = indices == idx
            r, g, b = pal[idx * 3], pal[idx * 3 + 1], pal[idx * 3 + 2]
            rgba[mask] = [r, g, b, 255 if idx != 0 else 0]
        return Image.fromarray(rgba, "RGBA")
    else:
        return img.convert("RGBA")


def find_icon(name, game_dir, fallback_dir=None):
    """Find icon PNG by name, checking game_dir then fallback_dir."""
    p = os.path.join(game_dir, "icons", name + ".png")
    if os.path.exists(p):
        return p
    if fallback_dir:
        p = os.path.join(fallback_dir, "icons", name + ".png")
        if os.path.exists(p):
            return p
    return None


def find_palette(name, game_dir, fallback_dir=None):
    """Find palette file by name, checking game_dir then fallback_dir."""
    p = os.path.join(game_dir, "icon_palettes", name + ".pal")
    if os.path.exists(p):
        return p
    if fallback_dir:
        p = os.path.join(fallback_dir, "icon_palettes", name + ".pal")
        if os.path.exists(p):
            return p
    return None


# Veekun identifier → decomp filename for items where simple hyphen→underscore fails
IDENTIFIER_TO_DECOMP = {
    "x-defense": "x_defend",
    "x-sp-atk": "x_special",
    "dowsing-machine": "itemfinder",
    "rm-1-key": "room1_key",
    "rm-2-key": "room2_key",
    "rm-4-key": "room4_key",
    "rm-6-key": "room6_key",
    "mysticticket": "mystic_ticket",
    "auroraticket": "aurora_ticket",
}


def decomp_name_to_identifier(name):
    """Convert a decomp filename to a veekun identifier (underscore → hyphen)."""
    if name in DECOMP_TO_IDENTIFIER:
        return DECOMP_TO_IDENTIFIER[name]
    return name.replace("_", "-")


def icon_name_for_palette(pal_name, game_dir, fallback_dir=None):
    """Determine which icon PNG to use for a given palette name."""
    # Direct match?
    icon = find_icon(pal_name, game_dir, fallback_dir)
    if icon:
        return pal_name, icon
    # Explicit mapping?
    if pal_name in PALETTE_TO_ICON:
        mapped = PALETTE_TO_ICON[pal_name]
        icon = find_icon(mapped, game_dir, fallback_dir)
        if icon:
            return mapped, icon
    return None, None


def build_tm_hm_mapping():
    """
    Build mapping: veekun item identifier → decomp palette name for TMs/HMs.
    TM palettes are named by type: fighting_tm_hm, dragon_tm_hm, etc.
    """
    type_names = csv_data.ID_TO_NAME["types"]
    mapping = {}
    for machine_num, m in csv_data.MACHINES.items():
        move = csv_data.MOVES[m["move_id"]]
        type_id = move["type_id"]
        type_name = type_names[type_id].lower()
        item = csv_data.ITEMS[m["item_id"]]
        pal_name = f"{type_name}_tm_hm"
        mapping[item["identifier"]] = (pal_name, machine_num > 100)
    return mapping


def build_identifier_index():
    """Build index of all Gen 3 item identifiers for matching."""
    return {item["identifier"]: item_id for item_id, item in csv_data.ITEMS.items()}


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    identifier_index = build_identifier_index()
    tm_hm_map = build_tm_hm_mapping()

    # Collect all available palette names across both games
    pal_names = set()
    for game in (EMERALD, FIRERED):
        pal_dir = os.path.join(game, "icon_palettes")
        if os.path.exists(pal_dir):
            for f in os.listdir(pal_dir):
                if f.endswith(".pal"):
                    pal_names.add(f[:-4])

    # Also collect icon names (some have no palette file — use embedded palette)
    icon_names = set()
    for game in (EMERALD, FIRERED):
        icon_dir = os.path.join(game, "icons")
        if os.path.exists(icon_dir):
            for f in os.listdir(icon_dir):
                if f.endswith(".png"):
                    icon_names.add(f[:-4])

    all_decomp_names = pal_names | icon_names

    # Track results
    matched = 0
    unmatched_items = []
    produced = {}  # identifier → output path

    # --- Pass 1: Process TMs/HMs (special mapping) ---
    for identifier, (pal_name, is_hm) in tm_hm_map.items():
        pal_path = find_palette(pal_name, EMERALD, FIRERED)
        if not pal_path:
            unmatched_items.append(f"TM/HM {identifier}: no palette {pal_name}")
            continue

        # Emerald has separate tm.png and hm.png; firered has tm_hm.png
        if is_hm:
            icon_path = find_icon("hm", EMERALD) or find_icon("tm_hm", FIRERED)
        else:
            icon_path = find_icon("tm", EMERALD) or find_icon("tm_hm", FIRERED)

        if not icon_path:
            unmatched_items.append(f"TM/HM {identifier}: no icon")
            continue

        img = apply_palette(icon_path, pal_path)
        out_path = os.path.join(OUTPUT_DIR, f"{identifier}.png")
        img.save(out_path)
        produced[identifier] = out_path
        matched += 1

    # --- Pass 2: Process all other items ---
    for item_id, item in sorted(csv_data.ITEMS.items()):
        identifier = item["identifier"]

        # Skip TMs/HMs (already handled)
        if identifier in produced:
            continue

        decomp_name = IDENTIFIER_TO_DECOMP.get(identifier, identifier.replace("-", "_"))

        # Try to find palette
        pal_path = find_palette(decomp_name, EMERALD, FIRERED)

        if pal_path:
            # Has a palette — find the icon to pair it with
            icon_template, icon_path = icon_name_for_palette(
                decomp_name, EMERALD, FIRERED
            )
            if icon_path:
                img = apply_palette(icon_path, pal_path)
                out_path = os.path.join(OUTPUT_DIR, f"{identifier}.png")
                img.save(out_path)
                produced[identifier] = out_path
                matched += 1
                continue

        # No palette — try icon with embedded palette
        icon_path = find_icon(decomp_name, EMERALD, FIRERED)
        if icon_path:
            img = apply_embedded_palette(icon_path)
            out_path = os.path.join(OUTPUT_DIR, f"{identifier}.png")
            img.save(out_path)
            produced[identifier] = out_path
            matched += 1
            continue

        unmatched_items.append(f"{item_id}: {identifier}")

    # --- Pass 3: Items from icons not yet matched (decomp names ≠ veekun names) ---
    # Check remaining icons that might map to unmatched items via identifier conversion
    remaining_identifiers = set(identifier_index.keys()) - set(produced.keys())

    print(f"\nProduced: {matched} item icons")
    print(f"Total items in data: {len(csv_data.ITEMS)}")
    print(f"Remaining unmatched: {len(remaining_identifiers)}")

    if unmatched_items:
        print(f"\nUnmatched items ({len(unmatched_items)}):")
        for u in sorted(unmatched_items):
            print(f"  {u}")

    # Show coverage by pocket
    print("\nCoverage by pocket:")
    pocket_stats = {}
    for item_id, item in csv_data.ITEMS.items():
        pid = item["pocket_id"]
        pname = item["pocket"]
        if pid not in pocket_stats:
            pocket_stats[pid] = {"name": pname, "total": 0, "matched": 0}
        pocket_stats[pid]["total"] += 1
        if item["identifier"] in produced:
            pocket_stats[pid]["matched"] += 1
    for pid in sorted(pocket_stats):
        s = pocket_stats[pid]
        print(f"  {s['name']:15s}: {s['matched']:3d}/{s['total']:3d}")


if __name__ == "__main__":
    main()
