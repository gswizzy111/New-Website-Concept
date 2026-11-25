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
import type { ShippoPort, ShippoTransaction } from "@/lib/intake/shipping/bag-label";

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
let orderSvc: typeof import("@/lib/intake/shipping/order-label");
let queue: typeof import("@/lib/intake/shipping/ship-queue");
const sent: { to: unknown; subject: string; html: string }[] = [];
/** Emails whose subject matches are refused by "Resend" (500). */
let resendRefuses: RegExp | null = null;
/** Shippo's GET /transactions answer for the SDK (sync-delivered); null: any Shippo call fails the test. */
let shippoHistory: Row[] | null = null;
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
  // lib/shippo.ts builds the SDK client when it loads: a dummy key (every Shippo call is answered here)
  process.env.SHIPPO_API_TOKEN ??= "shippo_test_dummy";
  const harness = pathToFileURL(path.resolve("tests/intake/harness/mock-supabase.mjs")).href;
  const { startMock } = (await import(harness)) as { startMock: (o: { port: number; quiet: boolean }) => Promise<Mock> };
  mock = await startMock({ port: 0, quiet: true });
  const resendBase = process.env.RESEND_BASE_URL ?? "https://api.resend.com";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(resendBase) || url.startsWith("https://api.resend.com")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (resendRefuses?.test(body.subject ?? "")) {
        return new Response(JSON.stringify({ statusCode: 500, name: "application_error", message: "Resend is down" }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
      sent.push({ to: body.to, subject: body.subject, html: body.html });
      return new Response(JSON.stringify({ id: `email-${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("goshippo.com")) {
      const u = new URL(url);
      const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
      if (shippoHistory && method === "GET" && /\/transactions\/?$/.test(u.pathname)) {
        const page = Number(u.searchParams.get("page") ?? "1");
        return new Response(JSON.stringify({ next: null, previous: null, results: page === 1 ? shippoHistory : [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`a test reached Shippo: ${url}`);
    }
    return realFetch(input, init);
  }) as typeof fetch;
  admin = createClient(mock.url, "service-role-test-key", { auth: { persistSession: false } });
  svc = await import("@/lib/intake/shipping/bag-shipments");
  label = await import("@/lib/intake/shipping/bag-label");
  types = await import("@/lib/intake/shipping/types");
  syncDelivered = await import("@/lib/sync-delivered");
  orderSvc = await import("@/lib/intake/shipping/order-label");
  queue = await import("@/lib/intake/shipping/ship-queue");
});

beforeEach(() => {
  seed();
  sent.length = 0;
  resendRefuses = null;
  shippoHistory = null;
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
  // The release adds its note after the unclear answer's: the error column is never overwritten
  assert.equal(shipmentsOf(B_FAILS)[0].error, "Failed to purchase label: socket hang up | Never finished; released by gavin to buy again.");
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
  // The order carries the LAST package's tracking (both sites mark it delivered from that number alone), the first label stays its return label
  const o = orderRow(MIXED);
  assert.deepEqual([o.status, o.tracking_number, o.return_label_url], ["shipped_back", "9400TEST2", "https://shippo.test/label-1.pdf"]);
  assert.deepEqual(eventsOf(MIXED, "status_updated").map((e) => e.description), ["Status updated to: Shipped Back — Tracking: 9400TEST2"]);

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

// ─── Review fixes (Nov 25): the last package's tracking, the order-level claim, lost labels, ship-back retries ───

type Rule = { method: string; table: string; when?: (body: string, url: string) => boolean; times?: number; act: "fail" | (() => void) };
/** A client whose requests meet `rules` first: an injected database failure, or a change made "meanwhile" by someone else. */
function clientWith(rules: Rule[]): SupabaseClient {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    for (const r of rules) {
      if ((r.times ?? Number.POSITIVE_INFINITY) <= 0) continue;
      if (r.method !== method || !new URL(url).pathname.endsWith(`/rest/v1/${r.table}`)) continue;
      if (r.when && !r.when(body, url)) continue;
      r.times = (r.times ?? Number.POSITIVE_INFINITY) - 1;
      if (r.act === "fail") {
        return new Response(JSON.stringify({ code: "XX000", message: "injected failure", details: null, hint: null }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
      r.act();
    }
    return realFetch(input, init);
  };
  return createClient(mock.url, "service-role-test-key", { auth: { persistSession: false }, global: { fetch: wrapped as typeof fetch } });
}

/** Shippo's label history (one page, newest first) for findLabelByMetadata; an Error = Shippo unreachable. */
const withHistory = (port: ShippoPort, txs: ShippoTransaction[] | Error): ShippoPort => ({
  ...port,
  async listTransactions(page: number) {
    if (txs instanceof Error) throw txs;
    return { results: page === 1 ? txs : [], next: false };
  },
});
const tx = (over: Partial<ShippoTransaction>): ShippoTransaction => ({
  objectId: "tx_x", status: "SUCCESS", labelUrl: null, trackingNumber: null, trackingUrlProvider: null, metadata: null,
  objectCreated: new Date().toISOString(), rate: null, ...over,
});
const later = () => new Date(Date.now() + 3 * 60_000);
const buy = async (bagId: string, port: ShippoPort) => {
  const r = await svc.buyBagLabel(admin, { bagId, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(r.ok, JSON.stringify(r.body));
  return r;
};
const ship = async (bagId: string, client: SupabaseClient = admin, now?: () => Date) => svc.markBagShipped(client, { bagId, by: "gavin" }, { preview: false, now });

test("the order carries the last package's tracking; the order page doesn't deliver it from that number while a package is out", async () => {
  const { port } = fakeShippo();
  setCard("Eevee", { completed: true, completed_at: "2026-11-25T15:00:00+00:00" });
  await buy(B_GOLD, port);
  await ship(B_GOLD);
  // sync-return-tracking: a bag order is filled from its last package to leave, never from return_label_url (the first)
  let latest = await svc.latestShippedBags(admin, [MIXED, SOLO]);
  assert.equal(latest.failed, false);
  assert.equal(latest.byOrder.get(MIXED)?.tracking_number, "9400TEST1");
  assert.equal(latest.byOrder.has(SOLO), false, "no bag label: filled from return_label_url as before");
  assert.equal(await svc.bagShipmentsHoldDelivery(admin, MIXED), true);
  await buy(B_BRONZE, port);
  assert.equal((await svc.latestShippedBags(admin, [MIXED])).byOrder.get(MIXED)?.tracking_number, "9400TEST1", "bought isn't shipped");
  const r = await ship(B_BRONZE);
  assert.ok(r.ok && r.body.orderShipped);
  latest = await svc.latestShippedBags(admin, [MIXED]);
  assert.equal(latest.byOrder.get(MIXED)?.tracking_number, "9400TEST2");
  assert.equal(orderRow(MIXED).tracking_number, "9400TEST2");

  // The admin order page: the last package delivered but the first still out -> wait; both -> deliver
  await svc.syncBagDeliveries(admin, new Map([["9400TEST2", "DELIVERED"]]), [], async () => []);
  assert.equal(await svc.bagShipmentsHoldDelivery(admin, MIXED), true);
  await svc.syncBagDeliveries(admin, new Map([["9400TEST1", "DELIVERED"]]), [], async () => []);
  assert.equal(await svc.bagShipmentsHoldDelivery(admin, MIXED), false);
  assert.equal(await svc.bagShipmentsHoldDelivery(admin, SOLO), false, "no bag labels: as before");

  // A read error holds the order page (the sync decides) and fills no order in sync-return-tracking
  const broken = clientWith([{ method: "GET", table: "bag_shipments", act: "fail" }]);
  assert.equal(await svc.bagShipmentsHoldDelivery(broken, MIXED), true);
  assert.equal((await svc.latestShippedBags(broken, [MIXED])).failed, true);
  mock.store.missingTables.add("bag_shipments");
  assert.equal(await svc.bagShipmentsHoldDelivery(admin, MIXED), false);
  assert.deepEqual([...(await svc.latestShippedBags(admin, [MIXED])).byOrder.keys()], []);
});

test("the order page's label claims the order: a double tap buys one label, otherwise exactly as before", async () => {
  const { port, calls } = fakeShippo({ delayMs: 60 });
  const body = { rateObjectId: "rate_priority_9" };
  const [a, b] = await Promise.all([
    orderSvc.buyOrderReturnLabel(admin, { orderId: SOLO, body }, { shippo: port, preview: false }),
    orderSvc.buyOrderReturnLabel(admin, { orderId: SOLO, body }, { shippo: port, preview: false }),
  ]);
  assert.equal(calls.transactions.length, 1, "one purchase");
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const [winner, loser] = a.status === 200 ? [a, b] : [b, a];
  assert.deepEqual(winner.body, { labelUrl: "https://shippo.test/label-1.pdf", trackingNumber: "9400TEST1" });
  assert.equal(loser.body.inProgress, true);
  assert.deepEqual(calls.transactions[0], { rate: "rate_priority_9", label_file_type: "PDF_4x6", async: false, metadata: "Order CD-5001" });
  const o = orderRow(SOLO);
  assert.deepEqual([o.status, o.return_label_url, o.tracking_number, o.outbound_carrier, o.outbound_service_level],
    ["shipped_back", "https://shippo.test/label-1.pdf", "9400TEST1", "USPS", "Priority Mail"]);
  assert.deepEqual(eventsOf(SOLO, "status_updated").map((e) => e.description), ["Return label purchased — marked Shipped Back. Tracking: 9400TEST1"]);
  assert.equal(sent.length, 1);
  assert.equal(mock.store.table("bag_shipments").length, 0, "the claim is gone once the label is on the order");
  // A later tap answers the label; the bag route refuses (the whole-order label covers the bag)
  assert.deepEqual(await orderSvc.buyOrderReturnLabel(admin, { orderId: SOLO, body }, { shippo: port, preview: false }),
    { status: 200, body: { labelUrl: "https://shippo.test/label-1.pdf" } });
  const bag = await svc.buyBagLabel(admin, { bagId: B_SOLO, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(!bag.ok && bag.status === 409 && (bag.body.orderLabel as Row).labelUrl === "https://shippo.test/label-1.pdf");
  assert.equal(calls.transactions.length, 1);
});

test("a bag label and a whole-order label are never both bought: each route checks the other's claim after writing its own", async () => {
  const { port, calls } = fakeShippo();
  // The order page holds the order: the bag claims, sees it, lets go (nothing reaches Shippo)
  await admin.from("bag_shipments").insert({ bag_id: null, order_id: SOLO, status: "claimed", claimed_at: new Date().toISOString() });
  const r = await svc.buyBagLabel(admin, { bagId: B_SOLO, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(!r.ok && r.status === 409 && r.body.inProgress === true && /being bought on the order page/.test(r.body.error));
  assert.deepEqual(shipmentsOf(B_SOLO), [], "the bag's claim was dropped");
  assert.equal(calls.shipments.length + calls.transactions.length, 0);
  // The packing page doesn't count the order page's claim as a package
  const page = await svc.loadPacking(admin, B_SOLO);
  assert.ok(page.ok && page.body.shipment === null && page.body.packages.every((p) => p.status === "none"));

  // A bag label being bought: the order page claims, sees it, lets go
  await admin.from("bag_shipments").insert({ bag_id: B_GOLD, order_id: MIXED, status: "claimed", claimed_at: new Date().toISOString() });
  const o = await orderSvc.buyOrderReturnLabel(admin, { orderId: MIXED, body: { rateObjectId: "rate_priority_9" } }, { shippo: port, preview: false });
  assert.equal(o.status, 409);
  assert.match(String(o.body.error), /one of this order's bags/);
  assert.deepEqual(mock.store.table("bag_shipments").filter((s) => s.order_id === MIXED).map((s) => [s.bag_id, s.status]), [[B_GOLD, "claimed"]], "the order's claim was dropped");
  // ...and can't read the bag labels: doesn't buy blind
  const blind = clientWith([{ method: "GET", table: "bag_shipments", when: (_b, url) => url.includes("bag_id=not.is.null"), act: "fail" }]);
  const ob = await orderSvc.buyOrderReturnLabel(blind, { orderId: FAILS, body: { rateObjectId: "rate_priority_9" } }, { shippo: port, preview: false });
  assert.equal(ob.status, 500);
  assert.equal(calls.transactions.length, 0);
  assert.deepEqual(mock.store.table("bag_shipments").filter((s) => s.order_id === FAILS), []);

  // The order page saved a label since the bag was read: the bag re-reads the order after its claim and lets go
  const sneaky = clientWith([{
    method: "POST", table: "bag_shipments", times: 1,
    act: () => Object.assign(orderRow(FAILS), { return_label_url: "https://shippo.test/order-page-late.pdf", tracking_number: "9400LATE" }),
  }]);
  const late = await svc.buyBagLabel(sneaky, { bagId: B_FAILS, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(!late.ok && late.status === 409 && (late.body.orderLabel as Row).labelUrl === "https://shippo.test/order-page-late.pdf");
  assert.deepEqual(shipmentsOf(B_FAILS), []);
  assert.equal(calls.transactions.length, 0);
});

test("the order page: a label bought but not saved is saved by the next tap; an unclear answer is checked in Shippo first", async () => {
  const body = { rateObjectId: "rate_priority_9" };
  // The order's save fails (with and without the carrier): the label stays on the claim
  const first = fakeShippo();
  const failing = clientWith([{ method: "PATCH", table: "orders", times: 2, act: "fail" }]);
  const r = await orderSvc.buyOrderReturnLabel(failing, { orderId: SOLO, body }, { shippo: first.port, preview: false });
  assert.equal(r.status, 500);
  assert.match(String(r.body.error), /bought but couldn't be saved on the order .*label-1\.pdf/);
  const [claim] = mock.store.table("bag_shipments");
  assert.deepEqual([claim.bag_id, claim.status, claim.label_url, claim.tracking_number, claim.error],
    [null, "claimed", "https://shippo.test/label-1.pdf", "9400TEST1", "Bought but not saved: https://shippo.test/label-1.pdf"]);
  // Meanwhile the bag route won't buy
  const bag = await svc.buyBagLabel(admin, { bagId: B_SOLO, by: "gavin" }, { shippo: first.port, preview: false });
  assert.ok(!bag.ok && bag.status === 409 && /bought on the order page but not saved/.test(bag.body.error));
  // The next tap saves it: nothing new bought
  const again = await orderSvc.buyOrderReturnLabel(admin, { orderId: SOLO, body }, { shippo: first.port, preview: false });
  assert.deepEqual([again.status, again.body], [200, { labelUrl: "https://shippo.test/label-1.pdf", trackingNumber: "9400TEST1" }]);
  assert.equal(first.calls.transactions.length, 1);
  assert.deepEqual([orderRow(SOLO).status, orderRow(SOLO).return_label_url, orderRow(SOLO).tracking_number], ["shipped_back", "https://shippo.test/label-1.pdf", "9400TEST1"]);
  assert.equal(mock.store.table("bag_shipments").length, 0);

  // No clear answer: the claim stays; within 2 minutes a tap waits; then Shippo's history ("Order CD-5007") decides
  const lostAnswer = async () => {
    const u = await orderSvc.buyOrderReturnLabel(admin, { orderId: FAILS, body }, { shippo: fakeShippo({ throwOnTx: true }).port, preview: false });
    assert.equal(u.status, 500);
    assert.match(String(u.body.error), /checked in Shippo first/);
    return String(mock.store.table("bag_shipments").find((s) => s.order_id === FAILS)!.claimed_at);
  };
  let claimedAt = await lostAnswer();
  const waiting = fakeShippo();
  const soon = await orderSvc.buyOrderReturnLabel(admin, { orderId: FAILS, body }, { shippo: waiting.port, preview: false });
  assert.ok(soon.status === 409 && soon.body.inProgress === true);
  const found = fakeShippo();
  const inHistory = withHistory(found.port, [tx({
    objectId: "tx_lost", labelUrl: "https://shippo.test/lost.pdf", trackingNumber: "9400LOST", metadata: "Order CD-5007",
    objectCreated: new Date(Date.parse(claimedAt) + 1000).toISOString(), rate: "rate_priority_7",
  })]);
  const rec = await orderSvc.buyOrderReturnLabel(admin, { orderId: FAILS, body }, { shippo: inHistory, preview: false, now: later });
  assert.deepEqual([rec.status, rec.body.labelUrl, rec.body.trackingNumber], [200, "https://shippo.test/lost.pdf", "9400LOST"]);
  assert.equal(found.calls.transactions.length + waiting.calls.transactions.length, 0, "saved, not bought again");
  assert.deepEqual([orderRow(FAILS).status, orderRow(FAILS).outbound_service_level], ["shipped_back", "Priority Mail"]);

  // Shippo's history reaches past the claim with no label for it: released and bought (the order page has no retry button)
  seed();
  claimedAt = await lostAnswer();
  const none = fakeShippo();
  const bought = await orderSvc.buyOrderReturnLabel(admin, { orderId: FAILS, body },
    { shippo: withHistory(none.port, [tx({ metadata: "Order CD-9999", labelUrl: "https://shippo.test/x.pdf", objectCreated: "2026-01-01T00:00:00.000Z" })]), preview: false, now: later });
  assert.equal(bought.status, 200);
  assert.equal(none.calls.transactions.length, 1);
  assert.deepEqual(mock.store.table("bag_shipments").map((s) => [s.status, s.error]),
    [["failed", "Failed to purchase label: socket hang up | Never finished; Shippo had no label for it, released to buy again."]]);

  // Shippo unreachable: stale, and only a deliberate retry buys
  seed();
  await lostAnswer();
  const unsure = fakeShippo();
  const stale = await orderSvc.buyOrderReturnLabel(admin, { orderId: FAILS, body }, { shippo: withHistory(unsure.port, new Error("Shippo is down")), preview: false, now: later });
  assert.ok(stale.status === 409 && stale.body.staleClaim === true && /Shippo is down/.test(String(stale.body.error)));
  const forced = await orderSvc.buyOrderReturnLabel(admin, { orderId: FAILS, body: { ...body, retryStaleClaim: true } },
    { shippo: withHistory(unsure.port, new Error("Shippo is down")), preview: false, now: later });
  assert.equal(forced.status, 200);
  assert.equal(unsure.calls.transactions.length, 1);
});

test("the order page before the migration buys as before (no claim); its other answers are unchanged", async () => {
  const { port, calls } = fakeShippo();
  assert.deepEqual(await orderSvc.buyOrderReturnLabel(admin, { orderId: FAILS, body: {} }, { shippo: port, preview: false }), { status: 400, body: { error: "Missing rateObjectId" } });
  assert.deepEqual(await orderSvc.buyOrderReturnLabel(admin, { orderId: id(999), body: { rateObjectId: "r" } }, { shippo: port, preview: false }), { status: 404, body: { error: "Order not found" } });
  assert.deepEqual(await orderSvc.buyOrderReturnLabel(admin, { orderId: PAGE, body: { rateObjectId: "r" } }, { shippo: port, preview: false }), { status: 200, body: { labelUrl: "https://shippo.test/order-page.pdf" } });
  assert.equal((await orderSvc.buyOrderReturnLabel(admin, { orderId: FAILS, body: { rateObjectId: "r" } }, { shippo: port, preview: true })).status, 503);
  const refused = await orderSvc.buyOrderReturnLabel(admin, { orderId: FAILS, body: { rateObjectId: "r" } }, { shippo: fakeShippo({ fail: true }).port, preview: false });
  assert.deepEqual(refused, { status: 500, body: { error: "Label purchase failed: The address is invalid" } });
  assert.deepEqual(mock.store.table("bag_shipments").map((s) => [s.bag_id, s.status]), [[null, "failed"]], "Shippo said no: the claim is released");
  assert.equal(calls.transactions.length, 0);

  mock.store.missingTables.add("bag_shipments");
  const r = await orderSvc.buyOrderReturnLabel(admin, { orderId: SOLO, body: { rateObjectId: "rate_priority_9" } }, { shippo: port, preview: false });
  assert.deepEqual([r.status, r.body.labelUrl], [200, "https://shippo.test/label-1.pdf"]);
  assert.equal(orderRow(SOLO).status, "shipped_back");
});

test("a bag label bought but not saved is saved by the next tap, never bought twice; Shippo's history settles a stale claim", async () => {
  const { port, calls } = fakeShippo();
  // Saving the label on the claim fails: it is kept on the claim
  const failing = clientWith([{ method: "PATCH", table: "bag_shipments", times: 1, when: (b) => b.includes('"purchased"'), act: "fail" }]);
  const r = await svc.buyBagLabel(failing, { bagId: B_FAILS, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(!r.ok && r.status === 500 && r.body.unsaved === true && r.body.labelUrl === "https://shippo.test/label-1.pdf");
  const [kept] = shipmentsOf(B_FAILS);
  assert.deepEqual([kept.status, kept.label_url, kept.tracking_number, kept.error],
    ["claimed", "https://shippo.test/label-1.pdf", "9400TEST1", "Bought but not saved: https://shippo.test/label-1.pdf"]);
  const page = await svc.loadPacking(admin, B_FAILS);
  assert.ok(page.ok && page.body.next === "wait" && /bought but couldn't be saved/.test(page.body.blocked ?? ""));
  assert.ok(page.ok && page.body.unsavedLabel?.labelUrl === "https://shippo.test/label-1.pdf");
  const early = await ship(B_FAILS);
  assert.ok(!early.ok && early.status === 409 && /isn't saved yet/.test(early.body.error));
  // The next tap saves that label: nothing new bought
  const again = await svc.buyBagLabel(admin, { bagId: B_FAILS, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(again.ok && again.body.existing && again.body.orderLabel && again.body.shipment.status === "purchased");
  if (again.ok) assert.deepEqual([again.body.shipment.labelUrl, again.body.shipment.trackingNumber, again.body.shipment.error], ["https://shippo.test/label-1.pdf", "9400TEST1", null]);
  assert.equal(calls.transactions.length, 1, "one label");
  assert.equal(orderRow(FAILS).return_label_url, "https://shippo.test/label-1.pdf");
  assert.match(String(eventsOf(FAILS, "bag_label_bought")[0].description), /Saved after an unfinished purchase: nothing new was bought\.$/);

  // Only the note survived: the URL in it is saved (even on a deliberate retry), no Shippo call
  seed();
  await admin.from("bag_shipments").insert({
    bag_id: B_FAILS, order_id: FAILS, status: "claimed", claimed_at: new Date().toISOString(),
    error: "Failed to purchase label: timeout | Bought but not saved: https://shippo.test/label-9.pdf",
  });
  const fresh = fakeShippo();
  const saved = await svc.buyBagLabel(admin, { bagId: B_FAILS, by: "gavin", retryStaleClaim: true }, { shippo: fresh.port, preview: false, now: later });
  assert.ok(saved.ok && saved.body.shipment.labelUrl === "https://shippo.test/label-9.pdf" && saved.body.shipment.status === "purchased");
  assert.equal(fresh.calls.transactions.length + fresh.calls.shipments.length, 0);

  // A stale claim: Shippo's history ("Bag CD-5007-G") decides
  seed();
  await svc.buyBagLabel(admin, { bagId: B_FAILS, by: "gavin" }, { shippo: fakeShippo({ throwOnTx: true }).port, preview: false });
  const claimedAt = String(shipmentsOf(B_FAILS)[0].claimed_at);
  const at = (ms: number) => new Date(Date.parse(claimedAt) + ms).toISOString();
  const older = tx({ metadata: "Bag CD-5007-G", labelUrl: "https://shippo.test/older.pdf", objectCreated: "2026-11-01T00:00:00.000Z" });
  const p = fakeShippo();
  const making = await svc.buyBagLabel(admin, { bagId: B_FAILS, by: "gavin", retryStaleClaim: true },
    { shippo: withHistory(p.port, [tx({ status: "QUEUED", metadata: "Bag CD-5007-G", objectCreated: at(1000) }), older]), preview: false, now: later });
  assert.ok(!making.ok && making.status === 409 && making.body.inProgress === true, "still being made: wait");
  const noneYet = await svc.buyBagLabel(admin, { bagId: B_FAILS, by: "gavin" }, { shippo: withHistory(p.port, [older]), preview: false, now: later });
  assert.ok(!noneYet.ok && noneYet.status === 409 && noneYet.body.staleClaim === true && /Shippo has no label for it, so buying again is safe/.test(noneYet.body.error),
    "an older label of the bag isn't this claim's");
  const lost = tx({ objectId: "tx_lost", labelUrl: "https://shippo.test/lost.pdf", trackingNumber: "9400LOST", trackingUrlProvider: "https://track.test/lost", metadata: "Bag CD-5007-G", objectCreated: at(2000), rate: "rate_ground_3" });
  const f = await svc.buyBagLabel(admin, { bagId: B_FAILS, by: "gavin" }, { shippo: withHistory(p.port, [lost, older]), preview: false, now: later });
  assert.ok(f.ok && f.body.existing, JSON.stringify(f.body));
  if (f.ok) assert.deepEqual([f.body.shipment.labelUrl, f.body.shipment.trackingNumber, f.body.shipment.service, f.body.shipment.costCents], ["https://shippo.test/lost.pdf", "9400LOST", "Ground Advantage", 510]);
  assert.equal(p.calls.transactions.length, 0, "found, not bought again");
});

test("no bag label for an order already shipped back (by hand)", async () => {
  const { port, calls } = fakeShippo();
  orderRow(SOLO).status = "shipped_back";
  const r = await svc.buyBagLabel(admin, { bagId: B_SOLO, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(!r.ok && r.status === 409 && r.body.error === "This order is already shipped back.");
  const p = await svc.loadPacking(admin, B_SOLO);
  assert.ok(p.ok && !p.body.canBuy && p.body.next === "blocked" && p.body.blocked === "This order is already shipped back.");
  assert.equal(calls.transactions.length, 0);
  assert.equal(types.LABEL_ORDER_STATUSES.includes("shipped_back"), false);
});

test("delivered sync fails closed on a read error; an order shipped partly by hand is left to its tracking number", async () => {
  const { port } = fakeShippo();
  const mark = (ids: string[]) => syncDelivered.markRestorationsDelivered(admin as never, ids, { onlyFrom: ["shipped_back"] });
  // MIXED: Gold went as a bag; Bronze was shipped back by hand (no bag label), the order carries that label's number
  await buy(B_GOLD, port);
  await ship(B_GOLD);
  Object.assign(orderRow(MIXED), { status: "shipped_back", tracking_number: "9400HAND" });
  const r = await svc.syncBagDeliveries(admin, new Map([["9400TEST1", "DELIVERED"]]), [MIXED], mark);
  assert.deepEqual([r.failed, r.shipmentsDelivered, r.bagOrderIds.has(MIXED), r.ordersDelivered], [false, 1, false, []],
    "not shipped wholly bag by bag: the caller checks 9400HAND");
  // SOLO went wholly as bags: a bag order
  await buy(B_SOLO, port);
  await ship(B_SOLO);
  const s = await svc.syncBagDeliveries(admin, new Map(), [SOLO], mark);
  assert.deepEqual([s.failed, s.bagOrderIds.has(SOLO)], [false, true]);
  // A read error: failed (the callers skip their tracking-number pass), nothing marked
  const broken = clientWith([{ method: "GET", table: "bag_shipments", act: "fail" }]);
  const f = await svc.syncBagDeliveries(broken, new Map([["9400TEST2", "DELIVERED"]]), [SOLO], mark);
  assert.deepEqual([f.failed, f.bagOrderIds.size, f.ordersDelivered], [true, 0, []]);
  const broken2 = clientWith([{ method: "GET", table: "tier_bags", act: "fail" }]);
  assert.equal((await svc.syncBagDeliveries(broken2, new Map(), [SOLO], mark)).failed, true);
  assert.equal(orderRow(SOLO).status, "shipped_back");
  // Before the migration: not failed (orders go by tracking number, as before)
  mock.store.missingTables.add("bag_shipments");
  const pre = await svc.syncBagDeliveries(admin, new Map(), [SOLO], mark);
  assert.deepEqual([pre.failed, pre.bagOrderIds.size], [false, 0]);
});

test("a failed or skipped ship-back step says so and runs again from the packing page or a second Mark shipped", async () => {
  const { port } = fakeShippo();
  const inTwoMinutes = () => new Date(Date.now() + 2 * 60_000);
  await buy(B_SOLO, port);
  // The order's status update fails (setOrderStatus' conditional update)
  const statusFails = () => clientWith([{ method: "PATCH", table: "orders", times: 1, when: (b) => b.includes("shipped_back"), act: "fail" }]);
  const r = await ship(B_SOLO, statusFails());
  assert.ok(r.ok && r.body.emailed && !r.body.orderShipped && r.body.orderStatus === "completed");
  if (r.ok) assert.match(r.body.message, /^Marked shipped and the customer was emailed the tracking\. Every bag has shipped, but the order couldn't be set to Shipped Back \(injected failure\)\. Reload this page to try again\.$/);
  assert.equal(orderRow(SOLO).status, "completed");
  // Right away a reload leaves it to the tap still at it; a minute on it ships the order back, once, no second email
  const soon = await svc.loadPacking(admin, B_SOLO, {}, { preview: false });
  assert.ok(soon.ok && soon.body.order.status === "completed" && soon.body.notice === undefined);
  const preview = await svc.loadPacking(admin, B_SOLO, {}, { preview: true, now: inTwoMinutes });
  assert.ok(preview.ok && preview.body.order.status === "completed", "preview never writes");
  const p = await svc.loadPacking(admin, B_SOLO, {}, { preview: false, now: inTwoMinutes });
  assert.ok(p.ok && p.body.order.status === "shipped_back" && p.body.notice === "Every bag has shipped: the order is now Shipped Back.");
  assert.deepEqual([orderRow(SOLO).status, orderRow(SOLO).tracking_number], ["shipped_back", "9400TEST1"]);
  assert.equal(sent.length, 1, "the bag's email only");
  assert.equal(eventsOf(SOLO, "status_updated").length, 1);
  const p2 = await svc.loadPacking(admin, B_SOLO, {}, { preview: false, now: inTwoMinutes });
  assert.ok(p2.ok && p2.body.notice === undefined && eventsOf(SOLO, "status_updated").length === 1, "once");

  // A second Mark shipped runs it too
  seed();
  sent.length = 0;
  await buy(B_SOLO, fakeShippo().port);
  await ship(B_SOLO, statusFails());
  const again = await ship(B_SOLO, admin, inTwoMinutes);
  assert.ok(again.ok && again.body.alreadyShipped && again.body.orderShipped && again.body.orderStatus === "shipped_back");
  if (again.ok) assert.match(again.body.message, /No second email was sent\. Every bag has shipped: the order is now Shipped Back\.$/);
  assert.equal(sent.length, 1);

  // Skipped (the status moved meanwhile): read again; a status it ships from -> shipped back; cancelled -> said
  for (const [moveTo, shipped] of [["in_progress", true], ["cancelled", false]] as const) {
    seed();
    await buy(B_SOLO, fakeShippo().port);
    const moved = clientWith([{ method: "PATCH", table: "bag_shipments", times: 1, when: (b) => b.includes('"shipped"'), act: () => { orderRow(SOLO).status = moveTo; } }]);
    const m = await ship(B_SOLO, moved);
    assert.ok(m.ok && m.body.orderShipped === shipped, JSON.stringify(m.body));
    assert.equal(orderRow(SOLO).status, shipped ? "shipped_back" : "cancelled");
    if (m.ok && !shipped) assert.match(m.body.message, /the order is "cancelled" now, so it wasn't set to Shipped Back\./);
  }
});

test("the order's shipped-back email goes when the bag's own email didn't (failed, or no tracking)", async () => {
  resendRefuses = /restored cards are on the way/;
  await buy(B_SOLO, fakeShippo().port);
  const r = await ship(B_SOLO);
  assert.ok(r.ok && !r.body.emailed && r.body.emailFailed && r.body.orderShipped);
  assert.deepEqual(sent.map((m) => m.subject), ["Your cards are on the way! — Order #CD-5001"]);
  assert.match(sent[0].html, /9400TEST1/);
  if (r.ok) assert.match(r.body.message, /^Marked shipped, but the customer's email didn't send\. Every bag has shipped: the order is Shipped Back\. The customer was sent the order's shipped-back email instead\.$/);

  // A label with no tracking number: the bag's email is skipped, the status email still goes
  seed();
  sent.length = 0;
  resendRefuses = null;
  shippoHistory = null;
  const noTracking: ShippoPort = {
    ...fakeShippo().port,
    async createTransaction() { return { httpStatus: 201, body: { status: "SUCCESS", label_url: "https://shippo.test/nt.pdf", object_id: "tx_nt" } }; },
  };
  await buy(B_SOLO, noTracking);
  const n = await ship(B_SOLO);
  assert.ok(n.ok && !n.body.emailed && !n.body.emailFailed && n.body.orderShipped);
  assert.deepEqual(sent.map((m) => m.subject), ["Your cards are on the way! — Order #CD-5001"]);
  assert.equal(orderRow(SOLO).tracking_number, null);
});

test("customs: one bag declares the whole order only when no live card is outside it", async () => {
  // A card of the order not received yet (no bag): not in the box, not on the form
  mock.store.table("cards").push(card(INTL, null, "Mew", { awaiting_arrival: true, received_at: null, completed: false, completed_at: null, estimated_value_cents: 90000 }));
  const { port, calls } = fakeShippo();
  const r = await svc.buyBagLabel(admin, { bagId: B_INTL, by: "gavin" }, { shippo: port, preview: false });
  assert.ok(r.ok, JSON.stringify(r.body));
  assert.equal(calls.shipments.length, 2);
  for (const sh of calls.shipments) {
    assert.deepEqual((sh.customsDeclaration as { items: Row[] }).items.map((i) => i.description).sort(), ["Charizard Base Set Holo 1", "Pikachu"]);
  }
});

test("ship queue: finished bags and bought labels stay listed until they ship", async () => {
  const { port } = fakeShippo();
  const find = (q: Awaited<ReturnType<typeof queue.loadShipQueueBags>>, code: string) => q.bags.find((b) => b.bagCode === code);
  let q = await queue.loadShipQueueBags(admin);
  assert.ok(q.ready && q.error === null);
  assert.ok(find(q, "CD-5002-G")?.finished && find(q, "CD-5002-G")?.shipment === null);
  assert.equal(find(q, "CD-5002-B"), undefined, "Bronze isn't finished and its order isn't Completed");
  assert.equal(find(q, "CD-5004-G"), undefined, "a whole-order label covers the bag");
  assert.equal(find(q, "CD-5006-G"), undefined, "every card refunded");
  assert.ok(q.orderIdsWithBags.has(MIXED) && !q.orderIdsWithBags.has(PAGE));
  assert.equal(find(q, "CD-5002-G")?.packHref.startsWith("/admin/receiving/pack/"), true);

  // Gold's label bought: still listed with it (print it, Mark shipped)
  await buy(B_GOLD, port);
  q = await queue.loadShipQueueBags(admin);
  const gold = find(q, "CD-5002-G")?.shipment;
  assert.deepEqual([gold?.status, gold?.labelUrl, gold?.trackingNumber, gold?.stale], ["purchased", "https://shippo.test/label-1.pdf", "9400TEST1", false]);
  // Shipped: off the list
  await ship(B_GOLD);
  assert.equal(find(await queue.loadShipQueueBags(admin), "CD-5002-G"), undefined);

  // A label bought and never marked shipped stays listed, even once the order was shipped back by hand
  await buy(B_SOLO, port);
  orderRow(SOLO).status = "shipped_back";
  q = await queue.loadShipQueueBags(admin);
  assert.equal(find(q, "CD-5001-G")?.shipment?.status, "purchased");
  assert.equal(q.orderIdsWithBags.has(SOLO), false);
  // A purchase being bought (claimed) is listed too, flagged once stale
  await admin.from("bag_shipments").insert({ bag_id: B_FAILS, order_id: FAILS, status: "claimed", claimed_at: new Date(Date.now() - 5 * 60_000).toISOString() });
  q = await queue.loadShipQueueBags(admin);
  assert.deepEqual([find(q, "CD-5007-G")?.shipment?.status, find(q, "CD-5007-G")?.shipment?.stale], ["claimed", true]);

  // Before the migration: nothing per bag (the page lists whole orders as before)
  mock.store.missingTables.add("bag_shipments");
  q = await queue.loadShipQueueBags(admin);
  assert.deepEqual([q.ready, q.bags.length, q.error], [false, 0, null]);
});

test("Shippo's history: a lost purchase is found by its metadata, made after its claim, never a label already saved", async () => {
  const since = "2026-11-25T15:00:00.000Z";
  const t = (min: number) => new Date(Date.parse(since) + min * 60_000).toISOString();
  const base = fakeShippo().port;
  const look = (txs: ShippoTransaction[] | Error, exclude?: Set<string>) => label.findLabelByMetadata(withHistory(base, txs), "Bag CD-1-G", since, exclude);
  const ok = await look([tx({ metadata: "Bag CD-2-G", labelUrl: "u0", objectCreated: t(2) }), tx({ metadata: "Bag CD-1-G", labelUrl: "u1", trackingNumber: "T1", objectCreated: t(1) })]);
  assert.ok(ok.kind === "found" && ok.label.labelUrl === "u1" && ok.label.trackingNumber === "T1");
  assert.equal((await look([tx({ metadata: "Bag CD-1-G", labelUrl: "u2", objectCreated: t(-1) })])).kind, "found", "within the clock slack");
  assert.equal((await look([tx({ metadata: "Bag CD-1-G", labelUrl: "u1", objectCreated: t(-30) })])).kind, "none", "older than the claim: an earlier purchase");
  assert.equal((await look([tx({ metadata: "Bag CD-1-G", labelUrl: "u1", objectCreated: t(1) })], new Set(["u1"]))).kind, "none", "already saved on a shipment");
  assert.equal((await look([tx({ metadata: "Bag CD-1-G", status: "ERROR", objectCreated: t(1) })])).kind, "none", "Shippo refused it");
  assert.equal((await look([tx({ metadata: "Bag CD-1-G", status: "WAITING", objectCreated: t(1) })])).kind, "pending");
  assert.equal((await look(new Error("down"))).kind, "unknown");
  assert.equal((await label.findLabelByMetadata(base, "Bag CD-1-G", since)).kind, "unknown", "no history reader");
  const endless: ShippoPort = { ...base, async listTransactions() { return { results: [tx({ metadata: "Other", objectCreated: t(5) })], next: true }; } };
  assert.equal((await label.findLabelByMetadata(endless, "Bag CD-1-G", since)).kind, "unknown", "history never reaches back to the claim");
});

test("pure rules: the last package, notes only grow", () => {
  const s = (status: string, shipped_at: string | null, tracking_number: string) => ({ status, shipped_at, tracking_number });
  assert.equal(types.latestSentShipment([s("shipped", "2026-11-20T10:00:00Z", "A"), s("delivered", "2026-11-22T10:00:00Z", "B"), s("purchased", null, "C")])?.tracking_number, "B");
  assert.equal(types.latestSentShipment([s("purchased", null, "C")]), null);
  assert.equal(types.appendNote(null, "a"), "a");
  assert.equal(types.appendNote("a", "b"), "a | b");
  assert.ok(types.appendNote("x".repeat(3000), "Bought but not saved: https://u").endsWith("Bought but not saved: https://u"));
  assert.equal(types.orderStatusBlock("shipped_back"), "This order is already shipped back.");
});

test("bag_shipments missing (code live before the migration): the order page's label, the syncs, auto-deliver and the ship queue work exactly as before", async () => {
  mock.store.missingTables.add("bag_shipments");
  const warnings: string[] = [];
  const realWarn = console.warn;
  const env = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, cron: process.env.CRON_SECRET };
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  try {
    // The order page's return label: bought and saved as always, no claim, a warning in the log
    const { port, calls } = fakeShippo();
    const r = await orderSvc.buyOrderReturnLabel(admin, { orderId: SOLO, body: { rateObjectId: "rate_priority_9" } }, { shippo: port, preview: false });
    assert.deepEqual([r.status, r.body], [200, { labelUrl: "https://shippo.test/label-1.pdf", trackingNumber: "9400TEST1" }]);
    assert.equal(calls.transactions.length, 1);
    const o = orderRow(SOLO);
    assert.deepEqual([o.status, o.return_label_url, o.tracking_number, o.outbound_carrier], ["shipped_back", "https://shippo.test/label-1.pdf", "9400TEST1", "USPS"]);
    assert.deepEqual(eventsOf(SOLO, "status_updated").map((e) => e.description), ["Return label purchased — marked Shipped Back. Tracking: 9400TEST1"]);
    assert.equal(sent.length, 1, "the customer's shipped email, as always");
    assert.ok(warnings.some((w) => /bag_shipments isn't in the database .*buying without the order claim, as before/.test(w)), warnings.join("\n"));
    // A failed purchase answers as always too (nothing to release)
    const bad = await orderSvc.buyOrderReturnLabel(admin, { orderId: FAILS, body: { rateObjectId: "r" } }, { shippo: fakeShippo({ fail: true }).port, preview: false });
    assert.deepEqual(bad, { status: 500, body: { error: "Label purchase failed: The address is invalid" } });

    // The admin order page's auto-deliver: no bag shipments, nothing held
    assert.equal(await svc.bagShipmentsHoldDelivery(admin, SOLO), false);
    // sync-return-tracking: no bag labels to fill, no bag orders (orders filled from return_label_url as before)
    assert.deepEqual(await svc.shipmentsMissingTracking(admin), []);
    const latest = await svc.latestShippedBags(admin, [SOLO, PAGE]);
    assert.deepEqual([latest.failed, latest.byOrder.size], [false, 0]);
    // sync-delivered, the daily route itself: orders delivered from their tracking number as before, not "failed"
    process.env.NEXT_PUBLIC_SUPABASE_URL = mock.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
    process.env.CRON_SECRET = "cron-test-secret";
    shippoHistory = [{ object_id: "tx_page", status: "SUCCESS", tracking_number: "9400PAGE", tracking_status: "DELIVERED", label_url: "https://shippo.test/order-page.pdf" }];
    const cron = await import("@/app/api/cron/sync-delivered/route");
    const res = await cron.GET(new Request("http://localhost/api/cron/sync-delivered", { headers: { authorization: "Bearer cron-test-secret" } }));
    const out = await res.json() as Row;
    assert.equal(res.status, 200, JSON.stringify(out));
    assert.equal(out.bagSyncFailed, undefined);
    assert.equal(orderRow(PAGE).status, "delivered", "delivered from its tracking number, as before");
    assert.equal(orderRow(SOLO).status, "shipped_back", "its package isn't delivered yet");
    assert.deepEqual(eventsOf(PAGE, "status_updated").map((e) => e.description), [syncDelivered.DELIVERED_EVENT]);
    assert.equal(out.packagesDelivered, 0);
    // The ship queue: nothing per bag, no error (the page lists whole orders, as before)
    const q = await queue.loadShipQueueBags(admin);
    assert.deepEqual([q.ready, q.bags.length, q.orderIdsWithBags.size, q.error], [false, 0, 0, null]);
    // Only the bag flow says it isn't set up yet
    const bag = await svc.buyBagLabel(admin, { bagId: B_FAILS, by: "gavin" }, { shippo: port, preview: false });
    assert.ok(!bag.ok && bag.status === 500 && bag.body.shipmentsReady === false && /isn't applied yet/.test(bag.body.error));
  } finally {
    console.warn = realWarn;
    for (const [k, v] of [["NEXT_PUBLIC_SUPABASE_URL", env.url], ["SUPABASE_SERVICE_ROLE_KEY", env.key], ["CRON_SECRET", env.cron]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
