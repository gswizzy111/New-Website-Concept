/**
 * Tier guesses for "Print labels" (lib/intake/tier-guess.ts). The orders below
 * are shaped after real ones (production, Nov 24 2026: the old site's mixed
 * checkouts, $75 single-service orders, hand-made orders), with made-up cards.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  guessTiers, signedCardsFromDropoff, signedCardsFromSignature, tierFromName, tierPricing, tiersOfService,
  type GuessCard, type GuessInput, type ServiceLine, type TierGuess,
} from "@/lib/intake/tier-guess";

// Production's restoration_settings (Nov 24 2026)
const PRICING = tierPricing([
  { tier: "fast_pass", price_cents: 25000 }, { tier: "expedited", price_cents: 9999 }, { tier: "ultra_premium", price_cents: 14999 },
  { tier: "elite", price_cents: null, pricing_rate: "0.07", min_card_value_cents: 500000 }, { tier: "regular", price_cents: 7499 }, { tier: "premium", price_cents: 11999 },
]);

const cards = (...values: (number | null)[]): GuessCard[] =>
  values.map((v, i) => ({ id: `c${i + 1}`, card_name: `Card ${i + 1}`, estimated_value_cents: v == null ? null : v * 100, tier: null }));
const line = (service_name: string, price_cents: number, quantity = 1, service_id: string | null = ""): ServiceLine => ({ service_id, service_name, price_cents, quantity });

function guess(over: Partial<GuessInput> & { cards: GuessCard[] }): Record<string, TierGuess> {
  return guessTiers({ orderTier: null, signed: [], services: [], checkoutEvents: [], pricing: PRICING, ...over });
}
const tiers = (g: Record<string, TierGuess>) => Object.keys(g).sort().map((id) => `${g[id].tier ?? "-"}/${g[id].confidence}`);

test("the card's own tier, then the order's, are sure", () => {
  const g = guess({ cards: [{ id: "a", card_name: "A", tier: "premium" }, { id: "b", card_name: "B", tier: null }], orderTier: "prep_standard" });
  assert.deepEqual([g.a.tier, g.a.confidence, g.a.source], ["premium", "sure", "card"]);
  assert.deepEqual([g.b.tier, g.b.confidence, g.b.source, g.b.why], ["prep", "sure", "order", "The order's tier: Prep."]);
});

test("service names: one tier, a mixed checkout's line, short names, prep, add-ons", () => {
  assert.deepEqual(tiersOfService("Gold - Full Restoration & PSA Prep"), ["premium"]);
  assert.deepEqual(tiersOfService("Bronze + Silver + Platinum + Gold + Diamond - Full Restoration & PSA Prep"), ["regular", "expedited", "ultra_premium", "premium", "elite"]);
  assert.deepEqual(tiersOfService("Fast Pass Restoration", null), ["fast_pass"]);
  assert.deepEqual(tiersOfService("Gilded - Full Restoration & PSA Prep (added card)", null, { premium: "Gilded" }), ["premium"]);
  assert.deepEqual(tiersOfService("Grading prep"), ["prep"]);
  assert.deepEqual(tiersOfService("PSA Prep", "697e7ed7-3cbf-4e14-8ebe-1be612ca3710"), ["prep"]);
  assert.deepEqual(tiersOfService("anything", "ultra_premium"), ["ultra_premium"]);
  assert.equal(tiersOfService("Full Restoration & PSA Prep", "697e7ed7-3cbf-4e14-8ebe-1be612ca3710"), null);
  assert.equal(tiersOfService("Manual Restoration Order", null), null);
  for (const addOn of ["Pregrade", "Slab Cracking", "Pre-Grade Assessment", "Instagram Feature — Card in a Video", "Slab removal (signed authorization)"]) {
    assert.equal(tiersOfService(addOn), undefined, addOn);
  }
  assert.equal(tierFromName("fast pass"), "fast_pass");
  assert.equal(tierFromName("Ultra Premium"), "ultra_premium");
  assert.equal(tierFromName("Mystery"), null);
});

test("signed at checkout (card_snapshot): matched by name, sure", () => {
  const snapshot = {
    order_number: "CD-3001",
    cards: [
      { card_name: "Charizard", card_set: "Base Set", declared_value_cents: 300000, services: [{ name: "Gold - Full Restoration & PSA Prep", cents: 11999 }, { name: "Pregrade", cents: 2500 }] },
      { card_name: "Pikachu", declared_value_cents: 5000, services: [{ name: "Bronze - Full Restoration & PSA Prep", cents: 7499 }] },
      { card_name: "Mew", declared_value_cents: 10000, services: [{ name: "Silver - Full Restoration & PSA Prep", cents: 9999 }] },
      { card_name: "Mew", declared_value_cents: 10000, services: [{ name: "Gold - Full Restoration & PSA Prep", cents: 11999 }] },
    ],
  };
  const order: GuessCard[] = [
    { id: "a", card_name: "charizard ", card_set: "Base Set", estimated_value_cents: 300000, tier: null },
    { id: "b", card_name: "Pikachu", estimated_value_cents: 5000, tier: null },
    { id: "c", card_name: "Mew", estimated_value_cents: 10000, tier: null },
    { id: "d", card_name: "Mew", estimated_value_cents: 10000, tier: null },
  ];
  const g = guess({ cards: order, signed: signedCardsFromSignature(snapshot, null) });
  assert.deepEqual([g.a.tier, g.a.confidence, g.a.source, g.a.why], ["premium", "sure", "signed", "Signed at checkout: Gold."]);
  assert.deepEqual([g.b.tier, g.b.confidence], ["regular", "sure"]);
  // Two identical cards signed with different tiers: the record can't say which is which
  assert.notEqual(g.c.confidence, "sure");
  assert.notEqual(g.d.confidence, "sure");
});

test("signed at checkout, read from the document text (lib/checkout-signing.ts authorizedOrderText's format)", () => {
  // What authorizedOrderText writes for these two cards (lib/checkout-signing imports
  // next/headers through lib/signatures, so this file can't load it)
  const text = [
    "## Services authorized on order CD-3002",
    "Card 1: 2000 Neo Genesis Lugia #9. Declared value: $2,500.00. Known defects: Crease. Corner wear.",
    "- Platinum - Full Restoration & PSA Prep: $149.99\n- Slab removal (signed authorization): $7.00",
    "Card 2: Gengar. Holder: PSA 8. Declared value: not given.",
    "- Grading prep: $25.00",
    "Order:",
    "- Sales tax: $1.00",
    "Order total: $200.00",
  ].join("\n\n");
  const signed = signedCardsFromSignature(null, `Some terms text.\n\n${text}`);
  assert.deepEqual(signed.map((s) => [s.name, s.valueCents, s.tier]), [["2000 Neo Genesis Lugia #9", 250000, "ultra_premium"], ["Gengar", null, "prep"]]);
  const g = guess({ cards: [{ id: "a", card_name: "Lugia", estimated_value_cents: 250000, tier: null }, { id: "b", card_name: "Gengar", tier: null }], signed });
  assert.deepEqual(tiers(g), ["ultra_premium/sure", "prep/sure"]);
});

test("signed show drop-off form: each card's service, or the one service chosen", () => {
  const perCard = signedCardsFromDropoff({ tiers: ["regular", "premium"], cards: [{ name: "Zekrom EX", service: "premium" }, { name: "Mew", service: "regular" }] });
  const one = signedCardsFromDropoff({ tiers: ["expedited"], cards: [{ name: "Garchomp" }] });
  const g = guess({ cards: [{ id: "a", card_name: "Zekrom EX", tier: null }, { id: "b", card_name: "Garchomp", tier: null }], signed: [...perCard, ...one] });
  assert.deepEqual([g.a.tier, g.a.confidence, g.a.why], ["premium", "sure", "Signed drop-off form: Gold."]);
  assert.deepEqual([g.b.tier, g.b.confidence], ["expedited", "sure"]);
});

test("old mixed checkout, one line: 2 Platinum + 1 Gold for $419.99, the declared values decide each card (likely)", () => {
  const g = guess({ cards: cards(1750, 4000, 5000), services: [line("Platinum + Gold - Full Restoration & PSA Prep", 41999)] });
  assert.deepEqual(tiers(g), ["premium/likely", "ultra_premium/likely", "ultra_premium/likely"]);
  assert.equal(g.c1.source, "price");
  assert.equal(g.c1.why, "Paid for 2 Platinum and 1 Gold; matched by each card's declared value.");
});

test("Diamond is priced by value: 1 Diamond ($7,750 card at 7%) + 3 Platinum = $992.50", () => {
  const g = guess({ cards: cards(2000, 304, 600, 7750), services: [line("Diamond + Platinum - Full Restoration & PSA Prep", 99250)] });
  assert.deepEqual(tiers(g), ["ultra_premium/likely", "ultra_premium/likely", "ultra_premium/likely", "elite/likely"]);
  assert.equal(g.c4.why, "Paid for 1 Diamond and 3 Platinum; matched by each card's declared value.");
});

test("three tiers in one line: 1 Gold + 1 Silver + 3 Bronze, every card decided by its value", () => {
  const g = guess({ cards: cards(500, 500, 1500, 3000, 1000), services: [line("Bronze + Silver + Gold - Full Restoration & PSA Prep", 44498)] });
  assert.deepEqual(tiers(g), ["regular/likely", "regular/likely", "expedited/likely", "premium/likely", "regular/likely"]);
});

test("counts known, cards not: 4 Gold + 2 Silver, best guess puts the most valuable cards in Gold (unknown)", () => {
  // Per-card average line ($112.49 x 6 would not fit; here the old site's lump)
  const g = guess({ cards: cards(130, 165, 500, 160, 1900, 200), services: [line("Gold + Silver - Full Restoration & PSA Prep", 67994)] });
  assert.deepEqual(tiers(g), ["expedited/unknown", "premium/unknown", "premium/unknown", "expedited/unknown", "premium/unknown", "premium/unknown"]);
  assert.equal(g.c1.why, "Paid for 4 Gold and 2 Silver, but not which card is which.");
  // A line priced per card (average) x quantity reads the same
  const avg = guess({ cards: cards(245, 250, 833, 500, 1300, 1990, null, 1065), services: [line("Silver + Gold - Full Restoration & PSA Prep", 11249, 8)] });
  assert.equal(avg.c1.why, "Paid for 5 Gold and 3 Silver, but not which card is which.");
});

test("one line per tier (new checkout): 1 Platinum + 4 Bronze, the $2,000 card can't be Bronze", () => {
  const g = guess({
    cards: cards(2000, 300, 50, 200, 500),
    services: [line("Platinum - Full Restoration & PSA Prep", 15000, 1, "ultra_premium"), line("Bronze - Full Restoration & PSA Prep", 7500, 4, "regular"), line("Slab Cracking", 700, 3, "slab_crack")],
  });
  assert.deepEqual(tiers(g), ["ultra_premium/likely", "regular/likely", "regular/likely", "regular/likely", "regular/likely"]);
});

test("a card that already has its tier takes its place in the counts", () => {
  const c = cards(150, 900);
  c[1].tier = "ultra_premium";
  const g = guess({ cards: c, services: [line("Platinum - Full Restoration & PSA Prep", 14999, 1, "ultra_premium"), line("Gold - Full Restoration & PSA Prep", 11999, 1, "premium")] });
  assert.deepEqual([g.c1.tier, g.c1.confidence, g.c2.confidence], ["premium", "likely", "sure"]);
});

test("one service before tiers: $75.00 per card is the Bronze price (likely); $260 for 4 cards fits no tier", () => {
  const g = guess({ cards: cards(1100), services: [line("Full Restoration & PSA Prep", 7500, 1, "697e7ed7-3cbf-4e14-8ebe-1be612ca3710")] });
  assert.deepEqual([g.c1.tier, g.c1.confidence, g.c1.why], ["regular", "likely", "Paid $75.00 per card, the Bronze price."]);
  const manual = guess({ cards: cards(null), checkoutEvents: ["Manual order created — 1 card @ $75.00/card"] });
  assert.deepEqual([manual.c1.tier, manual.c1.confidence], ["regular", "likely"]);
  const none = guess({ cards: cards(3000, 2000, 2300, 3000), services: [line("Full Restoration & PSA Prep", 26000, 4)] });
  assert.deepEqual(tiers(none), ["-/unknown", "-/unknown", "-/unknown", "-/unknown"]);
});

test("no service lines: the subtotal over the checkout event's tiers (2 Bronze + 1 Silver = $249.99)", () => {
  const g = guess({ cards: cards(250, 2000, 500), checkoutEvents: ["Checkout session created — mixed tiers: regular, expedited"], subtotalCents: 24999 });
  assert.deepEqual(tiers(g), ["regular/likely", "expedited/likely", "regular/likely"]);
});

test("lines that don't match the cards (a 3-card checkout entered as 1 card): the tiers chosen and the declared value", () => {
  const g = guess({
    cards: cards(4000),
    services: [line("Bronze - Full Restoration & PSA Prep", 7499, 2, "regular"), line("Platinum - Full Restoration & PSA Prep", 14999, 1, "ultra_premium")],
  });
  assert.deepEqual([g.c1.tier, g.c1.confidence, g.c1.why], ["ultra_premium", "likely", "Checkout chose Platinum and Bronze; only Platinum fits this card's declared value."]);
  const both = guess({ cards: cards(400), checkoutEvents: ["Checkout session created — mixed tiers: ultra_premium, regular"] });
  assert.deepEqual([both.c1.tier, both.c1.confidence], ["ultra_premium", "unknown"], "several fit: the faster tier preselected, not sure");
});

test("a hand-made order with nothing on record: unknown, no guess; a card named (Prep) is likely Prep", () => {
  const c = cards(null, null, null);
  c[1].card_name = "Pocket Monsters 42 Egg (Prep)";
  c[2].card_name = "Clamperl PREP";
  const g = guess({ cards: c, checkoutEvents: ["Online order created manually by admin"] });
  assert.deepEqual(tiers(g), ["-/unknown", "prep/likely", "prep/likely"]);
  assert.equal(g.c1.source, null);
  assert.equal(g.c2.why, "The card's name says Prep.");
  assert.equal(guess({ cards: [{ id: "x", card_name: "Preparation H", tier: null }] }).x.tier, null, "only the word Prep");
});

test("prices: the admin's and the built-in ones; Diamond by rate", () => {
  const byTier = Object.fromEntries(PRICING.map((p) => [p.tier, p]));
  assert.deepEqual(byTier.regular.prices, [7499, 7500]);
  assert.deepEqual(byTier.ultra_premium.prices, [14999, 15000]);
  assert.deepEqual([byTier.elite.prices, byTier.elite.rate, byTier.elite.minValueCents], [[], 0.07, 500000]);
  assert.equal(byTier.regular.maxValueCents, 100000);
});

// ── Bounded search, one-to-one signatures, Prep only from what was bought (review, Nov 24 2026) ──

const MIXED5 = "Bronze + Silver + Platinum + Gold + Diamond - Full Restoration & PSA Prep";
const MIXED5_EVENT = "Checkout session created — mixed tiers: regular, expedited, ultra_premium, premium, elite";
// CD-2021's 12 declared values (dollars), then more cards of the same kind
const CD2021 = [225, 1800, 2300, 2000, 2900, 2200, 11800, 245, 840, 750, 4900, 300];
const MORE = [500, 600, 700, 400, 350, 450, 520, 610];

test("a real 12-card mixed checkout with Diamond (CD-2021): every card likely, quickly", () => {
  const t0 = performance.now();
  const g = guess({ cards: cards(...CD2021), services: [line(MIXED5, 191095, 1, null)], checkoutEvents: [MIXED5_EVENT], subtotalCents: 191095 });
  const ms = performance.now() - t0;
  assert.ok(ms < 200, `${ms.toFixed(0)} ms`);
  assert.ok(Object.values(g).every((x) => x.confidence === "likely" && x.source === "price"), tiers(g).join(" "));
  assert.equal(g.c7.tier, "elite", "the $11,800 card is the Diamond one");
});

test("16 to 20 cards that don't add up (values edited since): bounded, under 200 ms, never Diamond under $5,000", () => {
  for (const n of [16, 18, 20]) {
    const values = [...CD2021, ...MORE].slice(0, n);
    values[6] = 11000; // the Diamond card's value edited: the paid amount no longer adds up
    const total = 191095 + (n - 12) * 7499;
    const t0 = performance.now();
    const g = guess({ cards: cards(...values), services: [line(MIXED5, total, 1, null)], checkoutEvents: [MIXED5_EVENT], subtotalCents: total });
    const ms = performance.now() - t0;
    assert.ok(ms < 200, `${n} cards: ${ms.toFixed(0)} ms`);
    for (const [id, x] of Object.entries(g)) {
      const value = values[Number(id.slice(1)) - 1] * 100;
      if (value < 500000) assert.notEqual(x.tier, "elite", `${id} ($${value / 100}) guessed Diamond`);
      assert.notEqual(x.confidence, "sure");
    }
  }
});

test("signed entries match one-to-one: a second Charizard never inherits the first one's signature", () => {
  const signed = signedCardsFromSignature({ cards: [{ card_name: "Charizard", card_set: "Base", declared_value_cents: 50000, services: [{ name: "Gold - Full Restoration & PSA Prep" }] }] }, null);
  // The signed card already has its tier; the other (added later by staff, no tier) is not signed
  const g = guess({ signed, cards: [
    { id: "a", card_name: "Charizard", card_set: "Base", estimated_value_cents: 50000, tier: "premium" },
    { id: "b", card_name: "Charizard", card_set: "Jungle", estimated_value_cents: 20000, tier: null },
  ] });
  assert.notEqual(g.b.confidence, "sure");
  assert.notEqual(g.b.source, "signed");
  // Two untiered Charizards, one signature: neither is sure
  const two = guess({ signed, cards: [
    { id: "a", card_name: "Charizard", estimated_value_cents: 50000, tier: null },
    { id: "b", card_name: "Charizard", estimated_value_cents: 50000, tier: null },
  ] });
  assert.ok(Object.values(two).every((x) => x.source !== "signed"), tiers(two).join(" "));
  // Two signed, two untiered: each its own (by declared value)
  const both = signedCardsFromSignature({ cards: [
    { card_name: "Charizard", declared_value_cents: 50000, services: [{ name: "Gold - Full Restoration & PSA Prep" }] },
    { card_name: "Charizard", declared_value_cents: 20000, services: [{ name: "Silver - Full Restoration & PSA Prep" }] },
  ] }, null);
  const pair = guess({ signed: both, cards: [
    { id: "a", card_name: "Charizard", estimated_value_cents: 20000, tier: null },
    { id: "b", card_name: "Charizard", estimated_value_cents: 50000, tier: null },
  ] });
  assert.deepEqual([pair.a.tier, pair.a.source, pair.b.tier, pair.b.source], ["expedited", "signed", "premium", "signed"]);
});

test("a restoration line with no tier plus PSA Prep lines (CD-1060): the restoration card is never guessed Prep from the Prep lines", () => {
  const g = guess({
    cards: cards(200, 200, 200),
    services: [line("Full Card Restoration", 10000, 1, "697e7ed7-3cbf-4e14-8ebe-1be612ca3710"), line("PSA Prep", 3500, 2, "697e7ed7-3cbf-4e14-8ebe-1be612ca3710")],
    checkoutEvents: ["Checkout session created"],
    subtotalCents: 17000,
  });
  const prepLikely = Object.values(g).filter((x) => x.tier === "prep" && x.confidence !== "unknown").length;
  assert.ok(prepLikely <= 2, `${prepLikely} cards likely Prep: ${tiers(g).join(" ")}`);
  assert.ok(Object.values(g).every((x) => x.confidence !== "sure"));
});

test("what was paid for the card itself (cards.service_price_cents): exactly one tier's price is likely; another price falls through", () => {
  const g = guess({ cards: [
    { id: "a", card_name: "A", service_price_cents: 9999, tier: null },
    { id: "b", card_name: "B", service_price_cents: 13000, tier: null },
    { id: "c", card_name: "C", estimated_value_cents: 600000, service_price_cents: 42000, tier: null },
    { id: "d", card_name: "D", service_price_cents: 7500, tier: null },
  ] });
  assert.deepEqual([g.a.tier, g.a.confidence, g.a.source, g.a.why], ["expedited", "likely", "price", "Paid $99.99, the Silver price."]);
  assert.deepEqual([g.b.tier, g.b.confidence], [null, "unknown"]);
  assert.deepEqual([g.c.tier, g.c.confidence], ["elite", "likely"], "7% of $6,000");
  assert.deepEqual([g.d.tier, g.d.confidence], ["regular", "likely"], "Bronze's built-in $75.00");
});

