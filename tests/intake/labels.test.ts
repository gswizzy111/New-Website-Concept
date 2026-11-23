/**
 * Bag labels (lib/intake/labels): the Design A layout for 1, 3, 4 and 9
 * cards on the default stock (4x6 in, 3.2 in printed width) and on the other
 * stocks; never below the print minimums; the PDF has one page per label at
 * the stock's size. Writes sample PDFs to tests/intake/out/ (git-ignored).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { LABEL_LIMITS, PT, layoutBagLabels, layoutBagTag, printedWidth } from "@/lib/intake/labels/layout";
import { renderLabelPdf } from "@/lib/intake/labels/pdf";
import { labelQrData, qrMatrix } from "@/lib/intake/labels/qr";
import { normalizeLabelSettings, stockPoints } from "@/lib/intake/labels/stock";
import { fitLine, textWidth, wrapLines } from "@/lib/intake/labels/text";
import type { LabelBag, LabelPage, LabelQr, LabelStock, LabelText } from "@/lib/intake/labels/types";

const NAMES = ["Michael Jordan", "Shohei Ohtani", "Tom Brady", "Stephen Curry", "Charizard ex Special Illustration Rare Holo First Edition Shadowless", "Pikachu Illustrator", "Mewtwo", "Ken Griffey Jr.", "Derek Jeter"];

function bag(n: number): LabelBag {
  return {
    bagCode: "CD-10482-P",
    tierName: "Platinum",
    orderNumber: "CD-10482",
    customerName: "Jordan Reyes",
    receivedOn: "2026-11-15",
    dueDate: "2026-12-07",
    // Card numbers within the order need not start at 1 (other tiers have the rest)
    cards: Array.from({ length: n }, (_, i) => ({
      seq: i * 2 + 3,
      code: `CD-10482-${String(i * 2 + 3).padStart(2, "0")}`,
      name: NAMES[i % NAMES.length],
      year: "1986",
      set: "Fleer Basketball Premier Edition",
      number: String(57 + i),
    })),
  };
}

const DEFAULT = stockPoints("4x6", 3.2);
const texts = (p: LabelPage) => p.elements.filter((e): e is LabelText => e.kind === "text");
const qrs = (p: LabelPage) => p.elements.filter((e): e is LabelQr => e.kind === "qr");
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;

function extent(p: LabelPage) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const e of p.elements) {
    const [x1, x2, y1, y2] =
      e.kind === "text" ? [e.x, e.x + e.width, e.y - e.size, e.y]
      : e.kind === "line" ? [Math.min(e.x1, e.x2), Math.max(e.x1, e.x2), Math.min(e.y1, e.y2), Math.max(e.y1, e.y2)]
      : e.kind === "qr" ? [e.x, e.x + e.size, e.y, e.y + e.size]
      : [e.x, e.x + e.w, e.y, e.y + e.h];
    minX = Math.min(minX, x1);
    maxX = Math.max(maxX, x2);
    minY = Math.min(minY, y1);
    maxY = Math.max(maxY, y2);
  }
  return { minX, maxX, minY, maxY };
}

/** The checks every bag label page must pass. */
function checkPages(b: LabelBag, stock: LabelStock, pages: LabelPage[]) {
  const all = pages.flatMap((p) => p.cardCodes);
  assert.deepEqual([...all].sort(), b.cards.map((c) => c.code).sort(), "every card on exactly one label");

  pages.forEach((p, i) => {
    const label = `label ${i + 1} of ${pages.length}`;
    assert.equal(p.width, stock.pageW, `${label}: page width is the stock's`);
    assert.equal(p.height, stock.pageH, `${label}: page height is the stock's`);

    for (const t of texts(p)) assert.ok(t.size >= LABEL_LIMITS.minTextPt - 1e-9, `${label}: "${t.text}" is ${t.size}pt`);
    for (const e of p.elements) {
      if (e.kind === "line") assert.ok(e.width >= LABEL_LIMITS.minRulePt - 1e-9, `${label}: rule ${e.width}pt`);
      if (e.kind === "rect" && e.stroke) assert.ok((e.strokeWidth ?? 0) >= LABEL_LIMITS.minRulePt - 1e-9, `${label}: border ${e.strokeWidth}pt`);
      if (e.kind === "rect" && e.fill && e.h < 3) assert.ok(e.h >= LABEL_LIMITS.minRulePt - 1e-9, `${label}: rule ${e.h}pt`);
    }

    // Content is centered at the printed width, inside the page
    const { minX, maxX, minY, maxY } = extent(p);
    const w = printedWidth(stock);
    assert.ok(w <= stock.contentW, `${label}: printed width ${w}`);
    assert.ok(near(minX, (stock.pageW - w) / 2), `${label}: left edge ${minX}`);
    assert.ok(maxX <= (stock.pageW + w) / 2 + 0.01, `${label}: right edge ${maxX}`);
    assert.ok(near(minX + maxX, stock.pageW, 0.5), `${label}: centered (${minX}..${maxX})`);
    assert.ok(minY >= 0 && maxY <= stock.pageH, `${label}: inside the page vertically (${minY}..${maxY})`);

    // QR codes: one per card on this label plus the bag's, all big enough
    const codes = qrs(p);
    const bagQr = codes.filter((q) => q.data === labelQrData(b.bagCode));
    assert.equal(bagQr.length, 1, `${label}: the bag QR is on every label`);
    assert.equal(codes.length, p.cardCodes.length + 1, `${label}: a QR per card`);
    for (const q of codes) {
      assert.equal(q.data, q.data.toUpperCase(), "QR data is upper case");
      assert.match(q.data, /\/Q\/CD-10482-/);
      const modules = qrMatrix(q.data).size;
      assert.ok(q.size / modules >= LABEL_LIMITS.moduleIn * PT - 1e-9, `${label}: module ${q.size / modules}pt`);
      if (q !== bagQr[0]) assert.ok(q.size >= LABEL_LIMITS.minCardQrIn * PT, `${label}: card QR ${q.size / PT}in`);
    }
    assert.ok(bagQr[0].size >= 0.75 * PT, `${label}: bag QR ${bagQr[0].size / PT}in`);

    // Bag ID and numbering on every label; card number within the order on every row
    const words = texts(p).map((t) => t.text);
    assert.ok(words.includes(b.bagCode), `${label}: Bag ID`);
    assert.ok(words.includes(`Label ${i + 1} of ${pages.length}`), `${label}: Label n of N`);
    if (i > 0) assert.ok(words.includes(`CONTINUED · LABEL ${i + 1} OF ${pages.length}`), `${label}: continued header`);
    for (const code of p.cardCodes) {
      assert.ok(words.includes(code), `${label}: Card ID ${code}`);
      assert.ok(words.includes(code.split("-").pop()!), `${label}: card number of ${code}`);
    }

    // Card rows end above the dashed rule of the footer
    const dashed = p.elements.find((e) => e.kind === "line" && e.dash);
    assert.ok(dashed && dashed.kind === "line");
    const cardQrs = codes.filter((q) => q !== bagQr[0]);
    for (const q of cardQrs) assert.ok(q.y + q.size < dashed.y1, `${label}: card rows clear the footer`);
  });
}

