/**
 * Eager Vite glob import of the battle-anim BG layer PNGs plus the
 * `gBattleAnimBackgroundTable` index, exposed as a `{ BG_* id -> url }` map.
 *
 * The JSON is written by `python-scripts/extract_battle_graphics.py` alongside the
 * PNGs and keyed by logical BG id (`BG_DRILL`, `BG_IMPACT_OPPONENT`, ...) so
 * animations.json commands like `fadetobg BG_DRILL` resolve without an extra
 * name transform.
 */
import bgIndex from "../assets/battle_anims/backgrounds/index.json";

const modules = import.meta.glob<string>("../assets/battle_anims/backgrounds/*.png", {
  eager: true,
  import: "default",
  query: "?url",
});

const urlByFilename: Record<string, string> = {};
for (const [path, url] of Object.entries(modules)) {
  const filename = path.split("/").pop()!;
  urlByFilename[filename] = url;
}

export const ANIM_BG_URLS: Record<string, string> = {};
for (const [bgId, filename] of Object.entries(bgIndex as Record<string, string>)) {
  const url = urlByFilename[filename];
  if (url) ANIM_BG_URLS[bgId] = url;
}
