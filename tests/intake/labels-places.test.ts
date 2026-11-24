/**
 * The 50 x 80 mm Katasymbol stock (lib/intake/labels/stock.ts), the bag label
 * laid out on it (narrow mode), and place labels (lib/intake/labels/place.ts):
 * slot labels ("CLAMP 07": the name and serial huge, the step, one QR with
 * its code) and the shelf, Done and Shipping signs, on 50 x 80 mm and the
 * other stocks; the loader and the routes' PDF and JSON. Every page: one QR
 * holding qrUrl(code), at least 1 in with modules of 4+ dots at 203 dpi,
 * nothing under 6.5 pt, nothing overlapping, everything inside the label.
 * Writes sample PDFs to tests/intake/out/ (git-ignored).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { qrUrl } from "@/lib/intake/codes";
import { loadLabelPlaces } from "@/lib/intake/labels/data";
import { LABEL_LIMITS, PT, planBagLabel, printedWidth } from "@/lib/intake/labels/layout";
import { PLACE_LIMITS, codeLines, layoutPlaceLabel, placeSubLine, planPlaceLabel, slotNameParts, type LabelPlace } from "@/lib/intake/labels/place";
import { renderLabelPdf } from "@/lib/intake/labels/pdf";
import { qrMatrix } from "@/lib/intake/labels/qr";
import { labelResponse, placeLabelsResponse, placeSignResponse, type LabelPreviewResponse, type PlaceLabelsResponse, type PlaceSignResponse } from "@/lib/intake/labels/respond";
import {
  LABEL_STOCKS,
  MIN_CONTENT_WIDTH_IN,
  fullWidthPoints,
  normalizeLabelSettings,
  stockPixels,
  stockPoints,
  stockWidthRange,
  type LabelStockId,
} from "@/lib/intake/labels/stock";
import { FONT_METRICS } from "@/lib/intake/labels/fonts/metrics";
import type { LabelBag, LabelElement, LabelPage, LabelQr, LabelStock, LabelText } from "@/lib/intake/labels/types";

// The QR address is the business domain here, whatever the shell has set
delete process.env.NEXT_PUBLIC_APP_URL;

const MM50 = fullWidthPoints("50x80mm");
const texts = (p: LabelPage) => p.elements.filter((e): e is LabelText => e.kind === "text");
const qrs = (p: LabelPage) => p.elements.filter((e): e is LabelQr => e.kind === "qr");
const words = (p: LabelPage) => texts(p).map((t) => t.text);

type Box = { x1: number; x2: number; y1: number; y2: number };
/** What a text inks: cap height above the baseline, descenders below when it has letters that hang (g, j, p, q, y, commas). */
function textBox(t: LabelText): Box {
  const cap = FONT_METRICS[t.font].capHeight / 1000;
  const below = /[gjpqyQ,;()[\]{}|@$_]/.test(t.text) ? 0.24 : 0.02;
  return { x1: t.x, x2: t.x + t.width, y1: t.y - cap * t.size, y2: t.y + below * t.size };
}
function box(e: LabelElement): Box {
  if (e.kind === "text") return textBox(e);
  if (e.kind === "qr") return { x1: e.x, x2: e.x + e.size, y1: e.y, y2: e.y + e.size };
  if (e.kind === "line") return { x1: Math.min(e.x1, e.x2), x2: Math.max(e.x1, e.x2), y1: Math.min(e.y1, e.y2) - e.width / 2, y2: Math.max(e.y1, e.y2) + e.width / 2 };
  return { x1: e.x, x2: e.x + e.w, y1: e.y, y2: e.y + e.h };
}
const overlap = (a: Box, b: Box, pad = 0) => a.x1 < b.x2 + pad && b.x1 < a.x2 + pad && a.y1 < b.y2 + pad && b.y1 < a.y2 + pad;
const inside = (a: Box, b: Box) => a.x1 >= b.x1 - 0.01 && a.x2 <= b.x2 + 0.01 && a.y1 >= b.y1 - 0.01 && a.y2 <= b.y2 + 0.01;

/**
 * The checks every label on any stock must pass: page size, black only,
 * minimum text and rules, inside the printed width and the page, one QR with
 * `qrData` of at least `minQrIn` and 4-dot modules with 2 modules of white
 * around it, white text only on the black banner, and no two things inked on
 * top of each other.
 */