for (const [n, expected] of [[1, 1], [3, 1], [4, 2], [9, 3]] as const) {
  test(`${n} card${n === 1 ? "" : "s"} on 4x6 at 3.2 in: ${expected} label${expected === 1 ? "" : "s"}`, () => {
    const b = bag(n);
    const pages = layoutBagLabels(b, DEFAULT);
    assert.equal(pages.length, expected);
    checkPages(b, DEFAULT, pages);
    const first = texts(pages[0]).map((t) => t.text);
    for (const word of ["THE CARD DOC", "RESTORATION BAG", "PLATINUM", `${n} CARD${n === 1 ? "" : "S"}`, "Jordan Reyes", "CD-10482", "Sun, Nov 15, 2026", "DUE", "MON · DEC 7, 2026", "WHOLE BAG"]) {
      assert.ok(first.includes(word), `first label shows "${word}"`);
    }
  });
}

test("the card QR is about 0.58 in and the bag QR about 1 in on the default stock", () => {
  const [p] = layoutBagLabels(bag(2), DEFAULT);
  const sizes = qrs(p).map((q) => q.size / PT).sort();
  assert.ok(sizes[0] >= 0.58 - 1e-9 && sizes[0] < 0.7, `card QR ${sizes[0]}in`);
  assert.ok(sizes.at(-1)! >= 1 - 1e-9 && sizes.at(-1)! < 1.2, `bag QR ${sizes.at(-1)}in`);
});

test("other stocks and widths keep every card and the minimums", () => {
  for (const [stock, width] of [["4x3", 3.2], ["3x5", 2.6], ["4x6", 2], ["4x6", 4], ["3x5", 3]] as const) {
    for (const n of [1, 4, 9, 23]) {
      const s = stockPoints(stock, width);
      const b = bag(n);
      checkPages(b, s, layoutBagLabels(b, s));
    }
  }
});

