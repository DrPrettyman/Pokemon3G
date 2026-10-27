import { useState, useMemo } from "react";
import { Party, Bag } from "pokedata3g";
import type { Pokemon, Weather } from "pokedata3g";
import { BackdropPicker } from "./BackdropPicker";
import { WeatherPicker } from "./WeatherPicker";
import { PartyPanel } from "./PartyPanel";
import { PokemonEditorModal } from "./PokemonEditorModal";
import { generateBalancedPair } from "../../battle/randomParty";
import { buildDefaultBag, DEFAULT_LEVEL } from "../../config/setupConfig";

export interface BattleSetup {
  backdropId: string;
  weather: Weather | null;
  playerParty: Party;
  opponentParty: Party;
  bag: Bag;
}

interface Props {
  onStart: (setup: BattleSetup) => void;
}

function replacePartyMember(party: Party, index: number, replacement: Pokemon): Party {
  const members = party.pokemon.slice();
  members[index] = replacement;
  return new Party(members);
}

export function SetupScreen({ onStart }: Props) {
  const initial = useMemo(() => generateBalancedPair(DEFAULT_LEVEL), []);
  const [backdropId, setBackdropId] = useState("tall_grass");
  const [weatherId, setWeatherId] = useState<Weather | "clear">("clear");
  const [playerParty, setPlayerParty] = useState<Party>(initial.player);
  const [opponentParty, setOpponentParty] = useState<Party>(initial.opponent);
  const [bag] = useState<Bag>(() => buildDefaultBag());
  const [editingSlot, setEditingSlot] = useState<number | null>(null);

  const reroll = () => {
    const pair = generateBalancedPair(DEFAULT_LEVEL);
    setPlayerParty(pair.player);
    setOpponentParty(pair.opponent);
  };

  const handleStart = () => {
    onStart({
      backdropId,
      weather: weatherId === "clear" ? null : weatherId,
      playerParty,
      opponentParty,
      bag,
    });
  };

  const editingMember =
    editingSlot != null ? playerParty.pokemon[editingSlot] : null;

  return (
    <div className="setup">
      <h1>Pokémon Battle Playground</h1>

      <div className="row">
        <BackdropPicker value={backdropId} onChange={setBackdropId} />
        <WeatherPicker value={weatherId} onChange={setWeatherId} />
        <button onClick={reroll}>Reroll Parties</button>
      </div>

      <PartyPanel
        title="Your Party (click a slot to edit)"
        party={playerParty}
        editable
        onEditSlot={setEditingSlot}
      />
      <PartyPanel title="Opponent" party={opponentParty} editable={false} />

      <button
        className="start"
        onClick={handleStart}
        disabled={playerParty.pokemon.length === 0 || opponentParty.pokemon.length === 0}
      >
        Start Battle
      </button>

      {editingMember && editingSlot != null && (
        <PokemonEditorModal
          initial={editingMember}
          onClose={() => setEditingSlot(null)}
          onSave={(replacement) => {
            setPlayerParty((prev) => replacePartyMember(prev, editingSlot, replacement));
            setEditingSlot(null);
          }}
        />
      )}
    </div>
  );
}
