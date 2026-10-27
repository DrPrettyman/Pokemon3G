/**
 * The exported `<PhaserBattle>` component — a single Gen 3 battle.
 *
 * PhaserBattle owns the Phaser stage and the runner. The action menu
 * (Fight/Bag/Pokémon/Run) and move menu are now drawn INSIDE Phaser
 * by `HudMenu`, driven via the HUD's keyboard input. React still owns
 * the bag and party pickers — when the HUD's action-menu confirms
 * "BAG" or "POKéMON", the runner calls `onRequestBag`/`onRequestSwitch`
 * and awaits whatever the host decides to mount. The battle is
 * effectively frozen while those promises are pending.
 *
 * See plan.md "Component contracts" for the locked prop shape.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { NpcTrainer, Player } from "pokedata3g";
import type { BattleOutcome, Weather } from "pokedata3g";

import { spriteUrlFor } from "../battle/spriteUrl";

import { BattleStage, type BattleStageHandle } from "../phaser/BattleStage";
import { createPhaserRenderer } from "../phaser/PhaserRenderer";
import { useBattleRunner } from "../runtime/useBattleRunner";
import { WallClock, type Clock } from "../runtime/clock";

/** Vite asset map: stem -> hashed URL. Populated at build time. */
const BACKDROP_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob("../assets/backdrops/*.png", {
      eager: true,
      query: "?url",
      import: "default",
    }),
  ).map(([path, url]) => {
    const stem = path.split("/").pop()!.replace(/\.png$/, "");
    return [stem, url as string];
  }),
);

export interface PhaserBattleProps {
  player: Player;
  opponent: Player | NpcTrainer;
  weather?: Weather | null;
  backdropId: string;
  /** Host renders an item-select UI. Resolve with the chosen item+target
   *  or null on cancel. Battle is paused while this promise is pending. */
  onRequestBag: () => Promise<{ itemId: number; partyIndex: number } | null>;
  /**
   * Host renders a party-switch UI. Resolve with the chosen party index
   * or null on cancel. If omitted, the Phaser-native PartyMenuScene is
   * used (the decomp-faithful party screen overlay).
   */
  onRequestSwitch?: () => Promise<number | null>;
  onComplete: (outcome: BattleOutcome) => void;
  /** Optional test-mode hook; defaults to wall-clock. */
  testClock?: Clock;
}

