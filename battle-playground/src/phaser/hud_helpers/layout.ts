import type { PrinterPalette, PrinterSize } from "../BitmapFont";

export interface PanelCell {
  id: string;
  x: number;
  y: number;
  maxWidth: number;
  size?: PrinterSize;
  label?: string;
}

export interface PanelLayout {
  chromeKey: string;
  palette?: PrinterPalette;
  cells: readonly PanelCell[];
}

export interface MenuLayout extends PanelLayout {
  grid: readonly (readonly (string | null)[])[];
  defaultInitialId: string;
}
