/**
 * Phaser battle stage.
 *
 * Phase 1 scope — visual parity with the prior DOM stage:
 *   - 240x112 GBA-native backdrop (scaled 3x in the game config)
 *   - opponent front sprite + player back sprite pinned to platforms
 *   - weather overlays (rain / sandstorm / hail / sun / fog)
 *   - semantic move FX (lunge, shake, hit-flash, crit-flash, faint-fall)
 *
 * Phase 2 will add extracted decomp particle sheets, Phase 3 the animations.json
 * command interpreter that replaces the semantic FX with authentic per-move
 * animations.
 */
import * as Phaser from "phaser";
import type { Animation as PokedataAnimation, Weather } from "pokedata3g";
import { getMoveAnimation } from "pokedata3g";
import {
  ensureSheetLoaded,
  resolveTemplate,
  tileOffsetToFrameIndex,
} from "./animLoader";
import { MoveAnimator } from "./animator/MoveAnimator";
import type { Battler } from "./animator/types";
import { PhaserClock, FRAME_MS } from "../runtime/clock";
import type { Clock } from "../runtime/clock";
import { BALL_RELEASE_SCHEDULE } from "../runtime/timings";
import type { BallReleaseSchedule, IntroSchedule, OutroSchedule } from "../runtime/types";
import type { Pokemon, BattleSide } from "pokedata3g";
import { BitmapFontPrinter } from "./BitmapFont";
import {
  HUD_MENU_CURSOR_KEY,
  HUD_PRESS_A_ARROW_KEY,
} from "./hud_helpers";
import { Hud } from "./Hud";
import {
  OpponentHealthBox,
  PlayerHealthBox,
  type HealthBox,
} from "./healthbox";
import type {
  ActionPromptCtx,
  HudAction,
  MoveChoice,
} from "../runtime/types";

/** GBA-native stage dimensions. Phaser config applies an integer scale. */
export const STAGE_WIDTH = 240;
export const STAGE_HEIGHT = 112;
/** Battle textbox height in GBA-native pixels — sits below STAGE_HEIGHT. */
export const TEXTBOX_HEIGHT = 48;
/** Full Phaser canvas height (backdrop + textbox). */
export const CANVAS_HEIGHT = STAGE_HEIGHT + TEXTBOX_HEIGHT;
export const STAGE_SCALE = 3; // 720 x (STAGE_HEIGHT+TEXTBOX_HEIGHT)*3 displayed

/** Platform anchor points (bottom-center of each mon) in GBA-native coords. */
const OPPONENT_ANCHOR = { x: 184, y: 64 };
const PLAYER_ANCHOR = { x: 64, y: 112 };

/**
 * Depth bands (Phase E BG layer compositing):
 *   0 — backdrop
 *   5 — anim BG layer (fadetobg image)
 *   6 — monbg: a target mon that's been pushed behind anim sprites
 *   10/11 — opponent / player mon sprites (default)
 *   12+ — anim particles / tasks
 *
 * The `ANIM_BG_DEPTH` container holds the fullscreen anim background image
 * when a `fadetobg` is active; `monbg` temporarily reparents the target mon
 * into the same depth band (darkened) so subsequent anim sprites render on
 * top of it.
 */
const ANIM_BG_DEPTH = 5;
const MON_BG_DEPTH = 6;

/** Offscreen positions used to slide trainer sprites in/out. */
const OPPONENT_OFFSCREEN_X = 244;   // just past the right edge (stage is 240 wide)
const PLAYER_OFFSCREEN_X = -20;     // just past the left edge

/** Textures registered in preload. */
const KEY = {
  backdrop: (id: string) => `backdrop:${id}`,
  opponent: "mon:opponent",
  player: "mon:player",
  rain: "weather:rain",
  sandstorm: "weather:sandstorm",
  fog: "weather:fog",
  snow0: "weather:snow0",
  snow1: "weather:snow1",
  rivalTrainer: "trainer:rival",
  /** Player back-pic is 5 frames sliced out into a spritesheet. */
  playerTrainerSheet: "trainer:player_sheet",
  /** Poke Ball strip (16x48 → 3 frames of 16x16: closed / half-open / open). */
  ballPoke: "ball:poke",
  /** Ball-open particle strip (8x64 → 8 frames of 8x8). */
  ballParticles: "ball:particles",
  /** FireRed player healthbox chrome (128x64 RGBA, from decomp). */
  hbPlayer: "hud:healthbox_player",
  /** FireRed opponent healthbox chrome (128x32 RGBA, from decomp). */
  hbOpponent: "hud:healthbox_opponent",
  /** FireRed battle textbox chrome (128x128 RGBA, from decomp). */
  textboxChrome: "hud:textbox",
  /**
   * Bouncing "press A" arrow — `graphics/fonts/down_arrow_3.png` in the
   * decomp. Loaded under the well-known key `HUD_PRESS_A_ARROW_KEY` so
   * `HudCursor` can `scene.add.image(..., key)` without plumbing a
   * texture ref through its constructor.
   */
  pressAArrow: HUD_PRESS_A_ARROW_KEY,
  /** Menu selection cursor — 8×16 RGBA extracted from `battle_interface/textbox.png`. */
  menuCursor: HUD_MENU_CURSOR_KEY,
  /** 9-sliced `type1` frame chrome for the action menu (112×48 px). */
  menuChromeAction: "hud:menu_chrome_action",
  /** 9-sliced `type1` frame chrome for the move-name list (160×48 px). */
  menuChromeMoveNames: "hud:menu_chrome_move_names",
  /** 9-sliced `type1` frame chrome for the move-info pane (88×48 px). */
  menuChromeMoveInfo: "hud:menu_chrome_move_info",
  menuChromeYesNo: "hud:menu_chrome_yesno",
};

/** Number of throw-animation frames in the player back-pic strip. */
const PLAYER_THROW_FRAME_COUNT = 5;
const PLAYER_THROW_FRAME_SIZE = 64;

/**
 * Map a pokedata3g stat id onto the decomp's `gBattleStatMask{N}_Pal`
 * index used by `StatsChangeAnimation_Step2`. Derived from the switch
 * statement at `src/battle_anim_utility_funcs.c:465` — note the table is
 * NOT monotonic: it encodes `animStatId → palette` where `animStatId`
 * reorders the stats (0=ATK 1=DEF 2=ACC 3=SPE 4=EVA 5=SPA 6=SPD) and the
 * switch assigns palettes pal2, pal1, pal3, pal4, pal6, pal7, pal8
 * respectively. We skip the reorder and map pokedata3g stat ids
 * (2=ATK…6=SPE, 7=ACC, 8=EVA) directly onto the resulting palettes.
 */
const STAT_MASK_PALETTE: Record<number, number> = {
  2: 2, // attack        → stat2.pal (red)
  3: 1, // defense       → stat1.pal (green)
  4: 7, // specialAttack → stat7.pal (purple/pink)
  5: 8, // specialDefense→ stat8.pal (teal)
  6: 4, // speed         → stat4.pal (blue)
  7: 3, // accuracy      → stat3.pal
  8: 6, // evasion       → stat6.pal
};

/**
 * Phase D #6 — palette flash colors for `statusFlash`. Keys are the veekun
 * status_condition ids: 1 paralysis, 2 sleep, 3 freeze, 4 burn, 5 poison,
 * 6 confusion, 7 infatuation.
 */
const STATUS_TINT: Record<number, number> = {
  1: 0xfff060,
  2: 0x4060c0,
  3: 0x80e0ff,
  4: 0xf04020,
  5: 0xa040a0,
  6: 0xf080a0,
  7: 0xff80c0,
};

