"""Pokemon data extracted from veekun CSV files (Gen 1-9, sprite-gated).

Build functions read CSVs and return dict[int, dict] keyed by primary ID.
Module-level constants (POKEMON, MOVES, TYPES, etc.) are populated at import time.

Species/forms are gated by processed_sprites.csv — only Pokemon with
DS-style sprites are included. Moves, abilities, types, and items are
expanded to Gen 9 unconditionally.
"""

import json
import os
import sys
from collections import defaultdict

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from paths import CSV_DIR, FOOTPRINT_DIR, DS_SPRITES_DIR

# --- Sprite gating: only include species/forms with DS-style sprites ---
PROCESSED_SPRITES_CSV = os.path.join(
    os.path.dirname(__file__), '..', 'raw-assets', 'ds-style-sprites', 'processed_sprites.csv'
)
_sprite_df = pd.read_csv(PROCESSED_SPRITES_CSV)
_sprite_df = _sprite_df[_sprite_df['form'].fillna('') != 'gmax']  # Exclude Gmax forms
_sprite_df = _sprite_df[_sprite_df['species_id'] != 1024]  # Exclude Terapagos

# Terastallization exclusions (applied in build functions)
_TERA_TYPE_IDS = {19}         # Stellar
_TERA_MOVE_IDS = {851, 906}   # Tera Blast, Tera Starstorm
_TERA_ABILITY_IDS = {304, 305, 306}  # Tera Shift, Tera Shell, Teraform Zero
SPRITE_SPECIES_IDS = set(_sprite_df['species_id'].unique())
SPRITE_IDENTIFIERS = set(_sprite_df['identifier'].unique())


def _load_json(name):
    """Load a JSON file from the extract directory, or return {} if missing."""
    path = os.path.join(os.path.dirname(__file__), name)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}


MOVE_ANIMATION_MAP = _load_json('move_animation_map.json')
EVOLUTION_REMAPPINGS = _load_json('evolution_remappings.json')
EVOLUTION_FORM_OVERRIDES = _load_json('evolution_form_overrides.json')


def _csv(name: str) -> str:
    """Return the full path to a veekun CSV file."""
    return os.path.join(CSV_DIR, name)


def _clean_strings(df: pd.DataFrame) -> pd.DataFrame:
    """Clean up whitespace in all string columns."""
    for col in df.select_dtypes(include=['object']).columns:
        df[col] = df[col].str.replace(r'\s+', ' ', regex=True)
    return df


def build_natures():
    df = pd.read_csv(_csv('natures.csv')).drop(columns=['game_index'])

    names = pd.read_csv(_csv('nature_names.csv'))
    names = names[names['local_language_id']==9].drop(columns=['id', 'local_language_id'], errors='ignore').dropna()

    df = pd.merge(
        left=df,
        right=names,
        how='left',
        left_on='id',
        right_on='nature_id'
    ).drop(columns=['nature_id'])

    # Get stat names for increased/decreased stats
    stat_names = pd.read_csv(_csv('stat_names.csv'))
    stat_names = stat_names[stat_names['local_language_id']==9][['stat_id', 'name']]

    df = pd.merge(
        left=df,
        right=stat_names.rename(columns={'name': 'increased_stat'}),
        how='left',
        left_on='increased_stat_id',
        right_on='stat_id'
    ).drop(columns=['stat_id'])

    df = pd.merge(
        left=df,
        right=stat_names.rename(columns={'name': 'decreased_stat'}),
        how='left',
        left_on='decreased_stat_id',
        right_on='stat_id'
    ).drop(columns=['stat_id'])

    df = _clean_strings(df)

    return df.set_index('id', drop=False).to_dict(orient='index')


def build_item_flags():
    df = pd.read_csv(_csv('item_flags.csv'))

    prose = pd.read_csv(_csv('item_flag_prose.csv'))
    prose = prose[prose['local_language_id']==9][['item_flag_id', 'name', 'description']]

    df = pd.merge(
        left=df,
        right=prose,
        how='left',
        left_on='id',
        right_on='item_flag_id'
    ).drop(columns=['item_flag_id'])

    df = _clean_strings(df)

    return df.set_index('id', drop=False).to_dict(orient='index')


def build_types():
    df = pd.read_csv(_csv('types.csv'))
    df = df[(df['generation_id'] <= 9) & (df['id'] < 10000) & ~df['id'].isin(_TERA_TYPE_IDS)].drop(columns=['generation_id'])
    # Convert damage_class_id from float to nullable int
    df['damage_class_id'] = df['damage_class_id'].astype('Int64')

    names = pd.read_csv(_csv('type_names.csv'))
    names = names[names['local_language_id']==9][['type_id', 'name']]

    df = pd.merge(
        left=df,
        right=names,
        how='left',
        left_on='id',
        right_on='type_id'
    ).drop(columns=['type_id'])

    # Build efficacy dict for each type (damage this type deals to other types)
    efficacy = pd.read_csv(_csv('type_efficacy.csv'))
    # Filter to only non-100 damage factors (interesting ones)
    efficacy = efficacy[efficacy['damage_factor'] != 100]
    # Convert damage_factor to multiplier (0, 0.5, 2)
    efficacy['multiplier'] = efficacy['damage_factor'] / 100
    type_efficacy = efficacy.groupby('damage_type_id')[['target_type_id', 'multiplier']].apply(
        lambda g: dict(zip(g['target_type_id'], g['multiplier'])), include_groups=False
    ).to_dict()

    df = _clean_strings(df)

    result = df.set_index('id', drop=False).to_dict(orient='index')
    # Add efficacy dict to each type
    for type_id in result:
        result[type_id]['efficacy'] = type_efficacy.get(type_id, {})

    return result


def build_stats():
    df = pd.read_csv(_csv('stats.csv'))
    # Convert nullable int columns
    df['damage_class_id'] = df['damage_class_id'].astype('Int64')
    df['game_index'] = df['game_index'].astype('Int64')
    df['is_battle_only'] = df['is_battle_only'].astype(bool)

    names = pd.read_csv(_csv('stat_names.csv'))
    names = names[names['local_language_id']==9][['stat_id', 'name']]

    df = pd.merge(
        left=df,
        right=names,
        how='left',
        left_on='id',
        right_on='stat_id'
    ).drop(columns=['stat_id'])

    df = _clean_strings(df)

    _dict =  df.set_index('id', drop=False).to_dict(orient='index')
    
    _max_id = max(_dict.keys())

    _dict.update(
        {
            0: {
                'id': 0,
                'damage_class_id': None,
                'identifier': 'level',
                'is_battle_only': False,
                'game_index': None,
                'name': 'Level'
            },
            (_max_id + 1): {
                'id': _max_id + 1,
                'damage_class_id': None,
                'identifier': 'pp-select',
                'is_battle_only': False,
                'game_index': None,
                'name': 'PP (select move)'
            },
            (_max_id + 2): {
                'id': _max_id + 2,
                'damage_class_id': None,
                'identifier': 'pp-all',
                'is_battle_only': False,
                'game_index': None,
                'name': 'PP (all moves)'
            },
            (_max_id + 3): {
                'id': _max_id + 3,
                'damage_class_id': None,
                'identifier': 'happiness',
                'is_battle_only': False,
                'game_index': None,
                'name': 'Happiness'
            }
        }
    )
    
    return _dict


