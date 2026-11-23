import type { LabelStock } from "./types";

// Label stocks the receiving labels can print on (Labelife D520, die-cut).
// The owner uses 4x6; the printed content is narrower than the label (bags
// are about 4in wide, the content about 80% of that) and centered.

export const LABEL_STOCKS = {
  "4x6": { widthIn: 4, heightIn: 6, name: "4 × 6 in" },
  "4x3": { widthIn: 4, heightIn: 3, name: "4 × 3 in" },
  "3x5": { widthIn: 3, heightIn: 5, name: "3 × 5 in" },
} as const;

export type LabelStockId = keyof typeof LABEL_STOCKS;

export const DEFAULT_STOCK: LabelStockId = "4x6";
export const DEFAULT_CONTENT_WIDTH_IN = 3.2;
/** Narrower than this and the card rows can't keep their QR and readable text. */
export const MIN_CONTENT_WIDTH_IN = 2;

/** store_config keys the Receiving settings page writes. */
export const STOCK_CONFIG_KEY = "intake_label_stock";
export const CONTENT_WIDTH_CONFIG_KEY = "intake_label_content_width_in";

export function isStockId(v: unknown): v is LabelStockId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(LABEL_STOCKS, v);
}

/** The setting as saved, made safe: a known stock, a width between the minimum and the stock's width. */
export function normalizeLabelSettings(stock: unknown, contentWidthIn: unknown): { stock: LabelStockId; contentWidthIn: number } {
  const id = isStockId(stock) ? stock : DEFAULT_STOCK;
  const max = LABEL_STOCKS[id].widthIn;
  const n = typeof contentWidthIn === "number" ? contentWidthIn : parseFloat(String(contentWidthIn ?? ""));
  const width = Number.isFinite(n) ? n : DEFAULT_CONTENT_WIDTH_IN;
  return { stock: id, contentWidthIn: Math.round(Math.min(max, Math.max(MIN_CONTENT_WIDTH_IN, width)) * 100) / 100 };
}

/** Points for the layout engine. */
export function stockPoints(stock: LabelStockId, contentWidthIn: number): LabelStock {
  const s = LABEL_STOCKS[stock];
  return { pageW: s.widthIn * 72, pageH: s.heightIn * 72, contentW: Math.min(s.widthIn, contentWidthIn) * 72 };
}
