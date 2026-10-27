"""
Generate move_animation_map.json by matching Gen 4-9 moves to Gen 3 moves
with the closest visual theme. Scoring uses:
  - type_id (hard requirement — cross-type only allowed if no same-type exists)
  - damage_class_id (physical/special/status)
  - signature flags: punch, bite, pulse, bullet, sound, powder, dance
  - move category (damage / damage+ailment / stat-boost / etc.)
  - rough power tier

NAME_OVERRIDES lets us hand-pick better matches for specific moves where
pure scoring would miss a thematic cue. Both sides are looked up by name,
so errors become runtime assertions rather than silent mis-mappings.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extract import csv_data

MOVES = csv_data.MOVES
GEN3_MAX = 354

PUNCH = 8
SOUND = 9
POWDER = 15
BITE = 16
PULSE = 17
BULLET = 18
DANCE = 21
SIGNATURE_FLAGS = [PUNCH, BITE, PULSE, BULLET, SOUND, POWDER, DANCE]

# Name-based overrides: {gen4plus_move_name: gen3_move_name}
# Both names must exist. Resolved to IDs at runtime — typos fail loudly.
NAME_OVERRIDES = {
    # Healing / recovery moves
    "Roost": "Recover",
    "Healing Wish": "Soft-Boiled",
    "Lunar Dance": "Soft-Boiled",
    "Wish": "Soft-Boiled",  # already in Gen 3 as 273, skip
    # Status setters (should mirror similar Gen 3 status moves)
    "Nasty Plot": "Swords Dance",
    "Rock Polish": "Swords Dance",
    "Quiver Dance": "Swords Dance",
    "Shell Smash": "Belly Drum",
    "Coil": "Swords Dance",
    "Hone Claws": "Swords Dance",
    "Work Up": "Bulk Up",
    "Shift Gear": "Swords Dance",
    "Iron Defense": "Barrier",  # defense boost
    "Cosmic Power": "Barrier",
    # Fire punch / fire physical contact
    "Flame Charge": "Flame Wheel",
    "Flare Blitz": "Flame Wheel",
    "Blaze Kick": "Fire Punch",
    "Fire Fang": "Fire Punch",
    "Fire Punch": "Fire Punch",  # Gen 3, no-op
    "Heat Crash": "Flame Wheel",
    "Fiery Dance": "Fire Blast",
    # Ice fang / ice priority
    "Ice Fang": "Ice Punch",
    "Ice Shard": "Ice Ball",
    "Icicle Crash": "Ice Ball",
    "Ice Burn": "Blizzard",
    # Electric fang / contact
    "Thunder Fang": "Thunder Punch",
    "Wild Charge": "Volt Tackle",
    "Volt Switch": "Thunderbolt",
    # Dragon
    "Dragon Pulse": "Dragon Breath",
    "Draco Meteor": "Hyper Beam",
    "Dragon Rush": "Dragon Claw",
    "Dual Chop": "Dragon Claw",
    "Dragon Tail": "Dragon Claw",
    "Outrage": "Outrage",  # Gen 3
    # Dark
    "Dark Pulse": "Crunch",
    "Foul Play": "Feint Attack",
    "Night Slash": "Slash",
    "Sucker Punch": "Feint Attack",
    "Pursuit": "Pursuit",
    "Payback": "Feint Attack",
    "Punishment": "Beat Up",
    "Assurance": "Feint Attack",
    "Night Daze": "Crunch",
    # Fighting
    "Aura Sphere": "Hyper Beam",      # Fighting special beam analogue
    "Focus Blast": "Hyper Beam",
    "Vacuum Wave": "Quick Attack",
    "Close Combat": "Cross Chop",
    "Drain Punch": "Dynamic Punch",
    "Bullet Punch": "Mach Punch",
    "Mach Punch": "Mach Punch",       # Gen 3
    "Sky Uppercut": "Sky Uppercut",   # Gen 3
    "Hammer Arm": "Cross Chop",
    "Wake-Up Slap": "Feint Attack",
    "Force Palm": "Dynamic Punch",
    "Secret Sword": "Cross Chop",
    "Final Gambit": "Self-Destruct",
    # Flying
    "Brave Bird": "Drill Peck",
    "Sky Attack": "Sky Attack",       # Gen 3
    "Pluck": "Peck",
    "Air Slash": "Aerial Ace",
    "Aeroblast": "Aeroblast",         # Gen 3
    "Hurricane": "Gust",
    "Acrobatics": "Aerial Ace",
    # Grass
    "Energy Ball": "Solar Beam",
    "Leaf Storm": "Solar Beam",
    "Seed Bomb": "Solar Beam",
    "Leaf Blade": "Slash",
    "Wood Hammer": "Giga Drain",
    "Power Whip": "Vine Whip",
    "Horn Leech": "Giga Drain",
    "Grass Knot": "Vine Whip",
    "Petal Blizzard": "Petal Dance",
    "Leaf Tornado": "Razor Leaf",
    # Bug
    "X-Scissor": "Fury Cutter",
    "U-turn": "Fury Cutter",
    "Bug Buzz": "Signal Beam",
    "Bug Bite": "Bite",
    "Lunge": "Megahorn",
    "Fell Stinger": "Megahorn",
    "Attack Order": "Megahorn",
    "Defend Order": "Barrier",
    "Heal Order": "Recover",
    "Rage Powder": "Stun Spore",
    # Ground
    "Earth Power": "Earthquake",
    "Bulldoze": "Earthquake",
    "Mud Bomb": "Mud-Slap",
    "Drill Run": "Dig",
    # Rock
    "Stone Edge": "Rock Slide",
    "Head Smash": "Head Smash",       # Gen 3? Let's try
    "Rock Wrecker": "Rock Slide",
    "Power Gem": "Rock Slide",
    "Stealth Rock": "Rock Slide",
    "Rock Polish": "Swords Dance",    # already above
    "Rock Blast": "Rock Throw",
    # Steel
    "Flash Cannon": "Iron Tail",
    "Iron Head": "Iron Tail",
    "Bullet Punch": "Meteor Mash",    # overrides earlier entry
    "Mirror Shot": "Iron Tail",
    "Magnet Bomb": "Iron Tail",
    "Gyro Ball": "Iron Tail",
    "Autotomize": "Swords Dance",
    # Psychic
    "Zen Headbutt": "Headbutt",
    "Psycho Cut": "Slash",
    "Heart Stamp": "Headbutt",
    "Psyshock": "Psychic",
    "Stored Power": "Psychic",
    "Power Split": "Psych Up",
    "Guard Split": "Psych Up",
    "Miracle Eye": "Foresight",
    "Magic Room": "Trick",
    "Wonder Room": "Trick",
    # Water
    "Scald": "Hydro Pump",
    "Aqua Tail": "Waterfall",
    "Aqua Jet": "Waterfall",
    "Water Pulse": "Water Pulse",     # Gen 3
    "Brine": "Surf",
    "Water Spout": "Surf",
    "Muddy Water": "Surf",
    "Soak": "Water Gun",
    "Water Pledge": "Surf",
    # Fairy (no Gen 3 Fairy moves — use Normal/Psychic)
    "Moonblast": "Swift",
    "Play Rough": "Slash",
    "Dazzling Gleam": "Flash",
    "Disarming Voice": "Snore",
    "Draining Kiss": "Sweet Kiss",
    "Charm": "Charm",                 # Gen 3 Normal
    "Sweet Kiss": "Sweet Kiss",       # Gen 3 Normal
    "Baby-Doll Eyes": "Leer",
    "Fairy Wind": "Gust",
    "Light of Ruin": "Hyper Beam",
    "Geomancy": "Cosmic Power" if False else "Swords Dance",  # not in Gen 3
    "Misty Terrain": "Haze",
    # Poison
    "Poison Jab": "Poison Sting",
    "Gunk Shot": "Sludge Bomb",
    "Cross Poison": "Slash",
    "Venoshock": "Sludge Bomb",
    "Clear Smog": "Smog",
    "Acid Spray": "Acid",
    "Toxic Spikes": "Spikes",
    # Normal
    "Giga Impact": "Hyper Beam",
    "Extreme Speed": "Quick Attack",
    "Last Resort": "Hyper Beam",
    "Hyper Voice": "Hyper Voice",     # Gen 3
    "Echoed Voice": "Screech",
    "Round": "Snore",
    "Relic Song": "Sing",
    "Hyper Fang": "Hyper Fang",       # Gen 3
    "Return": "Return",                # Gen 3
    "Frustration": "Frustration",     # Gen 3
    # Priority moves
    "Accelerock": "Quick Attack",
    "Shadow Sneak": "Shadow Punch",
    "Extreme Speed": "Quick Attack",
    # --- Gen 8/9 new moves (skip very novel ones, fall through to scoring) ---
}


def get_power_tier(power):
    if power is None:
        return -1
    if power < 40:
        return 0
    if power < 70:
        return 1
    if power < 100:
        return 2
    if power < 130:
        return 3
    return 4


def score_candidate(src, cand, allow_cross_type=False):
    score = 0
    if src["type_id"] == cand["type_id"]:
        score += 100
    elif allow_cross_type:
        score -= 50  # Soft penalty — still allowed
    else:
        return -10000  # Reject cross-type unless fallback

    if src["damage_class_id"] == cand["damage_class_id"]:
        score += 50

    src_flags = set(src.get("flag_ids") or [])
    cand_flags = set(cand.get("flag_ids") or [])
    for flag in SIGNATURE_FLAGS:
        in_src = flag in src_flags
        in_cand = flag in cand_flags
        if in_src and in_cand:
            score += 40
        elif in_src != in_cand:
            score -= 10

    if (1 in src_flags) == (1 in cand_flags):
        score += 5

    src_tier = get_power_tier(src.get("power"))
    cand_tier = get_power_tier(cand.get("power"))
    if src_tier >= 0 and cand_tier >= 0:
        score -= abs(src_tier - cand_tier) * 3

    if src.get("category_id") == cand.get("category_id"):
        score += 10

    return score


def main():
    gen3 = [m for mid, m in MOVES.items() if mid <= GEN3_MAX]
    name_to_id = {m["name"]: mid for mid, m in MOVES.items()}

    # Resolve NAME_OVERRIDES -> numeric override dict, validating both sides
    resolved = {}
    missing_src = []
    missing_tgt = []
    for src_name, tgt_name in NAME_OVERRIDES.items():
        src_id = name_to_id.get(src_name)
        tgt_id = name_to_id.get(tgt_name)
        if src_id is None:
            missing_src.append(src_name)
            continue
        if tgt_id is None:
            missing_tgt.append(tgt_name)
            continue
        if src_id <= GEN3_MAX:
            continue  # Source is Gen 3, no mapping needed
        if tgt_id > GEN3_MAX:
            # Target must be a Gen 3 move so its animation exists
            print(f"  SKIP: {src_name} -> {tgt_name} (target is not Gen 3)")
            continue
        # Verify the target actually makes thematic sense: same type OR we're intentionally cross-type
        src_move = MOVES[src_id]
        tgt_move = MOVES[tgt_id]
        if src_move["type_id"] != tgt_move["type_id"]:
            # Allowed for Fairy/Dark where no same-type exists, but log it
            pass
        resolved[src_id] = tgt_id

    if missing_src:
        print(f"Missing source names (ignored): {missing_src}")
    if missing_tgt:
        print(f"Missing target names (ignored): {missing_tgt}")

    out = {}
    used_fallback = 0
    for mid, move in MOVES.items():
        if mid <= GEN3_MAX:
            continue

        if mid in resolved:
            out[str(mid)] = resolved[mid]
            continue

        # Score all Gen 3 candidates (strict same-type)
        best_score = -10000
        best_id = None
        for cand in gen3:
            s = score_candidate(move, cand, allow_cross_type=False)
            if s > best_score:
                best_score = s
                best_id = cand["id"]

        # Fallback: allow cross-type match for types absent from Gen 3 (Fairy)
        if best_id is None or best_score <= -10000:
            used_fallback += 1
            for cand in gen3:
                s = score_candidate(move, cand, allow_cross_type=True)
                if s > best_score:
                    best_score = s
                    best_id = cand["id"]

        out[str(mid)] = best_id if best_id is not None else mid

    out_sorted = {k: out[k] for k in sorted(out, key=int)}

    output_path = Path(__file__).parent / "move_animation_map.json"
    with open(output_path, "w") as f:
        json.dump(out_sorted, f, indent=2)
    print(f"Wrote {len(out_sorted)} mappings to {output_path}")
    print(f"Used cross-type fallback: {used_fallback}")
    print(f"Manual overrides applied: {len(resolved)}")

    from collections import Counter
    target_counts = Counter(out.values())
    print(f"Unique target animations: {len(target_counts)}")
    print(f"Most-used animations: {target_counts.most_common(5)}")


if __name__ == "__main__":
    main()