def build_berries():
    """Gen 3 berries with firmness, flavors, and natural gift data."""
    df = pd.read_csv(_csv('berries.csv'))
    # Include all berries (Gen 3 had 1-43, Gen 4+ added more up to 64)
    # No filter needed — include all

    for col in ['natural_gift_power', 'natural_gift_type_id']:
        df[col] = df[col].astype('Int64')

    # Get item names (berries are items)
    item_names = pd.read_csv(_csv('item_names.csv'))
    item_names = item_names[item_names['local_language_id'] == 9][['item_id', 'name']]

    df = pd.merge(
        left=df,
        right=item_names,
        how='left',
        left_on='item_id',
        right_on='item_id'
    )

    # Get berry flavors (contest_type_id -> flavor intensity)
    flavors_df = pd.read_csv(_csv('berry_flavors.csv')).drop(columns=['id'], errors='ignore')
    flavors_df = flavors_df[flavors_df['berry_id'].isin(df['id'])]

    # Build list of {flavor_id, potency} dicts per berry, non-zero only
    berry_flavors = {}
    for berry_id, group in flavors_df.groupby('berry_id'):
        berry_flavors[berry_id] = [
            {'flavor_id': int(row['contest_type_id']), 'potency': int(row['flavor'])}
            for _, row in group.iterrows()
            if int(row['flavor']) > 0
        ]

    df = _clean_strings(df)

    _dict = df.set_index('id', drop=False).to_dict(orient='index')
    for berry_id in _dict:
        _dict[berry_id]['flavors'] = berry_flavors.get(berry_id, {})

    return _dict


def build_abilities():
    df = pd.read_csv(_csv('abilities.csv'))
    df = df[(df['is_main_series'] == 1) & ~df['id'].isin(_TERA_ABILITY_IDS)].drop(columns=['generation_id', 'is_main_series'])

    names = pd.read_csv(_csv('ability_names.csv'))
    names = names[names['local_language_id']==9].drop(columns=['id', 'local_language_id'], errors='ignore').dropna()

    df = pd.merge(
        left=df,
        right=names,
        how='left',
        left_on='id',
        right_on='ability_id'
    ).drop(columns=['ability_id'])

    flavor_text = pd.read_csv(_csv('ability_flavor_text.csv'))
    flavor_text = flavor_text[
        (flavor_text['ability_id'].isin(df['id']))
        & (flavor_text['language_id'] == 9)
    ].drop(columns = ['language_id'])
    flavor_text = flavor_text.sort_values(
        'version_group_id', ascending=False
        ).drop_duplicates(
            subset=['ability_id'], keep='first'
        ).drop(columns=['version_group_id', 'id'], errors='ignore')

    df = pd.merge(
        left=df,
        right=flavor_text,
        how='left',
        left_on='id',
        right_on='ability_id'
    ).drop(columns=['ability_id'])

    prose = pd.read_csv(_csv('ability_prose.csv'))
    prose = prose[prose['local_language_id']==9].drop(columns=['local_language_id', 'id'], errors='ignore').dropna()

    df = pd.merge(
        left=df,
        right=prose,
        how='left',
        left_on='id',
        right_on='ability_id'
    ).drop(columns=['ability_id'])

    # Get Gen 3 ability change notes from ability_changelog
    abl_changelog = pd.read_csv(_csv('ability_changelog.csv'))
    abl_changelog = abl_changelog[abl_changelog['changed_in_version_group_id'] > 7]
    abl_changelog_prose = pd.read_csv(_csv('ability_changelog_prose.csv'))
    abl_changelog_prose = abl_changelog_prose[abl_changelog_prose['local_language_id']==9]
    abl_changelog = pd.merge(
        abl_changelog, abl_changelog_prose[['ability_changelog_id', 'effect']],
        left_on='id', right_on='ability_changelog_id'
    ).rename(columns={'effect': 'note'}).sort_values('changed_in_version_group_id')
    ability_notes = abl_changelog.groupby('ability_id')['note'].apply(list).to_dict()

    df = _clean_strings(df)

    _dict = df.set_index('id', drop=False).to_dict(orient='index')
    for ability_id in _dict:
        _dict[ability_id]['effect_notes'] = ability_notes.get(ability_id, [])

    return _dict


def build_items():
    df = pd.read_csv(_csv('items.csv'))
    df = df.drop(columns=['fling_power', 'fling_effect_id'])

    # Get category and pocket info
    categories = pd.read_csv(_csv('item_categories.csv'))[['id', 'pocket_id']]
    category_names = pd.read_csv(_csv('item_category_prose.csv'))
    category_names = category_names[category_names['local_language_id']==9][['item_category_id', 'name']]
    category_names = category_names.rename(columns={'name': 'category'})

    pocket_names = pd.read_csv(_csv('item_pocket_names.csv'))
    pocket_names = pocket_names[pocket_names['local_language_id']==9][['item_pocket_id', 'name']]
    pocket_names = pocket_names.rename(columns={'name': 'pocket'})

    df = pd.merge(left=df, right=categories, how='left', left_on='category_id', right_on='id', suffixes=('', '_cat'))
    df = df.drop(columns=['id_cat'])
    df = pd.merge(left=df, right=category_names, how='left', left_on='category_id', right_on='item_category_id')
    df = df.drop(columns=['item_category_id'])
    df = pd.merge(left=df, right=pocket_names, how='left', left_on='pocket_id', right_on='item_pocket_id')
    df = df.drop(columns=['item_pocket_id'])

    names = pd.read_csv(_csv('item_names.csv'))
    names = names[names['local_language_id']==9].drop(columns=['id', 'local_language_id'], errors='ignore').dropna()

    df = pd.merge(
        left=df,
        right=names,
        how='left',
        left_on='id',
        right_on='item_id'
    ).drop(columns=['item_id'])

    flavor_text = pd.read_csv(_csv('item_flavor_text.csv'))
    flavor_text = flavor_text[
        (flavor_text['item_id'].isin(df['id']))
        & (flavor_text['language_id'] == 9)
    ].drop(columns=['language_id'])
    flavor_text = flavor_text.sort_values(
        'version_group_id', ascending=False
    ).drop_duplicates(
        subset=['item_id'], keep='first'
    ).drop(columns=['version_group_id', 'id'], errors='ignore')

    df = pd.merge(
        left=df,
        right=flavor_text,
        how='left',
        left_on='id',
        right_on='item_id'
    ).drop(columns=['item_id'])

    prose = pd.read_csv(_csv('item_prose.csv'))
    prose = prose[prose['local_language_id']==9].drop(columns=['local_language_id', 'id'], errors='ignore').dropna()

    df = pd.merge(
        left=df,
        right=prose,
        how='left',
        left_on='id',
        right_on='item_id'
    ).drop(columns=['item_id'])

    # Get flag_ids for each item (as a list)
    flag_map = pd.read_csv(_csv('item_flag_map.csv'))
    flag_map = flag_map[flag_map['item_id'].isin(df['id'])]
    item_flags = flag_map.groupby('item_id')['item_flag_id'].apply(list).to_dict()

    df = _clean_strings(df)

    _dict = df.set_index('id', drop=False).to_dict(orient='index')
    # Add flag_ids list to each item
    for item_id in _dict:
        _dict[item_id]['flag_ids'] = item_flags.get(item_id, [])

    return _dict


def build_move_flags():
    df = pd.read_csv(_csv('move_flags.csv'))

    prose = pd.read_csv(_csv('move_flag_prose.csv'))
    prose = prose[prose['local_language_id']==9][['move_flag_id', 'name', 'description']]

    df = pd.merge(
        left=df,
        right=prose,
        how='left',
        left_on='id',
        right_on='move_flag_id'
    ).drop(columns=['move_flag_id'])

    df = _clean_strings(df)

    return df.set_index('id', drop=False).to_dict(orient='index')


def build_contest_effects():
    df = pd.read_csv(_csv('contest_effects.csv'))

    prose = pd.read_csv(_csv('contest_effect_prose.csv'))
    prose = prose[prose['local_language_id']==9][['contest_effect_id', 'flavor_text', 'effect']]

    df = pd.merge(
        left=df,
        right=prose,
        how='left',
        left_on='id',
        right_on='contest_effect_id'
    ).drop(columns=['contest_effect_id'])

    df = _clean_strings(df)

    return df.set_index('id', drop=False).to_dict(orient='index')


