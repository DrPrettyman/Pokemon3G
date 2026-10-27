# Architecture: PhaserBattle and the Battle Pipeline

This document describes how the battle-playground's subsystems connect at runtime — the render path, the input path, and the React/Phaser boundary.

For the high-level overview see [README.md](README.md). For the decomp-verified beat sequence see [BATTLE_SEQUENCE.md](BATTLE_SEQUENCE.md). For remaining work see [plan.md](plan.md).

## System diagram

```
                    ┌─────────────────────────────────────────────┐
                    │            Host (App.tsx)                    │
                    │                                             │
                    │  provides: Player, NpcTrainer, backdrop,    │
                    │            onRequestBag, onRequestSwitch,   │
                    │            onComplete                       │
                    └────────────────┬────────────────────────────┘
                                     │ props
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        PhaserBattle.tsx                                │
│                                                                        │
│  Owns the Phaser stage ref and the battle runner hook.                 │
│  React effects sync snapshot state (sprites, healthboxes, weather)     │
│  to the Phaser scene. Does NOT own menus, bag, or party UI.           │
│                                                                        │
│  ┌──────────────────────┐      ┌─────────────────────────────────┐    │
│  │  useBattleRunner()   │──────│  createPhaserRenderer()         │    │
│  │                      │      │  (adapter: Handle → Renderer)   │    │
│  │  returns:            │      └──────────────┬──────────────────┘    │
│  │   snapshot           │                     │ wraps (lazy ref)      │
│  │   phase              │                     ▼                       │
│  │   outcome            │      ┌─────────────────────────────────┐    │
│  │   submitReplacement  │      │  <BattleStage>                  │    │
│  └──────────┬───────────┘      │  (React component, owns Phaser) │    │
│             │                  │                                  │    │
│             │ constructs       │  exposes BattleStageHandle ref:  │    │
│             ▼                  │   setPlayer / setOpponent        │    │
│     BattleRunner               │   setHp / setHealthbox           │    │
│     (runtime/engine)           │   showDialogue / clearDialogue   │    │
│                                │   playMoveAnimation              │    │
│                                │   promptAction / promptMove  ◄───┼──── input
│                                │   ...40+ imperative methods      │    │
│                                └─────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────┘
```

## Two data paths

### 1. Render path (engine → screen)

BattleRunner processes battle events and calls methods on the `BattleAnimRenderer` interface — an abstract contract defined in `runtime/types.ts` that knows nothing about Phaser. `PhaserRenderer` implements it by delegating to the `BattleStageHandle` ref.

```
BattleRunner
  │
  │  calls BattleAnimRenderer methods:
  │    showMessage(), setHp(), playMoveAnimation(),
  │    hitFlash(), faintFall(), statStageFlash(), ...
  │
  ▼
PhaserRenderer (adapter)
  │
  │  delegates to stageRef.current.*()
  │
  ▼
BattleStageHandle (imperative ref)
  │
  ▼
BattleScene (Phaser scene objects, tweens, DOM text)
```

PhaserBattle.tsx also runs React effects that sync non-animation state from the runner's `snapshot` to the stage:

| Effect | Watches | Does |
|--------|---------|------|
| Sprite sync | `snapshot.{player,opponent}.speciesId` | Calls `setPlayer()` / `setOpponent()` with new sprite URL from `spriteUrlFor()` |
| Weather sync | `snapshot.weather` | Calls `setWeather()` |
| Healthbox sync | `snapshot.{player,opponent}.{name,level,currentHp,maxHp}` | Calls `setHealthbox()` with formatted name from `nameWithPrefix()` |
| Outcome | `outcome` | Calls `onComplete()` to notify the host |
| Replacement | `phase === "awaiting-replacement"` | Auto-triggers `onRequestSwitch()` when a faint forces a swap |
| Intro clear | `phase === "intro"` | Calls `clearDialogue()` |

### 2. Input path (keyboard → engine)

The action menu (Fight / Bag / Pokemon / Run) and move menu are drawn and navigated **entirely inside Phaser**. Keyboard input never passes through React for menu navigation.

```
Keyboard (DOM keydown/keyup)
    │
    ▼
HudInput                         ← edge-triggered (no repeat),
    │                               matches decomp gMain.newKeys
    │  input.waitForPress()
    ▼
runHudMenu()                     ← async state machine: 2D grid
    │                               cursor + A (confirm) / B (cancel)
    │  resolves Promise
    ▼
Hud.battleOptions()              ← 2x2 grid: Fight / Bag / Pokemon / Run
  or Hud.moveOptions()           ← 4-slot move list with name/type/PP
    │
    │  adapts to renderer types
    ▼
BattleScene.promptAction()
  or .promptMove()
    │
    │  through PhaserRenderer adapter
    ▼
BattleRunner.gatherPlayerAction()
```

#### The action loop

