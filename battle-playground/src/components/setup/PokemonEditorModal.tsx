import { useMemo, useState } from "react";
import { Pokemon, getAllPokeSpecies, getMove } from "pokedata3g";
import type { PokeSpecies } from "pokedata3g";

interface Props {
  initial: Pokemon;
  onSave: (replacement: Pokemon) => void;
  onClose: () => void;
}

/** Union of a species' learnable moves (level-up + teach moves + egg moves). */
function learnableMoveIds(species: PokeSpecies): number[] {
  const ids = new Set<number>();
  for (const [moveId] of species.getLevelMoves()) ids.add(moveId);
  for (const id of species.getTeachMoves()) ids.add(id);
  for (const id of species.getEggMoves()) ids.add(id);
  return Array.from(ids).sort((a, b) => a - b);
}

export function PokemonEditorModal({ initial, onSave, onClose }: Props) {
  const allSpecies = useMemo(
    () => getAllPokeSpecies().slice().sort((a, b) => a.id - b.id),
    [],
  );

  const [speciesId, setSpeciesId] = useState(initial.speciesId);
  const [level, setLevel] = useState(initial.level);
  const [moveIds, setMoveIds] = useState<(number | null)[]>(() => {
    const slots: (number | null)[] = [null, null, null, null];
    initial.moves.forEach((m, i) => {
      if (i < 4) slots[i] = m.moveId;
    });
    return slots;
  });

  const currentSpecies = useMemo(
    () => allSpecies.find((s) => s.id === speciesId) ?? allSpecies[0],
    [allSpecies, speciesId],
  );
  const learnable = useMemo(() => learnableMoveIds(currentSpecies), [currentSpecies]);

  const handleSave = () => {
    const chosen = moveIds.filter((id): id is number => id != null);
    const moves = chosen.length > 0 ? chosen : undefined;
    onSave(new Pokemon(speciesId, level, moves ? { moves } : undefined));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit Pokémon</h2>

        <label>
          Species
          <select
            value={speciesId}
            onChange={(e) => {
              const newId = Number(e.target.value);
              setSpeciesId(newId);
              // Reset moves to that species' last 4 level-up moves.
              const sp = allSpecies.find((s) => s.id === newId);
              if (sp) {
                const levelMoves = sp
                  .getLevelMoves()
                  .filter(([, learnLevel]) => learnLevel <= level)
                  .slice(-4)
                  .map(([moveId]) => moveId);
                const slots: (number | null)[] = [null, null, null, null];
                levelMoves.forEach((id, i) => (slots[i] = id));
                setMoveIds(slots);
              }
            }}
          >
            {allSpecies.map((s) => (
              <option key={s.id} value={s.id}>
                #{s.id} {s.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Level
          <input
            type="number"
            min={1}
            max={100}
            value={level}
            onChange={(e) =>
              setLevel(Math.max(1, Math.min(100, Number(e.target.value))))
            }
          />
        </label>

        <div className="move-grid">
          {moveIds.map((id, i) => (
            <label key={i}>
              Move {i + 1}
              <select
                value={id ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  setMoveIds((prev) => {
                    const next = prev.slice();
                    next[i] = v;
                    return next;
                  });
                }}
              >
                <option value="">(none)</option>
                {learnable.map((mid) => {
                  const mv = getMove(mid);
                  return (
                    <option key={mid} value={mid}>
                      {mv?.name ?? `Move ${mid}`}
                    </option>
                  );
                })}
              </select>
            </label>
          ))}
        </div>

        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