function checkPage(p: LabelPage, stock: LabelStock, qrData: string, minQrIn: number, label: string) {
  assert.equal(p.width, stock.pageW, `${label}: page width`);
  assert.equal(p.height, stock.pageH, `${label}: page height`);
  const W = printedWidth(stock);
  const area: Box = { x1: (stock.pageW - W) / 2, x2: (stock.pageW + W) / 2, y1: 0, y2: stock.pageH };
  for (const e of p.elements) {
    assert.ok(inside(box(e), area), `${label}: ${e.kind} ${e.kind === "text" ? `"${e.text}" ` : ""}inside the printed area`);
    if (e.kind === "text") {
      assert.ok(e.size >= LABEL_LIMITS.minTextPt - 1e-9, `${label}: "${e.text}" is ${e.size}pt`);
      assert.notEqual(e.color, "accent", `${label}: black only`);
      assert.ok(e.text.trim().length > 0, `${label}: no empty text`);
    }
    if (e.kind === "rect") {
      assert.ok(e.fill !== "accent" && e.stroke !== "accent", `${label}: black only`);
      if (e.fill && e.h < 3) assert.ok(e.h >= LABEL_LIMITS.minRulePt - 1e-9, `${label}: rule ${e.h}pt`);
    }
    if (e.kind === "line") assert.ok(e.width >= LABEL_LIMITS.minRulePt - 1e-9, `${label}: rule ${e.width}pt`);
  }

  const codes = qrs(p);
  assert.equal(codes.length, 1, `${label}: exactly one QR`);
  const [q] = codes;
  assert.equal(q.data, qrData, `${label}: QR data`);
  assert.ok(q.size >= minQrIn * PT - 1e-6, `${label}: QR ${(q.size / PT).toFixed(3)} in`);
  const moduleSize = q.size / qrMatrix(q.data).size;
  assert.ok(moduleSize >= LABEL_LIMITS.moduleIn * PT - 1e-9, `${label}: QR module ${(moduleSize / PT).toFixed(4)} in`);
  assert.ok((moduleSize / PT) * 203 >= 4 - 1e-9, `${label}: QR module ${((moduleSize / PT) * 203).toFixed(1)} dots at 203 dpi`);

  // White text sits on a black rect; black text, rules and the QR never touch each other
  const inkRects = p.elements.filter((e) => e.kind === "rect" && e.fill === "ink");
  const ink = p.elements.filter((e) => !(e.kind === "text" && e.color === "paper") && !(e.kind === "rect" && e.h > 3));
  for (const t of texts(p).filter((t) => t.color === "paper")) {
    assert.ok(inkRects.some((r) => inside(textBox(t), box(r))), `${label}: white "${t.text}" on the banner`);
  }
  for (const e of ink) {
    if (e.kind === "text") assert.ok(!inkRects.some((r) => r.kind === "rect" && r.h > 3 && overlap(box(e), box(r))), `${label}: "${e.text}" clear of the banner`);
    if (e.kind === "qr") assert.ok(!inkRects.some((r) => overlap(box(e), box(r), 2 * module)), `${label}: QR quiet zone clear of rules and the banner`);
  }
  for (let i = 0; i < ink.length; i++) {
    for (let j = i + 1; j < ink.length; j++) {
      const [a, b] = [ink[i], ink[j]];
      const pad = a.kind === "qr" || b.kind === "qr" ? 2 * module : 0;
      assert.ok(!overlap(box(a), box(b), pad), `${label}: ${a.kind === "text" ? `"${a.text}"` : a.kind} overlaps ${b.kind === "text" ? `"${b.text}"` : b.kind}`);
    }
  }
  const white = texts(p).filter((t) => t.color === "paper");
  for (let i = 0; i < white.length; i++) {
    for (let j = i + 1; j < white.length; j++) assert.ok(!overlap(textBox(white[i]), textBox(white[j])), `${label}: "${white[i].text}" overlaps "${white[j].text}"`);
  }
}

// ── The stock ───────────────────────────────────────────────────────────────

