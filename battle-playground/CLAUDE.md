# battle-playground — Project Instructions

This is the React+Phaser host for an authentic Gen 3 Pokemon battle experience built on top of `pokedata3g`. It is the **prototype/sandbox** for a `<PhaserBattle>` component that will be exported into a larger Phaser game project.

Read `plan.md` for remaining work. Read `BATTLE_SEQUENCE.md` for the authoritative 27-beat decomp-verified battle sequence that the implementation is measured against. Read `README.md` for a human overview.

The "frame-accurate battle sequence" fidelity pass is **landed**: decomp-verbatim text strings (`src/runtime/battleStrings.ts`), miss / no-effect animation skipping, confusion self-hit pairing, stat-change BG mask clipped to the battler via Phaser 4 filter-mask, ball-release sub-sequence, and hit-flash → HP drain sequencing. The in-battle HUD now uses the extracted FireRed chrome (healthbox + textbox). The single biggest remaining visual gap is the **long-tail move-animation callbacks** — only ~14 of 288 sprite/task callbacks are ported; everything else falls through to `FallbackFlash`. See `plan.md §2`.

## What this is and isn't

- **Is**: a real-time Phaser 4 scene that drives `pokedata3g`'s `Battle` class, executes decomp move animation scripts faithfully, and renders the result inside a host React shell.
- **Is**: the source of truth for the future `<PhaserBattle>`, `<BagScreen>`, and `<PartyScreen>` components.
- **Isn't**: a place for hardcoded Pokemon/move data. All game data lives in `pokedata3g/src/data.json` (extracted by the parent Python pipeline) and `battle-playground/src/assets/battle_anims/*.json` (extracted by `python-scripts/extract_battle_anims.py`).
- **Isn't**: a place for game logic that belongs in `pokedata3g` (damage calc, AI, items, etc).

## Battle constructor contract

`pokedata3g`'s `Battle` takes one `Player` for the player side and one of `Player | NpcTrainer` for the opponent side. Both sides are always first-class objects with a party, bag, and identity — there is no "bare Pokemon" shortcut.

Wild encounters are modelled as `new NpcTrainer({ party: [wildMon], isWild: true })`. The `isWild` flag does two things:
1. Flips the default `battleType` to `"wild"` (so `canFlee` defaults to true and Poke Balls work).
2. Routes `opponent.selectAction(battle)` through the simpler wild-action algorithm (random move, with an optional `AIFlag.PREFER_FLEE` branch for roaming legendaries).

`battleType` is auto-derived from `opponent.isWild`. Override via `BattleOptions.battleType` only when you need a non-default; prefer `BattleOptions.canFlee` to lock the RUN action in first-battle tutorials.

The `Pokemon` instances inside the player and opponent are mutated live during the battle. HP loss, status conditions, EXP gain, level-ups, PP consumption, EV yields, happiness changes, learned moves, and held-item swaps all persist on the same objects after the battle ends — there is no separate "commit results to save state" step. The playground discards its `Player` after each battle; the real game integration keeps it in the save state.

## Status

The battle pipeline is structurally complete:

