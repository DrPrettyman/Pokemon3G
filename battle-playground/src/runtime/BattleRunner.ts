/**
 * Renderer-agnostic battle engine coordinator.
 *
 * Owns:
 *   - the pokedata3g `Battle` instance
 *   - the drained event queue
 *   - one long-lived async pump (`start()`) that plays events through the
 *     renderer and pauses on async host callbacks (intro/outro/bag/switch)
 *   - the subscription fan-out to UI listeners
 *
 * What it intentionally does NOT own:
 *   - the Pokemon / Party / Player objects — those are passed in by the
 *     host and mutated in place (see plan.md "Persistence model")
 *   - any DOM / Phaser / React state
 *   - font / textbox rendering
 */
import {
  Battle,
  NpcTrainer,
  Player,
  Party,
} from "pokedata3g";
import type {
  BattleEvent,
  BattleOutcome,
  BattleSide,
  Weather,
} from "pokedata3g";

import type {
  ActiveSnapshot,
  BattleAnimRenderer,
  BattlePhase,
  BattleSnapshot,
  IntroSchedule,
  OutroSchedule,
  RunnerEvent,
  RuntimeAction,
} from "./types";
import type { Clock } from "./clock";
import { playCry } from "../battle/cries";
import * as T from "./timings";
import {
  formatBattleString,
  nameWithPrefix,
  withStatChange,
  type BattleStringContext,
} from "./battleStrings";
import { getMove, getType, getExpTable } from "pokedata3g";

/**
 * Frame-count pacing for non-animated events — keyed off `timings.ts`.
 * Every value is measured in whole GBA frames so the runner can pass it
 * directly to `clock.wait(frames)`.
 */
const EVENT_FRAMES: Partial<Record<BattleEvent["type"], number>> = {
  send_out: T.SEND_OUT_FRAMES,
  battle_start: T.BATTLE_START_FRAMES,
  effectiveness: T.EFFECTIVENESS_DISPLAY_FRAMES,
  status_applied: T.STATUS_APPLIED_FRAMES,
  weather_set: T.WEATHER_SET_FRAMES,
  weather_end: T.WEATHER_END_FRAMES,
  battle_end: T.BATTLE_END_FRAMES,
};
const FALLBACK_EVENT_FRAMES = T.FALLBACK_EVENT_FRAMES;

const INTRO_SCHEDULE: IntroSchedule = {
  squareOffFrames: T.INTRO_SQUARE_OFF_FRAMES,
  rivalSlideFrames: T.INTRO_RIVAL_SLIDE_FRAMES,
  opponentFadeInFrames: T.INTRO_OPPONENT_FADEIN_FRAMES,
  midGapFrames: T.INTRO_MID_GAP_FRAMES,
  ballArcFrames: T.BALL_ARC_FRAMES,
  ballFlashFrames: T.BALL_OPEN_FLASH_FRAMES,
  throwFrames: T.THROW_ANIM_TOTAL_FRAMES,
  playerSlideFrames: T.INTRO_PLAYER_SLIDE_FRAMES,
  playerFadeInFrames: T.INTRO_PLAYER_FADEIN_FRAMES,
};

const OUTRO_SCHEDULE: OutroSchedule = {
  recallFrames: T.OUTRO_RECALL_FRAMES,
  trainerSlideFrames: T.OUTRO_TRAINER_SLIDE_FRAMES,
};

export interface BattleRunnerOptions {
  /**
   * The player. Accepts a first-class `Player` or a bare `Party` — the
   * playground passes a `Party` and we wrap it here; a real host game
   * should pass its save-state `Player` directly so the runner mutates
   * the same object.
   */
  player: Player | Party;
  /**
   * The opponent. Accepts a `Player` (link battle), a ready-made
   * `NpcTrainer`, or a bare `Party` which is wrapped into an
   * `NpcTrainer` with default (trainer-style) AI.
   */
  opponent: Player | NpcTrainer | Party;
  weather?: Weather | null;
  environment?: string;
  renderer: BattleAnimRenderer;
  clock: Clock;
  /**
   * Host-rendered bag UI. Resolves with the chosen item + target, or
   * null if the player cancelled. While pending, the runner pauses the
   * drain pump — the battle is effectively frozen.
   */
  requestBag?: () => Promise<{ itemId: number; partyIndex: number } | null>;
  /** Host-rendered party / switch picker. Returns partyIndex or null. */
  requestSwitch?: () => Promise<number | null>;
}

type Listener = (event: RunnerEvent) => void;

export class BattleRunner {
  private readonly battle: Battle;
  private readonly opponentTrainer: NpcTrainer | null;
  private readonly clock: Clock;
  private readonly renderer: BattleAnimRenderer;
  private readonly requestBag?: BattleRunnerOptions["requestBag"];
  private readonly requestSwitch?: BattleRunnerOptions["requestSwitch"];

  private queue: BattleEvent[] = [];
  private listeners = new Set<Listener>();
  private disposed = false;
  private phase: BattlePhase = "intro";
  private introPlayed = false;
  private outroPlayed = false;
  /**
   * Last-known active mon name per side, tracked so the runner can emit
   * a "withdraw" message about the *outgoing* mon at switch time. The
   * pokedata3g `switch` event only carries the incoming name because the
   * Battle class has already mutated its active pointer by the time the
   * event fires — we remember who was there before so "Enough! Come back,
   * PIDGEOTTO!" / "Foe withdrew RAIKOU!" reads correctly.
   */
  private lastActiveName: Record<BattleSide, string> = { player: "", opponent: "" };
  /**
   * Phase I — number of `send_out` events whose cry has already been
   * played concurrently by `playIntro` (up to 2, one per side). Consumed
   * by the pump so the first two send_out events don't double-play.
   */
  private introCriesPlayed = 0;

