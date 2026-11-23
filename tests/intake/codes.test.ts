/** Card IDs, Bag IDs and QR links (lib/intake/codes.ts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TIER_LETTERS, bagCode, cardCode, codeKind, effectiveTier, nextCardSeqs, normalizeCode, normalizeTier, qrPath, qrUrl,
  tierDisplayName, tierLetter,
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
  assert.equal(normalizeCode("CD2549"), "");
  assert.equal(codeKind("CD-2549-03"), "card");
  assert.equal(codeKind("CD-2549-104"), "card");
  assert.equal(codeKind("CD-2549-P"), "bag");
  assert.equal(codeKind("CD-2549-P2"), "bag");
  assert.equal(codeKind("CD-2549"), null);
});

test("QR content is the site's /q link, all upper case (alphanumeric mode)", () => {
  const saved = process.env.NEXT_PUBLIC_APP_URL;
  try {
    delete process.env.NEXT_PUBLIC_APP_URL;
    assert.equal(qrUrl("cd-2549-03"), "HTTPS://THECARDDOC1.COM/Q/CD-2549-03");
    assert.equal(qrUrl("CD-2549-P2"), "HTTPS://THECARDDOC1.COM/Q/CD-2549-P2");
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
