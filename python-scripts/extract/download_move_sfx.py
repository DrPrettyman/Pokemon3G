"""
Download Gen 3 battle move sound effects as mp3s into
`python-scripts/raw-assets/move-sfx/`.

Source: khinsider's "Pokemon SFX Gen 3 - Attack Moves - RSE, FR, LG (GBA)"
album, which hosts each decomp `SE_M_*` cue as an individual track ripped
directly from the GBA ROMs:

    https://downloads.khinsider.com/game-soundtracks/album/pokemon-sfx-gen-3-attack-moves-rse-fr-lg

Since Gen 4-9 moves reuse Gen 3 battle animations via
`move_animation_map.json`, they also reuse the Gen 3 `playsewithpan` refs
embedded inside those animation scripts — so the Gen 3 album covers 100%
of the 128 unique `SE_M_*` identifiers found in `animations.json`.

Two-step fetch per track because khinsider rotates a per-track directory
hash on the CDN:
  1. Fetch the album page once to enumerate all track filenames.
  2. For each `SE_M_*` we need, fetch its track page and parse the direct
     vgmtreasurechest.com mp3 URL out of the HTML, then download the mp3.

Output filenames normalize back to the `SE_M_*` convention used in
animations.json (e.g. `SE_M_BUBBLE_BEAM2` -> `se_m_bubble_beam2.mp3`),
which is what `sound_index.json` keys off.

Idempotent + parallelized. Run with `python python-scripts/extract/download_move_sfx.py`.
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from paths import MOVE_SFX_DIR, POKEDATA_DIR

ALBUM_SLUG = "pokemon-sfx-gen-3-attack-moves-rse-fr-lg"
ALBUM_URL = f"https://downloads.khinsider.com/game-soundtracks/album/{ALBUM_SLUG}"
USER_AGENT = "veekun-pokedex-data/1.0 (move sfx extraction)"
MAX_WORKERS = 8

# SE_M_* names whose khinsider track doesn't fall out of the default
# candidate generator. Values are exact khinsider filenames (without .mp3).
# For `*2` / `*3` variants that khinsider doesn't rip separately, we fall
# back to the base cue — the decomp often uses *2 as a pitch-shifted replay,
# which is an acceptable loss at playback time.
MANUAL_OVERRIDES = {
    "SE_M_BONEMERANG": "Bonemerang 1hit",
    "SE_M_BUBBLE3": "Bubble",
    "SE_M_COMET_PUNCH": "Comet Punch 1hit",
    "SE_M_DOUBLE_SLAP": "Double Slap 1hit",
    "SE_M_ENCORE2": "Encore",
    "SE_M_FAINT_ATTACK": "Feint Attack",
    "SE_M_GRASSWHISTLE": "Grass Whistle",
    "SE_M_GUST2": "Gust",
    "SE_M_HYPER_BEAM2": "Hyper Beam",
    "SE_M_MEGA_KICK2": "Mega Kick",
    "SE_M_PSYBEAM2": "Psybeam",
    "SE_M_RAZOR_WIND2": "Razor Wind",
    "SE_M_STAT_INCREASE": "Stat Rise Up",
    "SE_M_STRING_SHOT2": "String Shot",
    "SE_M_SWAGGER2": "Swagger",
    "SE_M_TRI_ATTACK2": "Tri Attack",
    "SE_M_VICEGRIP": "Vice Grip",
    "SE_M_VITAL_THROW2": "Vital Throw",
}


def _request(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def load_se_m_refs() -> list[str]:
    """Walk animations.json and collect every unique SE_M_* string."""
    with open(os.path.join(POKEDATA_DIR, "src", "animations.json")) as f:
        anims = json.load(f)
    found: set[str] = set()

    def walk(x):
        if isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
        elif isinstance(x, str) and x.startswith("SE_M_"):
            found.add(x)

    walk(anims)
    return sorted(found)


def load_album_tracks() -> list[str]:
    """Return the set of track filenames (without .mp3) hosted on the album."""
    html = _request(ALBUM_URL).decode("utf-8", errors="replace")
    pattern = rf'/game-soundtracks/album/{re.escape(ALBUM_SLUG)}/([^"]+\.mp3)'
    names: set[str] = set()
    for m in re.finditer(pattern, html):
        # Album page double-URL-encodes href values.
        name = urllib.parse.unquote(urllib.parse.unquote(m.group(1)))
        names.add(name[:-4])  # strip .mp3
    return sorted(names)


def _norm(s: str) -> str:
    s = s.lower().replace("_", " ")
    s = re.sub(r"[^a-z0-9 ]+", "", s)
    return re.sub(r"\s+", " ", s).strip()


def resolve_mapping(se_ms: list[str], tracks: list[str]) -> tuple[dict[str, str], list[str]]:
    """Map each SE_M_* to a khinsider track name. Returns (mapping, missing)."""
    by_norm = {_norm(t): t for t in tracks}

    def candidates(se: str) -> list[str]:
        base = se[5:]  # strip SE_M_
        cands: list[str] = []
        m = re.match(r"^(.*?)_?(\d+)$", base)
        if m:
            stem, n = m.groups()
            stem_sp = stem.replace("_", " ")
            cands += [f"{stem_sp} part {n}", f"{stem_sp} {n}"]
        cands.append(base.replace("_", " "))
        return cands

    mapping: dict[str, str] = {}
    missing: list[str] = []
    for se in se_ms:
        if se in MANUAL_OVERRIDES:
            track = MANUAL_OVERRIDES[se]
            if track not in tracks:
                raise RuntimeError(f"Manual override track not found on khinsider: {track!r}")
            mapping[se] = track
            continue
        hit = None
        for c in candidates(se):
            key = _norm(c)
            if key in by_norm:
                hit = by_norm[key]
                break
        if hit:
            mapping[se] = hit
        else:
            missing.append(se)
    return mapping, missing


def resolve_mp3_url(track_name: str) -> str:
    """Scrape a track page to find the direct mp3 URL on the CDN."""
    # khinsider track URLs are single-encoded (spaces -> %20).
    track_url = f"{ALBUM_URL}/{urllib.parse.quote(track_name)}.mp3"
    html = _request(track_url).decode("utf-8", errors="replace")
    m = re.search(r'https://[^"]*/' + re.escape(urllib.parse.quote(track_name)) + r'\.mp3', html)
    if not m:
        # khinsider sometimes renders spaces without percent-encoding.
        m = re.search(r'https://[^"\s]+\.mp3', html)
    if not m:
        raise RuntimeError(f"Could not locate direct mp3 link on track page for {track_name!r}")
    return m.group(0)


def out_filename(se: str) -> str:
    return f"{se.lower()}.mp3"


def download_one(se: str, track: str, out_dir: Path) -> tuple[str, str]:
    dest = out_dir / out_filename(se)
    if dest.exists() and dest.stat().st_size > 0:
        return se, "skipped"
    mp3_url = resolve_mp3_url(track)
    data = _request(mp3_url)
    dest.write_bytes(data)
    return se, f"downloaded ({len(data)} bytes)"


def main() -> None:
    out_dir = Path(MOVE_SFX_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("Enumerating SE_M_* references in animations.json ...")
    se_ms = load_se_m_refs()
    print(f"  found {len(se_ms)} unique cues")

    print("Fetching khinsider album track list ...")
    tracks = load_album_tracks()
    print(f"  found {len(tracks)} tracks on album")

    mapping, missing = resolve_mapping(se_ms, tracks)
    print(f"Mapped {len(mapping)}/{len(se_ms)} cues to khinsider tracks")
    if missing:
        print("Unmapped cues (will NOT be downloaded):")
        for m in missing:
            print(f"  - {m}")

    print(f"Downloading into {out_dir} (parallel, idempotent) ...")
    ok = fail = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(download_one, se, tr, out_dir): se for se, tr in mapping.items()}
        for fut in as_completed(futures):
            se = futures[fut]
            try:
                _, status = fut.result()
                ok += 1
                if status != "skipped":
                    print(f"  {se}: {status}")
            except Exception as e:
                fail += 1
                print(f"  {se}: FAILED — {e}")

    print(f"Done. {ok} ok, {fail} failed, {len(missing)} unmapped.")

    # Persist mapping so downstream steps (sound_index.json) don't need to
    # re-scrape khinsider.
    with open(out_dir / "_mapping.json", "w") as f:
        json.dump({"mapping": mapping, "missing": missing}, f, indent=2)


if __name__ == "__main__":
    main()
