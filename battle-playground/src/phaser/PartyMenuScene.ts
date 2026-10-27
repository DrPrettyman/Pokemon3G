/**
 * Party menu — a full-screen Phaser scene overlaid on the battle scene.
 *
 * Faithfully reproduces the FireRed decomp's PARTY_LAYOUT_SINGLE party
 * menu.  Driven by HudInput keyboard navigation, matching the existing
 * battle HUD patterns.
 *
 * Integration: launched via `scene.launch("PartyMenuScene", data)` from
 * the host.  Emits `"party:select"` with `{ index: number }` or
 * `"party:cancel"` when the player makes a choice.
 *
 * Sources:
 *   - `firered/src/party_menu.c` — all logic
 *   - `firered/src/data/party_menu.h` — layout tables
 *   - `firered/include/constants/party_menu.h` — constants
 */
import * as Phaser from "phaser";
import { Egg } from "pokedata3g";
import type { Pokemon, PartyMember } from "pokedata3g";
import { PhaserClock, FRAME_MS } from "../runtime/clock";
import type { Clock } from "../runtime/clock";
import { BitmapFontPrinter } from "./BitmapFont";
import { HudInput } from "./hud_helpers/HudInput";
import {
  PARTY_SCREEN_WIDTH,
  PARTY_SCREEN_HEIGHT,
  SLOT_SPRITE_COORDS,
  LEFT_COLUMN_TEXT,
  RIGHT_COLUMN_TEXT,
  SLOT_WINDOWS,
  CANCEL_POS,
  MESSAGE_POS,
  PARTY_KEY,
  hpBarColor,
  GENDER_MALE_COLOR,
  GENDER_FEMALE_COLOR,
} from "./partyMenuLayouts";

// ─── Asset imports (Vite) ──────────────────────────────────────────────────
import partyBgUrl from "../assets/hud/party_bg.png";
import slotMainUrl from "../assets/hud/party_slot_main.png";
import slotMainSelUrl from "../assets/hud/party_slot_main_sel.png";
import slotMainFntUrl from "../assets/hud/party_slot_main_fnt.png";
import slotMainFntSelUrl from "../assets/hud/party_slot_main_fnt_sel.png";
import slotWideUrl from "../assets/hud/party_slot_wide.png";
import slotWideSelUrl from "../assets/hud/party_slot_wide_sel.png";
import slotWideFntUrl from "../assets/hud/party_slot_wide_fnt.png";
import slotWideFntSelUrl from "../assets/hud/party_slot_wide_fnt_sel.png";
import slotWideEmptyUrl from "../assets/hud/party_slot_wide_empty.png";
import cancelUrl from "../assets/hud/party_cancel.png";
import cancelSelUrl from "../assets/hud/party_cancel_sel.png";
import pokeballUrl from "../assets/hud/party_pokeball.png";
import pokeballSmallUrl from "../assets/hud/party_pokeball_small.png";
import holdIconsUrl from "../assets/hud/party_hold_icons.png";
import slotMainNohpUrl from "../assets/hud/party_slot_main_nohp.png";
import slotMainNohpSelUrl from "../assets/hud/party_slot_main_nohp_sel.png";
import slotWideNohpUrl from "../assets/hud/party_slot_wide_nohp.png";
import slotWideNohpSelUrl from "../assets/hud/party_slot_wide_nohp_sel.png";
import eggIconUrl from "../assets/hud/party_egg_icon.png";
import eggIcon2Url from "../assets/hud/party_egg_icon2.png";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PartyMenuSceneData {
  /** The party to display. Supports both Pokemon and Egg members. */
  party: PartyMember[];
  /** Party indices that cannot be selected (fainted active mon, etc). */
  disabledIndices?: number[];
  /** "switch" = in-battle, "summary" = overworld (future). */
  mode: "switch" | "summary";
  /** Bottom text. Defaults to "Choose a POKéMON." */
  message?: string;
}

