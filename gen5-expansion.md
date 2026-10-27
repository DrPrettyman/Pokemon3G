# Gen 9 Expansion: Findings & Challenges

Include all Pokemon while keeping Gen 3 mechanics and visual style. New moves are included only if a Gen 3 battle animation exists; otherwise replaced with a similar Gen 3 move (tracked in JSON). New evolution methods are mapped to Gen 3 equivalents.

## Data Availability

| Source | Coverage |
|--------|----------|
| PokeAPI CSVs | Gen 1-9 (1025 species, 937 moves, 367 abilities) |
| DS-64x64-SpriteResource | Gen 1-9+ (sprites exist through ~1025) |

## Scale of the Expansion

| | Gen 3 (current) | Gen 4-5 | Gen 6-8 | Total |
|---|---|---|---|---|
| Species | 386 | +263 | +249 | 898 |
| Moves | 372 | +205 | +267 | 844 |
| Abilities | 76 | +148 | +103 | 327 |
| Items | ~180 | many | many | 1,607 total |

## 1. Physical/Special Split

Gen 3 determines physical vs special by **type** (Fighting = physical, Fire = special). Gen 4 introduced **per-move** classification.

- **62 of 148** Gen 4-5 damaging moves differ from their type-based Gen 3 classification
- This ratio likely increases for Gen 6-8 moves since the split was well-established by then

**Decision needed**: Keep type-based (truly Gen 3) or adopt per-move (more faithful to the Pokemon)?

## 2. Fairy Type (Gen 6)

Gen 6 introduced the Fairy type with new matchups:
- Super-effective against: Fighting, Dragon, Dark
- Weak to: Poison, Steel
- Immune to: Dragon
- **30 Fairy-type moves** (14 Gen 6, 8 Gen 7, 5 Gen 8, 3 Gen 9)
- Many existing Pokemon gained Fairy typing in Gen 6 (Clefairy, Jigglypuff, Gardevoir, etc.)

**Decision needed**: Include Fairy type? It changes the type chart from 17 to 18 types. Excluding it would mean some Gen 6+ Pokemon lose their intended typing, and Dragon-types lose their key counter.

## 3. Moves — Total Replacement Scope

Across all gens, Pokemon learn **719 unique moves**. Of those:
- **353** are Gen 1-3 moves (already have battle animations)
- **203** are Gen 4-5 moves needing replacement/animation
- **163** are Gen 6-8 moves needing replacement/animation
- **Total needing work: ~366 moves**

The decomp has **355 move animations**. Each new move needs either:
- A Gen 3 animation assigned (visually similar), OR
- Replacement with a similar Gen 3 move in `move_replacements.json`

Additionally, **105 new move effect IDs** in Gen 6-8 beyond Gen 1-5's 322 effects. Many are novel mechanics needing battle engine support or simplification.

## 4. Abilities — 251 New

| Gen | New Abilities |
|-----|--------------|
| Gen 4 | 47 |
| Gen 5 | 101 |
| Gen 6 | 27 |
| Gen 7 | 42 |
| Gen 8 | 34 |
| **Total new** | **251** |

Each needs an entry in `ability_effects.json`. Many introduce new mechanics (Mold Breaker, Adaptability, Protean, Beast Boost, etc.).

## 5. Move Pools

Veekun has move pools for all Gen 4-8 Pokemon in their native version groups. For Gen 6-8 Pokemon specifically:
- **591 unique moves** learned via level-up
- **455** of those are Gen 1-5 moves (already handled)
- **136** are Gen 6-8 moves needing replacement

**Approach**: Use each Pokemon's native-gen move pool, then apply the move replacement JSON. TMs use the Gen 3 list for Gen 3 Pokemon; newer Pokemon get their native TM moves with replacements applied.

## 6. Evolution Methods

Gen 4-8 introduce new evolution conditions beyond Gen 3's level/trade/item/happiness:

