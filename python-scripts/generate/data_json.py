#!/usr/bin/env python3
"""Generate compact Pokemon JSON for the pokedata3g npm module."""

import csv
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from paths import CSV_DIR, FOOTPRINT_DIR, DS_SPRITES_DIR, POKESPRITE_ITEMS_DIR, POKEMON_CRIES_DIR, EXTRACTED_ASSETS, EXTRACT_DIR, POKEDATA_DIR

import pandas as pd
from extract import csv_data
from extract.download_cries import cry_slug as _cry_slug


# Map evolution dict keys to short camelCase keys
EVOLUTION_KEY_MAP = {
    'to_species_id': 'to',
    'trigger_id': 'trigger',
    'minimum_level': 'level',
    'trigger_item_id': 'triggerItem',
    'held_item_id': 'heldItem',
    'known_move_id': 'knownMove',
    'known_move_type_id': 'knownMoveType',
    'minimum_happiness': 'happiness',
    'minimum_beauty': 'beauty',
    # minimum_affection merged into minimum_happiness in csv_data.py
    'time_of_day': 'timeOfDay',
    'gender_id': 'gender',
    'location_id': 'location',
    'trade_species_id': 'tradeSpecies',
    'relative_physical_stats': 'relativePhysicalStats',
    'party_species_id': 'partySpecies',
    'party_type_id': 'partyType',
    'needs_overworld_rain': 'needsRain',
    'turn_upside_down': 'turnUpsideDown',
    'remapped_method': 'remappedMethod',
    'remapping_note': 'remappingNote',
    'from_form': 'fromForm',
    'to_form': 'toForm',
}


def stats_to_array(stat_dict):
    """Convert {stat_id: value} dict to [HP, Atk, Def, SpA, SpD, Spe] array."""
    return [stat_dict.get(i, 0) for i in range(1, 7)]


def ev_yields_to_sparse(ev_dict):
    """Convert {stat_id: value} to {"stat_id": value} with string keys, only non-zero."""
    return {str(k): v for k, v in ev_dict.items() if v}


def compact_abilities(abilities_list):
    """Encode abilities as signed ints: positive = normal, negative = hidden."""
    return [
        -a['ability_id'] if a['is_hidden'] else a['ability_id']
        for a in abilities_list
    ]


def compact_evolution(ev):
    """Shorten evolution keys."""
    return {EVOLUTION_KEY_MAP[k]: v for k, v in ev.items() if k in EVOLUTION_KEY_MAP}


def snake_to_camel(s):
    """Convert snake_case to camelCase."""
    first, *rest = s.split('_')
    return first + ''.join(w.capitalize() for w in rest)


def snake_to_camel_keys(d: dict, include_keys: list = None) -> dict:
    if include_keys is None:
        include_keys = set(d.keys())

    new_d = dict()

    for k, v in d.items():
        if k not in include_keys:
            continue

        if isinstance(k, str):
            new_k = snake_to_camel(k)
        else:
            new_k = str(k)

        if isinstance(v, dict):
            new_d[new_k] = snake_to_camel_keys(v)
        elif isinstance(v, list):
            new_v = []
            for item in v:
                if isinstance(item, dict):
                    new_v.append(snake_to_camel_keys(item))
                else:
                    new_v.append(item)
            new_d[new_k] = new_v
        else:
            new_d[new_k] = v

    return new_d


def get_all_keys(source: list[dict]):
    keys = set()
    for d in source:
        keys.update(d.keys())
    return keys


def keyed_collection(source: list[dict], key: str | int = 'id', include_keys: list = None):
    if isinstance(source, dict):
        source = list(source.values())
    if include_keys is None:
        include_keys = get_all_keys(source)
    collection = dict()
    for d in source:
        if d.get(key) is None:
            continue
        collection[d[key]] = snake_to_camel_keys(d, include_keys=include_keys)
    return collection


def compact_form_data(form_dict, transform=None):
    """Flatten single-form data; keep dict with string keys for multi-form.

    Single form:  {0: [1, 3]}           -> [1, 3]
    Multi-form:   {1: [1, 3], 2: [1, 14]} -> {"1": [1, 3], "2": [1, 14]}
    With transform: {0: {1: 50, 2: 60}}, transform=stats_to_array -> [50, 60, 0, 0, 0, 0]
    """
    if len(form_dict) == 1 and 0 in form_dict:
        val = form_dict[0]
        return transform(val) if transform else val
    result = {}
    for fk, v in form_dict.items():
        result[str(fk)] = transform(v) if transform else v
    return result


