/**
 * "Print labels" for any order (lib/intake/prepare-labels.ts): the pure plan,
 * then the whole flow against the in-memory Supabase stand-in
 * (tests/intake/harness/mock-supabase.mjs). Customer emails are caught at
 * fetch (Resend's API calls), so this file never shares an email box with the
 * other test files.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { nyToday } from "@/lib/intake/business-days";
import type { PlanInput, SetupCard } from "@/lib/intake/migration";
import type { BagSummary } from "@/lib/intake/types";
import type { PrepareCard, PrepareConflict, PrepareOrder } from "@/lib/intake/prepare-labels";

type Row = Record<string, unknown>;
type Mock = { url: string; store: { table(name: string): Row[]; load(seed: { tables: Record<string, Row[]> }): void }; close(): Promise<void> };

let pure: typeof import("@/lib/intake/prepare-labels");
let mock: Mock;
let admin: SupabaseClient;
const sent: { to: unknown; subject: string }[] = [];
const realFetch = globalThis.fetch;

// ── The plan (pure) ─────────────────────────────────────────────────────────

const pOrder = (over: Partial<PrepareOrder> = {}): PrepareOrder => ({ id: "o1", order_number: "CD-2549", status: "awaiting_cards", payment_status: "paid", restoration_tier: null, ...over });
const pCard = (id: string, over: Partial<PrepareCard> = {}): PrepareCard => ({ id, card_name: `Card ${id}`, tier: null, status: "active", bag_id: null, received_at: null, awaiting_arrival: false, ...over });
const bagSummary = (cardCount: number) => ({ id: "b1", code: "CD-2549-G", cardCount, tier: "premium" }) as unknown as BagSummary;

before(async () => {
  pure = await import("@/lib/intake/prepare-labels");
});

test("plan: cancelled, refunded and awaiting payment orders get no button, with the reason", () => {
  const build = (o: Partial<PrepareOrder>) => pure.buildPreparePlan({ order: pOrder(o), cards: [pCard("a")], bags: [], guesses: {}, today: "2026-11-24" }).plan;
  assert.deepEqual([build({ status: "cancelled" }).mode, build({ status: "cancelled" }).reason], ["not_allowed", "This order is cancelled."]);
  assert.deepEqual([build({ status: "delivered", payment_status: "refunded" }).mode, build({ status: "delivered", payment_status: "refunded" }).reason], ["not_allowed", "This order was refunded."]);
  assert.equal(build({ status: "awaiting_payment", payment_status: "pending" }).reason, "This order hasn't been paid yet.");
});

test("plan: Awaiting Cards receives every live card; refunded and not-arrived cards are skipped; one question per guess", () => {
  const cards = [
    pCard("a", { tier: "premium" }), pCard("b"), pCard("c"), pCard("d"),
    pCard("r", { status: "refunded" }), pCard("w", { awaiting_arrival: true }),
  ];
  const { plan, toBagIds } = pure.buildPreparePlan({
    order: pOrder(), cards, bags: [], today: "2026-11-24",
    guesses: {
      b: { tier: "expedited", confidence: "sure", source: "signed", why: "Signed at checkout: Silver." },
      c: { tier: "premium", confidence: "likely", source: "price", why: "Paid for 1 Gold and 1 Silver; matched by each card's declared value." },
      d: { tier: "premium", confidence: "likely", source: "price", why: "Paid for 1 Gold and 1 Silver; matched by each card's declared value." },
    },
  });
  assert.equal(plan.mode, "receive_first");
  assert.deepEqual(toBagIds, ["a", "b", "c", "d"]);
  assert.equal(plan.toBag, 4);
  assert.deepEqual(plan.skipped, { refunded: 1, awaitingArrival: 1 });
  assert.deepEqual(plan.tierQuestions.map((q) => [q.cardIds, q.guess, q.confidence, q.needsAnswer]), [
    [["b"], "expedited", "sure", false],
    [["c", "d"], "premium", "likely", true],
  ]);
  assert.equal(plan.needsAnswers, true);
  assert.deepEqual(plan.tierQuestions[0].choices.map((c) => c.key), ["fast_pass", "elite", "ultra_premium", "premium", "expedited", "regular", "prep"]);
  assert.equal(plan.receivedOn, "2026-11-24");
  assert.match(plan.reason ?? "", /1 card hasn't arrived yet/);
});

test("plan: nothing left to bag but bags exist -> ready; nothing at all -> not allowed", () => {
  const ready = pure.buildPreparePlan({ order: pOrder(), cards: [pCard("a", { bag_id: "b1", received_at: "2026-11-20T15:00:00Z" })], bags: [bagSummary(1)], guesses: {}, today: "2026-11-24" });
  assert.equal(ready.plan.mode, "ready");
  const none = pure.buildPreparePlan({ order: pOrder(), cards: [pCard("r", { status: "refunded" })], bags: [], guesses: {}, today: "2026-11-24" });
  assert.deepEqual([none.plan.mode, none.plan.reason], ["not_allowed", "This order has no cards to receive."]);
});

const setupCard = (id: string, over: Partial<SetupCard> = {}): SetupCard => ({
  id, created_at: "2026-11-02T15:00:00Z", tier: null, card_name: id, photo_urls: [], catalog_image_url: null, completed: false, completed_at: null,
  status: "active", card_seq: null, card_code: null, bag_id: null, received_at: null, awaiting_arrival: false, ...over,
});
const setupInput = (over: Partial<PlanInput> = {}): PlanInput => ({
  order: { id: "o1", order_number: "CD-2549", status: "in_progress", inbound_method: "self_ship", created_at: "2026-11-02T15:00:00Z", restoration_tier: null },
  cards: [setupCard("a"), setupCard("b", { tier: "premium" })],
  bags: [],
  receivedEventAt: "2026-11-05T16:00:00Z",
  finishedEventAt: null,
  holidays: new Set(),
  turnaroundMaxDays: { premium: 20, regular: 60 },
  ...over,
});

test("plan: in the shop, the received day is the order's own; cards added later stay for Receiving", () => {
  const input = setupInput({ cards: [setupCard("a"), setupCard("b", { tier: "premium" }), setupCard("late", { created_at: "2026-11-10T15:00:00Z", tier: "premium" })] });
  const { plan, toBagIds } = pure.buildPreparePlan({
    order: pOrder({ status: "in_progress" }), cards: input.cards.map((c) => pCard(c.id, { tier: c.tier })), bags: [], today: "2026-11-24", setupInput: input,
    guesses: { a: { tier: null, confidence: "unknown", source: null, why: "No tier on record." } },
  });
  assert.equal(plan.mode, "bag_in_shop");
  assert.deepEqual(toBagIds.sort(), ["a", "b"]);
  assert.deepEqual([plan.receivedOn, plan.receivedOnSource], ["2026-11-05", "event"]);
  assert.deepEqual(plan.tierQuestions.map((q) => [q.cardIds, q.guess, q.needsAnswer]), [[["a"], null, true]]);
  assert.match(plan.reason ?? "", /1 card was added after the order arrived, so it is left for Receiving/);
});

test("in-shop setup plan: a chosen day wins; with nothing on record, today is used for the new cards only", () => {
  const chosen = pure.inShopSetupPlan(setupInput({ cards: [setupCard("b", { tier: "premium" })] }), { chosenDay: "2026-11-03", now: new Date("2026-11-24T20:00:00Z") });
  assert.deepEqual([chosen.source, chosen.plan.receivedOn, chosen.plan.newBags[0].receivedOn], ["chosen", "2026-11-03", "2026-11-03"]);

  // An earlier setup bag still missing its received date keeps asking for it
  const input = setupInput({
    receivedEventAt: null,
    cards: [setupCard("old", { tier: "premium", bag_id: "bag-g" }), setupCard("new", { tier: "regular" })],
    bags: [{ id: "bag-g", tier: "premium", batch: 1, bag_code: "CD-2549-G", received_on: null, due_date: null, due_status: "missing_received_date", turnaround_days: 20, completed_at: null, source: "migration" }],
  });
  const now = new Date("2026-11-24T20:00:00Z");
  const today = pure.inShopSetupPlan(input, { now });
  assert.equal(today.source, "today");
  assert.deepEqual(today.plan.newBags.map((b) => [b.bagCode, b.receivedOn, b.dueStatus]), [["CD-2549-B", "2026-11-24", "needs_review"]]);
  assert.deepEqual(today.plan.bagFills, [], "the old bag's date isn't invented");
  assert.deepEqual(today.plan.receivedAtFills, ["new"]);
  assert.equal(today.plan.receivedAt, now.toISOString());
});

// ── End to end (in-memory Supabase) ─────────────────────────────────────────

const id = (n: number) => `00000000-0000-4000-8000-0000000a${String(n).padStart(4, "0")}`;
const O = { A: id(1), B: id(2), C: id(3), D: id(4), E: id(5), F: id(6), G: id(7) };
const order = (oid: string, number: string, status: string, over: Row = {}): Row => ({
  id: oid, order_number: number, customer_name: "Pat Collector", customer_email: "pat@example.com", customer_phone: "555", status,
  payment_status: "paid", restoration_tier: null, inbound_method: "self_ship", customer_notes: null,
  created_at: "2026-11-03T15:00:00+00:00", updated_at: "2026-11-03T15:00:00+00:00", ship_from_address: {}, ship_to_address: {},
  subtotal_cents: 0, total_cents: 0, refunded_cents: 0, slab_crack_count: 0, instagram_feature: false, gift_card_discount_cents: 0, admin_notes: null,
  ...over,
});
let cardN = 0;
const card = (orderId: string, name: string, over: Row = {}): Row => ({
  id: id(100 + ++cardN), order_id: orderId, card_name: name, card_set: null, card_year: null, card_number: null, variation: null, notes: null,
  estimated_value_cents: null, photo_urls: [], catalog_image_url: null, tier: null, status: "active", completed: false, completed_at: null,
  current_round: 1, created_at: `2026-11-03T15:00:00.0000${String(cardN).padStart(2, "0")}+00:00`, card_seq: null, card_code: null, bag_id: null,
  received_at: null, received_by: null, awaiting_arrival: false, receiving_photo_urls: [], slab_removal_selected: false, pregrade_selected: false,
  refunded_cents: 0, service_ids: [], ...over,
});
const ev = (orderId: string, type: string, description: string, at: string): Row => ({
  id: `${orderId}-${type}-${at}`, order_id: orderId, event_type: type, description, metadata: null, is_customer_visible: type === "status_updated", created_at: at,
});

const A = [card(O.A, "Golem", { estimated_value_cents: 175000 }), card(O.A, "Mew", { estimated_value_cents: 400000 }), card(O.A, "Lugia", { estimated_value_cents: 500000 })];
const B = [card(O.B, "Pikachu"), card(O.B, "Raichu"), card(O.B, "Refunded one", { status: "refunded" }), card(O.B, "Still in the mail", { awaiting_arrival: true })];
const C = [card(O.C, "Umbreon", { tier: "expedited" }), card(O.C, "Espeon", { tier: "expedited" }), card(O.C, "Sylveon", { estimated_value_cents: 20000 })];
const D = [card(O.D, "Snorlax", { tier: "regular" }), card(O.D, "Ditto", { tier: "regular" })];
const E = [card(O.E, "Onix")];
const F = [card(O.F, "Gyarados")];
const G = [card(O.G, "Blastoise Shadowless")];
const cardRow = (cid: unknown) => mock.store.table("cards").find((c) => c.id === cid)!;
const bagsOf = (oid: string) => mock.store.table("tier_bags").filter((b) => b.order_id === oid);
const eventsOf = (oid: string) => mock.store.table("order_events").filter((e) => e.order_id === oid);
const orderRow = (oid: string) => mock.store.table("orders").find((o) => o.id === oid)!;

before(async () => {
  const harness = pathToFileURL(path.resolve("tests/intake/harness/mock-supabase.mjs")).href;
  const { startMock } = (await import(harness)) as { startMock: (o: { port: number; quiet: boolean }) => Promise<Mock> };
  mock = await startMock({ port: 0, quiet: true });
  process.env.ADMIN_NOTIFY_EMAIL = "staff@example.com";
  mock.store.load({
    tables: {
      orders: [
        order(O.A, "CD-4001", "in_progress", { inbound_method: "buy_label", subtotal_cents: 41999 }),
        order(O.B, "CD-4002", "received", { restoration_tier: "premium" }),
        order(O.C, "CD-4003", "awaiting_cards"),
        order(O.D, "CD-4004", "delivered", { restoration_tier: "regular" }),
        order(O.E, "CD-4005", "cancelled", { payment_status: "refunded" }),
        order(O.F, "CD-4006", "in_progress", { restoration_tier: "premium" }),
        order(O.G, "CD-4007", "received"),
      ],
      cards: [...A, ...B, ...C, ...D, ...E, ...F, ...G],
      order_services: [{ id: id(900), order_id: O.A, service_id: "", service_name: "Platinum + Gold - Full Restoration & PSA Prep", price_cents: 41999, quantity: 1 }],
      signatures: [{
        id: id(901), order_id: O.C, type: "master_terms", document_text: "terms",
        card_snapshot: { order_number: "CD-4003", cards: [
          { card_name: "Umbreon", services: [{ name: "Silver - Full Restoration & PSA Prep", cents: 9999 }] },
          { card_name: "Espeon", services: [{ name: "Silver - Full Restoration & PSA Prep", cents: 9999 }] },
          { card_name: "Sylveon", declared_value_cents: 20000, services: [{ name: "Silver - Full Restoration & PSA Prep", cents: 9999 }] },
        ] },
      }],
      order_events: [
        ev(O.A, "checkout_initiated", "Checkout session created — mixed tiers: ultra_premium, premium", "2026-11-03T15:00:00+00:00"),
        ev(O.A, "status_updated", "Status updated to: Cards Received", "2026-11-06T16:00:00+00:00"),
        ev(O.B, "status_updated", "Status updated to: Cards Received", "2026-11-20T16:00:00+00:00"),
        ev(O.D, "status_updated", "Status updated to: Cards Received", "2026-10-01T16:00:00+00:00"),
        ev(O.D, "status_updated", "Status updated to: Delivered", "2026-10-20T16:00:00+00:00"),
        ev(O.G, "manual_order_created", "Online order created manually by admin", "2026-11-10T16:00:00+00:00"),
        ev(O.G, "status_updated", "Status updated to: Cards Received", "2026-11-12T16:00:00+00:00"),
      ],
      restoration_settings: [
        { tier: "regular", display_name: "Bronze", price_cents: 7499, turnaround_min_days: 60, turnaround_max_days: 60 },
        { tier: "expedited", display_name: "Silver", price_cents: 9999, turnaround_min_days: 30, turnaround_max_days: 45 },
        { tier: "premium", display_name: "Gold", price_cents: 11999, turnaround_min_days: 15, turnaround_max_days: 20 },
        { tier: "ultra_premium", display_name: "Platinum", price_cents: 14999, turnaround_min_days: 10, turnaround_max_days: 15 },
        { tier: "elite", display_name: "Diamond", price_cents: null, pricing_rate: 0.07, min_card_value_cents: 500000, turnaround_min_days: 5, turnaround_max_days: 10 },
      ],
      business_holidays: [{ day: "2026-11-26", name: "Thanksgiving" }, { day: "2026-12-25", name: "Christmas Day" }],
      store_config: [], tier_bags: [], tier_bag_due_changes: [], show_dropoffs: [], locations: [], card_moves: [],
    },
  });
  const resendBase = process.env.RESEND_BASE_URL ?? "https://api.resend.com";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(resendBase) || url.startsWith("https://api.resend.com")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      sent.push({ to: body.to, subject: body.subject });
      return new Response(JSON.stringify({ id: `email-${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  admin = createClient(mock.url, "service-role-test-key", { auth: { persistSession: false } });
});

after(async () => {
  globalThis.fetch = realFetch;
  await mock?.close();
});

const plan = async (oid: string) => {
  const r = await pure.loadPreparePlan(admin, oid);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.ok ? r.plan : (null as never);
};

test("in progress, old mixed checkout, no tiers: the questions come preselected; nothing is written until they're answered", async () => {
  const p = await plan(O.A);
  assert.equal(p.mode, "bag_in_shop");
  assert.equal(p.toBag, 3);
  assert.deepEqual([p.receivedOn, p.receivedOnSource], ["2026-11-06", "event"]);
  assert.deepEqual(p.tierQuestions.map((q) => [q.cardNames, q.guess, q.confidence, q.source, q.needsAnswer]), [
    [["Golem"], "premium", "likely", "price", true],
    [["Mew", "Lugia"], "ultra_premium", "likely", "price", true],
  ]);
  assert.equal(p.tierQuestions[0].why, "Paid for 2 Platinum and 1 Gold; matched by each card's declared value.");

  const r = await pure.prepareLabels(admin, { orderId: O.A, by: "gavin" });
  assert.ok(!r.ok && r.status === 409 && r.conflict);
  const conflict = (r as { conflict: PrepareConflict }).conflict;
  assert.deepEqual([conflict.needsConfirmReceive, conflict.unanswered.length, conflict.mode, conflict.error], [false, 3, "bag_in_shop", "Pick a tier for 3 cards first."]);
  assert.equal(bagsOf(O.A).length, 0);
  assert.ok(A.every((c) => cardRow(c.id).tier == null));
});

test("in progress: one tap bags every card by tier, from the order's own received day; no status change, no email, no awaiting flags", async () => {
  const tiers = { [A[0].id as string]: "premium", [A[1].id as string]: "ultra_premium", [A[2].id as string]: "ultra_premium" };
  const r = await pure.prepareLabels(admin, { orderId: O.A, tiers, by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.deepEqual(r.response.bags.map((b) => [b.code, b.tierName, b.cardCount]), [["CD-4001-P", "Platinum", 2], ["CD-4001-G", "Gold", 1]]);
  assert.deepEqual([r.response.newlyBagged, r.response.emailed, r.response.orderStatusChanged], [3, false, false]);
  assert.equal(r.response.message, "Bagged 3 cards. 2 labels to print.");

  assert.deepEqual(bagsOf(O.A).map((b) => [b.bag_code, b.source, b.received_on, b.due_status]).sort(), [
    ["CD-4001-G", "migration", "2026-11-06", "needs_review"],
    ["CD-4001-P", "migration", "2026-11-06", "needs_review"],
  ]);
  assert.deepEqual(A.map((c) => cardRow(c.id).tier), ["premium", "ultra_premium", "ultra_premium"]);
  assert.ok(A.every((c) => cardRow(c.id).received_at === "2026-11-06T16:00:00+00:00" && cardRow(c.id).awaiting_arrival === false && cardRow(c.id).card_code));
  assert.equal(orderRow(O.A).status, "in_progress");
  assert.equal(sent.length, 0);
  const logged = eventsOf(O.A).filter((e) => e.event_type !== "status_updated" && e.event_type !== "checkout_initiated");
  assert.deepEqual(logged.map((e) => [e.event_type, e.is_customer_visible]), [["tier_changed", false], ["intake_setup", false]]);
  assert.equal(logged[0].description, "Tiers filled in for labels: Platinum (2), Gold (1) by gavin");
  assert.match(String(logged[1].description), /^Bagged for labels: /);
});

test("pressing again bags nothing new and answers the same bags (no new activity)", async () => {
  const before = eventsOf(O.A).length;
  const p = await plan(O.A);
  assert.deepEqual([p.mode, p.toBag, p.tierQuestions.length], ["ready", 0, 0]);
  const r = await pure.prepareLabels(admin, { orderId: O.A, by: "gavin" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.response.bags.map((b) => b.code), ["CD-4001-P", "CD-4001-G"]);
  assert.deepEqual([r.response.newlyBagged, r.response.message], [0, "Nothing new to bag. 2 labels to print."]);
  assert.equal(eventsOf(O.A).length, before);
  assert.equal(bagsOf(O.A).length, 2);
});

test("received: refunded and not-arrived cards are left alone", async () => {
  const p = await plan(O.B);
  assert.deepEqual([p.mode, p.toBag, p.skipped, p.tierQuestions.length], ["bag_in_shop", 2, { refunded: 1, awaitingArrival: 1 }, 0]);
  const r = await pure.prepareLabels(admin, { orderId: O.B, by: "gavin" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.response.bags.map((b) => [b.code, b.cardCount]), [["CD-4002-G", 2]]);
  assert.equal(cardRow(B[2].id).bag_id ?? null, null);
  assert.equal(cardRow(B[3].id).bag_id ?? null, null);
  assert.equal(cardRow(B[3].id).awaiting_arrival, true);
  assert.equal(orderRow(O.B).status, "received");
});

test("Awaiting Cards: asks first, then receives all exactly like the Receive button (status + customer email)", async () => {
  const p = await plan(O.C);
  assert.deepEqual([p.mode, p.toBag, p.needsAnswers, p.receivedOn], ["receive_first", 3, false, nyToday()]);
  assert.deepEqual(p.tierQuestions.map((q) => [q.cardNames, q.guess, q.confidence, q.source, q.why]), [[["Sylveon"], "expedited", "sure", "signed", "Signed at checkout: Silver."]]);

  const ask = await pure.prepareLabels(admin, { orderId: O.C, by: "gavin" });
  assert.ok(!ask.ok && ask.status === 409);
  const conflict = (ask as { conflict: PrepareConflict }).conflict;
  assert.deepEqual([conflict.needsConfirmReceive, conflict.unanswered], [true, []]);
  assert.equal(orderRow(O.C).status, "awaiting_cards");

  const r = await pure.prepareLabels(admin, { orderId: O.C, confirmReceive: true, by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.deepEqual([r.response.newlyBagged, r.response.orderStatusChanged, r.response.emailed], [3, true, true]);
  assert.deepEqual(r.response.bags.map((b) => [b.code, b.cardCount]), [["CD-4003-S", 3]]);
  assert.equal(r.response.message, "Received 3 cards; the order is now Cards Received and the customer was emailed. 1 label to print.");
  assert.equal(orderRow(O.C).status, "received");
  assert.equal(cardRow(C[2].id).tier, "expedited");
  assert.deepEqual(bagsOf(O.C).map((b) => [b.source, b.received_on, b.due_status]), [["receiving", nyToday(), "calculated"]]);
  assert.deepEqual(sent.map((e) => e.subject), ["Update on your order — Cards Received", "📦 Cards Arrived — Order #CD-4003 from Pat Collector"]);
  assert.equal(eventsOf(O.C).filter((e) => e.event_type === "cards_received").length, 1);

  const again = await pure.prepareLabels(admin, { orderId: O.C, confirmReceive: true, by: "gavin" });
  assert.ok(again.ok);
  if (again.ok) assert.deepEqual([again.response.newlyBagged, again.response.emailed], [0, false]);
  assert.equal(sent.length, 2, "no second email");
});

test("delivered: bagged as finished (completed and seen), status untouched", async () => {
  const r = await pure.prepareLabels(admin, { orderId: O.D, by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  const [bag] = bagsOf(O.D);
  assert.deepEqual([bag.bag_code, bag.received_on, bag.completed_at, !!bag.completion_seen_at], ["CD-4004-B", "2026-10-01", "2026-10-20T16:00:00+00:00", true]);
  assert.equal(orderRow(O.D).status, "delivered");
});

test("cancelled: refused with the reason", async () => {
  const p = await plan(O.E);
  assert.deepEqual([p.mode, p.reason], ["not_allowed", "This order is cancelled."]);
  const r = await pure.prepareLabels(admin, { orderId: O.E, by: "gavin" });
  assert.ok(!r.ok && r.status === 409 && !("conflict" in r && r.conflict));
});

test("no received day on record: today; a chosen day can't be in the future; unknown tiers are refused", async () => {
  const p = await plan(O.F);
  assert.deepEqual([p.receivedOn, p.receivedOnSource], [nyToday(), "today"]);
  const future = await pure.prepareLabels(admin, { orderId: O.F, receivedOn: "2099-01-01", by: "gavin" });
  assert.ok(!future.ok && future.status === 400);
  const bad = await pure.prepareLabels(admin, { orderId: O.F, tiers: { [F[0].id as string]: "gold" }, by: "gavin" });
  assert.ok(!bad.ok && bad.status === 400 && bad.error === 'Unknown tier "gold".');
  const r = await pure.prepareLabels(admin, { orderId: O.F, by: "gavin" });
  assert.ok(r.ok);
  assert.deepEqual(bagsOf(O.F).map((b) => [b.bag_code, b.received_on, b.due_status]), [["CD-4006-G", nyToday(), "needs_review"]]);
});

test("a hand-made order with nothing on record: asked with no guess; the answer is saved and bagged", async () => {
  const p = await plan(O.G);
  assert.deepEqual(p.tierQuestions.map((q) => [q.guess, q.confidence, q.needsAnswer]), [[null, "unknown", true]]);
  const r = await pure.prepareLabels(admin, { orderId: O.G, tiers: { [G[0].id as string]: "prep" }, receivedOn: "2026-11-12", by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (r.ok) assert.deepEqual(r.response.bags.map((b) => [b.code, b.tierName]), [["CD-4007-R", "Prep"]]);
  assert.equal(cardRow(G[0].id).tier, "prep");
});