export interface SceneBootData {
  backdropUrl: string;
  backdropId: string;
  opponentUrl: string;
  playerUrl: string;
  weather: Weather | null;
  weatherAssets: {
    rain: string;
    sandstorm: string;
    fog: string;
    snow0: string;
    snow1: string;
  };
  trainerAssets: {
    /**
     * Vite URL of a single PNG containing all 5 player throw frames
     * laid out vertically (64x320). The scene loads this as a Phaser
     * spritesheet so individual frames can be indexed 0..4.
     */
    playerTrainerStrip: string;
    /** Vite URL of the 64x64 rival front-pic PNG. */
    rivalTrainer: string;
  };
  /**
   * Poke Ball send-out assets. `ballPoke` is the 16x48 3-frame strip
   * (closed / half-open / open) from FireRed `graphics/interface/ball/poke.png`;
   * `ballParticles` is the 8x64 8-frame burst from
   * `graphics/battle_anims/sprites/particles.png`.
   */
  ballAssets: {
    ballPoke: string;
    ballParticles: string;
  };
  /**
   * Stat-change BG mask URLs keyed by asset stem
   * (`stat_mask_{up|down}_{1..8}`). Mirrors the decomp's 2 tilemaps × 8
   * palettes lookup in `StatsChangeAnimation_Step2`. `statStageFlash`
   * picks a key based on delta sign + statId.
   */
  statMaskAssets: Record<string, string>;
  /**
   * Static FireRed battle UI chrome extracted from
   * `graphics/battle_interface/`. These are loaded in `preload` and
   * blit directly as Phaser Images — the healthboxes and textbox are
   * NOT reconstructed from flat rects anymore.
   */
  hudAssets: {
    healthboxPlayer: string;
    healthboxOpponent: string;
    textbox: string;
    /** 16×16 bouncing "press A" arrow, from `graphics/fonts/down_arrow_3.png`. */
    pressAArrow: string;
    /** 8×16 menu selection cursor, extracted from battle_interface/textbox.png tiles 1+2. */
    menuCursor: string;
    /** 9-sliced `type1` chrome pre-composited for the action menu. */
    menuChromeAction: string;
    /** 9-sliced `type1` chrome pre-composited for the move-name list. */
    menuChromeMoveNames: string;
    /** 9-sliced `type1` chrome pre-composited for the move-info pane. */
    menuChromeMoveInfo: string;
    menuChromeYesNo: string;
  };
  /**
   * Battle-anim BG layer assets keyed by logical BG_* id (see
   * `gBattleAnimBackgroundTable`). Used by `fadetobg` commands to swap
   * a fullscreen composited background behind the anim sprites.
   */
  animBgAssets: Record<string, string>;
}

/** Lightweight imperative API exposed to React. */
export interface BattleSceneApi {
  setBackdrop(id: string, url: string): void;
  setOpponent(url: string): void;
  setPlayer(url: string): void;
  setWeather(weather: Weather | null): void;
  lunge(side: "player" | "opponent", tintHex?: number): void;
  shake(side: "player" | "opponent"): void;
  hitFlash(side: "player" | "opponent"): void;
  critFlash(): void;
  faintFall(side: "player" | "opponent", frames: number): Promise<void>;
  /**
   * Point the side's healthbox at a live Pokemon instance. The healthbox
   * reads name / level / gender / currentHp / maxHp / exp directly off the
   * reference on subsequent `refreshHealthbox*` calls, so consumers never
   * push HP values through the scene API — they just mutate the Pokemon
   * (via `Battle`) and trigger a refresh.
   */
  bindHealthbox(side: BattleSide, pokemon: Pokemon): void;
  /**
   * Animated refresh — drains (or rises) the HP bar one bar-pixel per
   * GBA frame toward `pokemon.currentHp`, then animates the EXP bar on
   * the player side if it drifted. Resolves when settled. Called by the
   * runner in the damage and level-up/EXP beats.
   */
  refreshHealthbox(side: BattleSide): Promise<void>;
  /**
   * Snap every visible field to the bound Pokemon with no animation.
   * Used on switch-in (healthbox should appear already-at-current-HP,
   * not drain from full) and before faint-fall.
   */
  refreshHealthboxInstant(side: BattleSide): void;
  showDamagePopup(side: "player" | "opponent", amount: number): Promise<void>;
  /** Phase D shortcuts — see method bodies for descriptions. */
  paralysisFlash(side: "player" | "opponent"): void;
  burnPulse(side: "player" | "opponent"): void;
  chargeBrighten(side: "player" | "opponent"): void;
  setScreen(side: "player" | "opponent", kind: "reflect" | "light_screen", on: boolean): void;
  statusFlash(side: "player" | "opponent", conditionId: number): void;
  /**
   * Play the full decomp animation for a move. Resolves when the animation
   * finishes (all spawned sprites destroyed, waitforvisualfinish completed).
   * Falls back to the semantic lunge if no decomp data is available.
   */
  playMoveAnimation(moveId: number, attackerSide: "player" | "opponent"): Promise<void>;
  /**
   * Play the battle-start intro: both trainers are visible on their
   * platforms, rival slides offscreen as its mon materializes, then the
   * player runs through the 5-frame throw animation and reveals its own
   * mon. Resolves when both mons are fully visible on their platforms.
   */
  playIntro(schedule: IntroSchedule): Promise<void>;
  /**
   * Play the battle-end outro: mons shrink + fade (recall), then the
   * trainer sprites slide back in from their offscreen positions.
   * Resolves when both trainers are in place ready for end-of-battle
   * dialogue.
   */
  playOutro(schedule: OutroSchedule): Promise<void>;
  /** HUD — decomp-faithful 2x2 action menu / move menu. */
  promptAction(ctx: ActionPromptCtx): Promise<HudAction>;
  promptMove(moves: MoveChoice[]): Promise<{ moveSlot: number } | "cancel">;
  /** Debug: spawn a decomp sprite by template name at the target's platform. */
  debugSpawnTemplate(templateName: string, side: "player" | "opponent"): Promise<void>;
  /** Phase E — BG layer compositing. */
  showAnimBg(bgId: string): Promise<void>;
  hideAnimBg(): Promise<void>;
  setMonBg(side: "player" | "opponent"): void;
  clearMonBg(): void;
  setSplitBgPrio(side: "player" | "opponent"): void;
  clearSplitBgPrio(): void;
}

