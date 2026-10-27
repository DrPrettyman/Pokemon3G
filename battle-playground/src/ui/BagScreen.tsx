/**
 * Reusable bag UI. Selection-only — does not mutate the Bag (the caller
 * decides whether an item is consumed). Usable in-battle and in the
 * overworld pause menu.
 */
import { useState } from "react";
import type { Bag, Party } from "pokedata3g";

export interface BagScreenProps {
  bag: Bag;
  /** Party so the user can pick a target mon after selecting an item. */
  party: Party;
  /** Optional filter — return false to hide an item in the current context. */
  filter?: (itemId: number) => boolean;
  onSelect: (result: { itemId: number; partyIndex: number }) => void;
  onCancel: () => void;
}

export function BagScreen({ bag, party, filter, onSelect, onCancel }: BagScreenProps) {
  const [pendingItem, setPendingItem] = useState<number | null>(null);

  const allSlots = bag.getAllItems();
  const slots = filter ? allSlots.filter((s) => filter(s.itemId)) : allSlots;

  if (pendingItem != null) {
    return (
      <div className="move-menu">
        <div>Use on which Pokémon?</div>
        {party.pokemon.map((p, i) => (
          <button
            key={i}
            onClick={() => {
              onSelect({ itemId: pendingItem, partyIndex: i });
              setPendingItem(null);
            }}
          >
            {p.name} (Lv {p.level}) {p.currentHp}/{p.maxHp}HP
          </button>
        ))}
        <button onClick={() => setPendingItem(null)}>Back</button>
      </div>
    );
  }

  return (
    <div className="move-menu">
      {slots.length === 0 && <div>(Bag is empty)</div>}
      {slots.map((slot) => (
        <button key={slot.itemId} onClick={() => setPendingItem(slot.itemId)}>
          Item #{slot.itemId} ×{slot.quantity}
        </button>
      ))}
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}