def build_move_effects():
    """Move effects with English prose and changelog notes.

    Keyed by effect_id. Includes effects used by all moves (Gen 1-9).
    """
    # Get effect IDs used by all moves
    moves = pd.read_csv(_csv('moves.csv'))
    gen3_effect_ids = set(
        moves['effect_id'].dropna().astype(int).unique()
    )

    df = pd.read_csv(_csv('move_effects.csv'))
    df = df[df['id'].isin(gen3_effect_ids)]

    # Get English prose (short_effect and effect)
    prose = pd.read_csv(_csv('move_effect_prose.csv'))
    prose = prose[prose['local_language_id'] == 9][['move_effect_id', 'short_effect', 'effect']]

    df = pd.merge(
        left=df,
        right=prose,
        how='left',
        left_on='id',
        right_on='move_effect_id'
    ).drop(columns=['move_effect_id'])

    # Get Gen 3 changelog notes (post-Gen 3 changes that describe how it worked in Gen 3)
    changelog = pd.read_csv(_csv('move_effect_changelog.csv'))
    changelog = changelog[changelog['changed_in_version_group_id'] > 7]
    changelog_prose = pd.read_csv(_csv('move_effect_changelog_prose.csv'))
    changelog_prose = changelog_prose[changelog_prose['local_language_id'] == 9]
    changelog = pd.merge(
        changelog, changelog_prose[['move_effect_changelog_id', 'effect']],
        left_on='id', right_on='move_effect_changelog_id'
    ).rename(columns={'effect': 'note'}).sort_values('changed_in_version_group_id')
    effect_notes = changelog.groupby('effect_id')['note'].apply(list).to_dict()

    df = _clean_strings(df)

    _dict = df.set_index('id', drop=False).to_dict(orient='index')
    for effect_id in _dict:
        _dict[effect_id]['changelog_notes'] = effect_notes.get(effect_id, [])

    return _dict


def build_moves():
    df = pd.read_csv(_csv('moves.csv'))
    df = df[(df['type_id'] < 10000) & ~df['id'].isin(_TERA_MOVE_IDS)].drop(columns=[
        'generation_id', 'super_contest_effect_id'
    ])

    # Convert int columns (some may have NaN which pandas reads as float)
    for col in ['power', 'pp', 'accuracy', 'effect_chance', 'contest_type_id', 'contest_effect_id']:
        df[col] = df[col].astype('Int64')

    # Get English names
    names = pd.read_csv(_csv('move_names.csv'))
    names = names[names['local_language_id']==9].drop(columns=['id', 'local_language_id'], errors='ignore').dropna()

    df = pd.merge(
        left=df,
        right=names,
        how='left',
        left_on='id',
        right_on='move_id'
    ).drop(columns=['move_id'])

    # Get flavor text (latest available version group)
    flavor_text = pd.read_csv(_csv('move_flavor_text.csv'))
    flavor_text = flavor_text[
        (flavor_text['move_id'].isin(df['id']))
        & (flavor_text['language_id'] == 9)
    ].drop(columns=['language_id'])
    flavor_text = flavor_text.sort_values(
        'version_group_id', ascending=False
    ).drop_duplicates(
        subset=['move_id'], keep='first'
    ).drop(columns=['version_group_id', 'id'], errors='ignore')

    df = pd.merge(
        left=df,
        right=flavor_text,
        how='left',
        left_on='id',
        right_on='move_id'
    ).drop(columns=['move_id'])

    # Get effect prose (short_effect and effect)
    effect_prose = pd.read_csv(_csv('move_effect_prose.csv'))
    effect_prose = effect_prose[effect_prose['local_language_id']==9][['move_effect_id', 'short_effect', 'effect']]

    df = pd.merge(
        left=df,
        right=effect_prose,
        how='left',
        left_on='effect_id',
        right_on='move_effect_id'
    ).drop(columns=['move_effect_id'])

    # Get Gen 3 effect change notes from move_effect_changelog
    # These are errata describing how the move behaved differently in Gen 3
    eff_changelog = pd.read_csv(_csv('move_effect_changelog.csv'))
    eff_changelog = eff_changelog[eff_changelog['changed_in_version_group_id'] > 7]
    eff_changelog_prose = pd.read_csv(_csv('move_effect_changelog_prose.csv'))
    eff_changelog_prose = eff_changelog_prose[eff_changelog_prose['local_language_id']==9]
    eff_changelog = pd.merge(
        eff_changelog, eff_changelog_prose[['move_effect_changelog_id', 'effect']],
        left_on='id', right_on='move_effect_changelog_id'
    ).rename(columns={'effect': 'note'}).sort_values('changed_in_version_group_id')
    # For each effect_id, collect all post-Gen3 change notes
    effect_notes = eff_changelog.groupby('effect_id')['note'].apply(list).to_dict()

    # Get target name
    target_prose = pd.read_csv(_csv('move_target_prose.csv'))
    target_prose = target_prose[target_prose['local_language_id']==9][['move_target_id', 'name', 'description']]
    target_prose = target_prose.rename(columns={'name': 'target', 'description': 'target_description'})

    df = pd.merge(
        left=df,
        right=target_prose,
        how='left',
        left_on='target_id',
        right_on='move_target_id'
    ).drop(columns=['move_target_id'])

    # Get move meta (battle mechanics)
    meta = pd.read_csv(_csv('move_meta.csv')).drop(columns=['id'], errors='ignore')
    # Convert int columns in meta
    for col in ['meta_category_id', 'meta_ailment_id', 'min_hits', 'max_hits', 'min_turns', 'max_turns',
                'drain', 'healing', 'crit_rate', 'ailment_chance', 'flinch_chance', 'stat_chance']:
        meta[col] = meta[col].astype('Int64')

    df = pd.merge(
        left=df,
        right=meta,
        how='left',
        left_on='id',
        right_on='move_id'
    ).drop(columns=['move_id'])

    # Rename meta columns for clarity
    df = df.rename(columns={
        'meta_category_id': 'category_id',
        'meta_ailment_id': 'ailment_id'
    })

    # Get flag_ids for each move (as a list)
    flag_map = pd.read_csv(_csv('move_flag_map.csv'))
    flag_map = flag_map[flag_map['move_id'].isin(df['id'])]
    move_flags = flag_map.groupby('move_id')['move_flag_id'].apply(list).to_dict()

    # Get stat_changes for each move (as a list of {stat_id, change})
    stat_changes = pd.read_csv(_csv('move_meta_stat_changes.csv')).drop(columns=['id'], errors='ignore')
    stat_changes = stat_changes[stat_changes['move_id'].isin(df['id'])]
    move_stat_changes = stat_changes.groupby('move_id')[['stat_id', 'change']].apply(
        lambda g: [{'stat_id': int(r['stat_id']), 'change': int(r['change'])} for _, r in g.iterrows()],
        include_groups=False
    ).to_dict()

    df = _clean_strings(df)

    _dict = df.set_index('id', drop=False).to_dict(orient='index')
    # Add flag_ids and stat_changes to each move
    for move_id in _dict:
        _dict[move_id]['flag_ids'] = move_flags.get(move_id, [])
        _dict[move_id]['stat_changes'] = move_stat_changes.get(move_id, [])
        _dict[move_id]['effect_notes'] = effect_notes.get(_dict[move_id]['effect_id'], [])
        _dict[move_id]['animation_id'] = MOVE_ANIMATION_MAP.get(str(move_id), move_id)

    return _dict


