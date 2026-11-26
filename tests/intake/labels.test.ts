/**
 * Bag labels (lib/intake/labels), Design B "Name banner": ONE label per tier
 * bag at any card count (1, 4, 16, 40, 120 cards), on every stock and width;
 * the one bag QR; the customer's name as the largest type with the due date
 * big beside it; "+N more: scan the QR" only when the bag doesn't fit; the
 * order's other bags named; the filing tab (the Open bags box letter, top
 * right, never making the name smaller); the loader's tier order; the PDF
 * and JSON the routes send. Writes sample PDFs to tests/intake/out/ (git-ignored).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { qrUrl } from "@/lib/intake/codes";
import { filingLetter } from "@/lib/intake/filing-letter";
import { loadLabelBags } from "@/lib/intake/labels/data";
import { LABEL_LIMITS, PT, ROW_MARKS, bagLabelCapacity, fitName, layoutBagLabel, layoutBagLabels, moreText, planBagLabel, printedWidth } from "@/lib/intake/labels/layout";
import { bagLabelsPdf, renderLabelPdf } from "@/lib/intake/labels/pdf";
import { qrMatrix } from "@/lib/intake/labels/qr";
import { labelResponse, type LabelPreviewResponse } from "@/lib/intake/labels/respond";
import { fullWidthPoints, normalizeLabelSettings, stockPoints } from "@/lib/intake/labels/stock";
import { fitLine, printable, textWidth, wrapLines } from "@/lib/intake/labels/text";
import { FONT_METRICS } from "@/lib/intake/labels/fonts/metrics";
import type { LabelBag, LabelLine, LabelPage, LabelQr, LabelRect, LabelStock, LabelText } from "@/lib/intake/labels/types";

// The QR address is the business domain here, whatever the shell has set
delete process.env.NEXT_PUBLIC_APP_URL;

const NAMES = ["Michael Jordan", "Shohei Ohtani", "Tom Brady", "Stephen Curry", "Charizard ex Special Illustration Rare Holo First Edition Shadowless", "Pikachu Illustrator", "Mewtwo", "Ken Griffey Jr.", "Derek Jeter"];

function bag(n: number, over: Partial<LabelBag> = {}): LabelBag {
  return {
    bagCode: "CD-10482-P",
    tierName: "Platinum",
    orderNumber: "CD-10482",
    customerName: "Jordan Reyes",
    receivedOn: "2026-11-15",
    dueDate: "2026-12-07",
    // Card numbers within the order need not start at 1 (other tiers have the rest)
    cards: Array.from({ length: n }, (_, i) => ({
      seq: i + 3,
      code: `CD-10482-${String(i + 3).padStart(2, "0")}`,
      name: NAMES[i % NAMES.length],
      year: "1986",
      set: "Fleer Basketball",
      number: String(57 + i),
    })),
    ...over,
  };
}

const DEFAULT = stockPoints("4x6", 3.2);
const texts = (p: LabelPage) => p.elements.filter((e): e is LabelText => e.kind === "text");
const qrs = (p: LabelPage) => p.elements.filter((e): e is LabelQr => e.kind === "qr");
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;
const words = (p: LabelPage) => texts(p).map((t) => t.text);

/** The filing tab: the white square on the banner and the black letter in it. */
function tabOf(p: LabelPage): { tile?: LabelRect; letter?: LabelText } {
  const tile = p.elements.find((e): e is LabelRect => e.kind === "rect" && e.fill === "paper");
  if (!tile) return {};
  const letter = texts(p).find((t) => t.color === "ink" && t.x >= tile.x - 0.01 && t.x + t.width <= tile.x + tile.w + 0.01 && t.y >= tile.y && t.y <= tile.y + tile.h);
  return { tile, letter };
}
/** Every text but the filing tab's letter (the name is the largest of these). */
const plainTexts = (p: LabelPage) => {
  const { letter } = tabOf(p);
  return texts(p).filter((t) => t !== letter);
};
/** What a text inks: cap height above the baseline. */
const capBox = (t: LabelText) => ({ x1: t.x, x2: t.x + t.width, y1: t.y - (FONT_METRICS[t.font].capHeight / 1000) * t.size, y2: t.y });

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

/** The black banner: the widest filled ink rect at the top. */
const bannerOf = (p: LabelPage) => p.elements.find((e) => e.kind === "rect" && e.fill === "ink" && e.h > 30)!;

/** The checks every bag label must pass. */
function checkLabel(b: LabelBag, stock: LabelStock, p: LabelPage, label: string) {
  assert.equal(p.width, stock.pageW, `${label}: page width is the stock's`);
  assert.equal(p.height, stock.pageH, `${label}: page height is the stock's`);

  for (const t of texts(p)) assert.ok(t.size >= LABEL_LIMITS.minTextPt - 1e-9, `${label}: "${t.text}" is ${t.size}pt`);
  for (const e of p.elements) {
    if (e.kind === "line") assert.ok(e.width >= LABEL_LIMITS.minRulePt - 1e-9, `${label}: rule ${e.width}pt`);
    if (e.kind === "rect" && e.stroke) assert.ok((e.strokeWidth ?? 0) >= LABEL_LIMITS.minRulePt - 1e-9, `${label}: border ${e.strokeWidth}pt`);
    if (e.kind === "rect" && e.fill && e.h < 3) assert.ok(e.h >= LABEL_LIMITS.minRulePt - 1e-9, `${label}: rule ${e.h}pt`);
    // Black only: nothing in the accent color
    if (e.kind === "text") assert.notEqual(e.color, "accent", `${label}: "${e.text}" is black or white`);
    if (e.kind === "rect") assert.ok(e.fill !== "accent" && e.stroke !== "accent", `${label}: black rect`);
  }

  // Centered at the printed width, inside the page
  const { minX, maxX, minY, maxY } = extent(p);
  const w = printedWidth(stock);
  assert.ok(w <= stock.contentW, `${label}: printed width ${w}`);
  assert.ok(near(minX, (stock.pageW - w) / 2), `${label}: left edge ${minX}`);
  assert.ok(maxX <= (stock.pageW + w) / 2 + 0.01, `${label}: right edge ${maxX}`);
  assert.ok(near(minX + maxX, stock.pageW, 0.5), `${label}: centered (${minX}..${maxX})`);
  assert.ok(minY >= 0 && maxY <= stock.pageH, `${label}: inside the page vertically (${minY}..${maxY})`);

  // ONE QR: the bag's /q/<BAG ID>, at least 1 in, modules at least 0.02 in. No per-card QR codes.
  const codes = qrs(p);
  assert.equal(codes.length, 1, `${label}: exactly one QR`);
  const [q] = codes;
  assert.equal(q.data, qrUrl(b.bagCode));
  assert.equal(q.data, `HTTPS://THECARDDOC1.COM/Q/${b.bagCode}`);
  assert.ok(q.size >= LABEL_LIMITS.minBagQrIn * PT - 1e-9, `${label}: QR ${q.size / PT}in`);
  assert.ok(q.size / qrMatrix(q.data).size >= LABEL_LIMITS.moduleIn * PT - 1e-9, `${label}: QR module`);

  // The customer's name: the largest type, white on the banner
  const banner = bannerOf(p);
  assert.ok(banner && banner.kind === "rect", `${label}: banner`);
  const biggest = Math.max(...plainTexts(p).map((t) => t.size));
  const nameLines = texts(p).filter((t) => t.font === "display900" && t.color === "paper" && t.size === biggest);
  assert.ok(nameLines.length >= 1, `${label}: the name is the largest type`);
  // Every letter of the name, in order, never cut (a word too long for the line may break between letters)
  assert.equal(nameLines.map((t) => t.text).join("").replace(/ /g, ""), b.customerName.toUpperCase().replace(/ /g, ""), `${label}: the whole name, never cut`);
  for (const t of nameLines) assert.ok(t.y <= banner.y + banner.h && t.y - t.size >= banner.y - 1, `${label}: name inside the banner`);

  // The due date, white in the banner, at the right of the name
  const due = texts(p).find((t) => t.text === "DUE" && t.color === "paper");
  assert.ok(due, `${label}: DUE in the banner`);
  const right = due.x + due.width;
  assert.ok(right <= banner.x + banner.w && right >= banner.x + banner.w - 0.08 * banner.w, `${label}: due at the banner's right`);
  for (const t of nameLines) assert.ok(t.x + t.width <= due.x + due.width, `${label}: name stays left of the due date`);

  // The filing tab: a white square in the banner's top right corner (right edge with the due date's, above the
  // name), its letter black, the customer's last-name letter, never smaller than the due date, clear of everything.
  // Where even the smallest tab would make the name smaller or hide every card (4 x 3 in), no tab: the letter
  // is in the kicker ("FILE UNDER R · THE CARD DOC") and the name is exactly as without the tab
  const { tile, letter } = tabOf(p);
  if (!tile) {
    const kicker = texts(p).find((t) => t.font === "body800" && t.color === "paper" && t.text.startsWith("FILE UNDER "));
    assert.ok(kicker, `${label}: no filing tab and no "FILE UNDER" kicker`);
    assert.ok(kicker.text.startsWith(`FILE UNDER ${filingLetter(b.customerName)}`), `${label}: kicker "${kicker.text}"`);
    assert.equal(biggest, planBagLabel(b, stock, { filingTab: false }).fit.nameSize, `${label}: the name as without the tab`);
  } else {
    assert.ok(tile && letter, `${label}: filing tab`);
    assert.equal(p.elements.filter((e) => e.kind === "rect" && e.fill === "paper").length, 1, `${label}: one tab`);
    assert.equal(letter.text, filingLetter(b.customerName), `${label}: filed under ${letter.text}`);
    assert.equal(letter.font, "display900");
    assert.ok(tile.x >= banner.x && tile.x + tile.w <= banner.x + banner.w && tile.y >= banner.y && tile.y + tile.h <= banner.y + banner.h, `${label}: tab inside the banner`);
    assert.ok(near(tile.x + tile.w, due.x + due.width, 0.01), `${label}: tab right-aligned with the due date`);
    assert.ok(tile.y + tile.h <= due.y - (FONT_METRICS[due.font].capHeight / 1000) * due.size + 1e-6, `${label}: tab above the due date`);
    assert.ok(tile.y <= Math.min(...nameLines.map((t) => capBox(t).y1)) + 1e-6, `${label}: tab at the top, not below the name's first line`);
    const cap = capBox(letter);
    assert.ok(cap.x1 >= tile.x && cap.x2 <= tile.x + tile.w && cap.y1 >= tile.y && cap.y2 <= tile.y + tile.h, `${label}: letter inside its tab`);
    const date = texts(p).find((t) => t.color === "paper" && t.font === "display900" && !nameLines.includes(t))!;
    assert.ok(date && letter.size >= date.size - 1e-9, `${label}: letter ${letter.size}pt at least the due date's ${date?.size}pt`);
    for (const t of texts(p)) {
      if (t === letter) continue;
      const c = capBox(t);
      const clear = c.x2 <= tile.x + 0.2 || c.x1 >= tile.x + tile.w - 0.2 || c.y2 <= tile.y + 0.2 || c.y1 >= tile.y + tile.h - 0.2;
      assert.ok(clear, `${label}: "${t.text}" clear of the tab`);
    }
  }

  // Bag ID on the tier row (mono, ink) and in the QR block (on the narrow 50 x 80 mm label, the tier row only)
  const narrow = printedWidth(stock) < 2 * PT - 0.5;
  assert.ok(texts(p).filter((t) => t.text === b.bagCode && t.font === "mono600").length >= (narrow ? 1 : 2), `${label}: Bag ID ${narrow ? "once" : "twice"}`);

  // Listed cards: a prefix of the bag's cards by number, each with its number and name
  const sorted = [...b.cards].sort((x, y) => x.seq - y.seq);
  assert.deepEqual(p.cardCodes, sorted.slice(0, p.cardCodes.length).map((c) => c.code), `${label}: cards in order`);
  const more = cardsHidden(b, p);
  const moreLines = words(p).filter((t) => /^\+\d+ more: scan the QR$/.test(t));
  if (more) assert.deepEqual(moreLines, [moreText(more)], `${label}: "+${more} more"`);
  else assert.deepEqual(moreLines, [], `${label}: no "+N more" when every card is listed`);
  const ids = new Set(texts(p).filter((t) => t.font === "mono600").map((t) => t.text));
  for (const code of p.cardCodes) assert.ok(ids.has(code.split("-").pop()!), `${label}: number of ${code}`);

  // The rows end above the QR block's rule
  const qrRule = p.elements.filter((e) => e.kind === "rect" && e.fill === "ink" && e.h < 3 && e.y < q.y).sort((a, b2) => (b2 as { y: number }).y - (a as { y: number }).y)[0];
  assert.ok(qrRule && qrRule.kind === "rect");
  for (const t of texts(p)) if (t.y < qrRule.y && t.y > banner.y + banner.h) assert.ok(t.y <= qrRule.y, `${label}: "${t.text}" above the QR block`);
  for (const e of p.elements) if (e.kind === "line" && e.dash) assert.ok(e.y1 < qrRule.y, `${label}: row rules above the QR block`);
}