test("50 x 80 mm stock: portrait, the whole label wide, 400 x 640 dots at 203 dpi; the inch stocks keep their 2 in minimum", () => {
  const s = LABEL_STOCKS["50x80mm"];
  assert.ok(Math.abs(s.widthIn * 25.4 - 50) < 1e-9 && Math.abs(s.heightIn * 25.4 - 80) < 1e-9);
  assert.equal(s.dpi, 203);
  assert.deepEqual(stockPixels("50x80mm"), { width: 400, height: 640, dpi: 203 });
  // The setting is always the whole label, whatever was saved
  for (const w of [undefined, "1", "1.8", "3.2", 7]) assert.deepEqual(normalizeLabelSettings("50x80mm", w), { stock: "50x80mm", contentWidthIn: 1.96 });
  // The settings route checks MIN_CONTENT_WIDTH_IN <= width <= the label's width: 1.96 passes
  assert.ok(MIN_CONTENT_WIDTH_IN <= 1.96 && 1.96 <= s.widthIn);
  assert.deepEqual(stockWidthRange("50x80mm"), { min: 1.75, max: 1.96 });
  for (const id of ["4x6", "4x3", "3x5"] as const) assert.equal(stockWidthRange(id).min, 2);
  assert.deepEqual(normalizeLabelSettings("4x6", "1.8"), { stock: "4x6", contentWidthIn: 2 });
  // Printed 2.5 mm in from each side: inside the Katasymbol's 48 mm head
  const W = printedWidth(stockPoints("50x80mm", 1.96));
  assert.ok((W / PT) * 25.4 <= 48 && (W / PT) * 25.4 >= 44, `${((W / PT) * 25.4).toFixed(1)} mm`);
});

// ── The bag label on 50 x 80 mm ─────────────────────────────────────────────

const NAMES = ["Michael Jordan", "Shohei Ohtani", "Tom Brady", "Stephen Curry", "Charizard ex Special Illustration Rare Holo First Edition Shadowless", "Pikachu Illustrator", "Mewtwo", "Ken Griffey Jr.", "Derek Jeter"];
function bag(n: number, over: Partial<LabelBag> = {}): LabelBag {
  return {
    bagCode: "CD-10482-P",
    tierName: "Platinum",
    orderNumber: "CD-10482",
    customerName: "Jordan Reyes",
    receivedOn: "2026-11-15",
    dueDate: "2026-12-07",
    otherBags: [{ bagCode: "CD-10482-G", tierName: "Gold", cardCount: 2 }],
    cards: Array.from({ length: n }, (_, i) => ({ seq: i + 3, code: `CD-10482-${String(i + 3).padStart(2, "0")}`, name: NAMES[i % NAMES.length], year: "1986", set: "Fleer Basketball", number: String(57 + i) })),
    ...over,
  };
}
const BAG_STOCK = stockPoints("50x80mm", normalizeLabelSettings("50x80mm", undefined).contentWidthIn);

test("bag label on 50 x 80 mm: one label, the 1 in QR with its words beside it, cards listed before +N more", () => {
  for (const n of [0, 1, 4, 16, 40, 120]) {
    for (const b of [bag(n), bag(n, { customerName: "Maximiliana Featherstonehaugh-Worthington", dueDate: "2027-01-04", tierName: "Fast Pass", bagCode: "CD-10482-F2" })]) {
      const { page, fit } = planBagLabel(b, BAG_STOCK);
      const label = `${n} cards, ${b.customerName}`;
      checkPage(page, BAG_STOCK, qrUrl(b.bagCode), LABEL_LIMITS.minBagQrIn, label);
      assert.equal(fit.shown + fit.more, n, `${label}: every card listed or counted`);
      assert.deepEqual(page.cardCodes, b.cards.slice(0, fit.shown).map((c) => c.code));
      if (fit.more) assert.ok(words(page).includes(`+${fit.more} more: scan the QR`), `${label}: +N more`);
      // The words sit beside the QR, not under it
      const q = qrs(page)[0];
      const count = texts(page).find((t) => /^\d+ CARDS?$/.test(t.text))!;
      assert.ok(count && count.x >= q.x + q.size && count.y > q.y && count.y < q.y + q.size, `${label}: card count beside the QR`);
      assert.ok(texts(page).some((t) => t.text === b.bagCode && t.font === "mono600"), `${label}: Bag ID on the tier row`);
    }
  }
  assert.equal(planBagLabel(bag(4), BAG_STOCK).fit.more, 0, "a 4-card bag lists every card");
  assert.ok(planBagLabel(bag(16), BAG_STOCK).fit.shown >= 6, "16 cards: at least 6 listed");
  // The inch stocks keep their layout: words under the QR at 2 in, beside it at 3.2 in
  const wide = planBagLabel(bag(4), stockPoints("4x6", 3.2)).page;
  assert.equal(texts(wide).filter((t) => t.text === "CD-10482-P" && t.font === "mono600").length, 2);
});

// ── Place labels ────────────────────────────────────────────────────────────

