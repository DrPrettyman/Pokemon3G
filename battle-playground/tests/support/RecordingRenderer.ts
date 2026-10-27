/**
 * `BattleAnimRenderer` implementation that records every call as an
 * ordered log. Snapshot tests compare this log against a stored fixture
 * to detect animation regressions without booting Phaser.
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
} from "../../src/runtime/types";
import type { FakeClock } from "./fakeClock";

export interface RecordedOp {
  frame: number;
  op: string;
  args: Record<string, unknown>;
}

export class RecordingRenderer implements BattleAnimRenderer {
  readonly ops: RecordedOp[] = [];
  /**
   * Scripted-input queues for the HUD prompts. Tests call
   * `queueAction("fight")` / `queueMove({moveSlot: 0})` to pre-seed
   * the renderer; when the runner calls `promptAction`/`promptMove`,
   * the next queued value is shifted off and returned immediately.
   *
   * Defaults when the queues are empty: `promptAction` → `"fight"`
   * and `promptMove` → `{moveSlot: 0}`, so tests that don't care
   * about input paths don't have to prime either queue.
   */
  private readonly actionQueue: HudAction[] = [];
  private readonly moveQueue: Array<{ moveSlot: number } | "cancel"> = [];

  constructor(private readonly clock: FakeClock) {}

  queueAction(action: HudAction): void {
    this.actionQueue.push(action);
  }
  queueMove(choice: { moveSlot: number } | "cancel"): void {
    this.moveQueue.push(choice);
  }

  private record(op: string, args: Record<string, unknown> = {}): void {
    this.ops.push({ frame: this.clock.nowFrames(), op, args });
  }

  setActiveSprite(side: BattleSide, url: string): void {
    this.record("setActiveSprite", { side, url });
  }
  setWeather(weather: Weather | null): void {
    this.record("setWeather", { weather });
  }
  async playMoveAnimation(moveId: number, attacker: BattleSide): Promise<void> {
    this.record("playMoveAnimation", { moveId, attacker });
  }
  lunge(side: BattleSide, tintHex?: number): void {
    this.record("lunge", { side, tintHex });
  }
  shake(side: BattleSide): void {
    this.record("shake", { side });
  }
  hitFlash(side: BattleSide): void {
    this.record("hitFlash", { side });
  }
  critFlash(): void {
    this.record("critFlash");
  }
  async faintFall(side: BattleSide, frames: number): Promise<void> {
    this.record("faintFall", { side, frames });
  }
  bindHealthbox(side: BattleSide, pokemon: Pokemon): void {
    this.record("bindHealthbox", { side, pokemonId: pokemon.speciesId });
  }
  async refreshHealthbox(side: BattleSide): Promise<void> {
    this.record("refreshHealthbox", { side });
  }
  refreshHealthboxInstant(side: BattleSide): void {
    this.record("refreshHealthboxInstant", { side });
  }
  /**
   * Test-only helper — not part of `BattleAnimRenderer`. Records a
   * synthetic `setHp` op so drain-cadence tests can hand-roll the
   * per-bar-pixel drain loop that the real Phaser `HealthBox` runs
   * internally. Use `refreshHealthbox` for end-to-end runner traces.
   */
  setHp(side: BattleSide, hp: number, maxHp: number): void {
    this.record("setHp", { side, hp, maxHp });
  }
  async showDamagePopup(side: BattleSide, amount: number): Promise<void> {
    this.record("showDamagePopup", { side, amount });
  }
  async showMessage(text: string): Promise<void> {
    this.record("showMessage", { text });
  }
  clearMessage(): void {
    this.record("clearMessage");
  }
  paralysisFlash(side: BattleSide): void {
    this.record("paralysisFlash", { side });
  }
  burnPulse(side: BattleSide): void {
    this.record("burnPulse", { side });
  }
  chargeBrighten(side: BattleSide): void {
    this.record("chargeBrighten", { side });
  }
  setScreen(side: BattleSide, kind: "reflect" | "light_screen", on: boolean): void {
    this.record("setScreen", { side, kind, on });
  }
  statusFlash(side: BattleSide, conditionId: number): void {
    this.record("statusFlash", { side, conditionId });
  }
  statStageFlash(side: BattleSide, delta: number, statId?: number): void {
    this.record("statStageFlash", { side, delta, statId });
  }
  async playBallRelease(
    side: BattleSide,
    pos: { x: number; y: number },
    schedule: BallReleaseSchedule,
  ): Promise<void> {
    // Record each sub-phase on its own frame so tests can assert the
    // ordering and frame offsets of [open, particles, emerge] against
    // `BALL_RELEASE_SCHEDULE`.
    this.record("playBallRelease:open", { side, pos, frames: schedule.openFrames });
    await this.clock.wait(schedule.openFrames);
    this.record("playBallRelease:particles", {
      side,
      pos,
      frames: schedule.particleFrames,
    });
    await this.clock.wait(schedule.particleFrames);
    this.record("playBallRelease:emerge", {
      side,
      pos,
      frames: schedule.emergeFrames,
    });
    await this.clock.wait(schedule.emergeFrames);
  }
  async playIntroSquareOff(schedule: IntroSchedule): Promise<void> {
    this.record("playIntroSquareOff", { schedule: schedule as unknown as Record<string, unknown> });
  }
  async playIntroOpponentReveal(schedule: IntroSchedule): Promise<void> {
    this.record("playIntroOpponentReveal", { schedule: schedule as unknown as Record<string, unknown> });
  }
  async playIntroPlayerReveal(schedule: IntroSchedule): Promise<void> {
    this.record("playIntroPlayerReveal", { schedule: schedule as unknown as Record<string, unknown> });
  }
  async playOutro(schedule: OutroSchedule): Promise<void> {
    this.record("playOutro", { schedule: schedule as unknown as Record<string, unknown> });
  }
  async promptAction(ctx: ActionPromptCtx): Promise<HudAction> {
    this.record("promptAction", { ...ctx });
    return this.actionQueue.shift() ?? "fight";
  }
  async promptMove(moves: MoveChoice[]): Promise<{ moveSlot: number } | "cancel"> {
    this.record("promptMove", { moveCount: moves.length });
    return this.moveQueue.shift() ?? { moveSlot: 0 };
  }
  dispose(): void {
    this.record("dispose");
  }
}
