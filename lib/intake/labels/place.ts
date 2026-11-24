import { adminStageLabel } from "@/lib/restoration-stages";
import { DAYS, LABEL_LIMITS, MONTHS, PT, fitName, floor2, parseDay, printedWidth, qrSide, text } from "./layout";
import { labelQrData, qrMatrix } from "./qr";
import { baselineIn, fitLine, printable, textWidth, wrapLines } from "./text";
import type { LabelElement, LabelPage, LabelStock } from "./types";

// Place labels: the QR label stuck on each SLOT (a serial-numbered holder: a
// clamp, a heat press spot, a humidor spot… "CLAMP 07"), and the signs for the
// due-date shelf slots ("DUE MON DEC 7"), Done and Shipping. Made for the
// Katasymbol's 50 x 80 mm labels (portrait) and laid out the same way on the
// other stocks (4x6 for a big shelf sign). Design B's language, black only:
//
//   a black banner: "THE CARD DOC · SLOT", then the place's name huge in
//   white; a slot's serial number ("07") on its own line, larger still
//   the step a slot's cards are in ("STEP  Clamp Work"), or what the place is
//   a rule, then ONE QR (never under 1 in) holding qrUrl(code), centered
//   the code under it in mono (LOC-CLAMP-07), and one tiny line of what a scan does
//   ("SCAN TO ADD OR MOVE CARDS")
//
// Sizes are set for the 50 x 80 mm label and scale with the printed width.
// The QR gets its preferred size first, the name and serial what is left
// (never below the name's minimum); a long name steps down, then the QR goes
// to its minimum, then everything steps down together.

/** Everything a place label shows (a `locations` row). */
export type LabelPlace = {
  /** LOC-CLAMP-07, LOC-SHELF-20261207, LOC-DONE, LOC-SHIP: the QR opens it. */
  code: string;
  /** "CLAMP 07", "DUE MON DEC 7", "Done", "Shipping". */
  name: string;
  /** 'station' (a slot of a station type), 'shelf', 'done', 'shipping', 'other'. */
  kind: string;
  /** A slot's step: a stored STAGES name ("Clamp Work"; "Book" prints as "Drying"). */
  stage?: string | null;
  /** A shelf slot's due date, YYYY-MM-DD. */
  dueDate?: string | null;
  /** A slot's serial number (7 for CLAMP 07). */
  serial?: number | null;
  /** What the QR holds; defaults to qrUrl(code). */
  qrUrl?: string | null;
};

export const PLACE_LIMITS = {
  /** The QR on a place label is never smaller than this. */
  minQrIn: 1,
} as const;

/** The inner width of a 50 x 80 mm label (printed width less the banner inset), in points: the sizes below are set for it. */
const REF_WI = 117.15;
/** White kept at the top and bottom of the label (die-cut labels shift about 1 mm). */
const PAD_Y = 0.08 * PT;

/** What the place's QR holds: the stable upper-case /q/<CODE> address. */
export function placeQrData(place: Pick<LabelPlace, "code" | "qrUrl">): string {
  return place.qrUrl?.toUpperCase() || labelQrData(place.code);
}

/** "Mon, Dec 7, 2026" */
function longDay(day: string | null | undefined): string | null {
  const p = parseDay(day);
  return p ? `${DAYS[p.wd]}, ${MONTHS[p.m - 1]} ${p.d}, ${p.y}` : null;
}

/** The kicker in the banner: what kind of place this is. */
export function placeKicker(place: Pick<LabelPlace, "kind">): string {
  return `THE CARD DOC · ${place.kind === "station" ? "SLOT" : place.kind === "shelf" ? "SHELF" : "PLACE"}`;
}

/**
 * A slot's name in two parts: the station ("CLAMP", "HEAT PRESS") and its
 * serial number as named ("07"), when the name ends with it. Other places,
 * and a slot renamed to something without its number, keep the whole name.
 */
export function slotNameParts(place: Pick<LabelPlace, "name" | "kind" | "serial">): { head: string; serial: string | null } {
  const name = printable(place.name.toUpperCase(), "display900") || "PLACE";
  if (place.kind !== "station" && place.serial == null) return { head: name, serial: null };
  const m = /^(.*\S)\s+(\d{1,4})$/.exec(name);
  if (!m || (place.serial != null && Number(m[2]) !== place.serial)) return { head: name, serial: null };
  return { head: m[1], serial: m[2] };
}

/** The line under the banner: a slot's step, a shelf slot's date, or what the place is for. */
export function placeSubLine(place: Pick<LabelPlace, "kind" | "stage" | "dueDate">): { label: string; value: string } | null {
  if (place.kind === "station") return place.stage ? { label: "STEP", value: adminStageLabel(place.stage) } : null;
  if (place.kind === "shelf") {
    const day = longDay(place.dueDate);
    return day ? { label: "DUE", value: day } : null;
  }
  if (place.kind === "done") return { label: "", value: "Finished cards" };
  if (place.kind === "shipping") return { label: "", value: "Ship check: scan the bag or order" };
  return null;
}

