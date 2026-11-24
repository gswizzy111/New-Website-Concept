import { LABEL_LIMITS, PT, dueParts, fitName, floor2, printedWidth, qrSide, setParts, text } from "./layout";
import { labelQrData } from "./qr";
import { baselineIn, fitLine, printable, textWidth, truncate, wrapLines } from "./text";
import type { FontRole, LabelElement, LabelPage, LabelStock, LabelText } from "./types";

// Card stickers: ONE sticker per card (the owner's call, Nov 24 2026: a
// sticker on every card), made for the Katasymbol's 50 x 80 mm labels
// (portrait) and laid out the same way on the other stocks. Design B's
// language: a black banner with the customer's name huge and the due date in
// white; then the Card ID large in mono, the card's name, its set and
// number; and at the bottom ONE QR (never under 0.9 in) that opens the card,
// with the tier, the Bag ID and "SCAN TO MOVE OR FIND" beside it. Black only,
// nothing under 6.5 pt (203 dpi direct thermal).
//
// Sizes are set for the 50 x 80 mm label and scaled with the printed width;
// when the content stands taller than the label, everything steps down
// together (never below the minimums), then the set and the card name give
// up their second lines.

/** Everything a card sticker shows. */
export type LabelCardSticker = {
  /** Card ID, e.g. CD-2549-03 (cards.card_code): the QR opens it. */
  cardCode: string;
  cardName: string;
  set?: string | null;
  year?: string | null;
  number?: string | null;
  /** The tier as the admin names it ("Platinum"). */
  tierName: string;
  /** The card's tier bag, e.g. CD-2549-P (null: not in a bag yet). */
  bagCode: string | null;
  orderNumber: string;
  customerName: string;
  /** The bag's due date, YYYY-MM-DD (null: not set yet). */
  dueDate: string | null;
  /** tier_bags.due_status: with no due date, 'missing_received_date' prints "SET DATE". */
  dueStatus?: string | null;
  /** The bag's received day, YYYY-MM-DD: the due date shows its year when it differs. */
  receivedOn: string | null;
  /** What the QR holds; defaults to qrUrl(cardCode). */
  qrUrl?: string | null;
};

export const STICKER_LIMITS = {
  /** The card QR is never smaller than this. */
  minQrIn: 0.9,
} as const;

/** The inner width of a 50 x 80 mm sticker (printed width less the banner inset), in points: the sizes below are set for it. */
const REF_WI = 117.15;
/** The most the sizes grow on a wider label. */
const MAX_SCALE = 2.2;
/** White kept at the top and bottom of the label (die-cut labels shift about 1 mm). */
const PAD_Y = 0.08 * PT;

/** What the card QR holds: the stable upper-case /q/<CARD ID> address. */
export function stickerQrData(card: Pick<LabelCardSticker, "cardCode" | "qrUrl">): string {
  return card.qrUrl?.toUpperCase() || labelQrData(card.cardCode);
}

/** The sticker's frame: printed width centered, the banner across it, the words a little inside. */
export function stickerFrame(stock: LabelStock) {
  const W = printedWidth(stock);
  const x0 = (stock.pageW - W) / 2;
  const inset = Math.min(0.1 * PT, W * 0.04);
  return { W, x0, xi: x0 + inset, Wi: W - 2 * inset };
}

type Opts = { k: number; nameLines: number; setLines: number };

/** The set and number on up to `maxLines` lines: whole, else the set cut with "…" and the card number kept. */
function setLines(set: string, num: string, size: number, maxW: number, maxLines: number): string[] {
  const whole = [set, num].filter(Boolean).join(" ");
  if (!whole) return [];
  const lines = wrapLines(whole, "body400", size, maxW, maxLines);
  const cut = lines.join(" ").replace(/…$/, "") !== whole;
  if (!cut || !num) return lines;
  // Cut: keep the number at the end of the last line
  const head = wrapLines(set, "body400", size, maxW, maxLines);
  const last = head[head.length - 1].replace(/…$/, "");
  const room = maxW - textWidth(` ${num}`, "body400", size);
  if (room < 3 * size) return lines;
  head[head.length - 1] = `${truncate(`${last}…`.replace(/……$/, "…"), "body400", size, room)} ${num}`.replace(/ +/g, " ");
  if (textWidth(head[head.length - 1], "body400", size) > maxW) head[head.length - 1] = truncate(head[head.length - 1], "body400", size, maxW);
  return head;
}