const SLOTS: LabelPlace[] = [
  { code: "LOC-CLAMP-07", name: "CLAMP 07", kind: "station", stage: "Clamp Work", serial: 7 },
  { code: "LOC-HEAT-PRESS-03", name: "HEAT PRESS 03", kind: "station", stage: "Heat Press", serial: 3 },
  { code: "LOC-HUMIDOR-12", name: "HUMIDOR 12", kind: "station", stage: "Humidor", serial: 12 },
  { code: "LOC-DRYING-04", name: "Drying 04", kind: "station", stage: "Book", serial: 4 },
  { code: "LOC-BOOK-WEIGHTS-115", name: "BOOK WITH WEIGHTS 115", kind: "station", stage: "Book with Weights", serial: 115 },
  { code: "LOC-SLAB-CRACK-01", name: "SLAB CRACK BENCH NUMBER ONE BY THE WINDOW 01", kind: "station", stage: "Ready for Slab Crack", serial: 1 },
];
const SIGNS: LabelPlace[] = [
  { code: "LOC-SHELF-20261207", name: "DUE MON DEC 7", kind: "shelf", dueDate: "2026-12-07" },
  { code: "LOC-SHELF-20270104", name: "DUE MON JAN 4", kind: "shelf", dueDate: "2027-01-04" },
  { code: "LOC-DONE", name: "Done", kind: "done" },
  { code: "LOC-SHIP", name: "Shipping", kind: "shipping" },
  { code: "LOC-BACK-ROOM-CABINET", name: "Back room cabinet with the photo lightbox", kind: "other" },
];
const STOCKS: LabelStockId[] = ["50x80mm", "4x6", "4x3", "3x5"];

test("slot labels: the name and serial huge, the step, one QR of the code with the code under it, on every stock", () => {
  for (const id of STOCKS) {
    const stock = fullWidthPoints(id);
    for (const place of SLOTS) {
      const label = `${place.name} on ${id}`;
      const { page, fit } = planPlaceLabel(place, stock);
      checkPage(page, stock, qrUrl(place.code), PLACE_LIMITS.minQrIn, label);
      assert.equal(qrs(page)[0].data, `HTTPS://THECARDDOC1.COM/Q/${place.code}`);
      assert.deepEqual(page.cardCodes, []);
      const t = texts(page);
      // The code, in mono, centered under the QR
      const q = qrs(page)[0];
      const code = t.find((x) => x.text === place.code && x.font === "mono600");
      assert.ok(code, `${label}: the code printed`);
      assert.ok(code.y - code.size > q.y + q.size && Math.abs(code.x + code.width / 2 - (q.x + q.size / 2)) < 0.5, `${label}: code under the QR`);
      // The step, with "Book" as staff read it
      const sub = placeSubLine(place)!;
      const after = t.slice(t.findIndex((x) => x.text === "STEP") + 1).filter((x) => x.font === "body800" && x.color === "ink");
      const stepText = after.map((x) => x.text).join(" ");
      assert.ok(t.some((x) => x.text === "STEP") && (stepText.startsWith(sub.value) || stepText.includes("…")), `${label}: step ${sub.value} ("${stepText}")`);
      if (place.stage === "Book") assert.equal(sub.value, "Drying");
      // The serial: the largest type, white on the banner
      const { serial, head } = slotNameParts(place);
      assert.ok(serial, `${label}: serial split from the name`);
      const biggest = Math.max(...t.map((x) => x.size));
      const serialEl = t.find((x) => x.text === serial)!;
      assert.ok(serialEl && serialEl.size === biggest && serialEl.color === "paper", `${label}: serial ${serial} is the largest type`);
      assert.equal(fit.nameSize, serialEl.size);
      const headEl = t.find((x) => x.color === "paper" && x.font === "display900" && x !== serialEl)!;
      assert.ok(headEl.text === head || headEl.text.endsWith("…"), `${label}: station name "${headEl.text}"`);
    }
  }
  // On 50 x 80 mm the serial is big: CLAMP 07's "07" at least 40 pt (0.55 in)
  const clamp = texts(layoutPlaceLabel(SLOTS[0], MM50)).find((t) => t.text === "07")!;
  assert.ok(clamp.size >= 40, `07 at ${clamp.size}pt`);
});