/** Per-slot runtime state managed by the scene. */
interface SlotState {
  chrome: Phaser.GameObjects.Image;
  iconFrame1: Phaser.GameObjects.Image | null;
  iconFrame2: Phaser.GameObjects.Image | null;
  ballSprite: Phaser.GameObjects.Image;
  hpFill: Phaser.GameObjects.Rectangle | null;
  nickPrinter: BitmapFontPrinter;
  levelPrinter: BitmapFontPrinter | null;
  hpPrinter: BitmapFontPrinter | null;
  genderDom: Phaser.GameObjects.DOMElement | null;
  member: PartyMember;
  isFainted: boolean;
  isEgg: boolean;
}

// ─── Scene ─────────────────────────────────────────────────────────────────

/** Bounce animation: y offsets alternate each icon anim frame (decomp SpriteCB_BouncePartyMonIcon). */
const BOUNCE_Y_UP = -3;
const BOUNCE_Y_DOWN = 1;
/** Bounce toggle interval in ms (~12 frames at 59.7 fps, matching UpdateMonIconFrame timing). */
const BOUNCE_INTERVAL_MS = 12 * FRAME_MS;

const SLOT_CANCEL = 6;

export class PartyMenuScene extends Phaser.Scene {
  private partyData!: PartyMenuSceneData;
  private clock!: Clock;
  private hudInput!: HudInput;
  private slots: SlotState[] = [];
  private cancelChrome!: Phaser.GameObjects.Image;
  private cancelText!: BitmapFontPrinter;
  private messagePrinter!: BitmapFontPrinter;
  private currentSlot = 0;
  private lastRightSlot = 1;
  private bounceTimer: Phaser.Time.TimerEvent | null = null;
  private bounceUp = true;

  constructor() {
    super({ key: "PartyMenuScene" });
  }

  init(data: PartyMenuSceneData): void {
    this.partyData = data;
    this.slots = [];
    this.currentSlot = 0;
    this.lastRightSlot = 1;
  }

  preload(): void {
    // Chrome textures
    const textures: [string, string][] = [
      [PARTY_KEY.bg, partyBgUrl],
      [PARTY_KEY.slotMain, slotMainUrl],
      [PARTY_KEY.slotMainSel, slotMainSelUrl],
      [PARTY_KEY.slotMainFnt, slotMainFntUrl],
      [PARTY_KEY.slotMainFntSel, slotMainFntSelUrl],
      [PARTY_KEY.slotMainNohp, slotMainNohpUrl],
      [PARTY_KEY.slotMainNohpSel, slotMainNohpSelUrl],
      [PARTY_KEY.slotWide, slotWideUrl],
      [PARTY_KEY.slotWideSel, slotWideSelUrl],
      [PARTY_KEY.slotWideFnt, slotWideFntUrl],
      [PARTY_KEY.slotWideFntSel, slotWideFntSelUrl],
      [PARTY_KEY.slotWideNohp, slotWideNohpUrl],
      [PARTY_KEY.slotWideNohpSel, slotWideNohpSelUrl],
      [PARTY_KEY.slotWideEmpty, slotWideEmptyUrl],
      [PARTY_KEY.cancel, cancelUrl],
      [PARTY_KEY.cancelSel, cancelSelUrl],
      [PARTY_KEY.eggIcon, eggIconUrl],
      [PARTY_KEY.eggIcon2, eggIcon2Url],
    ];
    for (const [key, url] of textures) {
      if (!this.textures.exists(key)) {
        this.load.image(key, url);
      }
    }

    // Pokeball spritesheet: 32×64 → 2 frames of 32×32 (closed, open)
    if (!this.textures.exists(PARTY_KEY.pokeball)) {
      this.load.spritesheet(PARTY_KEY.pokeball, pokeballUrl, {
        frameWidth: 32,
        frameHeight: 32,
      });
    }

    // Small pokeball: 16×96 → 6 frames of 16×16
    if (!this.textures.exists(PARTY_KEY.pokeballSmall)) {
      this.load.spritesheet(PARTY_KEY.pokeballSmall, pokeballSmallUrl, {
        frameWidth: 16,
        frameHeight: 16,
      });
    }

    // Held item icons: 8×16 → 2 frames of 8×8 (item, mail)
    if (!this.textures.exists(PARTY_KEY.holdIcons)) {
      this.load.spritesheet(PARTY_KEY.holdIcons, holdIconsUrl, {
        frameWidth: 8,
        frameHeight: 8,
      });
    }

    // Pokemon icon textures — loaded on demand per party member.
    // Eggs use a static icon loaded above; only Pokemon need per-species loading.
    for (const mon of this.partyData.party) {
      if (mon instanceof Egg) continue;
      const iconPath = mon.getIcon();
      const icon2Path = mon.species.getSprite("icon-frame2", mon.formIndex);
      const key1 = PARTY_KEY.icon(mon.species.getIdentifier(mon.formIndex));
      const key2 = PARTY_KEY.iconFrame2(mon.species.getIdentifier(mon.formIndex));
      if (iconPath && !this.textures.exists(key1)) {
        this.load.image(key1, `/${iconPath}`);
      }
      if (icon2Path && !this.textures.exists(key2)) {
        this.load.image(key2, `/${icon2Path}`);
      }
    }
  }