export class BattleScene extends Phaser.Scene {
  private backdrop!: Phaser.GameObjects.Image;
  private opponentSprite!: Phaser.GameObjects.Image;
  private playerSprite!: Phaser.GameObjects.Image;
  /** Rival trainer sprite (front-pic) — visible during intro/outro only. */
  private rivalTrainerSprite!: Phaser.GameObjects.Image;
  /** Player trainer sprite (back-pic spritesheet, 5 throw frames). */
  private playerTrainerSprite!: Phaser.GameObjects.Sprite;
  private weatherLayer!: Phaser.GameObjects.Container;
  private currentWeather: Weather | null = null;
  private bootData!: SceneBootData;
  private animator!: MoveAnimator;
  private clock!: Clock;
  /** Persistent screen overlays per side (Reflect / Light Screen). */
  private screenOverlays: Record<
    "player" | "opponent",
    { reflect: Phaser.GameObjects.Rectangle | null; light_screen: Phaser.GameObjects.Rectangle | null }
  > = {
    player: { reflect: null, light_screen: null },
    opponent: { reflect: null, light_screen: null },
  };
  /** Phase E — currently-shown anim BG image (from `fadetobg`). */
  private currentAnimBg: Phaser.GameObjects.Image | null = null;
  /** Phase E — target mon that's been pushed to the BG layer via `monbg`. */
  private monBgState: {
    sprite: Phaser.GameObjects.Image;
    origDepth: number;
  } | null = null;
  /** Phase E — which side is currently the "front BG" per `splitbgprio`. */
  private splitBgState: "player" | "opponent" | null = null;
  /**
   * In-battle healthboxes — one per Pokemon currently on the battlefield.
   * Each instance is tied to a single `Pokemon` reference passed to its
   * constructor; when a mon switches out (or faints permanently), the
   * healthbox is destroyed and a new one is constructed for the
   * incoming mon. Entries start as `null` until `bindHealthbox(side, p)`
   * is called for that side.
   */
  private healthboxes: Record<BattleSide, HealthBox | null> = {
    player: null,
    opponent: null,
  };
  /** Battle HUD facade — textbox, menus, page-break gate. */
  private hud!: Hud;
  /**
   * Resolves at the end of `create()`. The React-side BattleStage handle
   * awaits this before any method that touches sprite fields (notably
   * `playIntro`), because Phaser instantiates the scene instance
   * synchronously but defers `create()` to the next game tick — so the
   * runner can otherwise reach `this.rivalTrainerSprite` before it exists.
   */
  readonly ready: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    super({ key: "BattleScene" });
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
  }

  init(data: SceneBootData) {
    this.bootData = data;
    this.currentWeather = data.weather;
  }

  preload() {
    const d = this.bootData;
    this.load.image(KEY.backdrop(d.backdropId), d.backdropUrl);
    this.load.image(KEY.opponent, d.opponentUrl);
    this.load.image(KEY.player, d.playerUrl);
    this.load.image(KEY.rain, d.weatherAssets.rain);
    this.load.image(KEY.sandstorm, d.weatherAssets.sandstorm);
    this.load.image(KEY.fog, d.weatherAssets.fog);
    this.load.image(KEY.snow0, d.weatherAssets.snow0);
    this.load.image(KEY.snow1, d.weatherAssets.snow1);
    this.load.image(KEY.rivalTrainer, d.trainerAssets.rivalTrainer);
    this.load.spritesheet(KEY.playerTrainerSheet, d.trainerAssets.playerTrainerStrip, {
      frameWidth: PLAYER_THROW_FRAME_SIZE,
      frameHeight: PLAYER_THROW_FRAME_SIZE,
    });
    this.load.spritesheet(KEY.ballPoke, d.ballAssets.ballPoke, {
      frameWidth: 16,
      frameHeight: 16,
    });
    this.load.spritesheet(KEY.ballParticles, d.ballAssets.ballParticles, {
      frameWidth: 8,
      frameHeight: 8,
    });
    for (const [stem, url] of Object.entries(d.statMaskAssets ?? {})) {
      this.load.image(`statmask:${stem}`, url);
    }
    this.load.image(KEY.hbPlayer, d.hudAssets.healthboxPlayer);
    this.load.image(KEY.hbOpponent, d.hudAssets.healthboxOpponent);
    this.load.image(KEY.textboxChrome, d.hudAssets.textbox);
    this.load.image(KEY.pressAArrow, d.hudAssets.pressAArrow);
    this.load.image(KEY.menuCursor, d.hudAssets.menuCursor);
    this.load.image(KEY.menuChromeAction, d.hudAssets.menuChromeAction);
    this.load.image(KEY.menuChromeMoveNames, d.hudAssets.menuChromeMoveNames);
    this.load.image(KEY.menuChromeMoveInfo, d.hudAssets.menuChromeMoveInfo);
    this.load.image(KEY.menuChromeYesNo, d.hudAssets.menuChromeYesNo);
    // The Emerald TTF is loaded via CSS `@font-face` in `styles.css`,
    // not through the Phaser loader — all text goes through DOMElements
    // backed by an HTML `<span>` with `font-family: "Emerald"`. The
    // browser handles font loading; we trigger an explicit fetch in
    // `create()` below so the first draw isn't a FOUT.
  }

  create() {
    const d = this.bootData;

    this.backdrop = this.add
      .image(0, 0, KEY.backdrop(d.backdropId))
      .setOrigin(0, 0)
      .setDepth(0);

    // Sprites: Pokemon PNGs are 64x64 with the character occupying roughly the
    // bottom portion of the frame. We anchor origin at (0.5, 0.95) so setting
    // position at the platform anchor plants the mon's feet correctly.
    // Mons start hidden — the intro sequence reveals them after the trainer
    // animations play.
    this.opponentSprite = this.add
      .image(OPPONENT_ANCHOR.x, OPPONENT_ANCHOR.y, KEY.opponent)
      .setOrigin(0.5, 1.0)
      .setDepth(10)
      .setAlpha(0);

    this.playerSprite = this.add
      .image(PLAYER_ANCHOR.x, PLAYER_ANCHOR.y, KEY.player)
      .setOrigin(0.5, 1.0)
      .setDepth(11)
      .setAlpha(0);

    // Trainer sprites sit at the same anchor points as their respective
    // Pokemon and occupy the same depth slot. They start visible at full
    // alpha so the intro begins with both trainers squaring up.
    this.rivalTrainerSprite = this.add
      .image(OPPONENT_ANCHOR.x, OPPONENT_ANCHOR.y, KEY.rivalTrainer)
      .setOrigin(0.5, 1.0)
      .setDepth(10);

    this.playerTrainerSprite = this.add
      .sprite(PLAYER_ANCHOR.x, PLAYER_ANCHOR.y, KEY.playerTrainerSheet, 0)
      .setOrigin(0.5, 1.0)
      .setDepth(11);

    this.weatherLayer = this.add.container(0, 0).setDepth(20);
    this.applyWeather(this.currentWeather);

    this.clock = new PhaserClock(this);
    this.animator = new MoveAnimator(this, this.clock);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.clock.dispose());

    this.hud = new Hud(this, this.clock, {
      chromeKey: KEY.textboxChrome,
      chromeX: 0,
      chromeY: STAGE_HEIGHT,
      textX: 10,
      textY: STAGE_HEIGHT + 10,
      textMaxWidth: 220,
      textPalette: "dialogue",
      promptX: 219,
      promptY: 136,
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.hud.destroy();
    });

    // Healthboxes are constructed lazily per Pokemon via `bindHealthbox`.
    // On scene shutdown we destroy whichever pair is currently live.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.healthboxes.opponent?.destroy();
      this.healthboxes.player?.destroy();
      this.healthboxes = { player: null, opponent: null };
    });

    this.resolveReady();
  }

  /**
   * Construct (or reuse) a healthbox for the given Pokemon on `side`.
   * If a healthbox is already mounted for the same Pokemon reference,
   * this is a no-op. Otherwise the existing healthbox is destroyed
   * and a fresh one is built — the new healthbox paints itself visible
   * with the current state at construction time.
   */
  bindHealthbox(side: BattleSide, pokemon: Pokemon): void {
    const existing = this.healthboxes[side];
    if (existing && existing.pokemon === pokemon) return;
    existing?.destroy();
    this.healthboxes[side] =
      side === "player"
        ? new PlayerHealthBox(this, this.clock, {
            pokemon,
            chromeKey: KEY.hbPlayer,
            x: STAGE_WIDTH - 128,
            y: STAGE_HEIGHT - 64 - 2,
          })
        : new OpponentHealthBox(this, this.clock, {
            pokemon,
            chromeKey: KEY.hbOpponent,
            x: 0,
            y: 4,
          });
  }

  refreshHealthbox(side: BattleSide): Promise<void> {
    return this.healthboxes[side]?.refresh() ?? Promise.resolve();
  }

  refreshHealthboxInstant(side: BattleSide): void {
    this.healthboxes[side]?.refreshInstant();
  }

  /** Reveal `text` in the bottom textbox one glyph at a time. */
  showDialogue(text: string, fast = false): Promise<void> {
    console.log(`[battle ${performance.now().toFixed(0)}ms] message:start`, { text, fast });
    return this.hud.dialogue(text, fast).then(() => {
      console.log(`[battle ${performance.now().toFixed(0)}ms] message:end`, { text });
    });
  }

  /** Paint `text` in the textbox with no typewriter delay. */
  setDialogue(text: string): void {
    this.hud.dialogueInstant(text);
  }

  /** Wipe the current textbox contents. */
  clearDialogue(): void {
    this.hud.dialogueClear();
  }

  async promptAction(ctx: ActionPromptCtx): Promise<HudAction> {
    const result = await this.hud.battleOptions(ctx.activeMonName);
    return result === "switch" ? "pokemon" : result;
  }

  async promptMove(
    moves: MoveChoice[],
  ): Promise<{ moveSlot: number } | "cancel"> {
    const result = await this.hud.moveOptions(
      moves.map((m) => ({
        name: m.name,
        type: m.typeName,
        ppNow: m.currentPp,
        ppMax: m.maxPp,
        enabled: m.enabled,
      })),
    );
    if (!result) return "cancel";
    const slot = moves.findIndex((m) => m.name === result);
    return { moveSlot: slot };
  }


  // -------------------- Imperative API (called from React) --------------------

  setBackdrop(id: string, url: string) {
    const key = KEY.backdrop(id);
    if (this.textures.exists(key)) {
      this.backdrop.setTexture(key);
      return;
    }
    this.load.once(`filecomplete-image-${key}`, () => {
      this.backdrop.setTexture(key);
    });
    this.load.image(key, url);
    this.load.start();
  }

  setOpponent(url: string) {
    console.log(`[battle ${performance.now().toFixed(0)}ms] sprite:swap`, { side: "opponent", url });
    this.swapImageTexture(KEY.opponent, url, (newKey) => {
      this.opponentSprite.setTexture(newKey);
      this.resetActiveSprite("opponent");
    });
  }

  setPlayer(url: string) {
    console.log(`[battle ${performance.now().toFixed(0)}ms] sprite:swap`, { side: "player", url });
    this.swapImageTexture(KEY.player, url, (newKey) => {
      this.playerSprite.setTexture(newKey);
      this.resetActiveSprite("player");
    });
  }

  /**
   * Snap the active mon sprite back to a clean neutral pose at its anchor.
   * Called after swapping the texture on a switch or post-faint send-out so
   * lingering tween state (alpha 0 from faintFall, offset y from shake, tint
   * from a hit flash, etc.) never carries over to the replacement mon.
   */
  private resetActiveSprite(side: "player" | "opponent"): void {
    const sprite = this.pick(side);
    const anchor = side === "player" ? PLAYER_ANCHOR : OPPONENT_ANCHOR;
    // Kill any in-flight tween targeting this sprite — otherwise a still-
    // running faintFall will reapply alpha=0/y+48 after we reset.
    this.tweens.killTweensOf(sprite);
    sprite
      .setPosition(anchor.x, anchor.y)
      .setAlpha(1)
      .setScale(1)
      .setAngle(0)
      .clearTint();
    console.log(
      `[battle ${performance.now().toFixed(0)}ms] sprite:reset`,
      { side, x: anchor.x, y: anchor.y },
    );
  }

  setWeather(weather: Weather | null) {
    if (weather === this.currentWeather) return;
    this.currentWeather = weather;
    this.applyWeather(weather);
  }

  lunge(side: "player" | "opponent", tintHex?: number) {
    const sprite = this.pick(side);
    const dx = side === "player" ? 36 : -36;
    const dy = side === "player" ? -20 : 16;
    const startX = sprite.x;
    const startY = sprite.y;

    if (tintHex !== undefined) {
      sprite.setTint(tintHex).setTintMode(Phaser.TintModes.FILL);
      this.time.delayedCall(140, () => sprite.clearTint());
    }

    this.tweens.add({
      targets: sprite,
      x: startX + dx,
      y: startY + dy,
      scale: 1.08,
      duration: 180,
      ease: "Sine.easeOut",
      yoyo: true,
      onComplete: () => {
        sprite.x = startX;
        sprite.y = startY;
        sprite.setScale(1);
      },
    });
  }

  shake(side: "player" | "opponent") {
    const sprite = this.pick(side);
    const origX = sprite.x;
    const offsets = [-3, 3, -2, 2, -1, 1, 0];
    offsets.forEach((dx, i) => {
      this.time.delayedCall(i * 45, () => (sprite.x = origX + dx));
    });
  }

  hitFlash(side: "player" | "opponent") {
    const sprite = this.pick(side);
    sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.time.delayedCall(120, () => sprite.clearTint());
  }

  critFlash() {
    const rect = this.add
      .rectangle(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 0xffffff, 0.85)
      .setOrigin(0, 0)
      .setDepth(50)
      .setBlendMode(Phaser.BlendModes.SCREEN);
    this.tweens.add({
      targets: rect,
      alpha: 0,
      duration: 260,
      ease: "Cubic.easeOut",
      onComplete: () => rect.destroy(),
    });
  }

  /**
   * Phase I #5 — frame-locked faint. The runner picks the duration and
   * the tween ends on an integer frame boundary. Flash white → fall + fade.
   */
  faintFall(side: "player" | "opponent", frames: number): Promise<void> {
    const sprite = this.pick(side);
    console.log(`[battle ${performance.now().toFixed(0)}ms] faint:start`, { side, frames });
    sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    return new Promise<void>((resolve) => {
      this.tweens.add({
        targets: sprite,
        y: sprite.y + 48,
        alpha: 0,
        duration: Math.max(1, frames) * FRAME_MS,
        ease: "Quad.easeIn",
        onComplete: () => {
          sprite.clearTint();
          console.log(`[battle ${performance.now().toFixed(0)}ms] faint:end`, { side });
          resolve();
        },
      });
    });
  }

  /**
   * Phase I #2 — typewriter damage number over the target sprite. Each
   * digit is revealed on its own frame using the frame-locked DOM font
   * printer. The container fades out after a short hold.
   */
  async showDamagePopup(side: "player" | "opponent", amount: number): Promise<void> {
    if (!this.clock) return;
    const anchor = side === "player" ? PLAYER_ANCHOR : OPPONENT_ANCHOR;
    const text = String(Math.max(0, Math.floor(amount)));
    const printer = new BitmapFontPrinter(this, this.clock, {
      x: anchor.x - text.length * 5,
      y: anchor.y - 48,
      depth: 95,
      palette: "hud",
      maxWidth: 40,
    });
    await printer.print(text, /* fast */ true);
    await this.clock.wait(30);
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: printer.container,
        alpha: 0,
        duration: 14 * FRAME_MS,
        onComplete: () => {
          printer.destroy();
          resolve();
        },
      });
    });
  }

  // -------------------- Phase D: tint/fade shortcuts --------------------

  /** #2 Yellow tint flash on paralysis cant-move. */
  paralysisFlash(side: "player" | "opponent") {
    this.tintPulse(this.pick(side), 0xfff060, 90, 3);
  }

  /** #3 Red tint pulse on burn end-of-turn damage. */
  burnPulse(side: "player" | "opponent") {
    this.tintPulse(this.pick(side), 0xf04020, 110, 2);
  }

  /**
   * #4 Brightness ramp on charge moves (Solar Beam / Razor Wind / etc).
   * Ramps the attacker toward white over ~half a second then fades back.
   */
  chargeBrighten(side: "player" | "opponent") {
    const sprite = this.pick(side);
    sprite.setTint(0xffffe0).setTintMode(Phaser.TintModes.FILL);
    sprite.setAlpha(1);
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 480,
      yoyo: true,
      ease: "Sine.easeInOut",
      onUpdate: (tw) => {
        const v = (tw.getValue() as number | undefined) ?? 0;
        // Pulse the tint blend from baseline toward bright white.
        const channel = Math.round(0xa0 + v * 0x5f);
        const hex = (channel << 16) | (channel << 8) | channel;
        sprite.setTint(hex);
      },
      onComplete: () => {
        sprite.clearTint();
        sprite.setTintMode(Phaser.TintModes.MULTIPLY);
      },
    });
  }

  /**
   * #5 Toggle a tinted overlay rect for Reflect / Light Screen on a side.
   * Persistent — the overlay stays until the matching `_end` event arrives.
   */
  setScreen(
    side: "player" | "opponent",
    kind: "reflect" | "light_screen",
    on: boolean,
  ) {
    const slot = this.screenOverlays[side];
    if (on) {
      if (slot[kind]) return;
      const anchor = side === "player" ? PLAYER_ANCHOR : OPPONENT_ANCHOR;
      const color = kind === "reflect" ? 0x6890f0 : 0xf8d030;
      const rect = this.add
        .rectangle(anchor.x, anchor.y - 28, 72, 64, color, 0.18)
        .setOrigin(0.5, 0.5)
        .setDepth(side === "player" ? 12 : 11)
        .setBlendMode(Phaser.BlendModes.SCREEN);
      // Subtle alpha breathe so the wall reads as "active".
      this.tweens.add({
        targets: rect,
        alpha: 0.32,
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      slot[kind] = rect;
    } else {
      const r = slot[kind];
      if (!r) return;
      this.tweens.killTweensOf(r);
      r.destroy();
      slot[kind] = null;
    }
  }

  /** #6 Mon palette flash keyed off the applied status condition. */
  statusFlash(side: "player" | "opponent", conditionId: number) {
    const color = STATUS_TINT[conditionId];
    if (color === undefined) return;
    this.tintPulse(this.pick(side), color, 110, 3);
  }

  /**
   * Stat stage change BG overlay. Mirrors the decomp task pipeline
   * `AnimTask_StatsChange` → `InitStatsChangeAnimation` →
   * `StatsChangeAnimation_Step{1,2,3}` in
   * `src/battle_anim_utility_funcs.c:392+`.
   *
   * The decomp loads one of two tilemaps (up-arrows for increases,
   * down-arrows for decreases), picks a palette from the 8-entry
   * per-stat table, fades BG1 in over ~10 frames via `BLDALPHA`, holds
   * for ~20 frames, fades back out, and scrolls `gBattle_BG1_Y` by ±3
   * per tick so the arrows visibly travel up or down. We pre-composite
   * those 16 permutations at python extract time and fade the matching
   * RGBA PNG in here as a scrolling `tileSprite`.
   *
   * The `side` argument is recorded for trace parity with the status
   * flash family; the decomp overlay itself is full-screen and not
   * per-battler.
   */
  statStageFlash(
    side: "player" | "opponent",
    delta: number,
    statId?: number,
  ) {
    const direction = delta >= 0 ? "up" : "down";
    const palIndex = STAT_MASK_PALETTE[statId ?? 0] ?? 5;
    const textureKey = `statmask:stat_mask_${direction}_${palIndex}`;
    if (!this.textures.exists(textureKey)) {
      console.warn(`[BattleScene] missing stat mask texture: ${textureKey}`);
      return;
    }

    // Decomp clips the stat BG mask to the affected battler's silhouette
    // via `StatsChangeAnimation_Step1` (`battle_anim_utility_funcs.c:402`):
    // it enables `DISPCNT_OBJWIN_ON`, then `CreateInvisibleSpriteCopy`
    // (`battle_anim_mons.c:2130`) duplicates the battler sprite with
    // `objMode = ST_OAM_OBJ_WINDOW`, so BG1's tilemap only draws where
    // the battler's opaque OBJ pixels are.
    //
    // Phaser 4 replaced `BitmapMask` with the Filters pipeline. The
    // critical catch: `gameObject.filters` is `null` until you call
    // `enableFilters()` on the object — so `filters?.internal.addMask(...)`
    // silently no-ops if filters haven't been enabled yet. TypeScript
    // accepts the optional chain because `filters` is typed
    // `FiltersInternalExternal | null`. An earlier version of this
    // function forgot the enable call and the mask never attached,
    // which is why the stat overlay was still painting across the
    // whole stage.
    const battler = this.pick(side);
    const overlay = this.add
      .tileSprite(0, 0, STAGE_WIDTH, STAGE_HEIGHT, textureKey)
      .setOrigin(0, 0)
      .setDepth(60)
      .setAlpha(0);
    overlay.enableFilters();
    if (!overlay.filters) {
      // Renderer has no WebGL context (headless tests). Bail before we
      // try to dereference a null filter list; the fade + scroll below
      // still runs, and the test renderer never sees this branch.
      console.warn(
        "[BattleScene] statStageFlash: overlay.filters is null after enableFilters()",
      );
    } else {
      overlay.filters.internal.addMask(battler);
    }

    // Frame budget mirrors `StatsChangeAnimation_Step2` (non-sharp path):
    // 10-frame fade-in, 20-frame hold, 10-frame fade-out = 40 total.
    // The decomp uses `data[4]=10` / `data[5]=20` for the non-sharp case
    // — we match those exactly so the narration gate
    // (`STAT_CHANGE_FLASH_FRAMES`) lines up with the fade-out tail.
    const fadeInFrames = 10;
    const holdFrames = 20;
    const fadeOutFrames = 10;
    const totalFrames = fadeInFrames + holdFrames + fadeOutFrames;
    // `gBattle_BG1_Y += ±3` per tick — at 60fps that's ~180 px across the
    // full 40-frame beat, enough that the arrows read as "scrolling".
    const scrollPerFrame = delta >= 0 ? -3 : 3;

    this.tweens.add({
      targets: overlay,
      alpha: 0.9,
      duration: fadeInFrames * FRAME_MS,
      ease: "Linear",
    });
    this.time.delayedCall((fadeInFrames + holdFrames) * FRAME_MS, () => {
      this.tweens.add({
        targets: overlay,
        alpha: 0,
        duration: fadeOutFrames * FRAME_MS,
        ease: "Linear",
        onComplete: () => overlay.destroy(),
      });
    });

    // Scroll the tilemap vertically for the full beat.
    let elapsedMs = 0;
    const totalMs = totalFrames * FRAME_MS;
    const scroll = (_time: number, deltaMs: number) => {
      // Abort if the battler sprite is destroyed mid-animation (e.g.
      // a chained faint) — the mask filter would otherwise keep trying
      // to sample from a dead GameObject.
      if (!battler.active) {
        overlay.destroy();
        this.events.off(Phaser.Scenes.Events.UPDATE, scroll);
        return;
      }
      elapsedMs += deltaMs;
      overlay.tilePositionY += scrollPerFrame * (deltaMs / FRAME_MS);
      if (elapsedMs >= totalMs) {
        this.events.off(Phaser.Scenes.Events.UPDATE, scroll);
      }
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, scroll);
  }

  /**
   * Play the ball-release sub-sequence at `pos` for `side`. Mirrors
   * `SpriteCB_ReleaseMonFromBall` in `src/pokeball.c:763`:
   *
   *   1. `StartSpriteAnim(sprite, 1)` — cycle through ball frames 0→1→2
   *      (closed → half-open → open), one frame per ~4 game frames.
   *   2. `AnimateBallOpenParticles(...)` — white particle burst radiating
   *      out from the ball center; particles use the 8x8 particle sheet.
   *   3. `LaunchBallFadeMonTask(...)` + `StartSpriteAffineAnim(...,
   *      BATTLER_AFFINE_EMERGE)` — the mon fades in with the ball color
   *      and scales up into place from a small start scale.
   *
   * Resolves once the emerge sub-phase finishes. The caller is
   * responsible for having already spawned the mon sprite (this method
   * drives its alpha + scale back to normal — it does not create it).
   */
  async playBallRelease(
    side: "player" | "opponent",
    pos: { x: number; y: number },
    schedule: BallReleaseSchedule,
  ): Promise<void> {
    console.log(`[battle ${performance.now().toFixed(0)}ms] ball-release:start`, {
      side,
      pos,
      schedule,
    });
    const ball = this.add
      .sprite(pos.x, pos.y - 20, KEY.ballPoke, 0)
      .setOrigin(0.5, 0.5)
      .setDepth(13);

    // --- Phase 1: ball-open sprite frames. --------------------------------
    const framesPerCell = Math.max(1, Math.floor(schedule.openFrames / 3));
    for (let i = 0; i < 3; i++) {
      ball.setFrame(i);
      await this.clock.wait(framesPerCell);
    }
    const openRemainder = schedule.openFrames - framesPerCell * 3;
    if (openRemainder > 0) await this.clock.wait(openRemainder);

    // --- Phase 2: white particle burst. -----------------------------------
    // Spawn 6 particles around the ball center and tween them outward on a
    // radial vector, cycling through the 8-frame particle strip so each one
    // animates individually. Matches the "8 stars radiating out" look of
    // `AnimateBallOpenParticles`.
    const particleCount = 6;
    const particles: Phaser.GameObjects.Sprite[] = [];
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const p = this.add
        .sprite(ball.x, ball.y, KEY.ballParticles, i % 8)
        .setOrigin(0.5, 0.5)
        .setDepth(14)
        .setBlendMode(Phaser.BlendModes.ADD);
      particles.push(p);
      this.tweens.add({
        targets: p,
        x: ball.x + Math.cos(angle) * 18,
        y: ball.y + Math.sin(angle) * 18,
        alpha: 0,
        duration: schedule.particleFrames * FRAME_MS,
        ease: "Sine.easeOut",
      });
    }
    await this.clock.wait(schedule.particleFrames);
    for (const p of particles) p.destroy();

    // --- Phase 3: `BATTLER_AFFINE_EMERGE` — mon scales up into place. -----
    const sprite = this.pick(side);
    sprite.setAlpha(1).setScale(0.25);
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: sprite,
        scale: 1,
        duration: schedule.emergeFrames * FRAME_MS,
        ease: "Back.easeOut",
        onComplete: () => resolve(),
      });
    });
    ball.destroy();
    console.log(`[battle ${performance.now().toFixed(0)}ms] ball-release:end`, { side });
  }

  private tintPulse(
    sprite: Phaser.GameObjects.Image,
    hex: number,
    halfMs: number,
    pulses: number,
  ) {
    let i = 0;
    const tick = () => {
      if (i >= pulses * 2) {
        sprite.clearTint();
        sprite.setTintMode(Phaser.TintModes.MULTIPLY);
        return;
      }
      if (i % 2 === 0) sprite.setTint(hex).setTintMode(Phaser.TintModes.FILL);
      else sprite.clearTint();
      i++;
      this.time.delayedCall(halfMs, tick);
    };
    tick();
  }

  /**
   * Play the decomp animation for a given move id. Maps `ANIM_ATTACKER` /
   * `ANIM_TARGET` to the current battle sides and awaits the full command
   * list. If the move has no decomp animation (very few do), fall back to
   * the semantic lunge so there's still a visual tell.
   */
  async playMoveAnimation(moveId: number, attackerSide: "player" | "opponent") {
    const animation: PokedataAnimation | undefined = getMoveAnimation(moveId);
    const targetSide = attackerSide === "player" ? "opponent" : "player";
    console.log(`[battle ${performance.now().toFixed(0)}ms] anim:start`, {
      moveId,
      attackerSide,
      hasDecompAnim: !!animation,
    });
    const animStart = performance.now();
    if (!animation) {
      this.lunge(attackerSide);
      await new Promise((r) => this.time.delayedCall(400, r));
      console.log(`[battle ${performance.now().toFixed(0)}ms] anim:end`, {
        moveId,
        attackerSide,
        durationMs: Math.round(performance.now() - animStart),
        fallback: "lunge",
      });
      return;
    }
    await this.animator.play(animation, {
      attackerSide,
      targetSide,
      getBattlerPos: (battler: Battler) => {
        const side =
          battler === "ANIM_ATTACKER" || battler === "ANIM_ATK_PARTNER"
            ? attackerSide
            : targetSide;
        return side === "player" ? PLAYER_ANCHOR : OPPONENT_ANCHOR;
      },
      getBattlerSprite: (battler: Battler) => {
        const side =
          battler === "ANIM_ATTACKER" || battler === "ANIM_ATK_PARTNER"
            ? attackerSide
            : targetSide;
        return side === "player" ? this.playerSprite : this.opponentSprite;
      },
    });
    console.log(`[battle ${performance.now().toFixed(0)}ms] anim:end`, {
      moveId,
      attackerSide,
      durationMs: Math.round(performance.now() - animStart),
    });
  }

  // -------------------- Intro / outro sequences --------------------

  /**
   * Intro beat 1 — snap the scene to the opening pose. Both trainers are
   * visible on their platforms, both mons are hidden. The runner holds
   * this pose while it types "The battle begins!"; no internal wait.
   */
  async playIntroSquareOff(_schedule: IntroSchedule): Promise<void> {
    console.log(`[battle ${performance.now().toFixed(0)}ms] intro:square-off`);
    this.rivalTrainerSprite.setPosition(OPPONENT_ANCHOR.x, OPPONENT_ANCHOR.y).setAlpha(1);
    this.playerTrainerSprite.setPosition(PLAYER_ANCHOR.x, PLAYER_ANCHOR.y).setAlpha(1).setFrame(0);
    this.opponentSprite.setAlpha(0);
    this.playerSprite.setAlpha(0);
    console.log(`[battle ${performance.now().toFixed(0)}ms] sprite:hide`, { side: "opponent", reason: "intro-init" });
    console.log(`[battle ${performance.now().toFixed(0)}ms] sprite:hide`, { side: "player", reason: "intro-init" });
  }

  /**
   * Intro beat 2 — mirrors `BattleIntroOpponentSendsOutMonAnimation`
   * (`src/battle_main.c:2748`) + `OpponentHandleIntroTrainerBallThrow`
   * (`src/battle_controller_opponent.c:1626`):
   *
   *   1. Rival trainer slides off to the right.
   *   2. A Poke Ball sprite remains at the opponent anchor — the ball
   *      the trainer "threw" while sliding off.
   *   3. `SpriteCB_ReleaseMonFromBall`: ball opens → particle burst →
   *      mon scale-in. `playBallRelease` owns all three sub-beats.
   *
   * Resolves once the mon has fully emerged.
   */
  async playIntroOpponentReveal(schedule: IntroSchedule): Promise<void> {
    const s = schedule;
    console.log(`[battle ${performance.now().toFixed(0)}ms] intro:opponent-reveal`);
    // Start the rival slide and await it. The decomp keeps the ball
    // visible at the spot the trainer threw it from — we skip the in-flight
    // arc for the opponent because the opponent trainer sprite itself is
    // the "throw motion" in Gen 3, and the mon emerges at the platform
    // anchor.
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: this.rivalTrainerSprite,
        x: OPPONENT_OFFSCREEN_X,
        alpha: 0,
        duration: s.rivalSlideFrames * FRAME_MS,
        ease: "Sine.easeIn",
        onComplete: () => resolve(),
      });
    });
    // Opponent mon stays hidden until the emerge phase owns its alpha.
    this.opponentSprite.setAlpha(0);
    await this.playBallRelease("opponent", OPPONENT_ANCHOR, BALL_RELEASE_SCHEDULE);
  }

  /**
   * Intro beat 3 — mirrors `BattleIntroPlayerSendsOutMonAnimation`
   * (`src/battle_main.c:2803`) + `PlayerHandleIntroTrainerBallThrow`.
   *
   * Unlike the opponent beat, the player side is a composite: the trainer
   * slide-off runs *concurrently* with the back-pic throw animation, and
   * the ball is released mid-throw (frame 2 of the 5-frame strip — the
   * "release" pose). The ball then arcs to the opponent platform and the
   * `playBallRelease` sub-sequence owns the ball-open / particles /
   * mon-emerge on the player anchor.
   *
   * Resolves once the player mon has fully emerged.
   */
  async playIntroPlayerReveal(schedule: IntroSchedule): Promise<void> {
    const s = schedule;
    console.log(`[battle ${performance.now().toFixed(0)}ms] intro:player-reveal`);

    // --- Gap before the player throws. ---
    await this.clock.wait(s.midGapFrames);

    // --- Player back-pic throw animation — rebuild per intro so the
    //     cadence tracks `timings.ts` rather than being pinned at 11fps.
    const animKey = "player_throw";
    if (this.anims.exists(animKey)) this.anims.remove(animKey);
    this.anims.create({
      key: animKey,
      frames: this.anims.generateFrameNumbers(KEY.playerTrainerSheet, {
        start: 0,
        end: PLAYER_THROW_FRAME_COUNT - 1,
      }),
      duration: s.throwFrames * FRAME_MS,
      repeat: 0,
    });

    // --- Concurrent: trainer slide-off + throw animation. The ball
    //     spawns the moment the throw anim hits the "release" frame
    //     (frame 2 of 5), matching the decomp's mid-throw release.
    const releaseFrame = 2;
    const ballReleasedDeferred: { resolve: () => void } = { resolve: () => {} };
    const ballReleased = new Promise<void>((resolve) => {
      ballReleasedDeferred.resolve = resolve;
    });
    this.playerTrainerSprite.on(
      Phaser.Animations.Events.ANIMATION_UPDATE,
      (_anim: unknown, frame: Phaser.Animations.AnimationFrame) => {
        if (frame.index - 1 === releaseFrame) {
          this.playerTrainerSprite.off(Phaser.Animations.Events.ANIMATION_UPDATE);
          ballReleasedDeferred.resolve();
        }
      },
    );
    const throwDone = new Promise<void>((resolve) => {
      this.playerTrainerSprite.once(
        Phaser.Animations.Events.ANIMATION_COMPLETE,
        () => resolve(),
      );
      this.playerTrainerSprite.play(animKey);
    });
    const slideDone = new Promise<void>((resolve) => {
      this.tweens.add({
        targets: this.playerTrainerSprite,
        x: PLAYER_OFFSCREEN_X,
        alpha: 0,
        duration: s.playerSlideFrames * FRAME_MS,
        delay: s.throwFrames * FRAME_MS * 0.6,
        ease: "Sine.easeIn",
        onComplete: () => resolve(),
      });
    });

    // Wait for the release frame to spawn the ball, then immediately start
    // the arc tween. The trainer continues its throw/slide in parallel.
    await ballReleased;
    const ballTextureKey = await ensureSheetLoaded(
      this,
      "ANIM_TAG_POKEBALL",
      16,
      16,
    );
    const ball = this.add
      .image(PLAYER_ANCHOR.x + 8, PLAYER_ANCHOR.y - 24, ballTextureKey, 0)
      .setOrigin(0.5, 0.5)
      .setDepth(12);
    const arcStart = { x: ball.x, y: ball.y };
    const arcEnd = { x: PLAYER_ANCHOR.x, y: PLAYER_ANCHOR.y - 36 };
    const arcApex = { x: (arcStart.x + arcEnd.x) / 2, y: arcStart.y - 48 };
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: ball,
        x: arcEnd.x,
        y: arcEnd.y,
        duration: s.ballArcFrames * FRAME_MS,
        ease: "Sine.easeOut",
        onUpdate: (tw) => {
          const t = tw.progress;
          ball.y =
            (1 - t) * arcStart.y +
            t * arcEnd.y -
            Math.sin(t * Math.PI) * (arcStart.y - arcApex.y);
          ball.rotation += 0.3;
        },
        onComplete: () => resolve(),
      });
    });
    ball.destroy();

    // Make sure the throw + slide tweens are finished before the player mon
    // emerges (they should already be — the arc is short — but the await
    // is cheap insurance).
    await Promise.all([throwDone, slideDone]);

    this.playerSprite.setAlpha(0);
    await this.playBallRelease("player", PLAYER_ANCHOR, BALL_RELEASE_SCHEDULE);
  }

  /**
   * Battle-end outro:
   *
   *   1. Both mons shrink + fade out ("recall" — stand-in for the red laser
   *      recall animation).
   *   2. Trainer sprites slide back in from their offscreen positions and
   *      fade to full alpha.
   *
   * Resolves when trainers are in place. The caller (React layer) is
   * responsible for the post-outro dialogue.
   */
  /**
   * Phase I #7 — frame-locked outro. The "authentic red-laser recall" from
   * the decomp uses a Phase F sprite template (`AnimRecallPokemon`) that
   * hasn't been ported yet; until it lands we keep the Phase A shrink-fade
   * stand-in but re-key it to `schedule.recallFrames` so the cadence is
   * at least frame-accurate. The trainers then slide back in over
   * `schedule.trainerSlideFrames`.
   */
  async playOutro(schedule: OutroSchedule): Promise<void> {
    const s = schedule;
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: [this.playerSprite, this.opponentSprite],
        alpha: 0,
        scale: 0.2,
        duration: s.recallFrames * FRAME_MS,
        ease: "Quad.easeIn",
        onComplete: () => resolve(),
      });
    });

    this.playerTrainerSprite.setFrame(0);

    this.tweens.add({
      targets: this.rivalTrainerSprite,
      x: OPPONENT_ANCHOR.x,
      alpha: 1,
      duration: s.trainerSlideFrames * FRAME_MS,
      ease: "Sine.easeOut",
    });
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: this.playerTrainerSprite,
        x: PLAYER_ANCHOR.x,
        alpha: 1,
        duration: s.trainerSlideFrames * FRAME_MS,
        ease: "Sine.easeOut",
        onComplete: () => resolve(),
      });
    });
  }

  /**
   * Debug helper for Phase 2: spawn a decomp sprite template at the target's
   * platform to verify the extraction → Phaser pipeline end-to-end.
   *
   * Phase 3 replaces this with a full animations.json command interpreter.
   */
  async debugSpawnTemplate(templateName: string, side: "player" | "opponent") {
    const tmpl = resolveTemplate(templateName);
    if (!tmpl || !tmpl.frameWidth || !tmpl.frameHeight) {
      console.warn(`[BattleScene] unknown or size-less template: ${templateName}`);
      return;
    }
    const textureKey = await ensureSheetLoaded(
      this,
      tmpl.tileTag,
      tmpl.frameWidth,
      tmpl.frameHeight,
    );
    const targetSprite = this.pick(side);
    const x = targetSprite.x;
    const y = targetSprite.y - 30;

    const sprite = this.add.sprite(x, y, textureKey, 0).setDepth(30);
    sprite.setOrigin(0.5, 0.5);

    // If the template has at least one anim sequence, register it on the
    // scene and play it on the sprite. One-shot anim, then destroy.
    const sequence = tmpl.anims[0];
    if (sequence && sequence.length > 0) {
      const animKey = `anim:${templateName}`;
      if (!this.anims.exists(animKey)) {
        const frames = sequence.map((cmd) => ({
          key: textureKey,
          frame: tileOffsetToFrameIndex(cmd.tileOffset, tmpl.frameWidth!, tmpl.frameHeight!),
          duration: cmd.duration * 16.67,
        }));
        this.anims.create({
          key: animKey,
          frames,
          repeat: 0,
        });
      }
      sprite.play(animKey);
      sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.destroy());
      // Safety: destroy after 2s regardless.
      this.time.delayedCall(2000, () => sprite.destroy());
    } else {
      // Static template — linger for 700ms then fade.
      this.tweens.add({
        targets: sprite,
        alpha: 0,
        duration: 700,
        delay: 400,
        onComplete: () => sprite.destroy(),
      });
    }
  }

  // -------------------- Phase E: BG layer compositing --------------------

  /**
   * Swap to a fullscreen battle-anim background by logical id (e.g.
   * `BG_DRILL`). Cross-fades the normal environment backdrop out as the
   * anim BG fades in over ~200 ms. Idempotent — showing the same id while
   * already showing it is a no-op.
   */
  async showAnimBg(bgId: string): Promise<void> {
    const url = this.bootData.animBgAssets?.[bgId];
    if (!url) {
      console.debug(`[BattleScene] no anim BG asset for ${bgId}`);
      return;
    }
    const key = `anim_bg:${bgId}`;
    if (!this.textures.exists(key)) {
      await new Promise<void>((resolve) => {
        this.load.once(`filecomplete-image-${key}`, () => resolve());
        this.load.image(key, url);
        this.load.start();
      });
    }
    // Drop any prior BG instantly to avoid layered overlaps.
    this.currentAnimBg?.destroy();
    const img = this.add
      .image(0, 0, key)
      .setOrigin(0, 0)
      .setDepth(ANIM_BG_DEPTH)
      .setAlpha(0);
    this.currentAnimBg = img;
    await new Promise<void>((resolve) => {
      this.tweens.add({ targets: this.backdrop, alpha: 0.15, duration: 200 });
      this.tweens.add({
        targets: img,
        alpha: 1,
        duration: 200,
        onComplete: () => resolve(),
      });
    });
  }

  /** Fade the current anim BG back out and restore the environment backdrop. */
  async hideAnimBg(): Promise<void> {
    const img = this.currentAnimBg;
    if (!img) return;
    this.currentAnimBg = null;
    await new Promise<void>((resolve) => {
      this.tweens.add({ targets: this.backdrop, alpha: 1, duration: 200 });
      this.tweens.add({
        targets: img,
        alpha: 0,
        duration: 200,
        onComplete: () => {
          img.destroy();
          resolve();
        },
      });
    });
  }

  /**
   * Push a target mon down into the BG layer band and darken it, so anim
   * particles that spawn at the default sprite depth render cleanly on top.
   * Idempotent — consecutive `setMonBg` calls reuse the same stashed depth.
   */
  setMonBg(side: "player" | "opponent") {
    if (this.monBgState) return;
    const sprite = this.pick(side);
    const origDepth = sprite.depth;
    sprite.setDepth(MON_BG_DEPTH);
    // Darken the mon's palette — stand-in for the decomp palette blend that
    // fades the target toward black behind the animation.
    sprite.setTint(0x606060);
    this.monBgState = { sprite, origDepth };
  }

  /** Restore a monbg'd target's depth and clear its darken tint. */
  clearMonBg() {
    if (!this.monBgState) return;
    const { sprite, origDepth } = this.monBgState;
    sprite.clearTint();
    sprite.setDepth(origDepth);
    this.monBgState = null;
  }

  /**
   * Mark the attacker side as "front BG priority" and the target as "back BG".
   * On the GBA this swaps which BG layer the two mons render on so an anim
   * sprite can pass between them. We approximate by nudging the attacker's
   * depth up a few slots — good enough for anim sprites spawned at the
   * default depth to land in between.
   */
  setSplitBgPrio(side: "player" | "opponent") {
    this.clearSplitBgPrio();
    const sprite = this.pick(side);
    sprite.setDepth(sprite.depth + 10);
    this.splitBgState = side;
  }

  /** Restore sprite depths after a `splitbgprio` block ends. */
  clearSplitBgPrio() {
    if (!this.splitBgState) return;
    const sprite = this.pick(this.splitBgState);
    sprite.setDepth(this.splitBgState === "player" ? 11 : 10);
    this.splitBgState = null;
  }

  // -------------------- Internal --------------------

  private pick(side: "player" | "opponent"): Phaser.GameObjects.Image {
    return side === "player" ? this.playerSprite : this.opponentSprite;
  }

  /**
   * Load `url` under a fresh versioned key and atomically point the sprite
   * at it once loading completes. We deliberately do NOT call
   * `textures.remove(baseKey)` up front — doing so leaves the sprite bound
   * to a detached texture for the several frames before the replacement
   * arrives, which crashes the renderer with
   *   TypeError: null is not an object (evaluating 'frame.source.resolution')
   * because Phaser keeps drawing the sprite every tick in between. Instead
   * we load under `baseKey#N`, swap on completion, and only then free the
   * old texture.
   */
  private swapKeyVersion: Record<string, number> = {};
  private swapImageTexture(baseKey: string, url: string, apply: (key: string) => void) {
    const version = (this.swapKeyVersion[baseKey] ?? 0) + 1;
    this.swapKeyVersion[baseKey] = version;
    const newKey = `${baseKey}#${version}`;
    const oldKey =
      version > 1 && this.textures.exists(`${baseKey}#${version - 1}`)
        ? `${baseKey}#${version - 1}`
        : this.textures.exists(baseKey)
          ? baseKey
          : null;
    this.load.once(`filecomplete-image-${newKey}`, () => {
      apply(newKey);
      if (oldKey && oldKey !== newKey && this.textures.exists(oldKey)) {
        this.textures.remove(oldKey);
      }
    });
    this.load.image(newKey, url);
    this.load.start();
  }

  private applyWeather(weather: Weather | null) {
    this.weatherLayer.removeAll(true);
    if (!weather || weather === "clear") return;

    if (weather === "rain" || weather === "heavy-rain") {
      this.buildRain();
    } else if (weather === "sandstorm") {
      this.buildScrollingTile(KEY.sandstorm, 0.9);
    } else if (weather === "strong-winds") {
      this.buildScrollingTile(KEY.fog, 0.4);
    } else if (weather === "sun" || weather === "harsh-sun") {
      const tint = this.add
        .rectangle(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 0xffcc66, 0.18)
        .setOrigin(0, 0)
        .setBlendMode(Phaser.BlendModes.SCREEN);
      this.weatherLayer.add(tint);
    } else if (weather === "hail") {
      this.buildHail();
    }
  }

  private buildRain() {
    // The decomp rain.png is 16x192 = 12 frames of 16x16. We create a tile
    // sprite, cycle its frame by animating the scroll offset with stepped
    // easing, and also drift it horizontally for motion.
    const tex = this.textures.get(KEY.rain);
    if (!tex) return;
    const tile = this.add.tileSprite(0, 0, STAGE_WIDTH, STAGE_HEIGHT, KEY.rain).setOrigin(0, 0);
    // Frame cycling: step tilePositionY through 12 frames over 900ms.
    this.time.addEvent({
      delay: 75,
      loop: true,
      callback: () => {
        tile.tilePositionY = (tile.tilePositionY + 16) % 192;
        tile.tilePositionX = (tile.tilePositionX + 2) % 16;
      },
    });
    // Subtle blue tint.
    const tint = this.add
      .rectangle(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 0x2850a0, 0.18)
      .setOrigin(0, 0);
    this.weatherLayer.add([tint, tile]);
  }

  private buildScrollingTile(key: string, speed: number) {
    const tile = this.add.tileSprite(0, 0, STAGE_WIDTH, STAGE_HEIGHT, key).setOrigin(0, 0);
    this.time.addEvent({
      delay: 33,
      loop: true,
      callback: () => {
        tile.tilePositionX -= speed;
      },
    });
    this.weatherLayer.add(tile);
  }

  private buildHail() {
    // Spawn ~20 snow sprites with randomized positions and fall tweens.
    const flakes: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < 22; i++) {
      const tex = i % 2 === 0 ? KEY.snow0 : KEY.snow1;
      const flake = this.add
        .image(Math.random() * STAGE_WIDTH, -8 - Math.random() * STAGE_HEIGHT, tex)
        .setOrigin(0.5, 0.5)
        .setScale(1);
      flakes.push(flake);

      const fallOnce = () => {
        flake.x = Math.random() * STAGE_WIDTH;
        flake.y = -8;
        const duration = 900 + Math.random() * 700;
        const drift = -20 - Math.random() * 20;
        this.tweens.add({
          targets: flake,
          x: flake.x + drift,
          y: STAGE_HEIGHT + 8,
          duration,
          delay: Math.random() * 400,
          ease: "Linear",
          onComplete: fallOnce,
        });
      };
      fallOnce();
    }
    this.weatherLayer.add(flakes);
  }
}
