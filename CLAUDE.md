Read README.md and plan.md for context.

# Pokemon3G

Pokemon data extraction pipeline covering **Generations 1-9** (~1024 species, ~917 moves, 18 types, ~304 abilities, ~2175 items). Reads PokeAPI CSV files (originally from veekun), gates species/forms by DS-style sprite availability, and produces structured Python dicts and a compact JSON module for npm.

The battle engine uses **Gen 3 core mechanics** with **per-move physical/special split** (Gen 4+ rules) plus wired Gen 4-9 overlays: abilities (~40 query functions), ability-triggered form changes (Zen Mode, Shields Down, Disguise, Schooling, Stance Change, Battle Bond), terrain (Electric/Grassy/Psychic/Misty), and primal weather (Heavy Rain, Harsh Sun, Strong Winds). Megas are included; Gmax and Terastallization are excluded.

## Project Structure

```
python-scripts/
  paths.py                          # Shared path constants for all modules
  extract/                          # CSV extraction and data processing
    csv_data.py                     # build_xxx() functions + module-level constants (POKEMON, MOVES, etc.)
    item_effects.json               # Hand-curated structured effects for items (~453 items)
    ability_effects.json            # Structured ability effects for the battle engine (304 abilities)
    move_animation_map.json         # Maps Gen 4-9 move IDs to Gen 3 animation IDs (563 mappings)
    generate_move_animations.py     # Rebuilds move_animation_map.json via scoring + manual overrides
    download_cries.py               # Downloads Pokemon cry mp3s from Pokemon Showdown (parallel, idempotent)
    download_move_sfx.py            # Downloads Gen 3 move SFX mp3s from khinsider (128 SE_M_* cues, idempotent)
    evolution_remappings.json       # Remaps non-Gen-3 evolution methods to compatible equivalents
    item_notes.md                   # Detailed notes on item categories and codification plans
  generate/                         # Scripts that produce output files
    data_json.py                    # Produces pokedata3g/src/data.json from csv_data
    item_icons.py                   # Builds item icon sprites from decomp assets
    battle_anims.py                 # Extracts battle animations from decomp into JSON
    contest_sprites.py              # Copies contest UI graphics from decomp
    move_sounds.py                  # Copies move SFX mp3s into battle-playground + emits sound_index.json
  raw-assets/                       # Input data (read-only sources of truth)
    pokeapi-csv/                    # PokeAPI CSV data (Gen 1-9)
    ds-style-sprites/               # DS-style Pokemon sprites (all gens) + processed_sprites.csv
    pokesprite-items/               # Item icon sprites organized by category (878 icons)
    pokemon-cries/                  # Cry mp3s from Pokemon Showdown (1024 files, ~11 MB)
    move-sfx/                       # Gen 3 move SFX mp3s from khinsider (128 SE_M_* cues, ~23 MB)
    item-sprites-raw/               # Decomp item icon assets (emerald, firered)
    decomp-hacks/                   # Full decomp repos (emerald, firered)
  extracted-assets/                 # Generated/extracted asset outputs
    sprites/                        # Pokemon sprite PNGs (footprint)
    battle_anims.json               # Extracted battle animation data
    tm_crafting.json                # SV TM crafting recipes (parsed from Serebii)
pokedata3g/                         # npm module output (TypeScript + JSON + sprites)
pokedex.ipynb                       # Jupyter notebook for interactive exploration
setup.py                            # Downloads PokeAPI CSVs from GitHub
plan.md                             # Project status and remaining work
```

## Key Conventions

### Sprite Gating
Species and forms are gated by `python-scripts/raw-assets/ds-style-sprites/processed_sprites.csv`. Only Pokemon/forms with entries in this file are included. Gmax forms and Terapagos are excluded at load time.

