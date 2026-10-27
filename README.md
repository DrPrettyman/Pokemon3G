# pokedex-data

Pokemon data extraction pipeline and battle engine covering **Generations 1-9**.

Reads [PokeAPI](https://github.com/PokeAPI/pokeapi) CSV files (originally from [veekun/pokedex](https://github.com/veekun/pokedex)), processes them through a Python pipeline, and outputs a compact JSON module consumed by a TypeScript battle engine ([`pokedata3g/`](pokedata3g)).

The battle engine uses **Gen 3 core mechanics** (damage formula, accuracy, status, weather, field effects) with **Gen 4+ overlays** for the per-move physical/special split, Gen 4-9 abilities, ability-triggered form changes, terrain, and primal weather.

## What's included

| Data | Count | Notes |
|------|-------|-------|
| Species | ~1024 | Sprite-gated via DS-style sprites. Megas included (96 forms). Gmax / Tera excluded |
| Moves | ~917 | All gens, current stats, per-move physical/special split |
| Types | 18 | Including Fairy (Gen 6) |
| Natures | 25 | |
| Abilities | ~304 | Structured trigger/effect/args for all abilities (~100 effect types) |
| Items | ~2175 | ~453 with structured battle/use effects |
| TM Crafting | 202 | Scarlet/Violet recipes (move + materials + LP cost) |
| Berries | 64 | All gens |
| Status conditions | 21 | Volatile + non-volatile |
| Evolutions | Deduplicated | Non-Gen-3 methods remapped, random-form support |
| Sprites | ~11000 | Pokemon (front/back/shiny/icon) + 878 item icons |
| Cries | 1024 | Pokemon cry audio mp3s (from Pokemon Showdown) |

## Battle engine highlights

- **Full Gen 3 damage formula** with per-move physical/special split
- **Weather (4) + primal weather (3)** — Heavy Rain, Harsh Sun, Strong Winds
- **Terrain (4)** — Electric / Grassy / Psychic / Misty with grounded checks, type boosts, status prevention, priority blocking, end-of-turn healing, Earthquake halving
- **~55 move mechanics** including two-turn moves, Counter/Mirror Coat, Substitute, Baton Pass, Perish Song, Wish, Future Sight, Trick, Mimic, Sketch, Transform, Sleep Talk, Metronome, Conversion 2, Camouflage, Stockpile/Spit Up/Swallow, Magic Coat, Snatch
- **Ability effects wired into battle** — Technician, Adaptability, Mold Breaker, Unaware, Contrary, Simple, Magic Guard/Bounce, Scrappy, Infiltrator, Prankster, priority block (Queenly Majesty), move type change (Pixilate/Refrigerate/Aerilate/Galvanize/Normalize), Protean/Libero, Parental Bond, Skill Link, Filter/Solid Rock, Multiscale, Sniper, Super Luck, Sheer Force, Tinted Lens, Analytic, Stakeout, pinch boosts (Overgrow/Blaze/Torrent/Swarm), and more
- **Ability-triggered form changes** — Zen Mode, Shields Down, Disguise, Schooling, Stance Change, Battle Bond
- **Held items, Pokeballs (full Gen 3 formula), EXP/EV distribution, breeding/daycare/eggs, PC storage, contests**

## Quick start

```bash
# Download PokeAPI CSVs (if not present)
python setup.py

# Generate the npm module (data.json, sprites, animations)
python python-scripts/generate/data_json.py

# Run tests
cd pokedata3g && npx vitest run
```

## Project structure

```
python-scripts/
  extract/          CSV extraction, structured effect JSONs, evolution remappings
  generate/         Scripts that produce output files (data.json, sprites, animations)
  raw-assets/       Input data: PokeAPI CSVs, DS-style sprites, decomp repos
  extracted-assets/ Generated sprite outputs and animation JSON
pokedata3g/         TypeScript npm module with battle engine
plan.md             Project status and remaining work
```

See [CLAUDE.md](CLAUDE.md) for detailed conventions and architecture, and [pokedata3g/README.md](pokedata3g/README.md) for the full TypeScript API.

## License

This software is copyrighted and licensed under the [MIT license](https://github.com/DrPrettyman/Pokemon3G/blob/master/LICENSE).

### Disclaimer

This software comes bundled with data and graphics extracted from the Pokemon series of video games. Some terminology from the Pokemon franchise is also necessarily used within the software itself. This is all the intellectual property of Nintendo, Creatures, inc., and GAME FREAK, inc. and is protected by various copyrights and trademarks.

The author believes that the use of this intellectual property for a fan reference is covered by fair use and that the software is significantly impaired without said property included. Any use of this copyrighted property is at your own legal risk.

This software is not affiliated in any way with Nintendo, Pokemon or any other game company.