const cardsHidden = (b: LabelBag, p: LabelPage) => b.cards.length - p.cardCodes.length;

for (const n of [1, 4, 16, 40, 120]) {
  test(`${n} card${n === 1 ? "" : "s"} on 4x6 at 3.2 in: exactly one label`, () => {
    const b = bag(n);
    const pages = layoutBagLabels(b, DEFAULT);
    assert.equal(pages.length, 1);
    checkLabel(b, DEFAULT, pages[0], `${n} cards`);
    const w = words(pages[0]);
    for (const word of ["THE CARD DOC · CUSTOMER", "PLATINUM", "DUE", "MON", "DEC 7", "Order CD-10482 · " + `${n} card${n === 1 ? "" : "s"}`, "Received Sun, Nov 15, 2026"]) {
      assert.ok(w.includes(word), `${n} cards: shows "${word}"`);
    }
    // Up to 16 cards every card is listed (28 since the 4 mm check boxes set each row's height; 40 before them); 40 and 120 don't fit
    if (n <= 16) assert.equal(pages[0].cardCodes.length, n, `${n} cards all listed`);
    else assert.ok(pages[0].cardCodes.length >= 26 && pages[0].cardCodes.length < n, `${n} cards: ${pages[0].cardCodes.length} listed`);
  });
}

test("the list steps down: full size, then smaller, then two columns, never below 6.5 pt", () => {
  const fits = [1, 4, 10, 16, 30, 40, 120].map((n) => planBagLabel(bag(n), DEFAULT).fit);
  assert.equal(fits[0].bodyPt, 9);
  assert.equal(fits[0].cols, 1);
  for (let i = 1; i < fits.length; i++) assert.ok(fits[i].style >= fits[i - 1].style, "more cards never get a roomier style");
  assert.equal(fits.at(-1)!.cols, 2);
  for (const f of fits) assert.ok(f.bodyPt >= LABEL_LIMITS.minTextPt);
  const last = fits.at(-1)!;
  assert.equal(last.shown + last.more, 120);
  assert.equal(last.more, 120 - last.shown);
});

test("+N more appears only when needed, with the right N, after the last listed card", () => {
  const b = bag(120, { otherBags: [{ bagCode: "CD-10482-G", tierName: "Gold", cardCount: 2 }] });
  const { page, fit } = planBagLabel(b, DEFAULT);
  assert.ok(fit.more > 0);
  assert.equal(page.cardCodes.length, fit.shown);
  const more = texts(page).find((t) => t.text === moreText(fit.more))!;
  assert.ok(more, `"${moreText(fit.more)}"`);
  const rows = texts(page).filter((t) => t.font === "body700" && NAMES.some((nm) => nm.startsWith(t.text.replace(/…$/, ""))));
  assert.ok(rows.every((t) => t.y < more.y), "the line comes after the rows");
  checkLabel(b, DEFAULT, page, "120 + other bag");
  // One card fewer than fits: no "+N more"
  const all = planBagLabel(bag(fit.shown), DEFAULT);
  assert.equal(all.fit.more, 0);
});

test("other stocks and widths: always one label, every minimum kept", () => {
  for (const [stock, width] of [["4x6", 2], ["4x6", 4], ["4x3", 3.2], ["3x5", 2.6], ["3x5", 3]] as const) {
    for (const n of [0, 1, 4, 16, 40, 120]) {
      const s = stockPoints(stock, width);
      const b = bag(n, { otherBags: n % 2 ? [] : [{ bagCode: "CD-10482-G", tierName: "Gold", cardCount: 3 }] });
      const pages = layoutBagLabels(b, s);
      assert.equal(pages.length, 1, `${stock} at ${width}in, ${n} cards`);
      checkLabel(b, s, pages[0], `${stock} at ${width}in, ${n} cards`);
    }
  }
});

/** Pairs of things printed on top of each other: text boxes (cap height to baseline), the QR, rules. */
function overlaps(p: LabelPage): string[] {
  type Box = { x1: number; x2: number; y1: number; y2: number; what: string; kind: string };
  const boxes: Box[] = p.elements.map((e) =>
    e.kind === "text" ? { kind: "text", what: `"${e.text}"`, x1: e.x, x2: e.x + e.width, y1: e.y - (FONT_METRICS[e.font].capHeight / 1000) * e.size, y2: e.y }
    : e.kind === "qr" ? { kind: "qr", what: "QR", x1: e.x, x2: e.x + e.size, y1: e.y, y2: e.y + e.size }
    : e.kind === "rect" ? { kind: e.fill === "paper" ? "tab" : e.h > 30 ? "banner" : "rule", what: `${e.fill === "paper" ? "tab" : "rect"} at ${e.y.toFixed(1)}`, x1: e.x, x2: e.x + e.w, y1: e.y, y2: e.y + e.h }
    : { kind: "rule", what: `rule at ${e.y1.toFixed(1)}`, x1: Math.min(e.x1, e.x2), x2: Math.max(e.x1, e.x2), y1: e.y1 - e.width / 2, y2: e.y1 + e.width / 2 });
  const hit = (a: Box, b: Box) => a.x1 < b.x2 - 0.2 && b.x1 < a.x2 - 0.2 && a.y1 < b.y2 - 0.2 && b.y1 < a.y2 - 0.2;
  // The tab's own letter stands on it
  const { letter } = tabOf(p);
  const li = letter ? p.elements.indexOf(letter) : -1;
  const own = (i: number, j: number) => (boxes[i].kind === "tab" && j === li) || (boxes[j].kind === "tab" && i === li);
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      if (a.kind === "banner" || b.kind === "banner" || (a.kind !== "text" && b.kind !== "text" && a.kind !== "tab" && b.kind !== "tab") || own(i, j)) continue;
      if (hit(a, b)) out.push(`${a.what} × ${b.what}`);
    }
  }
  return out;
}

test("short and narrow stock, a long name and other bags: nothing overlaps or goes below the minimum", () => {
  const long = (n: number) =>
    bag(n, {
      customerName: "Maria de los Angeles Gutierrez-Fernandez",
      orderNumber: "CD-12345",
      bagCode: "CD-12345-P12",
      receivedOn: "2026-12-20",
      dueDate: "2027-01-12",
      otherBags: [{ bagCode: "CD-12345-G", tierName: "Gold", cardCount: 12 }, { bagCode: "CD-12345-S2", tierName: "Silver", cardCount: 1 }],
    });
  for (const [stock, widths] of [["4x6", [2, 2.5, 3.2, 4]], ["4x3", [2, 2.5, 3.2, 4]], ["3x5", [2, 2.6, 3]]] as const) {
    for (const w of widths) {
      for (const n of [0, 1, 12, 60]) {
        const s = stockPoints(stock, w);
        const b = long(n);
        const page = layoutBagLabel(b, s);
        const label = `${stock} at ${w}in, ${n} cards`;
        checkLabel(b, s, page, label);
        assert.deepEqual(overlaps(page), [], `${label}: nothing printed on top of something else`);
      }
    }
  }
  // 4x3 at 4 in used to print "Also in this order" over the tier row: it gives way to the list now
  const p = layoutBagLabel(long(12), stockPoints("4x3", 4));
  assert.ok(words(p).includes(moreText(12 - p.cardCodes.length)));
});