### Data Scope
- **Species**: ~1024 (all Gen 1-9 with DS-style sprites, minus Terapagos)
- **Moves**: ~917 (all Gen 1-9, minus Tera Blast/Tera Starstorm)
- **Types**: 18 (includes Fairy; excludes Stellar)
- **Abilities**: ~304 (all Gen 1-9, minus Tera Shift/Shell/Teraform Zero; Teravolt kept)
- **Items**: ~2175 (all items from PokeAPI; ~453 with structured effects)
- **Berries**: 64 (all gens)
- **TMs/HMs**: Gen 3 only (58 entries). Gen 4-9 Pokemon get native teachable moves via `teachable_moves`
- **TM Crafting**: 202 Scarlet/Violet recipes with move ID, LP cost, and material item IDs
- **Locations/Encounters**: Gen 3 only (Kanto + Hoenn)
- **Per-move physical/special split** via `damage_class_id` on each move
- **Move pools**: Each Pokemon gets moves from its **latest generation** only (not accumulated across all gens). Spinoff VGs (Colosseum, XD, Let's Go, BDSP, Legends Arceus) are excluded.
- English language: `local_language_id == 9`
- Flavor text: latest available version for each entity

### Data Architecture
- `python-scripts/extract/csv_data.py` contains all `build_xxx()` functions (each reads CSVs, merges English names/prose, returns `dict[int, dict]` keyed by primary ID) and module-level constants (`POKEMON`, `MOVES`, `TYPES`, `NATURES`, `ABILITIES`, `ITEMS`, `BERRIES`, `STATS`, `MACHINES`, `TM_CRAFTING`, `MOVE_FLAGS`, `ITEM_FLAGS`, `CONTEST_EFFECTS`) populated at import time.
- `csv_data.ID_TO_NAME` is a dict of dicts mapping `{category: {id: name}}` for 22+ categories.
- `csv_data.DAMAGE_TABLE` and `damage_multiplier()` provide type effectiveness lookups.
- `python-scripts/paths.py` defines all shared path constants (CSV_DIR, SPRITES_DIR, DS_SPRITES_DIR, POKESPRITE_ITEMS_DIR, etc.).

### Custom Stat IDs (in build_stats)
Veekun stats go 1-8. We added custom entries:
- **0**: Level
- **9** (max_id + 1): PP (select move)
- **10** (max_id + 2): PP (all moves)
- **11** (max_id + 3): Happiness

These are used in item_effects.json to reference what a vitamin/item affects.

### Item Effects System
`python-scripts/extract/item_effects.json` has sections: `pokemonEffects`, `battleEffects`, `overworldEffects`, `heldEffects`. Each section maps item_id (string) to structured effect data. Covers ~453 items including: potions, status cures, vitamins, evolution items, Poke Balls (15 types), repels, fossils, type-boost items (plates, incenses, gems), battle held items (Choice Band/Scarf/Specs, Life Orb, Focus Sash, etc.), type-resist berries, stat-boost berries, Mega Stones (47), Memories (17), terrain seeds, and more. `data_json.py` reads this directly.

### Ability Effects System
`python-scripts/extract/ability_effects.json` maps ability_id (string) to `{effects: [{trigger, effect, args}]}`. Covers all 304 abilities with ~100 effect types across triggers: `passive`, `onSwitchIn`, `onSwitchOut`, `onContact`, `onHit`, `onPhysicalHit`, `onKO`, `onFaint`, `turnEnd`, `onStatus`, `onStatDrop`, `onLowHp`, `onFlinch`, `onCriticalHit`.

### Pokemon Forms
Multi-form Pokemon use form-keyed dicts:
- `{0: value}` = all forms share the same data
- `{1: val, 2: val, ...}` = per-form data (1-indexed)
- `is_mega` dict on multi-form species identifies Mega Evolution forms

Form-varying fields: `type_ids`, `stats`, `ev_yields`, `level_moves`, `teachable_moves`, `egg_moves`, `identifier`

### Move Animation Mapping
`move_animation_map.json` maps each Gen 4-9 move ID to a Gen 3 move ID whose battle animation should be reused (563 mappings). Regenerated by `python-scripts/extract/generate_move_animations.py`, which uses flag-aware scoring (punch/bite/pulse/bullet/sound/powder/dance) plus ~125 hand-picked name-based overrides for iconic moves. Same-type matches for all mappings; Fairy moves are routed to Normal/Psychic analogues via overrides since Gen 3 has no Fairy animations. 163 unique animation targets.

### Pokemon Cries
`python-scripts/extract/download_cries.py` downloads one mp3 per base species from `play.pokemonshowdown.com/audio/cries/` into `python-scripts/raw-assets/pokemon-cries/`. The URL slug is the lowercase species name with all non-alphanumeric and non-ASCII characters stripped (`Ho-Oh` → `hooh`, `Mr. Mime` → `mrmime`, `Flabébé` → `flabebe`), with a fallback to the PokeAPI identifier for Nidoran♂/♀ disambiguation. Form variants share the base species cry — Showdown does not host form-specific audio. Idempotent and parallelized (16 workers). `data_json.py` adds a `cry` field to each species entry and copies the mp3 files into `pokedata3g/sounds/cries/`. 1024/1024 species covered.

### Battle Engine Overlays (Gen 4-9)
The TypeScript battle engine in `pokedata3g/` wires Gen 4-9 mechanics on top of the Gen 3 core:
- **Ability effects** (~40 query functions in `abilityEffects.ts`) covering damage calc (Technician, Adaptability, Filter, Multiscale, Sniper, Sheer Force, Tinted Lens, etc.), Mold Breaker bypass, Unaware/Contrary/Simple, Magic Guard/Bounce, Scrappy, Infiltrator, priority manipulation (Prankster, Queenly Majesty), move type change (Pixilate etc.), Protean/Libero, Parental Bond, Skill Link, and triggered effects (Moxie, Aftermath, Defiant, Weak Armor, Steadfast, Anger Point).
- **Ability-triggered form changes**: Zen Mode (Darmanitan), Shields Down (Minior), Disguise (Mimikyu), Schooling (Wishiwashi), Stance Change (Aegislash), Battle Bond (Greninja).
- **Terrain**: Electric/Grassy/Psychic/Misty as `Battle.terrain` field state. `terrainMechanics` in data.json drives type boosts, status prevention, priority block, end-of-turn healing, and Earthquake halving. Surge abilities set terrain on switch-in. Grounded check skips Flying types and Levitate.
- **Primal weather**: Heavy Rain, Harsh Sun, Strong Winds with `isPrimal`, `blocksMoveType`, and `resistanceOverride` on `WeatherMechanic`. Cannot be overridden by normal weather moves or abilities.
- **Niche moves**: Mimic, Sketch, Transform, Sleep Talk, Metronome, Conversion 2, Camouflage (terrain-aware), Stockpile/Spit Up/Swallow, Magic Coat, Snatch.
- **Data-driven two-turn moves**: `moveEffectMechanics` in data.json provides `twoTurn`, `semiInvulnerable`, `chargeOnly`, `skipChargeInWeather`, and `chargeStatBoost` — battle.ts reads these instead of hardcoded effect ID sets.

### Evolution System
- Evolutions are **deduplicated** — multiple CSV rows for the same target (e.g. per-location entries) are collapsed to one clean entry
- **Affection** (Gen 6-7 mechanic) is merged into happiness
- Entries are **sorted by specificity** — more conditions = higher priority (e.g. Sylveon before Espeon)
- `evolution_remappings.json` maps 19 species with non-Gen-3 evolution methods to Gen 3-compatible equivalents
- `remappingNote` field explains the original method
- Supports `post_trigger: "random-form"` for Maushold

### Item Sprites
Item icons come from `python-scripts/raw-assets/pokesprite-items/` (organized by category subdirectories). Identifiers are matched with suffix stripping (e.g. `master-ball` → `ball/master.png`). 878 items have icons.

## Common Tasks

### Adding a new item effects category
1. Look up the category_id in `python-scripts/raw-assets/pokeapi-csv/item_categories.csv`
2. Add an entry to `python-scripts/extract/item_effects.json` with effects keyed by item_id
3. No code changes needed — `data_json.py` picks it up automatically

### Adding a new data lookup
1. Add `build_xxx()` function to `python-scripts/extract/csv_data.py`
2. Add `XXX = build_xxx()` constant in the module-level constants section
3. Optionally add to `build_id_to_name()` if it has names

### Curating move animations
`python-scripts/extract/generate_move_animations.py` regenerates `move_animation_map.json`. To tweak a specific move's animation:
1. Edit the `NAME_OVERRIDES` dict in the script (name-based lookups fail loudly on typos)
2. Run `python python-scripts/extract/generate_move_animations.py`
3. Regenerate data.json

### Regenerating the npm module
```bash
python python-scripts/generate/data_json.py
```

### Running generate scripts
```bash
python python-scripts/generate/data_json.py        # Build data.json + copy sprites
python python-scripts/generate/item_icons.py       # Build item icon sprites
python python-scripts/generate/battle_anims.py     # Extract battle animations
python python-scripts/generate/contest_sprites.py  # Copy contest graphics
```

## Running
```bash
# Interactive exploration
jupyter notebook pokedex.ipynb

# Quick test
python -c "import sys; sys.path.insert(0,'python-scripts'); from extract import csv_data; print(len(csv_data.POKEMON), 'pokemon'); print(len(csv_data.ITEMS), 'items'); print(len(csv_data.TM_CRAFTING), 'TM recipes')"
```
