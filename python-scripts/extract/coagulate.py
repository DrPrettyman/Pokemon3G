import pandas as pd

import lookups


class ExperienceTable:
    """XP required per level per growth rate. Lookup: table[growth_rate_id] -> {level: xp, ...}"""
    def __init__(self):
        df = pd.read_csv('assets/veekun-csv/experience.csv').drop(columns=['id'])

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


POKEMON = lookups.build_pokemon()
NATURES = lookups.build_natures()
MACHINES = lookups.build_machines()
STATS = lookups.build_stats()
TYPES = lookups.build_types()
BERRIES = lookups.build_berries()
ITEM_FLAGS = lookups.build_item_flags()
STATUS_CONDITIONS = lookups.build_status_conditions()

MOVES = lookups.build_moves()
MOVE_EFFECTS = lookups.build_move_effects()
MOVE_FLAGS = lookups.build_move_flags()
CONTEST_EFFECTS = lookups.build_contest_effects()
ABILITIES = lookups.build_abilities()
ITEMS = lookups.build_items()

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

    # Simple _lookup ones (dict[int, str])
    _dict['evolution_triggers'] = _lookup('assets/veekun-csv/evolution_trigger_prose.csv', 'evolution_trigger_id', 'name')
    _dict['egg_groups'] = _lookup('assets/veekun-csv/egg_group_prose.csv', 'egg_group_id', 'name')
    _dict['move_ailments'] = _lookup('assets/veekun-csv/move_meta_ailment_names.csv', 'move_meta_ailment_id', 'name')
    _dict['move_categories'] = _lookup('assets/veekun-csv/move_meta_category_prose.csv', 'move_meta_category_id', 'description')
    _dict['move_damage_classes'] = _lookup('assets/veekun-csv/move_damage_class_prose.csv', 'move_damage_class_id', 'name')
    _dict['growth_rates'] = _lookup('assets/veekun-csv/growth_rate_prose.csv', 'growth_rate_id', 'name')
    _dict['pokemon_colors'] = _lookup('assets/veekun-csv/pokemon_color_names.csv', 'pokemon_color_id', 'name')
    _dict['pokemon_habitats'] = _lookup('assets/veekun-csv/pokemon_habitat_names.csv', 'pokemon_habitat_id', 'name')
    _dict['pokemon_shapes'] = _lookup('assets/veekun-csv/pokemon_shape_prose.csv', 'pokemon_shape_id', 'name')
    _dict['move_methods'] = dict(zip(
        pd.read_csv('assets/veekun-csv/pokemon_move_methods.csv')['id'],
        pd.read_csv('assets/veekun-csv/pokemon_move_methods.csv')['identifier'],
    ))
    _dict['berry_firmness'] = _lookup('assets/veekun-csv/berry_firmness_names.csv', 'berry_firmness_id', 'name')
    _dict['contest_flavors'] = {
        row['contest_type_id']: row['flavor']
        for _, row in pd.read_csv('assets/veekun-csv/contest_type_names.csv')[
            lambda d: d['local_language_id'] == 9
        ].iterrows()
    }
    _dict['contest_types'] = {
        row['contest_type_id']: row['name']
        for _, row in pd.read_csv('assets/veekun-csv/contest_type_names.csv')[
            lambda d: d['local_language_id'] == 9
        ].iterrows()
    }

    # Derived from build_xxx ones (extract id -> name)
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
