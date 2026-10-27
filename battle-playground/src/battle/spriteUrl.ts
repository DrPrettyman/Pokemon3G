import { getPokeSpecies } from "pokedata3g";
import type { Pokemon } from "pokedata3g";

/** Absolute URL (served from /public/sprites) for an in-battle sprite. */
export function spriteUrlFor(pokemon: Pokemon, view: "front" | "back"): string | undefined {
  const path = view === "front" ? pokemon.getSpriteFront() : pokemon.getSpriteBack();
  return path ? `/${path}` : undefined;
}

/** Front-facing sprite for a species (e.g. party slot thumbnails in the setup screen). */
export function frontSpriteById(speciesId: number, formIndex?: number): string | undefined {
  const species = getPokeSpecies(speciesId);
  const path = species?.getSprite("front", formIndex);
  return path ? `/${path}` : undefined;
}
