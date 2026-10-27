import json
import os

from lookups import build_items

_DIR = os.path.dirname(os.path.abspath(__file__))

RAW_ITEMS = build_items()

with open(os.path.join(_DIR, 'item_effects.json')) as f:
    ITEM_EFFECTS = json.load(f)

ITEMS = {}

for category_id, category in ITEM_EFFECTS.items():
    for item_id_str, effects in category['effects'].items():
        item_id = int(item_id_str)
        raw = RAW_ITEMS[item_id]
        ITEMS[item_id] = {
            **raw,
            'category': category['category_name'],
            'effects': effects,
        }
