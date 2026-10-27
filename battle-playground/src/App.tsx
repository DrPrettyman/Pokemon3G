import { useCallback, useMemo, useRef, useState } from "react";
import { NpcTrainer, Player } from "pokedata3g";
import type { BattleOutcome } from "pokedata3g";
import { SetupScreen } from "./components/setup/SetupScreen";
import type { BattleSetup } from "./components/setup/SetupScreen";
import { PhaserBattle } from "./ui/PhaserBattle";
import { BagScreen } from "./ui/BagScreen";
type BagResult = { itemId: number; partyIndex: number } | null;
type Overlay =
  | { kind: "none" }
  | { kind: "bag"; resolve: (r: BagResult) => void };

/**
 * Playground demo host. Composes `<PhaserBattle>` with a sibling
 * `<BagScreen>` via the documented request-promise contract. Party
 * switching uses the Phaser-native PartyMenuScene overlay (default).
 */
export function App() {
  const [setup, setSetup] = useState<BattleSetup | null>(null);
  const [overlay, setOverlay] = useState<Overlay>({ kind: "none" });
  // Ref so the onRequestBag callback is stable across re-renders.
  const setOverlayRef = useRef(setOverlay);
  setOverlayRef.current = setOverlay;

  // Wrap the playground's bare Party into a Player so `<PhaserBattle>`'s
  // locked contract holds. A real host game passes its save-state Player
  // directly.
  const player = useMemo(
    () => (setup ? new Player({ party: setup.playerParty, bag: setup.bag }) : null),
    [setup],
  );
  const opponent = useMemo(
    () => (setup ? new NpcTrainer({ party: setup.opponentParty }) : null),
    [setup],
  );

  const onRequestBag = useCallback(
    () =>
      new Promise<BagResult>((resolve) => {
        setOverlayRef.current({ kind: "bag", resolve });
      }),
    [],
  );
  // Party switch now uses the Phaser-native PartyMenuScene by default
  // (onRequestSwitch omitted → PhaserBattle falls through to its
  // built-in decomp-faithful party overlay).

  const onComplete = useCallback((_outcome: BattleOutcome) => {
    // Playground just logs and waits for the user to hit "Back to Setup"
    // via the in-scene outro. A real game would mount a post-battle
    // dialogue scene here.
  }, []);

  if (!setup || !player || !opponent) {
    return (
      <div className="app">
        <SetupScreen onStart={setSetup} />
      </div>
    );
  }

  return (
    <div className="app">
      <PhaserBattle
        player={player}
        opponent={opponent}
        weather={setup.weather}
        backdropId={setup.backdropId}
        onRequestBag={onRequestBag}
        onComplete={onComplete}
      />

      {overlay.kind === "bag" && (
        <div className="overlay">
          <BagScreen
            bag={setup.bag}
            party={setup.playerParty}
            onSelect={(r) => {
              overlay.resolve(r);
              setOverlay({ kind: "none" });
            }}
            onCancel={() => {
              overlay.resolve(null);
              setOverlay({ kind: "none" });
            }}
          />
        </div>
      )}

      <button className="exit-btn" onClick={() => setSetup(null)}>
        Back to Setup
      </button>
    </div>
  );
}
