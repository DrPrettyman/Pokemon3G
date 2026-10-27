import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import * as Phaser from "phaser";
import type { PartyMember, Pokemon, Weather } from "pokedata3g";
import { BattleScene, STAGE_WIDTH, CANVAS_HEIGHT, STAGE_SCALE } from "./BattleScene";
import { PartyMenuScene } from "./PartyMenuScene";
import type { PartyMenuSceneData } from "./PartyMenuScene";
import type {
  ActionPromptCtx,
  BallReleaseSchedule,
  HudAction,
  IntroSchedule,
  MoveChoice,
  OutroSchedule,
} from "../runtime/types";

import rainUrl from "../assets/weather/rain.png";
import sandstormUrl from "../assets/weather/sandstorm.png";
import fogUrl from "../assets/weather/fog_horizontal.png";
import snow0Url from "../assets/weather/snow0.png";
import snow1Url from "../assets/weather/snow1.png";

// Trainer sprites for the intro/outro sequence. The player back-pic is the
// full 64x320 5-frame strip — Phaser slices it into a spritesheet in preload.
import playerTrainerStripUrl from "../assets/trainers/player_back_strip.png";
import rivalTrainerUrl from "../assets/trainers/rival_front.png";
// Poke Ball assets used by `playBallRelease` during send-out beats. Extracted
// from FireRed via `python-scripts/extract_battle_graphics.py` (extract_hud).
import ballPokeUrl from "../assets/hud/ball_poke.png";
import ballParticlesUrl from "../assets/hud/ball_particles.png";
// Real FireRed battle HUD chrome — replaces the flat-rect placeholders
// that used to stand in for the healthboxes and textbox.
import healthboxPlayerUrl from "../assets/hud/healthbox_singles_player.png";
import healthboxOpponentUrl from "../assets/hud/healthbox_singles_opponent.png";
import textboxUrl from "../assets/hud/textbox.png";
// HUD cursors — extracted from the FireRed decomp:
//   press_a_arrow.png  = graphics/fonts/down_arrow_3.png (16×16, bouncing cursor)
//   menu_cursor.png    = graphics/battle_interface/textbox.png tiles 1+2 (8×16)
import pressAArrowUrl from "../assets/hud/press_a_arrow.png";
import menuCursorUrl from "../assets/hud/menu_cursor.png";
// Overlay window chromes (pre-composited 9-slice `gUserFrames[0]` =
// `graphics/text_window/type1.png`). See
// `python-scripts/extract_battle_graphics.py::_render_user_window`.
import menuChromeActionUrl from "../assets/hud/menu_chrome_action.png";
import menuChromeMoveNamesUrl from "../assets/hud/menu_chrome_move_names.png";
import menuChromeMoveInfoUrl from "../assets/hud/menu_chrome_move_info.png";
import menuChromeYesNoUrl from "../assets/hud/menu_chrome_yesno.png";
// Stat-change BG masks (16 pre-composited overlays: 8 palettes × 2
// directions). Extracted from FireRed `graphics/battle_anims/masks/`.
// Vite's eager glob import gives us a stable key→URL map we hand to
// the Phaser preloader so `statStageFlash` can look up the right mask.
const STAT_MASK_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob("../assets/hud/stat_masks/*.png", {
      eager: true,
      query: "?url",
      import: "default",
    }),
  ).map(([path, url]) => {
    const stem = path.split("/").pop()!.replace(/\.png$/, "");
    return [stem, url as string];
  }),
);
import { ANIM_BG_URLS } from "./animBgAssets";

const WEATHER_ASSETS = {
  rain: rainUrl,
  sandstorm: sandstormUrl,
  fog: fogUrl,
  snow0: snow0Url,
  snow1: snow1Url,
};

const TRAINER_ASSETS = {
  playerTrainerStrip: playerTrainerStripUrl,
  rivalTrainer: rivalTrainerUrl,
};

const BALL_ASSETS = {
  ballPoke: ballPokeUrl,
  ballParticles: ballParticlesUrl,
};

