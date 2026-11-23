/**
 * Bag labels (lib/intake/labels), Design B "Name banner": ONE label per tier
 * bag at any card count (1, 4, 16, 40, 120 cards), on every stock and width;
 * the one bag QR; the customer's name as the largest type with the due date
 * big beside it; "+N more: scan the QR" only when the bag doesn't fit; the
 * order's other bags named; the loader's tier order; the PDF and JSON the
 * routes send. Writes sample PDFs to tests/intake/out/ (git-ignored).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { qrUrl } from "@/lib/intake/codes";
import { loadLabelBags } from "@/lib/intake/labels/data";
import { LABEL_LIMITS, PT, bagLabelCapacity, fitName, layoutBagLabel, layoutBagLabels, moreText, planBagLabel, printedWidth } from "@/lib/intake/labels/layout";
import { bagLabelsPdf, renderLabelPdf } from "@/lib/intake/labels/pdf";
import { qrMatrix } from "@/lib/intake/labels/qr";
import { labelResponse, type LabelPreviewResponse } from "@/lib/intake/labels/respond";
import { normalizeLabelSettings, stockPoints } from "@/lib/intake/labels/stock";
import { fitLine, printable, textWidth, wrapLines } from "@/lib/intake/labels/text";
import { FONT_METRICS } from "@/lib/intake/labels/fonts/metrics";
import type { LabelBag, LabelPage, LabelQr, LabelStock, LabelText } from "@/lib/intake/labels/types";

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
  const biggest = Math.max(...texts(p).map((t) => t.size));
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

  // Bag ID on the tier row (mono, ink) and in the QR block
  assert.ok(texts(p).filter((t) => t.text === b.bagCode && t.font === "mono600").length >= 2, `${label}: Bag ID twice`);

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
    // Up to 40 cards every card is listed; 120 don't fit
    if (n <= 40) assert.equal(pages[0].cardCodes.length, n, `${n} cards all listed`);
    else assert.ok(pages[0].cardCodes.length >= 30 && pages[0].cardCodes.length < n, `${n} cards: ${pages[0].cardCodes.length} listed`);
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
    : e.kind === "rect" ? { kind: e.h > 30 ? "banner" : "rule", what: `rect at ${e.y.toFixed(1)}`, x1: e.x, x2: e.x + e.w, y1: e.y, y2: e.y + e.h }
    : { kind: "rule", what: `rule at ${e.y1.toFixed(1)}`, x1: Math.min(e.x1, e.x2), x2: Math.max(e.x1, e.x2), y1: e.y1 - e.width / 2, y2: e.y1 + e.width / 2 });
  const hit = (a: Box, b: Box) => a.x1 < b.x2 - 0.2 && b.x1 < a.x2 - 0.2 && a.y1 < b.y2 - 0.2 && b.y1 < a.y2 - 0.2;
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      if (a.kind === "banner" || b.kind === "banner" || (a.kind !== "text" && b.kind !== "text")) continue;
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
    const biggest = Math.max(...texts(p).map((t) => t.size));
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
  const name = Math.max(...texts(p).map((t) => t.size));
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

test("settings capacity: cards at full size and before +N more", () => {
  const c = bagLabelCapacity(DEFAULT);
  assert.ok(c.normal >= 8 && c.max >= 40 && c.max > c.normal, JSON.stringify(c));
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
const card = (id: string, bagId: string | null, seq: number, status = "received") => ({
  id, bag_id: bagId, card_seq: seq, card_code: `CD-10482-${String(seq).padStart(2, "0")}`, card_name: `Card ${seq}`, card_set: "Set", card_year: "1999", card_number: String(seq), status,
});
const TABLES = {
  tier_bags: [
    { id: BAG_G, order_id: ORDER, tier: "premium", batch: 1, bag_code: "CD-10482-G", received_on: "2026-11-15", due_date: "2026-12-14", due_status: "calculated", label_printed_at: null },
    { id: BAG_P, order_id: ORDER, tier: "ultra_premium", batch: 1, bag_code: "CD-10482-P", received_on: "2026-11-15", due_date: "2026-12-07", due_status: "calculated", label_printed_at: null },
  ],
  orders: [{ id: ORDER, order_number: "CD-10482", customer_name: "Jordan Reyes" }],
  cards: [
    card("c5", BAG_G, 5), card("c6", BAG_G, 6), card("c7", BAG_G, 7, "refunded"),
    card("c2", BAG_P, 2), card("c1", BAG_P, 1), card("c3", BAG_P, 3), card("c4", BAG_P, 4),
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