- Decomp-faithful battle-script flow (`attackcanceler` / `accuracycheck` / `attackstring` / `attackanimation` / `healthbarupdate` / `critmessage` / `resultmessage` / `seteffectwithchance` / `tryfaintmon` / `moveendall`) driven from pokedata3g events.
- Verbatim FireRed text strings expanded from `src/runtime/battleStrings.ts` (`STRINGID_*` templates with `{B_ATK_NAME_WITH_PREFIX}` / `{B_BUFF1}` / `{B_BUFF2}` placeholders), ALL CAPS names with `Foe ` / `Wild ` prefixes.
- Misses and type immunities skip the move animation entirely (decomp accuracy-check branch + `MOVE_RESULT_NO_EFFECT` guard), replaced by a 32-frame `B_WAIT_TIME_SHORT` pause.
- Confusion self-hit pair is fused into two narration lines around a damage sequence with no move anim.
- Ball-release 3-phase sub-sequence (ball-open → particles → `BATTLER_AFFINE_EMERGE`) on both intro send-outs, with the player-side trainer slide concurrent with the throw and ball release on frame 2.
- Stat-change BG overlay is clipped to the affected battler's silhouette via a Phaser 4 filter-mask (`enableFilters()` + `filters.internal.addMask(battler)`), mirroring the decomp's `DISPCNT_OBJWIN_ON` + `CreateInvisibleSpriteCopy(..., ST_OAM_OBJ_WINDOW)` clip. It is NOT full-screen.
- Faint sequence ordering: cry → 64-frame pause → fall animation → "X fainted!", matching `BattleScript_FaintTarget`.
- In-battle HUD uses the extracted FireRed chrome: `healthbox_singles_player.png` / `healthbox_singles_opponent.png` for the healthboxes, `textbox.png` for the bottom dialogue box. The placeholder flat rectangles are gone. HP bar fill steps one bar-pixel per GBA frame via `BattleRunner` → `setHp`.
- Battle font is the real Pokemon Emerald OpenType font (`pokefont/Emerald.ttf` → `battle-playground/src/assets/font/Emerald.ttf`), loaded via CSS `@font-face` and rendered through Phaser `DOMElement`s so the `@font-palette-values --battle-msg` override picks up the `B_WIN_MSG` colors (`fgColor=1` white, `shadowColor=6` purple-gray). Canvas 2D `fillText` ignores CSS custom palettes, which is why we use DOM elements instead of `Phaser.GameObjects.Text`. See `src/phaser/BitmapFont.ts` (still named `BitmapFontPrinter` for API continuity — it's DOM-backed under the hood) and `src/styles.css`. The deprecated `python-scripts/extract_font.py` is kept for reference only.

See `plan.md` for remaining gaps. The single largest visual issue is the long-tail sprite/task callback port (`plan.md §2`) — only ~14 of 288 decomp callbacks are implemented and unported moves fall through to `FallbackFlash`.

## Architecture

```
                                   ┌─────────────────────────────────┐
                                   │  pokedata3g (data + battle sim) │
                                   └────────────┬────────────────────┘
                                                │
                                                ▼
                  ┌─────────────────────────────────────────────────┐
                  │  src/runtime/  (renderer-agnostic engine)       │
                  │  - BattleRunner       drives Battle, emits ops  │
                  │  - MoveAnimator       walks animation commands  │
                  │  - AnimDatabase       owns the JSON manifests   │
                  │  - Clock              frame-locked time base    │
                  │  - BattleAnimRenderer interface                 │
                  └────────────────────┬────────────────────────────┘
                                       │
                       ┌───────────────┴───────────────┐
                       ▼                               ▼
  ┌────────────────────────────────┐    ┌──────────────────────────┐
  │ src/phaser/                    │    │ tests/support/           │
  │  PhaserRenderer (impl)         │    │  RecordingRenderer       │
  │  BattleScene                   │    │  (snapshot test target)  │
  │  spriteCallbacks/taskCallbacks │    └──────────────────────────┘
  └────────────────┬───────────────┘
                   │
                   ▼
  ┌────────────────────────────────┐    ┌──────────────────────────┐
  │ src/ui/                        │    │ src/app/  (demo host)    │
  │  PhaserBattle    (export)      │◀───│  SetupScreen             │
  │  BagScreen       (export)      │◀───│  App.tsx                 │
  │  PartyScreen     (export)      │◀───│                          │
  └────────────────────────────────┘    └──────────────────────────┘
```

## Key conventions

### Frame-locked timing

Every duration in this project is an integer multiple of one GBA frame = 16.7427 ms (59.7275 fps). Use `clock.wait(frames)`, never `setTimeout` directly. Tween durations are computed as `frames * FRAME_MS`. Named frame counts live in `src/runtime/timings.ts` — put new constants there rather than inlining magic numbers at call sites.

### No hardcoded game data

Movement counts, particle counts, frame durations, damage, type effectiveness, item effects — all come from `pokedata3g` or extracted manifests. If you find yourself adding a hardcoded number from a wiki, stop and add it to the Python extraction pipeline instead.

### The interpreter knows nothing about Phaser

`MoveAnimator` and the sprite/task callbacks emit abstract render operations through the `BattleAnimRenderer` interface. You should be able to swap in a Three.js renderer without touching the animator.

### React/Phaser boundary

React owns: app shell, setup screen, bag screen, party screen.

Phaser owns: backdrop, sprites, weather, move animations, healthboxes, HP bars, damage popups, in-battle textbox (chrome + glyphs).

The `<PhaserBattle>` export is the only React component that talks to Phaser. It exposes `onRequestBag`/`onRequestSwitch` callbacks so the host can render bag/party UI in any way it wants.

### Bag and party screens are NOT owned by battle

`<BagScreen>` and `<PartyScreen>` are exported as siblings to `<PhaserBattle>`. They take a `Bag` / `Party` instance and a callback; they do not know whether they're being shown in battle or in the overworld pause menu. The same components are used in both contexts.

## Source layout

```
src/
  runtime/                         renderer-agnostic engine
    BattleRunner.ts                drives Battle + event queue + async pump
    MoveAnimator.ts                walks decomp animation command lists
    AnimDatabase.ts                owns sprite_sheets.json + sprite_templates.json
    battleStrings.ts               verbatim FireRed STRINGID templates + formatter
    spriteMotion.ts                ports of TranslateSpriteInEllipse etc
    clock.ts                       Clock abstraction (frame-locked)
    timings.ts                     decomp frame-count constants
    types.ts                       BattleAnimRenderer, RuntimeAction, RunnerEvent
  phaser/                          Phaser implementation
    BattleScene.ts                 Phaser scene — healthbox + textbox blit + FX
    BitmapFont.ts                  DOM-backed Emerald.ttf printer (\n / \f support)
    PhaserRenderer.ts              implements BattleAnimRenderer
    spriteCallbacks/               one file per family (rock, fire, electric...)
    taskCallbacks/                 ditto
    animLoader.ts                  Vite asset import + ensureSheetLoaded
  ui/                              React exports — usable inside or outside battle
    PhaserBattle.tsx               the main export
    BagScreen.tsx                  reusable bag UI
    PartyScreen.tsx                reusable party UI
  app/                             demo host (not exported)
    App.tsx
    SetupScreen.tsx
    BackdropPicker.tsx
    WeatherPicker.tsx
  config/setupConfig.ts            playground defaults
  assets/                          extracted graphics (gitignored, generated)
    backdrops/                     by python-scripts/extract_battle_graphics.py
    hud/                           healthboxes, textbox, hpbar, numbers, ball, particles, stat_masks
    weather/                       ditto
    font/                          Emerald.ttf — real Gen 3 Latin OpenType font (from pokefont/)
    sounds/move_sfx/               128 SE_M_* mp3s (python-scripts/generate/move_sounds.py)
    battle_anims/                  by python-scripts/extract_battle_anims.py
      sprites/                     279 RGBA particle PNGs
      sprite_sheets.json           ANIM_TAG → sheet metadata
      sprite_templates.json        356 sprite templates
      backgrounds/                 27 anim BGs + index.json (python-scripts/extract_battle_graphics.py)
tests/
  animator/                        snapshot tests per move
    Tackle.test.ts
    RockThrow.test.ts
    SolarBeam.test.ts
    __snapshots__/                 generated
  support/
    RecordingRenderer.ts           BattleAnimRenderer impl that records ops
    fakeClock.ts                   deterministic Clock for tests
```

## Common tasks

### Adding a new sprite callback

1. Open the source: `decomp-hacks/firered/src/battle_anim_<family>.c` (or emerald)
2. Find the C function (e.g. `AnimFallingRock`)
3. Note which `sprite->data[0..7]` slots it sets and which `Translate*` helper it ends with
4. Add a TypeScript port to `src/phaser/spriteCallbacks/<family>.ts` using the helpers from `src/runtime/spriteMotion.ts`
5. Register it in the callback registry
6. Add a snapshot test that exercises a move using the new callback

### Adding a new task callback

Same as sprite callback but for `AnimTask_*` functions. They live in `src/phaser/taskCallbacks/`.

### Re-extracting decomp assets

```bash
python python-scripts/extract_battle_graphics.py    # backdrops, hud, weather
python python-scripts/extract_battle_anims.py       # sprite sheets + templates
```

Both write into `battle-playground/src/assets/`. The output directory is gitignored.

### Running tests

```bash
cd battle-playground
npm test                       # vitest
npm test -- --update           # update snapshots when you add a callback
```

### Running the demo

```bash
cd battle-playground
npm run dev                    # vite, http://localhost:5173
```

## Things to avoid

- **Don't** put hardcoded Pokemon/move/item data in TypeScript files.
- **Don't** add `setTimeout` for game timing — use `clock.wait(frames)`.
- **Don't** add bag/party UI inside `<PhaserBattle>` — that's the host's job.
- **Don't** import from `phaser` inside `src/runtime/` — the engine must stay renderer-agnostic.
- **Don't** hardcode millisecond timings in BattleRunner or BattleScene — put the frame count in `src/runtime/timings.ts` and reference it by name.
- **Don't** pick up new features without consulting `plan.md`'s open follow-ups list — the battle pipeline is structurally complete and "next work" is long-tail polish that lives in one place.
- **Don't** hand-write narration copy in `BattleRunner` or the renderer. Every textbox line goes through `formatBattleString(STRINGID_*, ctx)` in `src/runtime/battleStrings.ts` — the templates are copy-pasted verbatim from `python-scripts/raw-assets/decomp-hacks/firered/src/battle_message.c` with file:line citations.
- **Don't** forget `enableFilters()` on a GameObject before touching `gameObject.filters.internal.addMask(...)`. Phaser 4 initialises `filters` to `null` until you enable it, and the optional chain silently no-ops — TypeScript will accept it and the mask will never attach. See the comment in `BattleScene.statStageFlash`.
- **Don't** re-enable `<React.StrictMode>` — Phaser games can't survive the deliberate double-mount. The trade-off is documented.

## Useful files outside this package

- `pokedata3g/src/data.json` — all game data
- `pokedata3g/src/animations.json` — decomp animation command scripts
- `pokedata3g/src/animationMapper.ts` — BattleEvent → animation
- `python-scripts/raw-assets/decomp-hacks/firered/src/battle_anim_*.c` — the source of truth for sprite/task callback semantics
- `python-scripts/raw-assets/decomp-hacks/firered/data/battle_anim_scripts.s` — the source of move animation scripts (already extracted into `animations.json` by pokedata3g)
- `python-scripts/extract_battle_anims.py` — the parser that produces `sprite_sheets.json` and `sprite_templates.json`