  create(): void {
    this.clock = new PhaserClock(this);
    this.hudInput = new HudInput(this);

    // BG
    this.add
      .image(0, 0, PARTY_KEY.bg)
      .setOrigin(0, 0)
      .setDepth(0);

    // Build slots
    const party = this.partyData.party;
    const disabled = new Set(this.partyData.disabledIndices ?? []);

    for (let i = 0; i < 6; i++) {
      if (i >= party.length) {
        this.buildEmptySlot(i);
      } else if (party[i] instanceof Egg) {
        this.buildEggSlot(i, party[i] as Egg);
      } else {
        this.buildOccupiedSlot(i, party[i] as Pokemon);
      }
    }

    // Cancel button
    this.cancelChrome = this.add
      .image(CANCEL_POS.x, CANCEL_POS.y, PARTY_KEY.cancel)
      .setOrigin(0, 0)
      .setDepth(10);

    // Small pokeball next to CANCEL text
    this.add
      .image(CANCEL_POS.x + 4, CANCEL_POS.y, PARTY_KEY.pokeballSmall)
      .setOrigin(0, 0)
      .setDepth(11)
      .setFrame(0);

    this.cancelText = new BitmapFontPrinter(this, this.clock, {
      x: CANCEL_POS.x + 18,
      y: CANCEL_POS.y + 1,
      maxWidth: 40,
      depth: 12,
      palette: "hud",
      size: "small",
    });
    this.cancelText.printInstant("CANCEL");

    // Message area
    this.messagePrinter = new BitmapFontPrinter(this, this.clock, {
      x: MESSAGE_POS.x + 4,
      y: MESSAGE_POS.y + 4,
      maxWidth: MESSAGE_POS.w - 8,
      depth: 12,
      palette: "dialogue",
    });
    this.messagePrinter.printInstant(
      this.partyData.message ?? "Choose a POKéMON.",
    );

    // Highlight initial slot
    this.updateSlotVisual(this.currentSlot, true);

    // Start input loop
    this.runInputLoop(disabled);
  }

  // ── Slot construction ──────────────────────────────────────────────────