test("accented capitals get room above them: never into the kicker or the line above", () => {
  for (const customerName of ["Jordan Élodie", "Åsa Öberg", "Zoë Ñúñez"]) {
    const p = layoutBagLabel(bag(3, { customerName }), DEFAULT);
    checkLabel(bag(3, { customerName }), DEFAULT, p, customerName);
    const kicker = texts(p).find((t) => t.text === "THE CARD DOC · CUSTOMER")!;
    const biggest = Math.max(...plainTexts(p).map((t) => t.size));
    const lines = texts(p).filter((t) => t.font === "display900" && t.color === "paper" && t.size === biggest).sort((a, b) => a.y - b.y);
    lines.forEach((t, i) => {
      if (!/[\u0300-\u0315]/.test(t.text.normalize("NFD"))) return;
      // Å stands 1.05 em above the baseline in Big Shoulders Display Black
      const accentTop = t.y - 1.05 * t.size;
      const above = i ? lines[i - 1].y : kicker.y;
      assert.ok(accentTop >= above - 0.01, `${customerName}: accent of "${t.text}" at ${accentTop.toFixed(1)} clears ${above.toFixed(1)}`);
    });
  }
});

test("printable: emoji and invisible characters left out, Latin letters spelled plainly, other scripts one ? per run", () => {
  assert.equal(printable("Charizard 🔥🔥 ex ❤️", "body700"), "Charizard ex");
  assert.equal(printable("Mbappé 👨‍👩‍👧 🇫🇷 👍🏽", "body700"), "Mbappé");
  assert.equal(printable("Łukasz Żółć", "body700"), "Lukasz Zólc");
  assert.equal(printable("ŒUVRE ‐ Đorđe", "display900"), "OEUVRE - Dorde");
  assert.equal(printable("Ｊｏｈｎ Ｓｍｉｔｈ ﬁ", "body700"), "John Smith fi");
  assert.equal(printable("Ann\u00ADMarie\u200B Lee", "display900"), "AnnMarie Lee");
  assert.equal(printable("李小龍", "display900"), "?");
  assert.equal(printable("Ольга Иванова", "body700"), "? ?");
  assert.equal(printable("1996 ポケモン #25", "body400"), "1996 ? #25");
  assert.equal(printable("🔥", "body700"), "");
  // What is printed is always in the font
  for (const t of ["Zoë 李 🔥", "Ł€¥©®™", "e\u0301\u0323"]) {
    for (const ch of printable(t, "body700")) assert.ok(FONT_METRICS.body700.widths[ch.codePointAt(0)!] !== undefined, `${t}: "${ch}"`);
  }
  // A name of emoji only still prints a name line
  const p = layoutBagLabel(bag(1, { customerName: "🔥🔥" }), DEFAULT);
  assert.ok(words(p).includes("UNKNOWN"));
});

test("the due date: big beside the name, weekday, missing or set-date, other year", () => {
  const p = layoutBagLabel(bag(3), DEFAULT);
  const name = Math.max(...plainTexts(p).map((t) => t.size));
  const date = texts(p).find((t) => t.text === "DEC 7")!;
  assert.equal(date.font, "display900");
  assert.equal(date.color, "paper");
  assert.ok(date.size >= name * 0.55 && date.size <= name * 0.72, `date ${date.size} vs name ${name}`);
  assert.ok(!words(p).some((w) => /^DUE MON/.test(w)), "the tier row no longer repeats the due date");

  const none = words(layoutBagLabel(bag(3, { dueDate: null }), DEFAULT));
  assert.ok(none.includes("DUE") && none.includes("—"));
  const setDate = words(layoutBagLabel(bag(3, { dueDate: null, dueStatus: "missing_received_date" }), DEFAULT));
  assert.ok(setDate.includes("SET DATE"));
  const next = words(layoutBagLabel(bag(3, { receivedOn: "2026-12-28", dueDate: "2027-01-20" }), DEFAULT));
  assert.ok(next.includes("JAN 20") && next.includes(" · 2027") && next.includes("WED"));
  assert.ok(!words(p).some((w) => w.includes("2026") && w.startsWith(" ·")), "no year for this year's date");
});

test("long names wrap or shrink, never cut", () => {
  for (const customerName of ["Christopher Montgomery-Wellington", "Maria de los Angeles Gutierrez Fernandez", "Wolfeschlegelsteinhausenbergerdorff", "Al Lee"]) {
    const b = bag(6, { customerName });
    const { page, fit } = planBagLabel(b, DEFAULT);
    checkLabel(b, DEFAULT, page, customerName);
    assert.ok(fit.nameLines <= 3);
    assert.ok(!texts(page).some((t) => t.color === "paper" && t.text.endsWith("…")), "nothing in the banner is cut");
  }
  const short = planBagLabel(bag(1, { customerName: "Al Lee" }), DEFAULT).fit;
  const long = planBagLabel(bag(1, { customerName: "Christopher Montgomery-Wellington" }), DEFAULT).fit;
  assert.equal(short.nameLines, 1);
  assert.ok(short.nameSize > long.nameSize);
  assert.equal(long.nameLines, 3, "breaks after the hyphen");
});

/**
 * The names the filing tab is checked with, the letter each is filed under,
 * and the name's size (pt) and lines on 4x6 at 3.2 in and on 50 x 80 mm as
 * the label set them before the tab (Nov 25 2026), due Dec 7 / due next year.
 */
const FILED: [name: string, letter: string, wide: [number, number, number, number], mm50: [number, number, number, number]][] = [
  ["Jordan Reyes", "R", [42.66, 2, 41.14, 2], [14.34, 1, 14.34, 2]],
  ["Tom Brady", "B", [42.66, 2, 42.66, 2], [14.34, 1, 14.34, 1]],
  ["Madonna", "M", [39.64, 1, 34.79, 1], [14.34, 1, 14.34, 1]],
  ["Maximiliana Featherstonehaugh-Worthington", "F", [25.96, 3, 23.22, 3], [9.56, 3, 9.4, 3]],
  ["2Pac", "#", [42.66, 1, 42.66, 1], [14.34, 1, 14.34, 1]],
  ["3M Collectibles", "C", [31.67, 2, 28.29, 2], [14.34, 2, 14.13, 2]],
];
const MM50 = fullWidthPoints("50x80mm");

test("filing tab: the last name's letter, big in the banner's top right, on 4x6 and 50 x 80 mm; the name and the QR keep their size", () => {
  const sides: Record<string, Set<number>> = { wide: new Set(), mm50: new Set() };
  for (const [name, expected, wide, mm50] of FILED) {
    assert.equal(filingLetter(name), expected, `${name}: filed under ${expected}`);
    for (const [key, stock, sizes] of [["wide", DEFAULT, wide], ["mm50", MM50, mm50]] as const) {
      for (const [i, dueDate] of (["2026-12-07", "2027-01-08", null] as const).entries()) {
        for (const n of [1, 4, 12, 40]) {
          const b = bag(n, { customerName: name, dueDate, receivedOn: "2026-11-15", otherBags: [{ bagCode: "CD-10482-G", tierName: "Gold", cardCount: 2 }] });
          const label = `${name}, ${key}, ${n} cards, due ${dueDate}`;
          const { page, fit } = planBagLabel(b, stock);
          const before = planBagLabel(b, stock, { filingTab: false });
          checkLabel(b, stock, page, label);
          assert.deepEqual(overlaps(page), [], `${label}: nothing printed on top of something else`);
          // The name: the size and lines it had without the tab, the same words
          assert.equal(fit.nameSize, before.fit.nameSize, `${label}: name size kept`);
          assert.equal(fit.nameLines, before.fit.nameLines, `${label}: name lines kept`);
          const nameOf = (pg: LabelPage) => texts(pg).filter((t) => t.color === "paper" && t.font === "display900" && t.size === fit.nameSize).map((t) => t.text);
          assert.deepEqual(nameOf(page), nameOf(before.page), `${label}: the name set the same way`);
          if (i < 2) assert.deepEqual([fit.nameSize, fit.nameLines], [sizes[2 * i], sizes[2 * i + 1]], `${label}: name as before the tab`);
          // The QR: the same size
          assert.equal(qrs(page)[0].size, qrs(before.page)[0].size, `${label}: QR size kept`);
          // The tab: the letter, the side the fit reports, inside the printed width (on 50 x 80 mm, the head's 48 mm)
          const { tile, letter } = tabOf(page);
          assert.ok(fit.filing && tile && letter);
          assert.equal(fit.filing.letter, expected);
          assert.equal(letter.text, expected);
          assert.ok(near(tile.w, fit.filing.side) && near(tile.h, fit.filing.side) && letter.size === fit.filing.size, `${label}: tab as reported`);
          const w = printedWidth(stock);
          assert.ok(tile.x >= (stock.pageW - w) / 2 - 1e-9 && tile.x + tile.w <= (stock.pageW + w) / 2 + 1e-9, `${label}: tab inside the printed width`);
          if (key === "mm50") {
            const head = (48 / 25.4) * PT;
            assert.ok(tile.x >= (stock.pageW - head) / 2 && tile.x + tile.w <= (stock.pageW + head) / 2, `${label}: tab inside the 48 mm head`);
          }
          // The stock's tab, unless a long name leaves less room beside it (then as large as fits, the due date's size at least)
          if (name.length < 30) sides[key].add(fit.filing.side);
          else assert.ok(fit.filing.side <= planBagLabel(bag(1), stock).fit.filing!.side + 1e-9, `${label}: tab no larger than the stock's`);
        }
      }
    }
  }
  // Every bag on a stock gets the same tab: a quarter inch at least, larger on 4x6
  assert.deepEqual([...sides.mm50], [18], "50 x 80 mm: a 0.25 in tab");
  assert.equal(sides.wide.size, 1, `4x6: one tab size (${[...sides.wide]})`);
  assert.ok([...sides.wide][0] >= 30, "4x6: a tab of 30 pt or more");
  // The letter: black on white, the due date's size at least, the name's size at most on 4x6
  const p = layoutBagLabel(bag(4), DEFAULT);
  const { tile, letter } = tabOf(p);
  assert.equal(tile!.fill, "paper");
  assert.equal(letter!.color, "ink");
  assert.ok(letter!.size <= planBagLabel(bag(4), DEFAULT).fit.nameSize);
  // On 4x6 the banner is as tall as it was for JORDAN REYES: the tab takes no room from the cards
  const bannerH = (pg: LabelPage) => {
    const r = bannerOf(pg);
    return r.kind === "rect" ? r.h : NaN;
  };
  assert.equal(bannerH(p), bannerH(planBagLabel(bag(4), DEFAULT, { filingTab: false }).page));
});

