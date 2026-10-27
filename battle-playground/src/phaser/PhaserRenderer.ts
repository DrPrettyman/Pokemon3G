/**
 * `BattleAnimRenderer` implementation backed by the existing Phaser
 * `BattleStage` imperative handle.
 *
 * This is a thin adapter — all the drawing lives in `BattleScene`. Its
 * purpose is to give `BattleRunner` a renderer-agnostic surface without
 * rewriting the scene. Phase B+ will push the contract deeper so the
 * runner can emit per-command ops instead of the current high-level
 * `playMoveAnimation(moveId)`.
 */
import type { BattleSide, Pokemon, Weather } from "pokedata3g";
import type {
  ActionPromptCtx,
  BallReleaseSchedule,
  BattleAnimRenderer,
  HudAction,
  IntroSchedule,
  MoveChoice,
  OutroSchedule,
} from "../runtime/types";
import type { BattleStageHandle } from "./BattleStage";

/**
 * Wrap a `BattleStageHandle` (the ref forwarded by `<BattleStage>`) as a
 * `BattleAnimRenderer`. The handle is read lazily on every call so the
 * runner can be constructed before the Phaser scene has finished
 * booting — no-ops until the handle resolves.
 */
export function createPhaserRenderer(
  getHandle: () => BattleStageHandle | null,
): BattleAnimRenderer {
  return {
    setActiveSprite(side: BattleSide, url: string): void {
      const h = getHandle();
      if (!h) return;
      if (side === "player") h.setPlayer(url);
      else h.setOpponent(url);
    },
    setWeather(weather: Weather | null): void {
      getHandle()?.setWeather(weather);
    },
    async playMoveAnimation(moveId: number, attacker: BattleSide): Promise<void> {
      const h = getHandle();
      if (!h) return;
      await h.playMoveAnimation(moveId, attacker);
    },
    lunge(side, tintHex) {
      getHandle()?.lunge(side, tintHex);
    },
    shake(side) {
      getHandle()?.shake(side);
    },
    hitFlash(side) {
      getHandle()?.hitFlash(side);
    },
    critFlash() {
      getHandle()?.critFlash();
    },
    async faintFall(side, frames) {
      const h = getHandle();
      if (!h) return;
      await h.faintFall(side, frames);
    },
    bindHealthbox(side: BattleSide, pokemon: Pokemon): void {
      getHandle()?.bindHealthbox(side, pokemon);
    },
    async refreshHealthbox(side: BattleSide): Promise<void> {
      const h = getHandle();
      if (!h) return;
      await h.refreshHealthbox(side);
    },
    refreshHealthboxInstant(side: BattleSide): void {
      getHandle()?.refreshHealthboxInstant(side);
    },
    async showDamagePopup(side, amount) {
      const h = getHandle();
      if (!h) return;
      await h.showDamagePopup(side, amount);
    },
    async showMessage(text) {
      const h = getHandle();
      if (!h) return;
      await h.showDialogue(text);
    },
    clearMessage() {
      getHandle()?.clearDialogue();
    },
    paralysisFlash(side) {
      getHandle()?.paralysisFlash(side);
    },
    burnPulse(side) {
      getHandle()?.burnPulse(side);
    },
    chargeBrighten(side) {
      getHandle()?.chargeBrighten(side);
    },
    setScreen(side, kind, on) {
      getHandle()?.setScreen(side, kind, on);
    },
    statusFlash(side, conditionId) {
      getHandle()?.statusFlash(side, conditionId);
    },
    statStageFlash(side, delta, statId) {
      getHandle()?.statStageFlash(side, delta, statId);
    },
    async playBallRelease(side, pos, schedule: BallReleaseSchedule) {
      const h = getHandle();
      if (!h) return;
      await h.awaitReady();
      await h.playBallRelease(side, pos, schedule);
    },
    async playIntroSquareOff(schedule: IntroSchedule) {
      const h = getHandle();
      if (!h) {
        console.warn("[PhaserRenderer] playIntroSquareOff called before stage mounted");
        return;
      }
      // Phaser defers `create()` to the next game tick. Wait for the
      // scene's sprite fields to exist before delegating — otherwise
      // the intro methods throw reaching `this.rivalTrainerSprite`, the
      // runner swallows the error, and the mons never materialise.
      await h.awaitReady();
      await h.playIntroSquareOff(schedule);
    },
    async playIntroOpponentReveal(schedule: IntroSchedule) {
      const h = getHandle();
      if (!h) return;
      await h.awaitReady();
      await h.playIntroOpponentReveal(schedule);
    },
    async playIntroPlayerReveal(schedule: IntroSchedule) {
      const h = getHandle();
      if (!h) return;
      await h.awaitReady();
      await h.playIntroPlayerReveal(schedule);
    },
    async playOutro(schedule: OutroSchedule) {
      const h = getHandle();
      if (!h) return;
      await h.awaitReady();
      await h.playOutro(schedule);
    },
    async promptAction(ctx: ActionPromptCtx): Promise<HudAction> {
      const h = getHandle();
      if (!h) return "fight";
      await h.awaitReady();
      return h.promptAction(ctx);
    },
    async promptMove(
      moves: MoveChoice[],
    ): Promise<{ moveSlot: number } | "cancel"> {
      const h = getHandle();
      if (!h) return "cancel";
      await h.awaitReady();
      return h.promptMove(moves);
    },
    dispose() {
      // BattleStage owns its own Phaser.Game lifecycle (React unmount),
      // so there is nothing for the renderer adapter to tear down.
    },
  };
}