  private buildOccupiedSlot(index: number, pokemon: Pokemon): void {
    const isLeft = index === 0;
    const win = SLOT_WINDOWS[index];
    const coords = SLOT_SPRITE_COORDS[index];
    const textLayout = isLeft ? LEFT_COLUMN_TEXT : RIGHT_COLUMN_TEXT;
    const isFainted = pokemon.isFainted;

    // Chrome
    const chromeKey = isLeft
      ? isFainted ? PARTY_KEY.slotMainFnt : PARTY_KEY.slotMain
      : isFainted ? PARTY_KEY.slotWideFnt : PARTY_KEY.slotWide;
    const chrome = this.add
      .image(win.x, win.y, chromeKey)
      .setOrigin(0, 0)
      .setDepth(5);

    // Pokemon icon (frame 1)
    const iconKey1 = PARTY_KEY.icon(pokemon.species.getIdentifier(pokemon.formIndex));
    const iconKey2 = PARTY_KEY.iconFrame2(pokemon.species.getIdentifier(pokemon.formIndex));
    let iconFrame1: Phaser.GameObjects.Image | null = null;
    let iconFrame2: Phaser.GameObjects.Image | null = null;

    if (this.textures.exists(iconKey1)) {
      iconFrame1 = this.add
        .image(coords.mon[0], coords.mon[1], iconKey1)
        .setOrigin(0.5, 0.5)
        .setDepth(15);
    }
    if (this.textures.exists(iconKey2)) {
      iconFrame2 = this.add
        .image(coords.mon[0], coords.mon[1], iconKey2)
        .setOrigin(0.5, 0.5)
        .setDepth(15)
        .setVisible(false);
    }

    // Pokeball
    const ballSprite = this.add
      .image(coords.ball[0], coords.ball[1], PARTY_KEY.pokeball)
      .setOrigin(0.5, 0.5)
      .setDepth(11)
      .setFrame(0);

    // HP bar fill
    const hpRatio = pokemon.maxHp > 0 ? pokemon.currentHp / pokemon.maxHp : 0;
    const barW = textLayout.hpBar.w;
    const fillW = Math.ceil(hpRatio * barW);
    const hpFill = this.add
      .rectangle(
        win.x + textLayout.hpBar.x,
        win.y + textLayout.hpBar.y,
        fillW,
        textLayout.hpBar.h,
        hpBarColor(pokemon.currentHp, pokemon.maxHp),
      )
      .setOrigin(0, 0)
      .setDepth(8);

    // Nickname
    const nickPrinter = new BitmapFontPrinter(this, this.clock, {
      x: win.x + textLayout.nickname.x,
      y: win.y + textLayout.nickname.y,
      maxWidth: 64,
      depth: 12,
      palette: "hud",
      size: "small",
    });
    nickPrinter.printInstant(pokemon.name);

    // Level
    const levelPrinter = new BitmapFontPrinter(this, this.clock, {
      x: win.x + textLayout.level.x,
      y: win.y + textLayout.level.y,
      maxWidth: 40,
      depth: 12,
      palette: "hud",
      size: "small",
    });
    levelPrinter.printInstant(`Lv${pokemon.level}`);

    // HP text
    const hpPrinter = new BitmapFontPrinter(this, this.clock, {
      x: win.x + textLayout.hp.x,
      y: win.y + textLayout.hp.y,
      maxWidth: 64,
      depth: 12,
      palette: "hud",
      size: "small",
    });
    hpPrinter.printInstant(`${pokemon.currentHp}/ ${pokemon.maxHp}`);

    // Gender symbol
    let genderDom: Phaser.GameObjects.DOMElement | null = null;
    if (pokemon.gender) {
      const span = document.createElement("span");
      span.textContent = pokemon.gender === "male" ? "♂" : "♀";
      span.style.fontFamily = "Emerald, monospace";
      span.style.fontSize = "8px";
      span.style.color =
        pokemon.gender === "male" ? GENDER_MALE_COLOR : GENDER_FEMALE_COLOR;
      genderDom = this.add
        .dom(
          win.x + textLayout.gender.x,
          win.y + textLayout.gender.y,
          span,
        )
        .setOrigin(0, 0)
        .setDepth(12);
    }

    // Held item indicator
    if (pokemon.heldItemId != null) {
      this.add
        .image(coords.item[0], coords.item[1], PARTY_KEY.holdIcons)
        .setOrigin(0.5, 0.5)
        .setDepth(15)
        .setFrame(0);
    }

    this.slots[index] = {
      chrome,
      iconFrame1,
      iconFrame2,
      ballSprite,
      hpFill,
      nickPrinter,
      levelPrinter,
      hpPrinter,
      genderDom,
      member: pokemon,
      isFainted,
      isEgg: false,
    };
  }