test("filing tab on 4 x 3 in: never makes the name smaller or hides every card; then the letter is in the kicker", () => {
  let inKicker = 0;
  for (const width of [2, 2.5, 3.2, 4]) {
    const stock = stockPoints("4x3", width);
    for (const name of ["Jordan Reyes", "Madonna", "Tom Brady", "Maria de los Angeles Gutierrez-Fernandez", "Maximiliana Featherstonehaugh-Worthington"]) {
      for (const n of [0, 1, 4, 12, 40]) {
        const b = bag(n, { customerName: name, otherBags: [{ bagCode: "CD-10482-G", tierName: "Gold", cardCount: 2 }] });
        const label = `${name}, ${n} cards, 4x3 at ${width} in`;
        const { page, fit } = planBagLabel(b, stock);
        const before = planBagLabel(b, stock, { filingTab: false }).fit;
        checkLabel(b, stock, page, label);
        assert.deepEqual(overlaps(page), [], `${label}: nothing printed on top of something else`);
        assert.equal(fit.nameSize, before.nameSize, `${label}: name size kept`);
        assert.equal(fit.nameLines, before.nameLines, `${label}: name lines kept`);
        if (n && before.shown) assert.ok(fit.shown > 0, `${label}: the tab hides every card`);
        assert.ok(fit.filing, `${label}: filing letter somewhere`);
        assert.equal(fit.filing.letter, filingLetter(name));
        if (fit.filing.inKicker) {
          inKicker++;
          assert.equal(fit.filing.side, 0);
          assert.ok(words(page).some((w) => w.startsWith(`FILE UNDER ${filingLetter(name)} ·`)), `${label}: letter in the kicker`);
          assert.equal(tabOf(page).tile, undefined, `${label}: no tab`);
        }
      }
    }
  }
  // 4 x 3 at 4 in and at 2 in (Jordan Reyes) had no room for it: those use the kicker
  assert.ok(inKicker > 0, "some 4 x 3 labels put the letter in the kicker");
  assert.ok(planBagLabel(bag(4), stockPoints("4x3", 4)).fit.filing?.inKicker, "4x3 at 4 in, Jordan Reyes: in the kicker");
  // The 4x6 and 50 x 80 mm labels keep their tab
  assert.ok(!planBagLabel(bag(4), DEFAULT).fit.filing?.inKicker && planBagLabel(bag(4), DEFAULT).fit.filing!.side > 0);
});

test("filing tab: the same tab on every bag of a stock; \"Also in this order\" gives way to cards the tab would hide", () => {
  for (const stock of [DEFAULT, MM50, stockPoints("4x6", 2), stockPoints("4x6", 4), stockPoints("3x5", 2.6)]) {
    const where = `${(stock.contentW / PT).toFixed(2)} in on ${(stock.pageW / PT).toFixed(2)} x ${(stock.pageH / PT).toFixed(2)}`;
    const full = planBagLabel(bag(1), stock).fit.filing!.side;
    assert.ok(full >= 18, `${where}: tab ${full}pt`);
    for (const name of ["Jordan Reyes", "Madonna", "Maria de los Angeles Gutierrez-Fernandez"]) {
      for (const n of [1, 2, 4, 6, 8, 9, 12, 16, 24, 40]) {
        const b = bag(n, { customerName: name, otherBags: [{ bagCode: "CD-10482-G", tierName: "Gold", cardCount: 2 }] });
        const label = `${name}, ${n} cards, ${where}`;
        const { page, fit } = planBagLabel(b, stock);
        const before = planBagLabel(b, stock, { filingTab: false });
        // The stock's tab; only a long name with little room beside it gets a smaller one
        if (name.length < 30) assert.equal(fit.filing!.side, full, `${label}: the stock's tab`);
        else assert.ok(fit.filing!.side <= full + 1e-9 && (fit.filing!.side === full || fit.nameLines >= 2), `${label}: tab ${fit.filing!.side}pt`);
        // Fewer cards listed than without the tab: "Also in this order" went first
        if (fit.shown < before.fit.shown) assert.ok(!words(page).some((w) => w.startsWith("Also in this order")), `${label}: Also gave way first`);
        // Never more than a few rows' worth fewer
        assert.ok(before.fit.shown - fit.shown <= 2 * fit.cols * 2, `${label}: ${before.fit.shown} -> ${fit.shown} listed`);
      }
    }
  }
  // The owner's labels: on 4x6 at 3.2 in a 28-card bag still lists every card (40 before the check boxes, whose
  // 4 mm set each row's height); on 50 x 80 mm a 4-card bag lists every card with its whole name and its card
  // number (the set shares its line with the PG field: cut, the number kept; "Also in this order" makes room)
  assert.equal(planBagLabel(bag(28), DEFAULT).fit.more, 0);
  assert.equal(planBagLabel(bag(40), DEFAULT).fit.more, 12);
  const four = planBagLabel(bag(4, { otherBags: [{ bagCode: "CD-10482-G", tierName: "Gold", cardCount: 2 }] }), MM50);
  assert.equal(four.fit.more, 0);
  for (const c of bag(4).cards) {
    assert.ok(words(four.page).includes(c.name), `50 x 80 mm: ${c.code}'s name whole`);
    assert.ok(words(four.page).some((w) => w.endsWith(`#${c.number}`)), `50 x 80 mm: ${c.code}'s card number`);
  }
});

test("fitName: up to the max, breaks at spaces and after hyphens, fewer lines on a tie, always fits", () => {
  assert.deepEqual(fitName("AL LEE", "display900", 300, 40), { lines: ["AL LEE"], size: 40 });
  const two = fitName("JORDAN REYES", "display900", 150, 40);
  assert.deepEqual(two.lines, ["JORDAN", "REYES"]);
  assert.equal(two.size, 40);
  const hy = fitName("ANNE-MARIE", "display900", 60, 40);
  assert.deepEqual(hy.lines, ["ANNE-", "MARIE"]);
  for (const [nm, w] of [["CHRISTOPHER MONTGOMERY-WELLINGTON", 140], ["X", 5], ["SUPERCALIFRAGILISTICEXPIALIDOCIOUS", 100], ["JO WOLFESCHLEGELSTEINHAUSENBERGERDORFF", 140]] as const) {
    const f = fitName(nm, "display900", w, 40);
    for (const l of f.lines) assert.ok(textWidth(l, "display900", f.size) <= w + 1e-6, `${nm}: "${l}" fits`);
    assert.equal(f.lines.join("").replace(/ /g, ""), nm.replace(/ /g, ""), `${nm}: every letter, in order`);
    assert.ok(f.lines.length * f.size <= 2 * 40 + 1e-9, "never taller than two lines at the max");
  }
  // Words that fit keep their breaks at spaces and hyphens
  assert.deepEqual(fitName("CHRISTOPHER MONTGOMERY-WELLINGTON", "display900", 140, 40).lines.join(" ").replace(/- /g, "-"), "CHRISTOPHER MONTGOMERY-WELLINGTON");
});

test("a name typed without spaces breaks between letters and stays large, evenly", () => {
  const f = fitName("SUPERCALIFRAGILISTICEXPIALIDOCIOUS", "display900", 100, 40);
  const oneLine = 100 / textWidth("SUPERCALIFRAGILISTICEXPIALIDOCIOUS", "display900", 1);
  assert.ok(f.lines.length > 1 && f.size > 2 * oneLine, `${f.size}pt on ${f.lines.length} lines vs ${oneLine}pt on one`);
  const lens = f.lines.map((l) => l.length);
  assert.ok(Math.max(...lens) - Math.min(...lens) <= 3, `even lines: ${f.lines.join(" / ")}`);
  // A short word is never split between letters
  const jo = fitName("JO WOLFESCHLEGELSTEINHAUSENBERGERDORFF", "display900", 140, 40);
  assert.ok(jo.lines[0].startsWith("JO "), jo.lines.join(" / "));
  for (const customerName of ["Wolfeschlegelsteinhausenberger", "Wolfeschlegelsteinhausenbergerdorffwelchevor", "jonathan.richardson.williamson@gmail.com"]) {
    const b = bag(4, { customerName });
    const { page, fit } = planBagLabel(b, DEFAULT);
    checkLabel(b, DEFAULT, page, customerName);
    assert.ok(fit.nameSize >= 20, `${customerName}: name at ${fit.nameSize}pt`);
  }
});

test("card numbers of 100 and more fit their column", () => {
  const b = bag(2);
  b.cards = [99, 100, 101].map((seq) => ({ seq, code: `CD-10482-${seq}`, name: "Card", set: "Set", year: null, number: null }));
  const p = layoutBagLabel(b, DEFAULT);
  checkLabel(b, DEFAULT, p, "100+");
  const nums = texts(p).filter((t) => ["99", "100", "101"].includes(t.text));
  assert.equal(nums.length, 3);
  const nameX = Math.min(...texts(p).filter((t) => t.text === "Card").map((t) => t.x));
  for (const t of nums) assert.ok(t.x + t.width < nameX, `"${t.text}" stays left of the card name`);
});

test("missing dates, odd characters and an empty bag", () => {
  const b = { ...bag(1), receivedOn: null, dueDate: null, customerName: "Zoë 李" };
  const w = words(layoutBagLabel(b, DEFAULT));
  assert.ok(w.includes("Received: not recorded"));
  assert.ok(w.includes("ZOË ?"));
  const empty = layoutBagLabel(bag(0), DEFAULT);
  assert.ok(words(empty).includes("No cards in this bag"));
  assert.deepEqual(empty.cardCodes, []);
});

test("Also in this order names the order's other bags with cards", () => {
  const b = bag(4, { otherBags: [{ bagCode: "CD-10482-G", tierName: "Gold", cardCount: 2 }, { bagCode: "CD-10482-S", tierName: "Silver", cardCount: 1 }, { bagCode: "CD-10482-B", tierName: "Bronze", cardCount: 0 }] });
  const also = texts(layoutBagLabel(b, DEFAULT)).filter((t) => t.font === "body700" && t.size < 8 && /Also in this order|CD-10482-[GS]/.test(t.text));
  assert.equal(also.map((t) => t.text).join(" · "), "Also in this order: GOLD CD-10482-G (2 cards) · SILVER CD-10482-S (1 card)");
  assert.ok(also.every((t) => /\(\d+ cards?\)$/.test(t.text)), "lines break between bags, never inside one");
  assert.ok(!words(layoutBagLabel(bag(4), DEFAULT)).some((x) => x.startsWith("Also in this order")));
});

/** The name's lines (the largest type) and the due block's words, white in the banner. */
function bannerParts(p: LabelPage) {
  const biggest = Math.max(...plainTexts(p).map((t) => t.size));
  const name = texts(p).filter((t) => t.font === "display900" && t.color === "paper" && t.size === biggest).sort((a, b) => a.y - b.y);
  const due = texts(p).find((t) => t.text === "DUE" && t.color === "paper")!;
  const dueWords = texts(p).filter((t) => t.color === "paper" && !name.includes(t) && t.y > due.y - 0.01);
  return { name, dueWords };
}