def build_pokemon():
    # Load species, gated by sprite availability
    species = pd.read_csv(_csv('pokemon_species.csv'))
    species = species[species['id'].isin(SPRITE_SPECIES_IDS)].drop(columns=['generation_id', 'conquest_order'])

    # Convert int columns
    for col in ['evolves_from_species_id', 'color_id', 'shape_id', 'habitat_id']:
        species[col] = species[col].astype('Int64')
    species['is_baby'] = species['is_baby'].astype(bool)
    species['has_gender_differences'] = species['has_gender_differences'].astype(bool)
    species['forms_switchable'] = species['forms_switchable'].astype(bool)

    # Load ALL pokemon rows for included species (including alternate forms)
    all_pokemon = pd.read_csv(_csv('pokemon.csv'))
    all_pokemon = all_pokemon[all_pokemon['species_id'].isin(species['id'])]

    # Load forms, gated by sprite availability (identifier must be in processed_sprites.csv)
    forms_df = pd.read_csv(_csv('pokemon_forms.csv'))
    forms_df = forms_df[
        (forms_df['pokemon_id'].isin(all_pokemon['id']))
        & (forms_df['identifier'].isin(SPRITE_IDENTIFIERS))
    ].sort_values(['pokemon_id', 'form_order'])

    # pokemon_ids with sprites
    sprite_pokemon_ids = set(forms_df['pokemon_id'].unique())

    # Get form names
    form_names_df = pd.read_csv(_csv('pokemon_form_names.csv'))
    form_names_df = form_names_df[form_names_df['local_language_id'] == 9]
    form_name_map = dict(zip(form_names_df['pokemon_form_id'], form_names_df['form_name']))

    # Map pokemon_id -> species_id for all pokemon
    pid_to_sid = dict(zip(all_pokemon['id'], all_pokemon['species_id']))

    # Build mega/battle-only lookup from sprite data
    _sprite_meta = {}
    for _, srow in _sprite_df.iterrows():
        _sprite_meta[srow['identifier']] = {
            'is_mega': bool(srow['is_mega']),
        }

    # Build per-species form metadata
    forms_df = forms_df.copy()
    forms_df['species_id'] = forms_df['pokemon_id'].map(pid_to_sid)
    species_form_data = {}
    for sid, grp in forms_df.groupby('species_id'):
        form_list = []
        for _, row in grp.iterrows():
            ident = row['identifier']
            smeta = _sprite_meta.get(ident, {})
            form_list.append({
                'pokemon_form_id': int(row['id']),
                'pokemon_id': int(row['pokemon_id']),
                'identifier': ident,
                'form_identifier': row['form_identifier'] if pd.notna(row['form_identifier']) else None,
                'is_battle_only': bool(row['is_battle_only']),
                'is_mega': smeta.get('is_mega', False),
            })
        species_form_data[sid] = form_list

    # Build default-form df for species-level data (one row per species)
    default_pokemon = all_pokemon[
        all_pokemon['is_default'] == 1
    ].drop(columns=['order', 'is_default'])

    # Merge species data into default pokemon
    df = pd.merge(
        left=default_pokemon,
        right=species.drop(columns=['identifier', 'order']),
        how='left',
        left_on='species_id',
        right_on='id',
        suffixes=('', '_species')
    ).drop(columns=['id_species'])

    # Get English names and genus
    names = pd.read_csv(_csv('pokemon_species_names.csv'))
    names = names[names['local_language_id']==9][['pokemon_species_id', 'name', 'genus']]

    df = pd.merge(
        left=df,
        right=names,
        how='left',
        left_on='species_id',
        right_on='pokemon_species_id'
    ).drop(columns=['pokemon_species_id'])

    # --- Form-varying data: load for all sprite-gated pokemon_ids ---

    # Types
    types_df = pd.read_csv(_csv('pokemon_types.csv'))
    types_df = types_df[types_df['pokemon_id'].isin(sprite_pokemon_ids)].sort_values(['pokemon_id', 'slot'])
    pokemon_types = types_df.groupby('pokemon_id')['type_id'].apply(list).to_dict()

    # Stats
    stats_df = pd.read_csv(_csv('pokemon_stats.csv'))
    stats_df = stats_df[stats_df['pokemon_id'].isin(sprite_pokemon_ids)]
    pokemon_stats = stats_df.groupby('pokemon_id')[['stat_id', 'base_stat']].apply(
        lambda g: {int(r['stat_id']): int(r['base_stat']) for _, r in g.iterrows()},
        include_groups=False
    ).to_dict()

    # EV yields
    pokemon_evs = stats_df.groupby('pokemon_id')[['stat_id', 'effort']].apply(
        lambda g: {int(r['stat_id']): int(r['effort']) for _, r in g.iterrows() if r['effort'] > 0},
        include_groups=False
    ).to_dict()

    # Moves: for each pokemon, use only its latest GENERATION (not latest game).
    # This avoids accumulating moves from 25 years of version groups.
    vg_df = pd.read_csv(_csv('version_groups.csv'))
    _vg_to_gen = dict(zip(vg_df['id'], vg_df['generation_id']))
    _spinoff_vgs = {12, 13, 19, 23, 24}  # Colosseum, XD, Let's Go, BDSP, Legends Arceus

    moves_df = pd.read_csv(_csv('pokemon_moves.csv'))
    moves_df = moves_df[
        moves_df['pokemon_id'].isin(sprite_pokemon_ids)
    ].drop(columns=['order', 'mastery'], errors='ignore')

    # Find each pokemon's latest generation, filter to that gen's VGs (excluding spinoffs)
    moves_df['gen'] = moves_df['version_group_id'].map(_vg_to_gen)
    latest_gen = moves_df.groupby('pokemon_id')['gen'].transform('max')
    is_spinoff = moves_df['version_group_id'].isin(_spinoff_vgs)
    mask = (moves_df['gen'] == latest_gen) & ~is_spinoff

    # Fallback: if a pokemon has ONLY spinoff data in its latest gen, include spinoffs
    has_main = set(moves_df.loc[mask, 'pokemon_id'].unique())
    all_pids = set(moves_df['pokemon_id'].unique())
    missing = all_pids - has_main
    fallback_mask = moves_df['pokemon_id'].isin(missing) & (moves_df['gen'] == latest_gen)

    moves_df = moves_df[mask | fallback_mask]
    moves_df = moves_df.sort_values('version_group_id', ascending=False).drop_duplicates(
        subset=['pokemon_id', 'move_id', 'pokemon_move_method_id', 'level'], keep='first'
    ).drop(columns=['version_group_id', 'gen'])

    # Level-up moves: list of (move_id, level) tuples
    level_df = moves_df[moves_df['pokemon_move_method_id'] == 1]
    pokemon_level_moves = level_df.groupby('pokemon_id')[['move_id', 'level']].apply(
        lambda g: [(int(r['move_id']), int(r['level'])) for _, r in g.iterrows()],
        include_groups=False
    ).to_dict()

    # Teachable moves (tutor + machine): list of move_ids
    teach_df = moves_df[moves_df['pokemon_move_method_id'].isin([3, 4])]
    pokemon_teachable_moves = teach_df.groupby('pokemon_id')['move_id'].apply(
        lambda g: sorted(int(x) for x in g.unique())
    ).to_dict()

    # Egg moves: list of move_ids
    egg_df = moves_df[moves_df['pokemon_move_method_id'] == 2]
    pokemon_egg_moves = egg_df.groupby('pokemon_id')['move_id'].apply(
        lambda g: sorted(int(x) for x in g.unique())
    ).to_dict()

    # --- Species-level data (not form-varying) ---

    # Abilities (use default pokemon_id)
    abilities_df = pd.read_csv(_csv('pokemon_abilities.csv'))
    abilities_df = abilities_df[abilities_df['pokemon_id'].isin(df['id'])].sort_values(['pokemon_id', 'slot'])
    pokemon_abilities = abilities_df.groupby('pokemon_id')[['ability_id', 'is_hidden', 'slot']].apply(
        lambda g: [{'ability_id': int(r['ability_id']), 'is_hidden': bool(r['is_hidden']), 'slot': int(r['slot'])}
                  for _, r in g.iterrows()],
        include_groups=False
    ).to_dict()

    # Egg groups
    egg_groups_df = pd.read_csv(_csv('pokemon_egg_groups.csv'))
    egg_groups_df = egg_groups_df[egg_groups_df['species_id'].isin(df['species_id'])]
    species_egg_groups = egg_groups_df.groupby('species_id')['egg_group_id'].apply(list).to_dict()

    # Flavor text
    flavor_df = pd.read_csv(_csv('pokemon_species_flavor_text.csv'))
    flavor_df = flavor_df[
        (flavor_df['species_id'].isin(df['species_id']))
        & (flavor_df['language_id'] == 9)
    ].drop(columns=['language_id'])
    flavor_df = flavor_df.sort_values(
        'version_id', ascending=False
    ).drop_duplicates(
        subset=['species_id'], keep='first'
    ).drop(columns=['version_id', 'id'], errors='ignore')

    df = pd.merge(
        left=df,
        right=flavor_df,
        how='left',
        left_on='species_id',
        right_on='species_id'
    )

    # Wild held items (use default pokemon_id)
    held_items_df = pd.read_csv(_csv('pokemon_items.csv'))
    held_items_df = held_items_df[
        held_items_df['pokemon_id'].isin(df['id'])
    ].drop(columns=['id'], errors='ignore')
    held_items_df = held_items_df.sort_values('version_id', ascending=False).drop_duplicates(
        subset=['pokemon_id', 'item_id'], keep='first'
    ).drop(columns=['version_id'])
    pokemon_held_items = held_items_df.groupby('pokemon_id')[['item_id', 'rarity']].apply(
        lambda g: [{'item_id': int(r['item_id']), 'rarity': int(r['rarity'])} for _, r in g.iterrows()],
        include_groups=False
    ).to_dict()

    # Evolution data
    evo_df = pd.read_csv(_csv('pokemon_evolution.csv'))
    evo_df = evo_df[evo_df['evolved_species_id'].isin(df['species_id'])]
    evo_df = pd.merge(
        left=evo_df,
        right=species[['id', 'evolves_from_species_id']],
        how='left',
        left_on='evolved_species_id',
        right_on='id',
        suffixes=('', '_species')
    ).drop(columns=['id_species'])
    for col in ['trigger_item_id', 'minimum_level', 'gender_id', 'location_id', 'held_item_id',
                'known_move_id', 'known_move_type_id', 'minimum_happiness', 'minimum_beauty',
                'minimum_affection', 'relative_physical_stats', 'party_species_id', 'party_type_id',
                'trade_species_id', 'evolves_from_species_id']:
        evo_df[col] = evo_df[col].astype('Int64')
    evo_df['needs_overworld_rain'] = evo_df['needs_overworld_rain'].astype(bool)
    evo_df['turn_upside_down'] = evo_df['turn_upside_down'].astype(bool)

    species_evolutions = defaultdict(list)
    for _, row in evo_df.iterrows():
        if pd.isna(row['evolves_from_species_id']):
            continue
        row_id = int(row['id'])
        override = EVOLUTION_FORM_OVERRIDES.get(str(row_id), {})
        if override.get('drop'):
            continue
        evo_data = {
            '_row_id': row_id,
            'to_species_id': int(row['evolved_species_id']),
            'trigger_id': int(row['evolution_trigger_id']),
        }
        if 'from_form' in override:
            evo_data['_from_form'] = override['from_form']
        if 'to_form' in override:
            evo_data['_to_form'] = override['to_form']
        if pd.notna(row['minimum_level']): evo_data['minimum_level'] = int(row['minimum_level'])
        if pd.notna(row['trigger_item_id']): evo_data['trigger_item_id'] = int(row['trigger_item_id'])
        if pd.notna(row['held_item_id']): evo_data['held_item_id'] = int(row['held_item_id'])
        if pd.notna(row['known_move_id']): evo_data['known_move_id'] = int(row['known_move_id'])
        if pd.notna(row['minimum_happiness']): evo_data['minimum_happiness'] = int(row['minimum_happiness'])
        if pd.notna(row['minimum_beauty']): evo_data['minimum_beauty'] = int(row['minimum_beauty'])
        if pd.notna(row['time_of_day']) and row['time_of_day']: evo_data['time_of_day'] = row['time_of_day']
        if pd.notna(row['gender_id']): evo_data['gender_id'] = int(row['gender_id'])
        if pd.notna(row['location_id']): evo_data['location_id'] = int(row['location_id'])
        if pd.notna(row['trade_species_id']): evo_data['trade_species_id'] = int(row['trade_species_id'])
        if pd.notna(row['known_move_type_id']): evo_data['known_move_type_id'] = int(row['known_move_type_id'])
        # Affection (Gen 6-7) is merged into happiness; convert to minimum_happiness
        # if no happiness entry exists. Skip if redundant with an existing happiness entry.
        if pd.notna(row['minimum_affection']):
            if 'minimum_happiness' not in evo_data:
                evo_data['minimum_happiness'] = int(row['minimum_affection'])
        if pd.notna(row['relative_physical_stats']): evo_data['relative_physical_stats'] = int(row['relative_physical_stats'])
        if pd.notna(row['party_species_id']): evo_data['party_species_id'] = int(row['party_species_id'])
        if pd.notna(row['party_type_id']): evo_data['party_type_id'] = int(row['party_type_id'])
        if row['needs_overworld_rain']: evo_data['needs_overworld_rain'] = True
        if row['turn_upside_down']: evo_data['turn_upside_down'] = True
        # Apply evolution remappings for non-Gen-3 methods
        remap = EVOLUTION_REMAPPINGS.get(str(evo_data['to_species_id']))
        if remap:
            evo_data['remapped_method'] = remap
        species_evolutions[int(row['evolves_from_species_id'])].append(evo_data)

    # Deduplicate evolutions:
    # 1. For remapped evolutions, keep only one per (to_species_id, trigger_id) — the
    #    multiple location-based entries are all remapped to the same method.
    # 2. Drop entries that are strict subsets of another entry for the same target.
    # 3. Sort: more-specific entries (more conditions) first, so they match before
    #    less-specific ones.
    for sid in species_evolutions:
        evos = species_evolutions[sid]
        # Deduplicate remapped entries: keep only one per target species
        seen_remapped = set()
        deduped = []
        for evo in evos:
            to = evo['to_species_id']
            if 'remapped_method' in evo:
                if to in seen_remapped:
                    continue
                seen_remapped.add(to)
                # For remapped use-item, convert to a clean trigger-3 entry
                rm = evo['remapped_method']
                if rm['method'] == 'use-item' and 'item_id' in rm:
                    clean = {
                        '_row_id': evo['_row_id'],
                        'to_species_id': to,
                        'trigger_id': 3,
                        'trigger_item_id': rm['item_id'],
                    }
                    if '_from_form' in evo: clean['_from_form'] = evo['_from_form']
                    if '_to_form' in evo: clean['_to_form'] = evo['_to_form']
                    if rm.get('post_trigger'):
                        clean['remapped_method'] = rm
                    if rm.get('note'):
                        clean['remapping_note'] = rm['note']
                    deduped.append(clean)
                    continue
                # For remapped level-up, use the remapped level
                if rm['method'] == 'level-up' and 'level' in rm:
                    clean = {
                        '_row_id': evo['_row_id'],
                        'to_species_id': to,
                        'trigger_id': 1,
                        'minimum_level': rm['level'],
                        'remapped_method': rm,
                    }
                    if '_from_form' in evo: clean['_from_form'] = evo['_from_form']
                    if '_to_form' in evo: clean['_to_form'] = evo['_to_form']
                    if rm.get('note'):
                        clean['remapping_note'] = rm['note']
                    deduped.append(clean)
                    continue
            # Drop location_id if the entry has a remapped method (already handled above)
            if 'location_id' in evo and 'remapped_method' in evo:
                continue
            deduped.append(evo)

        # Deduplicate: if two entries target the same species with the same trigger
        # and same condition keys, keep only the one with stricter values (higher happiness etc.)
        # Entries with different _from_form are never considered duplicates.
        final = []
        seen_targets = {}
        _META = ('_row_id', '_from_form', '_to_form', 'to_species_id', 'trigger_id', 'remapped_method')
        for evo in deduped:
            key = (evo['to_species_id'], evo['trigger_id'], evo.get('_from_form'), evo.get('_to_form'))
            if key in seen_targets:
                existing = seen_targets[key]
                evo_conds = {k for k in evo if k not in _META}
                existing_conds = {k for k in existing if k not in _META}
                if evo_conds == existing_conds:
                    # Same condition keys — keep the one with stricter values
                    # (e.g. happiness=160 over happiness=2)
                    evo_strictness = sum(v for k, v in evo.items() if k not in _META and isinstance(v, (int, float)) and v > 0)
                    existing_strictness = sum(v for k, v in existing.items() if k not in _META and isinstance(v, (int, float)) and v > 0)
                    if evo_strictness > existing_strictness:
                        final = [e if e is not existing else evo for e in final]
                        seen_targets[key] = evo
                    continue
                if evo_conds > existing_conds:
                    final = [e if e is not existing else evo for e in final]
                    seen_targets[key] = evo
                elif existing_conds > evo_conds:
                    continue
                else:
                    # Different conditions — keep both (e.g. Espeon day vs Umbreon night)
                    final.append(evo)
            else:
                seen_targets[key] = evo
                final.append(evo)

        # Sort: entries with more condition keys first (more specific = higher priority).
        # Tiebreaker: move/type conditions are more restrictive than time-of-day,
        # so they should be checked first (e.g. Sylveon before Espeon/Umbreon).
        _CONDITION_WEIGHT = {
            'known_move_id': 3, 'known_move_type_id': 3,
            'relative_physical_stats': 2, 'gender_id': 2,
            'time_of_day': 1, 'location_id': 1,
        }
        def _evo_specificity(evo):
            conds = [k for k in evo if k not in _META]
            return sum(_CONDITION_WEIGHT.get(k, 1) for k in conds)
        final.sort(key=_evo_specificity, reverse=True)

        # Infer _from_form for unannotated entries when the source species has
        # multiple forms and some entries are explicitly claimed. Unannotated
        # entries apply to "all forms minus explicitly claimed forms".
        src_forms = species_form_data.get(sid, [])
        n_forms = len(src_forms)
        if n_forms > 1:
            claimed = {evo['_from_form'] for evo in final if evo.get('_from_form') is not None}
            if claimed:
                all_forms = set(range(1, n_forms + 1))
                unclaimed = sorted(all_forms - claimed)
                for evo in final:
                    if evo.get('_from_form') is None:
                        if len(unclaimed) == 1:
                            evo['_from_form'] = unclaimed[0]
                        elif len(unclaimed) > 1:
                            evo['_from_form'] = unclaimed

        # Strip meta fields and emit fromForm / toForm as public fields.
        for evo in final:
            ff = evo.pop('_from_form', None)
            tf = evo.pop('_to_form', None)
            evo.pop('_row_id', None)
            if ff is not None:
                evo['from_form'] = ff
            if tf is not None:
                evo['to_form'] = tf
        species_evolutions[sid] = final

    df = _clean_strings(df)

    # Helper: build form-keyed dict (1-indexed). If all forms share the
    # same value, collapse to {0: value}. For battle-only forms with no
    # data, inherit from the first non-battle-only form.
    def _normalize(v):
        if isinstance(v, list):
            return sorted(v)
        return v

    def _form_keyed(form_list, data_fn):
        per_form = {}
        default_data = None
        for form in form_list:
            if not form['is_battle_only']:
                default_data = data_fn(form['pokemon_id'])
                break
        for i, form in enumerate(form_list, 1):
            data = data_fn(form['pokemon_id'])
            if not data and form['is_battle_only'] and default_data is not None:
                data = default_data
            per_form[i] = data
        vals = list(per_form.values())
        if all(_normalize(v) == _normalize(vals[0]) for v in vals[1:]):
            return {0: vals[0]}
        return per_form

    # Build sprite availability lookup from processed_sprites.csv
    _sprite_avail = {}
    _sprite_check_cols = ['front', 'back', 'front-shiny', 'back-shiny',
                          'front-female', 'back-female', 'front-shiny-female',
                          'back-shiny-female', 'icon', 'icon-frame2']
    for _, srow in _sprite_df.iterrows():
        avail = {}
        for col in _sprite_check_cols:
            if str(srow.get(col, '')).strip().lower() == 'true':
                avail[col] = True
        _sprite_avail[srow['identifier']] = avail

    _dict = df.set_index('id', drop=False).to_dict(orient='index')

    for pokemon_id in _dict:
        d = _dict[pokemon_id]
        species_id = d['species_id']
        form_list = species_form_data.get(species_id, [])

        if len(form_list) <= 1:
            # Single form (the vast majority)
            d['forms'] = [0]
            d['identifier'] = {0: d.pop('identifier')}
            d['form_identifier'] = {}
            d['form_name'] = {}
            d['is_mega'] = {}
            d['type_ids'] = {0: pokemon_types.get(pokemon_id, [])}
            d['stats'] = {0: pokemon_stats.get(pokemon_id, {})}
            d['ev_yields'] = {0: pokemon_evs.get(pokemon_id, {})}
            d['level_moves'] = {0: pokemon_level_moves.get(pokemon_id, [])}
            d['teachable_moves'] = {0: pokemon_teachable_moves.get(pokemon_id, [])}
            d['egg_moves'] = {0: pokemon_egg_moves.get(pokemon_id, [])}
        else:
            # Multiple forms (1-indexed)
            d['forms'] = list(range(1, len(form_list) + 1))
            d.pop('identifier')
            d['identifier'] = {}
            d['form_identifier'] = {}
            d['form_name'] = {}
            d['is_mega'] = {}
            for i, form in enumerate(form_list, 1):
                d['identifier'][i] = form['identifier']
                if form['form_identifier']:
                    d['form_identifier'][i] = form['form_identifier']
                fn = form_name_map.get(form['pokemon_form_id'], '')
                if fn:
                    d['form_name'][i] = fn
                if form.get('is_mega'):
                    d['is_mega'][i] = True
            d['type_ids'] = _form_keyed(form_list, lambda pid: pokemon_types.get(pid, []))
            d['stats'] = _form_keyed(form_list, lambda pid: pokemon_stats.get(pid, {}))
            d['ev_yields'] = _form_keyed(form_list, lambda pid: pokemon_evs.get(pid, {}))
            d['level_moves'] = _form_keyed(form_list, lambda pid: pokemon_level_moves.get(pid, []))
            d['teachable_moves'] = _form_keyed(form_list, lambda pid: pokemon_teachable_moves.get(pid, []))
            d['egg_moves'] = _form_keyed(form_list, lambda pid: pokemon_egg_moves.get(pid, []))

        # Sprites (form-varying, from processed_sprites.csv)
        sprite_base = DS_SPRITES_DIR
        # Sprite CSV columns (also used as directory names and dict keys)
        _sprite_cols = [
            'front', 'back', 'front-shiny', 'back-shiny',
            'front-female', 'back-female', 'front-shiny-female', 'back-shiny-female',
            'icon', 'icon-frame2',
        ]

        sprites = {}
        for sprite_key in _sprite_cols:
            form_sprites = {}
            for fi, ident in d['identifier'].items():
                avail = _sprite_avail.get(ident, {})
                if avail.get(sprite_key):
                    path = os.path.join(sprite_base, sprite_key, f'{ident}.png')
                    form_sprites[fi] = path
            if form_sprites:
                vals = list(form_sprites.values())
                if len(form_sprites) == 1:
                    sprites[sprite_key] = vals[0]
                else:
                    sprites[sprite_key] = form_sprites

        # Footprint is species-level (not form-varying)
        base_ident = d['identifier'].get(0, None)
        if base_ident is None:
            base_ident = d['name'].lower().replace(' ', '-').replace('.', '')
        fp_path = os.path.join(FOOTPRINT_DIR, f'{base_ident}.png')
        if os.path.isfile(fp_path):
            sprites['footprint'] = fp_path
        d['sprites'] = sprites

        # Species-level attributes (not form-varying)
        d['abilities'] = pokemon_abilities.get(pokemon_id, [])
        d['egg_group_ids'] = species_egg_groups.get(species_id, [])
        d['evolutions'] = species_evolutions.get(species_id, [])
        d['held_items'] = pokemon_held_items.get(pokemon_id, [])

    return _dict