  /**
   * Build a slot for an Egg. Uses the no-HP chrome variant
   * (`slot_main_no_hp.bin` / `slot_wide_no_hp.bin` in the decomp),
   * shows "EGG" as the nickname, and omits level/HP/gender.
   */
  private buildEggSlot(index: number, egg: Egg): void {
    const isLeft = index === 0;
    const win = SLOT_WINDOWS[index];
    const coords = SLOT_SPRITE_COORDS[index];
    const textLayout = isLeft ? LEFT_COLUMN_TEXT : RIGHT_COLUMN_TEXT;

    // No-HP chrome
    const chromeKey = isLeft
      ? PARTY_KEY.slotMainNohp
      : PARTY_KEY.slotWideNohp;
    const chrome = this.add
      .image(win.x, win.y, chromeKey)
      .setOrigin(0, 0)
      .setDepth(5);

    // Egg icon
    const iconFrame1 = this.add
      .image(coords.mon[0], coords.mon[1], PARTY_KEY.eggIcon)
      .setOrigin(0.5, 0.5)
      .setDepth(15);
    let iconFrame2: Phaser.GameObjects.Image | null = null;
    if (this.textures.exists(PARTY_KEY.eggIcon2)) {
      iconFrame2 = this.add
        .image(coords.mon[0], coords.mon[1], PARTY_KEY.eggIcon2)
        .setOrigin(0.5, 0.5)
        .setDepth(15)
        .setVisible(false);
    }

    // Pokeball
    const ballSprite = this.add
      .image(coords.ball[0], coords.ball[1], PARTY_KEY.pokeball)
      .setOrigin(0.5, 0.5)
      .setDepth(11)
      .setFrame(0);

    // Nickname — "EGG"
    const nickPrinter = new BitmapFontPrinter(this, this.clock, {
      x: win.x + textLayout.nickname.x,
      y: win.y + textLayout.nickname.y,
      maxWidth: 64,
      depth: 12,
      palette: "hud",
      size: "small",
    });
    nickPrinter.printInstant("EGG");

    this.slots[index] = {
      chrome,
      iconFrame1,
      iconFrame2,
      ballSprite,
      hpFill: null,
      nickPrinter,
      levelPrinter: null,
      hpPrinter: null,
      genderDom: null,
      member: egg,
      isFainted: false,
      isEgg: true,
    };
  }

  private buildEmptySlot(index: number): void {
    if (index === 0) return; // slot 0 is never empty (party always has ≥1)
    const win = SLOT_WINDOWS[index];
    this.add
      .image(win.x, win.y, PARTY_KEY.slotWideEmpty)
      .setOrigin(0, 0)
      .setDepth(5);
  }

  // ── Chrome key lookup ───────────────────────────────────────────────────

  private chromeKeyFor(
    isLeft: boolean, isEgg: boolean, isFainted: boolean, selected: boolean,
  ): string {
    if (isLeft) {
      if (isEgg) return selected ? PARTY_KEY.slotMainNohpSel : PARTY_KEY.slotMainNohp;
      if (isFainted) return selected ? PARTY_KEY.slotMainFntSel : PARTY_KEY.slotMainFnt;
      return selected ? PARTY_KEY.slotMainSel : PARTY_KEY.slotMain;
    }
    if (isEgg) return selected ? PARTY_KEY.slotWideNohpSel : PARTY_KEY.slotWideNohp;
    if (isFainted) return selected ? PARTY_KEY.slotWideFntSel : PARTY_KEY.slotWideFnt;
    return selected ? PARTY_KEY.slotWideSel : PARTY_KEY.slotWide;
  }

  // ── Slot visual updates ────────────────────────────────────────────────

  private updateSlotVisual(slot: number, selected: boolean): void {
    if (slot === SLOT_CANCEL) {
      this.cancelChrome.setTexture(
        selected ? PARTY_KEY.cancelSel : PARTY_KEY.cancel,
      );
      return;
    }

    const state = this.slots[slot];
    if (!state) return;
    const isLeft = slot === 0;

    // Swap chrome texture based on slot type (left/wide), state (egg/fainted/normal)
    state.chrome.setTexture(
      this.chromeKeyFor(isLeft, state.isEgg, state.isFainted, selected),
    );

    // Pokeball frame: 0=closed, 1=open (selected)
    state.ballSprite.setFrame(selected ? 1 : 0);

    // Icon bounce animation
    if (selected) {
      this.startBounce(state);
    } else {
      this.stopBounce(state);
    }
  }