def generate():
    output = {"species": {}}

    for d in csv_data.POKEMON.values():
        is_multi = d['forms'] != [0]

        entry = {
            'name': d['name'],
            'identifier': compact_form_data(d['identifier']),
            'genus': d['genus'],
            'flavorText': d['flavor_text'],
            'height': d['height'],
            'weight': d['weight'],
            'types': compact_form_data(d['type_ids']),
            'stats': compact_form_data(d['stats'], stats_to_array),
            'evYields': compact_form_data(d['ev_yields'], ev_yields_to_sparse),
            'abilities': compact_abilities(d['abilities']),
            'baseExp': d['base_experience'],
            'captureRate': d['capture_rate'],
            'baseHappiness': d['base_happiness'],
            'growthRate': d['growth_rate_id'],
            'genderRate': d['gender_rate'],
            'eggGroups': d['egg_group_ids'],
            'hatchCounter': d['hatch_counter'],
            'color': d['color_id'],
            'shape': d['shape_id'],
            'habitat': d['habitat_id'],
            'isBaby': d['is_baby'],
            'hasGenderDiff': d['has_gender_differences'],
            'evolvesFrom': d['evolves_from_species_id'],
            'evoChain': d['evolution_chain_id'],
            'formsSwitchable': d['forms_switchable'],
            'levelMoves': compact_form_data(d['level_moves']),
            'teachMoves': compact_form_data(d['teachable_moves']),
            'eggMoves': compact_form_data(d['egg_moves']),
            'evolutions': [compact_evolution(ev) for ev in d['evolutions']],
            'heldItems': [[h['item_id'], h['rarity']] for h in d['held_items']],
        }

        # Sprites: convert paths to be relative to the module's sprites/ dir
        sprites = d.get('sprites', {})
        compact_sprites = {}
        all_sprite_types = (
            'front', 'back', 'front-shiny', 'back-shiny',
            'front-female', 'back-female', 'front-shiny-female', 'back-shiny-female',
            'icon', 'icon-frame2', 'footprint',
        )
        for sprite_type in all_sprite_types:
            val = sprites.get(sprite_type)
            if val is None:
                continue
            if isinstance(val, str):
                compact_sprites[sprite_type] = os.path.basename(val)
            elif isinstance(val, dict):
                compact_sprites[sprite_type] = {
                    str(k): os.path.basename(v) for k, v in val.items()
                }
        entry['sprites'] = compact_sprites

        # Cry slug (filename stem under sounds/cries/<slug>.mp3)
        slug = _cry_slug(d)
        if slug:
            cry_path = os.path.join(POKEMON_CRIES_DIR, f'{slug}.mp3')
            if os.path.exists(cry_path):
                entry['cry'] = slug

        # Species with a fixed HP value (e.g. Shedinja always has 1 HP)
        if d['id'] == 292:  # Shedinja
            entry['fixedHp'] = 1

        if is_multi:
            entry['forms'] = d['forms']
            if d['form_identifier']:
                entry['formIdentifier'] = {
                    str(k): v for k, v in d['form_identifier'].items()
                }
            if d['form_name']:
                entry['formName'] = {
                    str(k): v for k, v in d['form_name'].items()
                }
            if d.get('is_mega'):
                entry['isMega'] = {
                    str(k): v for k, v in d['is_mega'].items()
                }

        output['species'][str(d['id'])] = entry

    # Experience tables: {growthRateId: [exp_for_level_1, ..., exp_for_level_100]}
    exp_tables = {}
    with open(os.path.join(CSV_DIR, 'experience.csv')) as f:
        for row in csv.DictReader(f):
            gid = row['growth_rate_id']
            if gid not in exp_tables:
                exp_tables[gid] = [0] * 100
            exp_tables[gid][int(row['level']) - 1] = int(row['experience'])
    output['experience'] = exp_tables

    output['natures'] = keyed_collection(csv_data.NATURES)
    output['machines'] = keyed_collection(csv_data.MACHINES, key="machine_number")
    output['stats'] = keyed_collection(csv_data.STATS)
    output['types'] = keyed_collection(csv_data.TYPES)
    output['berries'] = keyed_collection(csv_data.BERRIES)
    output['statusConditions'] = keyed_collection(csv_data.STATUS_CONDITIONS)
    output['itemFlags'] = keyed_collection(csv_data.ITEM_FLAGS)
    output['moves'] = keyed_collection(csv_data.MOVES, include_keys=[
        "id", "name", "type_id", "damage_class_id", "pp", "power", "accuracy",
        "priority", "target_id", "effect_id", "effect_chance",
        "category_id", "ailment_id", "min_hits", "max_hits", "min_turns", "max_turns",
        "drain", "healing", "crit_rate", "ailment_chance", "flinch_chance", "stat_chance",
        "stat_changes", "flag_ids", "animation_id",
        "contest_type_id", "contest_effect_id",
    ])

    # Items: all Gen 3 items with metadata + structured effects where available
    with open(os.path.join(EXTRACT_DIR, 'item_effects.json')) as f:
        item_effects_data = json.load(f)

    def load_effects(key):
        return {
            int(k): v for k, v in item_effects_data[key].items()
            if not k.startswith('_')
        }

    pokemon_effects = load_effects('pokemonEffects')
    battle_effects = load_effects('battleEffects')
    overworld_effects = load_effects('overworldEffects')
    held_effects = load_effects('heldEffects')

    # Build machine-by-item lookup for TM/HM pokemonEffects
    machine_by_item = {m['item_id']: m for m in csv_data.MACHINES.values()}

    # Build item sprite lookup from pokesprite-items (subdirs with stripped suffixes)
    _item_sprite_files = {}
    for subdir in os.listdir(POKESPRITE_ITEMS_DIR):
        dirpath = os.path.join(POKESPRITE_ITEMS_DIR, subdir)
        if not os.path.isdir(dirpath):
            continue
        for fname in os.listdir(dirpath):
            if fname.endswith('.png'):
                _item_sprite_files[fname[:-4]] = os.path.join(subdir, fname)

    _strip_suffixes = ['-ball', '-berry', '-incense', '-plate', '-gem', '-memory',
                       '-mint', '-mulch', '-mail', '-fossil', '-candy', '-sweet', '-drive']

    def _find_item_icon(identifier):
        if identifier in _item_sprite_files:
            return _item_sprite_files[identifier]
        for suffix in _strip_suffixes:
            if identifier.endswith(suffix):
                stripped = identifier[:len(identifier) - len(suffix)]
                if stripped in _item_sprite_files:
                    return _item_sprite_files[stripped]
        return None

    all_items = {}
    for item_id, item in csv_data.ITEMS.items():
        icon_rel = _find_item_icon(item['identifier'])
        entry = {
            'name': item['name'],
            'identifier': item['identifier'],
            'categoryId': item['category_id'],
            'pocketId': item['pocket_id'],
            'cost': item['cost'],
            'flagIds': item['flag_ids'],
            'icon': f'sprites/item/{icon_rel}' if icon_rel else None,
        }
        if item_id in pokemon_effects:
            entry['pokemonEffects'] = pokemon_effects[item_id]
        elif item_id in machine_by_item:
            machine = machine_by_item[item_id]
            tm_effects = {
                'target': 'partyMember',
                'effects': [{'effect': 'teachMove', 'args': {'moveId': machine['move_id']}}],
            }
            if machine['machine_number'] > 100:  # HMs are reusable
                tm_effects['reusable'] = True
            entry['pokemonEffects'] = tm_effects
        if item_id in battle_effects:
            entry['battleEffects'] = battle_effects[item_id]
        if item_id in overworld_effects:
            entry['overworldEffects'] = overworld_effects[item_id]
        if item_id in held_effects:
            entry['heldEffects'] = held_effects[item_id]
        all_items[str(item_id)] = entry

    output['items'] = all_items

    # Item pockets: {id: {identifier, name}}
    pockets_df = pd.read_csv(os.path.join(CSV_DIR, 'item_pockets.csv'))
    pocket_names = pd.read_csv(os.path.join(CSV_DIR, 'item_pocket_names.csv'))
    pocket_names_en = pocket_names[pocket_names['local_language_id'] == 9]
    pockets_df = pockets_df.merge(pocket_names_en[['item_pocket_id', 'name']], left_on='id', right_on='item_pocket_id')
    output['pockets'] = {
        str(row['id']): {'identifier': row['identifier'], 'name': row['name']}
        for _, row in pockets_df.iterrows()
    }

    # Abilities: base data + structured effects
    with open(os.path.join(EXTRACT_DIR, 'ability_effects.json')) as f:
        ability_effects_data = json.load(f)

    all_abilities = {}
    for ability_id, ability in csv_data.ABILITIES.items():
        entry = {
            'identifier': ability['identifier'],
            'name': ability['name'],
            'shortEffect': ability.get('short_effect', ''),
        }
        effects = ability_effects_data.get(str(ability_id))
        if effects and 'effects' in effects:
            entry['effects'] = effects['effects']
        all_abilities[str(ability_id)] = entry
    output['abilities'] = all_abilities

    # ID-to-name lookup: {category: {id: name}}
    output['idToName'] = {}
    for category, mapping in csv_data.ID_TO_NAME.items():
        output['idToName'][category] = {str(k): v for k, v in mapping.items()}

    # Battle config: constants that the TS engine reads instead of hardcoding
    output['battleConfig'] = {
        'stabMultiplier': 1.5,
        'critMultiplier': 2,
        'damageRollMin': 85,
        'damageRollRange': 16,
        'critOdds': [16, 8, 4, 3, 2],
        'maxCritStage': 4,
        'maxStatStage': 6,
        'minStatStage': -6,
        'multiHitWeights': [0.375, 0.375, 0.125, 0.125],
        'struggle': {'power': 50, 'recoilFraction': 0.25},
        'confusionSelfHitPower': 40,
        'fleeFormula': {
            'speedMultiplier': 128,
            'attemptBonus': 30,
            'threshold': 256,
        },
        'spikesDamageFractions': [0, 0.125, 1/6, 0.25],
        'spikesImmuneTypeIds': [3],
        'trainerExpBonus': 1.5,
        'weatherDuration': 5,
        'terrainDuration': 5,
        'luxuryBallId': 11,
        'maxEvPerStat': 255,
        'maxEvTotal': 510,
        'maxMoves': 4,
        'shinyOdds': 8192,
        'ppUpMaxFraction': 1.6,
        'ppUpStages': 3,
    }

    # Weather mechanics
    output['weatherMechanics'] = {
        'rain': {
            'typeBoosts': {'11': 1.5},
            'typeWeakens': {'10': 0.5},
        },
        'sun': {
            'typeBoosts': {'10': 1.5},
            'typeWeakens': {'11': 0.5},
        },
        'sandstorm': {
            'damagePerTurn': 0.0625,
            'immuneTypeIds': [5, 6, 9],
        },
        'hail': {
            'damagePerTurn': 0.0625,
            'immuneTypeIds': [15],
        },
    }

    # Primal weather (cannot be replaced by normal weather)
    output['weatherMechanics']['heavy-rain'] = {
        'typeBoosts': {'11': 1.5},     # Water boosted
        'typeWeakens': {'10': 0.5},    # Fire weakened
        'blocksMoveType': 10,           # Fire moves fail entirely
        'isPrimal': True,
    }
    output['weatherMechanics']['harsh-sun'] = {
        'typeBoosts': {'10': 1.5},     # Fire boosted
        'typeWeakens': {'11': 0.5},    # Water weakened
        'blocksMoveType': 11,           # Water moves fail entirely
        'isPrimal': True,
    }
    output['weatherMechanics']['strong-winds'] = {
        'resistanceOverride': {
            'targetTypeId': 3,          # Flying type
            'superEffectiveBecomesNeutral': True,
        },
        'isPrimal': True,
    }

    # Terrain mechanics (Gen 6+)
    output['terrainMechanics'] = {
        'electric': {
            'typeBoosts': {'13': 1.3},   # Electric moves boosted
            'preventStatus': [2],         # Prevents Sleep
            'groundedOnly': True,
        },
        'grassy': {
            'typeBoosts': {'12': 1.3},   # Grass moves boosted
            'endOfTurnHeal': 0.0625,      # Heal 1/16 max HP
            'halvesMoves': [89, 523, 222],  # Earthquake, Bulldoze, Magnitude move IDs
            'groundedOnly': True,
        },
        'psychic': {
            'typeBoosts': {'14': 1.3},   # Psychic moves boosted
            'blocksPriority': True,       # Blocks priority moves against grounded targets
            'groundedOnly': True,
        },
        'misty': {
            'typeWeakens': {'16': 0.5},  # Dragon moves halved
            'preventAllStatus': True,     # Prevents all status conditions
            'groundedOnly': True,
        },
    }

    # Status condition mechanics
    output['statusMechanics'] = {
        '1':  {'preventAction': {'chance': 0.25}, 'speedMultiplier': 0.25},
        '2':  {'preventAction': {'chance': 1.0, 'untilCured': True}, 'duration': {'min': 1, 'max': 5}},
        '3':  {'preventAction': {'chance': 1.0, 'untilCured': True}, 'cureChance': 0.2},
        '4':  {'endOfTurnDamage': {'fraction': 0.125}, 'attackMultiplier': 0.5},
        '5':  {'endOfTurnDamage': {'fraction': 0.125}},
        '6':  {'selfHit': {'chance': 0.5, 'power': 40}, 'duration': {'min': 2, 'max': 5}},
        '7':  {'preventAction': {'chance': 0.5}},
        '22': {'endOfTurnDamage': {'fraction': 0.0625, 'scaling': True}},
    }

    # Move effect mechanics
    output['moveEffectMechanics'] = {
        '156': {'twoTurn': True, 'semiInvulnerable': True},
        '257': {'twoTurn': True, 'semiInvulnerable': True},
        '256': {'twoTurn': True, 'semiInvulnerable': True},
        '264': {'twoTurn': True, 'semiInvulnerable': True},
        '152': {'twoTurn': True, 'chargeOnly': True, 'skipChargeInWeather': 'sun'},
        '76':  {'twoTurn': True, 'chargeOnly': True},
        '146': {'twoTurn': True, 'chargeOnly': True, 'chargeStatBoost': {'statId': 3, 'stages': 1}},
        '40':  {'twoTurn': True, 'chargeOnly': True},
        '116': {'setWeather': 'sandstorm'},
        '137': {'setWeather': 'rain'},
        '138': {'setWeather': 'sun'},
        '165': {'setWeather': 'hail'},
        '66':  {'field': 'reflect', 'duration': 5},
        '36':  {'field': 'lightScreen', 'duration': 5},
        '125': {'field': 'safeguard', 'duration': 5},
        '47':  {'field': 'mist', 'duration': 5},
        '113': {'field': 'spikes', 'maxLayers': 3},
        '28':  {'rampage': True, 'durationMin': 2, 'durationMax': 3},
        '43':  {'partialTrap': True, 'damageFraction': 0.0625},
        '262': {'partialTrap': True, 'damageFraction': 0.0625},
        '90':  {'counter': True},
        '145': {'mirrorCoat': True},
        '130': {'rapidSpin': True},
        '112': {'protect': True},
        '117': {'endure': True},
    }

    # Locations
    output['locations'] = {}
    for loc_id, loc in csv_data.LOCATIONS.items():
        output['locations'][str(loc_id)] = {
            'name': loc['name'],
            'identifier': loc['identifier'],
            'regionId': int(loc['region_id']) if pd.notna(loc['region_id']) else None,
        }

    # Location areas
    output['locationAreas'] = {}
    for area_id, area in csv_data.LOCATION_AREAS.items():
        ident = area.get('identifier')
        area_name = area.get('area_name')
        output['locationAreas'][str(area_id)] = {
            'locationId': int(area['location_id']),
            'identifier': ident if pd.notna(ident) and ident else None,
            'areaName': area_name if pd.notna(area_name) and area_name else None,
        }

    # Encounter methods
    output['encounterMethods'] = {}
    for method_id, method in csv_data.ENCOUNTER_METHODS.items():
        output['encounterMethods'][str(method_id)] = {
            'identifier': method['identifier'],
            'name': method.get('name', ''),
        }

    # Encounters
    output['encounters'] = {}
    for area_id, methods in csv_data.ENCOUNTERS.items():
        area_entry = {}
        for method_id, entries in methods.items():
            area_entry[str(method_id)] = [
                {k: v for k, v in snake_to_camel_keys(e).items()}
                for e in entries
            ]
        output['encounters'][str(area_id)] = area_entry

    # Contest types
    output['contestTypes'] = {}
    for ct_id, ct in csv_data.CONTEST_TYPES.items():
        output['contestTypes'][str(ct_id)] = {
            'identifier': ct['identifier'],
            'name': ct.get('name', ''),
            'flavor': ct.get('flavor', ''),
            'color': ct.get('color', ''),
        }

    # Contest effects
    output['contestEffects'] = {}
    for ce_id, ce in csv_data.CONTEST_EFFECTS.items():
        ft = ce.get('flavor_text', '')
        eff = ce.get('effect', '')
        output['contestEffects'][str(ce_id)] = {
            'appeal': int(ce['appeal']),
            'jam': int(ce['jam']),
            'flavorText': ft if pd.notna(ft) else '',
            'effect': eff if pd.notna(eff) else '',
        }

    # Contest combos
    output['contestCombos'] = {str(k): v for k, v in csv_data.CONTEST_COMBOS.items()}

    # Add encounter-related names to idToName
    output['idToName']['locations'] = {str(v['id']): v['name'] for v in csv_data.LOCATIONS.values()}
    output['idToName']['encounterMethods'] = {str(v['id']): v.get('name', v['identifier']) for v in csv_data.ENCOUNTER_METHODS.values()}

    # Write JSON (replace NaN/Infinity with null for valid JSON)
    import math

    def sanitize(obj):
        if isinstance(obj, float):
            if math.isnan(obj) or math.isinf(obj):
                return None
            if obj == int(obj):
                return int(obj)
            return obj
        if isinstance(obj, dict):
            return {k: sanitize(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [sanitize(v) for v in obj]
        # Convert numpy/pandas int types to native Python int
        if hasattr(obj, 'item') and not isinstance(obj, str):
            try:
                return obj.item()
            except (ValueError, AttributeError):
                pass
        return obj

    # TM crafting recipes
    output['tmCrafting'] = {}
    for tm_num, tm in csv_data.TM_CRAFTING.items():
        output['tmCrafting'][str(tm_num)] = {
            'moveId': tm['move_id'],
            'moveName': tm['move_name'],
            'lpCost': tm['lp_cost'],
            'materials': [
                {'itemId': m['item_id'], 'name': m['name'], 'quantity': m['quantity']}
                for m in tm['materials']
            ],
        }

    output = sanitize(output)

    out_path = os.path.join(POKEDATA_DIR, 'src', 'data.json')
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(output, f, separators=(',', ':'), indent=2)

    size = os.path.getsize(out_path)
    print(f'Wrote {size:,} bytes ({size/1024:.1f} KB) to {out_path}')

    # Copy sprite files into module from both sources
    sprite_dest = os.path.join(POKEDATA_DIR, 'sprites')
    if os.path.exists(sprite_dest):
        shutil.rmtree(sprite_dest)
    # DS-style sprites (front, back, icon, etc. for all gens)
    shutil.copytree(DS_SPRITES_DIR, sprite_dest, ignore=shutil.ignore_patterns('*.csv'))
    # Copy footprints
    if os.path.isdir(FOOTPRINT_DIR):
        shutil.copytree(FOOTPRINT_DIR, os.path.join(sprite_dest, 'footprint'))
    # Copy pokesprite item icons (preserving subdirectory structure)
    item_src = POKESPRITE_ITEMS_DIR
    item_dest = os.path.join(sprite_dest, 'item')
    if os.path.isdir(item_src):
        shutil.copytree(item_src, item_dest)
    sprite_count = sum(len(files) for _, _, files in os.walk(sprite_dest))
    print(f'Copied {sprite_count} sprite files to {sprite_dest}/')

    # Copy Pokemon cries into module (sounds/cries/<slug>.mp3)
    cry_src = POKEMON_CRIES_DIR
    cry_dest = os.path.join(POKEDATA_DIR, 'sounds', 'cries')
    if os.path.isdir(cry_src):
        if os.path.exists(cry_dest):
            shutil.rmtree(cry_dest)
        shutil.copytree(cry_src, cry_dest)
        cry_count = sum(1 for f in os.listdir(cry_dest) if f.endswith('.mp3'))
        print(f'Copied {cry_count} cry files to {cry_dest}/')
    else:
        print(f'Skipping cries (run python-scripts/extract/download_cries.py first)')

    # Write animations.json (separate file — optional for consumers)
    anim_src = os.path.join(EXTRACTED_ASSETS, 'battle_anims.json')
    if os.path.exists(anim_src):
        with open(anim_src) as f:
            anim_data = json.load(f)

        anim_path = os.path.join(POKEDATA_DIR, 'src', 'animations.json')
        with open(anim_path, 'w') as f:
            json.dump(anim_data, f, separators=(',', ':'))

        anim_size = os.path.getsize(anim_path)
        print(f'Wrote {anim_size:,} bytes ({anim_size/1024:.1f} KB) to {anim_path}')
    else:
        print('Skipping animations.json (run generate/battle_anims.py first)')


if __name__ == '__main__':
    generate()
