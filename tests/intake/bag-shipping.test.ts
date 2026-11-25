/**
 * Per-bag return labels ("ship each bag when it's done", lib/intake/shipping)
 * against the in-memory Supabase stand-in (tests/intake/harness/mock-supabase.mjs)
 * with a fake Shippo (no label is ever bought) and Resend caught at fetch.
 * Covers: claim before buy, two taps, failure release, the order's first
 * label mirrored to its return_* fields, the order status across bags, the
 * delivered sync, preview mode, the migration not applied yet, and the
 * international customs path (shared with the order page's route) unchanged.
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ShippoPort } from "@/lib/intake/shipping/bag-label";

type Row = Record<string, unknown>;
type Mock = {
  url: string;
  store: { table(name: string): Row[]; load(seed: { tables: Record<string, Row[]> }): void; missingTables: Set<string> };
  close(): Promise<void>;
};

let mock: Mock;
let admin: SupabaseClient;
let svc: typeof import("@/lib/intake/shipping/bag-shipments");
let label: typeof import("@/lib/intake/shipping/bag-label");
let types: typeof import("@/lib/intake/shipping/types");
let syncDelivered: typeof import("@/lib/sync-delivered");
const sent: { to: unknown; subject: string; html: string }[] = [];
const realFetch = globalThis.fetch;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// Orders
const SOLO = id(101); // one bag, completed, domestic
const MIXED = id(102); // two bags (Gold + Bronze), in progress, round-trip insurance
const INTL = id(103); // one bag, Canada
const PAGE = id(104); // whole-order label bought on the order page
const SLOT = id(105); // a done card still in a clamp
const REFUND = id(106); // a bag whose only card was refunded
const FAILS = id(107); // purchase failures
const INTL2 = id(108); // two bags, Canada (customs lists only the bag's cards)
// Bags
const B_SOLO = id(201), B_GOLD = id(202), B_BRONZE = id(203), B_INTL = id(204), B_PAGE = id(205), B_SLOT = id(206), B_REFUND = id(207), B_FAILS = id(208);
const B_INTL2A = id(209), B_INTL2B = id(210);
const CLAMP = id(301);

const US = { street1: "1 Main St", city: "Austin", state: "TX", zip: "78701", country: "US" };
const CA = { street1: "2 Rue Principale", city: "Montreal", state: "QC", zip: "H2X 1Y4", country: "CA" };

const order = (oid: string, num: string, over: Row = {}): Row => ({
  id: oid, order_number: num, customer_name: "Pat Reyes", customer_email: `${num.toLowerCase()}@example.com`, customer_phone: "555-0100",
  status: "completed", payment_status: "paid", restoration_tier: "premium", inbound_method: "self_ship",
  ship_from_address: US, ship_to_address: US, subtotal_cents: 10000, total_cents: 10000, refunded_cents: 0, slab_crack_count: 0,
  instagram_feature: false, gift_card_discount_cents: 0, return_label_url: null, tracking_number: null,
  return_service_level: "Priority Mail", return_carrier: "USPS", insurance_type: null, insurance_declared_value_cents: null,
  admin_notes: null, created_at: "2026-11-01T15:00:00+00:00", ...over,
});
const bag = (bid: string, oid: string, code: string, tier = "premium", batch = 1): Row => ({
  id: bid, order_id: oid, tier, batch, bag_code: code, received_on: "2026-11-16", due_date: "2026-12-07", due_status: "calculated",
  turnaround_days: 15, source: "receiving", created_at: "2026-11-16T15:00:00+00:00", location_id: null,
});
let cardN = 0;
const card = (oid: string, bid: string | null, name: string, over: Row = {}): Row => {
  cardN++;
  return {
    id: id(1000 + cardN), order_id: oid, bag_id: bid, card_name: name, card_set: "Base Set", card_year: "1999", card_number: `${cardN}/102`,
    tier: null, status: "active", completed: true, completed_at: "2026-11-24T15:00:00+00:00", current_round: 1, card_seq: cardN,
    card_code: `CD-X-${String(cardN).padStart(2, "0")}`, received_at: "2026-11-16T15:00:00+00:00", awaiting_arrival: false,
    receiving_photo_urls: [], photo_urls: [], location_id: null, located_at: null, refunded_cents: 0, service_ids: [],
    slab_removal_selected: false, pregrade_selected: false, estimated_value_cents: null, ...over,
  };
};

function seed() {
  cardN = 0;
  mock.store.load({
    tables: {
      orders: [
        order(SOLO, "CD-5001"),
        order(MIXED, "CD-5002", { status: "in_progress", insurance_type: "round_trip", insurance_declared_value_cents: 60000 }),
        order(INTL, "CD-5003", { ship_from_address: CA }),
        order(PAGE, "CD-5004", { status: "shipped_back", return_label_url: "https://shippo.test/order-page.pdf", tracking_number: "9400PAGE" }),
        order(SLOT, "CD-5005"),
        order(REFUND, "CD-5006"),
        order(FAILS, "CD-5007"),
        order(INTL2, "CD-5008", { ship_from_address: CA, status: "in_progress" }),
      ],
      tier_bags: [
        bag(B_SOLO, SOLO, "CD-5001-G"),
        bag(B_GOLD, MIXED, "CD-5002-G"), bag(B_BRONZE, MIXED, "CD-5002-B", "regular"),
        bag(B_INTL, INTL, "CD-5003-G"),
        bag(B_PAGE, PAGE, "CD-5004-G"),
        bag(B_SLOT, SLOT, "CD-5005-G"),
        bag(B_REFUND, REFUND, "CD-5006-G"),
        bag(B_FAILS, FAILS, "CD-5007-G"),
        bag(B_INTL2A, INTL2, "CD-5008-G"), bag(B_INTL2B, INTL2, "CD-5008-B", "regular"),
      ],
      cards: [
        card(SOLO, B_SOLO, "Charizard"), card(SOLO, B_SOLO, "Blastoise"),
        card(MIXED, B_GOLD, "Venusaur", { estimated_value_cents: 20000 }), card(MIXED, B_GOLD, "Mewtwo", { estimated_value_cents: 15000 }),
        card(MIXED, B_BRONZE, "Pikachu", { estimated_value_cents: 5000 }), card(MIXED, B_BRONZE, "Eevee", { completed: false, completed_at: null, estimated_value_cents: 5000 }),
        card(MIXED, B_BRONZE, "Ditto", { status: "refunded", completed: false, completed_at: null }),
        card(INTL, B_INTL, "Charizard Base Set Holo 1st Edition Shadowless", { estimated_value_cents: 120000 }), card(INTL, B_INTL, "Pikachu"),
        card(PAGE, B_PAGE, "Gengar"),
        card(SLOT, B_SLOT, "Alakazam", { location_id: CLAMP, located_at: "2026-11-24T15:00:00+00:00" }),
        card(REFUND, B_REFUND, "Onix", { status: "refunded", completed: false, completed_at: null }),
        card(FAILS, B_FAILS, "Snorlax"),
        card(INTL2, B_INTL2A, "Lugia", { estimated_value_cents: 30000 }), card(INTL2, B_INTL2B, "Togepi", { estimated_value_cents: 2000 }),
      ],
      order_events: [],
      locations: [
        { id: id(302), code: "LOC-DONE", name: "Done", kind: "done", sort: 900, active: true, created_at: "2026-11-24T00:00:00+00:00" },
        { id: id(303), code: "LOC-SHIP", name: "Shipping", kind: "shipping", sort: 1000, active: true, created_at: "2026-11-24T00:00:00+00:00" },
        { id: CLAMP, code: "LOC-CLAMP-01", name: "CLAMP 01", kind: "station", station: "clamp", serial: 1, stage: "Clamp Work", capacity: 1, sort: 10, active: true, created_at: "2026-11-24T00:00:00+00:00" },
      ],
      card_moves: [],
      bag_shipments: [],
      restoration_settings: [
        { tier: "premium", display_name: "Gold", turnaround_min_days: 15, turnaround_max_days: 20 },
        { tier: "regular", display_name: "Bronze", turnaround_min_days: 45, turnaround_max_days: 60 },
      ],
      business_holidays: [],
    },
  });
}

/** A stand-in for Shippo: two rates per quote (Ground Advantage $5.10, Priority Mail $9.85); labels numbered 1, 2, ... */
function fakeShippo(behaviour: { fail?: boolean; throwOnTx?: boolean; delayMs?: number; onTransaction?: (body: Row) => void } = {}) {
  const calls = { shipments: [] as Row[], transactions: [] as Row[], rateInfo: [] as string[] };
  let quotes = 0;
  let labels = 0;
  const port: ShippoPort = {
    async createShipment(input) {
      calls.shipments.push(input);
      quotes++;
      return {
        rates: [
          { objectId: `rate_priority_${quotes}`, provider: "USPS", amount: "9.85", currency: "USD", estimatedDays: 2, servicelevel: { name: "Priority Mail", token: "usps_priority" } },
          { objectId: `rate_ground_${quotes}`, provider: "USPS", amount: "5.10", currency: "USD", estimatedDays: 5, servicelevel: { name: "Ground Advantage", token: "usps_ground_advantage" } },
        ],
      };
    },
    async createTransaction(body) {
      calls.transactions.push(body);
      behaviour.onTransaction?.(body);
      if (behaviour.delayMs) await new Promise((r) => setTimeout(r, behaviour.delayMs));
      if (behaviour.throwOnTx) throw new Error("socket hang up");
      if (behaviour.fail) return { httpStatus: 200, body: { status: "ERROR", messages: [{ text: "The address is invalid" }] } };
      labels++;
      return {
        httpStatus: 201,
        body: { status: "SUCCESS", label_url: `https://shippo.test/label-${labels}.pdf`, tracking_number: `9400TEST${labels}`, tracking_url_provider: `https://tools.usps.com/track?n=${labels}`, object_id: `tx_${labels}` },
      };
    },
    async rateInfo(rateId) {
      calls.rateInfo.push(rateId);
      const priority = rateId.includes("priority");
      return { provider: "USPS", service: priority ? "Priority Mail" : "Ground Advantage", amount: priority ? "9.85" : "5.10" };
    },
  };
  return { port, calls };
}

