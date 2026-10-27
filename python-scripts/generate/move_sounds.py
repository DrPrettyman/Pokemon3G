"""Copy move SFX mp3s into the battle-playground assets dir and emit a
`sound_index.json` that maps `SE_M_*` identifiers to their relative mp3 path.

The mp3s are downloaded by `python-scripts/extract/download_move_sfx.py` from
khinsider's Gen 3 attack-move album; this script is the deploy step that
makes them visible to the Phaser renderer.

Run:
    python python-scripts/generate/move_sounds.py
"""

import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from paths import MOVE_SFX_DIR, POKEDATA_DIR

BATTLE_PLAYGROUND = Path(POKEDATA_DIR).parent / "battle-playground"
SOUNDS_OUT_DIR = BATTLE_PLAYGROUND / "src" / "assets" / "sounds" / "move_sfx"
SOUND_INDEX_OUT = BATTLE_PLAYGROUND / "src" / "assets" / "sounds" / "sound_index.json"


def main() -> None:
    src_dir = Path(MOVE_SFX_DIR)
    mapping_file = src_dir / "_mapping.json"
    if not mapping_file.exists():
        raise SystemExit(
            f"{mapping_file} not found — run python-scripts/extract/download_move_sfx.py first"
        )
    with open(mapping_file) as f:
        payload = json.load(f)
    se_to_track: dict[str, str] = payload["mapping"]

    SOUNDS_OUT_DIR.mkdir(parents=True, exist_ok=True)

    index: dict[str, str] = {}
    copied = skipped = 0
    for se in sorted(se_to_track):
        src = src_dir / f"{se.lower()}.mp3"
        if not src.exists():
            print(f"  WARN: {src} missing — re-run the downloader")
            continue
        dest = SOUNDS_OUT_DIR / src.name
        if dest.exists() and dest.stat().st_size == src.stat().st_size:
            skipped += 1
        else:
            shutil.copy2(src, dest)
            copied += 1
        # Vite-friendly relative path, consumed by the animator.
        index[se] = f"move_sfx/{src.name}"

    with open(SOUND_INDEX_OUT, "w") as f:
        json.dump(index, f, indent=2, sort_keys=True)

    print(f"Copied {copied} mp3s ({skipped} up-to-date) into {SOUNDS_OUT_DIR}")
    print(f"Wrote sound_index.json with {len(index)} entries -> {SOUND_INDEX_OUT}")


if __name__ == "__main__":
    main()
