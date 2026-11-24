import type { LabelStock } from "./types";

// Label stocks the receiving labels can print on. The inch stocks are die-cut
// labels for the Labelife D520 (the owner uses 4x6 for bags; the printed
// content is narrower than the label, since bags are about 4in wide, and
// centered). 50 x 80 mm (portrait: 50 wide, 80 tall) is the Katasymbol
// (Supvan T50M Pro family) printed from its phone app: slot labels (CLAMP 07),
// shelf and place signs, and bag labels when the owner picks it. Both printers are 203 dpi
// direct thermal (black only); the Katasymbol's head prints 48 mm of the 50.

export const LABEL_STOCKS = {
  "4x6": { widthIn: 4, heightIn: 6, name: "4 × 6 in", printer: "Labelife", dpi: 203, minContentIn: 2 },
  "4x3": { widthIn: 4, heightIn: 3, name: "4 × 3 in", printer: "Labelife", dpi: 203, minContentIn: 2 },
  "3x5": { widthIn: 3, heightIn: 5, name: "3 × 5 in", printer: "Labelife", dpi: 203, minContentIn: 2 },
  "50x80mm": { widthIn: 50 / 25.4, heightIn: 80 / 25.4, name: "50 × 80 mm", printer: "Katasymbol", dpi: 203, minContentIn: 1.75 },
} as const;

export type LabelStockId = keyof typeof LABEL_STOCKS;

export const DEFAULT_STOCK: LabelStockId = "4x6";
/** Slot labels and place signs print on the Katasymbol's 50 x 80 mm labels unless a route is asked for another stock. */
export const PLACE_LABEL_STOCK: LabelStockId = "50x80mm";
export const DEFAULT_CONTENT_WIDTH_IN = 3.2;
/**
 * The narrowest print width any stock accepts (the 50 x 80 mm label; the inch
 * stocks keep 2 in, see stockWidthRange). Narrower than that and the card rows
 * can't keep their QR and readable text.
 */
export const MIN_CONTENT_WIDTH_IN = 1.75;

/** store_config keys the Receiving settings page writes. */
export const STOCK_CONFIG_KEY = "intake_label_stock";
export const CONTENT_WIDTH_CONFIG_KEY = "intake_label_content_width_in";

export function isStockId(v: unknown): v is LabelStockId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(LABEL_STOCKS, v);
}

/**
 * The print widths a stock takes, in inches (two decimals, never wider than
 * the label): 2 in up to the label's width on the inch stocks; on 50 x 80 mm
 * the whole label (1.75 to 1.96 in all print the same: 2.5 mm in from each side).
 */
export function stockWidthRange(stock: LabelStockId): { min: number; max: number } {
  const s = LABEL_STOCKS[stock];
  return { min: s.minContentIn, max: Math.floor(s.widthIn * 100 + 1e-9) / 100 };
}

/** Whether the stock's print width is the whole label (no width to pick). */
export function isFullWidthStock(stock: LabelStockId): boolean {
  return stock === "50x80mm";
}

/** The setting as saved, made safe: a known stock, a width the stock takes (stockWidthRange). */
export function normalizeLabelSettings(stock: unknown, contentWidthIn: unknown): { stock: LabelStockId; contentWidthIn: number } {
  const id = isStockId(stock) ? stock : DEFAULT_STOCK;
  const { min, max } = stockWidthRange(id);
  if (isFullWidthStock(id)) return { stock: id, contentWidthIn: max };
  const n = typeof contentWidthIn === "number" ? contentWidthIn : parseFloat(String(contentWidthIn ?? ""));
  const width = Number.isFinite(n) ? n : DEFAULT_CONTENT_WIDTH_IN;
  return { stock: id, contentWidthIn: Math.round(Math.min(max, Math.max(min, width)) * 100) / 100 };
}

/** Points for the layout engine. */
export function stockPoints(stock: LabelStockId, contentWidthIn: number): LabelStock {
  const s = LABEL_STOCKS[stock];
  return { pageW: s.widthIn * 72, pageH: s.heightIn * 72, contentW: Math.min(s.widthIn, contentWidthIn) * 72 };
}

/** A stock at its whole width (slot labels and place signs: nothing to center them on). */
export function fullWidthPoints(stock: LabelStockId): LabelStock {
  return stockPoints(stock, LABEL_STOCKS[stock].widthIn);
}

/**
 * A label page's size in printer dots (for a PNG the Katasymbol app imports).
 * A "203 dpi" head is 8 dots per mm (203.2 dpi), so 50 x 80 mm is 400 x 640.
 */
export function stockPixels(stock: LabelStockId, dpi: number = LABEL_STOCKS[stock].dpi): { width: number; height: number; dpi: number } {
  const s = LABEL_STOCKS[stock];
  const perIn = dpi === 203 ? 8 * 25.4 : dpi;
  return { width: Math.round(s.widthIn * perIn), height: Math.round(s.heightIn * perIn), dpi };
}