test("names: up to two lines the larger name wins; a third only when needed; never a lone 1-2 letter line", () => {
  // The fitting rule on its own
  assert.deepEqual(fitName("TEST CUSTOMER A", "display900", 140, 40).lines, ["TEST", "CUSTOMER A"], "two lines keep 70%");
  assert.deepEqual(fitName("TEST CUSTOMER A", "display900", 100, 40).lines, ["TEST", "CUSTOMER A"], "\"A\" never alone, even below 70%");
  assert.deepEqual(fitName("KEN GRIFFEY JR.", "display900", 100, 40).lines, ["KEN", "GRIFFEY JR."]);
  const tom = fitName("TOM BRADY", "display900", 150, 40);
  assert.deepEqual(tom.lines, ["TOM", "BRADY"], "two lines when that makes the name larger (the approved JORDAN / REYES look)");
  const tomOne = fitName("TOM BRADY", "display900", 150, 40, 1);
  assert.ok(tom.size > tomOne.size, "two lines are larger than one");
  // Three lines only when two would put the name under 70%, and for a clearly larger name
  const chris = fitName("CHRISTOPHER MONTGOMERY-WELLINGTON", "display900", 140, 40);
  assert.equal(chris.lines.length, 3);
  assert.ok(140 / textWidth("MONTGOMERY-WELLINGTON", "display900", 1) < 0.7 * 40, "two lines would be under 70%");

  // On the label: "TEST CUSTOMER A" due next year was "TEST / CUSTOMER / A"
  const max = planBagLabel(bag(1), DEFAULT).fit.nameSize;
  const b = bag(3, { customerName: "Test Customer A", receivedOn: "2026-12-18", dueDate: "2027-01-08" });
  const { page, fit } = planBagLabel(b, DEFAULT);
  checkLabel(b, DEFAULT, page, "Test Customer A, due 2027");
  assert.deepEqual(bannerParts(page).name.map((t) => t.text), ["TEST", "CUSTOMER A"]);
  assert.ok(fit.nameSize >= 0.7 * max, `${fit.nameSize}pt keeps 70% of ${max}pt`);
  assert.ok(words(page).includes(" · 2027"));

  for (const [stock, width] of [["4x6", 3.2], ["4x6", 2], ["4x3", 3.2], ["3x5", 2.6]] as const) {
    const s = stockPoints(stock, width);
    for (const customerName of ["Test Customer A", "Ken Griffey Jr", "Juan de la Cruz A", "Christopher Montgomery-Wellington", "Wolfeschlegelsteinhausenbergerdorffwelchevorx", "Mary-Jo Lee"]) {
      for (const dueDate of ["2026-12-07", "2027-01-08"]) {
        const nb = bag(4, { customerName, dueDate, otherBags: [{ bagCode: "CD-10482-G", tierName: "Gold", cardCount: 2 }] });
        const label = `${customerName}, ${stock} at ${width}in, due ${dueDate}`;
        const p = layoutBagLabel(nb, s);
        checkLabel(nb, s, p, label);
        assert.deepEqual(overlaps(p), [], `${label}: nothing printed on top of something else`);
        const { name, dueWords } = bannerParts(p);
        // Lines after the first hold at least 3 letters
        for (const t of name.slice(1)) assert.ok(t.text.replace(/[^\p{L}\p{N}]/gu, "").length >= 3, `${label}: "${t.text}" alone on a line`);
        assert.ok(name.length <= 3);
        // The name ends left of the due date, which stays at or above the smallest type
        const dueLeft = Math.min(...dueWords.map((t) => t.x));
        for (const t of name) assert.ok(t.x + t.width <= dueLeft + 1e-6, `${label}: "${t.text}" runs into the due date`);
        for (const t of dueWords) assert.ok(t.size >= LABEL_LIMITS.minTextPt - 1e-9, `${label}: "${t.text}" ${t.size}pt`);
      }
    }
  }
  // A 45-letter name typed without spaces: never cut, at least 3 lines' worth of size
  const word = "Wolfeschlegelsteinhausenbergerdorffwelchevorx";
  assert.equal(word.length, 45);
  const w45 = planBagLabel(bag(4, { customerName: word }), DEFAULT);
  assert.ok(w45.fit.nameSize >= 20, `${w45.fit.nameSize}pt`);
});

