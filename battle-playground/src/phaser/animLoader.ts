/**
 * Decomp battle-animation asset loader.
 *
 * Phase 2 output from python-scripts/extract_battle_anims.py produces two manifests
 * and ~279 PNGs. This module:
 *
 *  1. Imports both manifests at build time (bundled into the JS).
 *  2. Resolves ANIM_TAG_* → Vite-hashed asset URL via import.meta.glob.
 *  3. Exposes a small Phaser-aware loader that loads a sheet on first use
 *     and memoizes it so subsequent requests are free.
 *
 * The Phase 3 command interpreter uses `resolveTemplate(name)` and
 * `ensureSheetLoaded(scene, tag)` to spawn sprites for any decomp move
 * animation by name.
 */
import * as Phaser from "phaser";

import sheetsManifestRaw from "../assets/battle_anims/sprite_sheets.json";
import templatesManifestRaw from "../assets/battle_anims/sprite_templates.json";

export interface SpriteSheetEntry {
  file: string;
  width: number;
  height: number;
}

export interface SpriteTemplateEntry {
  tileTag: string;
  paletteTag: string;
  oam: string;
  frameWidth: number | null;
  frameHeight: number | null;
  callback: string;
  anims: { tileOffset: number; duration: number }[][];
}

const sheetsManifest = sheetsManifestRaw as Record<string, SpriteSheetEntry>;
const templatesManifest = templatesManifestRaw as Record<string, SpriteTemplateEntry>;

/** Vite asset map: filename stem (e.g. "rocks") -> hashed URL. */
const SPRITE_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob("../assets/battle_anims/sprites/*.png", {
      eager: true,
      query: "?url",
      import: "default",
    }),
  ).map(([path, url]) => {
    const stem = path.split("/").pop()!.replace(/\.png$/, "");
    return [stem, url as string];
  }),
);

/** Runtime cache of tags whose sheet has already been loaded into a scene. */
const loadedByScene = new WeakMap<Phaser.Scene, Set<string>>();

/** Look up a sprite template by name (e.g. "gFallingRockSpriteTemplate"). */
export function resolveTemplate(name: string): SpriteTemplateEntry | null {
  return templatesManifest[name] ?? null;
}

/** Look up a sheet entry by ANIM_TAG name. */
export function resolveSheet(tag: string): SpriteSheetEntry | null {
  return sheetsManifest[tag] ?? null;
}

/** Resolve the Vite-hashed URL for an ANIM_TAG_* tag. */
export function urlForTag(tag: string): string | null {
  const sheet = sheetsManifest[tag];
  if (!sheet) return null;
  const stem = sheet.file.replace(/\.png$/, "");
  return SPRITE_URLS[stem] ?? null;
}

/**
 * Ensure a Phaser spritesheet texture exists for the given tag, loading it
 * on demand. Returns a promise that resolves when the texture is available.
 */
export function ensureSheetLoaded(
  scene: Phaser.Scene,
  tag: string,
  frameWidth: number,
  frameHeight: number,
): Promise<string> {
  const key = `anim:${tag}`;
  if (scene.textures.exists(key)) {
    return Promise.resolve(key);
  }
  let loaded = loadedByScene.get(scene);
  if (!loaded) {
    loaded = new Set();
    loadedByScene.set(scene, loaded);
  }
  if (loaded.has(key)) {
    return new Promise((resolve, reject) => {
      scene.load.once(`filecomplete-spritesheet-${key}`, () => resolve(key));
      scene.load.once(`loaderror`, (file: { key: string }) => {
        if (file.key === key) reject(new Error(`failed to load ${tag}`));
      });
    });
  }
  const url = urlForTag(tag);
  if (!url) {
    return Promise.reject(new Error(`no sprite sheet registered for ${tag}`));
  }
  loaded.add(key);
  return new Promise((resolve, reject) => {
    scene.load.once(`filecomplete-spritesheet-${key}`, () => resolve(key));
    scene.load.once(`loaderror`, (file: { key: string }) => {
      if (file.key === key) reject(new Error(`failed to load ${tag}`));
    });
    scene.load.spritesheet(key, url, { frameWidth, frameHeight });
    scene.load.start();
  });
}

/**
 * Convert a decomp tileOffset (in 8x8 tiles from the top of the sheet) to
 * a Phaser frame index for a spritesheet sliced into frameWidth x frameHeight
 * cells.
 *
 *   tiles per frame = (frameW / 8) * (frameH / 8)
 *   frameIndex      = tileOffset / tiles per frame
 *
 * e.g. rocks.png is 32x192 with 32x32 frames → 16 tiles per frame.
 * A decomp tileOffset of 48 maps to frame index 48/16 = 3.
 */
export function tileOffsetToFrameIndex(
  tileOffset: number,
  frameWidth: number,
  frameHeight: number,
): number {
  const tilesPerFrame = (frameWidth / 8) * (frameHeight / 8);
  return Math.floor(tileOffset / tilesPerFrame);
}

/** Expose the raw manifests for debugging / introspection. */
export const manifests = {
  sheets: sheetsManifest,
  templates: templatesManifest,
};
