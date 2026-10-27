/**
 * Edge-triggered keyboard input for the HUD. Mirrors the decomp's
 * `gMain.newKeys` / `JOY_NEW` semantics — one event per physical
 * press, no autorepeat.
 *
 * Key map: Arrows → D-pad, A → A button, S → B button.
 */
import * as Phaser from "phaser";

export type HudButton = "up" | "down" | "left" | "right" | "A" | "B";

type Listener = (button: HudButton) => void;

const KEY_MAP: Record<string, HudButton> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyA: "A",
  KeyS: "B",
};

export class HudInput {
  private readonly pressListeners = new Set<Listener>();
  private readonly releaseListeners = new Set<Listener>();
  private readonly keydown: (ev: KeyboardEvent) => void;
  private readonly keyup: (ev: KeyboardEvent) => void;
  private disposed = false;

  constructor(scene: Phaser.Scene) {
    this.keydown = (ev: KeyboardEvent) => {
      const btn = KEY_MAP[ev.code];
      if (!btn) return;
      ev.preventDefault();
      if (ev.repeat) return;
      for (const l of this.pressListeners) l(btn);
    };
    this.keyup = (ev: KeyboardEvent) => {
      const btn = KEY_MAP[ev.code];
      if (!btn) return;
      for (const l of this.releaseListeners) l(btn);
    };
    window.addEventListener("keydown", this.keydown);
    window.addEventListener("keyup", this.keyup);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.dispose());
    scene.events.once(Phaser.Scenes.Events.DESTROY, () => this.dispose());
  }

  onPress(listener: Listener): () => void {
    this.pressListeners.add(listener);
    return () => this.pressListeners.delete(listener);
  }

  onRelease(listener: Listener): () => void {
    this.releaseListeners.add(listener);
    return () => this.releaseListeners.delete(listener);
  }

  waitForPress(buttons: readonly HudButton[]): Promise<HudButton> {
    if (this.disposed) return new Promise<HudButton>(() => {});
    return new Promise((resolve) => {
      const unsubscribe = this.onPress((btn) => {
        if (!buttons.includes(btn)) return;
        unsubscribe();
        resolve(btn);
      });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pressListeners.clear();
    this.releaseListeners.clear();
    window.removeEventListener("keydown", this.keydown);
    window.removeEventListener("keyup", this.keyup);
  }
}