test("card numbers of 100 and more fit their column", () => {
  const b = bag(2);
  b.cards = [99, 100, 101].map((seq) => ({ seq, code: `CD-10482-${seq}`, name: "Card", set: "Set", year: null, number: null }));
  const pages = layoutBagLabels(b, DEFAULT);
  checkPages(b, DEFAULT, pages);
  const nums = texts(pages[0]).filter((t) => ["99", "100", "101"].includes(t.text));
  assert.equal(nums.length, 3);
  const nameX = Math.min(...texts(pages[0]).filter((t) => t.text === "Card").map((t) => t.x));
  for (const t of nums) assert.ok(t.x + t.width < nameX, `"${t.text}" stays left of the card name`);
});

test("missing dates print as not set, odd characters as ?", () => {
  const b = { ...bag(1), receivedOn: null, dueDate: null, customerName: "Zoë 李" };
  const words = texts(layoutBagLabels(b, DEFAULT)[0]).map((t) => t.text);
  assert.ok(words.includes("Not recorded"));
  assert.ok(words.includes("NOT SET"));
  assert.ok(words.includes("Zoë ?"));
});

test("reusable tag: 2.5 x 1.5 in, bag QR, 8 stage boxes, cut marks, centered", () => {
  const p = layoutBagTag(bag(4), DEFAULT);
  const frame = p.elements.find((e) => e.kind === "rect" && e.stroke && e.w > 100);
  assert.ok(frame && frame.kind === "rect");
  assert.ok(near(frame.w, 2.5 * PT) && near(frame.h, 1.5 * PT), "tag size");
  assert.ok(near(frame.x * 2 + frame.w, p.width), "centered");
  const boxes = p.elements.filter((e) => e.kind === "rect" && e.stroke && e.w < 30);
  assert.equal(boxes.length, 8);
  assert.deepEqual(texts(p).filter((t) => /^[1-8]$/.test(t.text)).map((t) => t.text), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  assert.equal(p.elements.filter((e) => e.kind === "line").length, 8, "two cut marks per corner");
  assert.equal(qrs(p).length, 1);
  assert.equal(qrs(p)[0].data, labelQrData("CD-10482-P"));
  const words = texts(p).map((t) => t.text);
  for (const w of ["PLATINUM", "CD-10482-P", "Jordan Reyes · 4 cards", "DUE DEC 7", "STAGE"]) assert.ok(words.includes(w), `tag shows "${w}"`);
  for (const t of texts(p)) assert.ok(t.size >= LABEL_LIMITS.minTextPt - 1e-9);
});

test("label settings are kept within the stock", () => {
  assert.deepEqual(normalizeLabelSettings("4x6", "3.2"), { stock: "4x6", contentWidthIn: 3.2 });
  assert.deepEqual(normalizeLabelSettings("3x5", "3.6"), { stock: "3x5", contentWidthIn: 3 });
  assert.deepEqual(normalizeLabelSettings("8x10", "1"), { stock: "4x6", contentWidthIn: 2 });
  assert.deepEqual(normalizeLabelSettings(undefined, undefined), { stock: "4x6", contentWidthIn: 3.2 });
});

test("text fitting never goes below its minimum and wraps to the line limit", () => {
  const long = "Charizard ex Special Illustration Rare Holo First Edition Shadowless Gem Mint";
  const fit = fitLine(long, "body700", 12, 80, 7.5);
  assert.ok(fit.size >= 7.5);
  assert.ok(textWidth(fit.text, "body700", fit.size) <= 80 + 1e-9);
  assert.ok(fit.text.endsWith("…"));
  const lines = wrapLines(long, "body700", 9, 120, 2);
  assert.equal(lines.length, 2);
  for (const l of lines) assert.ok(textWidth(l, "body700", 9) <= 120 + 1e-9);
  assert.ok(lines[1].endsWith("…"));
  assert.deepEqual(wrapLines("Tom Brady", "body700", 9, 120, 2), ["Tom Brady"]);
});

test("PDF: one page per label at 4x6 in, brand fonts embedded; sample PDFs written", async () => {
  const out = path.join(process.cwd(), "tests", "intake", "out");
  mkdirSync(out, { recursive: true });
  for (const n of [4, 9]) {
    const pages = layoutBagLabels(bag(n), DEFAULT);
    const { bytes, brandFonts } = await renderLabelPdf(pages, { title: `Bag labels CD-10482-P` });
    assert.equal(brandFonts, true, "brand fonts embedded");
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), pages.length);
    for (const pg of doc.getPages()) assert.deepEqual(pg.getSize(), { width: 288, height: 432 });
    writeFileSync(path.join(out, `sample-${n}-cards.pdf`), bytes);
  }
  const tag = await renderLabelPdf([layoutBagTag(bag(4), DEFAULT)], { title: "Bag tag CD-10482-P" });
  assert.equal((await PDFDocument.load(tag.bytes)).getPageCount(), 1);
  writeFileSync(path.join(out, "sample-tag.pdf"), tag.bytes);
});