  /** Signals the drain pump that new events were queued. */
  private wakeResolver: (() => void) | null = null;
  /** Resolver for a pending `submitAction` — runner is in "waiting-for-input". */
  private actionResolver: ((action: RuntimeAction) => void) | null = null;
  /** Resolver for a pending replacement choice. */
  private replacementResolver: ((index: number) => void) | null = null;
  /** Deferred resolve/reject of the top-level `start()` promise. */
  private completePromise: Promise<BattleOutcome> | null = null;

  constructor(opts: BattleRunnerOptions) {
    this.renderer = opts.renderer;
    this.clock = opts.clock;
    this.requestBag = opts.requestBag;
    this.requestSwitch = opts.requestSwitch;

    // Normalise the player: accept Party or Player. Real game integration
    // always passes a Player so the save state stays coherent; the
    // playground passes a bare Party we wrap here.
    const playerObj =
      opts.player instanceof Player
        ? opts.player
        : new Player({ party: opts.player });

    // Normalise the opponent: Player / NpcTrainer / Party. Bare Party
    // becomes a default NpcTrainer (isWild=false → trainer-style).
    let opponentObj: Player | NpcTrainer;
    if (opts.opponent instanceof Player || opts.opponent instanceof NpcTrainer) {
      opponentObj = opts.opponent;
    } else {
      opponentObj = new NpcTrainer({ party: opts.opponent });
    }
    this.opponentTrainer =
      opponentObj instanceof NpcTrainer ? opponentObj : null;

    this.battle = new Battle(playerObj, opponentObj, {
      weather: opts.weather ?? undefined,
      environment: opts.environment,
    });
    this.battle.begin();
    this.queue = this.battle.log.slice();
    this.lastActiveName.player = this.battle.playerActive.name;
    this.lastActiveName.opponent = this.battle.opponentActive.name;
  }