def build_status_conditions():
    """Status conditions with volatility classification (Gen 1-9).

    Uses veekun's move_meta_ailment IDs for non-volatile (1-5) and volatile (6+).
    Adds a custom entry for badly poisoned (toxic), which shares veekun
    ailment ID 5 with regular poison but has distinct mechanics.
    """
    ailments = pd.read_csv(_csv('move_meta_ailments.csv'))
    names = pd.read_csv(_csv('move_meta_ailment_names.csv'))
    names = names[names['local_language_id'] == 9][['move_meta_ailment_id', 'name']]

    ailments = pd.merge(
        left=ailments,
        right=names,
        how='left',
        left_on='id',
        right_on='move_meta_ailment_id'
    ).drop(columns=['move_meta_ailment_id'])

    # Include all conditions (exclude unknown=-1, none=0)
    ailments = ailments[ailments['id'] > 0]

    non_volatile_ids = {1, 2, 3, 4, 5}

    _dict = {}
    for _, row in ailments.iterrows():
        aid = int(row['id'])
        _dict[aid] = {
            'id': aid,
            'identifier': row['identifier'],
            'name': row['name'],
            'is_volatile': aid not in non_volatile_ids,
        }

    # Custom entry: badly poisoned (toxic) — distinct from regular poison
    badly_poisoned_id = max(_dict.keys()) + 1
    _dict[badly_poisoned_id] = {
        'id': badly_poisoned_id,
        'identifier': 'badly-poisoned',
        'name': 'Badly Poisoned',
        'is_volatile': False,
    }

    return _dict


