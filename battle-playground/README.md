# battle-playground

A spot-on recreation of Pokemon Gen 3 battles in the browser, built on [Phaser 4](https://phaser.io/) and [pokedata3g](../pokedata3g/).

This project is the prototype host for a future `<PhaserBattle>` React component — a self-contained, drop-in Pokemon battle experience that can be embedded in any Phaser-based game.

## What it does

- Renders authentic Gen 3 battle scenes using extracted decomp assets (backdrops, sprites, HUD, weather overlays, particle sheets)
- Runs real Pokemon battles against AI trainers via `pokedata3g`'s Gen 3 battle engine (Gen 3 mechanics with Gen 4+ physical/special split)
- Replays move animations frame-for-frame using the same script format the original game uses (`createsprite`, `delay`, `playsewithpan`, `waitforvisualfinish`, etc.) — extracted from the firered/emerald decomps via Python
- Plays Pokemon cries on switch-in and faint
- Provides a setup screen for choosing backdrop, weather, and editing parties before each battle

## What ships today

A playable Gen 3 battle inside a React shell. Concretely:

**Battle-script fidelity** — every beat of a turn follows `BattleScript_EffectHit` in `data/battle_scripts_1.s`:
- `attackcanceler` → `accuracycheck` → `attackstring` → pure calcs → `attackanimation` → `waitanimation` → `effectivenesssound` → `hitanimation` → `healthbarupdate` + `datahpupdate` → `critmessage` → `resultmessage` → `seteffectwithchance` → `tryfaintmon` → `moveendall`
- Misses and type immunities skip the move animation entirely (decomp `accuracycheck` branch + `MOVE_RESULT_NO_EFFECT` guard), replaced by a 32-frame `B_WAIT_TIME_SHORT` pause
- Confusion self-hit pair is fused into the two narration lines around a damage sequence with no move animation
- Faint sequence: cry → 64-frame pause → fall animation → `"Foe X\nfainted!"` — matching `BattleScript_FaintTarget`
- Stat-change narration runs AFTER the BG-mask animation, matching `seteffectwithchance` ordering

**Text** — every textbox line is loaded from the decomp's `gBattleStringsTable` via `src/runtime/battleStrings.ts`. Strings like `"{B_ATK_NAME_WITH_PREFIX} used\n{B_MOVE_NAME}!"` or `"{B_DEF_NAME_WITH_PREFIX}'s {B_BUFF1}\n{B_BUFF2}"` are copied verbatim from `src/battle_message.c` with file:line citations. Names render in ALL CAPS with `"Foe "` / `"Wild "` prefixes via `HANDLE_NICKNAME_STRING_CASE`. Newline `\n` and page-break `\f` (decomp's `\p`) are honored by the printer.

**Font** — the real Pokemon Emerald OpenType font (from [`pokefont/Emerald.ttf`](../pokefont/), an OTF conversion of the decomp's `latin_normal.png` with proper `hmtx` widths, `CPAL` palette, and `COLRv1` color glyphs). The font is loaded via CSS `@font-face` and rendered through Phaser `DOMElement`s so the `@font-palette-values --battle-msg` override (`0 #ffffff, 2 #6a5a73`) actually picks up — canvas 2D `fillText` ignores CSS custom palettes. `1em = 16 font units = 16 CSS pixels`, so `font-size: 16px` gives pixel-perfect alignment.

**HUD** — uses the real FireRed art:
- Healthboxes blit `healthbox_singles_{player,opponent}.png` directly, with an HP-fill rectangle painted inside the chrome's rail region. HP bar colors match the decomp thresholds (`healthbar.pal`): green > 50%, yellow > 20%, red ≤ 20%
- Bottom dialogue box blits `textbox.png` — the dark-teal + purple FRLG battle textbox, not a placeholder rectangle

**Move animations**
- Full decomp animation command interpreter (all ~40 commands) with stack-based control flow (`call` / `return` / `goto` / `jump*`), 100k-step budget
- ~14 sprite + task callbacks hand-ported from `battle_anim_*.c`, driven by the sprite motion helpers in `src/runtime/spriteMotion.ts` (`driveLinear` / `driveParabolicArc` / `driveEllipse` / `driveShake` / ...)
- BG layer compositing — `monbg` darken, `splitbgprio` depth shuffle, `fadetobg` / `restorebg` fullscreen BG cross-fade across 27 extracted anim backgrounds
- Ball-release 3-phase sub-sequence (ball-open → particle burst → `BATTLER_AFFINE_EMERGE`) on both intro send-outs, with the player-side trainer slide concurrent with the throw and ball release on frame 2 of the 5-frame back-pic strip
- Stat-change BG overlay clipped to the affected battler's silhouette via a Phaser 4 filter-mask — pixel-perfect, alpha-aware, matching the decomp's `DISPCNT_OBJWIN_ON` + `CreateInvisibleSpriteCopy(..., ST_OAM_OBJ_WINDOW)` clip
- 128 `SE_M_*` mp3 cues with pan-aware playback; cries play on send_out and faint

**Visuals**
- 11 Gen 3 battle backdrops + 27 fullscreen anim backgrounds extracted from the emerald decomp
- 5 weather effects (rain, sandstorm, hail, sun tint, fog)
- Frame-locked `PhaserClock` (59.7275 fps), every battle-flow duration keyed off named decomp constants in `src/runtime/timings.ts`
- HP bar drains at 1 bar-pixel per GBA frame via `BattleRunner.displayedHp` → `BattleScene.setHp`

**Tests** — 69 unit tests across interpreter control flow, sprite motion endpoints, battle-string formatting, and sequence traces (`Tackle`, `RockThrow`, `SolarBeam`, `BallRelease`, `IntroOpponentReveal`, `IntroPlayerReveal`, `DamageSequence`, `StatChangeSequence`, `MissSequence`, `NoEffectSequence`, `ConfusionSelfHit`, `BattleStrings`).

## What's left

See [`plan.md`](plan.md) for the working punch list. Headline items:

- **Long-tail sprite/task callbacks** — only ~14 of 288 decomp callbacks are ported. Unported moves fall through to `FallbackFlash` and read as a generic tint pulse. This is the single biggest remaining visual gap.
- Authentic red-laser recall animation (currently a shrink+fade stand-in)
- Real palette engine to replace the `setTint` approximations in faint/status/charge flashes
- Separate HP-number text rendering using `numbers1.png` (currently uses the bitmap font)
- Cry playback routed through `SoundPlayer` rather than bare `new Audio()`
- Sound interpreter gaps (`waitsound`, `setpan`, `createsoundtask`)
- Trainer class/name wiring for the intro `"{TRAINER_CLASS} {TRAINER_NAME}\nwould like to battle!"` string (currently falls back to the wild variant)
- `effectivenesssound` cue for super-effective / not-very-effective type hits

## Quick start

```bash
# from repo root, one-time
python python-scripts/extract_battle_graphics.py
python python-scripts/extract_battle_anims.py

# from battle-playground/
npm install         # workspace install
npm run dev         # http://localhost:5173
```

## Architecture overview

The end state is three React components that share an underlying engine:

- **`<PhaserBattle>`** — the battle scene. Hosts a Phaser canvas internally. Takes parties + weather + backdrop as props. Asks the host for bag/party UI via async callbacks.
- **`<BagScreen>`** — item-select UI. Same component is used in battles and in the overworld pause menu.
- **`<PartyScreen>`** — party-switch / summary UI. Also shared with the overworld.

Under the hood:

- **`pokedata3g`** provides the data and battle simulation
- **`BattleRunner`** drives the simulation, owns the event queue
- **`MoveAnimator`** walks the decomp animation command stream
- **`PhaserRenderer`** translates abstract render ops into Phaser sprites/tweens — the renderer is replaceable

For details, see [`CLAUDE.md`](CLAUDE.md) and [`plan.md`](plan.md).

## Where the data comes from

Every visible thing in a battle is extracted from the original game files via Python:

| What | Source | Extracted by |
|---|---|---|
| Backdrops | `decomp-hacks/emerald/graphics/battle_environment/` | `python-scripts/extract_battle_graphics.py` |
| HUD frames | `decomp-hacks/emerald/graphics/battle_interface/` | same |
| Weather sprites | `decomp-hacks/emerald/graphics/weather/` | same |
| Particle sprites | `decomp-hacks/emerald/graphics/battle_anims/sprites/` | `python-scripts/extract_battle_anims.py` |
| Sprite templates | `decomp-hacks/{emerald,firered}/src/battle_anim_*.c` | same |
| Animation scripts | `decomp-hacks/firered/data/battle_anim_scripts.s` | `pokedata3g` (parent) |
| Cries | (provided by pokedata3g) | parent pipeline |

This is the project's core principle: **the only way authentic-looking work happens is by reading the decomp directly**. Anything else is a bolt-on.

## License + disclaimer

See the parent project's `LICENSE`. Pokemon assets and identifiers are the property of Nintendo / Creatures inc. / GAME FREAK inc. This project exists for fan/research purposes.
