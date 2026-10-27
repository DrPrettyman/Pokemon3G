/**
 * Typed accessor surface for the two decomp-derived manifests:
 *
 *   - `sprite_sheets.json`    ANIM_TAG → { file, width, height }
 *   - `sprite_templates.json` template name → { tileTag, frameW/H, anims, callback }
 *
 * The Phaser renderer owns loading sheets into GPU textures (see
 * `src/phaser/animLoader.ts`); this module exposes the pure-data lookups
 * so tests and the renderer share a single typed surface.
 */
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

const sheets = sheetsManifestRaw as Record<string, SpriteSheetEntry>;
const templates = templatesManifestRaw as Record<string, SpriteTemplateEntry>;

export const AnimDatabase = {
  getTemplate(name: string): SpriteTemplateEntry | null {
    return templates[name] ?? null;
  },
  getSheet(tag: string): SpriteSheetEntry | null {
    return sheets[tag] ?? null;
  },
  allTemplates(): Record<string, SpriteTemplateEntry> {
    return templates;
  },
  allSheets(): Record<string, SpriteSheetEntry> {
    return sheets;
  },
} as const;
