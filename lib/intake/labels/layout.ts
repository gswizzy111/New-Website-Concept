import { filingLetter } from "../filing-letter";
import { FONT_METRICS } from "./fonts/metrics";
import { labelQrData, qrMatrix } from "./qr";
import { baselineIn, fitLine, printable, textWidth, truncate, wrapLines } from "./text";
import type { FontRole, LabelBag, LabelCard, LabelColor, LabelElement, LabelPage, LabelStock, LabelText } from "./types";

// The layout engine for Design B "Name banner" (the owner's pick, Nov 23
// 2026): ONE label per tier bag, whatever its card count. A black banner
// with the customer's name huge and the due date in big white letters at its
// right; the bag's tier and Bag ID; the bag's card rows; and at the bottom
// ONE bag QR (never under 1 in) with the Bag ID,
// order number, card count, received date and "SCAN TO OPEN THE ORDER" (the
// QR opens the scan landing, /admin/receiving/open/<Bag ID>, with the order
// and "Move all N cards to my desk"). No per-card QR codes. Black only.
// In the banner's top right corner, the filing tab: a white square with the
// big black letter of the customer's last name ("R" for JORDAN REYES), the
// Open bags box divider the bag is filed under (see banner()).
//
// Sizes come from the approved mock (three.html, middle label: 384px label,
// 30px side padding), scaled to the printed width. The card rows start at a
// fixed legible size; as the bag fills up they step down, then go to two
// columns, never below what a 203 dpi direct thermal printer prints legibly
// (6.5 pt). Space left over goes to the sets and card numbers first: a set
// and number that don't fit beside the name go on a second line under it.
// Past that the label lists what fits and ends with "+N more: scan the QR".
// Every card row starts with an empty check box (4 mm; 3 mm on 50 x 80 mm)
// and ends with "PG" and a write-in line, the submitted pre-grade printed on
// it (ROW_MARKS); the box sets the height of rows in small type.
//
// On the 50 x 80 mm Katasymbol label (printed width under 2 in) the QR keeps
// its 1 in and the words go beside it in a narrow column (card count,
// received date, "SCAN TO OPEN THE ORDER"; the Bag ID is on the tier
// row), and "Also in this order" gives way when it would hide cards.

export const PT = 72;
/** The words beside the bag QR: what scanning it opens (the order, with its cards and "Move to my desk"). */
export const BAG_QR_CAPTION = "SCAN TO OPEN THE ORDER";
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

/**
 * A two-column row needs at least this much room for the card name (what
 * the check box, the Card ID number and the PG field leave).
 */
const MIN_NAME_W = 36;

const MM = PT / 25.4;

/**
 * The marks on every card row (owner, Nov 26 2026: "next to the cards on
 * the label there are boxes you can check. Also have like a line for the
 * pregrade"): an empty check box at the row's left, big enough to tick with
 * a pen, and at its right end "PG" with a write-in line (the submitted
 * pre-grade printed on it). Outlines only: black on a thermal printer.
 */
export const ROW_MARKS = {
  /** The check box's side on the inch stocks (4 mm) and on the narrow 50 x 80 mm label (3 mm). */
  boxPt: 4 * MM,
  narrowBoxPt: 3 * MM,
  /** Its outline (drawn inside the box): about 3.4 printer dots. */
  boxStrokePt: 1.2,
  /** Clear paper above and below the box inside its row, so the boxes of neighbouring rows never touch. */
  boxMarginPt: 1,
  /** The PG field's word. */
  pgLabel: "PG",
  /** The blank PG line: a sixth of the row's text width, 18 to 30 pt (6.4 to 10.6 mm). */
  pgLineMinPt: 18,
  pgLineMaxPt: 30,
  pgLineShare: 1 / 6,
  /** A pre-grade longer than the blank line takes at most this share of the row's text width (cut with "…" past it). */
  pgValueShare: 0.45,
} as const;

/** The marks as one label sets them: the check box's side, and whether this is the narrow (50 x 80 mm) label. */
type Marks = { box: number; narrow: boolean };

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

/** A text element, its width measured from the font's metrics. */
export function text(t: string, x: number, y: number, size: number, font: FontRole, color: LabelColor, tracking = 0): LabelText {
  return { kind: "text", text: t, x, y, size, font, color, width: textWidth(t, font, size, tracking), tracking };
}

export const floor2 = (n: number) => Math.floor(n * 100) / 100;