`gatherPlayerAction()` in BattleRunner runs a `while(true)` loop that enforces decomp-faithful menu navigation — pressing B from any sub-menu returns to the root action menu:

```
loop:
  action = await renderer.promptAction()

  "fight" →
      pick = await renderer.promptMove(moves)
      if pick is cancel (B pressed) → continue loop
      return { type: "move", moveSlot }

  "bag" →
      result = await host.requestBag()        ← exits to React overlay
      if result is null (cancelled) → continue loop
      return { type: "item", itemId, targetIndex }

  "pokemon" →
      idx = await host.requestSwitch()        ← exits to React overlay
      if idx is null (cancelled) → continue loop
      return { type: "switch", partyIndex }

  "run" →
      return { type: "flee" }
```

Only a confirmed choice exits the loop and produces a `RuntimeAction`. The runner then submits both player and opponent actions to `battle.submitActions()`, which generates the turn's battle events, and the main event pump resumes.

#### Where input crosses from Phaser to React

Two cases exit the Phaser HUD and hand control to the React host:

- **BAG** — the runner calls `requestBag()` (the `onRequestBag` prop). The host mounts `<BagScreen>` as a React overlay. The battle is frozen (the runner is `await`ing the Promise). The host resolves with `{ itemId, partyIndex }` or `null` to cancel.
- **POKeMON** — same pattern via `requestSwitch()` / `onRequestSwitch`. The host mounts `<PartyScreen>`. Resolves with a party index or `null`.

In both cases, cancelling returns to the action loop and the Phaser HUD reappears.

## React / Phaser boundary

| Owned by React | Owned by Phaser |
|----------------|-----------------|
| App shell, setup screen | Backdrop, sprites, weather overlays |
| `<BagScreen>` overlay | Move animations, particle FX |
| `<PartyScreen>` overlay | Healthboxes, HP bars, damage popups |
| | Dialogue textbox (chrome + glyphs) |
| | Action menu, move menu (HUD) |
| | Sound (cries, move SFX) |

`<PhaserBattle>` is the **only** React component that talks to Phaser. It is the intended export for embedding battles in a larger game.

## Key abstractions

### BattleAnimRenderer (runtime/types.ts)
The renderer-agnostic interface. Defines every visual operation the runner can request. `PhaserRenderer` implements it for production; `RecordingRenderer` implements it for snapshot tests. You could swap in a Three.js renderer without touching the engine.

### Clock (runtime/clock.ts)
All timing is frame-locked to 1 GBA frame = 16.7427 ms (59.7275 fps). Two implementations:
- `WallClock` — `setTimeout`-backed, used as default
- `PhaserClock` — `scene.time`-backed, pauses with the Phaser scene

Tests inject a deterministic `FakeClock` via the `testClock` prop.

### Hud (phaser/Hud.ts)
Facade over the in-battle menu system. Wraps `HudInput` (keyboard listener), `HudWindow` (9-slice chrome + cursor rendering), and `runHudMenu` (async grid navigation). Exposes three async methods: `battleOptions()`, `moveOptions()`, `yesNoQuestion()`.

## File map

```
src/
  ui/
    PhaserBattle.tsx            bridge: React ↔ engine ↔ Phaser
    BagScreen.tsx               host-mounted item picker (React)
    PartyScreen.tsx             host-mounted party picker (React)

  runtime/                      renderer-agnostic engine
    BattleRunner.ts             event pump + action loop + turn sequencing
    useBattleRunner.ts          React hook: constructs runner, mirrors state
    MoveAnimator.ts             walks decomp animation command lists
    AnimDatabase.ts             owns sprite_sheets.json + sprite_templates.json
    battleStrings.ts            verbatim FireRed STRINGID templates + formatter
    spriteMotion.ts             TranslateSpriteInEllipse / Linear / etc.
    clock.ts                    Clock interface + WallClock / PhaserClock
    timings.ts                  named decomp frame-count constants
    types.ts                    BattleAnimRenderer + RuntimeAction + events

  phaser/                       Phaser implementation
    BattleStage.tsx             React wrapper, exposes BattleStageHandle ref
    BattleScene.ts              Phaser scene: sprites, tweens, DOM text, FX
    PhaserRenderer.ts           BattleAnimRenderer → BattleStageHandle adapter
    Hud.ts                      facade: battleOptions / moveOptions / yesNo
    hud_helpers/
      HudInput.ts               keyboard listener (edge-triggered)
      HudWindow.ts              9-slice menu chrome + cursor
      runHudMenu.ts             async 2D grid navigation state machine
    spriteCallbacks/            one file per family (rock, fire, electric...)
    taskCallbacks/              ditto
    animLoader.ts               Vite asset import + ensureSheetLoaded

  battle/
    spriteUrl.ts                Pokemon → sprite image URL resolution

  app/                          demo host (not exported)
    App.tsx
    SetupScreen.tsx
```
