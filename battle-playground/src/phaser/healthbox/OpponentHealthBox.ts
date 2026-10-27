/**
 * Opponent-side healthbox. Uses the 128x32 chrome — no HP fraction text
 * and no EXP bar. Everything it needs is on the base class already.
 */
import * as Phaser from "phaser";
import type { Clock } from "../../runtime/clock";
import { HealthBox, type HealthBoxConfig } from "./HealthBox";
import {
  OPPONENT_HEALTHBOX_LAYOUT,
  type HealthBoxLayout,
} from "./layouts";

export interface OpponentHealthBoxConfig extends Omit<HealthBoxConfig, "layout"> {
  layout?: HealthBoxLayout;
}

export class OpponentHealthBox extends HealthBox {
  constructor(scene: Phaser.Scene, clock: Clock, cfg: OpponentHealthBoxConfig) {
    super(scene, clock, { ...cfg, layout: cfg.layout ?? OPPONENT_HEALTHBOX_LAYOUT });
    this.paintInitial();
  }
}