test("card rows: a set and number never cut while there is room; they go under the name or the type steps down", () => {
  // The harness's 8-card Platinum bag: "1999 Test Set Two #10/165" was cut to "1999 Test Set Two #1…" with half the label empty
  const eight = bag(0, { customerName: "Test Customer G", bagCode: "CD-2600-P", orderNumber: "CD-2600", otherBags: [{ bagCode: "CD-2600-G", tierName: "Gold", cardCount: 32 }] });
  eight.cards = [4, 9, 14, 19, 24, 29, 34, 39].map((i) => ({
    seq: i + 1,
    code: `CD-2600-${String(i + 1).padStart(2, "0")}`,
    name: i === 4 ? "Test Big Order Card 05 Holo First Edition Long Name" : `Test Big Order Card ${i + 1}`,
    year: "1999",
    set: i % 2 ? "Test Set Two" : "Base Set",
    number: `${i + 1}/165`,
  }));
  const { page, fit } = planBagLabel(eight, DEFAULT);
  checkLabel(eight, DEFAULT, page, "8 cards, long sets");
  assert.deepEqual(overlaps(page), [], "8 cards: nothing printed on top of something else");
  assert.equal(fit.more, 0);
  assert.equal(fit.cols, 1);
  assert.ok(fit.wrapped > 0, "some sets go under their names");
  for (const c of eight.cards) assert.ok(words(page).includes(`1999 ${c.set} #${c.number}`), `${c.code}: set and number in full`);
  assert.ok(!texts(page).some((t) => t.font === "body400" && t.text.endsWith("…")), "no set cut");
  // A set under its name starts where the name does, inside the row
  const under = texts(page).find((t) => t.text === "1999 Test Set Two #10/165")!;
  const name = texts(page).find((t) => t.text === "Test Big Order Card 10")!;
  assert.ok(near(under.x, name.x) && under.y > name.y, "the set sits under the name");

  // A set too long for a whole line is cut, never the card number
  const long = bag(3);
  long.cards[0] = { ...long.cards[0], name: "Charizard Holo", year: "1999", set: "Pokemon Base Set 1st Edition Shadowless Thick Stamp Grey Stamp", number: "4/102" };
  const lp = layoutBagLabel(long, DEFAULT);
  checkLabel(long, DEFAULT, lp, "set wider than the line");
  const cut = texts(lp).find((t) => t.text.startsWith("1999 Pokemon"))!;
  assert.ok(cut && /… #4\/102$/.test(cut.text), `"${cut?.text}" keeps the number`);

  // A smaller type in one column, then two columns: the same, while the rows fit
  for (const [n, cols] of [[8, 1], [12, 1], [18, 2], [20, 2]] as const) {
    const b = bag(n);
    const p = planBagLabel(b, DEFAULT);
    checkLabel(b, DEFAULT, p.page, `${n} cards`);
    assert.deepEqual(overlaps(p.page), [], `${n} cards: nothing printed on top of something else`);
    assert.equal(p.fit.cols, cols, `${n} cards: ${cols} column(s)`);
    for (const c of b.cards) assert.ok(texts(p.page).some((t) => t.text.endsWith(`#${c.number}`)), `${n} cards: ${c.code}'s number`);
  }
  // Never a second column (narrower names) only to fit sets: with no room for second lines, as before (14 cards:
  // one column holds their rows with the check boxes, not their second lines; 16 need two columns since the boxes)
  const fourteen = planBagLabel(bag(14), DEFAULT).fit;
  assert.equal(fourteen.cols, 1);
  assert.equal(fourteen.wrapped, 0);

  // A bag that only fits on one line a row is laid out as before: sets cut or left out, "+N more" past that
  for (const n of [40, 120]) {
    const p = planBagLabel(bag(n), DEFAULT);
    assert.equal(p.fit.wrapped, 0, `${n} cards: one line a row`);
    assert.equal(p.fit.cols, 2);
  }
  assert.ok(planBagLabel(bag(120), DEFAULT).fit.more > 0);
});

// ── The check box and the PG line on every card row (owner, Nov 26 2026) ──

const MM = PT / 25.4;
/** The card rows' marks: the check boxes (outline only), the "PG" words and their write-in lines. */
const checkBoxes = (p: LabelPage) => p.elements.filter((e): e is LabelRect => e.kind === "rect" && !!e.stroke && !e.fill);
const pgWords = (p: LabelPage) => texts(p).filter((t) => t.text === ROW_MARKS.pgLabel && t.font === "body800");
const pgLines = (p: LabelPage) => p.elements.filter((e): e is LabelLine => e.kind === "line" && !e.dash);
/** The list's left edge and width: the heavy rule under the tier row. */
const listFrame = (p: LabelPage) => {
  const r = p.elements.filter((e): e is LabelRect => e.kind === "rect" && e.fill === "ink" && e.h < 4).sort((a, b) => a.y - b.y)[0];
  return { xi: r.x, Wi: r.w, top: r.y + r.h };
};
/** The capitals' middle of a text. */
const capMid = (t: LabelText) => t.y - ((FONT_METRICS[t.font].capHeight / 1000) * t.size) / 2;
type RowMarks = { id: LabelText; box: LabelRect; pg: LabelText; line: LabelLine; value?: LabelText };

/**
 * Every listed card's row has one check box at its left, centered on the
 * first line's capitals, and one PG field at its right end ("PG" and its
 * line, a pre-grade on the line when there is one), inside the list and the
 * printed width; boxes never touch each other or anything printed. Returns
 * each listed card's marks.
 */
function checkRowMarks(b: LabelBag, stock: LabelStock, page: LabelPage, label: string): Map<string, RowMarks> {
  const { fit } = planBagLabel(b, stock);
  const narrow = printedWidth(stock) < 2 * PT - 0.5;
  const boxes = checkBoxes(page);
  const words = pgWords(page);
  const lines = pgLines(page);
  const n = page.cardCodes.length;
  assert.equal(boxes.length, n, `${label}: one check box per listed card`);
  assert.equal(words.length, n, `${label}: one "PG" per listed card`);
  assert.equal(lines.length, n, `${label}: one PG line per listed card`);
  const { xi, Wi, top } = listFrame(page);
  const q = qrs(page)[0];
  const qrRule = p2Rule(page, q);
  const W = printedWidth(stock);
  const head = narrow ? (48 / 25.4) * PT : W;
  // The box: a square, at least 4 mm (3 mm on 50 x 80 mm), its outline at least the thinnest rule
  for (const bx of boxes) {
    assert.ok(near(bx.w, bx.h, 1e-9) && near(bx.w, fit.checkBox, 1e-9), `${label}: box ${bx.w}x${bx.h}`);
    assert.ok(bx.w >= (narrow ? 3 : 4) * MM - 1e-9, `${label}: box ${(bx.w / MM).toFixed(2)} mm`);
    assert.ok((bx.strokeWidth ?? 0) >= LABEL_LIMITS.minRulePt && bx.stroke === "ink", `${label}: box outline`);
  }
  // Inside the list, the printed width (the 48 mm head on 50 x 80 mm) and above the QR block
  for (const e of [...boxes, ...words, ...lines]) {
    const [x1, x2, y1, y2] = e.kind === "rect" ? [e.x, e.x + e.w, e.y, e.y + e.h] : e.kind === "line" ? [e.x1, e.x2, e.y1 - e.width / 2, e.y1 + e.width / 2] : [e.x, e.x + e.width, capMid(e), e.y];
    assert.ok(x1 >= xi - 1e-9 && x2 <= xi + Wi + 1e-9, `${label}: ${e.kind} inside the list's width (${x1.toFixed(2)}..${x2.toFixed(2)})`);
    assert.ok(x1 >= (stock.pageW - head) / 2 - 1e-9 && x2 <= (stock.pageW + head) / 2 + 1e-9, `${label}: ${e.kind} inside the printed width`);
    assert.ok(y1 >= top - 1e-9 && y2 <= qrRule.y + 1e-9, `${label}: ${e.kind} between the tier rule and the QR block`);
  }
  // Boxes never touch: at least 1.5 pt of paper between neighbours
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, c] = [boxes[i], boxes[j]];
      const apart = a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h + 1.5 <= c.y || c.y + c.h + 1.5 <= a.y;
      assert.ok(apart, `${label}: boxes at ${a.y.toFixed(1)} and ${c.y.toFixed(1)} touch`);
    }
  }
  // Nothing printed over a box or a PG line: no text, rule, line or QR
  const others = page.elements.filter((e) => e.kind !== "rect" || e.h < 4 || !!e.stroke);
  for (const bx of boxes) {
    for (const e of others) {
      if (e === bx) continue;
      const [x1, x2, y1, y2] = e.kind === "text" ? [e.x, e.x + e.width, e.y - (FONT_METRICS[e.font].capHeight / 1000) * e.size, e.y] : e.kind === "line" ? [Math.min(e.x1, e.x2), Math.max(e.x1, e.x2), e.y1 - e.width / 2, e.y1 + e.width / 2] : e.kind === "qr" ? [e.x, e.x + e.size, e.y, e.y + e.size] : [e.x, e.x + e.w, e.y, e.y + e.h];
      const hit = x1 < bx.x + bx.w - 0.01 && bx.x < x2 - 0.01 && y1 < bx.y + bx.h - 0.01 && bx.y < y2 - 0.01;
      assert.ok(!hit, `${label}: ${e.kind}${e.kind === "text" ? ` "${e.text}"` : ""} over the box at ${bx.y.toFixed(1)}`);
    }
  }
  for (const ln of lines) {
    for (const t of texts(page)) {
      const hit = t.x < ln.x2 - 0.01 && ln.x1 < t.x + t.width - 0.01 && t.y - (FONT_METRICS[t.font].capHeight / 1000) * t.size < ln.y1 + ln.width / 2 && ln.y1 - ln.width / 2 < t.y;
      assert.ok(!hit, `${label}: "${t.text}" over a PG line`);
    }
  }
  // Each listed card: its number, the box at its left centered on the line's capitals, its PG field at the row's right end
  const byCol = new Map<number, LabelText[]>();
  const ids = page.cardCodes.map((code) => {
    const id = texts(page).filter((t) => t.font === "mono600" && t.text === code.split("-").pop());
    assert.equal(id.length, 1, `${label}: ${code}'s number once`);
    return id[0];
  });
  const out = new Map<string, RowMarks>();
  page.cardCodes.forEach((code, i) => {
    const id = ids[i];
    // Centered on the first line's capitals (the name's, in bold; the number in mono stands on the same baseline)
    const lineMid = id.y - ((FONT_METRICS.body700.capHeight / 1000) * id.size) / 2;
    const box = boxes.filter((bx) => bx.x + bx.w <= id.x + 1e-9 && id.x - (bx.x + bx.w) <= id.size && near(bx.y + bx.h / 2, lineMid, 0.01));
    assert.equal(box.length, 1, `${label}: ${code}: one box just left of its number, centered on the line`);
    const col = Math.round(box[0].x * 100);
    (byCol.get(col) ?? byCol.set(col, []).get(col)!).push(id);
    out.set(code, { id, box: box[0] } as RowMarks);
  });
  const colXs = [...byCol.keys()].sort((a, b) => a - b);
  for (const [colX, colIds] of byCol) {
    // Everything of this column stands left of the next column's boxes
    const nextCol = (colXs.find((x) => x > colX) ?? Infinity) / 100;
    colIds.sort((a, b) => a.y - b.y);
    colIds.forEach((id, k) => {
      const code = page.cardCodes[ids.indexOf(id)];
      const next = colIds[k + 1]?.y ?? Infinity;
      const box = out.get(code)!.box;
      // The column's right edge: the list's right, or the left column's right in two columns
      const right = Math.max(...lines.filter((l) => l.y1 > box.y && l.y1 < next && l.x1 > box.x && l.x2 < nextCol).map((l) => l.x2));
      const mine = words.filter((w) => w.x > id.x && w.y >= id.y - 1e-9 && w.y < next - 1e-9 && w.x + w.width <= right);
      assert.equal(mine.length, 1, `${label}: ${code}: one "PG" in its row`);
      const pg = mine[0];
      // On 50 x 80 mm always under the name; on the inch stocks beside it, or under it when the whole name
      // doesn't fit beside it. Under the name, the name has the whole line: whole, or cut only at the line's end
      const nameEl = texts(page).find((t) => t.font === "body700" && near(t.y, id.y, 1e-9) && t.x > id.x && t.x + t.width <= right + 1e-9);
      assert.ok(nameEl, `${label}: ${code}: its name on its first line`);
      if (narrow) assert.ok(pg.y > id.y + 1e-6, `${label}: ${code}: PG under the name on 50 x 80 mm`);
      assert.ok(pg.y - id.y <= 2 * 1.25 * id.size + 0.01, `${label}: ${code}: PG at most two lines under the name`);
      if (pg.y > id.y + 1e-6) assert.ok(!nameEl.text.endsWith("…") || nameEl.x + nameEl.width > right - 1.2 * id.size, `${label}: ${code}: "${nameEl.text}" cut short of the line's end`);
      const line = lines.filter((l) => l.x1 >= pg.x + pg.width - 1e-9 && l.x1 - (pg.x + pg.width) <= pg.size && l.y1 > pg.y && l.y1 - pg.y < 0.4 * pg.size);
      assert.equal(line.length, 1, `${label}: ${code}: the PG line right after "PG", just under its baseline`);
      const ln = line[0];
      assert.ok(near(ln.x2, right, 1e-9) && (near(right, xi + Wi, 1e-9) || right < xi + Wi / 2 + 1e-9), `${label}: ${code}: PG line at the row's right end`);
      assert.ok(ln.x2 - ln.x1 >= ROW_MARKS.pgLineMinPt - 1e-9, `${label}: ${code}: a line of ${((ln.x2 - ln.x1) / MM).toFixed(1)} mm to write on`);
      assert.ok(ln.width >= LABEL_LIMITS.minRulePt - 1e-9 && ln.color === "ink");
      const value = texts(page).filter((t) => t !== pg && near(t.y, pg.y, 1e-9) && t.x >= ln.x1 - 1e-9 && t.x + t.width <= ln.x2 + 1e-9);
      assert.ok(value.length <= 1, `${label}: ${code}: one value at most`);
      out.set(code, { id, box, pg, line: ln, value: value[0] });
    });
  }
  return out;
}

/** The QR block's rule: the last thin black rule above the QR. */
function p2Rule(p: LabelPage, q: LabelQr): LabelRect {
  return p.elements.filter((e): e is LabelRect => e.kind === "rect" && e.fill === "ink" && e.h < 4 && e.y < q.y).sort((a, b) => b.y - a.y)[0];
}

test("check box and PG line on every listed card row, inside the printed width, nothing overlapping (4x6, 50 x 80 mm and the other stocks)", () => {
  const stocks: [string, LabelStock][] = [
    ["4x6 at 3.2 in", DEFAULT], ["50 x 80 mm", MM50], ["4x6 at 2 in", stockPoints("4x6", 2)], ["4x6 at 4 in", stockPoints("4x6", 4)],
    ["3x5 at 2.6 in", stockPoints("3x5", 2.6)], ["4x3 at 3.2 in", stockPoints("4x3", 3.2)],
  ];
  const long = { customerName: "Maria de los Angeles Gutierrez-Fernandez", otherBags: [{ bagCode: "CD-10482-G", tierName: "Gold", cardCount: 12 }] };
  for (const [where, stock] of stocks) {
    for (const n of [1, 4, 12, 16, 40, 120]) {
      for (const over of [{}, long]) {
        const b = bag(n, over);
        b.cards[1 % n] = { ...b.cards[1 % n], pregrade: "9" };
        const label = `${where}, ${n} cards${"customerName" in over ? ", long name" : ""}`;
        const page = layoutBagLabel(b, stock);
        checkLabel(b, stock, page, label);
        assert.deepEqual(overlaps(page), [], `${label}: nothing printed on top of something else`);
        const marks = checkRowMarks(b, stock, page, label);
        assert.equal(marks.size, page.cardCodes.length);
      }
    }
  }
  // The owner's stocks: the box's size and where the PG field sits
  const wide = planBagLabel(bag(4), DEFAULT);
  assert.ok(near(wide.fit.checkBox, 4 * MM, 1e-9), "4x6: a 4 mm box");
  const mm50 = planBagLabel(bag(4), MM50);
  assert.ok(near(mm50.fit.checkBox, 3 * MM, 1e-9), "50 x 80 mm: a 3 mm box");
  // Two columns: each column's rows have their own box and PG line, the left column's line ends before the right column's boxes
  const two = layoutBagLabel(bag(20), DEFAULT);
  const xs = [...new Set(checkBoxes(two).map((bx) => Math.round(bx.x * 100) / 100))];
  assert.equal(xs.length, 2, "two columns of boxes");
  const rightBoxX = Math.max(...xs);
  const leftLines = pgLines(two).filter((l) => l.x2 < rightBoxX);
  assert.equal(leftLines.length, 10);
  assert.ok(leftLines.every((l) => l.x2 <= rightBoxX - 4), "the left column's PG lines stop well before the right column's boxes");
});