test("signs: shelf slots with their full date, Done, Shipping, any other place", () => {
  for (const id of STOCKS) {
    const stock = fullWidthPoints(id);
    for (const place of SIGNS) {
      const label = `${place.name} on ${id}`;
      const page = layoutPlaceLabel(place, stock);
      checkPage(page, stock, qrUrl(place.code), PLACE_LIMITS.minQrIn, label);
      const t = texts(page);
      assert.ok(t.some((x) => x.text === place.code && x.font === "mono600"), `${label}: the code printed`);
      // Every letter of the name, never cut
      const name = t.filter((x) => x.color === "paper" && x.font === "display900").map((x) => x.text).join("");
      assert.equal(name.replace(/ /g, ""), place.name.toUpperCase().replace(/ /g, ""), `${label}: the whole name`);
      assert.ok(!t.some((x) => x.text === "STEP"), `${label}: no step on a sign`);
    }
  }
  const shelf = words(layoutPlaceLabel(SIGNS[0], MM50));
  assert.ok(shelf.includes("DUE") && shelf.includes("Mon, Dec 7, 2026"), "shelf: DUE Mon, Dec 7, 2026");
  assert.ok(words(layoutPlaceLabel(SIGNS[1], MM50)).includes("Mon, Jan 4, 2027"), "shelf: the year shows");
  assert.ok(words(layoutPlaceLabel(SIGNS[2], MM50)).includes("Finished cards"));
  assert.ok(words(layoutPlaceLabel(SIGNS[3], MM50)).some((w) => w.startsWith("Ship check")));
  assert.ok(words(layoutPlaceLabel(SIGNS[0], MM50)).includes("SCAN TO SEE WHAT'S HERE"));
  assert.ok(words(layoutPlaceLabel(SLOTS[0], MM50)).includes("SCAN TO ADD OR MOVE CARDS"));
});

test("slot names: the serial splits off only when the name ends with it", () => {
  assert.deepEqual(slotNameParts({ name: "CLAMP 07", kind: "station", serial: 7 }), { head: "CLAMP", serial: "07" });
  assert.deepEqual(slotNameParts({ name: "Heat press 3", kind: "station", serial: 3 }), { head: "HEAT PRESS", serial: "3" });
  assert.deepEqual(slotNameParts({ name: "HUMIDOR 12", kind: "station", serial: null }), { head: "HUMIDOR", serial: "12" });
  assert.deepEqual(slotNameParts({ name: "Big clamp", kind: "station", serial: 7 }), { head: "BIG CLAMP", serial: null });
  assert.deepEqual(slotNameParts({ name: "CLAMP 08", kind: "station", serial: 7 }), { head: "CLAMP 08", serial: null });
  assert.deepEqual(slotNameParts({ name: "DUE MON DEC 7", kind: "shelf", serial: null }), { head: "DUE MON DEC 7", serial: null });
  // A renamed slot without its number: the whole name, still one QR and the code
  const page = layoutPlaceLabel({ code: "LOC-CLAMP-07", name: "Big clamp", kind: "station", stage: "Clamp Work", serial: 7 }, MM50);
  checkPage(page, MM50, qrUrl("LOC-CLAMP-07"), 1, "renamed slot");
  // A station with no step: no STEP line
  assert.ok(!words(layoutPlaceLabel({ code: "LOC-SPARE-01", name: "SPARE 01", kind: "station", stage: null, serial: 1 }, MM50)).includes("STEP"));
});

// ── The loader and the routes' responses ───────────────────────────────────

type Row = Record<string, unknown>;
/**
 * A tiny stand-in for the Supabase client; `missing` columns make a select
 * that names them fail. Like PostgREST, a read returns at most 1,000 rows.
 */