  private startBounce(state: SlotState): void {
    this.stopBounceTimer();
    this.bounceUp = true;
    // Show frame 1, hide frame 2 initially
    if (state.iconFrame1) state.iconFrame1.setVisible(true).setY(state.iconFrame1.y);
    if (state.iconFrame2) state.iconFrame2.setVisible(false);

    this.bounceTimer = this.time.addEvent({
      delay: BOUNCE_INTERVAL_MS,
      loop: true,
      callback: () => {
        this.bounceUp = !this.bounceUp;
        const dy = this.bounceUp ? BOUNCE_Y_UP : BOUNCE_Y_DOWN;

        // Toggle between icon frames
        if (state.iconFrame1 && state.iconFrame2) {
          if (this.bounceUp) {
            state.iconFrame1.setVisible(true);
            state.iconFrame2.setVisible(false);
          } else {
            state.iconFrame1.setVisible(false);
            state.iconFrame2.setVisible(true);
          }
        }

        // Apply bounce offset to the visible frame
        const visible = state.iconFrame1?.visible ? state.iconFrame1 : state.iconFrame2;
        if (visible) {
          const baseY = SLOT_SPRITE_COORDS[this.slots.indexOf(state)]?.mon[1] ?? visible.y;
          visible.setY(baseY + dy);
        }
      },
    });
  }

  private stopBounce(state: SlotState): void {
    this.stopBounceTimer();
    const slotIdx = this.slots.indexOf(state);
    const baseY = slotIdx >= 0 ? SLOT_SPRITE_COORDS[slotIdx].mon[1] : 0;
    // Reset to frame 1, static position
    if (state.iconFrame1) {
      state.iconFrame1.setVisible(true).setY(baseY);
    }
    if (state.iconFrame2) {
      state.iconFrame2.setVisible(false);
    }
  }

  private stopBounceTimer(): void {
    if (this.bounceTimer) {
      this.bounceTimer.destroy();
      this.bounceTimer = null;
    }
  }

  // ── Navigation (decomp UpdatePartySelectionSingleLayout) ───────────────

  private async runInputLoop(disabled: ReadonlySet<number>): Promise<void> {
    const partySize = this.partyData.party.length;

    for (;;) {
      const btn = await this.hudInput.waitForPress([
        "up", "down", "left", "right", "A", "B",
      ]);

      if (btn === "A") {
        if (this.currentSlot === SLOT_CANCEL) {
          this.emitCancel();
          return;
        }
        if (!disabled.has(this.currentSlot)) {
          this.emitSelect(this.currentSlot);
          return;
        }
        continue; // can't select disabled slot — beep/ignore
      }

      if (btn === "B") {
        this.emitCancel();
        return;
      }

      const prevSlot = this.currentSlot;
      switch (btn) {
        case "up":
          if (this.currentSlot === 0) {
            this.currentSlot = SLOT_CANCEL;
          } else if (this.currentSlot === SLOT_CANCEL) {
            this.currentSlot = partySize - 1;
          } else {
            this.currentSlot--;
          }
          break;

        case "down":
          if (this.currentSlot === SLOT_CANCEL) {
            this.currentSlot = 0;
          } else if (this.currentSlot === partySize - 1) {
            this.currentSlot = SLOT_CANCEL;
          } else {
            this.currentSlot++;
          }
          break;

        case "right":
          if (partySize > 1 && this.currentSlot === 0) {
            this.currentSlot =
              this.lastRightSlot === 0 ? 1 : this.lastRightSlot;
          }
          break;

        case "left":
          if (
            this.currentSlot > 0 &&
            this.currentSlot !== SLOT_CANCEL
          ) {
            this.lastRightSlot = this.currentSlot;
            this.currentSlot = 0;
          }
          break;
      }

      if (prevSlot !== this.currentSlot) {
        this.updateSlotVisual(prevSlot, false);
        this.updateSlotVisual(this.currentSlot, true);
      }
    }
  }

  // ── Result emission ────────────────────────────────────────────────────

  private emitSelect(index: number): void {
    this.events.emit("party:select", { index });
  }

  private emitCancel(): void {
    this.events.emit("party:cancel");
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  shutdown(): void {
    this.stopBounceTimer();
    for (const state of this.slots) {
      if (!state) continue;
      state.nickPrinter.destroy();
      state.levelPrinter?.destroy();
      state.hpPrinter?.destroy();
      state.genderDom?.destroy();
    }
    this.cancelText?.destroy();
    this.messagePrinter?.destroy();
    this.slots = [];
  }
}