  // ---------------------------------------------------------------------
  // Subscription
  // ---------------------------------------------------------------------

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: RunnerEvent): void {
    for (const l of this.listeners) l(event);
  }

  private setPhase(phase: BattlePhase): void {
    if (this.phase === phase) return;
    console.log(`[battle ${performance.now().toFixed(0)}ms] phase`, { from: this.phase, to: phase });
    this.phase = phase;
    this.emit({ type: "phase", phase });
  }

  private emitSnapshot(): void {
    this.emit({ type: "snapshot", snapshot: this.snapshot() });
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  snapshot(): BattleSnapshot {
    const active = (side: BattleSide): ActiveSnapshot => {
      const p =
        side === "player" ? this.battle.playerActive : this.battle.opponentActive;
      const partyIndex =
        side === "player"
          ? this.battle.playerActiveIndex
          : this.battle.opponentActiveIndex;
      // HP reads straight off the Pokemon — the healthbox owns its own
      // displayed-HP state and drains from wherever it is now toward
      // `p.currentHp` on `refreshHealthbox`. No more runner-side
      // shadow-HP bookkeeping.
      const currentHp = p.isFainted ? 0 : p.currentHp;
      // EXP bar fraction: how far into the current level (0..1).
      let expFraction = 1;
      if (p.level < 100) {
        const table = getExpTable(p.species.growthRate);
        if (table) {
          const levelStart = table[p.level - 1];
          const levelEnd = table[p.level];
          const span = levelEnd - levelStart;
          expFraction = span > 0 ? (p.exp - levelStart) / span : 0;
        }
      }
      return {
        name: p.name,
        level: p.level,
        currentHp,
        maxHp: p.maxHp,
        speciesId: p.speciesId,
        formIndex: p.formIndex,
        isShiny: p.isShiny,
        isFainted: p.isFainted,
        partyIndex,
        gender: p.gender,
        expFraction,
        ref: p,
      };
    };
    return {
      player: active("player"),
      opponent: active("opponent"),
      weather: this.battle.weather,
      turn: this.battle.turnCount,
      outcome: this.battle.outcome,
      awaitingReplacement: this.battle.needsSwitch("player")
        ? "player"
        : this.battle.needsSwitch("opponent")
          ? "opponent"
          : null,
      battleType: this.battle.battleType,
    };
  }

  /** Start the drain pump. Resolves with the final outcome. */
  start(): Promise<BattleOutcome> {
    if (this.completePromise) return this.completePromise;
    this.completePromise = this.pump();
    // Push an initial snapshot so late subscribers don't miss state.
    queueMicrotask(() => this.emitSnapshot());
    return this.completePromise;
  }

  /**
   * Submit a turn action. Only valid while the runner is in
   * `"waiting-for-input"` — otherwise the call is ignored.
   */
  submitAction(action: RuntimeAction): void {
    const r = this.actionResolver;
    if (!r) return;
    this.actionResolver = null;
    r(action);
  }

  /**
   * Run the decomp action-menu loop until the player commits to a
   * concrete `RuntimeAction`. Lives here (not in the renderer) because
   * it has to stitch the HUD's raw action choice together with the
   * host callbacks (`requestBag`/`requestSwitch`) and the pokedata3g
   * move slots — none of which the renderer should know about.
   *
   * Cancelling out of a sub-menu (Bag, Pokémon, Move) re-shows the
   * top-level action menu, matching the decomp's "B returns to
   * parent menu" behavior.
   */
  private async gatherPlayerAction(
    ctx: import("./types").ActionPromptCtx,
  ): Promise<RuntimeAction> {
    // Shape the player's move slots into `MoveChoice[]`. Empty slots
    // (mon with <4 moves) get `enabled: false` and a blank label. PP
    // exhausted / disabled moves — currently just PP — are greyed out.
    const buildMoveChoices = (): import("./types").MoveChoice[] => {
      const availMoves = this.battle.getAvailableMoves("player");
      const slots = this.battle.playerActive.moves;
      const out: import("./types").MoveChoice[] = [];
      for (let i = 0; i < 4; i++) {
        const slot = slots[i];
        if (!slot) {
          out.push({
            moveSlot: i,
            name: "-",
            typeName: "---",
            currentPp: 0,
            maxPp: 0,
            enabled: false,
          });
          continue;
        }
        const move = getMove(slot.moveId);
        const typeName = move
          ? (getType(move.typeId)?.name ?? "???").toUpperCase()
          : "???";
        out.push({
          moveSlot: i,
          name: (move?.name ?? `Move ${slot.moveId}`).toUpperCase(),
          typeName,
          currentPp: slot.currentPp,
          maxPp: slot.maxPp,
          enabled: availMoves.includes(i),
        });
      }
      return out;
    };

    while (true) {
      const choice = await this.renderer.promptAction(ctx);
      if (this.disposed) return { type: "flee" };
      switch (choice) {
        case "fight": {
          const pick = await this.renderer.promptMove(buildMoveChoices());
          if (pick === "cancel") continue;
          return { type: "move", moveSlot: pick.moveSlot };
        }
        case "bag": {
          if (!this.requestBag) continue;
          const result = await this.requestBag();
          if (!result) continue;
          return {
            type: "item",
            itemId: result.itemId,
            targetIndex: result.partyIndex,
          };
        }
        case "pokemon": {
          if (!this.requestSwitch) continue;
          const idx = await this.requestSwitch();
          if (idx == null) continue;
          return { type: "switch", partyIndex: idx };
        }
        case "run":
          return { type: "flee" };
      }
    }
  }

  /** Submit a post-faint replacement choice. */
  submitReplacement(partyIndex: number): void {
    const r = this.replacementResolver;
    if (!r) return;
    this.replacementResolver = null;
    r(partyIndex);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.clock.dispose();
    this.renderer.dispose();
    // Unblock any in-flight waiters so the pump can exit.
    this.wakeResolver?.();
    this.wakeResolver = null;
  }

  // ---------------------------------------------------------------------
  // Drain pump
  // ---------------------------------------------------------------------

  private async pump(): Promise<BattleOutcome> {
    // Intro — runs once before any events. Phase I #6 plays the opponent
    // and player cries concurrently against the same clock so the audio
    // lands when the mon materialises inside the renderer animation. The
    // intro "consumes" the cries that would normally fire on the first two
    // send_out events; `introCriesPlayed` gates the duplicate playback in
    // the event loop below.
    if (!this.introPlayed) {
      this.introPlayed = true;
      this.setPhase("intro");

      // The battle's initial event queue always contains `battle_start`
      // followed by the two opening `send_out` events. We consume them
      // inline so their narration plays *during* the intro visual rather
      // than after it — that's what makes the textbox and sprite flow
      // feel like authentic Gen 3 instead of "visuals, then dialogue
      // catches up". Anything the engine queued beyond those three
      // (unlikely at this point but possible) gets restored to the front
      // of the queue so the normal pump picks it up afterwards.
      const initial = this.queue.splice(0);
      const take = <T extends BattleEvent["type"]>(
        type: T,
        pred?: (ev: Extract<BattleEvent, { type: T }>) => boolean,
      ): Extract<BattleEvent, { type: T }> | undefined => {
        const idx = initial.findIndex(
          (e) =>
            e.type === type &&
            (!pred ||
              pred(e as unknown as Extract<BattleEvent, { type: T }>)),
        );
        if (idx === -1) return undefined;
        const [ev] = initial.splice(idx, 1);
        return ev as Extract<BattleEvent, { type: T }>;
      };
      const battleStartEv = take("battle_start");
      const opponentSendOut = take(
        "send_out",
        (e) => e.side === "opponent",
      );
      const playerSendOut = take("send_out", (e) => e.side === "player");
      if (initial.length > 0) {
        console.log(
          `[battle ${performance.now().toFixed(0)}ms] intro:leftover-events`,
          initial.map(summarizeEvent),
        );
        this.queue.unshift(...initial);
      }

      const sayEvent = async (
        ev: BattleEvent | undefined,
      ): Promise<void> => {
        if (!ev) return;
        const line = narrateEvent(ev, this.battle);
        if (!line) return;
        this.emit({ type: "narration", line });
        await this.renderer.showMessage(line);
      };

      try {
        // Beat 1: both trainers squared off. "The battle begins!" types
        // while the scene holds this static pose.
        await this.renderer.playIntroSquareOff(INTRO_SCHEDULE);
        await sayEvent(battleStartEv);

        // Beat 2: opponent reveal — rival slide-off and opponent fade-in,
        // concurrent with "Foe sent out X!" typing and the opponent cry
        // landing midway through the fade-in.
        const opponentCry = (async () => {
          const cryAt =
            INTRO_SCHEDULE.rivalSlideFrames +
            Math.round(INTRO_SCHEDULE.opponentFadeInFrames / 2);
          await this.clock.wait(cryAt);
          if (this.disposed) return;
          playCry(this.battle.opponentActive);
          this.introCriesPlayed = Math.max(this.introCriesPlayed, 1);
        })();
        await Promise.all([
          this.renderer.playIntroOpponentReveal(INTRO_SCHEDULE).catch((err) => {
            console.warn("[BattleRunner] playIntroOpponentReveal threw:", err);
          }),
          sayEvent(opponentSendOut),
          opponentCry,
        ]);
        // Scene is guaranteed ready now (playIntroOpponentReveal awaited it).
        // The intro consumes the initial send_out events outside the main
        // pump, so the standard bind+refresh on send_out never fires for them.
        // Bind the opponent healthbox to its active mon and snap it visible.
        this.renderer.bindHealthbox("opponent", this.battle.opponentActive);
        this.renderer.refreshHealthboxInstant("opponent");
        if (this.disposed) return this.battle.outcome ?? "opponentWins";

        // Beat 3: player reveal — throw animation, ball arc, player
        // trainer slide-off and player mon fade-in. Concurrent with
        // "Go! Y!" typing and the player cry landing just after the ball
        // flash resolves.
        const playerCry = (async () => {
          const cryAt =
            INTRO_SCHEDULE.midGapFrames +
            INTRO_SCHEDULE.throwFrames +
            INTRO_SCHEDULE.ballArcFrames +
            Math.round(INTRO_SCHEDULE.ballFlashFrames / 2);
          await this.clock.wait(cryAt);
          if (this.disposed) return;
          playCry(this.battle.playerActive);
          this.introCriesPlayed = 2;
        })();
        await Promise.all([
          this.renderer.playIntroPlayerReveal(INTRO_SCHEDULE).catch((err) => {
            console.warn("[BattleRunner] playIntroPlayerReveal threw:", err);
          }),
          sayEvent(playerSendOut),
          playerCry,
        ]);
        this.renderer.bindHealthbox("player", this.battle.playerActive);
        this.renderer.refreshHealthboxInstant("player");
      } catch (err) {
        console.warn("[BattleRunner] intro threw:", err);
      }

      if (this.disposed) return this.battle.outcome ?? "opponentWins";
    }

    while (!this.disposed) {
      this.setPhase("playing-events");
      console.log(
        `[battle ${performance.now().toFixed(0)}ms] queue:drain-start`,
        { length: this.queue.length },
      );

      while (this.queue.length > 0 && !this.disposed) {
        const ev = this.queue.shift()!;
        console.log(
          `[battle ${performance.now().toFixed(0)}ms] event:pop`,
          summarizeEvent(ev),
        );
        // Gen 3 textbox order:
        //  - Most events print the line FIRST then play the animation (e.g.
        //    "Foo used Tackle!" before the anim, "It's super effective!"
        //    before the beat).
        //  - `faint` is the exception — sprite falls, then message appears.
        //  - `switch` is special — it produces TWO messages: one about the
        //    outgoing mon ("Enough! Come back, X!") and one about the
        //    incoming mon ("Go! Y!"). pokedata3g's switch event only
        //    carries the incoming name, so we pair it with the tracked
        //    `lastActiveName` to fill in the outgoing side.
        if (ev.type === "switch") {
          // Decomp withdraw line is the player's own dialog
          // (`sText_PkmnThatsEnough` = `"{B_PLAYER_NAME}: That's enough,
          // {B_PLAYER_MON1_NAME}!\nCome back!"`) for the player side, or a
          // trainer-authored line for the opponent. We don't have the full
          // trainer dialog plumbing yet, so we reuse `STRINGID_GOPKMN` /
          // `STRINGID_INTROSENDOUT_TRAINER` for the incoming mon and keep
          // the outgoing line concise and in the right character set.
          const incomingName = ev.speciesName;
          const outgoingName = this.lastActiveName[ev.side] || incomingName;
          const withdrawLine =
            ev.side === "player"
              ? `Come back, ${outgoingName.toUpperCase()}!`
              : `Foe withdrew ${outgoingName.toUpperCase()}!`;
          const sendOutLine = formatBattleString(
            ev.side === "player"
              ? "STRINGID_GOPKMN"
              : "STRINGID_INTROSENDOUT_TRAINER",
            {
              ...buildStringContext(this.battle, ev),
              playerMon1Name: incomingName.toUpperCase(),
              opponentMon1Name: incomingName.toUpperCase(),
            },
          );
          this.emit({ type: "narration", line: withdrawLine });
          await this.renderer.showMessage(withdrawLine);
          if (this.disposed) break;
          this.emit({ type: "narration", line: sendOutLine });
          await this.renderer.showMessage(sendOutLine);
          if (this.disposed) break;
          await this.playEvent(ev);
          // Track the new active mon so the next switch/withdraw reads right.
          this.lastActiveName[ev.side] = incomingName;
          // Rebind the healthbox to the freshly-sent-out Pokemon and snap
          // every field so the incoming mon's HP/name/level paint without
          // a drain from the outgoing mon's state.
          const incoming =
            ev.side === "player"
              ? this.battle.playerActive
              : this.battle.opponentActive;
          this.renderer.bindHealthbox(ev.side, incoming);
          this.renderer.refreshHealthboxInstant(ev.side);
          this.emitSnapshot();
          continue;
        }

        // Confusion self-hit pair: the decomp script for a confused mon
        // that fails its snap-out roll prints `STRINGID_PKMNISCONFUSED`
        // ("X is\nconfused!"), then `STRINGID_ITHURTCONFUSION` ("It hurt
        // itself in its\nconfusion!"), then runs the normal damage
        // pipeline against the confused mon — no move animation, no
        // "used X!" line. pokedata3g emits this as a `cant_move` event
        // with `reason: "confusion"` immediately followed by a `damage`
        // event whose target is the confused mon. Detect and fuse the
        // pair here so the runner never tries to narrate the lone
        // cant_move as "is confused!" in isolation.
        if (
          ev.type === "cant_move" &&
          ev.reason === "confusion" &&
          this.queue[0]?.type === "damage" &&
          (this.queue[0] as { target: "player" | "opponent" }).target === ev.side
        ) {
          const confusedCtx = buildStringContext(this.battle, ev);
          const confusedLine = formatBattleString(
            "STRINGID_PKMNISCONFUSED",
            confusedCtx,
          );
          this.emit({ type: "narration", line: confusedLine });
          await this.renderer.showMessage(confusedLine);
          if (this.disposed) break;
          const hurtLine = formatBattleString(
            "STRINGID_ITHURTCONFUSION",
            confusedCtx,
          );
          this.emit({ type: "narration", line: hurtLine });
          await this.renderer.showMessage(hurtLine);
          if (this.disposed) break;
          // Drop the damage event into playEvent directly (no move anim,
          // no attackstring). `playEvent(damage)` already runs the
          // correct hit-flash → drain → gate sequence.
          const dmgEv = this.queue.shift()!;
          await this.playEvent(dmgEv);
          this.emitSnapshot();
          continue;
        }

        const line = narrateEvent(ev, this.battle);
        // Decomp narration ordering:
        //  - `faint` — sprite falls, then the "X fainted!" line types.
        //  - `stat_change` — `seteffectwithchance` plays the arrow flash
        //    first, then the owning script's `printstring` types the line
        //    ("Bulbasaur's Speed fell!"). pokedata3g emits stat_change as
        //    a separate post-move event so we don't need to touch the event
        //    stream — just route the narration side onto the "after" branch.
        //  - everything else — line types first, then the animation plays.
        const narrateAfter =
          line && (ev.type === "faint" || ev.type === "stat_change");
        const narrateBefore = line && !narrateAfter;
        if (narrateBefore) {
          this.emit({ type: "narration", line });
          await this.renderer.showMessage(line);
        }
        if (this.disposed) break;
        await this.playEvent(ev);
        if (this.disposed) break;
        if (narrateAfter) {
          this.emit({ type: "narration", line });
          await this.renderer.showMessage(line);
        }
        if (ev.type === "send_out") {
          // Track the freshly-sent-out mon so future withdraw lines read right.
          this.lastActiveName[ev.side] =
            ev.side === "player"
              ? this.battle.playerActive.name
              : this.battle.opponentActive.name;
          // Intro already played the first two send_out cries — skip them
          // here so we don't double-trigger.
          if (this.introCriesPlayed > 0) {
            this.introCriesPlayed -= 1;
          } else {
            playCry(
              ev.side === "player"
                ? this.battle.playerActive
                : this.battle.opponentActive,
            );
          }
          // Rebind the healthbox to the freshly-sent-out mon and snap —
          // the healthbox reads `currentHp` live off the reference and the
          // incoming mon should appear already-at-current-HP, not drain
          // from the outgoing mon's state.
          const incomingActive =
            ev.side === "player"
              ? this.battle.playerActive
              : this.battle.opponentActive;
          this.renderer.bindHealthbox(ev.side, incomingActive);
          this.renderer.refreshHealthboxInstant(ev.side);
        }
        // The faint cry is dispatched from inside `playEvent(faint)`
        // now — it fires first in the decomp's `BattleScript_FaintTarget`
        // ordering, so owning it in the outer pump (which runs after
        // playEvent) put the cry after the fall.
        this.emitSnapshot();
      }
      console.log(`[battle ${performance.now().toFixed(0)}ms] queue:drain-end`);

      if (this.disposed) break;

      if (this.battle.outcome !== null) {
        if (!this.outroPlayed) {
          this.outroPlayed = true;
          this.setPhase("outro");
          try {
            await this.renderer.playOutro(OUTRO_SCHEDULE);
          } catch (err) {
            console.warn("[BattleRunner] playOutro threw:", err);
          }
        }
        this.setPhase("ended");
        return this.battle.outcome;
      }

      if (this.battle.needsSwitch("player")) {
        await this.handlePlayerReplacement();
        continue;
      }
      if (this.battle.needsSwitch("opponent")) {
        const idx = this.opponentTrainer!.selectReplacement(this.battle);
        const events = this.battle.submitSwitch("opponent", idx);
        this.queue.push(...events);
        continue;
      }

      await this.handleInputPhase();
    }

    return this.battle.outcome ?? "opponentWins";
  }

  private async handlePlayerReplacement(): Promise<void> {
    const switches = this.battle.getAvailableSwitches("player");
    this.emit({ type: "available-switches", switches });
    this.setPhase("awaiting-replacement");
    const idx = await new Promise<number>((resolve) => {
      this.replacementResolver = resolve;
    });
    if (this.disposed) return;
    const events = this.battle.submitSwitch("player", idx);
    this.queue.push(...events);
  }

  private async handleInputPhase(): Promise<void> {
    const availMoves = this.battle.getAvailableMoves("player");
    const availSwitches = this.battle.getAvailableSwitches("player");
    this.emit({ type: "available-moves", moves: availMoves });
    this.emit({ type: "available-switches", switches: availSwitches });
    // Show the decomp-faithful prompt above the action menu —
    // `gText_WhatWillPkmnDo` from `battle_message.c:1278`.
    const isWild = this.battle.battleType === "wild";
    const activeName = nameWithPrefix(
      "player",
      this.battle.playerActive.name,
      isWild,
    );
    await this.renderer.showMessage(
      formatBattleString("STRINGID_WHATWILLPKMNDO", {
        activeNameWithPrefix: activeName,
      }),
    );
    this.setPhase("waiting-for-input");

    // Loop: keep prompting until we resolve a submittable action.
    // Bag/switch/move all branch through promptAction; only a
    // confirmed pick exits the loop.
    const action = await this.gatherPlayerAction({
      activeMonName: activeName,
    });
    if (this.disposed) return;
    console.log(`[battle ${performance.now().toFixed(0)}ms] player:action`, action);

    const oppAction = this.opponentTrainer
      ? this.opponentTrainer.selectAction(this.battle)
      : undefined;
    console.log(`[battle ${performance.now().toFixed(0)}ms] opponent:action`, oppAction);

    let events: BattleEvent[] = [];
    switch (action.type) {
      case "move":
        events = this.battle.submitActions(
          { type: "move", moveSlot: action.moveSlot },
          oppAction!,
        );
        break;
      case "switch":
        events = this.battle.submitActions(
          { type: "switch", partyIndex: action.partyIndex },
          oppAction!,
        );
        break;
      case "item":
        events = this.battle.submitActions(
          {
            type: "item",
            itemId: action.itemId,
            targetIndex: action.targetIndex,
            moveSlot: action.moveSlot,
          },
          oppAction!,
        );
        break;
      case "flee":
        events = this.battle.submitActions({ type: "flee" }, oppAction!);
        break;
    }
    this.queue.push(...events);
  }

  /**
   * Translate a single BattleEvent into renderer calls + pacing. Move
   * events hand off to the decomp animation script; everything else falls
   * through to a stand-in FX + a short beat.
   */
  private async playEvent(ev: BattleEvent): Promise<void> {
    switch (ev.type) {
      case "move_used": {
        // Decomp ordering for a move: `BattleScript_EffectHit` in
        // `data/battle_scripts_1.s:239-272` runs `attackcanceler →
        // accuracycheck → attackstring → ... → attackanimation`.
        // Crucially, `accuracycheck` branches to `BattleScript_PrintMoveMissed`
        // *before* `attackanimation`, and `Cmd_attackanimation` in
        // `battle_script_commands.c:1685` checks `MOVE_RESULT_NO_EFFECT`
        // and skips the animation entirely on type immunities. Both
        // cases run a 32-frame pause in place of the animation.
        //
        // pokedata3g doesn't expose the "will hit" decision on the
        // `move_used` event — it emits `move_used` unconditionally and
        // follows with either `miss`, `effectiveness(0)`, or `damage`.
        // Peek the next event to decide whether to play the animation.
        const outcome = peekMoveOutcome(this.queue);
        if (outcome === "hit") {
          await this.renderer.playMoveAnimation(ev.moveId, ev.side);
        } else {
          // Match `BattleScript_MoveMissedPause` / `BattleScript_Pausex20`:
          // ~32 frames of dead air in place of the animation. Narration
          // for the miss / no-effect line fires on the next event in
          // the queue, which the pump narrates-before normally.
          await this.clock.wait(T.WAIT_SHORT);
        }
        return;
      }
      case "damage": {
        // Decomp ordering (`data/battle_scripts_1.s:257–263`):
        //   attackanimation + waitanimation   (already played upstream via move_used)
        //   effectivenesssound                (TODO once soundPlayer hook lands)
        //   hitanimation BS_TARGET            — target sprite flickers white/black
        //   healthbarupdate BS_TARGET         — animated drain
        //   datahpupdate BS_TARGET            — commit value on drain end
        //
        // These must be STRICTLY SEQUENTIAL: the hit flash owns its own
        // beat, and only after it finishes does the HP bar start to
        // drain. The drain itself is owned by the healthbox — we just
        // await `refreshHealthbox`, which reads `pokemon.currentHp` and
        // animates one bar-pixel per frame until the bar matches.
        const side = ev.target;
        this.renderer.hitFlash(side);
        await this.clock.wait(T.HIT_FLASH_FRAMES);
        if (this.disposed) return;

        const popupDone = this.renderer.showDamagePopup(side, ev.amount);
        await this.renderer.refreshHealthbox(side);
        // Let the popup finish its hold/fade concurrently with the gate.
        const gateFrames =
          this.queue[0]?.type === "effectiveness"
            ? T.EFFECTIVENESS_GATE_FRAMES
            : T.POST_DAMAGE_PAUSE_FRAMES;
        await this.clock.wait(gateFrames);
        await popupDone;
        return;
      }
      case "critical_hit":
        this.renderer.critFlash();
        await this.clock.wait(T.CRITICAL_HIT_FRAMES);
        return;
      case "faint": {
        // Decomp sequence — `BattleScript_FaintTarget` in
        // `data/battle_scripts_1.s:2810`:
        //   playfaintcry BS_TARGET
        //   pause B_WAIT_TIME_LONG     @ 64 frames
        //   dofaintanimation BS_TARGET
        //   cleareffectsonfaint BS_TARGET
        //   printstring STRINGID_TARGETFAINTED
        //   printstring STRINGID_EMPTYSTRING3
        //
        // The cry fires FIRST — before the pause, before the fall, and
        // definitely before the narration. The previous implementation
        // played the cry from the outer pump *after* `playEvent(faint)`
        // returned, which put the cry after the fall animation. Fixed
        // by moving it here.
        playCry(
          ev.side === "player"
            ? this.battle.playerActive
            : this.battle.opponentActive,
          0.4,
        );
        await this.clock.wait(T.WAIT_LONG);
        if (this.disposed) return;
        // Snap the healthbox to 0 before the fall. In the common path the
        // damage beat's `refreshHealthbox` already drained to 0; this is
        // the safety net for faints caused by status_damage / weather
        // damage where no damage event fired.
        this.renderer.refreshHealthboxInstant(ev.side);
        this.emitSnapshot();
        await this.renderer.faintFall(ev.side, T.FAINT_FALL_FRAMES);
        await this.clock.wait(T.FAINT_POST_FRAMES);
        return;
      }
      case "weather_set":
        this.renderer.setWeather(this.battle.weather);
        await this.clock.wait(T.WEATHER_SET_FRAMES);
        return;
      case "weather_end":
        this.renderer.setWeather(null);
        await this.clock.wait(T.WEATHER_END_FRAMES);
        return;

      // ---------- Phase D: tint/fade shortcuts ----------
      case "stat_change": {
        // The actual==0 case is a no-op change (stage already pinned); the
        // decomp prints "…won't go any higher/lower!" — we skip the flash
        // so blocked drops don't visually flinch the sprite.
        if (ev.actual === 0) {
          await this.clock.wait(T.STAT_CHANGE_FLASH_FRAMES);
          return;
        }
        this.renderer.statStageFlash(ev.target, ev.stages, ev.statId);
        await this.clock.wait(T.STAT_CHANGE_FLASH_FRAMES);
        return;
      }
      case "status_applied":
        this.renderer.statusFlash(ev.target, ev.conditionId);
        await this.clock.wait(T.STATUS_APPLIED_FRAMES);
        return;
      case "status_damage":
        // 4 = burn (see pokedata3g statusConditions). Other status-damage
        // ticks (poison, etc.) fall through to the default shake.
        if (ev.conditionId === 4) {
          this.renderer.burnPulse(ev.target);
        } else {
          this.renderer.shake(ev.target);
        }
        await this.clock.wait(T.STATUS_DAMAGE_FRAMES);
        return;
      case "cant_move":
        if (ev.reason === "paralysis") {
          this.renderer.paralysisFlash(ev.side);
        }
        await this.clock.wait(T.CANT_MOVE_FRAMES);
        return;
      case "move_charging":
        this.renderer.chargeBrighten(ev.side);
        await this.clock.wait(T.MOVE_CHARGING_FRAMES);
        return;
      case "reflect_start":
        this.renderer.setScreen(ev.side, "reflect", true);
        await this.clock.wait(T.SCREEN_START_FRAMES);
        return;
      case "reflect_end":
        this.renderer.setScreen(ev.side, "reflect", false);
        await this.clock.wait(T.SCREEN_END_FRAMES);
        return;
      case "light_screen_start":
        this.renderer.setScreen(ev.side, "light_screen", true);
        await this.clock.wait(T.SCREEN_START_FRAMES);
        return;
      case "light_screen_end":
        this.renderer.setScreen(ev.side, "light_screen", false);
        await this.clock.wait(T.SCREEN_END_FRAMES);
        return;

      default:
        await this.clock.wait(EVENT_FRAMES[ev.type] ?? FALLBACK_EVENT_FRAMES);
    }
  }
}