/** The tiny line at the foot of the label: what a scan here does. */
export function placeFooter(place: Pick<LabelPlace, "kind">): string {
  return place.kind === "station" ? "SCAN TO ADD OR MOVE CARDS" : "SCAN TO SEE WHAT'S HERE";
}

type Try = { k: number; cap: number; qrMin: number };

function build(place: LabelPlace, stock: LabelStock, t: Try): { elements: LabelElement[]; fits: boolean; nameSize: number; qrSize: number } {
  const W = printedWidth(stock);
  const x0 = (stock.pageW - W) / 2;
  const inset = Math.min(0.1 * PT, W * 0.04);
  const xi = x0 + inset;
  const Wi = W - 2 * inset;
  const { k } = t;
  const min = LABEL_LIMITS.minTextPt;
  const fs = (n: number) => Math.max(min, floor2(n * k));

  // ── Measure ──
  const padTop = 5 * k;
  const padBottom = 5.5 * k;
  const kTrack = 1.1 * k;
  const kicker = fitLine(placeKicker(place), "body800", fs(7), Wi, min, kTrack);
  const kGap = 3 * k;
  const { head, serial } = slotNameParts(place);
  const lh = 0.9;
  let nameLines: string[];
  let nameSize: number;
  let serialSize = 0;
  if (serial) {
    // The station on one line, the number under it as large as the room allows
    const h = fitLine(head, "display900", Math.min(t.cap * 0.5, 32 * k), Wi, min);
    nameLines = [h.text];
    nameSize = h.size;
    serialSize = floor2(Math.max(nameSize * 1.2, Math.min(t.cap, Wi / (textWidth(serial, "display900", 1) || 1))));
  } else {
    const f = fitName(head, "display900", Wi, t.cap, 3);
    nameLines = f.lines;
    nameSize = f.size;
  }
  const above = nameLines.map((l) => (/[̀-̕]/.test(l.normalize("NFD")) ? 0.2 * nameSize : 0));
  const nameH = nameLines.length * nameSize * lh + above.reduce((a, b) => a + b, 0);
  const serialGap = serial ? 1.5 * k : 0;
  const serialH = serial ? serialSize * 0.86 : 0;
  const bannerH = padTop + kicker.size * 1.2 + kGap + nameH + serialGap + serialH + padBottom;

  const sub = placeSubLine(place);
  const subLabelSize = fs(7);
  const subTrack = 1 * k;
  const subLabelW = sub?.label ? textWidth(sub.label, "body800", subLabelSize, subTrack) + 4 * k : 0;
  let subSize = fs(12);
  let subLines: string[] = [];
  if (sub) {
    const value = printable(sub.value, "body800");
    const one = fitLine(value, "body800", subSize, Wi - subLabelW, Math.max(min, fs(9)));
    if (!one.text.endsWith("…")) [subSize, subLines] = [one.size, [one.text]];
    else {
      subSize = Math.max(min, fs(9));
      subLines = wrapLines(value, "body800", subSize, Wi - subLabelW, 2);
    }
  }
  const subGap = 5 * k;
  const subH = subLines.length * subSize * 1.2;

  const rule = Math.max(LABEL_LIMITS.minRulePt, 1.5 * k);
  const data = placeQrData(place);
  const qrMin = qrSide(data, t.qrMin);
  const modules = qrMatrix(data).size;
  // White around the QR: at least 2.5 modules above it and 2 below, at the size it ends up
  const quietFor = (q: number) => Math.max(5 * k, (2.5 * q) / modules);
  const codeGapFor = (q: number) => Math.max(3 * k, (2 * q) / modules);
  const codeSize = fs(11);
  const code = fitLine(printable(place.code, "mono600") || "NO CODE", "mono600", codeSize, Wi, min);
  const footSize = fs(6.5);
  const footTrack = 0.5 * k;
  const foot = wrapLines(placeFooter(place), "body800", footSize, Wi, 2, footTrack);
  const footGap = 2.5 * k;

  const fixed = PAD_Y + bannerH + (subLines.length ? subGap + subH : 0) + subGap + rule + code.size * 1.15 + footGap + foot.length * footSize * 1.3 + PAD_Y;
  const room = stock.pageH - fixed;
  // The QR takes what is left (less its white), up to a size that leaves the label balanced
  const qrMax = Math.min(Wi, 1.4 * PT * Math.max(1, k));
  let qrSize = Math.min(qrMax, room);
  for (let i = 0; i < 30; i++) qrSize = Math.min(qrMax, room - quietFor(qrSize) - codeGapFor(qrSize));
  qrSize = floor2(qrSize);
  const quiet = quietFor(qrSize);
  const codeGap = codeGapFor(qrSize);
  const fits = qrSize >= qrMin.size - 1e-6 && qrSize + quiet + codeGap <= room + 0.01;

  // ── Draw ──
  const els: LabelElement[] = [];
  let y = PAD_Y;
  els.push({ kind: "rect", x: x0, y, w: W, h: bannerH, fill: "ink", radius: 3 * k });
  els.push(text(kicker.text, xi, baselineIn(y + padTop, "body800", kicker.size, 1.2), kicker.size, "body800", "paper", kTrack));
  let ty = y + padTop + kicker.size * 1.2 + kGap;
  nameLines.forEach((line, i) => {
    ty += above[i];
    els.push(text(line, xi, baselineIn(ty, "display900", nameSize, lh), nameSize, "display900", "paper"));
    ty += nameSize * lh;
  });
  if (serial) {
    ty += serialGap;
    // Digits have no descender: the baseline sits at the foot of the line box
    els.push(text(serial, xi, ty + serialSize * 0.8, serialSize, "display900", "paper"));
  }
  y += bannerH;

  if (subLines.length && sub) {
    y += subGap;
    subLines.forEach((l, i) => {
      const base = baselineIn(y, "body800", subSize, 1.2);
      if (i === 0 && sub.label) els.push(text(sub.label, xi, base, subLabelSize, "body800", "ink", subTrack));
      els.push(text(l, xi + subLabelW, base, subSize, "body800", "ink"));
      y += subSize * 1.2;
    });
  }
  y += subGap;
  els.push({ kind: "rect", x: xi, y, w: Wi, h: rule, fill: "ink" });
  y += rule;

  // The QR, the code and the footer, centered in what is left
  const restH = quiet + qrSize + codeGap + code.size * 1.15 + footGap + foot.length * footSize * 1.3;
  const spare = Math.max(0, stock.pageH - PAD_Y - y - restH);
  y += quiet + spare / 2;
  const qx = xi + (Wi - qrSize) / 2;
  els.push({ kind: "qr", data, x: qx, y, size: qrSize, alt: `QR code for ${place.name}` });
  y += qrSize + codeGap;
  const center = (e: ReturnType<typeof text>) => ((e.x = xi + (Wi - e.width) / 2), e);
  els.push(center(text(code.text, 0, baselineIn(y, "mono600", code.size, 1.15), code.size, "mono600", "ink")));
  y += code.size * 1.15 + footGap;
  for (const l of foot) {
    els.push(center(text(l, 0, baselineIn(y, "body800", footSize, 1.3), footSize, "body800", "ink", footTrack)));
    y += footSize * 1.3;
  }
  return { elements: els, fits, nameSize: serial ? serialSize : nameSize, qrSize };
}

