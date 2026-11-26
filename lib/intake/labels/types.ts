// Bag labels (Design B "Name banner"): ONE label per
// tier bag, whatever its card count. One pure layout engine (layout.ts) turns
// a bag into that page of positioned elements; the PDF route (pdf.ts) and
// the on-screen preview (components/intake/label-preview.tsx) both draw that
// same page, so the preview is what prints.
//
// Units: PDF points (72 per inch). Origin top-left, y grows downward; a
// text element's y is its baseline.

/** One card row on a bag label. */
export type LabelCard = {
  /** The card's number within the order (cards.card_seq): 1 → "01". */
  seq: number;
  /** Card ID, e.g. CD-2549-03 (cards.card_code). */
  code: string;
  name: string;
  set?: string | null;
  year?: string | null;
  number?: string | null;
  /** Not printed: labels have no per-card QR codes any more (kept so older callers still type-check). */
  qrUrl?: string | null;
  /**
   * Whether the row has the PG field ("PG" and a write-in line): the card's
   * pre-grade was paid for or submitted (pregradeOnLabel in lib/pregrade.ts:
   * cards.pregrade_selected, pregrade_submitted_at, or an order that paid for
   * more pre-grades than it has cards flagged). False or absent: no PG field,
   * the name and set have the whole row (a pregradeResult still shows it).
   */
  pregrade?: boolean;
  /**
   * The card's submitted pre-grade (cards.pregrade_result once
   * pregrade_submitted_at is set), printed on the row's PG line. Null or
   * absent: the PG line is left blank to write on.
   */
  pregradeResult?: string | null;
};

/** Another bag of the same order, for the label's "Also in this order" line. */
export type LabelOtherBag = {
  /** Bag ID, e.g. CD-2549-G. */
  bagCode: string;
  tierName: string;
  cardCount: number;
};

/** Everything a bag label shows. */
export type LabelBag = {
  /** Bag ID, e.g. CD-2549-P (tier_bags.bag_code). */
  bagCode: string;
  /** The tier as the admin names it, e.g. "Platinum". */
  tierName: string;
  orderNumber: string;
  customerName: string;
  /** New York date the cards arrived, YYYY-MM-DD (null: not recorded). */
  receivedOn: string | null;
  /** The bag's absolute due date, YYYY-MM-DD (null: not set yet). */
  dueDate: string | null;
  /** tier_bags.due_status: with no due date, 'missing_received_date' prints "SET DATE" instead of a dash. */
  dueStatus?: string | null;
  /** The cards in the bag, in card-number order. */
  cards: LabelCard[];
  /** What the bag's QR holds; defaults to labelQrData(bagCode). */
  qrUrl?: string | null;
  /** The order's other bags that hold cards, in tier order ("Also in this order"). */
  otherBags?: LabelOtherBag[];
};

/** The label stock loaded in the printer, and the printed content width. */
export type LabelStock = {
  /** Page (label) width and height, in points. */
  pageW: number;
  pageH: number;
  /** Width of the printed content, centered on the label, in points. */
  contentW: number;
};

export type FontRole = "display800" | "display900" | "body400" | "body700" | "body800" | "mono600";

/** ink: always black. accent: navy on screen, black when printed (Design B uses ink only). paper: white. */
export type LabelColor = "ink" | "accent" | "paper";

export type LabelText = {
  kind: "text";
  text: string;
  /** Left edge of the text and its baseline. */
  x: number;
  y: number;
  size: number;
  font: FontRole;
  color: LabelColor;
  /** Measured width (from the font's own metrics), letter spacing included. */
  width: number;
  /** Extra space after each character (letter-spacing), in points. */
  tracking: number;
};

export type LabelRect = {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: LabelColor;
  stroke?: LabelColor;
  /** The stroke is drawn inside the box: x..x+w stays the outer edge. */
  strokeWidth?: number;
  radius?: number;
};

export type LabelLine = {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  color: LabelColor;
  /** [dash, gap] in points, for a dashed rule. */
  dash?: [number, number];
};

export type LabelQr = {
  kind: "qr";
  /** What the code holds: the stable upper-case /q/<CODE> address. */
  data: string;
  x: number;
  y: number;
  /** Side of the square, modules only (the white around it is the quiet zone). */
  size: number;
  /** Words for screen readers on the preview. */
  alt: string;
};

export type LabelElement = LabelText | LabelRect | LabelLine | LabelQr;

export type LabelPage = {
  width: number;
  height: number;
  elements: LabelElement[];
  /**
   * The Card IDs this page lists, in order (for tests and the preview
   * caption). On a label that is out of room, fewer than the bag's cards:
   * the rest are behind "+N more: scan the QR".
   */
  cardCodes: string[];
};