/**
 * Compact one-line view of a BattleEvent for debug logging. Keeps the payload
 * small enough to scan in the console while still capturing the fields that
 * matter for sequencing investigations.
 */
function summarizeEvent(ev: BattleEvent): Record<string, unknown> {
  const e = ev as unknown as Record<string, unknown>;
  const keys = [
    "type",
    "side",
    "target",
    "moveId",
    "moveName",
    "speciesName",
    "amount",
    "currentHp",
    "multiplier",
    "reason",
    "conditionId",
    "weather",
    "outcome",
    "abilityName",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in e) out[k] = e[k];
  return out;
}

/**
 * Decide whether the move animation should play for a `move_used`
 * event. Mirrors the decomp's `accuracycheck` + `attackanimation`
 * gating: a missed move jumps to `BattleScript_PrintMoveMissed` (no
 * animation), and a type-immune move hits the
 * `if (!(gMoveResultFlags & MOVE_RESULT_NO_EFFECT))` guard in
 * `Cmd_attackanimation` (no animation). Everything else — including
 * status moves that have no `damage` event behind them — plays.
 *
 * Implementation: the runner has already popped the `move_used` event,
 * so `queue[0]` is the next event in the move's event sequence. For
 * hit/status the next event is `damage` / `status_applied` / `stat_change`
 * / etc; for miss it's `miss`; for type immunity it's `effectiveness`
 * with `multiplier === 0`.
 */
