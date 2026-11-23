import { labelQrData, qrMatrix } from "./qr";
import { baselineIn, fitLine, printable, textWidth, truncate, wrapLines } from "./text";
import type { FontRole, LabelBag, LabelCard, LabelColor, LabelElement, LabelPage, LabelStock, LabelText } from "./types";

// The layout engine for Design B "Name banner" (the owner's pick, Nov 23
// 2026): ONE label per tier bag, whatever its card count. A black banner
// with the customer's name huge and the due date in big white letters at its
// right; the bag's tier and Bag ID; the bag's card rows; and at the bottom
// ONE bag QR (never under 1 in) with the Bag ID,
// order number, card count, received date and "SCAN FOR EVERY CARD'S
// PHOTOS". No per-card QR codes. Black only.
//
// Sizes come from the approved mock (three.html, middle label: 384px label,
// 30px side padding), scaled to the printed width. The card rows start at a
// fixed legible size; as the bag fills up they step down, then go to two
// columns, never below what a 203 dpi direct thermal printer prints legibly
// (6.5 pt). Past that the label lists what fits and ends with
// "+N more: scan the QR".

export const PT = 72;
export const LABEL_LIMITS = {
  /** Smallest text anywhere on a label: 6.5 pt is about 18 printer dots to the em at 203 dpi. */
  minTextPt: 6.5,
  /** Thinnest rule or border: 1 pt is about 3 dots. */
  minRulePt: 1,
  /** The bag QR on the label is never smaller than this. */
  minBagQrIn: 1,
  /** QR modules are never narrower than this (4 dots). */
  moduleIn: 0.02,
} as const;

/** The mock's content width (384px label less 30px padding each side), in points. */
const MOCK_INNER = 324 * 0.75;
/**
 * Keep at least this much white at each side of the label: die-cut labels
 * shift a millimetre or so in a direct thermal printer, and a clipped QR
 * doesn't scan.
 */
const SIDE_MIN = 0.1 * PT;
/** Labels shorter than this use the compact spacing. */
const COMPACT_BELOW = 4.5 * PT;

/**
 * How the card rows are set: columns, type size (the Card ID number in mono
 * and the name share it), padding above and below each row, and whether
 * rows keep their dashed rules. `narrowOnly`: tried only when two columns
 * can't fit on this width.
 */
export type ListStyle = { cols: 1 | 2; body: number; pad: number; rules: boolean; narrowOnly?: boolean };

/**
 * The fitting steps, most legible first: the first that holds every card of
 * the bag is used; the last usable one lists what fits, then "+N more".
 */
export const LIST_STYLES: readonly ListStyle[] = [
  { cols: 1, body: 9, pad: 2.8, rules: true },
  { cols: 1, body: 8.5, pad: 2.4, rules: true },
  { cols: 1, body: 8, pad: 2, rules: true },
  { cols: 1, body: 7.5, pad: 1.6, rules: true },
  { cols: 1, body: 7, pad: 1.3, rules: true },
  { cols: 2, body: 7.5, pad: 1.4, rules: true },
  { cols: 2, body: 7, pad: 1.1, rules: true },
  { cols: 2, body: 7, pad: 0.5, rules: false },
  { cols: 2, body: 6.5, pad: 0.45, rules: false },
  { cols: 1, body: 6.5, pad: 0.45, rules: false, narrowOnly: true },
];

/** A two-column row needs at least this much room for the card name. */
const MIN_NAME_W = 48;

type Density = "regular" | "compact";

/** Sizes in points for one inner width and density, from the mock's px. */
function sizes(Wi: number, density: Density) {
  const k = Wi / MOCK_INNER;
  const compact = density === "compact";
  /** A length of the mock (px) at this width. */
  const px = (n: number) => n * 0.75 * k;
  /** Spacing: tighter on short stock. */
  const sp = (n: number) => px(n) * (compact ? 0.6 : 1);
  /** Type: never below the minimum; big type shrinks a bit more on short stock. */
  const fs = (n: number, compactScale = 1) => Math.max(LABEL_LIMITS.minTextPt, px(n) * (compact ? compactScale : 1));
  const rule = (n: number) => Math.max(LABEL_LIMITS.minRulePt, px(n));
  return { k, px, sp, fs, rule, compact };
}