const HUD_ASSETS = {
  healthboxPlayer: healthboxPlayerUrl,
  healthboxOpponent: healthboxOpponentUrl,
  textbox: textboxUrl,
  pressAArrow: pressAArrowUrl,
  menuCursor: menuCursorUrl,
  menuChromeAction: menuChromeActionUrl,
  menuChromeMoveNames: menuChromeMoveNamesUrl,
  menuChromeMoveInfo: menuChromeMoveInfoUrl,
  menuChromeYesNo: menuChromeYesNoUrl,
};

export interface BattleStageHandle {
  /**
   * Resolves once the Phaser scene has finished `create()`. Callers that
   * touch sprite state (notably `playIntro`) must await this first —
   * Phaser defers `create()` to the game loop, so a freshly-constructed
   * stage has a scene instance but no sprites yet.
   */
  awaitReady(): Promise<void>;
  setBackdrop(id: string, url: string): void;
  setOpponent(url: string): void;
  setPlayer(url: string): void;
  setWeather(weather: Weather | null): void;
  lunge(side: "player" | "opponent", tintHex?: number): void;
  shake(side: "player" | "opponent"): void;
  hitFlash(side: "player" | "opponent"): void;
  critFlash(): void;
  faintFall(side: "player" | "opponent", frames: number): Promise<void>;
  bindHealthbox(side: "player" | "opponent", pokemon: Pokemon): void;
  refreshHealthbox(side: "player" | "opponent"): Promise<void>;
  refreshHealthboxInstant(side: "player" | "opponent"): void;
  showDamagePopup(side: "player" | "opponent", amount: number): Promise<void>;
  paralysisFlash(side: "player" | "opponent"): void;
  burnPulse(side: "player" | "opponent"): void;
  chargeBrighten(side: "player" | "opponent"): void;
  setScreen(side: "player" | "opponent", kind: "reflect" | "light_screen", on: boolean): void;
  statusFlash(side: "player" | "opponent", conditionId: number): void;
  statStageFlash(side: "player" | "opponent", delta: number, statId?: number): void;
  playBallRelease(
    side: "player" | "opponent",
    pos: { x: number; y: number },
    schedule: BallReleaseSchedule,
  ): Promise<void>;
  playMoveAnimation(moveId: number, attackerSide: "player" | "opponent"): Promise<void>;
  playIntroSquareOff(schedule: IntroSchedule): Promise<void>;
  playIntroOpponentReveal(schedule: IntroSchedule): Promise<void>;
  playIntroPlayerReveal(schedule: IntroSchedule): Promise<void>;
  playOutro(schedule: OutroSchedule): Promise<void>;
  debugSpawnTemplate(templateName: string, side: "player" | "opponent"): Promise<void>;
  showAnimBg(bgId: string): Promise<void>;
  hideAnimBg(): Promise<void>;
  setMonBg(side: "player" | "opponent"): void;
  clearMonBg(): void;
  setSplitBgPrio(side: "player" | "opponent"): void;
  clearSplitBgPrio(): void;
  showDialogue(text: string, fast?: boolean): Promise<void>;
  setDialogue(text: string): void;
  clearDialogue(): void;
  /** HUD — 2x2 action menu (Fight / Bag / Pokémon / Run) and 4-slot move menu. */
  promptAction(ctx: ActionPromptCtx): Promise<HudAction>;
  promptMove(moves: MoveChoice[]): Promise<{ moveSlot: number } | "cancel">;
  /** Launch the Phaser party menu overlay. Returns selected index or null on cancel. */
  promptPartySwitch(
    party: PartyMember[],
    disabledIndices: number[],
    message?: string,
  ): Promise<number | null>;
}

interface Props {
  backdropId: string;
  backdropUrl: string;
  opponentUrl: string;
  playerUrl: string;
  weather: Weather | null;
}

/**
 * Thin React wrapper around a Phaser 4 Game hosting the BattleScene.
 *
 * The stage mounts once and is driven imperatively — props provide the initial
 * state, and subsequent updates go through the forwarded handle so we can
 * sequence them alongside the event drain loop without triggering React
 * re-renders inside the game loop.
 */