test("on 50 x 80 mm the PG field is always under the name: the name keeps the whole line, the field beside the set (cut, its number kept) or on its own line", () => {
  // A roomy bag: the field on its own line under a set too long to stand beside it, the set whole
  const b = bag(2, { otherBags: [] });
  b.cards[0] = { ...b.cards[0], name: "Pikachu Illustrator", year: "1998", set: "Promo", number: "", pregrade: "9" };
  b.cards[1] = { ...b.cards[1], pregrade: "BGS 9.5" };
  const page = layoutBagLabel(b, MM50);
  checkLabel(b, MM50, page, "two cards");
  assert.deepEqual(overlaps(page), []);
  const marks = checkRowMarks(b, MM50, page, "two cards");
  assert.ok(words(page).includes("Pikachu Illustrator") && words(page).includes(b.cards[1].name), "the names whole");
  assert.equal(marks.get(b.cards[0].code)!.value?.text, "9");
  assert.equal(marks.get(b.cards[1].code)!.value?.text, "BGS 9.5");
  // A set too long to stand beside the field: whole on its own line, the field on the line under it
  const second = marks.get(b.cards[1].code)!;
  const set2 = texts(page).find((t) => t.text === `${b.cards[1].year} ${b.cards[1].set} #${b.cards[1].number}`)!;
  assert.ok(set2 && set2.y > second.id.y && second.pg.y > set2.y, "set whole under the name, the field under the set");
  for (const c of b.cards) assert.ok(marks.get(c.code)!.pg.y > marks.get(c.code)!.id.y, `${c.name}: PG under the name`);
  // A short set stands beside the field on the line under the name
  const short = marks.get(b.cards[0].code)!;
  const promo = texts(page).find((t) => t.text === "1998 Promo")!;
  assert.ok(promo && near(promo.y, short.pg.y, 1e-9) && promo.x + promo.width <= short.pg.x, "\"1998 Promo\" beside its PG field");
  // A full bag: every row two lines, the set cut before the field with its card number kept
  const four = bag(4, { otherBags: [] });
  four.cards[0] = { ...four.cards[0], name: "Pikachu Illustrator", year: "1998", set: "Promo", number: "" };
  four.cards[3] = { ...four.cards[3], name: "Charizard Holo 1st Edition", pregrade: "PSA 8–9" };
  const p4 = planBagLabel(four, MM50);
  assert.equal(p4.fit.more, 0);
  const m4 = checkRowMarks(four, MM50, p4.page, "four, long names");
  for (const c of four.cards.slice(1)) assert.ok(words(p4.page).some((w) => w.endsWith(`#${c.number}`)), `${c.code}: its card number`);
  assert.ok(words(p4.page).includes("Charizard Holo 1st Edition"), "a name of 26 letters whole on its own line");
  assert.equal(m4.get(four.cards[3].code)!.value?.text, "PSA 8–9");
});

test("the name, the QR and the banner keep their sizes with the check boxes and PG lines (usual test names, 4x6 and 50 x 80 mm)", () => {
  // The FILED table's sizes were recorded before the filing tab and are still the sizes before the check boxes;
  // the QR stays 1 in (its minimum) at the same place as before
  for (const [name, , wide, mm50] of FILED) {
    for (const [key, stock, sizes] of [["4x6", DEFAULT, wide], ["50 x 80 mm", MM50, mm50]] as const) {
      for (const [i, dueDate] of (["2026-12-07", "2027-01-08"] as const).entries()) {
        for (const n of [1, 4, 12, 40]) {
          const b = bag(n, { customerName: name, dueDate, otherBags: [{ bagCode: "CD-10482-G", tierName: "Gold", cardCount: 2 }] });
          b.cards[0] = { ...b.cards[0], pregrade: "PSA 8–9" };
          const { page, fit } = planBagLabel(b, stock);
          const label = `${name}, ${key}, ${n} cards, due ${dueDate}`;
          assert.deepEqual([fit.nameSize, fit.nameLines], [sizes[2 * i], sizes[2 * i + 1]], `${label}: name size and lines`);
          const q = qrs(page)[0];
          assert.equal(q.size, LABEL_LIMITS.minBagQrIn * PT, `${label}: QR 1 in`);
          assert.ok(checkBoxes(page).length === page.cardCodes.length && pgWords(page).length === page.cardCodes.length, `${label}: marks on every row`);
        }
      }
    }
  }
});

test("a submitted pre-grade is printed on its PG line; the others are left blank to write on", () => {
  for (const [where, stock] of [["4x6", DEFAULT], ["50 x 80 mm", MM50], ["4x6 two columns", DEFAULT]] as const) {
    const n = where.endsWith("columns") ? 20 : 4;
    const b = bag(n);
    b.cards[1] = { ...b.cards[1], pregrade: "9" };
    b.cards[2] = { ...b.cards[2], pregrade: "PSA 8–9" };
    b.cards[3] = { ...b.cards[3], pregrade: "  " };
    const page = layoutBagLabel(b, stock);
    const marks = checkRowMarks(b, stock, page, where);
    const value = (i: number) => marks.get(b.cards[i].code)!.value;
    assert.equal(value(1)?.text, "9", `${where}: "9" on card 2's line`);
    assert.equal(value(1)?.font, "body800");
    assert.ok(value(2) && /^PSA 8–9$|^PSA.*…$/.test(value(2)!.text), `${where}: card 3's pre-grade (${value(2)?.text})`);
    assert.equal(value(0), undefined, `${where}: card 1 blank`);
    assert.equal(value(3), undefined, `${where}: a blank pre-grade prints nothing`);
    // The value sits on its line, centered, and stays as legible as the row
    const v = value(1)!;
    const ln = marks.get(b.cards[1].code)!.line;
    assert.ok(near(v.x + v.width / 2, (ln.x1 + ln.x2) / 2, 0.01), `${where}: the value centered on the line`);
    assert.ok(v.size >= LABEL_LIMITS.minTextPt && v.size === marks.get(b.cards[1].code)!.pg.size);
    // A blank line is as long as the "9" line: the value never shortens it
    assert.ok(near(ln.x2 - ln.x1, marks.get(b.cards[0].code)!.line.x2 - marks.get(b.cards[0].code)!.line.x1, 1e-9));
  }
  // The same bag without pre-grades prints only blank lines, at the same places
  const plain = layoutBagLabel(bag(4), DEFAULT);
  const graded = bag(4);
  graded.cards[1] = { ...graded.cards[1], pregrade: "9" };
  const withValue = layoutBagLabel(graded, DEFAULT);
  assert.deepEqual(pgLines(plain), pgLines(withValue));
  assert.deepEqual(checkBoxes(plain), checkBoxes(withValue));
  assert.equal(texts(withValue).length, texts(plain).length + 1, "only the value added");
  // A long pre-grade is cut with "…" and stays inside the row; the name keeps its place
  const long = bag(1);
  long.cards[0] = { ...long.cards[0], pregrade: "Gem Mint 10 if the centering holds up under the loupe, else a strong 9" };
  for (const stock of [DEFAULT, MM50]) {
    const page = layoutBagLabel(long, stock);
    checkLabel(long, stock, page, "long pre-grade");
    assert.deepEqual(overlaps(page), []);
    const m = checkRowMarks(long, stock, page, "long pre-grade").get(long.cards[0].code)!;
    assert.ok(m.value && m.value.text.endsWith("…") && m.value.text.startsWith("Gem"), `cut: "${m.value?.text}"`);
    // The field grows for it, at most to ROW_MARKS.pgValueShare of the row's text width
    assert.ok(m.line.x2 - m.line.x1 > ROW_MARKS.pgLineMinPt, "the line grew for the value");
    assert.ok(m.value.x + m.value.width <= m.line.x2 + 1e-9 && m.value.x >= m.line.x1 - 1e-9);
  }
});