export function peekMoveOutcome(
  queue: BattleEvent[],
): "hit" | "miss" | "no_effect" {
  const next = queue[0];
  if (!next) return "hit";
  if (next.type === "miss") return "miss";
  if (next.type === "effectiveness" && next.multiplier === 0) return "no_effect";
  return "hit";
}

/**
 * Side-aware lookup table for `cant_move` reasons → STRINGIDs from
 * `gBattleStringsTable`. Mirrors the script branches in
 * `AtkCanceller_UnableToUseMove` (`battle_script_commands.c`); the
 * decomp prints these instead of an "X used Y!" line because the move
 * never actually starts.
 */
function cantMoveStringId(reason: string) {
  switch (reason) {
    case "paralysis":
      return "STRINGID_PKMNISPARALYZED" as const;
    case "sleep":
      return "STRINGID_PKMNFASTASLEEP" as const;
    case "freeze":
      return "STRINGID_PKMNISFROZEN" as const;
    case "flinch":
      return "STRINGID_PKMNFLINCHED" as const;
    case "infatuation":
      return "STRINGID_PKMNIMMOBILIZEDBYLOVE" as const;
    case "confusion":
      // Handled by the confusion-pair detector in the pump; the
      // standalone STRINGID is only used as a fallback if no damage
      // event is queued behind the cant_move.
      return "STRINGID_PKMNISCONFUSED" as const;
    default:
      return null;
  }
}

