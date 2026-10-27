/**
 * Thin React subscription hook around `BattleRunner`.
 *
 * The hook itself contains no battle logic — `BattleRunner` owns
 * everything. All this does is subscribe to runner events and mirror
 * them into React state so components re-render.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { BattleOutcome } from "pokedata3g";
import { BattleRunner, type BattleRunnerOptions } from "./BattleRunner";
import type { BattlePhase, BattleSnapshot, RuntimeAction } from "./types";

export interface UseBattleRunnerResult {
  runner: BattleRunner;
  snapshot: BattleSnapshot;
  phase: BattlePhase;
  narration: string[];
  availableMoves: number[];
  availableSwitches: number[];
  submit: (action: RuntimeAction) => void;
  submitReplacement: (partyIndex: number) => void;
  outcome: BattleOutcome | null;
}

export function useBattleRunner(
  options: BattleRunnerOptions,
): UseBattleRunnerResult {
  // The runner is constructed once per hook mount. Option changes after
  // mount are ignored — the host is expected to re-mount `<PhaserBattle>`
  // for a new battle, matching how the runner owns a live Battle instance.
  // `BattleRunner` takes the full options object unchanged, including
  // the new `requestBag`/`requestSwitch` host callbacks. They're passed
  // straight through — the hook never reads or rebinds them.
  const runner = useMemo(() => new BattleRunner(options), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps

  const [snapshot, setSnapshot] = useState<BattleSnapshot>(() => runner.snapshot());
  const [phase, setPhase] = useState<BattlePhase>("intro");
  const [narration, setNarration] = useState<string[]>([]);
  const [availableMoves, setAvailableMoves] = useState<number[]>([]);
  const [availableSwitches, setAvailableSwitches] = useState<number[]>([]);
  const [outcome, setOutcome] = useState<BattleOutcome | null>(null);

  const startedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = runner.on((event) => {
      switch (event.type) {
        case "snapshot":
          setSnapshot(event.snapshot);
          break;
        case "phase":
          setPhase(event.phase);
          break;
        case "narration":
          setNarration((prev) => [...prev.slice(-4), event.line]);
          break;
        case "available-moves":
          setAvailableMoves(event.moves);
          break;
        case "available-switches":
          setAvailableSwitches(event.switches);
          break;
      }
    });

    if (!startedRef.current) {
      startedRef.current = true;
      runner.start().then(setOutcome).catch((err) => {
        console.warn("[useBattleRunner] runner.start rejected:", err);
      });
    }

    return () => {
      unsubscribe();
      runner.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    runner,
    snapshot,
    phase,
    narration,
    availableMoves,
    availableSwitches,
    submit: (action) => runner.submitAction(action),
    submitReplacement: (idx) => runner.submitReplacement(idx),
    outcome,
  };
}
