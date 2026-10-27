# pokedata3g — Project Plan

## Core Principle

**Minimize hardcoded game data in TypeScript.** Things not in the CSVs can be hardcoded in Python and written to JSON — the goal is avoiding hardcoding in TS specifically.

| Layer | Responsibility |
|-------|---------------|
| **PokeAPI CSVs** | Raw source of truth |
| **Python pipeline** | Extract, transform, curate |
| **data.json** | Complete, self-describing game data + mechanics |
| **TypeScript engine** | Generic interpreter. No Pokemon-specific knowledge. |

---

## Status

**Core work complete.** The battle engine covers Gen 3 mechanics with Gen 4-9 overlays for abilities, forms, terrain, primal weather, and niche moves. 160 deterministic tests passing. Ready for consumer integration.

Remaining items are lower-priority refactoring and consumer-facing polish — see **What's left** below.

---

## What's done

### Data pipeline (Python) — Gen 1-9
- **~1024 species** (sprite-gated via `processed_sprites.csv`). Megas included (96 forms). Gmax / Terastallization excluded.
- **~917 moves** with per-move physical/special split (Gen 4+ `damage_class_id`). Current stats, no changelog revert.
- **18 types** (incl. Fairy). 25 natures. **~304 abilities**. **~2175 items** (~453 with structured effects). **64 berries**. **21 status conditions**.
- **Move pools filtered to latest generation per Pokemon** (excludes spinoffs: Colosseum, XD, Let's Go, BDSP, Legends Arceus).
- **202 SV TM crafting recipes** (move + materials + LP cost, parsed from Serebii).
- **TMs/HMs**: Gen 3 only (58 entries). Gen 4-9 Pokemon get teachable moves via `teachable_moves`.
- **Locations / encounters**: Gen 3 only (Kanto + Hoenn).

### Structured effect JSONs
- **`item_effects.json`** — ~453 items across `pokemonEffects`, `battleEffects`, `overworldEffects`, `heldEffects` (plates, gems, type-resist berries, Choice items, Focus Sash, Life Orb, Mega Stones, Memories, terrain seeds, Poke Balls, fossils, vitamins, evolution items, etc.).
- **`ability_effects.json`** — all 304 abilities with trigger/effect/args across ~100 effect types (triggers: `passive`, `onSwitchIn`, `onSwitchOut`, `onContact`, `onHit`, `onPhysicalHit`, `onKO`, `onFaint`, `turnEnd`, `onStatus`, `onStatDrop`, `onLowHp`, `onFlinch`, `onCriticalHit`).
- **`move_animation_map.json`** — 563 Gen 4-9 moves mapped to Gen 3 animation IDs via `generate_move_animations.py`. Flag-aware scoring (punch/bite/pulse/bullet/sound/powder/dance) + 125 hand-picked overrides. 163 unique animation targets (up from 49 in the auto-generated version).
- **Pokemon cries** — `download_cries.py` fetches 1024 cry mp3s from Pokemon Showdown into `python-scripts/raw-assets/pokemon-cries/`. Gated by the sprite-gated species list, parallelized (16 workers), idempotent. Slug = lowercase species name with non-alphanumeric/non-ASCII stripped (Ho-Oh → `hooh`, Flabébé → `flabebe`), fallback to PokeAPI identifier for Nidoran♂/♀ disambiguation. All forms share the base species cry.
- **`evolution_remappings.json`** — 19 species with non-Gen-3 evolution methods remapped.
- **Evolution dedup**: multiple CSV rows collapsed, affection merged into happiness, sorted by specificity (Sylveon before Espeon), `remappingNote` field.

### Species media
- **Sprites** — DS-style front/back/shiny/icon (~11000 files), footprints, item icons (878). All copied into `pokedata3g/sprites/`.
- **Cries** — 1024 mp3 files, one per base species, copied into `pokedata3g/sounds/cries/`. Each species entry in data.json has a `cry` field (slug), and `PokeSpecies.getCry()` returns the resolved path.

### data.json mechanics
- `battleConfig` — Gen 3 constants (crit mult, STAB, damage roll, stat stages, spikes fractions, weather / terrain durations)
- `weatherMechanics` — rain / sun / sandstorm / hail + primal (heavy-rain, harsh-sun, strong-winds with `isPrimal`, `blocksMoveType`, `resistanceOverride`)
- `terrainMechanics` — electric / grassy / psychic / misty with type boosts, status prevention, priority block, end-of-turn heal, move halving
- `statusMechanics` — per-status behavior (action prevention, DOT fractions, stat multipliers, durations)
- `moveEffectMechanics` — two-turn flags, semi-invulnerable, charge stat boosts, weather skips, field effect durations, max layers, etc.
- `tmCrafting` — 202 SV crafting recipes keyed by TM number

### Battle system — Gen 3 core + Gen 4-9 overlays

**Core:** damage formula (per-move phys/special split), accuracy, status conditions (8), weather (4 + primal), terrain (4), field effects (Reflect, Light Screen, Safeguard, Mist, Spikes), Struggle, OHKO.

**Move mechanics (~55 effects):**
- Two-turn (data-driven via `moveEffectMechanics`), Protect/Detect/Endure, rampage, partial trapping
- Counter, Mirror Coat, Baton Pass, Rapid Spin, Mean Look/Block
- Perish Song, Destiny Bond, Grudge, Focus Energy, Substitute
- Rest, Heal Bell, Belly Drum, Pain Split, Curse (Ghost + non-Ghost)
- Wish, Future Sight/Doom Desire, Yawn, Trick
- Disable, Encore, Torment, Taunt, Imprison
- Mind Reader/Lock-On, Psych Up, Memento, Teleport, Spite
- Refresh, Conversion, Role Play, Skill Swap, Splash
- Mimic, Sketch, Transform, Sleep Talk, Metronome
- Conversion 2, Camouflage
- Stockpile / Spit Up / Swallow
- Magic Coat, Snatch
- Contact flag enforcement, force switch

**Ability effects wired into battle.ts:**
- Damage calc: Technician, Adaptability, type boosts (Steelworker), category boosts (Iron Fist, Strong Jaw, Mega Launcher, Reckless), Tinted Lens, Filter/Solid Rock/Prism Armor, Multiscale/Shadow Shield, Sniper, Super Luck, Sheer Force, weather type boosts (Sand Force), HP threshold (Defeatist), pinch boosts (Overgrow/Blaze/Torrent/Swarm), Flash Fire activation, Analytic, Stakeout, Fur Coat/Ice Scales, Huge/Pure Power/Hustle
- Mold Breaker / Turboblaze / Teravolt — bypass defender ability checks
- Scrappy (Normal/Fighting vs Ghost), Infiltrator (screens + sub), Bulletproof, Soundproof, No Guard
- Unaware, Contrary, Simple, Magic Guard, Magic Bounce
- Priority: Prankster, Queenly Majesty/Dazzling/Armor Tail
- Move type change (Pixilate/Refrigerate/Aerilate/Galvanize/Normalize) + Protean/Libero
- Parental Bond (2 hits, 2nd at 25%), Skill Link (multi-hit max)
- Overcoat + weather damage immunity
- Triggered: Moxie/Beast Boost (on-KO), Aftermath (on-faint), Defiant/Competitive (on-stat-drop), Weak Armor/Stamina (on-physical-hit), Steadfast (on-flinch), Anger Point (on-crit)
- Trapping abilities (Shadow Tag / Arena Trap)
- Switch-in: Intimidate, weather/terrain setters, Trace, primal weather (Primordial Sea / Desolate Land / Delta Stream)

**Ability-triggered form changes:**
- **Zen Mode** (Darmanitan, end-of-turn HP check; supports Galarian)
- **Shields Down** (Minior, meteor ↔ core forms, preserves color across 7 variants)
- **Disguise** (Mimikyu, blocks first hit, costs 1/8 max HP; Mold Breaker bypasses)
- **Schooling** (Wishiwashi, HP > 25% + level ≥ 20)
- **Stance Change** (Aegislash, Blade for damaging moves / Shield for King's Shield)
- **Battle Bond** (Greninja, on-KO form 2 → 3)

**Held items, Pokeballs, EXP/EV, Player, breeding, daycare, eggs, PokemonStorage, bag, item storage, contest system.**

### npm module (TypeScript)
- **160 deterministic tests passing** (battle, breeding, daycare, contest, gen9 expansion). A couple pre-existing flaky tests in battleAI/battle are RNG-dependent.
- Public API exports in `pokedata3g/src/index.ts` — species, moves, natures, types, abilities, items, berries, machines, **TM crafting**, locations, encounters, contests, status conditions, animations, battle config, weather / terrain / status / move-effect mechanics.
- Clean `package.json` metadata — description, keywords, author, MIT license, repository, bugs, homepage, `engines: node >=18`, `sideEffects: false`, `prepublishOnly` runs build + tests.
- README covers species, moves, battle loop, Pokemon instance, party, bag, PC storage, player, breeding, daycare, held / ability effect queries, weather, terrain, animations, TM crafting, sprites.

---

## What's left

### Refactoring (lower priority — current code works correctly)
- [ ] Further data-driven refactoring: replace hardcoded status IDs (`BURN_ID = 4` etc.) with `getStatusMechanic()` lookups for end-of-turn damage and attack reduction.
- [ ] Move hardcoded field effect durations (Reflect / Light Screen / Safeguard = 5 turns) to `moveEffectMechanics.duration` reads.
- [ ] Move hardcoded type IDs (Grass = powder immunity, Flying / Ground for terrain grounding) to data-driven lookups.

### Consumer polish
- [ ] npm publish (once final version number chosen and README / CHANGELOG reviewed).
- [ ] Consider renaming `pokedata3g` → something less cryptic before publish.
- [ ] Optional: expand test coverage for the newer systems (terrain interactions, primal weather, form changes, niche moves).

### Out of scope
- **Double battles** — the Battle class is architecturally single-battle (one active slot per side). Supporting doubles would require position tracking, multi-target resolution, partner interaction, and a substantial refactor.
- **Trainer rosters** — game-specific trainer Pokemon / items / AI flags are the consumer's responsibility. The module provides `NpcTrainer` + `AIFlag` / `AI_PRESET` but not definitions.

---

## Graphics notes (no Gen 3 decomp assets available)

These mechanics work at the data / engine level but have no matching visuals in the FireRed decomp. A consumer rendering the battle will need custom assets or Gen 6+ rips.

- **Terrain visuals**: no terrain overlay graphics. Electric / Grassy / Psychic / Misty floor effects need custom assets.
- **Primal weather**: Heavy Rain, Harsh Sun, Strong Winds have no Gen 3 animations. Would need custom variants of the existing rain / sun sprites.
- **Mega Evolution trigger animation**: DNA helix / stone glow has no Gen 3 equivalent.
- **Form change transitions**: Zen Mode, Shields Down, Disguise bust, Schooling, Stance Change, Battle Bond — no transition animations. Minimum: custom sprite swaps.
- **Fairy type icon**: no Gen 3 type icon — needs a custom icon in the Gen 3 style.
- **Gen 4-9 move animations**: `move_animation_map.json` routes newer moves to the closest Gen 3 animation by type + class + flags. Same-type matches for all moves (Fairy routed to Normal / Psychic analogues via overrides), but some will look thematically thin without custom animations.