| Condition | Count (Gen 4-8) | Proposed Gen 3 Equivalent |
|-----------|-----------------|---------------------------|
| Known move | 8 | Level-up at specific level |
| Known move type | 2 | Level-up at specific level |
| Location-based | 13 (many duplicates across games) | Use-item |
| Gender-specific | 6 | Use-item or level-up |
| Time-of-day | 12 | Pick one (always day or always night) |
| Trade-for-species | 2 | Regular trade |
| Affection | 1 (Sylveon) | Happiness |
| Turn upside down | 1 (Malamar) | Level-up |
| Overworld rain | 1 (Goodra) | Level-up |
| Party type | 1 (Pangoro) | Level-up |
| Three critical hits | 1 (Sirfetch'd) | Level-up |
| Take damage | 1 (Runerigus) | Level-up |
| Spin | 1 (Alcremie) | Use-item |
| Tower of Darkness/Waters | 2 (Urshifu) | Use-item |

**New items needed**: Shiny Stone, Dusk Stone, Dawn Stone, Razor Claw, Razor Fang, Ice Stone, and other evolution items.

Tracked in `evolution_remappings.json`, ~50 entries total.

## 7. Pokemon Forms

**169 non-default forms** across all gens, including:

| Category | Count | Include? |
|----------|-------|----------|
| Mega Evolutions | 48 | Exclude (Gen 6 battle mechanic) |
| Alolan forms | 20 | Include (regional variants) |
| Galarian forms | 20 | Include (regional variants) |
| Battle-only forms | 75 | Include (Darmanitan-Zen, Meloetta-Pirouette, etc.) |
| Other (Rotom, Castform, Deoxys, etc.) | varied | Include |

Notable multi-form Pokemon beyond Gen 5:
| Pokemon | Forms | Challenge |
|---------|-------|-----------|
| Aegislash | 2 (Shield/Blade) | Mid-battle stance change |
| Zygarde | 3 (10%/50%/Complete) | Form change mechanic |
| Wishiwashi | 2 (Solo/School) | Stat-based form change |
| Mimikyu | 2 (Disguised/Busted) | Ability-triggered form change |
| Cramorant | 3 (base/Gulping/Gorging) | Move-triggered form change |
| Morpeko | 2 (Full Belly/Hangry) | Turn-based form change |

**Decision**: Mega evolutions should probably be excluded (they're a Gen 6 battle mechanic). Regional variants (Alolan, Galarian) should be included as they're essentially different Pokemon.

## 8. Items

- **2,175 total items** in PokeAPI data
- New item categories: Mega Stones (44), Z-Crystals (46), Memories (45), Dynamax items (49), Nature Mints (50)
- **Exclude**: Mega Stones, Z-Crystals, Dynamax items (tied to excluded mechanics)
- **Include**: Evolution items, battle-relevant held items, berries (64 total, up from 43)

## 9. Code Changes

All Gen 3 filtering is centralized in `csv_data.py` build functions. Changes needed:

| Filter | Current | New |
|--------|---------|-----|
| `generation_id <= 3` | Gen 1-3 only | `<= 8` (or remove) |
| `version_group_id.isin((5,6,7))` | RSE/FRLG | Extend through Gen 8 version groups |
| `version_id.isin(range(7,12))` | Ruby-LeafGreen | Extend through Gen 8 |
| `berry.id <= 43` | Gen 3 berries | `<= 64` |
| `region_id.isin((1,3))` | Kanto + Hoenn | Add all regions |
| Status condition filter | Hardcoded Gen 3 set | Extend |
| Type filter | `generation_id <= 3` | `<= 8` (adds Fairy) |

New files needed:
- `python-scripts/extract/move_replacements.json` — maps ~366 post-Gen 3 move IDs to Gen 3 equivalents
- `python-scripts/extract/evolution_remappings.json` — maps ~50 new evolution methods to Gen 3 equivalents

## 10. Sprites

The DS-64x64-SpriteResource has Gen 3-style sprites organized by generation:

| Folder | Files | Naming | Coverage |
|--------|-------|--------|----------|
| GenI-GenV | 700 | Interleaved numbering (forms mixed in) | Complete for Gen 1-5 |
| Gen VI | 143 | Interleaved numbering (old style) | Complete for Gen 6 |
| GenVII | 88 + 37 forms | National dex IDs + `{id}-{form}.png` | Complete for Gen 7 |
| GenVIII | 96 + 79 forms | National dex IDs + `{id}-{form}.png` | Complete for Gen 8 |
| GenIX | 120 + 21 forms | National dex IDs (missing 899-905) | Partial Gen 9 |
| GenX | 196 | `{id}-{FormName}.png` (Gmax, Alola, etc.) | Alternate forms only |
| Gen_1-6_Extras | 9 | Misc alternate forms | Supplementary |

Gen VII+ switched to national dex numbering with `{id}-{form}.png` for alternates (much simpler than the interleaved system). Processing script needs to handle both conventions.

---

## Summary

| Area | Effort | Type |
|------|--------|------|
| Move replacements (~366 moves) | **Very Large** | Manual curation (JSON) |
| Ability effects (251 new) | **Very Large** | Manual curation (JSON) |
| Fairy type decision + implementation | Medium | Design decision + code |
| Items (new held items + evo items) | Medium | Manual curation (JSON) |
| Forms (169 non-default) | Medium | Code + data |
| Sprite processing (two naming schemes) | Medium | 1 new script |
| csv_data.py filter changes | Small | Code |
| Evolution remapping (~50) | Small | Manual curation (JSON) |
| Physical/Special decision | — | Design decision |
| Gen 9 data (now available via PokeAPI) | Done | — |

### Key Design Decisions Needed

1. **Physical/Special**: Type-based (Gen 3 rules) or per-move (Gen 4+ rules)?
2. **Fairy type**: Include (changes type chart) or exclude (loses Dragon counter)?
3. **Mega Evolutions**: Exclude (Gen 6 mechanic) or include as alternate forms?
4. **Gen 9**: PokeAPI CSVs now include Gen 9 data (1025 species)
5. **Move replacement strategy**: One-to-one mapping, or can multiple new moves map to the same Gen 3 move?