type S = ReturnType<typeof sizes>;

/** A block measured first and drawn once its place is known. */
type Block = { h: number; draw: (y: number) => LabelElement[] };

function text(t: string, x: number, y: number, size: number, font: FontRole, color: LabelColor, tracking = 0): LabelText {
  return { kind: "text", text: t, x, y, size, font, color, width: textWidth(t, font, size, tracking), tracking };
}

const floor2 = (n: number) => Math.floor(n * 100) / 100;

// ── Dates and words ──────────────────────────────────────────────────────────

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseDay(day: string | null | undefined): { y: number; m: number; d: number; wd: number } | null {
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

/** "MON DEC 7" (the label's due date, as in the mock) */
export function dueDayText(day: string | null): string {
  const p = parseDay(day);
  return p ? `${DAYS[p.wd]} ${MONTHS[p.m - 1]} ${p.d}`.toUpperCase() : "NOT SET";
}

/** "DEC 7" */
export function dueShortText(day: string | null): string {
  const p = parseDay(day);
  return p ? `${MONTHS[p.m - 1]} ${p.d}`.toUpperCase() : "NOT SET";
}

export function cardCountText(n: number): string {
  return `${n} CARD${n === 1 ? "" : "S"}`;
}

function cardsText(n: number): string {
  return `${n} card${n === 1 ? "" : "s"}`;
}

/** The line at the end of a label that is out of room. */
export function moreText(n: number): string {
  return `+${n} more: scan the QR`;
}

/** The "Also in this order" line, one piece per other bag: ["Also in this order: GOLD CD-2549-G (2 cards)", "SILVER CD-2549-S (1 card)"]. */
export function alsoParts(bag: Pick<LabelBag, "otherBags">): string[] {
  const others = (bag.otherBags ?? []).filter((b) => b.cardCount > 0);
  return others.map((b, i) => `${i ? "" : "Also in this order: "}${b.tierName.toUpperCase()} ${b.bagCode} (${cardsText(b.cardCount)})`);
}

/** "Also in this order: GOLD CD-2549-G (2 cards) · SILVER CD-2549-S (1 card)" */
export function alsoText(bag: Pick<LabelBag, "otherBags">): string {
  return alsoParts(bag).join(" · ");
}

/** "01", "02" … "100": the card's number within the order. */
export function seqText(seq: number): string {
  return String(seq).padStart(2, "0");
}

/** The Card ID's own number as the row shows it: the part after the order number ("03" of CD-2549-03). */
function rowId(c: LabelCard): string {
  const tail = /-(\d+)$/.exec(c.code ?? "")?.[1];
  return tail ?? seqText(c.seq);
}

function setLine(c: LabelCard): string {
  const set = [c.year, c.set].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  const num = (c.number ?? "").trim().replace(/^#\s*/, "");
  return [set, num ? `#${num}` : ""].filter(Boolean).join(" ");
}

/** What the bag QR holds: the stable upper-case /q/<BAG ID> address. */
export function bagQrData(bag: Pick<LabelBag, "bagCode" | "qrUrl">): string {
  return bag.qrUrl?.toUpperCase() || labelQrData(bag.bagCode);
}

// ── Fitting ──────────────────────────────────────────────────────────────────

/**
 * Set a name in `maxW`, never cutting it: as large as it goes (up to `max`)
 * on 1, 2 or 3 lines, breaking at spaces or after a hyphen, without the
 * lines standing taller than two lines at `max`. Fewer lines win a tie. A
 * word too long for the line even at half of `max` (a name typed without
 * spaces) may break between letters instead, so the name stays large.
 */
export function fitName(name: string, font: FontRole, maxW: number, max: number, maxLines = 3): { lines: string[]; size: number } {
  const words = name.split(" ").filter(Boolean);
  const pieces = (split: (word: string) => string[]) =>
    words.flatMap((word) => {
      const sub = split(word);
      return sub.map((t, j) => ({ t, sep: j < sub.length - 1 ? "" : " " }));
    });
  // Pieces that may end a line: words, and the parts of a hyphenated word (the hyphen stays)
  const atHyphens = (word: string) => word.split(/(?<=-)(?=.)/);
  const best = bestBreaks(pieces(atHyphens), font, maxW, max, maxLines);
  const tooLong = (piece: string) => textWidth(piece, font, max * 0.5) > maxW;
  if (best.size >= max * 0.5 || !words.flatMap(atHyphens).some(tooLong)) return best;
  const letters = pieces((word) => atHyphens(word).flatMap((p) => (tooLong(p) ? [...p] : [p])));
  if (letters.length > 120) return best;
  const split = bestBreaks(letters, font, maxW, max, maxLines);
  return split.size > best.size * 1.15 ? split : best;
}

function bestBreaks(parts: { t: string; sep: string }[], font: FontRole, maxW: number, max: number, maxLines: number): { lines: string[]; size: number } {
  if (!parts.length) return { lines: [""], size: max };
  const line = (a: number, b: number) => parts.slice(a, b).map((p, i) => p.t + (a + i < b - 1 ? p.sep : "")).join("");
  const w = (a: number, b: number) => textWidth(line(a, b), font, 1);
  const n = parts.length;
  const splits: number[][] = [[]];
  for (let i = 1; i < n && maxLines >= 2; i++) splits.push([i]);
  for (let i = 1; i < n && maxLines >= 3; i++) for (let j = i + 1; j < n; j++) splits.push([i, j]);
  let best = { lines: [line(0, n)], size: 0 };
  let bestK = 0;
  let bestWidest = Infinity;
  for (const cut of splits) {
    const bounds = [0, ...cut, n];
    const widest = Math.max(...bounds.slice(0, -1).map((a, i) => w(a, bounds[i + 1])));
    const k = bounds.length - 1;
    const size = floor2(Math.min(max, maxW / widest, (2 * max) / k));
    // Bigger wins; on a tie, fewer lines, then the more even lines
    const tie = Math.abs(size - best.size) <= 0.01;
    if (size > best.size + 0.01 || (tie && k === bestK && widest < bestWidest - 1e-9)) {
      best = { lines: bounds.slice(0, -1).map((a, i) => line(a, bounds[i + 1])), size };
      bestK = k;
      bestWidest = widest;
    }
  }
  return best;
}

function qrSide(data: string, minIn: number): { size: number; module: number } {
  const n = qrMatrix(data).size;
  const size = Math.max(minIn * PT, n * LABEL_LIMITS.moduleIn * PT);
  return { size, module: size / n };
}

// ── Label blocks ─────────────────────────────────────────────────────────────

/** What the banner's due block says: the weekday, the date, and the year when it isn't the bag's year. */
function dueParts(bag: LabelBag): { weekday: string; date: string; year: string } {
  const p = parseDay(bag.dueDate);
  if (!p) return { weekday: "", date: bag.dueStatus === "missing_received_date" ? "SET DATE" : "—", year: "" };
  // "This year": the year the bag's cards arrived (else the printing year), so a reprint never changes it
  const ref = parseDay(bag.receivedOn)?.y ?? new Date().getFullYear();
  return { weekday: DAYS[p.wd].toUpperCase(), date: `${MONTHS[p.m - 1]} ${p.d}`.toUpperCase(), year: p.y === ref ? "" : String(p.y) };
}

/**
 * The black banner across the printed width: "THE CARD DOC · CUSTOMER", the
 * customer's name huge in white on the left, and at the right the due date
 * in big white letters ("DUE", the weekday, then "DEC 7" at about two thirds
 * of the name's size), centered on the name.
 */
function banner(s: S, x0: number, W: number, xi: number, Wi: number, bag: LabelBag, nameScale = 1): Block & { nameSize: number; nameLines: number } {
  const padTop = s.sp(16);
  const padBottom = s.sp(14);
  const kTrack = s.px(2);
  const kicker = fitLine("THE CARD DOC · CUSTOMER", "body800", s.fs(9), Wi, LABEL_LIMITS.minTextPt, kTrack);
  const kGap = s.sp(6);
  const nameMax = s.px(64) * (s.compact ? 0.62 : 1) * nameScale;
  const colGap = s.px(12);

  // The due block's size follows the name's: start from the largest name, then settle on the name as fitted
  const due = dueParts(bag);
  const kSize = kicker.size;
  const dueBlock = (dateSize: number) => {
    const wdSize = Math.max(LABEL_LIMITS.minTextPt, dateSize * 0.36);
    const wdTrack = wdSize * 0.12;
    const yearSize = Math.max(LABEL_LIMITS.minTextPt, dateSize * 0.3);
    const yearText = due.year ? ` · ${due.year}` : "";
    const dateW = textWidth(due.date, "display900", dateSize) + (yearText ? textWidth(yearText, "body800", yearSize) : 0);
    const w = Math.max(textWidth("DUE", "body800", kSize, kTrack), due.weekday ? textWidth(due.weekday, "body800", wdSize, wdTrack) : 0, dateW);
    const gap = s.px(3);
    const h = kSize * 1.2 + gap + (due.weekday ? wdSize * 1.15 + gap * 0.5 : 0) + dateSize * 0.9;
    return { dateSize, wdSize, wdTrack, yearSize, yearText, w, h, gap };
  };
  const maxDueW = Wi * 0.42;
  // The date never goes below the smallest legible type, whatever the name does
  const dateAt = (size: number) => dueBlock(Math.max(LABEL_LIMITS.minTextPt, floor2(size)));
  let d = dateAt(nameMax * 0.65);
  if (d.w > maxDueW) d = dateAt(d.dateSize * (maxDueW / d.w));
  const nameText = printable(bag.customerName.toUpperCase(), "display900") || "UNKNOWN";
  const name = fitName(nameText, "display900", Wi - d.w - colGap, nameMax);
  if (d.dateSize > name.size * 0.7) d = dateAt(name.size * 0.7);
  const lh = 0.9;
  // Accented capitals (É, Ö, Å) stand about 0.2 em above the other letters:
  // a line with one gets that much more room above it, so the accent never
  // touches the line or the kicker over it
  const above = name.lines.map((l) => (/[̀-̕]/.test(l.normalize("NFD")) ? 0.2 * name.size : 0));
  const nameH = name.lines.length * name.size * lh + above.reduce((a, b) => a + b, 0);
  const rowH = Math.max(nameH, d.h);
  const h = padTop + kicker.size * 1.2 + kGap + rowH + padBottom;
  return {
    h,
    nameSize: name.size,
    nameLines: name.lines.length,
    draw: (y) => {
      const out: LabelElement[] = [
        { kind: "rect", x: x0, y, w: W, h, fill: "ink", radius: s.px(4) },
        text(kicker.text, xi, baselineIn(y + padTop, "body800", kicker.size, 1.2), kicker.size, "body800", "paper", kTrack),
      ];
      const rowTop = y + padTop + kicker.size * 1.2 + kGap;
      let ty = rowTop + (rowH - nameH) / 2;
      name.lines.forEach((line, i) => {
        ty += above[i];
        out.push(text(line, xi, baselineIn(ty, "display900", name.size, lh), name.size, "display900", "paper"));
        ty += name.size * lh;
      });
      // The due block, right-aligned
      const right = xi + Wi;
      const alignRight = (e: LabelText) => ((e.x = right - e.width), e);
      let dy = rowTop + (rowH - d.h) / 2;
      out.push(alignRight(text("DUE", 0, baselineIn(dy, "body800", kSize, 1.2), kSize, "body800", "paper", kTrack)));
      dy += kSize * 1.2 + d.gap;
      if (due.weekday) {
        out.push(alignRight(text(due.weekday, 0, baselineIn(dy, "body800", d.wdSize, 1.15), d.wdSize, "body800", "paper", d.wdTrack)));
        dy += d.wdSize * 1.15 + d.gap * 0.5;
      }
      const base = baselineIn(dy, "display900", d.dateSize, lh);
      if (d.yearText) {
        const yearEl = alignRight(text(d.yearText, 0, base, d.yearSize, "body800", "paper"));
        const dateEl = text(due.date, 0, base, d.dateSize, "display900", "paper");
        dateEl.x = yearEl.x - dateEl.width;
        out.push(dateEl, yearEl);
      } else {
        out.push(alignRight(text(due.date, 0, base, d.dateSize, "display900", "paper")));
      }
      return out;
    },
  };
}

/** The bag's tier, large, with its Bag ID in mono at the right, over a heavy rule. */
function tierRow(s: S, xi: number, Wi: number, bag: LabelBag, cap: number): Block {
  const idSize = Math.max(8, s.fs(12));
  const id = printable(bag.bagCode, "mono600");
  const idW = textWidth(id, "mono600", idSize);
  const tTrack = s.px(1);
  const tierSize = Math.min(cap, s.fs(19, 0.8));
  const tier = fitLine(printable(bag.tierName.toUpperCase(), "display900") || "NO TIER", "display900", tierSize, Wi - idW - s.px(8), 8, tTrack);
  const rule = s.rule(2.5);
  const lineH = tierSize * 1.1;
  const gap = s.px(2);
  const h = lineH + gap + rule;
  return {
    h,
    draw: (y) => {
      const base = baselineIn(y, "display900", tierSize, 1.1);
      const idEl = text(id, 0, base, idSize, "mono600", "ink");
      idEl.x = xi + Wi - idEl.width;
      return [
        text(tier.text, xi, base, tier.size, "display900", "ink", tTrack),
        idEl,
        { kind: "rect", x: xi, y: y + lineH + gap, w: Wi, h: rule, fill: "ink" },
      ];
    },
  };
}

/** One card row: the Card ID's number in mono, the name in bold, set and number, one line, a dashed rule under it. */
function cardRow(c: LabelCard, st: ListStyle, w: number, idW: number, gap: number): { h: number; draw: (x: number, y: number) => LabelElement[] } {
  const size = st.body;
  const lineH = size * 1.25;
  const rule = st.rules ? LABEL_LIMITS.minRulePt : 0;
  const h = lineH + 2 * st.pad + rule;
  const avail = w - idW - gap;
  const name = printable(c.name, "body700") || "Unnamed card";
  const fullW = textWidth(name, "body700", size);
  const nameText = fullW <= avail ? name : truncate(name, "body700", size, avail);
  const set = printable(setLine(c), "body400");
  const setGap = size * 0.55;
  const setAvail = avail - Math.min(fullW, avail) - setGap;
  // The set in full, or cut only when most of it still shows (a stub like "1986 Fle…" is noise)
  const setW = textWidth(set, "body400", size);
  const setText = set && fullW <= avail && (setW <= setAvail || setAvail >= Math.max(4 * size, 0.8 * setW)) ? truncate(set, "body400", size, setAvail) : "";
  return {
    h,
    draw: (x, y) => {
      const base = baselineIn(y + st.pad, "body700", size, 1.25);
      const nameEl = text(nameText, x + idW + gap, base, size, "body700", "ink");
      const out: LabelElement[] = [text(rowId(c), x, base, size, "mono600", "ink"), nameEl];
      if (setText) out.push(text(setText, nameEl.x + nameEl.width + setGap, base, size, "body400", "ink"));
      if (rule) out.push({ kind: "line", x1: x, y1: y + h - rule / 2, x2: x + w, y2: y + h - rule / 2, width: rule, color: "ink", dash: [2, 2] });
      return out;
    },
  };
}

/** The bag's card rows in one style: `cards` down one column, or down the left column then the right. */
function rowsBlock(cards: LabelCard[], st: ListStyle, xi: number, Wi: number, colGap: number): Block {
  const idW = Math.max(0, ...cards.map((c) => textWidth(rowId(c), "mono600", st.body)));
  const gap = st.body * 0.6;
  const colW = st.cols === 2 ? (Wi - colGap) / 2 : Wi;
  const rows = cards.map((c) => cardRow(c, st, colW, idW, gap));
  const rowH = rows[0]?.h ?? 0;
  const perCol = st.cols === 2 ? Math.ceil(cards.length / 2) : cards.length;
  return {
    h: perCol * rowH,
    draw: (y) =>
      rows.flatMap((r, i) => {
        const col = i < perCol ? 0 : 1;
        return r.draw(xi + col * (colW + colGap), y + (i - col * perCol) * rowH);
      }),
  };
}

/** The height of one row in this style. */
function rowHeight(st: ListStyle): number {
  return st.body * 1.25 + 2 * st.pad + (st.rules ? LABEL_LIMITS.minRulePt : 0);
}

/** Can this style be used on this width at all? */
function usable(st: ListStyle, cards: LabelCard[], Wi: number, colGap: number, twoColsFit: boolean): boolean {
  if (st.narrowOnly) return !twoColsFit;
  if (st.cols === 1) return true;
  const idW = Math.max(0, ...cards.map((c) => textWidth(rowId(c), "mono600", st.body)));
  return (Wi - colGap) / 2 - idW - st.body * 0.6 >= MIN_NAME_W;
}

/** "+N more: scan the QR", bold, after the last row that fits. */
function moreLine(n: number, xi: number, Wi: number, st: ListStyle): Block {
  const size = Math.max(7.5, st.body);
  const t = fitLine(moreText(n), "body800", size, Wi, LABEL_LIMITS.minTextPt);
  const pad = Math.max(1.5, st.pad);
  const h = pad + t.size * 1.3;
  return { h, draw: (y) => [text(t.text, xi, baselineIn(y + pad, "body800", t.size, 1.3), t.size, "body800", "ink")] };
}

/** "Also in this order: …", small, up to two lines, breaking between bags. */
function alsoBlock(s: S, xi: number, Wi: number, bag: LabelBag): Block | null {
  const parts = alsoParts(bag).map((p) => printable(p, "body700"));
  if (!parts.length) return null;
  const size = s.fs(10);
  const fits = (t: string) => textWidth(t, "body700", size) <= Wi;
  const lines: string[] = [];
  let i = 0;
  while (i < parts.length && lines.length < 2) {
    let line = parts[i++];
    while (i < parts.length && fits(`${line} · ${parts[i]}`)) line += ` · ${parts[i++]}`;
    lines.push(line);
  }
  // Whatever is left joins the last line, cut with "…"; a piece wider than the label is cut too
  if (i < parts.length) lines[lines.length - 1] = `${lines[lines.length - 1]} · ${parts.slice(i).join(" · ")}`;
  for (let j = 0; j < lines.length; j++) if (!fits(lines[j])) lines[j] = truncate(lines[j], "body700", size, Wi);
  return {
    h: lines.length * size * 1.3,
    draw: (y) => lines.map((l, i) => text(l, xi, baselineIn(y + i * size * 1.3, "body700", size, 1.3), size, "body700", "ink")),
  };
}

/**
 * Above a rule: the bag QR at the left; at its right the Bag ID large in
 * mono, the order number and card count, the received date and what the QR
 * opens. On a narrow print the words go under the QR.
 */
function bottomBlock(s: S, xi: number, Wi: number, bag: LabelBag, cap: number): Block {
  const data = bagQrData(bag);
  const qr = qrSide(data, Math.max(LABEL_LIMITS.minBagQrIn, s.px(100) / PT));
  const rule = s.rule(2);
  const padTop = Math.max(s.sp(10), 3 * qr.module);
  const colGap = Math.max(s.px(12), 3 * qr.module);
  const beside = Wi - qr.size - colGap >= 84;
  const colW = beside ? Wi - qr.size - colGap : Wi;
  const lineGap = s.px(3);
  const id = fitLine(printable(bag.bagCode, "mono600") || "NO BAG ID", "mono600", Math.min(cap, s.fs(20)), colW, 8);
  const small = s.fs(11);
  const order = fitLine(`Order ${printable(bag.orderNumber, "body800")} · ${cardsText(bag.cards.length)}`, "body800", small, colW, LABEL_LIMITS.minTextPt);
  const recvDay = parseDay(bag.receivedOn);
  const recv = recvDay
    ? [`Received ${receivedText(bag.receivedOn)}`, `Received ${MONTHS[recvDay.m - 1]} ${recvDay.d}`].find((t) => textWidth(t, "body800", small) <= colW) ?? `Received ${MONTHS[recvDay.m - 1]} ${recvDay.d}`
    : "Received: not recorded";
  const received = fitLine(recv, "body800", small, colW, LABEL_LIMITS.minTextPt);
  const scanSize = s.fs(8.5);
  const scanTrack = s.px(1.2);
  const scan = wrapLines("SCAN FOR EVERY CARD'S PHOTOS", "body800", scanSize, colW, 2, scanTrack);
  const scanTop = s.px(3);
  const lines: [string, FontRole, number, number, number][] = [
    [id.text, "mono600", id.size, 1.15, 0],
    [order.text, "body800", order.size, 1.25, 0],
    [received.text, "body800", received.size, 1.25, 0],
    ...scan.map((l): [string, FontRole, number, number, number] => [l, "body800", scanSize, 1.3, scanTrack]),
  ];
  const colH = lines.reduce((sum, l) => sum + l[2] * l[3], 0) + lineGap * 2 + scanTop;
  const bodyH = beside ? Math.max(qr.size, colH) : qr.size + padTop + colH;
  const h = rule + padTop + bodyH;
  return {
    h,
    draw: (y) => {
      const top = y + rule + padTop;
      const out: LabelElement[] = [
        { kind: "rect", x: xi, y, w: Wi, h: rule, fill: "ink" },
        { kind: "qr", data, x: xi, y: beside ? top + (bodyH - qr.size) / 2 : top, size: qr.size, alt: `QR code for bag ${bag.bagCode}` },
      ];
      const tx = beside ? xi + qr.size + colGap : xi;
      let ty = beside ? top + (bodyH - colH) / 2 : top + qr.size + padTop;
      lines.forEach(([t, font, size, lh, tracking], i) => {
        if (i === 3) ty += scanTop;
        out.push(text(t, tx, baselineIn(ty, font, size, lh), size, font, "ink", tracking));
        ty += size * lh + (i < 2 ? lineGap : 0);
      });
      return out;
    },
  };
}

// ── The bag label ────────────────────────────────────────────────────────────

/** The width the label content actually prints at: the setting, less a printer margin at each side. */
export function printedWidth(stock: LabelStock): number {
  return Math.min(stock.contentW, stock.pageW - 2 * SIDE_MIN);
}

function frame(stock: LabelStock) {
  const W = printedWidth(stock);
  const x0 = (stock.pageW - W) / 2;
  // The words sit a little inside the banner's edges, as in the mock
  const inset = Math.min(0.1 * PT, W * 0.04);
  const density: Density = stock.pageH < COMPACT_BELOW ? "compact" : "regular";
  return { W, x0, xi: x0 + inset, Wi: W - 2 * inset, s: sizes(W - 2 * inset, density) };
}

/** How a bag's cards were fitted on its label. */
export type LabelFit = {
  /** Index in LIST_STYLES of the style used. */
  style: number;
  cols: 1 | 2;
  bodyPt: number;
  /** Cards listed on the label, and the rest ("+N more"). */
  shown: number;
  more: number;
  /** The customer name's type size and number of lines. */
  nameSize: number;
  nameLines: number;
};

/** The bag's label and how its cards were fitted. */
export function planBagLabel(bag: LabelBag, stock: LabelStock): { page: LabelPage; fit: LabelFit } {
  const { W, x0, xi, Wi, s } = frame(stock);
  const cards = [...bag.cards].sort((a, b) => a.seq - b.seq);
  const padY = Math.max(0.08 * PT, s.sp(12) * 0.6);

  // The banner first: nothing else on the label is as large as the name
  const place = (nameScale: number, withAlso: boolean) => {
    const top = banner(s, x0, W, xi, Wi, bag, nameScale);
    const cap = top.nameSize * 0.9;
    const tier = tierRow(s, xi, Wi, bag, cap);
    const bottom = bottomBlock(s, xi, Wi, bag, cap);
    const also = withAlso ? alsoBlock(s, xi, Wi, bag) : null;
    const tierY = padY + top.h + s.sp(10);
    const listTop = tierY + tier.h;
    const bottomY = stock.pageH - padY - bottom.h;
    const alsoY = also ? bottomY - s.sp(8) - also.h : bottomY;
    return { top, tier, bottom, also, tierY, listTop, bottomY, alsoY, room: alsoY - s.sp(6) - listTop };
  };
  // On short stock a long name can leave no room for even the "+N more" line:
  // then "Also in this order" goes (the QR shows the whole order), then the name is set smaller
  const need = moreLine(cards.length, xi, Wi, LIST_STYLES[cards.length ? LIST_STYLES.length - 1 : 0]).h;
  let at = place(1, true);
  if (at.room < need && at.also) at = place(1, false);
  for (let k = 0.85; at.room < need && k > 0.3; k *= 0.85) at = place(k, false);
  const { top, tier, bottom, also, tierY, listTop, bottomY, alsoY, room } = at;

  const els: LabelElement[] = [...top.draw(padY)];
  els.push(...tier.draw(tierY));
  els.push(...bottom.draw(bottomY));
  if (also) els.push(...also.draw(alsoY));

  // The rows: the first style that holds every card, else the last usable one and "+N more"
  const colGap = Math.max(6, s.px(14));
  const twoColsFit = LIST_STYLES.some((st) => st.cols === 2 && usable(st, cards, Wi, colGap, true));
  let style = -1;
  let shown = cards;
  for (let i = 0; i < LIST_STYLES.length; i++) {
    const st = LIST_STYLES[i];
    if (!usable(st, cards, Wi, colGap, twoColsFit)) continue;
    style = i;
    const perCol = st.cols === 2 ? Math.ceil(cards.length / 2) : cards.length;
    if (perCol * rowHeight(st) <= room) break;
    if (i === LIST_STYLES.length - 1 || !LIST_STYLES.slice(i + 1).some((n) => usable(n, cards, Wi, colGap, twoColsFit))) {
      // Out of room: whole rows that fit above the "+N more" line
      const more = moreLine(cards.length, xi, Wi, st);
      const rows = Math.max(0, Math.floor((room - more.h) / rowHeight(st)));
      shown = cards.slice(0, Math.min(cards.length, rows * st.cols));
    }
  }
  const st = LIST_STYLES[style];
  const cardCodes = shown.map((c) => c.code);
  if (shown.length) els.push(...rowsBlock(shown, st, xi, Wi, colGap).draw(listTop));
  const more = cards.length - shown.length;
  const rowsH = (st.cols === 2 ? Math.ceil(shown.length / 2) : shown.length) * rowHeight(st);
  if (more) els.push(...moreLine(more, xi, Wi, st).draw(listTop + rowsH));
  else if (!cards.length) els.push(...moreLine(0, xi, Wi, st).draw(listTop).map((e) => (e.kind === "text" ? { ...e, text: "No cards in this bag", width: textWidth("No cards in this bag", e.font, e.size) } : e)));

  return {
    page: { width: stock.pageW, height: stock.pageH, elements: els, cardCodes },
    fit: { style, cols: st.cols, bodyPt: st.body, shown: shown.length, more, nameSize: top.nameSize, nameLines: top.nameLines },
  };
}

/** The bag's label: always exactly ONE page at the stock's size, whatever the card count. */
export function layoutBagLabel(bag: LabelBag, stock: LabelStock): LabelPage {
  return planBagLabel(bag, stock).page;
}

/**
 * The bag's labels, as the label routes and preview have always taken them:
 * now always a single page (one label per bag).
 */
export function layoutBagLabels(bag: LabelBag, stock: LabelStock): LabelPage[] {
  return [layoutBagLabel(bag, stock)];
}

/**
 * How many cards fit on one bag label on this stock: at the first (largest)
 * row size, and in all before "+N more" (for the settings page). Counted
 * for a bag with ordinary card names in an order with one other bag.
 */
export function bagLabelCapacity(stock: LabelStock): { normal: number; max: number } {
  const sample = (n: number): LabelBag => ({
    bagCode: "CD-0000-P",
    tierName: "Platinum",
    orderNumber: "CD-0000",
    customerName: "Sample Customer",
    receivedOn: "2026-11-16",
    dueDate: "2026-12-08",
    otherBags: [{ bagCode: "CD-0000-G", tierName: "Gold", cardCount: 2 }],
    cards: Array.from({ length: n }, (_, i) => ({ seq: i + 1, code: `CD-0000-${seqText(i + 1)}`, name: "Sample card", year: "1999", set: "Sample Set", number: String(i + 1) })),
  });
  const most = (ok: (f: LabelFit) => boolean) => {
    let lo = 0;
    let hi = 300;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ok(planBagLabel(sample(mid), stock).fit)) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  return { normal: most((f) => f.style === 0 && f.more === 0), max: most((f) => f.more === 0) };
}