function fakeAdmin(tables: Record<string, Row[]>, missing: string[] = []): SupabaseClient {
  const query = (rows: Row[], columns: string) => {
    let out = rows;
    let max = 1000;
    const orders: [string, boolean][] = [];
    const bad = missing.find((c) => columns.split(",").map((s) => s.trim()).includes(c));
    const cmp = (a: unknown, b: unknown) => (a === b ? 0 : (a as number) < (b as number) ? -1 : 1);
    const q = {
      select: (cols: string) => query(rows, cols),
      eq: (col: string, v: unknown) => ((out = out.filter((r) => r[col] === v)), q),
      in: (col: string, vs: unknown[]) => ((out = out.filter((r) => vs.includes(r[col]))), q),
      not: (col: string, op: string, v: unknown) => (assert.deepEqual([op, v], ["is", null]), (out = out.filter((r) => r[col] != null)), q),
      gte: (col: string, v: number) => ((out = out.filter((r) => (r[col] as number) >= v)), q),
      lte: (col: string, v: number) => ((out = out.filter((r) => (r[col] as number) <= v)), q),
      order: (col: string, o?: { ascending?: boolean }) => (orders.push([col, o?.ascending !== false]), q),
      limit: (n: number) => ((max = Math.min(max, n)), q),
      then: (resolve: (v: { data: Row[] | null; error: { message: string } | null }) => unknown) => {
        const sorted = [...out].sort((a, b) => {
          for (const [col, asc] of orders) if (cmp(a[col], b[col])) return asc ? cmp(a[col], b[col]) : -cmp(a[col], b[col]);
          return 0;
        });
        return resolve(bad ? { data: null, error: { message: `column locations.${bad} does not exist` } } : { data: sorted.slice(0, max), error: null });
      },
    };
    return q;
  };
  return { from: (t: string) => query(tables[t] ?? [], "*") } as unknown as SupabaseClient;
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const slot = (n: number, serial: number, over: Row = {}): Row => ({
  id: id(n), code: `LOC-CLAMP-${String(serial).padStart(2, "0")}`, name: `CLAMP ${String(serial).padStart(2, "0")}`, kind: "station",
  stage: "Clamp Work", due_date: null, station: "clamp", serial, active: true, ...over,
});
const LOCATIONS: Row[] = [
  slot(3, 3), slot(1, 1), slot(2, 2), slot(4, 4, { active: false }), slot(21, 21),
  { id: id(50), code: "LOC-HEAT-PRESS-01", name: "HEAT PRESS 01", kind: "station", stage: "Heat Press", due_date: null, station: "heat-press", serial: 1, active: true },
  { id: id(60), code: "LOC-SHELF-20261207", name: "DUE MON DEC 7", kind: "shelf", stage: null, due_date: "2026-12-07", station: null, serial: null, active: true },
  { id: id(61), code: "LOC-DONE", name: "Done", kind: "done", stage: null, due_date: null, station: null, serial: null, active: true },
];

test("loader: places by id in the order asked; a station's active slots by serial in a range; signs print before the slot columns exist", async () => {
  const admin = fakeAdmin({ locations: LOCATIONS });
  const byIds = await loadLabelPlaces(admin, { ids: [id(61), id(4), id(1)] });
  assert.equal(byIds.error, null);
  assert.deepEqual(byIds.places.map((p) => p.code), ["LOC-DONE", "LOC-CLAMP-04", "LOC-CLAMP-01"], "in the order asked, inactive too");
  assert.equal(byIds.places[2].qrUrl, "HTTPS://THECARDDOC1.COM/Q/LOC-CLAMP-01");
  assert.equal(byIds.places[2].serial, 1);

  const range = await loadLabelPlaces(admin, { station: "clamp", from: 1, to: 20 });
  assert.deepEqual(range.places.map((p) => p.code), ["LOC-CLAMP-01", "LOC-CLAMP-02", "LOC-CLAMP-03"], "active clamps 1-20 by serial");
  assert.deepEqual((await loadLabelPlaces(admin, { station: "clamp" })).places.map((p) => p.serial), [1, 2, 3, 21]);
  assert.deepEqual((await loadLabelPlaces(admin, { station: "heat-press", from: 2 })).places, []);

  // The range is read from the database, so a station past 1,000 slots still prints any range (here the
  // first 1,000 rows stored are slots 1200 down to 201); `limit` caps it
  const many = fakeAdmin({ locations: Array.from({ length: 1200 }, (_, i) => slot(1000 + i, 1200 - i)) });
  assert.deepEqual((await loadLabelPlaces(many, { station: "clamp", from: 101, to: 103 })).places.map((p) => p.serial), [101, 102, 103]);
  assert.deepEqual((await loadLabelPlaces(many, { station: "clamp", limit: 201 })).places.map((p) => p.serial), Array.from({ length: 201 }, (_, i) => i + 1));

  const old = fakeAdmin({ locations: LOCATIONS }, ["station", "serial"]);
  const signs = await loadLabelPlaces(old, { ids: [id(60)] });
  assert.equal(signs.error, null);
  assert.deepEqual(signs.places.map((p) => [p.code, p.serial, p.station]), [["LOC-SHELF-20261207", null, null]]);
  assert.ok((await loadLabelPlaces(old, { station: "clamp" })).error, "a station range needs the slot columns");
});

test("responses: one PDF page per slot at 50 x 80 mm (or ?stock=4x6), JSON pages with the dots per label; a sign is one page", async () => {
  const { places } = await loadLabelPlaces(fakeAdmin({ locations: LOCATIONS }), { station: "clamp", from: 1, to: 20 });
  const pdf = await placeLabelsResponse(new Request("http://x/api/admin/track/locations/labels?station=clamp&from=1&to=20"), places, "LOC-CLAMP-01-to-LOC-CLAMP-03");
  assert.equal(pdf.headers.get("Content-Type"), "application/pdf");
  assert.match(pdf.headers.get("Content-Disposition") ?? "", /LOC-CLAMP-01-to-LOC-CLAMP-03-labels\.pdf/);
  const doc = await PDFDocument.load(new Uint8Array(await pdf.arrayBuffer()));
  assert.equal(doc.getPageCount(), 3, "one page per slot");
  for (const pg of doc.getPages()) {
    const { width, height } = pg.getSize();
    assert.ok(Math.abs((width / PT) * 25.4 - 50) < 0.01 && Math.abs((height / PT) * 25.4 - 80) < 0.01, "50 x 80 mm");
  }

  const json = (await (await placeLabelsResponse(new Request("http://x/api?format=json"), places, "x")).json()) as PlaceLabelsResponse;
  assert.equal(json.settings.stock, "50x80mm");
  assert.equal(json.settings.dpi, 203);
  assert.deepEqual(json.settings.pixels, { width: 400, height: 640 });
  assert.deepEqual(json.pages.map((p) => [p.id, p.code, p.name]), places.map((p) => [p.id, p.code, p.name]));
  for (const p of json.pages) assert.equal(qrs(p.page)[0].data, qrUrl(p.code));

  const big = (await (await placeLabelsResponse(new Request("http://x/api?format=json&stock=4x6"), places, "x")).json()) as PlaceLabelsResponse;
  assert.equal(big.settings.stock, "4x6");
  assert.deepEqual([big.pages[0].page.width, big.pages[0].page.height], [288, 432]);
  const junk = (await (await placeLabelsResponse(new Request("http://x/api?format=json&stock=8x10"), places, "x")).json()) as PlaceLabelsResponse;
  assert.equal(junk.settings.stock, "50x80mm", "an unknown stock falls back to 50 x 80 mm");

  const shelf = (await loadLabelPlaces(fakeAdmin({ locations: LOCATIONS }), { ids: [id(60)] })).places[0];
  const sign = await placeSignResponse(new Request("http://x/api/admin/track/locations/x/sign"), shelf);
  assert.match(sign.headers.get("Content-Disposition") ?? "", /LOC-SHELF-20261207-sign\.pdf/);
  assert.equal((await PDFDocument.load(new Uint8Array(await sign.arrayBuffer()))).getPageCount(), 1);
  const signJson = (await (await placeSignResponse(new Request("http://x/api?format=json&stock=4x6"), shelf)).json()) as PlaceSignResponse;
  assert.equal(signJson.settings.stock, "4x6");
  assert.equal(qrs(signJson.page)[0].data, "HTTPS://THECARDDOC1.COM/Q/LOC-SHELF-20261207");
});

test("PDF: brand fonts embedded; sample slot labels, signs and 50 x 80 mm bag labels written", async () => {
  const out = path.join(process.cwd(), "tests", "intake", "out");
  mkdirSync(out, { recursive: true });
  const slots = await renderLabelPdf([...SLOTS, ...SIGNS].map((p) => layoutPlaceLabel(p, MM50)), { title: "Place labels" });
  assert.equal(slots.brandFonts, true);
  assert.equal((await PDFDocument.load(slots.bytes)).getPageCount(), SLOTS.length + SIGNS.length);
  writeFileSync(path.join(out, "sample-places-50x80.pdf"), slots.bytes);
  const bags = await renderLabelPdf([4, 16, 40].map((n) => planBagLabel(bag(n), BAG_STOCK).page), { title: "Bag labels 50x80" });
  writeFileSync(path.join(out, "sample-bags-50x80.pdf"), bags.bytes);
});

test("bag label routes: ?stock=50x80mm lays the label out on 50 x 80 mm (JSON and PDF) even when 4x6 is saved", async () => {
  const b = { ...bag(4), id: id(70), orderId: id(71), labelPrintedAt: null };
  const saved = { stock: "4x6" as const, contentWidthIn: 3.2 };
  const json = (await (await labelResponse(new Request("http://x/api?format=json&stock=50x80mm"), [b], saved, "CD-10482-P")).json()) as LabelPreviewResponse;
  assert.equal(json.settings.stock, "50x80mm");
  assert.equal(json.settings.contentWidthIn, 1.96);
  const page = json.bags[0].labels[0];
  checkPage(page, BAG_STOCK, qrUrl(b.bagCode), LABEL_LIMITS.minBagQrIn, "bag ?stock=50x80mm");
  // Every mark inside the middle 48 mm of the 50 mm label (the Katasymbol's 384-dot head)
  const mm = (pt: number) => (pt / PT) * 25.4;
  for (const e of page.elements) {
    const bx = box(e);
    assert.ok(mm(bx.x1) >= 1 && mm(bx.x2) <= 49, `${e.kind} at ${mm(bx.x1).toFixed(2)}..${mm(bx.x2).toFixed(2)} mm`);
  }
  const pdf = await labelResponse(new Request("http://x/api?stock=50x80mm"), [b], saved, "CD-10482-P");
  const size = (await PDFDocument.load(new Uint8Array(await pdf.arrayBuffer()))).getPages()[0].getSize();
  assert.ok(Math.abs(mm(size.width) - 50) < 0.01 && Math.abs(mm(size.height) - 80) < 0.01, "PDF page is 50 x 80 mm");
  // Without it, or with an unknown stock, the saved setting; the saved stock keeps its saved width
  for (const q of ["?format=json", "?format=json&stock=8x10"]) {
    const r = (await (await labelResponse(new Request(`http://x/api${q}`), [b], saved, "x")).json()) as LabelPreviewResponse;
    assert.deepEqual([r.settings.stock, r.settings.contentWidthIn], ["4x6", 3.2]);
  }
  const same = (await (await labelResponse(new Request("http://x/api?format=json&stock=4x6"), [b], { stock: "4x6", contentWidthIn: 2.5 }, "x")).json()) as LabelPreviewResponse;
  assert.equal(same.settings.contentWidthIn, 2.5);
  const back = (await (await labelResponse(new Request("http://x/api?format=json&stock=4x6"), [b], { stock: "50x80mm", contentWidthIn: 1.96 }, "x")).json()) as LabelPreviewResponse;
  assert.deepEqual([back.settings.stock, back.settings.contentWidthIn], ["4x6", 3.2]);
});

test("the code under the QR is never cut: a long one breaks after a hyphen onto two lines", () => {
  // About 30 mono characters fit across 50 x 80 mm at the 6.5 pt minimum; place codes run to 40
  for (const code of ["LOC-BACK-ROOM-CABINET-WITH-THE-PHOTO-LI", "LOC-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", "LOC-HUMIDITY-PRESS-9999", "LOC-DONE"]) {
    const place: LabelPlace = { code, name: "Back room cabinet", kind: "other" };
    for (const id of STOCKS) {
      const stock = fullWidthPoints(id);
      const label = `${code} on ${id}`;
      const page = layoutPlaceLabel(place, stock);
      checkPage(page, stock, qrUrl(code), PLACE_LIMITS.minQrIn, label);
      const lines = texts(page).filter((t) => t.font === "mono600");
      assert.equal(lines.map((t) => t.text).join(""), code, `${label}: the whole code, uncut`);
      assert.ok(lines.length <= 2, `${label}: at most two lines`);
      const q = qrs(page)[0];
      for (const t of lines) assert.ok(t.y - t.size > q.y + q.size && Math.abs(t.x + t.width / 2 - (q.x + q.size / 2)) < 0.5, `${label}: "${t.text}" centered under the QR`);
    }
  }
  assert.deepEqual(codeLines("LOC-BACK-ROOM-CABINET-WITH-THE-PHOTO-LI", 11, 117, 6.5).lines, ["LOC-BACK-ROOM-CABINET-", "WITH-THE-PHOTO-LI"]);
  assert.deepEqual(codeLines("LOC-CLAMP-07", 11, 117, 6.5), { lines: ["LOC-CLAMP-07"], size: 11 });
});

test("bag label on 50 x 80 mm: a set and number aren't cut while a smaller row size shows them whole", () => {
  const one = planBagLabel(bag(1), BAG_STOCK);
  assert.ok(words(one.page).includes("1986 Fleer Basketball #57"), `1 card: the set whole (${words(one.page).join(" | ")})`);
  assert.ok(one.fit.bodyPt >= 8, `1 card: rows at ${one.fit.bodyPt} pt`);
  // A set too long for any row size: still the largest rows that hold the card, the number kept
  const long = planBagLabel(bag(1, { cards: [{ seq: 1, code: "CD-10482-01", name: "Pikachu", year: "1999", set: "Pokemon Base Set 1st Edition Shadowless Holo Rare Thick Stamp", number: "58/102" }] }), BAG_STOCK);
  assert.equal(long.fit.style, 0);
  assert.ok(words(long.page).some((w) => w.endsWith("… #58/102")), "the number kept");
});

test("place labels: every mark inside the middle 48 mm of the 50 mm label", () => {
  const mm = (pt: number) => (pt / PT) * 25.4;
  for (const place of [...SLOTS, ...SIGNS]) {
    for (const e of layoutPlaceLabel(place, MM50).elements) {
      const bx = box(e);
      assert.ok(mm(bx.x1) >= 1 && mm(bx.x2) <= 49, `${place.name}: ${e.kind} at ${mm(bx.x1).toFixed(2)}..${mm(bx.x2).toFixed(2)} mm`);
    }
  }
});
