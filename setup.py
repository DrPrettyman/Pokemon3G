#!/usr/bin/env python3
"""Download external data assets into python-scripts/raw-assets/."""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile

POKEAPI_REPO_URL = "https://github.com/PokeAPI/pokeapi.git"
POKEAPI_CSV_SUBDIR = "data/v2/csv"
POKEAPI_OUTPUT_DIR = os.path.join("python-scripts", "raw-assets", "pokeapi-csv")

POKESPRITE_REPO_URL = "https://github.com/msikma/pokesprite.git"
POKESPRITE_ITEMS_SUBDIR = "items"
POKESPRITE_OUTPUT_DIR = os.path.join("python-scripts", "raw-assets", "pokesprite-items")

DS_SPRITES_REPO_URL = "https://github.com/DrPrettyman/PokemonSprites-64x64DSStyle.git"
DS_SPRITES_SUBDIR = "sprites-processed"
DS_SPRITES_OUTPUT_DIR = os.path.join("python-scripts", "raw-assets", "ds-style-sprites")

ITEM_SPRITES_SUBDIR = "item-sprites-raw"
ITEM_SPRITES_OUTPUT_DIR = os.path.join("python-scripts", "raw-assets", "item-sprites-raw")

FOOTPRINTS_SUBDIR = "footprints"
FOOTPRINTS_OUTPUT_DIR = os.path.join("python-scripts", "extracted-assets", "footprint")


def sparse_clone(repo_url, subdir, tmp_dir, name):
    """Shallow sparse clone of a single directory from a repo."""
    clone_dir = os.path.join(tmp_dir, name)
    subprocess.run(
        ["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse", repo_url, clone_dir],
        check=True,
    )
    subprocess.run(
        ["git", "-C", clone_dir, "sparse-checkout", "set", subdir],
        check=True,
    )
    return os.path.join(clone_dir, subdir)


def download_pokeapi_csvs(project_root, tmp_dir):
    output_path = os.path.join(project_root, POKEAPI_OUTPUT_DIR)
    print(f"Downloading PokeAPI CSV data from {POKEAPI_REPO_URL}")

    src = sparse_clone(POKEAPI_REPO_URL, POKEAPI_CSV_SUBDIR, tmp_dir, "pokeapi")

    csv_files = [f for f in os.listdir(src) if f.endswith(".csv")]
    if not csv_files:
        print("Error: no CSV files found in cloned repo", file=sys.stderr)
        sys.exit(1)

    os.makedirs(output_path, exist_ok=True)

    # Clear existing CSVs so removed upstream files don't linger
    for f in os.listdir(output_path):
        if f.endswith(".csv"):
            os.remove(os.path.join(output_path, f))

    for f in sorted(csv_files):
        shutil.copy2(os.path.join(src, f), output_path)

    print(f"Copied {len(csv_files)} CSV files to {POKEAPI_OUTPUT_DIR}/")


def download_pokesprite_items(project_root, tmp_dir):
    output_path = os.path.join(project_root, POKESPRITE_OUTPUT_DIR)
    print(f"Downloading pokesprite item icons from {POKESPRITE_REPO_URL}")

    src = sparse_clone(POKESPRITE_REPO_URL, POKESPRITE_ITEMS_SUBDIR, tmp_dir, "pokesprite")

    # Copy the entire items tree (preserving subdirectory structure)
    if os.path.exists(output_path):
        shutil.rmtree(output_path)
    shutil.copytree(src, output_path)

    file_count = sum(len(files) for _, _, files in os.walk(output_path))
    print(f"Copied {file_count} files to {POKESPRITE_OUTPUT_DIR}/")


def download_ds_style_sprites(project_root, tmp_dir):
    output_path = os.path.join(project_root, DS_SPRITES_OUTPUT_DIR)
    print(f"Downloading DS-style 64x64 sprites from {DS_SPRITES_REPO_URL}")

    src = sparse_clone(DS_SPRITES_REPO_URL, DS_SPRITES_SUBDIR, tmp_dir, "ds-sprites")

    if os.path.exists(output_path):
        shutil.rmtree(output_path)
    shutil.copytree(src, output_path)

    file_count = sum(len(files) for _, _, files in os.walk(output_path))
    print(f"Copied {file_count} files to {DS_SPRITES_OUTPUT_DIR}/")


def download_item_sprites(project_root, tmp_dir):
    output_path = os.path.join(project_root, ITEM_SPRITES_OUTPUT_DIR)
    print(f"Downloading item sprite sources from {DS_SPRITES_REPO_URL}")

    src = sparse_clone(DS_SPRITES_REPO_URL, ITEM_SPRITES_SUBDIR, tmp_dir, "item-sprites")

    if os.path.exists(output_path):
        shutil.rmtree(output_path)
    shutil.copytree(src, output_path)

    file_count = sum(len(files) for _, _, files in os.walk(output_path))
    print(f"Copied {file_count} files to {ITEM_SPRITES_OUTPUT_DIR}/")


def download_footprints(project_root, tmp_dir):
    output_path = os.path.join(project_root, FOOTPRINTS_OUTPUT_DIR)
    print(f"Downloading footprint sprites from {DS_SPRITES_REPO_URL}")

    src = sparse_clone(DS_SPRITES_REPO_URL, FOOTPRINTS_SUBDIR, tmp_dir, "footprints")

    if os.path.exists(output_path):
        shutil.rmtree(output_path)
    shutil.copytree(src, output_path)

    file_count = sum(len(files) for _, _, files in os.walk(output_path))
    print(f"Copied {file_count} files to {FOOTPRINTS_OUTPUT_DIR}/")


def download_pokemon_cries(project_root):
    """Fetch Pokemon cry mp3s from Pokemon Showdown.

    This is delegated to a dedicated script in python-scripts/extract/ because
    it needs to import the csv_data module to know which species to fetch
    (sprite-gated), and the fetch logic is parallelized and idempotent.
    """
    print("Downloading Pokemon cries from play.pokemonshowdown.com/audio/cries/")
    script = os.path.join(project_root, "python-scripts", "extract", "download_cries.py")
    subprocess.run([sys.executable, script], check=True)


STEPS = {
    "pokeapi-csvs": ("sparse", download_pokeapi_csvs),
    "pokesprite-items": ("sparse", download_pokesprite_items),
    "ds-style-sprites": ("sparse", download_ds_style_sprites),
    "item-sprites-raw": ("sparse", download_item_sprites),
    "footprints": ("sparse", download_footprints),
    "pokemon-cries": ("plain", download_pokemon_cries),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "steps",
        nargs="*",
        choices=list(STEPS.keys()) + [[]],
        default=[],
        help="Optional subset of steps to run. Defaults to all.",
    )
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.abspath(__file__))
    selected = args.steps or list(STEPS.keys())

    needs_tmp = any(STEPS[name][0] == "sparse" for name in selected)
    tmp_ctx = tempfile.TemporaryDirectory() if needs_tmp else None
    try:
        tmp = tmp_ctx.name if tmp_ctx else None
        for name in selected:
            kind, fn = STEPS[name]
            if kind == "sparse":
                fn(project_root, tmp)
            else:
                fn(project_root)
    finally:
        if tmp_ctx:
            tmp_ctx.cleanup()


if __name__ == "__main__":
    main()
