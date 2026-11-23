import { labelQrData, qrMatrix } from "./qr";
import { baselineIn, fitLine, printable, textWidth, truncate, wrapLines } from "./text";
import type { FontRole, LabelBag, LabelCard, LabelColor, LabelElement, LabelPage, LabelStock, LabelText } from "./types";

// The layout engine for Design A "Ledger" (the owner's pick): a pure function
// from a bag and the label stock to pages of positioned elements. Sizes come
// from the approved mock (label-design-A.html, 384px = 4in, 16px padding),
// scaled to the content width, but never below what a direct thermal printer
// prints legibly: text 7pt, rules 1pt, card QR 0.55in (0.02in modules).
// Cards that don't fit go on continuation labels with the same Bag ID and
// the bag QR on every label.

export const PT = 72;
export const LABEL_LIMITS = {
  minTextPt: 7,
  minRulePt: 1,
  minCardQrIn: 0.55,
  cardQrIn: 0.58,
  bagQrIn: 1,
  compactBagQrIn: 0.75,
  moduleIn: 0.02,
} as const;

/** The mock's content width in its own px (384px label, 16px padding). */
const REF_CONTENT_PX = 352;
/** Keep at least this much white at each side of the label (printer margin). */
const SIDE_MIN = 0.06 * PT;
/** Labels shorter than this use the compact spacing. */
const COMPACT_BELOW = 4.5 * PT;

type Density = "regular" | "compact";

/** Sizes in points for one content width and density. */
function sizes(W: number, density: Density) {
  const k = W / REF_CONTENT_PX;
  const compact = density === "compact";
  const sp = (px: number) => px * k * (compact ? 0.55 : 1);
  // Type: px of the mock scaled; big type shrinks a bit more in compact mode
  const fs = (px: number, compactScale = 1) => Math.max(LABEL_LIMITS.minTextPt, px * k * (compact ? compactScale : 1));
  const rule = (px: number) => Math.max(LABEL_LIMITS.minRulePt, px * k);
  const tr = (px: number) => px * k;
  return { k, sp, fs, rule, tr, compact };
}

type S = ReturnType<typeof sizes>;

/** A block measured first and drawn once its place is known. */
type Block = { h: number; draw: (y: number) => LabelElement[] };

function text(t: string, x: number, y: number, size: number, font: FontRole, color: LabelColor, tracking = 0): LabelText {
  return { kind: "text", text: t, x, y, size, font, color, width: textWidth(t, font, size, tracking), tracking };
}

// ── Dates ────────────────────────────────────────────────────────────────────

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseDay(day: string | null): { y: number; m: number; d: number; wd: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? "");
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "Sun, Nov 15, 2026" */
export function receivedText(day: string | null): string {
  const p = parseDay(day);
  return p ? `${DAYS[p.wd]}, ${MONTHS[p.m - 1]} ${p.d}, ${p.y}` : "Not recorded";
}

/** "MON · DEC 7, 2026" */
export function dueText(day: string | null): string {
  const p = parseDay(day);
  return p ? `${DAYS[p.wd]} · ${MONTHS[p.m - 1]} ${p.d}, ${p.y}`.toUpperCase() : "NOT SET";
}

/** "DEC 7" */
export function dueShortText(day: string | null): string {
  const p = parseDay(day);
  return p ? `${MONTHS[p.m - 1]} ${p.d}`.toUpperCase() : "NOT SET";
}

export function cardCountText(n: number): string {
  return `${n} CARD${n === 1 ? "" : "S"}`;
}

function scanText(n: number): string {
  if (n === 0) return "Scan for the bag, its cards and the due date";
  if (n === 1) return "Scan for this card, its stage and the due date";
  return `Scan for all ${n} cards, their stages and the due date`;
}

/** "01", "02" … "100": the card's number within the order. */
export function seqText(seq: number): string {
  return String(seq).padStart(2, "0");
}