export const BattleStage = forwardRef<BattleStageHandle, Props>(function BattleStage(
  props,
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<BattleScene | null>(null);
  // Single source of truth for "is the scene fully booted?". The runner
  // starts calling into the stage as soon as React commits this component's
  // useImperativeHandle — but Phaser fires `READY` a few ticks later, and
  // the scene's `create()` runs later still. Gating sprite-touching calls
  // (playIntro, playOutro, playMoveAnimation) on this promise is what stops
  // playIntro from being a no-op on an unbooted scene — previously the
  // runner's pump blew past the intro and the trainers never got animated
  // off-stage.
  const readyPromiseRef = useRef<Promise<void> | null>(null);
  const readyResolverRef = useRef<(() => void) | null>(null);
  if (!readyPromiseRef.current) {
    readyPromiseRef.current = new Promise<void>((resolve) => {
      readyResolverRef.current = resolve;
    });
  }

  // Latest props stashed in a ref so the init callback can read them.
  const initialDataRef = useRef(props);
  initialDataRef.current = props;

  useEffect(() => {
    if (!hostRef.current) return;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current,
      width: STAGE_WIDTH * STAGE_SCALE,
      height: CANVAS_HEIGHT * STAGE_SCALE,
      pixelArt: true,
      backgroundColor: "#000000",
      scale: {
        mode: Phaser.Scale.NONE,
        zoom: STAGE_SCALE,
      },
      // Enable the DOM container so `scene.add.dom(...)` can mount
      // HTMLElements inside the scene's coordinate system. We use this
      // for battle text (dialogue + healthbox chrome) so the Emerald
      // TTF with its CPAL palette overrides can render crisply via
      // CSS `font-palette-values`.
      dom: { createContainer: true },
      scene: [BattleScene, PartyMenuScene],
    });

    gameRef.current = game;

    const data = initialDataRef.current;
    game.scene.start("BattleScene", {
      backdropId: data.backdropId,
      backdropUrl: data.backdropUrl,
      opponentUrl: data.opponentUrl,
      playerUrl: data.playerUrl,
      weather: data.weather,
      weatherAssets: WEATHER_ASSETS,
      trainerAssets: TRAINER_ASSETS,
      ballAssets: BALL_ASSETS,
      hudAssets: HUD_ASSETS,
      statMaskAssets: STAT_MASK_URLS,
      animBgAssets: ANIM_BG_URLS,
    });

    // Grab a reference to the live scene once it has booted and mark the
    // stage ready when its own `create()` resolves. We try both READY and
    // a one-shot synchronous capture because which one wins depends on
    // whether Phaser has already ticked by the time React commits.
    const captureScene = () => {
      if (sceneRef.current) return;
      const scene = game.scene.getScene("BattleScene") as BattleScene | null;
      if (!scene) return;
      sceneRef.current = scene;
      scene.ready.then(() => readyResolverRef.current?.());
    };
    game.events.once(Phaser.Core.Events.READY, captureScene);
    captureScene();

    return () => {
      sceneRef.current = null;
      game.destroy(true);
      gameRef.current = null;
    };
    // Empty dep array — the game is deliberately mounted once; updates flow
    // through the imperative handle below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      awaitReady: () => readyPromiseRef.current ?? Promise.resolve(),
      setBackdrop: (id, url) => sceneRef.current?.setBackdrop(id, url),
      setOpponent: (url) => sceneRef.current?.setOpponent(url),
      setPlayer: (url) => sceneRef.current?.setPlayer(url),
      setWeather: (w) => sceneRef.current?.setWeather(w),
      lunge: (side, tint) => sceneRef.current?.lunge(side, tint),
      shake: (side) => sceneRef.current?.shake(side),
      hitFlash: (side) => sceneRef.current?.hitFlash(side),
      critFlash: () => sceneRef.current?.critFlash(),
      faintFall: async (side, frames) =>
        sceneRef.current?.faintFall(side, frames) ?? Promise.resolve(),
      bindHealthbox: (side, pokemon) =>
        sceneRef.current?.bindHealthbox(side, pokemon),
      refreshHealthbox: async (side) =>
        sceneRef.current?.refreshHealthbox(side) ?? Promise.resolve(),
      refreshHealthboxInstant: (side) =>
        sceneRef.current?.refreshHealthboxInstant(side),
      showDamagePopup: async (side, amount) =>
        sceneRef.current?.showDamagePopup(side, amount) ?? Promise.resolve(),
      paralysisFlash: (side) => sceneRef.current?.paralysisFlash(side),
      burnPulse: (side) => sceneRef.current?.burnPulse(side),
      chargeBrighten: (side) => sceneRef.current?.chargeBrighten(side),
      setScreen: (side, kind, on) => sceneRef.current?.setScreen(side, kind, on),
      statusFlash: (side, id) => sceneRef.current?.statusFlash(side, id),
      statStageFlash: (side, delta, statId) =>
        sceneRef.current?.statStageFlash(side, delta, statId),
      playBallRelease: async (side, pos, schedule) => {
        await readyPromiseRef.current;
        await (sceneRef.current?.playBallRelease(side, pos, schedule) ?? Promise.resolve());
      },
      playMoveAnimation: async (moveId, side) => {
        await readyPromiseRef.current;
        await sceneRef.current?.playMoveAnimation(moveId, side);
      },
      playIntroSquareOff: async (schedule) => {
        await readyPromiseRef.current;
        await sceneRef.current?.playIntroSquareOff(schedule);
      },
      playIntroOpponentReveal: async (schedule) => {
        await readyPromiseRef.current;
        await sceneRef.current?.playIntroOpponentReveal(schedule);
      },
      playIntroPlayerReveal: async (schedule) => {
        await readyPromiseRef.current;
        await sceneRef.current?.playIntroPlayerReveal(schedule);
      },
      playOutro: async (schedule) => {
        await readyPromiseRef.current;
        await sceneRef.current?.playOutro(schedule);
      },
      debugSpawnTemplate: async (name, side) =>
        sceneRef.current?.debugSpawnTemplate(name, side) ?? Promise.resolve(),
      showAnimBg: async (bgId) =>
        sceneRef.current?.showAnimBg(bgId) ?? Promise.resolve(),
      hideAnimBg: async () =>
        sceneRef.current?.hideAnimBg() ?? Promise.resolve(),
      setMonBg: (side) => sceneRef.current?.setMonBg(side),
      clearMonBg: () => sceneRef.current?.clearMonBg(),
      setSplitBgPrio: (side) => sceneRef.current?.setSplitBgPrio(side),
      clearSplitBgPrio: () => sceneRef.current?.clearSplitBgPrio(),
      showDialogue: async (text, fast) =>
        sceneRef.current?.showDialogue(text, fast) ?? Promise.resolve(),
      setDialogue: (text) => sceneRef.current?.setDialogue(text),
      clearDialogue: () => sceneRef.current?.clearDialogue(),
      promptAction: async (ctx) => {
        await readyPromiseRef.current;
        return (
          sceneRef.current?.promptAction(ctx) ?? Promise.resolve("fight")
        );
      },
      promptMove: async (moves) => {
        await readyPromiseRef.current;
        return sceneRef.current?.promptMove(moves) ?? Promise.resolve("cancel");
      },
      promptPartySwitch: async (party, disabledIndices, message) => {
        await readyPromiseRef.current;
        const game = gameRef.current;
        if (!game) return null;

        const sceneData: PartyMenuSceneData = {
          party,
          disabledIndices,
          mode: "switch",
          message,
        };

        return new Promise<number | null>((resolve) => {
          // Start the party menu scene on top of the battle scene.
          // Use `start` (not `run`) so init/preload/create always fire,
          // even on repeated opens after a previous stop().
          game.scene.start("PartyMenuScene", sceneData);
          const partyScene = game.scene.getScene(
            "PartyMenuScene",
          ) as unknown as PartyMenuScene;
          if (!partyScene) {
            resolve(null);
            return;
          }

          const cleanup = () => {
            partyScene.events.off("party:select", onSelect);
            partyScene.events.off("party:cancel", onCancel);
            game.scene.stop("PartyMenuScene");
          };
          const onSelect = (data: { index: number }) => {
            cleanup();
            resolve(data.index);
          };
          const onCancel = () => {
            cleanup();
            resolve(null);
          };

          partyScene.events.once("party:select", onSelect);
          partyScene.events.once("party:cancel", onCancel);
        });
      },
    }),
    [],
  );

  return <div ref={hostRef} className="phaser-stage" />;
});