/**
 * `status_applied` reason → STRINGID. Mirrors the `BattleScript_Stat*`
 * scripts that print after `seteffectprimary`.
 */
function statusAppliedStringId(conditionId: number) {
  switch (conditionId) {
    case 1:
      return "STRINGID_PKMNWASPARALYZED" as const;
    case 2:
      return "STRINGID_PKMNFELLASLEEP" as const;
    case 3:
      return "STRINGID_PKMNWASFROZEN" as const;
    case 4:
      return "STRINGID_PKMNWASBURNED" as const;
    case 5:
      return "STRINGID_PKMNWASPOISONED" as const;
    case 6:
      return "STRINGID_PKMNBECAMECONFUSED" as const;
    default:
      return null;
  }
}

/**
 * Build the substitution context used by `formatBattleString`. Reads
 * the active battle state once, then derives the prefixed names for
 * both sides plus a few utility fields (mon-1 names, isWild). Every
 * narration call goes through this so we don't sprinkle stringly-typed
 * substitutions across the runner.
 */
function buildStringContext(
  battle: Battle,
  ev?: BattleEvent,
): BattleStringContext {
  const isWild = battle.battleType === "wild";
  const playerName = battle.playerActive.name;
  const opponentName = battle.opponentActive.name;

  // Most events carry a `side` (attacker side) or `target` (defender
  // side); we resolve both to "ATK"/"DEF" prefixed names so the
  // template can pick whichever placeholder it wants. For events that
  // only have one of the two, we leave the other as a sensible default
  // so debug output still reads cleanly.
  const e = ev as { side?: "player" | "opponent"; target?: "player" | "opponent" } | undefined;
  const atkSide = e?.side ?? "player";
  const defSide = e?.target ?? (atkSide === "player" ? "opponent" : "player");

  return {
    atkNameWithPrefix: nameWithPrefix(
      atkSide,
      atkSide === "player" ? playerName : opponentName,
      isWild,
    ),
    defNameWithPrefix: nameWithPrefix(
      defSide,
      defSide === "player" ? playerName : opponentName,
      isWild,
    ),
    effNameWithPrefix: nameWithPrefix(
      defSide,
      defSide === "player" ? playerName : opponentName,
      isWild,
    ),
    playerMon1Name: playerName.toUpperCase(),
    opponentMon1Name: opponentName.toUpperCase(),
  };
}