export function PhaserBattle({
  player,
  opponent,
  weather = null,
  backdropId,
  onRequestBag,
  onRequestSwitch,
  onComplete,
  testClock,
}: PhaserBattleProps) {
  const stageRef = useRef<BattleStageHandle>(null);

  // Dev helper: expose the stage on window for manual debug spawns.
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as unknown as { __stage: BattleStageHandle | null }).__stage =
        stageRef.current;
    }
  }, []);

  // Renderer + clock are constructed once and handed to the runner.
  const renderer = useMemo(
    () => createPhaserRenderer(() => stageRef.current),
    [],
  );
  const clock = useMemo(() => testClock ?? new WallClock(), [testClock]);

  // Default switch handler: uses the Phaser-native PartyMenuScene overlay.
  // The host can override this with a custom React overlay via onRequestSwitch.
  const defaultRequestSwitch = useCallback(async (): Promise<number | null> => {
    const stage = stageRef.current;
    if (!stage) return null;
    const members = [...player.party.members];
    const disabledIndices = members
      .map((m, i) => (m.isFainted ? i : -1))
      .filter((i) => i >= 0);
    return stage.promptPartySwitch(members, disabledIndices);
  }, [player]);

  const requestSwitch = onRequestSwitch ?? defaultRequestSwitch;

  const {
    snapshot,
    phase,
    submitReplacement,
    outcome,
  } = useBattleRunner({
    player,
    opponent,
    weather,
    environment: backdropId,
    renderer,
    clock,
    // The runner now drives the Bag and Party pickers itself via the
    // Phaser HUD's action menu — it calls these host callbacks
    // whenever the player picks BAG or POKéMON from the 2x2 grid.
    // When no onRequestSwitch is provided, the Phaser-native
    // PartyMenuScene overlay is used instead of a React overlay.
    requestBag: onRequestBag,
    requestSwitch,
  });

  // Forward the final outcome to the host once the runner resolves.
  useEffect(() => {
    if (outcome != null) onComplete(outcome);
  }, [outcome, onComplete]);

  // Drive Phaser sprite swaps when the active Pokemon changes.
  const prevPlayerSpeciesRef = useRef(snapshot.player.speciesId);
  const prevOpponentSpeciesRef = useRef(snapshot.opponent.speciesId);
  useEffect(() => {
    if (snapshot.player.speciesId !== prevPlayerSpeciesRef.current) {
      console.log(
        `[battle ${performance.now().toFixed(0)}ms] sprite:sync`,
        { side: "player", from: prevPlayerSpeciesRef.current, to: snapshot.player.speciesId },
      );
      prevPlayerSpeciesRef.current = snapshot.player.speciesId;
      const url = spriteUrlFor(snapshot.player.ref, "back");
      if (url) stageRef.current?.setPlayer(url);
    }
    if (snapshot.opponent.speciesId !== prevOpponentSpeciesRef.current) {
      console.log(
        `[battle ${performance.now().toFixed(0)}ms] sprite:sync`,
        { side: "opponent", from: prevOpponentSpeciesRef.current, to: snapshot.opponent.speciesId },
      );
      prevOpponentSpeciesRef.current = snapshot.opponent.speciesId;
      const url = spriteUrlFor(snapshot.opponent.ref, "front");
      if (url) stageRef.current?.setOpponent(url);
    }
  }, [
    snapshot.player.speciesId,
    snapshot.opponent.speciesId,
    snapshot.player.ref,
    snapshot.opponent.ref,
  ]);

  // Weather changes mid-battle (e.g. Rain Dance).
  useEffect(() => {
    stageRef.current?.setWeather(snapshot.weather);
  }, [snapshot.weather]);

  // Point the Phaser-owned healthboxes at the current active Pokemon on
  // each side, then snap their displayed fields to the live state. The
  // healthbox reads name / level / gender / currentHp / maxHp / exp off
  // the bound reference on refresh, so after the initial bind we only
  // need to trigger a snap when something visible changes. Damage drains
  // run through the runner's `refreshHealthbox(side)` call — this
  // effect's `refreshHealthboxInstant` is a no-op mid-drain (displayed
  // HP already matches the live Pokemon) and a cheap snap otherwise.
  //
  // The healthbox shows just the ALL CAPS nickname — no "Foe"/"Wild"
  // prefix. That prefix is dialogue-only (`HANDLE_NICKNAME_STRING_CASE`
  // in `src/battle_message.c:1813`), not used by the decomp's
  // `UpdateNickInHealthbox`.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.bindHealthbox("opponent", snapshot.opponent.ref);
    stage.bindHealthbox("player", snapshot.player.ref);
    stage.refreshHealthboxInstant("opponent");
    stage.refreshHealthboxInstant("player");
  }, [
    snapshot.opponent.ref,
    snapshot.opponent.name,
    snapshot.opponent.level,
    snapshot.opponent.currentHp,
    snapshot.opponent.maxHp,
    snapshot.opponent.gender,
    snapshot.opponent.expFraction,
    snapshot.player.ref,
    snapshot.player.name,
    snapshot.player.level,
    snapshot.player.currentHp,
    snapshot.player.maxHp,
    snapshot.player.gender,
    snapshot.player.expFraction,
  ]);

  const handleReplacement = useCallback(async () => {
    const idx = await requestSwitch();
    if (idx == null) return;
    submitReplacement(idx);
  }, [requestSwitch, submitReplacement]);

  // When the runner enters "awaiting-replacement", kick off the host
  // switch picker automatically — a faint forces a swap, no root menu.
  const awaitingReplacementRef = useRef(false);
  useEffect(() => {
    if (phase === "awaiting-replacement" && !awaitingReplacementRef.current) {
      awaitingReplacementRef.current = true;
      handleReplacement().finally(() => {
        awaitingReplacementRef.current = false;
      });
    }
  }, [phase, handleReplacement]);

  const isIntroPhase = phase === "intro";

  // NOTE: the in-battle textbox is now driven by BattleRunner via
  // `renderer.showMessage`, not by this React effect. The narration array
  // is still published so hosts can render a scrollback log, but the
  // Phaser textbox no longer listens to it — that indirection previously
  // caused duplicate/restarted typewriter runs whenever React re-rendered
  // mid-phase. We only clear the textbox on intro start here.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (isIntroPhase) stage.clearDialogue();
  }, [isIntroPhase]);

  const backdropUrl = BACKDROP_URLS[backdropId];
  const initialPlayerSprite = spriteUrlFor(snapshot.player.ref, "back") ?? "";
  const initialOpponentSprite =
    spriteUrlFor(snapshot.opponent.ref, "front") ?? "";

  return (
    <div className="battle-stage">
      <BattleStage
        ref={stageRef}
        backdropId={backdropId}
        backdropUrl={backdropUrl}
        opponentUrl={initialOpponentSprite}
        playerUrl={initialPlayerSprite}
        weather={weather ?? null}
      />
    </div>
  );
}