function setLine(c: LabelCard): string {
  const set = [c.year, c.set].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  const num = (c.number ?? "").trim().replace(/^#\s*/, "");
  return [set, num ? `#${num}` : ""].filter(Boolean).join(" · ");
}

// ── QR sizes ─────────────────────────────────────────────────────────────────

function qrSide(data: string, minIn: number): { size: number; module: number } {
  const n = qrMatrix(data).size;
  const size = Math.max(minIn * PT, n * LABEL_LIMITS.moduleIn * PT);
  return { size, module: size / n };
}

// ── Blocks ───────────────────────────────────────────────────────────────────

/** Wordmark + "RESTORATION BAG" on the left, the tier block (navy) with the card count on the right. */
function mainHeader(s: S, x0: number, W: number, bag: LabelBag): Block {
  const tierName = printable(bag.tierName.toUpperCase(), "display800") || "NO TIER";
  const count = cardCountText(bag.cards.length);
  const padX = s.sp(12);
  const padY = s.sp(6);
  const countSize = s.fs(11);
  const countTrack = s.tr(1.2);
  const tierFit = fitLine(tierName, "display800", s.fs(25, 0.72), W * 0.5 - 2 * padX, 10, s.tr(1));
  const innerW = Math.max(textWidth(tierFit.text, "display800", tierFit.size, s.tr(1)), textWidth(count, "body800", countSize, countTrack));
  const blockW = innerW + 2 * padX;
  const blockH = padY * 2 + tierFit.size + s.sp(3) + countSize * 1.2;

  const leftW = W - blockW - s.sp(10);
  const wm = fitLine("THE CARD DOC", "display900", s.fs(27, 0.72), leftW, 10, s.tr(0.5));
  const subSize = s.fs(10);
  const sub = fitLine("RESTORATION BAG", "body800", subSize, leftW, LABEL_LIMITS.minTextPt, s.tr(1.6));
  const leftH = wm.size + s.sp(4) + sub.size * 1.2;
  const h = Math.max(blockH, leftH);

  return {
    h,
    draw: (y) => {
      const ly = y + (h - leftH) / 2;
      const bx = x0 + W - blockW;
      const by = y + (h - blockH) / 2;
      const right = bx + blockW - padX;
      const tier = text(tierFit.text, 0, baselineIn(by + padY, "display800", tierFit.size, 1), tierFit.size, "display800", "paper", s.tr(1));
      tier.x = right - tier.width;
      const cnt = text(count, 0, baselineIn(by + padY + tierFit.size + s.sp(3), "body800", countSize, 1.2), countSize, "body800", "paper", countTrack);
      cnt.x = right - cnt.width;
      return [
        text(wm.text, x0, baselineIn(ly, "display900", wm.size, 1), wm.size, "display900", "ink", s.tr(0.5)),
        text(sub.text, x0, baselineIn(ly + wm.size + s.sp(4), "body800", sub.size, 1.2), sub.size, "body800", "ink", s.tr(1.6)),
        { kind: "rect", x: bx, y: by, w: blockW, h: blockH, fill: "accent", radius: 4 * s.k },
        tier,
        cnt,
      ];
    },
  };
}

/** Continuation labels: wordmark + tier, then Bag ID and "CONTINUED · LABEL n OF N". */
function contHeader(s: S, x0: number, W: number, bag: LabelBag, labelNo: () => [number, number]): Block {
  const tierName = printable(bag.tierName.toUpperCase(), "display800") || "NO TIER";
  const padX = s.sp(10);
  const padY = s.sp(4);
  const tierFit = fitLine(tierName, "display800", s.fs(18, 0.8), W * 0.5 - 2 * padX, 9, s.tr(1));
  const blockW = textWidth(tierFit.text, "display800", tierFit.size, s.tr(1)) + 2 * padX;
  const blockH = tierFit.size + 2 * padY;
  const wm = fitLine("THE CARD DOC", "display900", s.fs(20, 0.8), W - blockW - s.sp(10), 9, s.tr(0.5));
  const row1 = Math.max(blockH, wm.size);
  const idSize = s.fs(13, 0.85);
  const noteSize = s.fs(9);
  const row2 = Math.max(idSize * 1.25, noteSize * 1.2);
  const gap = s.sp(5);
  const h = row1 + gap + row2;
  return {
    h,
    draw: (y) => {
      const [n, N] = labelNo();
      const note = `CONTINUED · LABEL ${n} OF ${N}`;
      const noteTrack = s.tr(1.3);
      const noteEl = text(note, 0, baselineIn(y + row1 + gap + (row2 - noteSize * 1.2) / 2, "body800", noteSize, 1.2), noteSize, "body800", "ink", noteTrack);
      noteEl.x = x0 + W - noteEl.width;
      const idMax = W - noteEl.width - s.sp(10);
      const id = fitLine(printable(bag.bagCode, "mono600"), "mono600", idSize, idMax, LABEL_LIMITS.minTextPt);
      const bx = x0 + W - blockW;
      const by = y + (row1 - blockH) / 2;
      const tier = text(tierFit.text, 0, baselineIn(by + padY, "display800", tierFit.size, 1), tierFit.size, "display800", "paper", s.tr(1));
      tier.x = bx + blockW - padX - tier.width;
      return [
        text(wm.text, x0, baselineIn(y + (row1 - wm.size) / 2, "display900", wm.size, 1), wm.size, "display900", "ink", s.tr(0.5)),
        { kind: "rect", x: bx, y: by, w: blockW, h: blockH, fill: "accent", radius: 4 * s.k },
        tier,
        text(id.text, x0, baselineIn(y + row1 + gap + (row2 - id.size * 1.25) / 2, "mono600", id.size, 1.25), id.size, "mono600", "ink"),
        noteEl,
      ];
    },
  };
}

/** The navy rule under the header. */
function topRule(s: S, x0: number, W: number): Block {
  const w = s.rule(2);
  return { h: w, draw: (y) => [{ kind: "rect", x: x0, y, w: W, h: w, fill: "accent" }] };
}

/** Customer / Order / Bag ID / Received, two columns. */
function infoGrid(s: S, x0: number, W: number, bag: LabelBag): Block {
  const gapX = 12 * s.k;
  const gapY = s.sp(8);
  const colW = (W - gapX) / 2;
  const labelSize = s.fs(9);
  const labelTrack = s.tr(1.3);
  const valueSize = s.fs(15, 0.8);
  const cells: [string, string, FontRole][] = [
    ["CUSTOMER", printable(bag.customerName, "body700") || "Unknown", "body700"],
    ["ORDER", printable(bag.orderNumber, "mono600"), "mono600"],
    ["BAG ID", printable(bag.bagCode, "mono600"), "mono600"],
    ["RECEIVED", receivedText(bag.receivedOn), "body700"],
  ];
  const cellH = labelSize * 1.2 + valueSize * 1.25;
  return {
    h: cellH * 2 + gapY,
    draw: (y) =>
      cells.flatMap(([label, value, font], i) => {
        const cx = x0 + (i % 2) * (colW + gapX);
        const cy = y + Math.floor(i / 2) * (cellH + gapY);
        const v = fitLine(value, font, valueSize, colW, 7.5);
        return [
          text(label, cx, baselineIn(cy, "body800", labelSize, 1.2), labelSize, "body800", "ink", labelTrack),
          text(v.text, cx, baselineIn(cy + labelSize * 1.2 + (valueSize * 1.25 - v.size * 1.25) / 2, font, v.size, 1.25), v.size, font, "ink"),
        ];
      }),
  };
}

/** The DUE box with the absolute due date, large. */
function dueBox(s: S, x0: number, W: number, bag: LabelBag): Block {
  const border = s.rule(2);
  const padX = s.sp(10);
  const padY = s.sp(6);
  const labelSize = s.fs(12);
  const labelTrack = s.tr(2.5);
  const labelW = textWidth("DUE", "body800", labelSize, labelTrack);
  const due = fitLine(dueText(bag.dueDate), "display900", s.fs(33, 0.7), W - 2 * border - 2 * padX - labelW - s.sp(10), 12);
  const inner = Math.max(due.size, labelSize * 1.2);
  const h = 2 * border + 2 * padY + inner;
  return {
    h,
    draw: (y) => {
      const top = y + border + padY;
      const dueEl = text(due.text, 0, baselineIn(top + (inner - due.size) / 2, "display900", due.size, 1), due.size, "display900", "ink");
      dueEl.x = x0 + W - border - padX - dueEl.width;
      return [
        { kind: "rect", x: x0, y, w: W, h, stroke: "accent", strokeWidth: border, radius: 4 * s.k },
        text("DUE", x0 + border + padX, baselineIn(top + (inner - labelSize * 1.2) / 2, "body800", labelSize, 1.2), labelSize, "body800", "ink", labelTrack),
        dueEl,
      ];
    },
  };
}

/** "CARDS IN THIS BAG ……… SCAN A CARD" over a rule. */
function cardsHeader(s: S, x0: number, W: number): Block {
  const size = s.fs(9);
  const track = s.tr(1.3);
  const pad = s.sp(4);
  const rule = s.rule(1.5);
  const h = size * 1.2 + pad + rule;
  return {
    h,
    draw: (y) => {
      const base = baselineIn(y, "body800", size, 1.2);
      const right = text("SCAN A CARD", 0, base, size, "body800", "ink", track);
      right.x = x0 + W - right.width;
      return [
        text("CARDS IN THIS BAG", x0, base, size, "body800", "ink", track),
        right,
        { kind: "rect", x: x0, y: y + size * 1.2 + pad, w: W, h: rule, fill: "ink" },
      ];
    },
  };
}

/** One card: its number within the order, name, set · number, Card ID, its QR at the right. */
function cardRow(s: S, x0: number, W: number, c: LabelCard, numW: number): Block {
  const data = c.qrUrl?.toUpperCase() || labelQrData(c.code);
  const qr = qrSide(data, LABEL_LIMITS.cardQrIn);
  const gap = Math.max(s.sp(10), 2 * qr.module);
  const pad = Math.max(s.sp(5), 2 * qr.module);
  const rule = s.rule(1);
  const textW = W - numW - gap - gap - qr.size;
  const nameSize = s.fs(14, 0.9);
  const smallSize = s.fs(11);
  const name = printable(c.name, "body700") || "Unnamed card";
  const nameLines = wrapLines(name, "body700", nameSize, textW, 2);
  const set = setLine(c);
  const setText = set ? truncate(printable(set, "body400"), "body400", smallSize, textW) : "";
  const code = fitLine(printable(c.code, "mono600"), "mono600", smallSize, textW, LABEL_LIMITS.minTextPt);
  const numSize = s.fs(22, 0.8);
  const textH = nameLines.length * nameSize * 1.2 + (setText ? smallSize * 1.35 : 0) + code.size * 1.3;
  const inner = Math.max(qr.size, textH, numSize);
  const h = pad * 2 + inner + rule;
  return {
    h,
    draw: (y) => {
      const mid = y + pad + inner / 2;
      const out: LabelElement[] = [];
      out.push(text(seqText(c.seq), x0, baselineIn(mid - numSize * 0.6, "display800", numSize, 1.2), numSize, "display800", "accent"));
      let ty = mid - textH / 2;
      const tx = x0 + numW + gap;
      for (const line of nameLines) {
        out.push(text(line, tx, baselineIn(ty, "body700", nameSize, 1.2), nameSize, "body700", "ink"));
        ty += nameSize * 1.2;
      }
      if (setText) {
        out.push(text(setText, tx, baselineIn(ty, "body400", smallSize, 1.35), smallSize, "body400", "ink"));
        ty += smallSize * 1.35;
      }
      out.push(text(code.text, tx, baselineIn(ty, "mono600", code.size, 1.3), code.size, "mono600", "ink"));
      out.push({ kind: "qr", data, x: x0 + W - qr.size, y: mid - qr.size / 2, size: qr.size, alt: `QR code for card ${c.code}` });
      out.push({ kind: "rect", x: x0, y: y + h - rule, w: W, h: rule, fill: "ink" });
      return out;
    },
  };
}

/**
 * Dashed rule, the bag QR with the Bag ID under it, "WHOLE BAG", the scan
 * line and "Label n of N". On short (compact) stock the Bag ID moves next to
 * the QR, to leave room for card rows.
 */
function footer(s: S, x0: number, W: number, bag: LabelBag, labelNo: () => [number, number]): Block {
  const data = bag.qrUrl?.toUpperCase() || labelQrData(bag.bagCode);
  const qr = qrSide(data, s.compact ? LABEL_LIMITS.compactBagQrIn : LABEL_LIMITS.bagQrIn);
  const dash = s.rule(2);
  const padTop = Math.max(s.sp(10), 2 * qr.module);
  const idSize = s.fs(12);
  const idUnder = !s.compact;
  const id = fitLine(printable(bag.bagCode, "mono600"), "mono600", idSize, idUnder ? Math.max(qr.size, W * 0.45) : W - qr.size - 2 * qr.module, LABEL_LIMITS.minTextPt);
  const idGap = s.sp(4);
  const qrColW = idUnder ? Math.max(qr.size, textWidth(id.text, "mono600", id.size)) : qr.size;
  const qrColH = idUnder ? qr.size + idGap + id.size * 1.25 : qr.size;
  const colGap = Math.max(s.sp(14), 2 * qr.module);
  const textW = W - qrColW - colGap;
  const kickerSize = s.fs(9);
  const scanSize = s.fs(21, 0.75);
  const noSize = s.fs(11);
  const scanLines = wrapLines(scanText(bag.cards.length), "display800", scanSize, textW, s.compact ? 2 : 4);
  const lineGap = s.sp(4);
  const textH =
    (idUnder ? 0 : id.size * 1.25 + lineGap) + kickerSize * 1.2 + lineGap + scanLines.length * scanSize * 1.05 + lineGap + noSize * 1.2;
  const body = Math.max(qrColH, textH);
  const h = dash + padTop + body;
  return {
    h,
    draw: (y) => {
      const [n, N] = labelNo();
      const top = y + dash + padTop;
      const qx = x0 + (qrColW - qr.size) / 2;
      const qy = top + (body - qrColH) / 2;
      const tx = x0 + qrColW + colGap;
      let ty = top + (body - textH) / 2;
      const out: LabelElement[] = [
        { kind: "line", x1: x0, y1: y + dash / 2, x2: x0 + W, y2: y + dash / 2, width: dash, color: "ink", dash: [dash * 3, dash * 2] },
        { kind: "qr", data, x: qx, y: qy, size: qr.size, alt: `QR code for bag ${bag.bagCode}` },
      ];
      if (idUnder) {
        const idEl = text(id.text, 0, baselineIn(qy + qr.size + idGap, "mono600", id.size, 1.25), id.size, "mono600", "ink");
        idEl.x = x0 + (qrColW - idEl.width) / 2;
        out.push(idEl);
      } else {
        out.push(text(id.text, tx, baselineIn(ty, "mono600", id.size, 1.25), id.size, "mono600", "ink"));
        ty += id.size * 1.25 + lineGap;
      }
      out.push(text("WHOLE BAG", tx, baselineIn(ty, "body800", kickerSize, 1.2), kickerSize, "body800", "ink", s.tr(1.3)));
      ty += kickerSize * 1.2 + lineGap;
      for (const line of scanLines) {
        out.push(text(line, tx, baselineIn(ty, "display800", scanSize, 1.05), scanSize, "display800", "ink"));
        ty += scanSize * 1.05;
      }
      ty += lineGap;
      out.push(text(`Label ${n} of ${N}`, tx, baselineIn(ty, "body700", noSize, 1.2), noSize, "body700", "ink"));
      return out;
    },
  };
}

// ── Pages ────────────────────────────────────────────────────────────────────

/** The width the label content actually prints at: the setting, less a printer margin at each side. */
export function printedWidth(stock: LabelStock): number {
  return Math.min(stock.contentW, stock.pageW - 2 * SIDE_MIN);
}

function frame(stock: LabelStock) {
  const W = printedWidth(stock);
  const x0 = (stock.pageW - W) / 2;
  const density: Density = stock.pageH < COMPACT_BELOW ? "compact" : "regular";
  return { W, x0, s: sizes(W, density) };
}

/**
 * The bag's labels: one page per label at the stock's size. The first label
 * has the full header, info grid and due box; the rest repeat a compact
 * header. Every label ends with the bag QR and "Label n of N".
 */
export function layoutBagLabels(bag: LabelBag, stock: LabelStock): LabelPage[] {
  const { W, x0, s } = frame(stock);
  const cards = [...bag.cards].sort((a, b) => a.seq - b.seq);
  const numSize = s.fs(22, 0.8);
  const numW = Math.max(26 * s.k, ...cards.map((c) => textWidth(seqText(c.seq), "display800", numSize)));
  const rows = cards.map((c) => cardRow(s, x0, W, c, numW));

  let current: [number, number] = [1, 1];
  const labelNo = () => current;
  const padY = Math.max(s.sp(14), (s.compact ? 0.07 : 0.08) * PT);
  const gap = s.sp(10);
  const head = [mainHeader(s, x0, W, bag), topRule(s, x0, W), infoGrid(s, x0, W, bag), dueBox(s, x0, W, bag)];
  const headH = head.reduce((sum, b) => sum + b.h, 0) + gap * head.length;
  const cont = [contHeader(s, x0, W, bag, labelNo), topRule(s, x0, W)];
  const contH = cont.reduce((sum, b) => sum + b.h, 0) + gap * cont.length;
  const cardsHead = cardsHeader(s, x0, W);
  const foot = footer(s, x0, W, bag, labelNo);
  const room = (top: number) => stock.pageH - 2 * padY - top - cardsHead.h - gap - foot.h;

  // Which rows go on which label
  const groups: number[][] = [[]];
  let left = room(headH);
  rows.forEach((r, i) => {
    const g = groups[groups.length - 1];
    if (r.h <= left) {
      g.push(i);
      left -= r.h;
      return;
    }
    groups.push([i]);
    left = room(contH) - r.h;
  });

  return groups.map((g, p) => {
    current = [p + 1, groups.length];
    const els: LabelElement[] = [];
    let y = padY;
    for (const b of p === 0 ? head : cont) {
      els.push(...b.draw(y));
      y += b.h + gap;
    }
    if (g.length) {
      els.push(...cardsHead.draw(y));
      y += cardsHead.h;
      for (const i of g) {
        els.push(...rows[i].draw(y));
        y += rows[i].h;
      }
    }
    els.push(...foot.draw(stock.pageH - padY - foot.h));
    return { width: stock.pageW, height: stock.pageH, elements: els, cardCodes: g.map((i) => cards[i].code) };
  });
}

// ── Reusable tag ─────────────────────────────────────────────────────────────

export const TAG_SIZE_IN = { w: 2.5, h: 1.5 } as const;

/**
 * The reusable bag tag (Design A tag, 2.5 × 1.5 in at the mock's own scale):
 * bag QR, tier, Bag ID, customer · card count, due date and an 8-box STAGE
 * track, centered on the label with cut marks at its corners.
 */
export function layoutBagTag(bag: LabelBag, stock: LabelStock, stageCount = 8): LabelPage {
  const k = 0.75; // the mock is drawn at 96px per inch
  const fs = (px: number) => Math.max(LABEL_LIMITS.minTextPt, px * k);
  const tw = Math.min(TAG_SIZE_IN.w * PT, stock.pageW - 2 * SIDE_MIN - 0.3 * PT);
  const th = TAG_SIZE_IN.h * PT;
  const x = (stock.pageW - tw) / 2;
  const y = Math.max(0.35 * PT, (stock.pageH - th) / 2);
  const border = Math.max(LABEL_LIMITS.minRulePt, 2 * k);
  const pad = 8 * k;
  const els: LabelElement[] = [{ kind: "rect", x, y, w: tw, h: th, stroke: "accent", strokeWidth: border, radius: 10 * k }];

  const data = bag.qrUrl?.toUpperCase() || labelQrData(bag.bagCode);
  const qr = qrSide(data, (80 * k) / PT);
  const ix = x + border + pad;
  const iy = y + border + pad;
  const innerW = tw - 2 * (border + pad);
  els.push({ kind: "qr", data, x: ix, y: iy, size: qr.size, alt: `QR code for bag ${bag.bagCode}` });

  // Right of the QR
  const cx = ix + qr.size + 8 * k;
  const colW = innerW - qr.size - 8 * k;
  const tier = fitLine(printable(bag.tierName.toUpperCase(), "display900") || "NO TIER", "display900", fs(22), colW, 10);
  const idFit = fitLine(printable(bag.bagCode, "mono600"), "mono600", fs(13), colW, LABEL_LIMITS.minTextPt);
  const who = `${printable(bag.customerName, "body700") || "Unknown"} · ${bag.cards.length} card${bag.cards.length === 1 ? "" : "s"}`;
  const whoFit = fitLine(who, "body700", fs(11), colW, LABEL_LIMITS.minTextPt);
  const due = fitLine(`DUE ${dueShortText(bag.dueDate)}`, "body800", fs(11), colW, LABEL_LIMITS.minTextPt);
  const lines: [string, FontRole, number, number, LabelColor][] = [
    [tier.text, "display900", tier.size, 1, "accent"],
    [idFit.text, "mono600", idFit.size, 1.25, "ink"],
    [whoFit.text, "body700", whoFit.size, 1.25, "ink"],
    [due.text, "body800", due.size, 1.25, "ink"],
  ];
  const lineGap = 2 * k;
  const colH = lines.reduce((sum, l) => sum + l[2] * l[3], 0) + lineGap * (lines.length - 1);
  let ty = iy + (qr.size - colH) / 2;
  for (const [t, font, size, lh, color] of lines) {
    els.push(text(t, cx, baselineIn(ty, font, size, lh), size, font, color));
    ty += size * lh + lineGap;
  }

  // STAGE track: 8 numbered boxes
  const trackTop = iy + qr.size + 6 * k;
  const boxH = 22 * k;
  const stageSize = fs(8);
  const stageTrack = 1 * k;
  const stageW = Math.max(30 * k, textWidth("STAGE", "body800", stageSize, stageTrack) + 3 * k);
  els.push(text("STAGE", ix, baselineIn(trackTop + (boxH - stageSize * 1.2) / 2, "body800", stageSize, 1.2), stageSize, "body800", "ink", stageTrack));
  const gap = 3 * k;
  const bx0 = ix + stageW + 4 * k;
  const boxW = (ix + innerW - bx0 - gap * (stageCount - 1)) / stageCount;
  const boxBorder = Math.max(LABEL_LIMITS.minRulePt, 1.5 * k);
  const numSize = fs(11);
  for (let i = 0; i < stageCount; i++) {
    const bx = bx0 + i * (boxW + gap);
    els.push({ kind: "rect", x: bx, y: trackTop, w: boxW, h: boxH, stroke: "ink", strokeWidth: boxBorder, radius: 3 * k });
    const n = text(String(i + 1), 0, baselineIn(trackTop + (boxH - numSize * 1.2) / 2, "body800", numSize, 1.2), numSize, "body800", "ink");
    n.x = bx + (boxW - n.width) / 2;
    els.push(n);
  }

  // Cut marks just outside each corner
  const off = 0.05 * PT;
  const len = 0.15 * PT;
  const mark = LABEL_LIMITS.minRulePt;
  for (const [cx2, cy2, dx, dy] of [
    [x, y, -1, -1],
    [x + tw, y, 1, -1],
    [x, y + th, -1, 1],
    [x + tw, y + th, 1, 1],
  ] as const) {
    els.push({ kind: "line", x1: cx2 + dx * off, y1: cy2, x2: cx2 + dx * (off + len), y2: cy2, width: mark, color: "ink" });
    els.push({ kind: "line", x1: cx2, y1: cy2 + dy * off, x2: cx2, y2: cy2 + dy * (off + len), width: mark, color: "ink" });
  }

  return { width: stock.pageW, height: stock.pageH, elements: els, cardCodes: [] };
}