def build_machines():
    """TM/HM mappings for Gen 3. Keyed by machine_number (1-50 = TMs, 101-108 = HMs)."""
    df = pd.read_csv(_csv('machines.csv'))
    df = df[df['version_group_id'].isin((5, 6, 7))].drop(columns=['id'], errors='ignore')

    # Dedupe: keep highest version_group for each machine_number
    df = df.sort_values('version_group_id', ascending=False).drop_duplicates(
        subset=['machine_number'], keep='first'
    ).drop(columns=['version_group_id'])

    _dict = {}
    for _, row in df.iterrows():
        num = int(row['machine_number'])
        if num <= 50:
            label = f'TM{num:02d}'
        else:
            label = f'HM{num - 100:02d}'
        _dict[num] = {
            'machine_number': num,
            'label': label,
            'item_id': int(row['item_id']),
            'move_id': int(row['move_id']),
        }

    return _dict


def build_locations():
    """Gen 3 locations (Hoenn + Kanto) with English names."""
    df = pd.read_csv(_csv('locations.csv'))
    # Region 1 = Kanto (FRLG), Region 3 = Hoenn (RSE)
    df = df[df['region_id'].isin((1, 3))]

    names = pd.read_csv(_csv('location_names.csv'))
    names = names[names['local_language_id'] == 9][['location_id', 'name']]
    df = pd.merge(left=df, right=names, how='left', left_on='id', right_on='location_id').drop(columns=['location_id'])

    df = _clean_strings(df)
    return df.set_index('id', drop=False).to_dict(orient='index')