/** Lay out one sticker at scale `k`; returns the page and how tall the content stands. */
function build(card: LabelCardSticker, stock: LabelStock, o: Opts): { elements: LabelElement[]; height: number } {
  const { W, x0, xi, Wi } = stickerFrame(stock);
  const { k } = o;
  const min = LABEL_LIMITS.minTextPt;
  const fs = (n: number) => Math.max(min, floor2(n * k));
  const els: LabelElement[] = [];

  // ── Banner: the name huge, then "DUE  MON DEC 7" ──
  const padTop = 4.5 * k;
  const padBottom = 4.5 * k;
  const nameMax = 24 * k;
  const nameText = printable(card.customerName.toUpperCase(), "display900") || "UNKNOWN";
  const name = fitName(nameText, "display900", Wi, nameMax, o.nameLines);
  const lh = 0.9;
  const above = name.lines.map((l) => (/[̀-̕]/.test(l.normalize("NFD")) ? 0.2 * name.size : 0));
  const nameH = name.lines.length * name.size * lh + above.reduce((a, b) => a + b, 0);

  const due = dueParts(card);
  const dueWord = "DUE";
  const dueWordSize = fs(7.5);
  const dueTrack = 0.9 * k;
  const dateText = due.weekday ? `${due.weekday} ${due.date}` : due.date;
  const yearText = due.year ? ` · ${due.year}` : "";
  const wordW = textWidth(dueWord, "body800", dueWordSize, dueTrack) + 4 * k;
  let dateSize = Math.min(17 * k, name.size * 0.9);
  const yearSize = () => Math.max(min, dateSize * 0.5);
  const rowW = () => wordW + textWidth(dateText, "display900", dateSize) + (yearText ? textWidth(yearText, "body800", yearSize()) : 0);
  if (rowW() > Wi) dateSize = Math.max(min, floor2(dateSize * ((Wi - wordW) / (rowW() - wordW))));
  const dueGap = 3.5 * k;
  const dueH = dateSize * 0.95;
  const bannerH = padTop + nameH + dueGap + dueH + padBottom;

  let y = PAD_Y;
  els.push({ kind: "rect", x: x0, y, w: W, h: bannerH, fill: "ink", radius: 3 * k });
  let ty = y + padTop;
  name.lines.forEach((line, i) => {
    ty += above[i];
    els.push(text(line, xi, baselineIn(ty, "display900", name.size, lh), name.size, "display900", "paper"));
    ty += name.size * lh;
  });
  ty += dueGap;
  const dueBase = baselineIn(ty, "display900", dateSize, 0.95);
  els.push(text(dueWord, xi, dueBase, dueWordSize, "body800", "paper", dueTrack));
  const dateEl = text(dateText, xi + wordW, dueBase, dateSize, "display900", "paper");
  els.push(dateEl);
  if (yearText) els.push(text(yearText, dateEl.x + dateEl.width, dueBase, yearSize(), "body800", "paper"));
  y += bannerH;

  // ── Card ID, name, set and number ──
  y += 5.5 * k;
  const id = fitLine(printable(card.cardCode, "mono600") || "NO CARD ID", "mono600", 18 * k, Wi, Math.min(9 * k, 12));
  els.push(text(id.text, xi, baselineIn(y, "mono600", id.size, 1.05), id.size, "mono600", "ink"));
  y += id.size * 1.05 + 2.5 * k;

  const cardName = printable(card.cardName, "body800") || "Unnamed card";
  let nameSize = fs(10);
  let nameLines = wrapLines(cardName, "body800", nameSize, Wi, o.nameLines >= 2 ? 2 : 1);
  // A name that doesn't fit its lines steps down a little before it is cut
  for (const step of [9, 8.5, 8]) {
    if (!nameLines[nameLines.length - 1].endsWith("…") || fs(step) >= nameSize) break;
    const smaller = wrapLines(cardName, "body800", fs(step), Wi, o.nameLines >= 2 ? 2 : 1);
    [nameSize, nameLines] = [fs(step), smaller];
  }
  for (const l of nameLines) {
    els.push(text(l, xi, baselineIn(y, "body800", nameSize, 1.15), nameSize, "body800", "ink"));
    y += nameSize * 1.15;
  }

  const parts = setParts(card);
  const setSize = fs(8);
  const sets = setLines(printable(parts.set, "body400"), printable(parts.num, "body400"), setSize, Wi, o.setLines);
  if (sets.length) y += 1 * k;
  for (const l of sets) {
    els.push(text(l, xi, baselineIn(y, "body400", setSize, 1.2), setSize, "body400", "ink"));
    y += setSize * 1.2;
  }
  const textBottom = y;

  // ── Bottom: rule, the QR at the left, tier, Bag ID and "SCAN TO MOVE OR FIND" at its right ──
  const data = stickerQrData(card);
  const qr = qrSide(data, STICKER_LIMITS.minQrIn * Math.max(1, k * 0.9));
  const rule = Math.max(LABEL_LIMITS.minRulePt, 1.5 * k);
  const ruleGap = Math.max(4 * k, 2 * qr.module);
  const colGap = Math.max(6 * k, 2.5 * qr.module);
  const colW = Wi - qr.size - colGap;
  const tier = fitLine(printable(card.tierName.toUpperCase(), "display900") || "NO TIER", "display900", 15 * k, colW, min, 0.2 * k);
  const bagWord = card.bagCode ? "BAG" : "NO BAG YET";
  const bagWordSize = fs(6.5);
  const bagTrack = 0.6 * k;
  const bagId = card.bagCode ? fitLine(printable(card.bagCode, "mono600"), "mono600", 10 * k, colW, min) : null;
  const scanSize = fs(6.5);
  const scanTrack = 0.35 * k;
  const scan = wrapLines("SCAN TO MOVE OR FIND", "body800", scanSize, colW, 3, scanTrack);
  type Line = { t: string; font: FontRole; size: number; lh: number; tr: number };
  const upper: Line[] = [
    { t: tier.text, font: "display900", size: tier.size, lh: 1.05, tr: 0.2 * k },
    { t: bagWord, font: "body800", size: bagWordSize, lh: 1.3, tr: bagTrack },
    ...(bagId ? [{ t: bagId.text, font: "mono600" as FontRole, size: bagId.size, lh: 1.1, tr: 0 }] : []),
  ];
  const lower: Line[] = scan.map((t) => ({ t, font: "body800" as FontRole, size: scanSize, lh: 1.25, tr: scanTrack }));
  const hOf = (ls: Line[]) => ls.reduce((a, l) => a + l.size * l.lh, 0);
  const colH = hOf(upper) + 2 * k + hOf(lower);
  const bodyH = Math.max(qr.size, colH);
  const bottomH = rule + ruleGap + bodyH;
  const bottomY = stock.pageH - PAD_Y - bottomH;

  els.push({ kind: "rect", x: xi, y: bottomY, w: Wi, h: rule, fill: "ink" });
  const top = bottomY + rule + ruleGap;
  els.push({ kind: "qr", data, x: xi, y: top + (bodyH - qr.size) / 2, size: qr.size, alt: `QR code for card ${card.cardCode}` });
  const tx = xi + qr.size + colGap;
  let cy = top + (bodyH - qr.size) / 2;
  const put = (l: Line) => {
    const el: LabelText = text(l.t, tx, baselineIn(cy, l.font, l.size, l.lh), l.size, l.font, "ink", l.tr);
    els.push(el);
    cy += l.size * l.lh;
  };
  upper.forEach(put);
  // "SCAN TO MOVE OR FIND" sits at the foot of the QR
  cy = Math.max(cy + 2 * k, top + (bodyH + qr.size) / 2 - hOf(lower));
  lower.forEach(put);

  // How tall the content stands: the text block, the least gap, the bottom block
  const height = textBottom + Math.max(4 * k, 3) + bottomH + PAD_Y;
  return { elements: els, height };
}

