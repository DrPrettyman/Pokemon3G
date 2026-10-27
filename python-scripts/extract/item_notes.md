# Item Effects Codification Notes

## Architecture

- `item_effects.json` — structured effects data, keyed by category ID
- `items.py` — loads `RAW_ITEMS` from veekun CSVs, merges in effects from `item_effects.json` to build `ITEMS`
- Each category entry has: `category_name`, `description` (how to interpret the effects), `effects` (keyed by item ID)
- JSON keys are strings (JSON limitation); converted to int in items.py

## Completed Categories

| Cat ID | Name           | Items | Effect format                              |
|--------|----------------|-------|--------------------------------------------|
| 26     | Vitamins       | 9     | List of `{stat_id, amount, cap}` dicts     |
| 37     | All machines   | 58    | `item_id → move_id` (plain int)            |
| 34     | Balls          | 12    | `{catch_rate, catch_rate_bonus, condition, scale_by, scale_range, passive}` |
| medicine | Medicine (27-30) | 28 | `{stat_cure, status_cure, revive, target}` |
| effort_drop | Effort-drop berries (2) | 6 | List of `{stat_id, amount}` (like vitamins, negative) |

## Remaining Gen 3 Categories — Plans

### Berries Pocket (pocket 5)

**Medicine berries (cat 3)** — 10 items (Cheri, Chesto, Pecha, etc.)
- Held-item berries that auto-cure status or restore HP/PP. Effect: `{held_trigger, held_effect}`.

**Effort-drop berries (cat 2)** — 6 items (Pomeg, Kelpsy, Qualot, etc.)
- Effect: `{stat_id, ev_drop: -10, happiness: [10, 5, 2]}` — mirrors vitamins but for EVs.

**In-a-pinch berries (cat 5)** — 7 items (Liechi, Ganlon, Salac, etc.)
- Held: consumed at 1/4 HP to boost a stat. Effect: `{held_trigger: "quarter-hp", stat_id, stages: 1|2}`.

**Picky-healing berries (cat 6)** — 5 items (Figy, Wiki, Mago, Aguav, Iapapa)
- Held: restore 1/8 HP at 1/2 HP, confuse if disliked flavor. Effect: `{held_trigger: "half-hp", heal_fraction: 1/8, confuse_flavor: flavor_id}`.

**Baking-only berries (cat 8)** — 14 items (Razz through Belue)
- Only used for PokéBlock making. Already covered by `BERRIES` data (flavors, smoothness). Possibly skip — effects are the berry flavor profile itself, already in `build_berries()`.

**Enigma Berry (cat 4)** — 1 item
- Held: consumed on super-effective hit to restore 1/4 HP. Special case, one-off.

### Battle Items Pocket (pocket 7)

**Stat boosts (cat 1)** — 7 items (X Attack, X Defense, Guard Spec., Dire Hit, etc.)
- Effect: `{stat_id, stages: 1}` plus happiness. Guard Spec prevents stat changes. Dire Hit boosts crit.

**Flutes (cat 38)** — 3 items (Blue, Yellow, Red Flute)
- Effect: `{cure: "sleep"|"confusion"|"attraction"}`. Reusable (not consumed).

### Items Pocket (pocket 1)

**Type enhancement (cat 19)** — 18 items (Silver Powder, Charcoal, Mystic Water, etc.)
- Very uniform: `{type_id, damage_boost: 1.2}`. Sea Incense also has breeding effect.

**Held items (cat 12)** — 11 items (Leftovers, Choice Band, Quick Claw, etc.)
- Diverse passive effects. Each is unique. Probably best as individual descriptions: `{passive: "description-key"}` or more structured per-item.

**Species-specific (cat 18)** — 8 items (Light Ball, Thick Club, Soul Dew, etc.)
- Effect: `{pokemon_id(s), stat_boost or special_effect}`. Each is unique to 1-2 species.

**Evolution items (cat 10)** — 8 items (stones + trade items)
- Effect: `{evolves: [{from_species_id, to_species_id}]}`. Already partly in pokemon evolution data.

**Training (cat 16)** — 6 items (Exp Share, Soothe Bell, Lucky Egg, etc.)
- Diverse passive/utility effects. Each unique.

**Choice (cat 13)** — 1 item (Choice Band)
- `{stat_id: 2, multiplier: 1.5, restriction: "locked-move"}`

**Effort training (cat 14)** — 1 item (Macho Brace)
- `{ev_multiplier: 2, speed_halved: true}`

**Scarves (cat 36)** — 5 items
- Effect: `{contest_type_id, boost: true}`. One per contest type.

**Dex completion / Fossils (cat 35)** — 5 items
- Effect: `{revive_species_id: int}`.

**Loot (cat 24)** — 7 items (Nugget, Star Piece, Mushrooms, etc.)
- Effect: `{sell_price: int}`. Some tradeable for moves/items in specific games.

**Collectibles (cat 9)** — 7 items (Shards, Shoal items, Heart Scale)
- Trade currency. Effect: minimal — maybe just `{trade_currency: true}`.

### Key Items Pocket (pocket 8) — probably skip

**Event items (cat 20)**, **Gameplay (cat 21)**, **Plot advancement (cat 22)** — 52 items total
- These are game-progression items (keys, tickets, bikes, rods). Not really "effects" to codify — they're game mechanics triggers. Probably skip for data export purposes.

### Mail Pocket (pocket 6) — skip

**All mail (cat 25)** — 12 items
- No mechanical effect. Just message-carrying flavor.

## Suggested Priority Order

1. ~~**Healing (27)** + **Status Cures (30)** + **PP Recovery (28)** + **Revival (29)**~~ — DONE
2. ~~**Effort-drop berries (2)**~~ — DONE
3. **Stat boosts (1)** + **Flutes (38)** — simple battle items
4. **Type enhancement (19)** — very uniform, easy
5. **Scarves (36)** + **Fossils (35)** — small, simple
6. **In-a-pinch berries (5)** + **Picky-healing berries (6)** + **Medicine berries (3)** — held-item triggers
7. **Held items (12)** + **Species-specific (18)** + **Training (16)** + **Choice (13)** + **Effort training (14)** — diverse, need per-item attention
8. **Evolution (10)** — may overlap with pokemon evolution data
9. **Loot (24)** + **Collectibles (9)** — minimal effects
10. **Baking-only (8)** — possibly skip (data in BERRIES already)
11. **Key items (20, 21, 22)** + **Mail (25)** — skip