def build_location_areas():
    """Gen 3 location areas with English names."""
    locations = build_locations()
    loc_ids = set(locations.keys())

    df = pd.read_csv(_csv('location_areas.csv'))
    df = df[df['location_id'].isin(loc_ids)]

    # Area names (some are empty — e.g. the default area for a location)
    area_names = pd.read_csv(_csv('location_area_prose.csv'))
    area_names = area_names[area_names['local_language_id'] == 9][['location_area_id', 'name']]
    df = pd.merge(left=df, right=area_names, how='left', left_on='id', right_on='location_area_id',
                  suffixes=('', '_area')).drop(columns=['location_area_id'])
    # Rename the merged area name
    if 'name_area' in df.columns:
        df = df.rename(columns={'name_area': 'area_name'})
    elif 'name' in df.columns:
        df = df.rename(columns={'name': 'area_name'})

    df = _clean_strings(df)
    return df.set_index('id', drop=False).to_dict(orient='index')


def build_encounter_methods():
    """Encounter methods with English names."""
    df = pd.read_csv(_csv('encounter_methods.csv'))

    names = pd.read_csv(_csv('encounter_method_prose.csv'))
    names = names[names['local_language_id'] == 9][['encounter_method_id', 'name']]
    df = pd.merge(left=df, right=names, how='left', left_on='id', right_on='encounter_method_id').drop(columns=['encounter_method_id'])

    df = _clean_strings(df)
    return df.set_index('id', drop=False).to_dict(orient='index')


def build_encounters():
    """Gen 3 encounters: which Pokemon appear where, how, and at what level.

    Returns dict keyed by location_area_id, each value is a dict of
    {encounter_method_id: [{pokemon_id, min_level, max_level, rarity, conditions}]}.
    """
    # Gen 3 version IDs: 7=Ruby, 8=Sapphire, 9=Emerald, 10=FR, 11=LG
    enc = pd.read_csv(_csv('encounters.csv'))
    enc = enc[enc['version_id'].isin((7, 8, 9, 10, 11))]

    # Get Gen 3 encounter slots (version_group_id 5=RS, 6=FRLG, 7=Emerald)
    slots = pd.read_csv(_csv('encounter_slots.csv'))
    slots = slots[slots['version_group_id'].isin((5, 6, 7))]

    # Merge slot data (method, rarity) into encounters
    enc = pd.merge(left=enc, right=slots[['id', 'encounter_method_id', 'rarity']],
                   how='inner', left_on='encounter_slot_id', right_on='id',
                   suffixes=('', '_slot')).drop(columns=['id_slot'])

    # Load encounter conditions
    cond_map = pd.read_csv(_csv('encounter_condition_value_map.csv'))

    # Build condition lookup for each encounter
    enc_conditions = defaultdict(list)
    for _, row in cond_map.iterrows():
        enc_conditions[int(row['encounter_id'])].append(int(row['encounter_condition_value_id']))

    # Deduplicate: for each area + method + pokemon + level range, keep the
    # encounter from the latest version (prefer Emerald over Ruby/Sapphire)
    enc = enc.sort_values('version_id', ascending=False)
    enc = enc.drop_duplicates(subset=['location_area_id', 'encounter_method_id', 'pokemon_id', 'min_level', 'max_level'], keep='first')

    # Group by location_area_id -> encounter_method_id -> list of encounters
    result = defaultdict(lambda: defaultdict(list))
    for _, row in enc.iterrows():
        enc_id = int(row['id'])
        area_id = int(row['location_area_id'])
        method_id = int(row['encounter_method_id'])
        entry = {
            'pokemon_id': int(row['pokemon_id']),
            'min_level': int(row['min_level']),
            'max_level': int(row['max_level']),
            'rarity': int(row['rarity']),
        }
        conditions = enc_conditions.get(enc_id)
        if conditions:
            entry['condition_value_ids'] = conditions
        result[area_id][method_id].append(entry)

    # Convert defaultdicts to regular dicts
    return {k: dict(v) for k, v in result.items()}


def build_contest_types():
    """Contest types with English names, flavor, and color."""
    df = pd.read_csv(_csv('contest_types.csv'))

    names = pd.read_csv(_csv('contest_type_names.csv'))
    names = names[names['local_language_id'] == 9][['contest_type_id', 'name', 'flavor', 'color']]
    df = pd.merge(left=df, right=names, how='left', left_on='id', right_on='contest_type_id').drop(columns=['contest_type_id'])

    df = _clean_strings(df)
    return df.set_index('id', drop=False).to_dict(orient='index')


