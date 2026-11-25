/**
 * The packing page (app/admin/receiving/pack/[code]): its pure pieces in
 * lib/intake/packing-view.ts. What each card's ✓ / ✗ says, the one step the
 * page offers for each `next` of the packing API, where a blocked bag is
 * fixed, what the API's answers mean on the page (errors as they are worded,
 * a stale purchase, a label bought but not saved), Mark shipped's question,
 * and the order's packages in words.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { packCodePath } from "@/lib/intake/codes";
import {
  blockFixes, buyOutcome, cardsText, checkMark, checkSummary, defaultRate, isStaleClaim, markShippedQuestion, money, oneTapText,
  packageRows, packageStatus, packagesHeadline, packState, ratePrice, rateText, readError, serviceName, shipOutcome, shipToText,
  splitCheck, STALE_RETRY_QUESTION, trackingHref, whenText, type PackLinks,
} from "@/lib/intake/packing-view";
import type { BagShipment, PackageSummary, PackingResponse, ShipRate } from "@/lib/intake/shipping/types";
import type { LocationRef, ShipCheckCard, ShipCheckResponse } from "@/lib/intake/tracking/types";

const CLAMP: LocationRef = { id: "loc-1", code: "LOC-CLAMP-07", name: "CLAMP 07", kind: "station", station: "clamp", serial: 7, stage: "Clamp Work" };
const LINKS: PackLinks = {
  order: "/admin/orders/o1",
  shipping: "/admin/orders/o1#shipping",
  shipCheck: "/admin/receiving/ship/o1?bag=b1",
  open: "/admin/receiving/open/CD-2549-P",
};
const NOW = Date.parse("2026-11-25T15:00:00Z");

const card = (code: string, status: ShipCheckCard["status"], over: Partial<ShipCheckCard> = {}): ShipCheckCard => ({
  id: `id-${code}`, code, name: `Card ${code}`, bagId: "b1", bagCode: "CD-2549-P", done: status !== "not_done",
  location: status === "in_slot" ? CLAMP : null, lastSeen: null, status, ...over,
});
const check = (cards: ShipCheckCard[]): ShipCheckResponse => {
  const live = cards.filter((c) => c.status !== "refunded");
  return {
    scope: "bag",
    order: { id: "o1", orderNumber: "CD-2549", customer: "Pat Reyes", status: "received" },
    bags: [],
    cards,
    counts: {
      ok: cards.filter((c) => c.status === "ok").length, notDone: cards.filter((c) => c.status === "not_done").length,
      inSlot: cards.filter((c) => c.status === "in_slot").length, refunded: cards.filter((c) => c.status === "refunded").length,
    },
    ready: live.length > 0 && live.every((c) => c.status === "ok"),
  };
};
const shipment = (over: Partial<BagShipment> = {}): BagShipment => ({
  id: "s1", bagId: "b1", orderId: "o1", status: "purchased", carrier: "USPS", service: "Priority Mail",
  trackingNumber: "9400111111111111111111", trackingUrl: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111111111111111111",
  labelUrl: "https://shippo-delivery.s3.amazonaws.com/label.pdf", costCents: 985, insuranceCents: null, orderLabel: true,
  claimedAt: "2026-11-25T14:50:00Z", purchasedAt: "2026-11-25T14:50:05Z", shippedAt: null, deliveredAt: null,
  createdBy: "gavin", shippedBy: null, emailSentAt: null, error: null, ...over,
});
const packing = (over: Partial<PackingResponse> = {}): PackingResponse => ({
  bag: { id: "b1", code: "CD-2549-P", tier: "ultra_premium", tierName: "Platinum" },
  order: { id: "o1", orderNumber: "CD-2549", customer: "Pat Reyes", status: "received", international: false, hasAddress: true },
  check: check([card("CD-2549-07", "ok"), card("CD-2549-08", "ok")]),
  shipment: null, lastFailure: null, orderLabel: null, packages: [], shipmentsReady: true, canBuy: true, blocked: null, next: "buy",
  ...over,
});
const rate = (objectId: string, provider: string, service: string, amount: string, over: Partial<ShipRate> = {}): ShipRate =>
  ({ objectId, provider, service, amount, currency: "USD", days: 2, paid: false, ...over });

// ─── The check ──────────────────────────────────────────────────────────

test("each card's mark: Done, Still in <holder>, Not done, Refunded", () => {
  assert.deepEqual(checkMark(card("a", "ok")), { tone: "ok", text: "Done" });
  assert.deepEqual(checkMark(card("a", "in_slot")), { tone: "warn", text: "Still in CLAMP 07" });
  assert.deepEqual(checkMark(card("a", "in_slot", { location: null })), { tone: "warn", text: "Still in a holder" });
  assert.deepEqual(checkMark(card("a", "not_done")), { tone: "bad", text: "Not done" });
  assert.deepEqual(checkMark(card("a", "refunded")), { tone: "refunded", text: "Refunded" });
});

test("refunded cards are listed apart; the summary counts the cards that go in the package", () => {
  const cards = [card("1", "ok"), card("2", "refunded"), card("3", "not_done"), card("4", "in_slot")];
  const { live, refunded } = splitCheck(cards);
  assert.deepEqual(live.map((c) => c.code), ["1", "3", "4"]);
  assert.deepEqual(refunded.map((c) => c.code), ["2"]);
  assert.equal(checkSummary(check(cards)), "1 of 3 ready");
  assert.equal(checkSummary(check([card("1", "ok"), card("2", "ok"), card("3", "refunded")])), "All 2 done");
  assert.equal(checkSummary(check([card("1", "ok")])), "The card is done");
  assert.equal(checkSummary(check([card("1", "refunded")])), "Every card was refunded");
  assert.equal(cardsText(1), "1 card");
  assert.equal(cardsText(3), "3 cards");
});

// ─── Words for money, services, rates, places ───────────────────────────

test("money, services and rates in words", () => {
  assert.equal(money(985), "$9.85");
  assert.equal(money(50000), "$500.00");
  assert.equal(money(null), null);
  assert.equal(serviceName({ carrier: "USPS", service: "Priority Mail" }), "USPS Priority Mail");
  assert.equal(serviceName({ carrier: null, service: "Priority Mail" }), "Priority Mail");
  assert.equal(serviceName({ carrier: " ", service: "" }), null);
  assert.equal(serviceName(null), null);
  assert.equal(ratePrice({ amount: "9.8", currency: "USD" }), "$9.80");
  assert.equal(ratePrice({ amount: "12.4", currency: "CAD" }), "12.40 CAD");
  assert.equal(rateText(rate("r1", "USPS", "Priority Mail", "9.85")), "USPS Priority Mail · 2 days · $9.85");
  assert.equal(rateText(rate("r1", "UPS", "Ground", "12.10", { days: 1 })), "UPS Ground · 1 day · $12.10");
  assert.equal(rateText(rate("r1", "USPS", "Ground Advantage", "5.40", { days: null })), "USPS Ground Advantage · $5.40");
});

test("one tap buys the paid service, else the cheapest (rates come cheapest first)", () => {
  const cheap = rate("r1", "USPS", "Ground Advantage", "5.40");
  const paid = rate("r2", "USPS", "Priority Mail", "9.85", { paid: true });
  assert.equal(defaultRate([cheap, paid])?.objectId, "r2");
  assert.equal(defaultRate([cheap, { ...paid, paid: false }])?.objectId, "r1");
  assert.equal(defaultRate([]), null);
  assert.equal(oneTapText("USPS Priority Mail"), "Buys USPS Priority Mail, what the customer paid for.");
  assert.match(oneTapText(null), /cheapest rate/);
});

test("ship-to is city, state, country; nothing when there's no address", () => {
  assert.equal(shipToText({ street1: "100 Test Street", city: "Philadelphia", state: "PA", zip: "19103", country: "US" }), "Philadelphia, PA, US");
  assert.equal(shipToText({ street1: "2 Rue Principale", city: "Montreal", state: "QC", country: "CA" }), "Montreal, QC, CA");
  assert.equal(shipToText({ street1: "1 Main St", city: "Austin", state: "TX" }), "Austin, TX, US");
  assert.equal(shipToText(null), null);
  assert.equal(shipToText({}), null);
});

test("times are New York times; tracking links use Shippo's page, else the carrier's", () => {
  assert.equal(whenText("2026-11-25T20:10:00Z"), "Nov 25, 3:10 PM");
  assert.equal(whenText(null), null);
  assert.equal(whenText("not a date"), null);
  assert.equal(trackingHref(shipment()), "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111111111111111111");
  assert.equal(trackingHref({ trackingNumber: "1Z999AA10123456784", carrier: "UPS", trackingUrl: null }), "https://www.ups.com/track?tracknum=1Z999AA10123456784");
  assert.equal(trackingHref({ trackingNumber: null }), null);
});

// ─── The step ───────────────────────────────────────────────────────────

test("the page's one step follows the API's next", () => {
  assert.deepEqual(packState(packing(), LINKS, NOW), { kind: "buy" });
  const bought = shipment();
  assert.deepEqual(packState(packing({ next: "print_and_ship", shipment: bought, canBuy: false }), LINKS, NOW), { kind: "print_and_ship", shipment: bought });
  const sent = shipment({ status: "shipped", shippedAt: "2026-11-25T15:30:00Z" });
  assert.deepEqual(packState(packing({ next: "shipped", shipment: sent, canBuy: false }), LINKS, NOW), { kind: "shipped", shipment: sent, delivered: false });
  const arrived = shipment({ status: "delivered" });
  assert.deepEqual(packState(packing({ next: "delivered", shipment: arrived, canBuy: false }), LINKS, NOW), { kind: "shipped", shipment: arrived, delivered: true });
  // A shipment missing where one is expected: never a print button without a label
  assert.equal(packState(packing({ next: "print_and_ship", shipment: null, canBuy: false }), LINKS, NOW).kind, "blocked");
});

test("wait: a purchase under 2 minutes old is in progress, older is stale (the API's sentence shown as is)", () => {
  const fresh = shipment({ status: "claimed", claimedAt: "2026-11-25T14:59:00Z", labelUrl: null, trackingNumber: null });
  const old = shipment({ status: "claimed", claimedAt: "2026-11-25T14:57:59Z", labelUrl: null, trackingNumber: null });
  const said = "This bag's label is being bought right now. Wait a few seconds, then reload.";
  assert.deepEqual(packState(packing({ next: "wait", shipment: fresh, canBuy: false, blocked: said }), LINKS, NOW), { kind: "wait", reason: said, stale: false, unsavedLabel: null });
  const st = packState(packing({ next: "wait", shipment: old, canBuy: false, blocked: "never finished" }), LINKS, NOW);
  assert.deepEqual(st, { kind: "wait", reason: "never finished", stale: true, unsavedLabel: null });
  // A label bought but not kept (contract v3 unsavedLabel): show it, "Save this label" POSTs {} and buys nothing
  const lost = packState(packing({ next: "wait", shipment: old, canBuy: false, blocked: "bought, not saved", unsavedLabel: { labelUrl: "https://shippo-delivery.s3.amazonaws.com/lost.pdf" } }), LINKS, NOW);
  assert.equal(lost.kind === "wait" && lost.unsavedLabel, "https://shippo-delivery.s3.amazonaws.com/lost.pdf");
  const odd = packState(packing({ next: "wait", shipment: old, canBuy: false, unsavedLabel: { labelUrl: "javascript:x" } }), LINKS, NOW);
  assert.equal(odd.kind === "wait" && odd.unsavedLabel, null, "only web addresses are shown");
  assert.equal(isStaleClaim(old, NOW), true);
  assert.equal(isStaleClaim(fresh, NOW), false);
  assert.equal(isStaleClaim(shipment(), NOW), false, "a bought label is never stale");
  assert.equal(isStaleClaim(null, NOW), false);
  assert.match(STALE_RETRY_QUESTION, /second label/);
  assert.match(STALE_RETRY_QUESTION, /pay for both/);
});

test("blocked: the API's sentence, with where to fix it", () => {
  const notDone = check([card("CD-2549-07", "ok"), card("CD-2549-08", "not_done")]);
  const st = packState(packing({ next: "blocked", canBuy: false, check: notDone, blocked: "1 card isn't marked done yet (Card CD-2549-08)." }), LINKS, NOW);
  assert.equal(st.kind, "blocked");
  if (st.kind !== "blocked") return;
  assert.equal(st.reason, "1 card isn't marked done yet (Card CD-2549-08).");
  assert.deepEqual(st.fixes.map((f) => f.href), [LINKS.shipCheck, LINKS.open]);

  // The order page's whole-order label covers the bag: link it
  const label = { labelUrl: "https://shippo-delivery.s3.amazonaws.com/order.pdf", trackingNumber: "9400" };
  assert.deepEqual(blockFixes(packing({ orderLabel: label }), LINKS), [
    { href: label.labelUrl, text: "Open the order's label", external: true },
    { href: LINKS.shipping, text: "Open the order's shipping" },
  ]);
  // The order's status, the address, every card refunded, the migration missing
  assert.deepEqual(blockFixes(packing({ order: { ...packing().order, status: "cancelled" } }), LINKS).map((f) => f.href), [LINKS.order]);
  assert.deepEqual(blockFixes(packing({ order: { ...packing().order, hasAddress: false } }), LINKS), [{ href: LINKS.order, text: "Add the address on the order page" }]);
  assert.deepEqual(blockFixes(packing({ check: check([card("1", "refunded")]) }), LINKS).map((f) => f.href), [LINKS.order]);
  assert.deepEqual(blockFixes(packing({ shipmentsReady: false }), LINKS), []);
  assert.equal(packState(packing({ next: "blocked", canBuy: false, blocked: null }), LINKS, NOW).kind, "blocked");
});

// ─── The API's answers ──────────────────────────────────────────────────

test("POST ship-label: 200 is the label; every error is shown as the API words it", () => {
  const s = shipment();
  assert.deepEqual(buyOutcome(200, { shipment: s, existing: false, orderLabel: true, message: "Label bought. Print it, pack the bag, then tap Mark shipped." }),
    { ok: true, message: "Label bought. Print it, pack the bag, then tap Mark shipped.", shipment: s });
  assert.deepEqual(buyOutcome(200, { shipment: s, existing: true }), { ok: true, message: "Label bought.", shipment: s });

  const busy = buyOutcome(409, { error: "This bag's label is being bought right now. Wait a few seconds, then reload.", inProgress: true });
  assert.deepEqual(busy, { ok: false, message: "This bag's label is being bought right now. Wait a few seconds, then reload.", stale: false, labelUrl: null });
  const stale = buyOutcome(409, { error: "A label purchase for this bag started at 2:50 PM and never finished…", staleClaim: true, claimedAt: "2026-11-25T14:50:00Z" });
  assert.equal(stale.ok, false);
  assert.equal(!stale.ok && stale.stale, true);
  const unsaved = buyOutcome(500, { error: "The label was bought but couldn't be saved…", labelUrl: "https://shippo-delivery.s3.amazonaws.com/x.pdf", unsaved: true });
  assert.equal(!unsaved.ok && unsaved.labelUrl, "https://shippo-delivery.s3.amazonaws.com/x.pdf");
  assert.equal(!unsaved.ok && unsaved.message, "The label was bought but couldn't be saved…");
  // A label link that isn't a web address is never shown
  const odd = buyOutcome(500, { error: "x", labelUrl: "javascript:alert(1)" });
  assert.equal(!odd.ok && odd.labelUrl, null);
  // No JSON (a proxy page, a crash): a plain sentence with the status
  assert.match(buyOutcome(502, null).ok ? "" : (buyOutcome(502, null) as { message: string }).message, /HTTP 502/);
  assert.equal((buyOutcome(503, { error: "This is not functional yet" }) as { message: string }).message, "This is not functional yet");
  assert.equal(buyOutcome(200, { error: "odd" }).ok, false, "a 200 without a shipment isn't a label");
});

test("POST shipped and GET: the ready-to-show sentence, or the error as is", () => {
  assert.deepEqual(shipOutcome(200, { shipment: shipment({ status: "shipped" }), message: "Marked shipped and the customer was emailed the tracking." }),
    { ok: true, message: "Marked shipped and the customer was emailed the tracking." });
  assert.deepEqual(shipOutcome(409, { error: "Buy this bag's return label first." }), { ok: false, message: "Buy this bag's return label first." });
  assert.match(shipOutcome(500, "oops").message, /HTTP 500/);
  assert.equal(readError(404, { error: "Bag not found" }), "Bag not found");
  assert.match(readError(500, null), /HTTP 500/);
});

test("Mark shipped asks first and says the customer will be emailed the tracking", () => {
  assert.equal(markShippedQuestion("pat@example.com"), "Mark this bag shipped? The customer will be emailed the tracking number (pat@example.com).");
  assert.match(markShippedQuestion(null), /no email address/);
});

// ─── The order's packages ───────────────────────────────────────────────

test("packages: each bag's state in words, its packing page, which one is here", () => {
  const pk = (bagCode: string, status: PackageSummary["status"], cardCount: number, doneCount: number, trackingNumber: string | null = null): PackageSummary =>
    ({ bagId: `id-${bagCode}`, bagCode, tierName: bagCode.endsWith("G") ? "Gold" : "Platinum", cardCount, doneCount, status, trackingNumber });
  assert.deepEqual(packageStatus(pk("X", "none", 4, 3)), { text: "3 of 4 done", tone: "work" });
  assert.deepEqual(packageStatus(pk("X", "none", 4, 4)), { text: "Ready to pack", tone: "ready" });
  assert.deepEqual(packageStatus(pk("X", "claimed", 4, 4)), { text: "Label being bought", tone: "label" });
  assert.deepEqual(packageStatus(pk("X", "purchased", 4, 4)), { text: "Label bought, not shipped", tone: "label" });
  assert.deepEqual(packageStatus(pk("X", "shipped", 4, 4)), { text: "Shipped", tone: "done" });
  assert.deepEqual(packageStatus(pk("X", "delivered", 4, 4)), { text: "Delivered", tone: "done" });
  assert.deepEqual(packageStatus(pk("X", "none", 0, 0)), { text: "0 of 0 done", tone: "work" });

  const list = [pk("CD-2549-G", "shipped", 4, 4, "9400222"), pk("CD-2549-P", "none", 3, 3)];
  const rows = packageRows(list, "id-CD-2549-P");
  assert.deepEqual(rows.map((r) => [r.bagCode, r.status.text, r.trackingNumber, r.href, r.here]), [
    ["CD-2549-G", "Shipped", "9400222", "/admin/receiving/pack/CD-2549-G", false],
    ["CD-2549-P", "Ready to pack", null, "/admin/receiving/pack/CD-2549-P", true],
  ]);
  assert.equal(packagesHeadline(list), "1 of 2 packages shipped");
  assert.equal(packagesHeadline([pk("A", "delivered", 1, 1)]), "1 of 1 package shipped");
});

test("the packing page's address: the Bag ID upper case, any case typed", () => {
  assert.equal(packCodePath("cd-2549-p"), "/admin/receiving/pack/CD-2549-P");
  assert.equal(packCodePath(" CD-2549-G "), "/admin/receiving/pack/CD-2549-G");
});
