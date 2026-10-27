import { getAllItems, Bag } from "pokedata3g";
import type { Weather } from "pokedata3g";

/** Weather options shown in the setup screen. Primal weathers are excluded. */
export const WEATHER_OPTIONS: { id: Weather | "clear"; label: string }[] = [
  { id: "clear", label: "None" },
  { id: "rain", label: "Rain" },
  { id: "sun", label: "Harsh Sunlight" },
  { id: "sandstorm", label: "Sandstorm" },
  { id: "hail", label: "Hail" },
];

/** Default level for auto-generated balanced parties. */
export const DEFAULT_LEVEL = 50;
/** Species BST must fall within this band to appear in a random party. */
export const BST_BAND: readonly [number, number] = [300, 600];

/**
 * Default bag contents for a new player. Each entry maps an item identifier
 * (looked up via `getItem`) to a quantity.
 */
const DEFAULT_BAG_IDENTIFIERS: { identifier: string; quantity: number }[] = [
  { identifier: "potion", quantity: 5 },
  { identifier: "super-potion", quantity: 3 },
  { identifier: "full-heal", quantity: 2 },
  { identifier: "revive", quantity: 2 },
  { identifier: "poke-ball", quantity: 10 },
];

export function buildDefaultBag(): Bag {
  const bag = new Bag();
  for (const { identifier, quantity } of DEFAULT_BAG_IDENTIFIERS) {
    const item = findItemByIdentifier(identifier);
    if (item) bag.add(item.id, quantity);
  }
  return bag;
}

let _identifierIndex: Map<string, number> | null = null;
function findItemByIdentifier(identifier: string) {
  if (!_identifierIndex) {
    _identifierIndex = new Map();
    for (const item of getAllItems()) _identifierIndex.set(item.identifier, item.id);
  }
  const id = _identifierIndex.get(identifier);
  return id != null ? { id } : null;
}