def build_contest_combos():
    """Contest move combos: first_move_id -> [second_move_id, ...]."""
    df = pd.read_csv(_csv('contest_combos.csv'))
    result = defaultdict(list)
    for _, row in df.iterrows():
        result[int(row['first_move_id'])].append(int(row['second_move_id']))
    return dict(result)


def build_tm_crafting():
    """TM crafting recipes from Scarlet/Violet. Keyed by TM number (int).

    Each entry: {tm, move_id, move_name, lp_cost, materials: [{item_id, name, quantity}]}
    Parsed from extracted-assets/tm_crafting.json (sourced from Serebii).
    """
    import os as _os
    crafting_path = _os.path.join(
        _os.path.dirname(__file__), '..', 'extracted-assets', 'tm_crafting.json'
    )
    if not _os.path.exists(crafting_path):
        return {}

    with open(crafting_path) as f:
        raw = json.load(f)

    # Build move name -> id lookup
    moves = pd.read_csv(_csv('moves.csv'))
    move_names = pd.read_csv(_csv('move_names.csv'))
    move_names = move_names[move_names['local_language_id'] == 9]
    name_to_move_id = dict(zip(move_names['name'], move_names['move_id']))

    # Build item name -> id lookup
    items = pd.read_csv(_csv('items.csv'))
    item_names = pd.read_csv(_csv('item_names.csv'))
    item_names = item_names[item_names['local_language_id'] == 9]
    name_to_item_id = dict(zip(item_names['name'], item_names['item_id']))

    _dict = {}
    for entry in raw:
        tm_num = int(entry['tm'].replace('TM', ''))
        move_name = entry.get('move')
        move_id = name_to_move_id.get(move_name) if move_name else None
        if move_id is not None:
            move_id = int(move_id)

        materials = []
        all_resolved = True
        for mat in entry.get('materials', []):
            item_id = name_to_item_id.get(mat['name'])
            if item_id is None:
                all_resolved = False
                break
            materials.append({
                'item_id': int(item_id),
                'name': mat['name'],
                'quantity': mat['quantity'],
            })

        # Skip recipes with unresolved materials (e.g. DLC items not in PokeAPI)
        if not all_resolved or move_id is None:
            continue

        _dict[tm_num] = {
            'tm_number': tm_num,
            'move_id': move_id,
            'move_name': move_name,
            'lp_cost': entry.get('lpCost', 0),
            'materials': materials,
        }

    return _dict


# ---------------------------------------------------------------------------
# Module-level constants — populated at import time
# ---------------------------------------------------------------------------

class ExperienceTable:
    """XP required per level per growth rate. Lookup: table[growth_rate_id] -> {level: xp, ...}"""
    def __init__(self):
        df = pd.read_csv(_csv('experience.csv')).drop(columns=['id'])

        self._dict = {}
        for growth_rate_id, group in df.groupby('growth_rate_id'):
            self._dict[int(growth_rate_id)] = {
                int(row['level']): int(row['experience']) for _, row in group.iterrows()
            }

    def __getitem__(self, growth_rate_id: int):
        return self._dict.get(growth_rate_id)

    def xp_for_level(self, growth_rate_id: int, level: int):
        table = self._dict.get(growth_rate_id)
        if table:
            return table.get(level)
        return None


POKEMON = build_pokemon()
NATURES = build_natures()
MACHINES = build_machines()
TM_CRAFTING = build_tm_crafting()
STATS = build_stats()
TYPES = build_types()
BERRIES = build_berries()
ITEM_FLAGS = build_item_flags()
STATUS_CONDITIONS = build_status_conditions()

MOVES = build_moves()
MOVE_EFFECTS = build_move_effects()
MOVE_FLAGS = build_move_flags()
CONTEST_EFFECTS = build_contest_effects()
CONTEST_TYPES = build_contest_types()
CONTEST_COMBOS = build_contest_combos()
ABILITIES = build_abilities()
ITEMS = build_items()

LOCATIONS = build_locations()
LOCATION_AREAS = build_location_areas()
ENCOUNTER_METHODS = build_encounter_methods()
ENCOUNTERS = build_encounters()

DAMAGE_TABLE = {d['id']: d['efficacy'] for d in TYPES.values()}


def damage_multiplier(attack_type_id: int, receiving_type_id: int) -> float:
    """Return the damage multiplier for a given type combination"""
    return DAMAGE_TABLE.get(attack_type_id, {}).get(receiving_type_id, 1)


def build_id_to_name():
    def _lookup(csv_path, id_col, name_col, lang_col='local_language_id'):
        """Build a simple {id: name} dict from a localized CSV, English only."""
        df = pd.read_csv(csv_path)
        df = df[df[lang_col] == 9]
        return dict(zip(df[id_col], df[name_col]))

    _dict = dict()

    _dict['statuses'] = {v['id']: v['name'] for v in STATUS_CONDITIONS.values()}

    _dict['evolution_triggers'] = _lookup(_csv('evolution_trigger_prose.csv'), 'evolution_trigger_id', 'name')
    _dict['egg_groups'] = _lookup(_csv('egg_group_prose.csv'), 'egg_group_id', 'name')
    _dict['move_ailments'] = _lookup(_csv('move_meta_ailment_names.csv'), 'move_meta_ailment_id', 'name')
    _dict['move_categories'] = _lookup(_csv('move_meta_category_prose.csv'), 'move_meta_category_id', 'description')
    _dict['move_damage_classes'] = _lookup(_csv('move_damage_class_prose.csv'), 'move_damage_class_id', 'name')
    _dict['growth_rates'] = _lookup(_csv('growth_rate_prose.csv'), 'growth_rate_id', 'name')
    _dict['pokemon_colors'] = _lookup(_csv('pokemon_color_names.csv'), 'pokemon_color_id', 'name')
    _dict['pokemon_habitats'] = _lookup(_csv('pokemon_habitat_names.csv'), 'pokemon_habitat_id', 'name')
    _dict['pokemon_shapes'] = _lookup(_csv('pokemon_shape_prose.csv'), 'pokemon_shape_id', 'name')
    move_methods_df = pd.read_csv(_csv('pokemon_move_methods.csv'))
    _dict['move_methods'] = dict(zip(move_methods_df['id'], move_methods_df['identifier']))
    _dict['berry_firmness'] = _lookup(_csv('berry_firmness_names.csv'), 'berry_firmness_id', 'name')
    contest_names = pd.read_csv(_csv('contest_type_names.csv'))
    contest_names_en = contest_names[contest_names['local_language_id'] == 9]
    _dict['contest_flavors'] = {
        row['contest_type_id']: row['flavor']
        for _, row in contest_names_en.iterrows()
    }
    _dict['contest_types'] = {
        row['contest_type_id']: row['name']
        for _, row in contest_names_en.iterrows()
    }

    # Derived from build_xxx constants
    _dict['types'] = {v['id']: v['name'] for v in TYPES.values()}
    _dict['natures'] = {v['id']: v['name'] for v in NATURES.values()}
    _dict['stats'] = {v['id']: v['name'] for v in STATS.values()}
    _dict['item_flags'] = {v['id']: v['name'] for v in ITEM_FLAGS.values()}
    _dict['berries'] = {v['id']: v['name'] for v in BERRIES.values()}
    _dict['abilities'] = {v['id']: v['name'] for v in ABILITIES.values()}
    _dict['items'] = {v['id']: v['name'] for v in ITEMS.values()}
    _dict['move_flags'] = {v['id']: v['name'] for v in MOVE_FLAGS.values()}
    _dict['moves'] = {v['id']: v['name'] for v in MOVES.values()}
    _dict['pokemon'] = {v['id']: v['name'] for v in POKEMON.values()}

    return _dict

ID_TO_NAME = build_id_to_name()


def get_by_key(collection: dict | list,
                value: str | int,
                key: str | int = 'name'):
    if isinstance(collection, dict):
        collection = collection.values()
    return [item for item in collection if item[key] == value]