// ── Dates and words ──────────────────────────────────────────────────────────

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parseDay(day: string | null | undefined): { y: number; m: number; d: number; wd: number } | null {
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

/** The card's year and set ("1999 Base Set") and its number ("#4/102"). */
export function setParts(c: Pick<LabelCard, "year" | "set" | "number">): { set: string; num: string } {
  const set = [c.year, c.set].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  const num = (c.number ?? "").trim().replace(/^#\s*/, "");
  return { set, num: num ? `#${num}` : "" };
}

function setLine(c: LabelCard): string {
  const { set, num } = setParts(c);
  return [set, num].filter(Boolean).join(" ");
}

/** What the bag QR holds: the stable upper-case /q/<BAG ID> address. */
export function bagQrData(bag: Pick<LabelBag, "bagCode" | "qrUrl">): string {
  return bag.qrUrl?.toUpperCase() || labelQrData(bag.bagCode);
}

// ── Fitting ──────────────────────────────────────────────────────────────────

/** A name goes on the fewest lines that keep it at least this share of its largest size. */
export const NAME_KEEP = 0.7;
/** When no number of lines keeps that, an extra line has to make the name at least this much larger. */
const EXTRA_LINE_GAIN = 1.1;

/**
 * Set a name in `maxW`, never cutting it, breaking at spaces or after a
 * hyphen: on the fewest lines (1, then 2, then 3) that keep it at least
 * NAME_KEEP of `max` ("TEST CUSTOMER A" on two lines, not three); when no
 * number of lines does, as large as it goes, an extra line only for a
 * clearly larger name. The lines never stand taller than two lines at `max`,
 * and a line after the first never holds just one or two letters ("A",
 * "JR."): they join the line before. A word too long for the line even at
 * half of `max` (a name typed without spaces) may break between letters
 * instead, so the name stays large.
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
  // One or two letters alone on a line ("A", "JR.") join the line before
  const lone = (a: number, b: number) => line(a, b).replace(/[^\p{L}\p{N}]/gu, "").length <= 2;
  const n = parts.length;
  const splits: number[][] = [[]];
  for (let i = 1; i < n && maxLines >= 2; i++) splits.push([i]);
  for (let i = 1; i < n && maxLines >= 3; i++) for (let j = i + 1; j < n; j++) splits.push([i, j]);
  // The best split for each number of lines: the largest, then the most even lines
  const byLines = new Map<number, { lines: string[]; size: number; widest: number }>();
  for (const cut of splits) {
    const bounds = [0, ...cut, n];
    if (cut.some((a, i) => lone(a, bounds[i + 2]))) continue;
    const widest = Math.max(...bounds.slice(0, -1).map((a, i) => w(a, bounds[i + 1])));
    const k = bounds.length - 1;
    const size = floor2(Math.min(max, maxW / widest, (2 * max) / k));
    const best = byLines.get(k);
    if (!best || size > best.size + 0.01 || (Math.abs(size - best.size) <= 0.01 && widest < best.widest - 1e-9)) {
      byLines.set(k, { lines: bounds.slice(0, -1).map((a, i) => line(a, bounds[i + 1])), size, widest });
    }
  }
  const fits = [...byLines.entries()].sort((a, b) => a[0] - b[0]).map(([, f]) => ({ lines: f.lines, size: f.size }));
  // Up to two lines the larger name wins (the approved design: "JORDAN / REYES" big
  // on two lines; one line on a tie). A third line only when two lines can't keep the
  // name at NAME_KEEP of its largest size and the third makes it clearly larger.
  const upToTwo = fits.filter((f) => f.lines.length <= 2);
  let pick = upToTwo.reduce<{ lines: string[]; size: number } | null>((p, f) => (!p || f.size > p.size + 0.01 ? f : p), null);
  for (const f of fits.filter((x) => x.lines.length >= 3)) {
    if (!pick || (pick.size < NAME_KEEP * max - 0.01 && f.size > pick.size * EXTRA_LINE_GAIN)) pick = f;
  }
  return pick ?? fits[0];
}

/** A QR of at least `minIn` inches whose modules are never under LABEL_LIMITS.moduleIn. */
export function qrSide(data: string, minIn: number): { size: number; module: number } {
  const n = qrMatrix(data).size;
  const size = Math.max(minIn * PT, n * LABEL_LIMITS.moduleIn * PT);
  return { size, module: size / n };
}

// ── Label blocks ─────────────────────────────────────────────────────────────

/** What the banner's due block says: the weekday, the date, and the year when it isn't the bag's year. */
export function dueParts(bag: Pick<LabelBag, "dueDate" | "dueStatus" | "receivedOn">): { weekday: string; date: string; year: string } {
  const p = parseDay(bag.dueDate);
  if (!p) return { weekday: "", date: bag.dueStatus === "missing_received_date" ? "SET DATE" : "—", year: "" };
  // "This year": the year the bag's cards arrived (else the printing year), so a reprint never changes it
  const ref = parseDay(bag.receivedOn)?.y ?? new Date().getFullYear();
  return { weekday: DAYS[p.wd].toUpperCase(), date: `${MONTHS[p.m - 1]} ${p.d}`.toUpperCase(), year: p.y === ref ? "" : String(p.y) };
}

/** The filing tab as laid out: its letter, its side and the letter's type size (points), its left edge, and its top below the banner's. */
export type FilingTab = { letter: string; side: number; size: number; x: number; top: number };

/** The tab drawn on a banner whose top is at `y`: a white square, the letter black and centered in it. */
function tabElements(tab: FilingTab, y: number, radius: number): LabelElement[] {
  const top = y + tab.top;
  const letter = text(tab.letter, 0, 0, tab.size, "display900", "ink");
  letter.x = tab.x + (tab.side - letter.width) / 2;
  // Centered on its cap height (a "#" stands about as tall as the capitals)
  letter.y = top + (tab.side + (FONT_METRICS.display900.capHeight / 1000) * tab.size) / 2;
  return [{ kind: "rect", x: tab.x, y: top, w: tab.side, h: tab.side, fill: "paper", radius }, letter];
}

/** The banner's small line over the name. */
export const KICKER = "THE CARD DOC · CUSTOMER";
/** The kicker on a label with no room for the filing tab: the letter first, so a tight fit never cuts it. */
export function kickerWithLetter(letter: string): string {
  return `FILE UNDER ${letter} · THE CARD DOC`;
}

/** The filing tab's inner margin, as a share of its side. */
const TAB_PAD = 0.1;
/** The filing tab is never smaller than this (a quarter inch: its letter about 5 mm tall). */
const TAB_MIN = 0.25 * PT;

/**
 * The filing tab's side on this stock: 0.8 of the largest name, at least a
 * quarter inch, so every bag on one stock has the same tab in the same place.
 */
function tabSide(s: S): number {
  return Math.max(TAB_MIN, 0.8 * s.px(64) * (s.compact ? 0.62 : 1));
}

/** The filing letter's type size in a tab of side `side`: the letter fills it, less its margin, width or cap height. */
export function tabLetterSize(letter: string, side: number): number {
  const m = FONT_METRICS.display900;
  const inner = side * (1 - 2 * TAB_PAD);
  return floor2(inner / Math.max(m.capHeight / 1000, textWidth(letter, "display900", 1)));
}

/**
 * The black banner across the printed width: "THE CARD DOC · CUSTOMER", the
 * customer's name huge in white on the left, and at the right the due date
 * in big white letters ("DUE", the weekday, then "DEC 7" at about two thirds
 * of the name's size), centered on the name.
 *
 * In its top right corner, the filing tab (owner, Nov 25 2026: bags with
 * cards out are filed in ONE A-Z "Open bags" box by the customer's last
 * name): a white square with the big black letter the bag is filed under
 * ("R" for JORDAN REYES, lib/intake/filing-letter.ts), seen first when bags
 * stand in the box. The name and the due date are fitted first, exactly as
 * without the tab, so the tab never makes the name smaller: it stands above
 * the due block, in the column the date already keeps free; beside it the
 * kicker gives up letter-spacing (never size), else the tab goes under the
 * kicker. When the tab and the due block don't fit in the name's height, the
 * banner grows (the card list below gives up that room). The letter is never
 * smaller than the due date.
 *
 * `letterInKicker` (no tab: `tab` 0): the label where even the smallest tab
 * would make the name smaller or hide every card (4 x 3 in): the letter goes
 * in the kicker instead, first so it is never cut: "FILE UNDER R · THE CARD DOC".
 */
function banner(s: S, x0: number, W: number, xi: number, Wi: number, bag: LabelBag, nameScale = 1, tab = tabSide(s), letterInKicker = false): Block & { nameSize: number; nameLines: number; tab: FilingTab | null; kicker: { text: string; size: number } } {
  const padTop = s.sp(16);
  const padBottom = s.sp(14);
  const kTrack = s.px(2);
  const kicker = fitLine(letterInKicker && !tab ? kickerWithLetter(filingLetter(bag.customerName)) : KICKER, "body800", s.fs(9), Wi, LABEL_LIMITS.minTextPt, kTrack);
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
  // The name takes the width a date of `dateSize` leaves, and the date is then
  // at most 0.7 of the name: when the name comes out below its largest size,
  // the date shrinks with it and the name gets that width back. Find the
  // smallest room to keep for the date that still holds the date the name ends up with.
  const nameBeside = (dateSize: number) => fitName(nameText, "display900", Wi - dateAt(dateSize).w - colGap, nameMax);
  let name = nameBeside(d.dateSize);
  if (name.size * 0.7 < d.dateSize) {
    let lo: number = LABEL_LIMITS.minTextPt;
    let hi = d.dateSize;
    for (let i = 0; i < 10 && hi - lo > 0.05; i++) {
      const mid = (lo + hi) / 2;
      const at = nameBeside(mid);
      if (Math.min(d.dateSize, at.size * 0.7) <= mid) [hi, name] = [mid, at];
      else lo = mid;
    }
  }
  if (d.dateSize > name.size * 0.7) d = dateAt(name.size * 0.7);
  const lh = 0.9;
  // Accented capitals (É, Ö, Å) stand about 0.2 em above the other letters:
  // a line with one gets that much more room above it, so the accent never
  // touches the line or the kicker over it
  const above = name.lines.map((l) => (/[̀-̕]/.test(l.normalize("NFD")) ? 0.2 * name.size : 0));
  const nameH = name.lines.length * name.size * lh + above.reduce((a, b) => a + b, 0);
  const rowOff = padTop + kicker.size * 1.2 + kGap;
  // Without the tab: the name and the due block centered on each other in the row (offsets from the banner's top)
  let rowH = Math.max(nameH, d.h);
  let nameTop = rowOff + (rowH - nameH) / 2;
  let dueTop = rowOff + (rowH - d.h) / 2;
  let kickerTrack = kTrack;
  let filing: FilingTab | null = null;
  if (tab > 0) {
    const letter = filingLetter(bag.customerName);
    const kickGap = Math.max(4, s.px(10));
    const below = Math.max(2, s.px(5));
    const chars = [...kicker.text].length;
    const lineW = name.lines.map((l) => textWidth(l, "display900", name.size));
    const placeTab = (side: number) => {
      // Beside the tab the kicker keeps its size and gives up letter-spacing; if even none is too wide, the tab goes under it
      const room = (Wi - side - kickGap - textWidth(kicker.text, "body800", kicker.size)) / Math.max(1, chars - 1);
      const besideKicker = room >= 0 && !kicker.text.endsWith("…");
      const top = besideKicker ? padTop : rowOff;
      // The due block stands under the tab; the row grows only when the two don't fit in the name's height
      const rh = Math.max(nameH, d.h, top + side + below + d.h - rowOff);
      const nt = rowOff + (rh - nameH) / 2;
      // The name's lines that stand beside the tab, and the widest of them
      let ty = nt;
      const beside = lineW.filter((_, i) => {
        const lineTop = ty;
        ty += above[i] + name.size * lh;
        return lineTop < top + side + below && ty > top;
      });
      return { side, top, track: besideKicker ? Math.min(kTrack, room) : kTrack, rh, nt, widest: Math.max(0, ...beside) };
    };
    // Never smaller than the due date
    let at = placeTab(Math.max(tab, d.dateSize));
    const nameGap = s.px(12);
    const fits = (p: typeof at) => p.widest <= Wi - p.side - nameGap;
    // A name too wide for the tab beside it (only when the date keeps little room): the tab takes the room there is, while
    // it holds a letter as large as the date; else the name goes under the tab
    if (!fits(at)) {
      const smaller = placeTab(floor2(Wi - nameGap - at.widest));
      if (smaller.side >= d.dateSize && fits(smaller)) at = smaller;
    }
    rowH = at.rh;
    nameTop = at.nt;
    if (!fits(at)) {
      nameTop = at.top + at.side + below;
      rowH = Math.max(rowH, nameTop + nameH - rowOff);
    }
    dueTop = Math.max(rowOff + (rowH - d.h) / 2, at.top + at.side + below);
    kickerTrack = at.track;
    filing = { letter, side: at.side, size: tabLetterSize(letter, at.side), x: xi + Wi - at.side, top: at.top };
  }
  const h = rowOff + rowH + padBottom;
  return {
    h,
    nameSize: name.size,
    nameLines: name.lines.length,
    tab: filing,
    kicker: { text: kicker.text, size: kicker.size },
    draw: (y) => {
      const out: LabelElement[] = [
        { kind: "rect", x: x0, y, w: W, h, fill: "ink", radius: s.px(4) },
        text(kicker.text, xi, baselineIn(y + padTop, "body800", kicker.size, 1.2), kicker.size, "body800", "paper", kickerTrack),
      ];
      if (filing) out.push(...tabElements(filing, y, s.px(3)));
      let ty = y + nameTop;
      name.lines.forEach((line, i) => {
        ty += above[i];
        out.push(text(line, xi, baselineIn(ty, "display900", name.size, lh), name.size, "display900", "paper"));
        ty += name.size * lh;
      });
      // The due block, right-aligned
      const right = xi + Wi;
      const alignRight = (e: LabelText) => ((e.x = right - e.width), e);
      let dy = y + dueTop;
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

/** The set and number in `maxW`: whole, else the set cut with "…" and the card number kept ("1999 Pokemon Base Set 1st Ed… #4/102"). */
export function setFitted(set: string, num: string, size: number, maxW: number): string {
  const whole = [set, num].filter(Boolean).join(" ");
  if (textWidth(whole, "body400", size) <= maxW) return whole;
  const room = maxW - textWidth(` ${num}`, "body400", size);
  // Keep the number while a useful piece of the set (4 em) still shows before it
  if (set && num && room >= 4 * size) return `${truncate(set, "body400", size, room)} ${num}`;
  return truncate(whole, "body400", size, maxW);
}

/**
 * One card row: an empty check box, the Card ID's number in mono, the name
 * in bold, set and number, and at the row's right end the PG field ("PG" and
 * a write-in line, the submitted pre-grade printed on it); a dashed rule
 * under it. The box is centered on the first line's capitals and the PG
 * field stands at the end of that line; a box taller than the line makes the
 * row taller. On one line; with `wrap`, a set and number that don't fit
 * beside the name go on a second line under it, across the whole width (so
 * they are never cut while a line holds them). Without `wrap`, a set that
 * doesn't fit is cut, or left out when little of it would show. With
 * `keepName` (tried first on the narrow label, with `wrap`), a name that
 * fits the whole line but not beside the PG field keeps the whole line, and
 * the field goes at the end of the set's line, or on a line of its own
 * under it.
 */
function cardRow(c: LabelCard, st: ListStyle, w: number, idW: number, gap: number, wrap: boolean, marks: Marks, keepName = false): { h: number; wrapped: boolean; cut: boolean; whole: boolean; draw: (x: number, y: number) => LabelElement[] } {
  const size = st.body;
  const lineH = size * 1.25;
  const rule = st.rules ? LABEL_LIMITS.minRulePt : 0;
  const g = rowGeometry(st, marks);
  // A line's width with nothing else on it, and before the PG field
  const full = w - g.textX(idW, gap);
  const pg = pgField(c, size, full);
  const beside = full - pg.w - g.pgGap;
  const name = printable(c.name, "body700") || "Unnamed card";
  const fullW = textWidth(name, "body700", size);
  // The field on the first line (the name cut to the room before it), unless the whole name is kept
  const pgFirst = !(wrap && keepName && fullW > beside && fullW <= full);
  const avail = pgFirst ? beside : full;
  const nameText = fullW <= avail ? name : truncate(name, "body700", size, avail);
  const nameW = textWidth(nameText, "body700", size);
  const set = printable(setLine(c), "body400");
  const setGap = size * 0.55;
  const setAvail = avail - nameW - setGap;
  const setW = textWidth(set, "body400", size);
  const wrapped = wrap && !!set && (fullW > avail || setW > setAvail);
  let setText: string;
  let cut = false;
  if (wrapped) {
    const parts = setParts(c);
    const [pSet, pNum] = [printable(parts.set, "body400"), printable(parts.num, "body400")];
    setText = setFitted(pSet, pNum, size, full);
    cut = setText !== [pSet, pNum].filter(Boolean).join(" ");
  } else {
    // The set in full, or cut only when most of it still shows (a stub like "1986 Fle…" is noise)
    setText = set && fullW <= avail && (setW <= setAvail || setAvail >= Math.max(4 * size, 0.8 * setW)) ? truncate(set, "body400", size, setAvail) : "";
  }
  const textLines = wrapped ? 2 : 1;
  // Where the PG field goes: 0 the first line; else the set's line when the set leaves it room, else a line of its own
  const pgLine = pgFirst ? 0 : wrapped && textWidth(setText, "body400", size) <= beside ? 1 : textLines;
  const lines = Math.max(textLines, pgLine + 1);
  const h = g.height(lines, pgLine === lines - 1 ? pg.below : 0) + rule;
  return {
    h,
    wrapped,
    cut,
    // The set and number show in full (or the card has none)
    whole: !set || (wrapped ? !cut : setText === set),
    draw: (x, y) => {
      const lineTop = (i: number) => y + g.firstTop + i * lineH;
      const base = baselineIn(lineTop(0), "body700", size, 1.25);
      const idX = x + marks.box + g.boxGap;
      const nameEl = text(nameText, idX + idW + gap, base, size, "body700", "ink");
      const out: LabelElement[] = [
        // The check box: empty, outline only, centered on the first line's capitals
        { kind: "rect", x, y: y + g.boxMid - marks.box / 2, w: marks.box, h: marks.box, stroke: "ink", strokeWidth: ROW_MARKS.boxStrokePt },
        text(rowId(c), idX, base, size, "mono600", "ink"),
        nameEl,
      ];
      if (setText && wrapped) out.push(text(setText, nameEl.x, baselineIn(lineTop(1), "body400", size, 1.25), size, "body400", "ink"));
      else if (setText) out.push(text(setText, nameEl.x + nameEl.width + setGap, base, size, "body400", "ink"));
      out.push(...pg.draw(x + w, baselineIn(lineTop(pgLine), "body800", size, 1.25)));
      if (rule) out.push({ kind: "line", x1: x, y1: y + h - rule / 2, x2: x + w, y2: y + h - rule / 2, width: rule, color: "ink", dash: [2, 2] });
      return out;
    },
  };
}

/**
 * Where a row's parts sit, in one style (offsets from the row's top): the
 * check box's middle, the first line's top, the gaps around the box and
 * before the PG field, and the row's height (rule excluded) for a number of
 * lines. The box is centered on the first line's capitals; when it is
 * taller than the line with its padding, the line moves down to its middle.
 */
function rowGeometry(st: ListStyle, marks: Marks) {
  const size = st.body;
  const lineH = size * 1.25;
  // The capitals' middle, from a line's top
  const capMid = baselineIn(0, "body700", size, 1.25) - ((FONT_METRICS.body700.capHeight / 1000) * size) / 2;
  const boxMid = Math.max(st.pad + capMid, ROW_MARKS.boxMarginPt + marks.box / 2);
  const firstTop = boxMid - capMid;
  const boxGap = size * 0.5;
  return {
    boxMid,
    firstTop,
    boxGap,
    /** Between the name (or set) and the PG field. */
    pgGap: size * 0.8,
    /** Where the name starts, from the column's left. */
    textX: (idW: number, gap: number) => marks.box + boxGap + idW + gap,
    /** `below`: how far the PG line reaches under its line's box (it may stand on the last line). */
    height: (lines: number, below = 0) => Math.max(firstTop + lines * lineH + Math.max(st.pad, below), boxMid + marks.box / 2 + ROW_MARKS.boxMarginPt),
  };
}

/**
 * The PG field at a row's right end: "PG" in bold, then a write-in line a
 * sixth of the row's text width (18 to 30 pt). A submitted pre-grade is
 * printed on the line, centered (the line grows for a long one, up to
 * ROW_MARKS.pgValueShare of the width, then it is cut with "…"). `w` is
 * its whole width; `below` how far the line reaches under the text line's
 * box; `draw` takes the right edge and the baseline.
 */
function pgField(c: Pick<LabelCard, "pregrade">, size: number, lineW: number): { w: number; below: number; draw: (right: number, base: number) => LabelElement[] } {
  const labelW = textWidth(ROW_MARKS.pgLabel, "body800", size);
  const labelGap = size * 0.3;
  const blank = Math.min(ROW_MARKS.pgLineMaxPt, Math.max(ROW_MARKS.pgLineMinPt, lineW * ROW_MARKS.pgLineShare));
  const inset = size * 0.25;
  const most = Math.max(blank, lineW * ROW_MARKS.pgValueShare - labelW - labelGap);
  const raw = printable(c.pregrade, "body800");
  const value = raw ? truncate(raw, "body800", size, most - 2 * inset) : "";
  const line = value ? Math.min(most, Math.max(blank, textWidth(value, "body800", size) + 2 * inset)) : blank;
  const ruleW = LABEL_LIMITS.minRulePt;
  // The line's middle under the baseline: clear of the digits, inside the row
  const drop = Math.max(1.2, size * 0.18);
  const lineH = size * 1.25;
  const below = Math.max(0, baselineIn(0, "body800", size, 1.25) + drop + ruleW / 2 - lineH);
  return {
    w: labelW + labelGap + line,
    below,
    draw: (right, base) => {
      const x1 = right - line;
      const out: LabelElement[] = [
        text(ROW_MARKS.pgLabel, x1 - labelGap - labelW, base, size, "body800", "ink"),
        { kind: "line", x1, y1: base + drop, x2: right, y2: base + drop, width: ruleW, color: "ink" },
      ];
      if (value) {
        const v = text(value, 0, base, size, "body800", "ink");
        v.x = x1 + (line - v.width) / 2;
        out.push(v);
      }
      return out;
    },
  };
}

/**
 * The bag's card rows in one style: `cards` down one column, or down the
 * left column then the right, split where the columns come out most even.
 * `wrap`, `keepName`: see cardRow.
 */
function rowsBlock(cards: LabelCard[], st: ListStyle, xi: number, Wi: number, colGap: number, wrap: boolean, marks: Marks, keepName = false): Block & { wrapped: number; cut: number; whole: number } {
  const idW = Math.max(0, ...cards.map((c) => textWidth(rowId(c), "mono600", st.body)));
  const gap = st.body * 0.6;
  const colW = st.cols === 2 ? (Wi - colGap) / 2 : Wi;
  const rows = cards.map((c) => cardRow(c, st, colW, idW, gap, wrap, marks, keepName));
  const total = rows.reduce((sum, r) => sum + r.h, 0);
  // The left column's rows: all of them, or for two columns the split with the lower taller column (ties: more on the left)
  let split = rows.length;
  if (st.cols === 2) {
    let best = Infinity;
    let left = 0;
    for (let i = 0; i <= rows.length; i++) {
      const tallest = Math.max(left, total - left);
      if (tallest <= best + 1e-9) [best, split] = [tallest, i];
      left += rows[i]?.h ?? 0;
    }
  }
  const leftH = rows.slice(0, split).reduce((sum, r) => sum + r.h, 0);
  return {
    h: Math.max(leftH, total - leftH),
    wrapped: rows.filter((r) => r.wrapped).length,
    cut: rows.filter((r) => r.cut).length,
    whole: rows.filter((r) => r.whole).length,
    draw: (y) => {
      const out: LabelElement[] = [];
      let ty = y;
      rows.forEach((r, i) => {
        if (i === split) ty = y;
        out.push(...r.draw(xi + (i < split ? 0 : colW + colGap), ty));
        ty += r.h;
      });
      return out;
    },
  };
}

/** The height of one single-line row in this style (its check box and PG field included). */
function rowHeight(st: ListStyle, marks: Marks): number {
  const g = rowGeometry(st, marks);
  return g.height(1, pgField({}, st.body, 0).below) + (st.rules ? LABEL_LIMITS.minRulePt : 0);
}

/** Can this style be used on this width at all? */
function usable(st: ListStyle, cards: LabelCard[], Wi: number, colGap: number, twoColsFit: boolean, marks: Marks): boolean {
  if (st.narrowOnly) return !twoColsFit;
  if (st.cols === 1) return true;
  const idW = Math.max(0, ...cards.map((c) => textWidth(rowId(c), "mono600", st.body)));
  const g = rowGeometry(st, marks);
  const full = (Wi - colGap) / 2 - g.textX(idW, st.body * 0.6);
  return full - g.pgGap - pgField({}, st.body, full).w >= MIN_NAME_W;
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
function bottomBlock(s: S, xi: number, Wi: number, bag: LabelBag, cap: number, narrow = false): Block {
  const data = bagQrData(bag);
  const qr = qrSide(data, Math.max(LABEL_LIMITS.minBagQrIn, s.px(100) / PT));
  const rule = s.rule(2);
  const padTop = Math.max(s.sp(10), 3 * qr.module);
  const colGap = Math.max(s.px(12), 3 * qr.module);
  const beside = Wi - qr.size - colGap >= 84;
  if (!beside && narrow) return narrowBottomBlock(s, xi, Wi, bag, cap, data, qr, rule, colGap);
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
  const scan = wrapLines(BAG_QR_CAPTION, "body800", scanSize, colW, 2, scanTrack);
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

/**
 * The bottom of a label printed under 2 in wide (50 x 80 mm): the bag QR (1 in)
 * at the left, and in the narrow column at its right the card count, the
 * received date and "SCAN TO OPEN THE ORDER" (BAG_QR_CAPTION), each wrapped to the
 * column; the received date goes first when the column would stand taller
 * than the QR. The Bag ID is on the tier row above.
 */
function narrowBottomBlock(s: S, xi: number, Wi: number, bag: LabelBag, cap: number, data: string, qr: { size: number; module: number }, rule: number, colGap: number): Block {
  const padTop = Math.max(s.sp(10), 2 * qr.module);
  const colW = Wi - qr.size - colGap;
  const min = LABEL_LIMITS.minTextPt;
  const count = fitLine(cardCountText(bag.cards.length), "display900", Math.min(cap, 13), colW, min, 0.2);
  const recvDay = parseDay(bag.receivedOn);
  const small = min;
  const recvLines = recvDay ? wrapLines(`Received ${MONTHS[recvDay.m - 1]} ${recvDay.d}`, "body800", small, colW, 2) : [];
  const scanTrack = 0.3;
  const scan = wrapLines(BAG_QR_CAPTION, "body800", small, colW, 5, scanTrack);
  const gap = 2.5;
  type Line = [string, FontRole, number, number, number];
  const head: Line[] = [[count.text, "display900", count.size, 1.05, 0.2]];
  const recv: Line[] = recvLines.map((l): Line => [l, "body800", small, 1.2, 0]);
  const scans: Line[] = scan.map((l): Line => [l, "body800", small, 1.25, scanTrack]);
  const height = (groups: Line[][]) => groups.reduce((sum, g) => sum + g.reduce((a, l) => a + l[2] * l[3], 0), 0) + gap * (groups.filter((g) => g.length).length - 1);
  const groups = height([head, recv, scans]) <= qr.size ? [head, recv, scans] : [head, scans];
  const colH = height(groups);
  const bodyH = Math.max(qr.size, colH);
  return {
    h: rule + padTop + bodyH,
    draw: (y) => {
      const top = y + rule + padTop;
      const out: LabelElement[] = [
        { kind: "rect", x: xi, y, w: Wi, h: rule, fill: "ink" },
        { kind: "qr", data, x: xi, y: top + (bodyH - qr.size) / 2, size: qr.size, alt: `QR code for bag ${bag.bagCode}` },
      ];
      const tx = xi + qr.size + colGap;
      let ty = top + (bodyH - colH) / 2;
      groups.filter((g) => g.length).forEach((g, gi) => {
        if (gi) ty += gap;
        for (const [t, font, size, lh, tracking] of g) {
          out.push(text(t, tx, baselineIn(ty, font, size, lh), size, font, "ink", tracking));
          ty += size * lh;
        }
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
  const narrow = W < NARROW_BELOW;
  const marks: Marks = { box: narrow ? ROW_MARKS.narrowBoxPt : ROW_MARKS.boxPt, narrow };
  return { W, x0, xi: x0 + inset, Wi: W - 2 * inset, s: sizes(W - 2 * inset, density), narrow, marks };
}

/** Labels printed narrower than this (the 50 x 80 mm label: 1.77 in) put the QR's words in a narrow column beside it. */
const NARROW_BELOW = 2 * PT - 0.5;

/**
 * The card rows in `room`: the first style that holds every card, else the
 * last usable one, with the whole rows that fit above "+N more" (in the
 * largest type of its columns that lists as many: where the check box sets
 * the rows' height, smaller type gains no row); then, where that style would
 * cut or leave out a set and number, the same style or a smaller one (never
 * more columns, which would cut the names) with the set and number on a
 * second line under the name. On the narrow label each style is tried first
 * with whole names (the PG field under a name too long to stand beside it),
 * then with the names cut before the field.
 */
function fitList(cards: LabelCard[], room: number, xi: number, Wi: number, colGap: number, marks: Marks) {
  const twoColsFit = LIST_STYLES.some((st) => st.cols === 2 && usable(st, cards, Wi, colGap, true, marks));
  const ok = (st: ListStyle) => usable(st, cards, Wi, colGap, twoColsFit, marks);
  let style = -1;
  let shown = cards;
  for (let i = 0; i < LIST_STYLES.length; i++) {
    const st = LIST_STYLES[i];
    if (!ok(st)) continue;
    style = i;
    const perCol = st.cols === 2 ? Math.ceil(cards.length / 2) : cards.length;
    if (perCol * rowHeight(st, marks) <= room) break;
    if (i === LIST_STYLES.length - 1 || !LIST_STYLES.slice(i + 1).some(ok)) {
      // Out of room: whole rows that fit above the "+N more" line
      const h = rowHeight(st, marks);
      style = LIST_STYLES.findIndex((n, j) => j <= i && n.cols === st.cols && ok(n) && rowHeight(n, marks) <= h + 1e-9);
      const pick = LIST_STYLES[style];
      const more = moreLine(cards.length, xi, Wi, pick);
      const rows = Math.max(0, Math.floor((room - more.h) / rowHeight(pick, marks)));
      shown = cards.slice(0, Math.min(cards.length, rows * pick.cols));
      break;
    }
  }
  let list = rowsBlock(shown, LIST_STYLES[style], xi, Wi, colGap, false, marks);
  if (shown.length === cards.length && list.h <= room) {
    // The first style that holds the rows with their sets; on the narrow label
    // (where a set rarely fits at full size) the first that also cuts none, if any
    let pick: [number, typeof list] | null = null;
    for (let i = style; i < LIST_STYLES.length; i++) {
      const st = LIST_STYLES[i];
      if (st.cols > LIST_STYLES[style].cols || !ok(st)) continue;
      for (const keepName of marks.narrow ? [true, false] : [false]) {
        const full = rowsBlock(cards, st, xi, Wi, colGap, true, marks, keepName);
        if (full.h > room) continue;
        pick ??= [i, full];
        if (!marks.narrow || !full.cut) {
          pick = [i, full];
          break;
        }
      }
      if (pick && (!marks.narrow || !pick[1].cut)) break;
    }
    if (pick) [style, list] = pick;
  }
  return { style, shown, list };
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
  /** Rows whose set and number went on a second line under the card name. */
  wrapped: number;
  /** The customer name's type size and number of lines. */
  nameSize: number;
  nameLines: number;
  /** The side of each card row's check box, in points (ROW_MARKS: 4 mm, 3 mm on 50 x 80 mm). */
  checkBox: number;
  /**
   * The filing tab: the Open bags box letter ("R"), the tab's side and the
   * letter's type size, in points. `inKicker`: no room for a tab without
   * making the name smaller or hiding every card, so the letter is in the
   * kicker ("FILE UNDER R · THE CARD DOC"; side 0, size the kicker's). Null:
   * laid out without it (`filingTab: false`).
   */
  filing: { letter: string; side: number; size: number; inKicker?: true } | null;
};

/**
 * The bag's label and how its cards were fitted. `filingTab: false` lays it
 * out without the filing tab, as before it (for comparing; nothing prints that way).
 */
export function planBagLabel(bag: LabelBag, stock: LabelStock, opts: { filingTab?: boolean } = {}): { page: LabelPage; fit: LabelFit } {
  const { W, x0, xi, Wi, s, narrow, marks } = frame(stock);
  const cards = [...bag.cards].sort((a, b) => a.seq - b.seq);
  const padY = Math.max(0.08 * PT, s.sp(12) * 0.6);
  const stockTab = opts.filingTab === false ? 0 : tabSide(s);

  // The whole fit with the stock's tab (0: none; `letterInKicker`: the letter in the kicker instead)
  const fitAll = (fullTab: number, letterInKicker: boolean) => {
    // The banner first: nothing else on the label is as large as the name
    const place = (nameScale: number, withAlso: boolean, tab = fullTab) => {
      const top = banner(s, x0, W, xi, Wi, bag, nameScale, tab, letterInKicker);
      const cap = top.nameSize * 0.9;
      const tier = tierRow(s, xi, Wi, bag, cap);
      const bottom = bottomBlock(s, xi, Wi, bag, cap, narrow);
      const also = withAlso ? alsoBlock(s, xi, Wi, bag) : null;
      const tierY = padY + top.h + s.sp(10);
      const listTop = tierY + tier.h;
      const bottomY = stock.pageH - padY - bottom.h;
      const alsoY = also ? bottomY - s.sp(8) - also.h : bottomY;
      return { top, tier, bottom, also, tierY, listTop, bottomY, alsoY, room: alsoY - s.sp(6) - listTop };
    };
    // On short stock a long name can leave no room for even the "+N more" line:
    // then "Also in this order" goes (the QR shows the whole order), then the
    // filing tab gets smaller (never below the due date), then the name is set smaller
    const need = moreLine(cards.length, xi, Wi, LIST_STYLES[cards.length ? LIST_STYLES.length - 1 : 0]).h;
    let at = place(1, true);
    if (at.room < need && at.also) at = place(1, false);
    let tab = fullTab;
    for (let t = fullTab * 0.85; fullTab && at.room < need && t > 1; t *= 0.85) {
      at = place(1, false, t);
      tab = t;
      if (at.top.tab && at.top.tab.side > t + 1e-9) break;
    }
    // The smallest tab: a letter the size of the due date (banner())
    if (fullTab && at.room < need) tab = 1;
    for (let k = 0.85; at.room < need && k > 0.3; k *= 0.85) at = place(k, false, tab);
    const colGap = Math.max(6, s.px(14));
    let fitted = fitList(cards, at.room, xi, Wi, colGap, marks);
    // "Also in this order" gives way (the QR shows the whole order): on the narrow label to every card
    // listed, then every set and number in full; on any label to cards the filing tab would hide. The
    // tab keeps its size (the same on every bag of a stock): when the cards still don't all fit, the
    // last rows go behind "+N more: scan the QR".
    if (at.also && (fitted.shown.length < cards.length || (narrow && fitted.list.whole < cards.length))) {
      const without = place(1, false, tab);
      const refit = fitList(cards, without.room, xi, Wi, colGap, marks);
      const more = refit.shown.length > fitted.shown.length;
      const tabHides = () => fullTab > 0 && fitList(cards, place(1, true, 0).room, xi, Wi, colGap, marks).shown.length > fitted.shown.length;
      const wholer = refit.shown.length === fitted.shown.length && refit.list.whole > fitted.list.whole;
      if (narrow ? more || wholer : more && tabHides()) [at, fitted] = [without, refit];
    }
    return { at, fitted };
  };
  // The tab never makes the name smaller and never hides every card: where even its smallest size would
  // (4 x 3 in), the label is laid out as without it and the letter goes in the kicker
  let best = fitAll(stockTab, false);
  if (stockTab) {
    const bare = fitAll(0, true);
    const smaller = best.at.top.nameSize < bare.at.top.nameSize - 1e-9;
    const hidesAll = cards.length > 0 && !best.fitted.shown.length && bare.fitted.shown.length > 0;
    if (smaller || hidesAll) best = bare;
  }
  const { at, fitted } = best;
  const { top, tier, bottom, also, tierY, listTop, bottomY, alsoY } = at;
  const { shown, list } = fitted;
  const style = fitted.style;

  const els: LabelElement[] = [...top.draw(padY)];
  els.push(...tier.draw(tierY));
  els.push(...bottom.draw(bottomY));
  if (also) els.push(...also.draw(alsoY));

  const st = LIST_STYLES[style];
  const cardCodes = shown.map((c) => c.code);
  if (shown.length) els.push(...list.draw(listTop));
  const more = cards.length - shown.length;
  if (more) els.push(...moreLine(more, xi, Wi, st).draw(listTop + list.h));
  else if (!cards.length) els.push(...moreLine(0, xi, Wi, st).draw(listTop).map((e) => (e.kind === "text" ? { ...e, text: "No cards in this bag", width: textWidth("No cards in this bag", e.font, e.size) } : e)));

  return {
    page: { width: stock.pageW, height: stock.pageH, elements: els, cardCodes },
    fit: {
      style,
      cols: st.cols,
      bodyPt: st.body,
      shown: shown.length,
      more,
      wrapped: list.wrapped,
      nameSize: top.nameSize,
      nameLines: top.nameLines,
      checkBox: marks.box,
      filing: top.tab
        ? { letter: top.tab.letter, side: top.tab.side, size: top.tab.size }
        : top.kicker.text.startsWith("FILE UNDER ") ? { letter: filingLetter(bag.customerName), side: 0, size: top.kicker.size, inKicker: true } : null,
    },
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