/** How the sticker was fitted (for tests). */
export type StickerFit = { scale: number; nameLines: number; setLines: number };

/**
 * One card's sticker: one page at the stock's size. The largest scale (up to
 * the printed width's) whose content fits the label; then fewer lines.
 */
export function planCardSticker(card: LabelCardSticker, stock: LabelStock): { page: LabelPage; fit: StickerFit } {
  const { Wi } = stickerFrame(stock);
  const kMax = Math.min(MAX_SCALE, Math.max(0.75, Wi / REF_WI));
  const tries: Opts[] = [];
  for (let k = kMax; k >= 0.7; k = floor2(k * 0.95)) tries.push({ k, nameLines: 2, setLines: 2 });
  for (const [nameLines, setLines] of [[2, 1], [1, 1]] as const) tries.push({ k: 0.7, nameLines, setLines });
  let pick = tries[tries.length - 1];
  let built = build(card, stock, pick);
  for (const o of tries) {
    const b = build(card, stock, o);
    if (b.height <= stock.pageH + 1e-6) {
      [pick, built] = [o, b];
      break;
    }
  }
  return {
    page: { width: stock.pageW, height: stock.pageH, elements: built.elements, cardCodes: [card.cardCode] },
    fit: { scale: pick.k, nameLines: pick.nameLines, setLines: pick.setLines },
  };
}

/** One card's sticker (always exactly one page). */
export function layoutCardSticker(card: LabelCardSticker, stock: LabelStock): LabelPage {
  return planCardSticker(card, stock).page;
}
