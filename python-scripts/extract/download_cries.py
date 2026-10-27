"""
Download Pokemon cry audio files from Pokemon Showdown into
`python-scripts/raw-assets/pokemon-cries/`.

Showdown hosts one cry per base species at:
    https://play.pokemonshowdown.com/audio/cries/<slug>.mp3

The slug is the lowercase species name with all non-alphanumeric characters
stripped, e.g.:
    Darmanitan      -> darmanitan
    Mr. Mime        -> mrmime
    Ho-Oh           -> hooh
    Porygon-Z       -> porygonz
    Chi-Yu          -> chiyu
    Farfetch'd      -> farfetchd
    Tapu Koko       -> tapukoko

For Nidoran♂/♀, Showdown uses "nidoranm"/"nidoranf" derived from the PokeAPI
identifier rather than the display name (the ♂/♀ symbols would strip to a
colliding "nidoran"), so we fall back to the PokeAPI identifier in that case.

Form variants share the base species cry (Showdown does not host form-specific
audio), so the downloader only fetches one file per species.

The script is gated by `csv_data.POKEMON` (which itself is sprite-gated), so
only species present in the rest of the pipeline are fetched. Idempotent: skips
species whose mp3 already exists.
"""
import os
import re
import sys
import unicodedata
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Allow running as a module (`python -m extract.download_cries`) or directly.
sys.path.insert(0, str(Path(__file__).parent.parent))
from extract import csv_data
from paths import POKEMON_CRIES_DIR

CRY_URL_TEMPLATE = "https://play.pokemonshowdown.com/audio/cries/{slug}.mp3"
USER_AGENT = "veekun-pokedex-data/1.0 (data pipeline setup)"
MAX_WORKERS = 16


def _strip(s: str) -> str:
    """Lowercase, unicode-normalize accented chars to ASCII (é → e),
    then strip all non-alphanumeric characters."""
    # NFKD decomposes é into "e" + combining accent; ASCII encode drops the accent
    ascii_s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", ascii_s.lower())


def cry_slug(species: dict) -> str | None:
    """
    Compute the Showdown cry URL slug for a species.

    Uses the display name first (works for multi-form species where the
    PokeAPI identifier has a form suffix), then falls back to the PokeAPI
    identifier for edge cases like Nidoran♂/♀ where the display name would
    lose the gender distinction.
    """
    name = species.get("name")
    if name:
        slug = _strip(name)
        # Nidoran♂/♀ both strip to "nidoran" — use identifier for disambiguation.
        if slug == "nidoran":
            slug = None  # force fallback
        elif slug:
            return slug

    ident = species.get("identifier")
    if isinstance(ident, str):
        return _strip(ident) or None
    if isinstance(ident, dict):
        if 0 in ident:
            return _strip(ident[0]) or None
        for k in sorted(ident.keys()):
            return _strip(ident[k]) or None
    return None


def download_one(slug: str, dest: Path) -> tuple[str, str]:
    """Download a single cry file. Returns (slug, status) where status is
    one of 'ok', 'exists', 'missing', 'error'."""
    if dest.exists() and dest.stat().st_size > 0:
        return (slug, "exists")

    url = CRY_URL_TEMPLATE.format(slug=slug)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
        dest.write_bytes(data)
        return (slug, "ok")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return (slug, "missing")
        return (slug, f"error:{e.code}")
    except Exception as e:
        return (slug, f"error:{type(e).__name__}")


def main() -> None:
    output_dir = Path(POKEMON_CRIES_DIR)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Build: species_id -> cry slug, deduplicating shared slugs
    species_to_slug: dict[int, str] = {}
    slug_to_species: dict[str, int] = {}
    for sid, species in csv_data.POKEMON.items():
        slug = cry_slug(species)
        if not slug:
            continue
        species_to_slug[sid] = slug
        slug_to_species.setdefault(slug, sid)

    unique_slugs = sorted(set(species_to_slug.values()))
    print(
        f"Downloading {len(unique_slugs)} Pokemon cries from Showdown into "
        f"{POKEMON_CRIES_DIR}/ ..."
    )

    counts = {"ok": 0, "exists": 0, "missing": 0, "error": 0}
    missing: list[str] = []
    errors: list[tuple[str, str]] = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(download_one, slug, output_dir / f"{slug}.mp3"): slug
            for slug in unique_slugs
        }
        for i, future in enumerate(as_completed(futures), 1):
            slug, status = future.result()
            bucket = (
                "ok" if status == "ok"
                else "exists" if status == "exists"
                else "missing" if status == "missing"
                else "error"
            )
            counts[bucket] += 1
            if bucket == "missing":
                missing.append(slug)
            elif bucket == "error":
                errors.append((slug, status))
            if i % 100 == 0 or i == len(unique_slugs):
                print(
                    f"  {i}/{len(unique_slugs)}  "
                    f"downloaded={counts['ok']} "
                    f"cached={counts['exists']} "
                    f"missing={counts['missing']} "
                    f"error={counts['error']}"
                )

    print()
    print(f"Done. {counts['ok']} downloaded, {counts['exists']} already cached.")
    if missing:
        print(f"{len(missing)} species have no cry on Showdown:")
        for slug in sorted(missing)[:20]:
            sid = slug_to_species.get(slug)
            name = csv_data.POKEMON[sid]["name"] if sid else "?"
            print(f"  {slug}  ({name})")
        if len(missing) > 20:
            print(f"  ... and {len(missing) - 20} more")
    if errors:
        print(f"{len(errors)} download errors:")
        for slug, status in errors[:10]:
            print(f"  {slug}  {status}")


if __name__ == "__main__":
    main()
