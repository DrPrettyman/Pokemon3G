import type { Party } from "pokedata3g";
import { PartySlot } from "./PartySlot";

interface Props {
  title: string;
  party: Party;
  editable: boolean;
  onEditSlot?: (slotIndex: number) => void;
}

export function PartyPanel({ title, party, editable, onEditSlot }: Props) {
  const slots = Array.from({ length: 6 }, (_, i) => party.pokemon[i] ?? null);
  return (
    <div className="party-panel">
      <h2>{title}</h2>
      <div className="party-grid">
        {slots.map((member, i) => (
          <PartySlot
            key={i}
            member={member}
            editable={editable}
            onClick={() => onEditSlot?.(i)}
          />
        ))}
      </div>
    </div>
  );
}