const shipmentsOf = (bagId: string) => mock.store.table("bag_shipments").filter((s) => s.bag_id === bagId);
const orderRow = (oid: string) => mock.store.table("orders").find((o) => o.id === oid)!;
const eventsOf = (oid: string, type?: string) => mock.store.table("order_events").filter((e) => e.order_id === oid && (!type || e.event_type === type));
const setCard = (name: string, patch: Row) => Object.assign(mock.store.table("cards").find((c) => c.card_name === name)!, patch);

before(async () => {
  const harness = pathToFileURL(path.resolve("tests/intake/harness/mock-supabase.mjs")).href;
  const { startMock } = (await import(harness)) as { startMock: (o: { port: number; quiet: boolean }) => Promise<Mock> };
  mock = await startMock({ port: 0, quiet: true });
  const resendBase = process.env.RESEND_BASE_URL ?? "https://api.resend.com";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(resendBase) || url.startsWith("https://api.resend.com")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      sent.push({ to: body.to, subject: body.subject, html: body.html });
      return new Response(JSON.stringify({ id: `email-${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("goshippo.com")) throw new Error(`a test reached Shippo: ${url}`);
    return realFetch(input, init);
  }) as typeof fetch;
  admin = createClient(mock.url, "service-role-test-key", { auth: { persistSession: false } });
  svc = await import("@/lib/intake/shipping/bag-shipments");
  label = await import("@/lib/intake/shipping/bag-label");
  types = await import("@/lib/intake/shipping/types");
  syncDelivered = await import("@/lib/sync-delivered");
});

beforeEach(() => {
  seed();
  sent.length = 0;
  mock.store.missingTables.clear();
});

after(async () => {
  globalThis.fetch = realFetch;
  await mock?.close();
});

test("claim before buy: the claim row exists when Shippo is called; the label is saved and mirrored to the order", async () => {
  let claimedAtPurchase: Row[] = [];
  const { port, calls } = fakeShippo({ onTransaction: () => { claimedAtPurchase = shipmentsOf(B_SOLO).map((s) => ({ ...s })); } });
  const r = await svc.buyBagLabel(admin, { bagId: B_SOLO, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(r.ok, JSON.stringify(r.body));
  assert.deepEqual(claimedAtPurchase.map((s) => [s.status, s.created_by, s.label_url ?? null]), [["claimed", "gavin", null]]);

  // One tap: the service the customer paid for (Priority Mail), not the cheapest
  assert.equal(calls.transactions.length, 1);
  assert.deepEqual(calls.transactions[0], { rate: "rate_priority_1", label_file_type: "PDF_4x6", async: false, metadata: "Bag CD-5001-G" });

  const [s] = shipmentsOf(B_SOLO);
  assert.deepEqual(
    [s.status, s.label_url, s.tracking_number, s.carrier, s.service, s.cost_cents, s.shippo_transaction_id, s.shippo_rate_id, s.order_label],
    ["purchased", "https://shippo.test/label-1.pdf", "9400TEST1", "USPS", "Priority Mail", 985, "tx_1", "rate_priority_1", true],
  );
  if (r.ok) assert.deepEqual([r.body.existing, r.body.orderLabel, r.body.shipment.status], [false, true, "purchased"]);

  // The order's first label: return_label_url + outbound_* now; tracking number and status at shipped back
  const o = orderRow(SOLO);
  assert.deepEqual(
    [o.return_label_url, o.outbound_tracking_number, o.outbound_carrier, o.outbound_service_level, o.outbound_tracking_url, o.tracking_number, o.status],
    ["https://shippo.test/label-1.pdf", "9400TEST1", "USPS", "Priority Mail", "https://tools.usps.com/track?n=1", null, "completed"],
  );
  assert.equal(sent.length, 0, "buying sends no email");
  assert.equal(eventsOf(SOLO, "bag_label_bought")[0]?.is_customer_visible, false);
  // The order page's route now answers this label instead of buying (its guard is return_label_url)
  assert.equal(await svc.bagLabelInFlight(admin, SOLO), true);
});

test("two taps buy one label: the second waits on the claim, a later one answers the label bought", async () => {
  const { port, calls } = fakeShippo({ delayMs: 60 });
  const [a, b] = await Promise.all([
    svc.buyBagLabel(admin, { bagId: B_SOLO, by: "gavin" }, { shippo: port, preview: false }),
    svc.buyBagLabel(admin, { bagId: B_SOLO, by: "sam" }, { shippo: port, preview: false }),
  ]);
  assert.equal(calls.transactions.length, 1, "one purchase");
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const loser = a.ok ? b : a;
  assert.ok(!loser.ok && loser.body.inProgress === true);
  const again = await svc.buyBagLabel(admin, { bagId: B_SOLO, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(again.ok && again.body.existing && again.body.shipment.labelUrl === "https://shippo.test/label-1.pdf");
  assert.equal(calls.transactions.length, 1);
  assert.equal(shipmentsOf(B_SOLO).length, 1);
});

test("a purchase Shippo refuses releases the claim (failed) and tapping again buys", async () => {
  const bad = fakeShippo({ fail: true });
  const r = await svc.buyBagLabel(admin, { bagId: B_FAILS, by: "gavin" }, { shippo: bad.port, preview: false });
  assert.ok(!r.ok && r.status === 500 && r.body.error === "Label purchase failed: The address is invalid");
  assert.deepEqual(shipmentsOf(B_FAILS).map((s) => [s.status, s.error]), [["failed", "Label purchase failed: The address is invalid"]]);
  assert.equal(orderRow(FAILS).return_label_url, null);

  const page = await svc.loadPacking(admin, B_FAILS);
  assert.ok(page.ok && page.body.canBuy && page.body.next === "buy" && page.body.lastFailure?.error === "Label purchase failed: The address is invalid");

  const good = fakeShippo();
  const ok = await svc.buyBagLabel(admin, { bagId: B_FAILS, by: "gavin" }, { shippo: good.port, preview: false });
  assert.ok(ok.ok && !ok.body.existing);
  assert.deepEqual(shipmentsOf(B_FAILS).map((s) => s.status), ["failed", "purchased"]);
});

test("no clear answer from Shippo keeps the claim: in progress, then stale, then a deliberate retry", async () => {
  const lost = fakeShippo({ throwOnTx: true });
  const r = await svc.buyBagLabel(admin, { bagId: B_FAILS, by: "gavin" }, { shippo: lost.port, preview: false });
  assert.ok(!r.ok && r.status === 500 && r.body.uncertain === true);
  assert.match(r.body.error, /^Failed to purchase label: socket hang up .*check Shippo/);
  assert.deepEqual(shipmentsOf(B_FAILS).map((s) => s.status), ["claimed"]);

  const good = fakeShippo();
  const soon = await svc.buyBagLabel(admin, { bagId: B_FAILS, by: "gavin" }, { shippo: good.port, preview: false });
  assert.ok(!soon.ok && soon.status === 409 && soon.body.inProgress === true);
  const later = () => new Date(Date.now() + 3 * 60_000);
  const stale = await svc.buyBagLabel(admin, { bagId: B_FAILS, by: "gavin" }, { shippo: good.port, preview: false, now: later });
  assert.ok(!stale.ok && stale.status === 409 && stale.body.staleClaim === true);
  assert.equal(good.calls.transactions.length, 0, "nothing bought blind");
  const retry = await svc.buyBagLabel(admin, { bagId: B_FAILS, by: "gavin", retryStaleClaim: true }, { shippo: good.port, preview: false, now: later });
  assert.ok(retry.ok && !retry.body.existing);
  assert.deepEqual(shipmentsOf(B_FAILS).map((s) => s.status), ["failed", "purchased"]);
});

test("single-bag order: Mark shipped sends the usual shipped email once and ships the order back", async () => {
  const { port } = fakeShippo();
  await svc.buyBagLabel(admin, { bagId: B_SOLO, by: "gavin" }, { shippo: port, preview: false });
  const r = await svc.markBagShipped(admin, { bagId: B_SOLO, by: "gavin" }, { preview: false });
  assert.ok(r.ok, JSON.stringify(r.body));
  if (!r.ok) return;
  assert.deepEqual([r.body.emailed, r.body.orderShipped, r.body.orderStatus, r.body.alreadyShipped], [true, true, "shipped_back", false]);
  assert.equal(sent.length, 1, "one email: the shipped email, not also the status email");
  assert.equal(sent[0].subject, "Your restored cards are on the way! — The Card Doc");
  assert.match(sent[0].html, /9400TEST1/);
  assert.doesNotMatch(sent[0].html, /This package has/);
  const o = orderRow(SOLO);
  assert.deepEqual([o.status, o.tracking_number, o.return_label_url], ["shipped_back", "9400TEST1", "https://shippo.test/label-1.pdf"]);
  assert.deepEqual(eventsOf(SOLO, "status_updated").map((e) => [e.description, e.is_customer_visible]), [["Status updated to: Shipped Back — Tracking: 9400TEST1", true]]);
  assert.deepEqual(eventsOf(SOLO, "bag_shipped").map((e) => [e.description, e.is_customer_visible]), [["Bag CD-5001-G shipped. Tracking: 9400TEST1", false]]);
  assert.ok(shipmentsOf(B_SOLO)[0].email_sent_at);

  // A second tap: nothing new
  const again = await svc.markBagShipped(admin, { bagId: B_SOLO, by: "gavin" }, { preview: false });
  assert.ok(again.ok && again.body.alreadyShipped && !again.body.emailed);
  assert.equal(sent.length, 1);
  // Two taps at once: one email
  seed();
  sent.length = 0;
  await svc.buyBagLabel(admin, { bagId: B_SOLO, by: "gavin" }, { shippo: fakeShippo().port, preview: false });
  const both = await Promise.all([svc.markBagShipped(admin, { bagId: B_SOLO, by: "a" }, { preview: false }), svc.markBagShipped(admin, { bagId: B_SOLO, by: "b" }, { preview: false })]);
  assert.equal(both.filter((x) => x.ok && x.body.emailed).length, 1);
  assert.equal(sent.length, 1);
  assert.equal(eventsOf(SOLO, "status_updated").length, 1);
});

test("multi-bag order: each bag ships with its own label and email; the order ships back with the last bag", async () => {
  const { port, calls } = fakeShippo();
  // The Bronze bag has a card not done: refused with the ship check
  const early = await svc.buyBagLabel(admin, { bagId: B_BRONZE, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(!early.ok && early.status === 409 && Array.isArray((early.body.check as { cards: unknown[] }).cards));
  assert.equal(early.body.error, "1 card isn't marked done yet (Eevee).");
  assert.equal(calls.transactions.length, 0);

  // Gold first: its share of the $600 round trip by declared value ($350 of $450)
  const gold = await svc.buyBagLabel(admin, { bagId: B_GOLD, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(gold.ok && gold.body.orderLabel);
  assert.deepEqual(calls.transactions[0].extra, { insurance: { amount: "466.67", currency: "USD", provider: "SHIPPO", content: "Trading cards" } });
  assert.equal(shipmentsOf(B_GOLD)[0].insurance_cents, 46667);
  const shipGold = await svc.markBagShipped(admin, { bagId: B_GOLD, by: "gavin" }, { preview: false });
  assert.ok(shipGold.ok && shipGold.body.emailed && !shipGold.body.orderShipped && shipGold.body.orderStatus === "in_progress");
  assert.equal(orderRow(MIXED).status, "in_progress");
  assert.equal(orderRow(MIXED).tracking_number, null, "no tracking on the order while a bag is in the shop (the order page would auto-ship it)");
  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /This package has 2 of your cards: Venusaur, Mewtwo\. Your other cards will ship separately\./);
  assert.deepEqual(eventsOf(MIXED, "bag_shipped").map((e) => [e.description, e.is_customer_visible]),
    [["Return package shipped with 2 of your cards (Venusaur, Mewtwo). Tracking: 9400TEST1", true]]);
  if (shipGold.ok) assert.deepEqual(shipGold.body.packages.map((p) => [p.bagCode, p.tierName, p.cardCount, p.doneCount, p.status]), [
    ["CD-5002-G", "Gold", 2, 2, "shipped"], ["CD-5002-B", "Bronze", 2, 1, "none"],
  ]);

  // Bronze when done: its label isn't the order's (the order keeps Gold's)
  setCard("Eevee", { completed: true, completed_at: "2026-11-25T15:00:00+00:00" });
  const bronze = await svc.buyBagLabel(admin, { bagId: B_BRONZE, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(bronze.ok && !bronze.body.orderLabel);
  assert.equal(orderRow(MIXED).return_label_url, "https://shippo.test/label-1.pdf");
  // Its insurance: its live cards' share (Pikachu + Eevee, $100 of $450; the refunded Ditto isn't counted)
  assert.equal(shipmentsOf(B_BRONZE)[0].insurance_cents, 13334);
  const shipBronze = await svc.markBagShipped(admin, { bagId: B_BRONZE, by: "gavin" }, { preview: false });
  assert.ok(shipBronze.ok && shipBronze.body.orderShipped && shipBronze.body.orderStatus === "shipped_back");
  assert.equal(sent.length, 2, "one email per bag, no status email");
  assert.match(sent[1].html, /9400TEST2/);
  assert.match(sent[1].html, /It&#39;s the last package of your order\.|It's the last package of your order\./);
  const o = orderRow(MIXED);
  assert.deepEqual([o.status, o.tracking_number], ["shipped_back", "9400TEST1"]);
  assert.deepEqual(eventsOf(MIXED, "status_updated").map((e) => e.description), ["Status updated to: Shipped Back — Tracking: 9400TEST1"]);

  // Customer order page: one panel per package
  const pk = await (await import("@/lib/intake/shipping/return-packages")).loadReturnPackages(admin, { id: MIXED, tracking_number: o.tracking_number as string }, mock.store.table("cards").filter((c) => c.order_id === MIXED) as Row[]);
  assert.deepEqual(pk.map((p) => [p.label, p.number, p.href, p.cards, p.delivered]), [
    ["Return Tracking: Package 1 of 2", "9400TEST1", "https://tools.usps.com/track?n=1", "Venusaur, Mewtwo", false],
    ["Return Tracking: Package 2 of 2", "9400TEST2", "https://tools.usps.com/track?n=2", "Pikachu, Eevee", false],
  ]);

  // Delivered: per package, then the order when both are in
  const markOrders = (ids: string[]) => syncDelivered.markRestorationsDelivered(admin as never, ids, { onlyFrom: ["shipped_back"] });
  const first = await svc.syncBagDeliveries(admin, new Map([["9400TEST1", "DELIVERED"], ["9400TEST2", "TRANSIT"]]), [MIXED], markOrders);
  assert.deepEqual([first.shipmentsDelivered, first.ordersDelivered, first.bagOrderIds.has(MIXED)], [1, [], true]);
  assert.equal(orderRow(MIXED).status, "shipped_back", "not delivered while a package is on its way");
  const second = await svc.syncBagDeliveries(admin, new Map([["9400TEST1", "DELIVERED"], ["9400TEST2", "DELIVERED"]]), [MIXED], markOrders);
  assert.deepEqual([second.shipmentsDelivered, second.ordersDelivered], [1, ["CD-5002"]]);
  assert.equal(orderRow(MIXED).status, "delivered");
  assert.deepEqual(eventsOf(MIXED, "status_updated").map((e) => e.description).at(-1), syncDelivered.DELIVERED_EVENT);
  const third = await svc.syncBagDeliveries(admin, new Map([["9400TEST2", "DELIVERED"]]), [], markOrders);
  assert.deepEqual([third.shipmentsDelivered, third.ordersDelivered], [0, []], "a second run changes nothing");
});

test("the packing page: rates with the paid service flagged, a whole-order label, the ship check, refunded bags", async () => {
  const { port } = fakeShippo();
  const p = await svc.loadPacking(admin, B_SOLO, { rates: true }, { shippo: port });
  assert.ok(p.ok);
  if (!p.ok) return;
  assert.deepEqual([p.body.next, p.body.canBuy, p.body.blocked, p.body.bag.code, p.body.bag.tierName, p.body.order.international], ["buy", true, null, "CD-5001-G", "Gold", false]);
  assert.deepEqual(p.body.rates?.map((r) => [r.objectId, r.service, r.paid]), [["rate_ground_1", "Ground Advantage", false], ["rate_priority_1", "Priority Mail", true]]);

  // A label bought for the whole order on the order page covers the bag
  const page = await svc.loadPacking(admin, B_PAGE);
  assert.ok(page.ok && page.body.orderLabel?.labelUrl === "https://shippo.test/order-page.pdf" && !page.body.canBuy && page.body.next === "blocked");
  const buy = await svc.buyBagLabel(admin, { bagId: B_PAGE, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(!buy.ok && buy.status === 409 && (buy.body.orderLabel as Row).trackingNumber === "9400PAGE");

  // A done card still in a clamp
  const slot = await svc.buyBagLabel(admin, { bagId: B_SLOT, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(!slot.ok && slot.status === 409 && slot.body.error === "1 card is still in a holder (CLAMP 01).");
  // Every card refunded
  const refunded = await svc.buyBagLabel(admin, { bagId: B_REFUND, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(!refunded.ok && refunded.status === 409 && refunded.body.error === "Every card in this bag was refunded: there is nothing to ship.");
  // Not this order's bag / no such bag
  const none = await svc.buyBagLabel(admin, { bagId: id(999), by: "gavin" }, { shippo: port, preview: false });
  assert.ok(!none.ok && none.status === 404);
  const shipFirst = await svc.markBagShipped(admin, { bagId: B_SOLO, by: "gavin" }, { preview: false });
  assert.ok(!shipFirst.ok && shipFirst.status === 409 && shipFirst.body.error === "Buy this bag's return label first.");
  assert.equal(mock.store.table("bag_shipments").length, 0, "nothing claimed by refused requests");
});

test("preview mode refuses before any claim or Shippo call; so does a read-only database", async () => {
  const { port, calls } = fakeShippo();
  const r = await svc.buyBagLabel(admin, { bagId: B_SOLO, by: "gavin" }, { shippo: port, preview: true });
  assert.ok(!r.ok && r.status === 503);
  const s = await svc.markBagShipped(admin, { bagId: B_SOLO, by: "gavin" }, { preview: true });
  assert.ok(!s.ok && s.status === 503);

  // The preview deploy's Supabase client refuses every write (lib/preview.ts previewFetch)
  const { previewFetch } = await import("@/lib/preview");
  const readOnly = createClient(mock.url, "service-role-test-key", { auth: { persistSession: false }, global: { fetch: previewFetch } });
  const w = await svc.buyBagLabel(readOnly, { bagId: B_SOLO, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(!w.ok && w.status === 500 && /Nothing was bought/.test(w.body.error));
  assert.equal(calls.shipments.length + calls.transactions.length, 0, "Shippo never called");
  assert.equal(mock.store.table("bag_shipments").length, 0);
});

test("before the migration: nothing is bought and the pages say why; the order page's route isn't held up", async () => {
  mock.store.missingTables.add("bag_shipments");
  const { port, calls } = fakeShippo();
  const r = await svc.buyBagLabel(admin, { bagId: B_SOLO, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(!r.ok && r.status === 500 && r.body.shipmentsReady === false);
  assert.equal(calls.transactions.length, 0);
  const p = await svc.loadPacking(admin, B_SOLO);
  assert.ok(p.ok && !p.body.shipmentsReady && !p.body.canBuy && /20261125_bag_shipments\.sql/.test(p.body.blocked ?? ""));
  assert.equal(await svc.bagLabelInFlight(admin, SOLO), false);
  const sync = await svc.syncBagDeliveries(admin, new Map(), [SOLO], async () => []);
  assert.deepEqual([sync.shipmentsDelivered, sync.bagOrderIds.size], [0, 0]);
  assert.equal(await svc.countOpenBagShipments(admin), 0);
});

test("international: customs as the order page's label declares them (one bag: every card of the order), no insurance", async () => {
  const { port, calls } = fakeShippo();
  const r = await svc.buyBagLabel(admin, { bagId: B_INTL, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(r.ok, JSON.stringify(r.body));
  // One quote for the one tap, then the fresh shipment with customs for the purchase
  assert.equal(calls.shipments.length, 2);
  const expected = {
    contentsType: "RETURN_MERCHANDISE",
    contentsExplanation: "Returned goods",
    nonDeliveryOption: "RETURN",
    certify: true,
    certifySigner: process.env.BUSINESS_SHIPPING_NAME ?? "",
    eelPfc: "NOEEI_30_37_a",
    items: [
      { description: "Charizard Base Set Holo 1", quantity: 1, netWeight: "0.1", massUnit: "oz", valueAmount: "1200.00", valueCurrency: "USD", originCountry: "US" },
      { description: "Pikachu", quantity: 1, netWeight: "0.1", massUnit: "oz", valueAmount: "50.00", valueCurrency: "USD", originCountry: "US" },
    ],
  };
  for (const sh of calls.shipments) {
    const decl = sh.customsDeclaration as typeof expected;
    assert.deepEqual({ ...decl, items: [...decl.items].sort((a, b) => a.description.localeCompare(b.description)) }, expected);
    assert.deepEqual(sh.parcels, [label.PARCEL]);
    assert.equal((sh.addressTo as Row).country, "CA");
  }
  // The purchase: the cheapest rate of the fresh shipment, no insurance (as before)
  assert.deepEqual(calls.transactions[0], { rate: "rate_ground_2", label_file_type: "PDF_4x6", async: false, metadata: "Bag CD-5003-G" });
  const [s] = shipmentsOf(B_INTL);
  assert.deepEqual([s.carrier, s.service, s.cost_cents, s.insurance_cents], ["USPS", "Ground Advantage", 510, null]);

  // Two bags to Canada: each bag declares its own cards
  const two = fakeShippo();
  const a = await svc.buyBagLabel(admin, { bagId: B_INTL2A, by: "gavin", rateObjectId: "rate_whatever" }, { shippo: two.port, preview: false });
  assert.ok(a.ok);
  assert.equal(two.calls.shipments.length, 1, "a chosen rate: no quote, one shipment with customs");
  assert.deepEqual((two.calls.shipments[0].customsDeclaration as typeof expected).items.map((i) => i.description), ["Lugia"]);
});

test("the shared purchase is the order page's: same requests for the same input", async () => {
  // Domestic with the customer's paid insurance: the chosen rate as is, insurance in `extra`, no metadata
  const dom = fakeShippo();
  const order = { ship_from_address: US, customer_name: "Pat Reyes", insurance_type: "return", insurance_declared_value_cents: 25000 };
  const ins = label.returnInsuranceCents(label.paidReturnInsuranceCents(order), 10000);
  assert.equal(ins, 25000, "the paid floor wins over a lower admin amount");
  const d = await label.purchaseReturnLabel({ order, rateObjectId: "rate_x_priority", insuranceCents: ins, customsCards: async () => { throw new Error("not read for domestic"); } }, dom.port);
  assert.ok(d.ok && d.carrier.service === "Priority Mail" && d.amountCents === 985);
  assert.deepEqual(dom.calls.transactions, [{
    rate: "rate_x_priority", label_file_type: "PDF_4x6", async: false,
    extra: { insurance: { amount: "250.00", currency: "USD", provider: "SHIPPO", content: "Trading cards" } },
  }]);
  assert.equal(dom.calls.shipments.length, 0);
  // International: a fresh shipment, the chosen rate when it's there, else the cheapest; no insurance
  const intl = fakeShippo();
  const i = await label.purchaseReturnLabel({ order: { ...order, ship_from_address: CA }, rateObjectId: "rate_priority_1", insuranceCents: ins, customsCards: async () => [] }, intl.port);
  assert.ok(i.ok && i.carrier.service === "Priority Mail");
  assert.deepEqual(intl.calls.transactions, [{ rate: "rate_priority_1", label_file_type: "PDF_4x6", async: false }]);
  assert.deepEqual((intl.calls.shipments[0].customsDeclaration as { items: Row[] }).items, [{
    description: "Returned trading cards", quantity: 1, netWeight: "8", massUnit: "oz", valueAmount: "10.00", valueCurrency: "USD", originCountry: "US",
  }]);
  // Refusals keep the route's words and statuses
  const none = await label.getReturnRates({ order: { ship_from_address: null }, customsCards: async () => [] }, dom.port);
  assert.deepEqual(none, { ok: false, status: 400, error: "No customer address on file" });
  const lost = await label.purchaseReturnLabel({ order, rateObjectId: "r", insuranceCents: 0, customsCards: async () => [] }, fakeShippo({ throwOnTx: true }).port);
  assert.deepEqual(lost, { ok: false, status: 500, error: "Failed to purchase label: socket hang up", definite: false });
});

test("pure rules: insurance share, packages to show, every bag shipped", () => {
  const v = (cents: number | null) => ({ estimated_value_cents: cents });
  const ins = { insurance_type: "round_trip", insurance_declared_value_cents: 60000 };
  const gold = [v(20000), v(15000)], bronze = [v(5000), v(5000)];
  assert.equal(types.bagInsuranceFloorCents(ins, gold, [...gold, ...bronze], 2), 46667, "Gold's share of $600 by value (35 of 45), rounded up");
  assert.equal(types.bagInsuranceFloorCents(ins, bronze, [...gold, ...bronze], 2), 13334);
  // Production's CD-2424 shape: $10,000 insured, cards declared at $1,500 + $4,100: the shares still cover $10,000
  const g = [v(50000), v(50000), v(50000)], p = [v(205000), v(205000)];
  const big = { insurance_type: "round_trip", insurance_declared_value_cents: 1000000 };
  assert.ok(types.bagInsuranceFloorCents(big, g, [...g, ...p], 2) + types.bagInsuranceFloorCents(big, p, [...g, ...p], 2) >= 1000000);
  assert.equal(types.bagInsuranceFloorCents(ins, [v(20000), v(null)], [v(20000), v(null), v(5000)], 2), 60000, "a card with no value: the whole amount");
  assert.equal(types.bagInsuranceFloorCents(ins, gold, [...gold, v(null)], 2), 60000, "a card of another bag with no value: the whole amount");
  assert.equal(types.bagInsuranceFloorCents(ins, [v(100)], [v(100)], 1), 60000, "one bag: as today");
  assert.equal(types.bagInsuranceFloorCents({ insurance_type: "declined", insurance_declared_value_cents: 60000 }, [], [], 2), 0);

  const s = (status: string, tracking_number: string | null) => ({ status, tracking_number });
  assert.deepEqual(types.returnPackagesToShow("T1", [s("shipped", "T1")]), [], "single bag: the old panel");
  assert.deepEqual(types.returnPackagesToShow(null, [s("shipped", "T1")]).length, 1, "first of several shipped: shown");
  assert.deepEqual(types.returnPackagesToShow("T1", [s("shipped", "T1"), s("delivered", "T2"), s("purchased", "T3")]).length, 2);
  assert.deepEqual(types.returnPackagesToShow("T1", []), []);

  const bags = [{ id: "a", bag_code: "A", tier: "premium" }, { id: "b", bag_code: "B", tier: "regular" }];
  const cards = [{ id: "1", bag_id: "a", status: "active" }, { id: "2", bag_id: "b", status: "refunded" }];
  const row = (bag_id: string, status: string) => ({ bag_id, status } as never);
  assert.equal(types.everyBagShipped(bags, cards, [row("a", "shipped")]), true, "a fully refunded bag doesn't ship");
  assert.equal(types.everyBagShipped(bags, [...cards, { id: "3", bag_id: null, status: "active", awaiting_arrival: false }], [row("a", "shipped")]), false, "a received card in no bag holds it");
  assert.equal(types.everyBagShipped(bags, [...cards, { id: "3", bag_id: null, status: "active", awaiting_arrival: true }], [row("a", "shipped")]), false, "nor does one still awaiting arrival");
  assert.equal(types.everyBagShipped(bags, [...cards, { id: "3", bag_id: null, status: "refunded" }], [row("a", "shipped")]), true, "a refunded loose card doesn't");
  assert.equal(types.everyBagShipped(bags, cards, [row("a", "purchased")]), false);
  assert.equal(types.everyBagDelivered(bags, cards, [row("a", "delivered")]), true);
  assert.equal(types.orderStatusBlock("cancelled"), "This order is cancelled.");
  assert.equal(types.orderStatusBlock("completed"), null);
  assert.equal(types.cardList(["A", "B", "C", "D", "E", "F", "G"]), "A, B, C, D, E and 2 more");
});
