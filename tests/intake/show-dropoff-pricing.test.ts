/**
 * Show drop-off totals (lib/show-dropoff-pricing.ts) and the order form's
 * start from a drop-off (lib/show-dropoff-prefill.ts): what Show Dropoffs
 * counts, and that it is the order's total once entered.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dropoffFigure, makePriceBook, paidOnlineLater, priceTiers, type PricedDropoff } from "@/lib/show-dropoff-pricing";
import { dropoffPrefill } from "@/lib/show-dropoff-prefill";
import type { RestorationTier } from "@/lib/restoration-tiers";

// Production prices on 2026-11-23 (restoration_settings); Diamond is a share of value
const TIERS: Pick<RestorationTier, "id" | "pricing_type" | "price_cents">[] = [
  { id: "regular", pricing_type: "fixed", price_cents: 7499 },
  { id: "expedited", pricing_type: "fixed", price_cents: 9999 },
  { id: "premium", pricing_type: "fixed", price_cents: 11999 },
  { id: "ultra_premium", pricing_type: "fixed", price_cents: 14999 },
  { id: "elite", pricing_type: "percentage", price_cents: 0 },
  { id: "fast_pass", pricing_type: "fixed", price_cents: 25000 },
];
const book = makePriceBook(TIERS, 2500);

const dropoff = (over: Partial<PricedDropoff> = {}): PricedDropoff => ({
  status: "new", tiers: ["regular"], five_plus: false, card_count: 1, cards: [{ service: "regular" }], ...over,
});

test("price book: fixed tiers, Prep from store_config, Diamond and unknown services unpriced", () => {
  assert.equal(book.perCard("regular"), 7499);
  assert.equal(book.perCard("fast_pass"), 25000);
  assert.equal(book.perCard("prep"), 2500);
  assert.equal(book.perCard("elite"), null);
  assert.equal(book.perCard("something_else"), null);
});

test("tiers picked: each listed card at its tier, or the one service picked", () => {
  assert.deepEqual(priceTiers(dropoff({ tiers: ["ultra_premium"], card_count: 3, cards: [{ service: "ultra_premium" }, { service: "ultra_premium" }, { service: "ultra_premium" }] }), book), { cents: 44997, complete: true });
  // No per-card service, one service picked: every card is that service
  assert.deepEqual(priceTiers(dropoff({ tiers: ["premium"], cards: [{}, { service: null }] }), book), { cents: 23998, complete: true });
  // Mixed, with Prep
  assert.deepEqual(priceTiers(dropoff({ tiers: ["regular", "prep"], cards: [{ service: "regular" }, { service: "prep" }] }), book), { cents: 9999, complete: true });
  // Diamond can't be priced: the rest still counts, flagged
  assert.deepEqual(priceTiers(dropoff({ tiers: ["regular", "elite"], cards: [{ service: "regular" }, { service: "elite" }] }), book), { cents: 7499, complete: false });
  // Several services and a card without one: unpriced card
  assert.deepEqual(priceTiers(dropoff({ tiers: ["regular", "premium"], cards: [{ service: null }] }), book), { cents: 0, complete: false });
});

test("tiers picked: 5+ cards is the count times the one service", () => {
  assert.deepEqual(priceTiers(dropoff({ five_plus: true, card_count: 6, cards: [], tiers: ["expedited"] }), book), { cents: 59994, complete: true });
  assert.deepEqual(priceTiers(dropoff({ five_plus: true, card_count: 6, cards: [], tiers: ["expedited", "prep"] }), book), { cents: 0, complete: false });
  assert.deepEqual(priceTiers(dropoff({ five_plus: true, card_count: null, cards: [], tiers: ["expedited"] }), book), { cents: 0, complete: false });
});

test("figure: cancelled counts nothing, to-enter counts the tiers picked", () => {
  assert.deepEqual(dropoffFigure(dropoff({ status: "cancelled" }), book, null), { cents: 0, complete: true, fromOrder: false });
  assert.deepEqual(dropoffFigure(dropoff(), book, null), { cents: 7499, complete: true, fromOrder: false });
  // An order on a drop-off still "new" (never happens; the link comes with "entered") is ignored
  assert.deepEqual(dropoffFigure(dropoff(), book, { total_cents: 1 }), { cents: 7499, complete: true, fromOrder: false });
});

test("figure: once entered, the order's total, so Show Dropoffs and the order agree", () => {
  // #1002 in production: signed with 3 Bronze cards, entered with 4 (CD-2574, $299.96)
  const signed3 = dropoff({ status: "entered", card_count: 3, cards: [{ service: "regular" }, { service: "regular" }, { service: "regular" }] });
  assert.equal(priceTiers(signed3, book).cents, 22497);
  assert.deepEqual(dropoffFigure(signed3, book, { total_cents: 29996 }), { cents: 29996, complete: true, fromOrder: true });
  // 5+ cards and Diamond are priced once entered (whatever the order carries, even $0)
  const fivePlus = dropoff({ status: "entered", five_plus: true, card_count: 5, cards: [], tiers: ["regular", "elite"] });
  assert.deepEqual(dropoffFigure(fivePlus, book, { total_cents: 0 }), { cents: 0, complete: true, fromOrder: true });
  // Entered but its order is gone or has no total: back to the tiers picked
  assert.deepEqual(dropoffFigure(signed3, book, null), { cents: 22497, complete: true, fromOrder: false });
  assert.deepEqual(dropoffFigure(signed3, book, { total_cents: null }), { cents: 22497, complete: true, fromOrder: false });
});

test("order page: only an online payment made later (added cards, upgrade) changes the wording", () => {
  assert.equal(paidOnlineLater(null), false);
  assert.equal(paidOnlineLater([]), false);
  // What /api/admin/orders writes for a show drop-off, and the usual staff lines
  assert.equal(paidOnlineLater([
    { event_type: "show_dropoff_entered" }, { event_type: "manual_order_created" },
    { event_type: "status_updated" }, { event_type: "stage_update" }, { event_type: "payment_received" },
  ]), false);
  assert.equal(paidOnlineLater([{ event_type: "manual_order_created" }, { event_type: "cards_added" }]), true);
  assert.equal(paidOnlineLater([{ event_type: "tier_upgraded" }]), true);
});

const row = (over: Partial<Parameters<typeof dropoffPrefill>[0]> = {}): Parameters<typeof dropoffPrefill>[0] => ({
  id: "d1", dropoff_number: 1011, show_name: "Test Show",
  customer_name: "Test Customer", customer_email: "test@example.com", customer_phone: "5555550100",
  tiers: ["regular"], five_plus: false, card_count: 1,
  cards: [{ name: "Card A", details: null, service: "regular" }],
  customer_notes: null,
  ...over,
});

test("prefill: restoration tiers as before, no custom price", () => {
  const p = dropoffPrefill(row({ tiers: ["premium"], cards: [{ name: "A", details: null, service: null }, { name: "B", details: null, service: "premium" }] }));
  assert.equal(p.defaultTier, "premium");
  assert.deepEqual(p.cards, [{ name: "A", tier: "premium" }, { name: "B", tier: "premium" }]);
  assert.equal(p.customPriceCents, null);
  assert.match(p.notes, /^Show drop-off #1011 at Test Show\./);
});

test("prefill: PSA Prep cards start as custom at the Prep price, as Show Dropoffs prices them", () => {
  const mixed = dropoffPrefill(row({
    tiers: ["regular", "prep"],
    cards: [{ name: "A", details: null, service: "regular" }, { name: "B", details: null, service: "prep" }],
  }), 2500);
  assert.equal(mixed.defaultTier, "regular");
  assert.deepEqual(mixed.cards, [{ name: "A", tier: "regular" }, { name: "B", tier: "custom" }]);
  assert.equal(mixed.customPriceCents, 2500);

  // Prep only: every card, and cards added for 5+, start at the Prep price
  const prepOnly = dropoffPrefill(row({ tiers: ["prep"], cards: [{ name: "A", details: null, service: null }] }), 2500);
  assert.equal(prepOnly.defaultTier, "custom");
  assert.deepEqual(prepOnly.cards, [{ name: "A", tier: "custom" }]);
  const fivePlusPrep = dropoffPrefill(row({ tiers: ["prep"], five_plus: true, card_count: 8, cards: [] }), 2500);
  assert.equal(fivePlusPrep.defaultTier, "custom");
  assert.deepEqual(fivePlusPrep.cards, []);
  assert.equal(fivePlusPrep.customPriceCents, 2500);

  // 5+ cards with Prep and several restoration tiers: no card starts as Prep, so no custom price
  // (it would also price the cards added without a tier)
  const fivePlusMixed = dropoffPrefill(row({ tiers: ["regular", "premium", "prep"], five_plus: true, card_count: 7, cards: [] }), 2500);
  assert.equal(fivePlusMixed.defaultTier, "");
  assert.equal(fivePlusMixed.customPriceCents, null);

  // Without the Prep price (not looked up): Prep cards fall back to the order's tier, as before
  const noPrice = dropoffPrefill(row({ tiers: ["prep"], cards: [{ name: "A", details: null, service: "prep" }] }));
  assert.equal(noPrice.defaultTier, "");
  assert.deepEqual(noPrice.cards, [{ name: "A", tier: "" }]);
  assert.equal(noPrice.customPriceCents, null);
});