/** How a place label was fitted (for tests). */
export type PlaceFit = { scale: number; nameSize: number; qrSize: number };

/** One place's label: exactly one page at the stock's size. */
export function planPlaceLabel(place: LabelPlace, stock: LabelStock): { page: LabelPage; fit: PlaceFit } {
  const W = printedWidth(stock);
  const Wi = W - 2 * Math.min(0.1 * PT, W * 0.04);
  const kMax = Math.min(2.4, Math.max(0.75, Wi / REF_WI));
  const qrPref = (k: number) => 1.2 * Math.max(1, 0.85 * k);
  const qrLeast = (k: number) => PLACE_LIMITS.minQrIn * Math.max(1, 0.75 * k);
  // The QR at its preferred size while the name keeps most of its size; then
  // the QR at its least, the name down to about 40%; then everything smaller
  const tries: Try[] = [];
  for (let k = kMax; k >= 0.7; k = floor2(k * 0.92)) {
    for (const [qr, least] of [[qrPref(k), 44 * k], [qrLeast(k), 28 * k]]) {
      for (let cap = 72 * k; cap >= least; cap = floor2(cap * 0.92)) tries.push({ k, cap, qrMin: qr });
    }
  }
  let best = build(place, stock, tries[tries.length - 1]);
  let used = tries[tries.length - 1];
  for (const t of tries) {
    const b = build(place, stock, t);
    if (b.fits) {
      [best, used] = [b, t];
      break;
    }
  }
  return {
    page: { width: stock.pageW, height: stock.pageH, elements: best.elements, cardCodes: [] },
    fit: { scale: used.k, nameSize: best.nameSize, qrSize: best.qrSize },
  };
}

/** One place's label (always exactly one page). */
export function layoutPlaceLabel(place: LabelPlace, stock: LabelStock): LabelPage {
  return planPlaceLabel(place, stock).page;
}
