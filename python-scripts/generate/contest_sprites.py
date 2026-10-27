#!/usr/bin/env python3
"""Copy contest UI graphics from the Emerald decomp to pokedata3g sprites."""

import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from paths import DECOMP_DIR, POKEDATA_DIR

SRC = os.path.join(DECOMP_DIR, 'emerald', 'graphics', 'contest')
DEST = os.path.join(POKEDATA_DIR, 'sprites', 'contest')


def main():
    if not os.path.isdir(SRC):
        print(f'Source directory not found: {SRC}')
        return

    if os.path.exists(DEST):
        shutil.rmtree(DEST)
    os.makedirs(DEST, exist_ok=True)

    count = 0
    for item in os.listdir(SRC):
        src_path = os.path.join(SRC, item)
        dest_path = os.path.join(DEST, item)
        if item == 'japanese':
            continue  # Skip localization variant
        if os.path.isdir(src_path):
            shutil.copytree(src_path, dest_path)
            count += sum(len(files) for _, _, files in os.walk(dest_path))
        else:
            shutil.copy2(src_path, dest_path)
            count += 1

    print(f'Copied {count} contest graphics to {DEST}/')


if __name__ == '__main__':
    main()
