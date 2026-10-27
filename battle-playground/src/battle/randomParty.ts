import { getAllPokeSpecies, Pokemon, Party } from "pokedata3g";
import type { PokeSpecies } from "pokedata3g";
import { BST_BAND, DEFAULT_LEVEL } from "../config/setupConfig";

function baseStatTotal(species: PokeSpecies): number {
  return species.getStats().reduce((a, b) => a + b, 0);
}

let _pool: PokeSpecies[] | null = null;
function getPool(): PokeSpecies[] {
  if (_pool) return _pool;
  const [min, max] = BST_BAND;
  _pool = getAllPokeSpecies().filter((s) => {
    const bst = baseStatTotal(s);
    return bst >= min && bst <= max;
  });
  return _pool;
}

function sample<T>(arr: T[], n: number): T[] {
  const copy = arr.slice();
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function levelJitter(baseLevel: number): number {
  const delta = Math.floor(Math.random() * 5) - 2; // -2..+2
  return Math.max(2, baseLevel + delta);
}

export function generateBalancedParty(
  baseLevel: number = DEFAULT_LEVEL,
  size: number = 6,
): Party {
  const picks = sample(getPool(), size);
  const pokemon = picks.map((s) => new Pokemon(s.id, levelJitter(baseLevel)));
  return new Party(pokemon);
}

export function generateBalancedPair(baseLevel: number = DEFAULT_LEVEL): {
  player: Party;
  opponent: Party;
} {
  return {
    player: generateBalancedParty(baseLevel),
    opponent: generateBalancedParty(baseLevel),
  };
}
