import type { Pokemon } from "pokedata3g";

/** Play a Pokemon's cry. No-op if the species has no cry or audio fails. */
export function playCry(pokemon: Pokemon, volume = 0.6): void {
  const path = pokemon.species.getCry();
  if (!path) return;
  try {
    const audio = new Audio(`/${path}`);
    audio.volume = volume;
    // Autoplay may be blocked before the first user gesture — that's fine; the
    // cry just won't play until the player clicks something.
    void audio.play().catch(() => undefined);
  } catch {
    /* ignore */
  }
}
