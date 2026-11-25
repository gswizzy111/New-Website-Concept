/** Order codes, Card IDs, Bag IDs and QR links (lib/intake/codes.ts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TIER_LETTERS, bagCode, cardCode, codeKind, codeTargetPath, effectiveTier, nextCardSeqs, normalizeCode, normalizeTier,
  openCodePath, orderPhotosPath, qrPath, qrUrl, tierDisplayName, tierLetter,
} from "@/lib/intake/codes";

test("tier letters", () => {
  assert.deepEqual(
    ["regular", "expedited", "premium", "ultra_premium", "elite", "fast_pass", "prep"].map(tierLetter),
    ["B", "S", "G", "P", "D", "F", "R"],
  );
  assert.equal(tierLetter("prep_standard"), "R");
  assert.equal(tierLetter("something_new"), "U");
  assert.equal(tierLetter(null), "U");
  assert.equal(new Set(Object.values(TIER_LETTERS)).size, Object.keys(TIER_LETTERS).length, "letters are unique");
});

test("tiers: normalize, effective tier, names", () => {
  assert.equal(normalizeTier(" prep_standard "), "prep");
  assert.equal(normalizeTier(""), null);
  assert.equal(effectiveTier(null, "premium"), "premium");
  assert.equal(effectiveTier("ultra_premium", "premium"), "ultra_premium");
  assert.equal(effectiveTier(null, null), null);
  assert.equal(tierDisplayName("ultra_premium"), "Platinum");
  assert.equal(tierDisplayName("ultra_premium", { ultra_premium: "Platinum+" }), "Platinum+");
  assert.equal(tierDisplayName(null), "No tier");
});

test("Card IDs pad to 2 digits, 3+ from 100", () => {
  assert.equal(cardCode("CD-2549", 3), "CD-2549-03");
  assert.equal(cardCode("CD-2549", 12), "CD-2549-12");
  assert.equal(cardCode("CD-2549", 104), "CD-2549-104");
  assert.equal(cardCode("cd-2549", 1), "CD-2549-01");
  assert.throws(() => cardCode("CD-2549", 0));
  assert.throws(() => cardCode("", 1));
});

test("Bag IDs: tier letter, batch suffix from 2", () => {
  assert.equal(bagCode("CD-2549", "ultra_premium"), "CD-2549-P");
  assert.equal(bagCode("CD-2549", "ultra_premium", 1), "CD-2549-P");
  assert.equal(bagCode("CD-2549", "ultra_premium", 2), "CD-2549-P2");
  assert.equal(bagCode("CD-2549", "premium", 11), "CD-2549-G11");
  assert.equal(bagCode("CD-2549", "prep_standard"), "CD-2549-R");
  assert.throws(() => bagCode("CD-2549", "premium", 0));
});

test("scanned and typed codes normalize to the stored form", () => {
  assert.equal(normalizeCode(" cd-2549-03 "), "CD-2549-03");
  assert.equal(normalizeCode("#CD-2549-P2"), "CD-2549-P2");
  assert.equal(normalizeCode("https://thecarddoc1.com/q/cd-2549-g"), "CD-2549-G");
  assert.equal(normalizeCode("HTTPS://THECARDDOC1.COM/Q/CD-2549-G?x=1"), "CD-2549-G");
  assert.equal(normalizeCode("CD%2D2549%2D03"), "CD-2549-03");
  assert.equal(normalizeCode("<script>"), "");
  assert.equal(normalizeCode("CD 2549 03"), "CD-2549-03", "spaces read as dashes");
  assert.equal(normalizeCode("cd-2549 - p2"), "CD-2549-P2");
  assert.equal(normalizeCode("CD2549-03"), "CD-2549-03");
  assert.equal(codeKind("CD-2549-03"), "card");
  assert.equal(codeKind("CD-2549-104"), "card");
  assert.equal(codeKind("CD-2549-P"), "bag");
  assert.equal(codeKind("CD-2549-P2"), "bag");
  assert.equal(codeKind("CD-2549"), "order");
  assert.equal(codeKind("CD-2549-3"), null);
  assert.equal(codeKind("JOHN-SMITH"), null);
  assert.equal(codeKind("CD-2549-P-2"), null);
});

test("order codes: the order number in the forms staff type or a scanner sends", () => {
  for (const raw of [
    "CD-2549", "cd-2549", " Cd-2549 ", "#CD-2549", "# cd-2549", "CD 2549", "cd  2549", "CD - 2549", "CD2549", "cd2549",
    "CD%2D2549", "https://thecarddoc1.com/q/cd-2549", "HTTPS://THECARDDOC1.COM/Q/CD-2549", "HTTPS://THECARDDOC1.COM/Q/CD-2549?x=1",
    "https://theonethatsaveditall.com/Q/CD-2549/", "/q/CD-2549",
  ]) {
    assert.equal(normalizeCode(raw), "CD-2549", raw);
    assert.equal(codeKind(normalizeCode(raw)), "order", raw);
  }
  assert.equal(normalizeCode("cd-12345"), "CD-12345", "five-digit order numbers (after CD-9999)");
  // A bare number is never a code: it could as well be a kit order (K2549) or a typo
  for (const raw of ["2549", "#2549", " 2549 ", "%232549", "https://thecarddoc1.com/q/2549", "K2549", "k-2549x", "CD-", "CD--2549", ""]) {
    assert.equal(codeKind(normalizeCode(raw)), null, raw);
  }
  assert.equal(normalizeCode("2549"), "");
  assert.equal(normalizeCode("#2549"), "");
  assert.equal(normalizeCode("https://thecarddoc1.com/q/2549"), "");
  assert.equal(normalizeCode(null), "");
});

test("order codes, Card IDs and Bag IDs never read as each other", () => {
  const order = "CD-2549";
  const cards = [cardCode(order, 1), cardCode(order, 12), cardCode(order, 104)];
  const bags = ["regular", "expedited", "premium", "ultra_premium", "elite", "fast_pass", "prep", null].flatMap((t) => [bagCode(order, t), bagCode(order, t, 2), bagCode(order, t, 11)]);
  assert.equal(codeKind(normalizeCode(order)), "order");
  for (const c of cards) assert.equal(codeKind(normalizeCode(c.toLowerCase())), "card", c);
  for (const b of bags) assert.equal(codeKind(normalizeCode(b.toLowerCase())), "bag", b);
  // Each from its QR link too
  for (const c of [order, ...cards, ...bags]) assert.equal(normalizeCode(qrUrl(c)), c, c);
});

test("a scanned code opens: order and bag -> the scan landing, card -> card page", () => {
  const order = "00000000-0000-4000-8000-000000000001";
  const bag = "00000000-0000-4000-8000-0000000000b1";
  const card = "00000000-0000-4000-8000-0000000000c1";
  // With the code (what /q passes): the scan landing, /admin/receiving/open/<code>
  assert.equal(codeTargetPath("order", order, order, "CD-2549"), "/admin/receiving/open/CD-2549");
  assert.equal(codeTargetPath("bag", bag, order, "CD-2549-P"), "/admin/receiving/open/CD-2549-P");
  assert.equal(codeTargetPath("bag", bag, order, "cd-2549-p2"), "/admin/receiving/open/CD-2549-P2", "normalized");
  assert.equal(codeTargetPath("bag", bag, null, "CD-2549-P"), "/admin/receiving/open/CD-2549-P", "a bag's order isn't needed");
  assert.equal(openCodePath("cd 2549"), "/admin/receiving/open/CD-2549");
  assert.equal(openCodePath(qrUrl("CD-2549-P")), "/admin/receiving/open/CD-2549-P", "from its QR link");
  // A code of another kind is never trusted: the photos pages as before
  assert.equal(codeTargetPath("bag", bag, order, "CD-2549"), `/admin/receiving/${order}/photos?bag=${bag}`);
  assert.equal(codeTargetPath("order", order, order, "CD-2549-P"), `/admin/receiving/${order}/photos`);
  // Without the code: the photos pages as before
  assert.equal(codeTargetPath("order", order, order), `/admin/receiving/${order}/photos`);
  assert.equal(codeTargetPath("order", order), `/admin/receiving/${order}/photos`);
  assert.equal(codeTargetPath("bag", bag, order), `/admin/receiving/${order}/photos?bag=${bag}`);
  assert.equal(codeTargetPath("bag", bag), `/admin/receiving/bag/${bag}`, "a bag without a known order: its bag page");
  assert.equal(codeTargetPath("card", card, order, "CD-2549-03"), `/admin/receiving/card/${card}`, "a Card ID keeps its card page");
  assert.equal(codeTargetPath("card", card, order), `/admin/receiving/card/${card}`);
  assert.equal(codeTargetPath("card", card), `/admin/receiving/card/${card}`);
  assert.equal(orderPhotosPath(order), `/admin/receiving/${order}/photos`);
  assert.equal(orderPhotosPath(order, null), `/admin/receiving/${order}/photos`);
  assert.equal(orderPhotosPath(order, bag), `/admin/receiving/${order}/photos?bag=${bag}`);
  assert.equal(codeTargetPath("bag", "b&c", "a/b?c"), "/admin/receiving/a%2Fb%3Fc/photos?bag=b%26c", "ids are escaped");
});

test("LIKE wildcards, line breaks and path tricks never survive as a code", () => {
  for (const raw of [
    "CD-25_9", "CD-2549%", "CD-%", "CD%25", "CD-*", "CD-2549-P*", "cd_2549", "CD-2549-P%0aSet-Cookie:x",
    "../admin", "%2e%2e", "CD-2549/../x", "//evil.example", "CD-2549?next=//evil.example", "ＣＤ-2549", "CD-٢٥٤٩",
  ]) {
    const code = normalizeCode(raw);
    assert.ok(code === "" || /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(code), raw);
    assert.equal(codeKind(code), null, raw);
  }
  // A scanner's trailing line break or an encoded one after the link is dropped
  assert.equal(normalizeCode("CD-2549-P\r\n"), "CD-2549-P");
  assert.equal(normalizeCode("HTTPS://THECARDDOC1.COM/Q/CD-2549-P%0D%0A"), "CD-2549-P");
  // Bag batches 2..99 and order numbers past CD-9999
  for (const b of [2, 9, 10, 99]) assert.equal(codeKind(normalizeCode(bagCode("CD-12345", "premium", b).toLowerCase())), "bag", String(b));
  assert.equal(codeKind(normalizeCode("cd-12345-104")), "card");
});

test("QR content is the site's /q link, all upper case (alphanumeric mode)", () => {
  const saved = process.env.NEXT_PUBLIC_APP_URL;
  try {
    delete process.env.NEXT_PUBLIC_APP_URL;
    assert.equal(qrUrl("cd-2549-03"), "HTTPS://THECARDDOC1.COM/Q/CD-2549-03");
    assert.equal(qrUrl("CD-2549-P2"), "HTTPS://THECARDDOC1.COM/Q/CD-2549-P2");
    // The order label's one QR: qrUrl(order_number)
    assert.equal(qrUrl("CD-2549"), "HTTPS://THECARDDOC1.COM/Q/CD-2549");
    assert.equal(qrUrl(" cd-2549 "), "HTTPS://THECARDDOC1.COM/Q/CD-2549");
    assert.equal(qrPath("cd-2549"), "/q/CD-2549");
    process.env.NEXT_PUBLIC_APP_URL = "https://Preview.example.com/";
    assert.equal(qrUrl("CD-2549-G"), "HTTPS://PREVIEW.EXAMPLE.COM/Q/CD-2549-G");
    assert.match(qrUrl("CD-2549-G"), /^[0-9A-Z $%*+\-./:]+$/, "only QR alphanumeric characters");
    assert.equal(qrPath("cd-2549-g"), "/q/CD-2549-G");
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = saved;
  }
});

test("card numbers: existing kept, new ones after the max in (created_at, id) order", () => {
  const t = "2026-11-10T15:00:00.123456+00:00";
  const seqs = nextCardSeqs([
    { id: "c", created_at: t, card_seq: null },
    { id: "a", created_at: t, card_seq: null },
    { id: "z", created_at: "2026-11-01T00:00:00+00:00", card_seq: 2 },
    { id: "b", created_at: "2026-11-10T15:00:00.123455+00:00", card_seq: null }, // a microsecond earlier
    { id: "y", created_at: "2026-11-12T09:00:00+00:00", card_seq: null },
  ]);
  assert.deepEqual(seqs, [{ id: "b", seq: 3 }, { id: "a", seq: 4 }, { id: "c", seq: 5 }, { id: "y", seq: 6 }]);
  assert.deepEqual(nextCardSeqs([{ id: "a", created_at: t, card_seq: 1 }]), []);
  // A gap is never refilled: numbers are never reused
  assert.deepEqual(nextCardSeqs([{ id: "a", created_at: t, card_seq: 5 }, { id: "b", created_at: t, card_seq: null }]), [{ id: "b", seq: 6 }]);
});

test("place codes (LOC-...) are their own kind and open the Scan page", () => {
  for (const c of ["LOC-CLAMP-07", "LOC-HEAT-PRESS-03", "LOC-SHELF-20261207", "LOC-DONE", "LOC-SHIP"]) {
    assert.equal(codeKind(c), "location", c);
    assert.equal(codeKind(normalizeCode(`https://thecarddoc1.com/q/${c.toLowerCase()}`)), "location", c);
  }
  // Checked first: these would otherwise read as an order or a Card ID
  assert.equal(codeKind("LOC-123"), "location");
  assert.equal(codeKind("LOC-2026-12"), "location");
  assert.equal(codeKind(`LOC-${"X".repeat(36)}`), "location", "40 characters");
  assert.equal(codeKind(`LOC-${"X".repeat(37)}`), null, "41 characters");
  assert.equal(codeTargetPath("location", "id-1", null, "LOC-CLAMP-07"), "/admin/scan?loc=LOC-CLAMP-07");
  // Order, card and bag codes are unchanged
  assert.equal(codeKind("CD-2549"), "order");
  assert.equal(codeKind("CD-2549-03"), "card");
  assert.equal(codeKind("CD-2549-P2"), "bag");
});