/**
 * Translate a BattleEvent into the verbatim FireRed decomp narration
 * line. Returns null when the event has no associated textbox line
 * (most internal computations: critcalc, damagecalc, etc., plus
 * ability/item announcements that the host renders separately).
 *
 * Exported for tests.
 */
export function narrateEvent(
  ev: BattleEvent,
  battle: Battle,
): string | null {
  const ctx = buildStringContext(battle, ev);
  const isWild = battle.battleType === "wild";

  switch (ev.type) {
    case "battle_start":
      // The decomp's `STRINGID_INTROMSG` switches on battle type:
      // wild → `sText_WildPkmnAppeared`, trainer → `sText_Trainer1WantsToBattle`
      // (which needs trainer class+name we don't have wired yet — fall
      // back to the wild template if we can't build the trainer one).
      return formatBattleString(
        isWild ? "STRINGID_INTROMSG_WILD" : "STRINGID_INTROMSG_WILD",
        ctx,
      );
    case "send_out":
      // Player side → `sText_GoPkmn` ("Go! BULBASAUR!"). Opponent side
      // is handled by the intro flow; the in-battle `send_out` event
      // (post-faint replacement) reuses these templates.
      if (ev.side === "player") {
        return formatBattleString("STRINGID_GOPKMN", {
          ...ctx,
          playerMon1Name: ev.speciesName.toUpperCase(),
        });
      }
      return formatBattleString("STRINGID_INTROSENDOUT_TRAINER", {
        ...ctx,
        opponentMon1Name: ev.speciesName.toUpperCase(),
      });
    case "switch":
      // Handled inline by the pump.
      return null;
    case "move_used": {
      const move = getMove(ev.moveId);
      const moveName = (move?.name ?? ev.moveName ?? "").toUpperCase();
      return formatBattleString("STRINGID_USEDMOVE", {
        ...ctx,
        moveName,
      });
    }
    case "miss":
      return formatBattleString("STRINGID_ATTACKMISSED", ctx);
    case "critical_hit":
      return formatBattleString("STRINGID_CRITICALHIT", ctx);
    case "effectiveness":
      if (ev.multiplier === 0)
        return formatBattleString("STRINGID_ITDOESNTAFFECT", ctx);
      if (ev.multiplier > 1)
        return formatBattleString("STRINGID_SUPEREFFECTIVE", ctx);
      if (ev.multiplier < 1)
        return formatBattleString("STRINGID_NOTVERYEFFECTIVE", ctx);
      return null;
    case "faint":
      // The decomp picks `sText_TargetFainted` when the *defender*
      // faints (the common case after a damaging move) and
      // `sText_AttackerFainted` for self-KOs (Explosion / Selfdestruct
      // / recoil-induced KO). We mirror that: the side that fainted is
      // the "target" of the line.
      return formatBattleString(
        ev.side === ((battle as unknown as { opponentActive: unknown }).opponentActive ? "opponent" : "player")
          ? "STRINGID_PKMNFAINTED_TARGET"
          : "STRINGID_PKMNFAINTED_TARGET",
        {
          ...ctx,
          defNameWithPrefix: nameWithPrefix(
            ev.side,
            ev.side === "player"
              ? battle.playerActive.name
              : battle.opponentActive.name,
            isWild,
          ),
        },
      );
    case "stat_change": {
      // No-op drops ("won't go any lower!") fall back to the
      // `STATSWONTDECREASE` / `STATSWONTINCREASE` STRINGIDs. Real
      // changes use the attacker/defender variants based on which
      // side was affected — `target === "player"` while the player is
      // the attacker (e.g. Swords Dance) → ATTACKER form; while the
      // player is the defender (String Shot) → DEFENDER form.
      const targetIsAttacker = ev.target === "player"; // best-effort: pokedata3g doesn't tell us the attacker side here
      if (ev.actual === 0) {
        return formatBattleString(
          ev.stages > 0
            ? "STRINGID_STATSWONTINCREASE"
            : "STRINGID_STATSWONTDECREASE",
          withStatChange(ctx, ev.statId, ev.stages),
        );
      }
      const id =
        ev.stages > 0
          ? targetIsAttacker
            ? "STRINGID_ATTACKERSSTATROSE"
            : "STRINGID_DEFENDERSSTATROSE"
          : targetIsAttacker
            ? "STRINGID_ATTACKERSSTATFELL"
            : "STRINGID_DEFENDERSSTATFELL";
      return formatBattleString(id, withStatChange(ctx, ev.statId, ev.stages));
    }
    case "weather_set":
      // Weather has its own STRINGID family (`gMoveWeatherChangeStringIds`).
      // Not wired yet — fall back to silence rather than fabricated copy.
      return null;
    case "weather_end":
      return null;
    case "ability_activated":
      // Ability flashes have their own per-ability STRINGIDs in the
      // decomp. Not wired yet; the playground's ability indicator is
      // visual-only for now.
      return null;
    case "item_used":
      return null;
    case "cant_move": {
      const id = cantMoveStringId(ev.reason);
      if (!id) return null;
      // cant_move's ATK = the side that *would have* moved, so the
      // existing ctx (built off ev.side) already prefixes correctly.
      return formatBattleString(id, ctx);
    }
    case "status_applied": {
      const id = statusAppliedStringId(ev.conditionId);
      if (!id) return null;
      return formatBattleString(id, {
        ...ctx,
        effNameWithPrefix: nameWithPrefix(
          ev.target,
          ev.target === "player"
            ? battle.playerActive.name
            : battle.opponentActive.name,
          isWild,
        ),
      });
    }
    case "battle_end":
      // The end-of-battle banner is host-controlled; the playground's
      // outro renders this separately so we suppress it from the
      // textbox stream.
      return null;
    default:
      return null;
  }
}
