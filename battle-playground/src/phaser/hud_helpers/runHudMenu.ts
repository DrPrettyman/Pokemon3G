/**
 * Async menu input loop over a HudWindow — replaces the old HudMenu class.
 *
 * Navigation is pure 2D grid-index math: the `grid` parameter is a
 * `string[][]` where `grid[row][col]` is a cell id or null for an
 * empty slot. Works for 2×2 (action/move), 1×2 (yes/no), or any shape.
 */
import type { HudInput, HudButton } from "./HudInput";
import type { HudWindow } from "./HudWindow";

export interface RunHudMenuConfig {
  grid: readonly (readonly (string | null)[])[];
  disabled?: ReadonlySet<string>;
  initialId?: string;
  cancellable?: boolean;
  onCursorChange?: (id: string) => void;
}

export type HudMenuResult = { id: string } | { cancel: true };

export function computeNextId(
  grid: readonly (readonly (string | null)[])[],
  currentId: string,
  button: HudButton,
  disabled?: ReadonlySet<string>,
): string {
  let row = -1;
  let col = -1;
  for (let r = 0; r < grid.length; r++) {
    const c = grid[r].indexOf(currentId);
    if (c !== -1) {
      row = r;
      col = c;
      break;
    }
  }
  if (row === -1) return currentId;

  let dr = 0;
  let dc = 0;
  switch (button) {
    case "up":    dr = -1; break;
    case "down":  dr = 1;  break;
    case "left":  dc = -1; break;
    case "right": dc = 1;  break;
    default: return currentId;
  }

  const nr = row + dr;
  const nc = col + dc;
  if (nr < 0 || nr >= grid.length) return currentId;
  if (nc < 0 || nc >= grid[nr].length) return currentId;
  const candidate = grid[nr][nc];
  if (!candidate) return currentId;
  if (disabled?.has(candidate)) return currentId;
  return candidate;
}

const ALL_BUTTONS: readonly HudButton[] = [
  "up", "down", "left", "right", "A", "B",
];

export async function runHudMenu(
  window: HudWindow,
  input: HudInput,
  cfg: RunHudMenuConfig,
): Promise<HudMenuResult> {
  const firstEnabled = cfg.grid.flat().find(
    (id): id is string => id != null && !cfg.disabled?.has(id),
  );
  let currentId = cfg.initialId ?? firstEnabled ?? cfg.grid[0][0]!;
  window.setCursor(currentId);

  for (;;) {
    const btn = await input.waitForPress(ALL_BUTTONS);
    if (btn === "A") {
      if (!cfg.disabled?.has(currentId)) return { id: currentId };
      continue;
    }
    if (btn === "B") {
      if (cfg.cancellable) return { cancel: true };
      continue;
    }
    const nextId = computeNextId(cfg.grid, currentId, btn, cfg.disabled);
    if (nextId !== currentId) {
      currentId = nextId;
      window.setCursor(currentId);
      cfg.onCursorChange?.(nextId);
    }
  }
}
