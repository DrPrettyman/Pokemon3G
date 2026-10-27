/**
 * Fallback React party picker for non-Phaser hosts.
 *
 * The real party screen is `PartyMenuScene` — a Phaser scene that
 * faithfully reproduces the FireRed decomp's party menu with
 * extracted chrome, palette-accurate slot states, and decomp
 * navigation. This React stub remains as a simple accessible
 * fallback for hosts that render bag/party UI outside Phaser.
 *
 * When no `onRequestSwitch` prop is passed to `<PhaserBattle>`,
 * the Phaser-native PartyMenuScene is used automatically.
 */
import type { Party } from "pokedata3g";

export interface PartyScreenProps {
  party: Party;
  /** Party indices that cannot be chosen (fainted, current active, etc). */
  disabledIndices?: number[];
  /** "switch" shows HP/status; "summary" shows full stats. */
  mode: "switch" | "summary";
  onSelect: (partyIndex: number) => void;
  onCancel: () => void;
}

export function PartyScreen({
  party,
  disabledIndices = [],
  mode,
  onSelect,
  onCancel,
}: PartyScreenProps) {
  const disabled = new Set(disabledIndices);
  return (
    <div className="move-menu">
      {party.pokemon.map((p, i) => (
        <button
          key={i}
          disabled={disabled.has(i)}
          onClick={() => onSelect(i)}
        >
          {p.name} (Lv {p.level}) {p.currentHp}/{p.maxHp}HP
          {mode === "summary" ? ` · ${p.isFainted ? "Fainted" : "OK"}` : ""}
        </button>
      ))}
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}
