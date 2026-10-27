"""Shared path constants for the data pipeline."""

import os

# python-scripts/ directory (project root for the pipeline)
PYTHON_DIR = os.path.dirname(os.path.abspath(__file__))

# Input data
RAW_ASSETS = os.path.join(PYTHON_DIR, 'raw-assets')
CSV_DIR = os.path.join(RAW_ASSETS, 'pokeapi-csv')
ITEM_SPRITES_RAW = os.path.join(RAW_ASSETS, 'item-sprites-raw')
DS_SPRITES_DIR = os.path.join(RAW_ASSETS, 'ds-style-sprites')
POKESPRITE_ITEMS_DIR = os.path.join(RAW_ASSETS, 'pokesprite-items')
POKEMON_CRIES_DIR = os.path.join(RAW_ASSETS, 'pokemon-cries')
MOVE_SFX_DIR = os.path.join(RAW_ASSETS, 'move-sfx')
DECOMP_DIR = os.path.join(RAW_ASSETS, 'decomp-hacks')

# Output data
EXTRACTED_ASSETS = os.path.join(PYTHON_DIR, 'extracted-assets')
FOOTPRINT_DIR = os.path.join(EXTRACTED_ASSETS, 'footprint')

# Extract module data files
EXTRACT_DIR = os.path.join(PYTHON_DIR, 'extract')

# npm module output
POKEDATA_DIR = os.path.join(PYTHON_DIR, '..', 'pokedata3g')