test("short pre-grades are never cut, on any stock or card count; on 50 x 80 mm a one-card bag prints its whole name (QA, Nov 26: \"PSA 9\" printed \"P…\", the name \"Test Car…\")", () => {
  // The e2e bags (labels-checkbox-pg): CD-2549-P holds one card with "PSA 9"; CD-2549-G four, one "PSA 8–9", one long
  const LONG = "PSA 8–9, centering 60/40 on the back, light whitening on two corners";
  const mk = (bagCode: string, tierName: string, rows: [string, string, string | null][], seq0: number): LabelBag => ({
    bagCode, tierName, orderNumber: "CD-2549", customerName: "Test Customer A", receivedOn: "2026-11-15", dueDate: "2026-12-07",
    otherBags: [{ bagCode: bagCode.endsWith("P") ? "CD-2549-G" : "CD-2549-P", tierName: "Other", cardCount: 1 }],
    cards: rows.map(([name, number, pregrade], i) => ({ seq: seq0 + i, code: `CD-2549-${String(seq0 + i).padStart(2, "0")}`, name, year: "1999", set: "Base Set", number, pregrade })),
  });
  const plat = mk("CD-2549-P", "Platinum", [["Test Card Platinum One", "1/130", "PSA 9"]], 7);
  const gold = mk("CD-2549-G", "Gold", [["Test Card Gold One", "4/102", null], ["Test Card Gold Two", "10/102", "PSA 8–9"], ["Test Card Gold Three", "15/102", null], ["Test Card Gold Four", "58/102", LONG]], 1);
  for (const [where, stock] of [["4x6", DEFAULT], ["50 x 80 mm", MM50]] as const) {
    const p = layoutBagLabel(plat, stock);
    checkLabel(plat, stock, p, `${where} CD-2549-P`);
    assert.deepEqual(overlaps(p), []);
    assert.equal(checkRowMarks(plat, stock, p, `${where} CD-2549-P`).get("CD-2549-07")!.value?.text, "PSA 9", `${where}: "PSA 9" whole`);
    assert.ok(words(p).includes("Test Card Platinum One"), `${where}: the one card's whole name`);
    const g = layoutBagLabel(gold, stock);
    checkLabel(gold, stock, g, `${where} CD-2549-G`);
    assert.deepEqual(overlaps(g), []);
    const gm = checkRowMarks(gold, stock, g, `${where} CD-2549-G`);
    assert.equal(gm.get("CD-2549-02")!.value?.text, "PSA 8–9");
    assert.ok(/^PSA 8.*…$/.test(gm.get("CD-2549-04")!.value?.text ?? ""), `${where}: the long one cut (${gm.get("CD-2549-04")!.value?.text})`);
    for (const c of gold.cards) assert.ok(words(g).includes(c.name), `${where}: "${c.name}" whole`);
  }
  // Grades of up to 10 characters, on every stock and width, 1 to 120 cards: printed whole wherever their card is listed
  const GRADES = ["9", "PSA 9", "PSA 10", "PSA 8–9", "BGS 9.5", "CGC 9.8", "GEM MT 10"];
  const stocks: [string, LabelStock][] = [["4x6", DEFAULT], ["50 x 80 mm", MM50], ["4x6 at 2 in", stockPoints("4x6", 2)], ["4x6 at 4 in", stockPoints("4x6", 4)], ["3x5", stockPoints("3x5", 2.6)], ["4x3", stockPoints("4x3", 3.2)]];
  for (const [where, stock] of stocks) {
    for (const n of [1, 2, 4, 12, 16, 40, 120]) {
      const b = bag(n);
      b.cards = b.cards.map((c, i) => ({ ...c, pregrade: GRADES[i % GRADES.length] }));
      const label = `${where}, ${n} cards`;
      const page = layoutBagLabel(b, stock);
      checkLabel(b, stock, page, label);
      assert.deepEqual(overlaps(page), [], `${label}: nothing printed on top of something else`);
      const marks = checkRowMarks(b, stock, page, label);
      for (const c of b.cards.filter((x) => page.cardCodes.includes(x.code))) assert.equal(marks.get(c.code)!.value?.text, c.pregrade, `${label}: ${c.code}'s "${c.pregrade}"`);
      // The owner's stocks: a bag that fits prints every ordinary name whole (the field never takes a name's room)
      if (n <= 4 && (stock === DEFAULT || stock === MM50)) assert.equal(planBagLabel(b, stock).fit.namesCut, 0, `${label}: names whole`);
    }
  }
});

test("settings capacity: cards at full size and before +N more", () => {
  const c = bagLabelCapacity(DEFAULT);
  // Since the check boxes: 6 at full size and 28 in all on 4x6 at 3.2 in (10 and 42 before them)
  assert.ok(c.normal >= 6 && c.max >= 28 && c.max > c.normal, JSON.stringify(c));
  const short = bagLabelCapacity(stockPoints("4x3", 3.2));
  assert.ok(short.max < c.max);
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

// ── The loader, against a tiny in-memory stand-in for the Supabase client ──

type Row = Record<string, unknown>;
function fakeAdmin(tables: Record<string, Row[]>): SupabaseClient {
  const query = (rows: Row[]) => {
    let out = rows;
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => ((out = out.filter((r) => r[col] === v)), q),
      in: (col: string, vs: unknown[]) => ((out = out.filter((r) => vs.includes(r[col]))), q),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: out, error: null }),
    };
    return q;
  };
  return { from: (t: string) => query(tables[t] ?? []) } as unknown as SupabaseClient;
}

const ORDER = "00000000-0000-4000-8000-000000000001";
const BAG_G = "00000000-0000-4000-8000-00000000000a";
const BAG_P = "00000000-0000-4000-8000-00000000000b";
const card = (id: string, bagId: string | null, seq: number, status = "received", pregrade: { pregrade_result?: string; pregrade_submitted_at?: string } = {}) => ({
  id, bag_id: bagId, card_seq: seq, card_code: `CD-10482-${String(seq).padStart(2, "0")}`, card_name: `Card ${seq}`, card_set: "Set", card_year: "1999", card_number: String(seq), status,
  pregrade_result: null, pregrade_submitted_at: null, ...pregrade,
});
const TABLES = {
  tier_bags: [
    { id: BAG_G, order_id: ORDER, tier: "premium", batch: 1, bag_code: "CD-10482-G", received_on: "2026-11-15", due_date: "2026-12-14", due_status: "calculated", label_printed_at: null },
    { id: BAG_P, order_id: ORDER, tier: "ultra_premium", batch: 1, bag_code: "CD-10482-P", received_on: "2026-11-15", due_date: "2026-12-07", due_status: "calculated", label_printed_at: null },
  ],
  orders: [{ id: ORDER, order_number: "CD-10482", customer_name: "Jordan Reyes" }],
  cards: [
    card("c5", BAG_G, 5), card("c6", BAG_G, 6), card("c7", BAG_G, 7, "refunded"),
    // c2's pre-grade was submitted; c3 has a result saved but not submitted (never printed)
    card("c2", BAG_P, 2, "received", { pregrade_result: " 9 ", pregrade_submitted_at: "2026-11-20T15:00:00Z" }), card("c1", BAG_P, 1),
    card("c3", BAG_P, 3, "received", { pregrade_result: "8" }), card("c4", BAG_P, 4),
    card("c8", null, 8),
  ],
  restoration_settings: [{ tier: "ultra_premium", display_name: "Platinum" }, { tier: "premium", display_name: "Gold" }],
};

test("loader: the order's bags in tier order, non-refunded bagged cards by number, the other bags named", async () => {
  const { bags, error } = await loadLabelBags(fakeAdmin(TABLES), { orderId: ORDER });
  assert.equal(error, null);
  assert.deepEqual(bags.map((b) => b.bagCode), ["CD-10482-P", "CD-10482-G"], "Platinum before Gold");
  assert.deepEqual(bags[0].cards.map((c) => c.seq), [1, 2, 3, 4]);
  assert.deepEqual(bags[1].cards.map((c) => c.seq), [5, 6], "refunded and unbagged cards left out");
  assert.deepEqual(bags[0].cards.map((c) => c.pregrade), [null, "9", null, null], "only a submitted pre-grade goes on the label");
  const printed = checkRowMarks(bags[0], DEFAULT, layoutBagLabel(bags[0], DEFAULT), "loaded bag");
  assert.deepEqual(bags[0].cards.map((c) => printed.get(c.code)?.value?.text ?? null), [null, "9", null, null]);
  assert.equal(bags[0].qrUrl, "HTTPS://THECARDDOC1.COM/Q/CD-10482-P");
  assert.equal(bags[0].dueStatus, "calculated");
  assert.deepEqual(bags[0].otherBags, [{ bagCode: "CD-10482-G", tierName: "Gold", cardCount: 2 }]);
  assert.deepEqual(bags[1].otherBags, [{ bagCode: "CD-10482-P", tierName: "Platinum", cardCount: 4 }]);

  const one = await loadLabelBags(fakeAdmin(TABLES), { bagId: BAG_G });
  assert.deepEqual(one.bags.map((b) => b.bagCode), ["CD-10482-G"]);
  assert.deepEqual(one.bags[0].otherBags, [{ bagCode: "CD-10482-P", tierName: "Platinum", cardCount: 4 }]);
  assert.deepEqual((await loadLabelBags(fakeAdmin(TABLES), { bagId: "00000000-0000-4000-8000-0000000000ff" })).bags, []);
});

test("routes' response: a two-tier order is 2 one-page labels; JSON has labels[1] per bag and no tag; ?tag=1 is ignored", async () => {
  const { bags } = await loadLabelBags(fakeAdmin(TABLES), { orderId: ORDER });
  const settings = { stock: "4x6" as const, contentWidthIn: 3.2 };
  const json = (await (await labelResponse(new Request("http://x/api?format=json"), bags, settings, "CD-10482")).json()) as LabelPreviewResponse;
  assert.deepEqual(json.settings, { stock: "4x6", contentWidthIn: 3.2, widthIn: 4, heightIn: 6 });
  assert.equal(json.bags.length, 2);
  for (const [i, b] of json.bags.entries()) {
    assert.equal(b.id, bags[i].id);
    assert.equal(b.cardCount, bags[i].cards.length);
    assert.equal(b.labels.length, 1, "one label per bag");
    assert.deepEqual(b.labels[0].cardCodes, bags[i].cards.map((c) => c.code));
    assert.ok(!("tag" in b), "no tag");
  }
  for (const query of ["", "?tag=1"]) {
    const res = await labelResponse(new Request(`http://x/api${query}`), bags, settings, "CD-10482");
    assert.equal(res.headers.get("Content-Type"), "application/pdf");
    const doc = await PDFDocument.load(new Uint8Array(await res.arrayBuffer()));
    assert.equal(doc.getPageCount(), 2, `order PDF${query}: one page per bag`);
  }
  const single = await labelResponse(new Request("http://x/api?tag=1"), bags.slice(1), settings, "CD-10482-G");
  assert.equal((await PDFDocument.load(new Uint8Array(await single.arrayBuffer()))).getPageCount(), 1, "bag PDF: one page");
});

test("PDF: one page per bag at 4x6 in, brand fonts embedded; sample PDFs written", async () => {
  const out = path.join(process.cwd(), "tests", "intake", "out");
  mkdirSync(out, { recursive: true });
  for (const n of [1, 4, 16, 40, 120]) {
    const pages = layoutBagLabels(bag(n), DEFAULT);
    const { bytes, brandFonts } = await renderLabelPdf(pages, { title: "Bag label CD-10482-P" });
    assert.equal(brandFonts, true, "brand fonts embedded");
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
    assert.deepEqual(doc.getPages()[0].getSize(), { width: 288, height: 432 });
    writeFileSync(path.join(out, `sample-${n}-cards.pdf`), bytes);
  }
  const plat = bag(4, { otherBags: [{ bagCode: "CD-10482-G", tierName: "Gold", cardCount: 2 }] });
  const gold = bag(2, { bagCode: "CD-10482-G", tierName: "Gold", dueDate: "2026-12-14", otherBags: [{ bagCode: "CD-10482-P", tierName: "Platinum", cardCount: 4 }] });
  const two = await bagLabelsPdf([plat, gold], DEFAULT, "Bag labels CD-10482");
  assert.equal((await PDFDocument.load(two.bytes)).getPageCount(), 2);
  writeFileSync(path.join(out, "sample-two-tiers.pdf"), two.bytes);
});
