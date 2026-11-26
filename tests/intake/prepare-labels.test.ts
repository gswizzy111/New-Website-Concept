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
import { addBusinessDays, nyToday } from "@/lib/intake/business-days";
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

test("in-shop setup plan: the order's own record wins; with nothing on record, today is used for the new cards only", () => {
  const own = pure.inShopSetupPlan(setupInput({ cards: [setupCard("b", { tier: "premium" })] }), { now: new Date("2026-11-24T20:00:00Z") });
  assert.deepEqual([own.source, own.plan.receivedOn, own.plan.newBags[0].receivedOn], ["event", "2026-11-05", "2026-11-05"]);

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

const setupBag = (id: string, tier: string, code: string, receivedOn: string | null) => ({
  id, tier, batch: 1, bag_code: code, received_on: receivedOn, due_date: null, due_status: receivedOn ? "needs_review" : "missing_received_date",
  turnaround_days: 20, completed_at: null, source: "migration",
});

test("nothing on record: day 1's 'today' never becomes a recorded day; a card created after the first bags is left for Receiving", () => {
  const day1 = pure.inShopSetupPlan(
    setupInput({ receivedEventAt: null, cards: [setupCard("a", { tier: "premium" }), setupCard("b", { tier: "expedited" })] }),
    { now: new Date("2026-11-24T20:00:00Z") },
  );
  assert.equal(day1.source, "today");
  assert.deepEqual(day1.plan.newBags.map((b) => [b.bagCode, b.receivedOn]), [["CD-2549-G", "2026-11-24"], ["CD-2549-S", "2026-11-24"]]);

  // Day 2: day 1's bags exist (made 2026-11-24 20:00); an older dateless setup bag too. Card c (created long
  // ago, never bagged) turns up; card d was created after the first bags (an add-cards checkout: maybe still in the mail).
  const firstBag = "2026-11-24T20:00:00.000Z";
  const input = setupInput({
    receivedEventAt: null,
    bags: [setupBag("g", "premium", "CD-2549-G", "2026-11-24"), setupBag("s", "expedited", "CD-2549-S", "2026-11-24"), setupBag("b", "regular", "CD-2549-B", null)],
    cards: [
      setupCard("a", { tier: "premium", bag_id: "g", received_at: "2026-11-24T20:00:00Z", card_seq: 1, card_code: "CD-2549-01" }),
      setupCard("b", { tier: "expedited", bag_id: "s", received_at: "2026-11-24T20:00:00Z", card_seq: 2, card_code: "CD-2549-02" }),
      setupCard("old", { tier: "regular", bag_id: "b", card_seq: 3, card_code: "CD-2549-03" }),
      setupCard("c", { tier: "ultra_premium" }),
      setupCard("d", { tier: "premium", created_at: "2026-11-25T10:00:00Z" }),
    ],
  });
  const day2 = pure.inShopSetupPlan(input, { now: new Date("2026-11-25T20:00:00Z"), firstBagAt: firstBag });
  assert.equal(day2.source, "today", "day 1's bag day is not taken as the order's record");
  assert.deepEqual(day2.late, ["d"]);
  assert.deepEqual(day2.plan.links.map((l) => l.cardId), ["c"]);
  assert.deepEqual(day2.plan.newBags.map((b) => [b.bagCode, b.receivedOn]), [["CD-2549-P", "2026-11-25"]]);
  assert.deepEqual(day2.plan.bagFills, [], "the old dateless bag isn't given day 1 (or day 2)");

  // The GET's plan says the same
  const bags = [{ id: "g", createdAt: firstBag, cardCount: 1 }, { id: "s", createdAt: firstBag, cardCount: 1 }, { id: "b", createdAt: "2026-11-01T12:00:00.000Z", cardCount: 1 }] as unknown as BagSummary[];
  const built = pure.buildPreparePlan({
    order: pOrder({ status: "in_progress" }), cards: input.cards.map((c) => pCard(c.id, { tier: c.tier, bag_id: c.bag_id, received_at: c.received_at })),
    bags: [{ ...bags[2], createdAt: firstBag }, bags[0], bags[1]] as BagSummary[], today: "2026-11-25", now: new Date("2026-11-25T20:00:00Z"), setupInput: input, guesses: {},
  });
  assert.deepEqual([built.plan.mode, built.toBagIds, built.plan.receivedOn, built.plan.receivedOnSource], ["bag_in_shop", ["c"], "2026-11-25", "today"]);
  assert.match(built.plan.reason ?? "", /1 card was added after the order arrived/);
});

test("received by the 'Cards Received' event: a card created later that same day is left for Receiving (to the second)", () => {
  const input = setupInput({
    cards: [setupCard("before", { tier: "premium", created_at: "2026-11-05T15:00:00Z" }), setupCard("after", { tier: "premium", created_at: "2026-11-05T18:00:00Z" })],
  });
  const r = pure.inShopSetupPlan(input, { now: new Date("2026-11-24T20:00:00Z") });
  assert.deepEqual([r.source, r.late, r.plan.links.map((l) => l.cardId)], ["event", ["after"], ["before"]]);
  // A finished order's later cards were worked and shipped: bagged
  const done = pure.inShopSetupPlan({ ...input, order: { ...input.order, status: "delivered" } }, { now: new Date("2026-11-24T20:00:00Z") });
  assert.deepEqual([done.late, done.plan.links.map((l) => l.cardId).sort()], [[], ["after", "before"]]);
  // A drop-off's cards are typed in with the order (up to an hour after it was entered)
  const drop = setupInput({
    receivedEventAt: null,
    dropoffAt: "2026-11-01T18:00:00Z",
    order: { id: "o1", order_number: "CD-2549", status: "received", inbound_method: "dropoff", created_at: "2026-11-03T15:00:00Z", restoration_tier: null },
    cards: [setupCard("typed", { tier: "premium", created_at: "2026-11-03T15:00:05Z" }), setupCard("weekLater", { tier: "premium", created_at: "2026-11-10T15:00:00Z" })],
  });
  const d = pure.inShopSetupPlan(drop, { now: new Date("2026-11-24T20:00:00Z") });
  assert.deepEqual([d.source, d.late, d.plan.links.map((l) => l.cardId)], ["dropoff", ["weekLater"], ["typed"]]);
});

// ── End to end (in-memory Supabase) ─────────────────────────────────────────

const id = (n: number) => `00000000-0000-4000-8000-0000000a${String(n).padStart(4, "0")}`;
const O = { A: id(1), B: id(2), C: id(3), D: id(4), E: id(5), F: id(6), G: id(7), H: id(8) };
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
const H = [card(O.H, "Psyduck", { tier: "prep" }), card(O.H, "Slowpoke", { tier: "prep" })];
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
        order(O.H, "CD-4008", "awaiting_cards", { payment_status: "pending" }),
      ],
      cards: [...A, ...B, ...C, ...D, ...E, ...F, ...G, ...H],
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
  // The order's tier (Gold) is written onto the bagged cards; the others keep none
  assert.deepEqual([B[0], B[1], B[2], B[3]].map((c) => cardRow(c.id).tier ?? null), ["premium", "premium", null, null]);
  assert.equal(orderRow(O.B).restoration_tier, "premium");
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
  assert.match(r.response.message, /^Received 3 cards; the order is now Cards Received and the customer was emailed\. 1 label to print\. Put in shelf: DUE [A-Z]{3} [A-Z]{3} \d{1,2}\.$/);
  // The receive route's shelf slot too (shelvesFor): one per due date, made here
  const due = bagsOf(O.C)[0]?.due_date as string;
  assert.deepEqual(r.response.shelves.map((x) => [x.bagCode, x.dueDate, x.location?.code]), [["CD-4003-S", due, `LOC-SHELF-${due.replaceAll("-", "")}`]]);
  assert.equal(mock.store.table("locations").filter((l) => l.kind === "shelf" && l.due_date === due).length, 1);
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

test("no received day on record: today; unknown tiers are refused", async () => {
  const p = await plan(O.F);
  assert.deepEqual([p.receivedOn, p.receivedOnSource], [nyToday(), "today"]);
  const bad = await pure.prepareLabels(admin, { orderId: O.F, tiers: { [F[0].id as string]: "gold" }, by: "gavin" });
  assert.ok(!bad.ok && bad.status === 400 && bad.error === 'Unknown tier "gold".');
  const r = await pure.prepareLabels(admin, { orderId: O.F, by: "gavin" });
  assert.ok(r.ok);
  assert.deepEqual(bagsOf(O.F).map((b) => [b.bag_code, b.received_on, b.due_status]), [["CD-4006-G", nyToday(), "needs_review"]]);
});

test("a hand-made order with nothing on record: asked with no guess; the answer is saved and bagged", async () => {
  const p = await plan(O.G);
  assert.deepEqual(p.tierQuestions.map((q) => [q.guess, q.confidence, q.needsAnswer]), [[null, "unknown", true]]);
  // Received 2026-11-12 (its 'Cards Received' event): the bag's day
  const r = await pure.prepareLabels(admin, { orderId: O.G, tiers: { [G[0].id as string]: "prep" }, by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (r.ok) assert.deepEqual(r.response.bags.map((b) => [b.code, b.tierName]), [["CD-4007-R", "Prep"]]);
  assert.equal(cardRow(G[0].id).tier, "prep");
});

test("Awaiting Cards, not paid: refused like the Receive button until staff confirm (allowUnpaid); then received and noted", async () => {
  const p = await plan(O.H);
  assert.deepEqual([p.mode, p.payment, p.toBag], ["receive_first", "unpaid", 2]);
  const ask = await pure.prepareLabels(admin, { orderId: O.H, confirmReceive: true, by: "gavin" });
  assert.ok(!ask.ok && ask.status === 409);
  const conflict = (ask as { conflict: PrepareConflict }).conflict;
  assert.deepEqual([conflict.needsAllowUnpaid, conflict.unpaid, conflict.needsConfirmReceive, conflict.error],
    [true, true, false, "This order hasn't been paid. Confirm to receive anyway."]);
  assert.deepEqual([orderRow(O.H).status, bagsOf(O.H).length], ["awaiting_cards", 0], "nothing written");

  const r = await pure.prepareLabels(admin, { orderId: O.H, confirmReceive: true, allowUnpaid: true, by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (r.ok) assert.deepEqual([r.response.newlyBagged, r.response.orderStatusChanged, r.response.shelves], [2, true, []], "a Prep bag has no due date, so no shelf");
  assert.equal(orderRow(O.H).status, "received");
  assert.equal(eventsOf(O.H).filter((e) => e.event_type === "received_unpaid").length, 1);
  // No Prep turnaround yet: the bag has no due date (the label prints a dash)
  assert.deepEqual(bagsOf(O.H).map((b) => [b.bag_code, b.due_date, b.due_status]), [["CD-4008-R", null, "needs_review"]]);
});

test("a bag saved without a due date gets one once its tier has a turnaround (Prep), logged once; manual bags and repeats untouched", async () => {
  // Before the setting: nothing to date
  assert.equal((await plan(O.G)).dueDatesToFill, 0);
  const none = await pure.prepareLabels(admin, { orderId: O.G, by: "gavin" });
  assert.ok(none.ok);
  if (none.ok) assert.deepEqual(none.response.dueDatesFilled, []);
  assert.equal(bagsOf(O.G)[0].due_date, null);

  // A dateless bag set by hand (made up: manual bags always have a date) is never touched
  mock.store.table("tier_bags").push({
    id: id(950), order_id: O.H, tier: "prep", batch: 2, bag_code: "CD-4008-R2", received_on: "2026-11-20", due_date: null, due_status: "manual",
    turnaround_days: null, due_note: "kept", completed_at: null, completion_seen_at: null, label_printed_at: null, source: "receiving",
    created_at: "2026-11-20T17:00:00.000Z", created_by: "gavin", location_id: null, located_at: null,
  });
  mock.store.table("store_config").push({ key: "prep_turnaround_max_days", value: "10" });
  const holidays = new Set(["2026-11-26", "2026-12-25"]);

  // Historical Setup bag (CD-4007-R, received 2026-11-12): dated, still for review
  const g = await plan(O.G);
  assert.deepEqual([g.mode, g.dueDatesToFill], ["ready", 1]);
  const r = await pure.prepareLabels(admin, { orderId: O.G, by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  const gDue = addBusinessDays("2026-11-12", 10, holidays);
  if (r.ok) {
    assert.deepEqual(r.response.dueDatesFilled, [{ bagCode: "CD-4007-R", dueDate: gDue }]);
    assert.match(r.response.message, /Due date set for CD-4007-R \(\w{3} \d{1,2}\)\./);
  }
  const [gBag] = bagsOf(O.G);
  assert.deepEqual([gBag.due_date, gBag.due_status, gBag.turnaround_days], [gDue, "needs_review", 10]);
  const changes = () => mock.store.table("tier_bag_due_changes");
  assert.deepEqual(changes().filter((c) => c.bag_id === gBag.id).map((c) => [c.old_due, c.new_due, c.changed_by]), [[null, gDue, "gavin"]]);

  // Receiving bag (CD-4008-R, received today): calculated; the manual one stays dateless
  assert.equal((await plan(O.H)).dueDatesToFill, 1);
  const h = await pure.prepareLabels(admin, { orderId: O.H, by: "gavin" });
  assert.ok(h.ok, h.ok ? "" : h.error);
  const hBags = Object.fromEntries(bagsOf(O.H).map((b) => [b.bag_code, [b.due_date, b.due_status]]));
  assert.deepEqual(hBags, { "CD-4008-R": [addBusinessDays(nyToday(), 10, holidays), "calculated"], "CD-4008-R2": [null, "manual"] });

  // Again: nothing to date, no second log line
  const before = changes().length;
  const again = await pure.prepareLabels(admin, { orderId: O.G, by: "gavin" });
  assert.ok(again.ok);
  if (again.ok) assert.deepEqual(again.response.dueDatesFilled, []);
  assert.equal((await plan(O.G)).dueDatesToFill, 0);
  assert.equal(changes().length, before);
});

test("tiers are written only once the receipt can go ahead: a refused Awaiting Cards receipt changes nothing", async () => {
  // 501 cards, no tier anywhere: the Receive button takes at most 500 at a time
  const big = id(9);
  mock.store.table("orders").push(order(big, "CD-4009", "awaiting_cards"));
  const bigCards = Array.from({ length: 501 }, (_, i) => card(big, `Bulk ${i + 1}`));
  for (const c of bigCards) mock.store.table("cards").push(c);
  const p = await plan(big);
  assert.deepEqual([p.mode, p.toBag, p.needsAnswers], ["receive_first", 501, true]);
  const eventsBefore = eventsOf(big).length;
  const r = await pure.prepareLabels(admin, {
    orderId: big, confirmReceive: true, by: "gavin",
    tiers: Object.fromEntries(bigCards.map((c) => [c.id as string, "regular"])),
  });
  assert.ok(!r.ok && r.status === 400, r.ok ? "went ahead" : r.error);
  if (!r.ok) assert.match(r.error, /at most 500 cards.*Nothing was changed\./);
  assert.equal(bigCards.filter((c) => cardRow(c.id).tier != null).length, 0, "no tier written");
  assert.deepEqual([orderRow(big).status, bagsOf(big).length, eventsOf(big).length], ["awaiting_cards", 0, eventsBefore]);
});


// ── Cards added after the order arrived (owner, Nov 26: "it wont let me print") ──

test("plan: cards added after the order arrived never block the bags there are: ready, with the cards listed to ask about", () => {
  const input = setupInput({
    order: { id: "o1", order_number: "CD-2549", status: "in_progress", inbound_method: "self_ship", created_at: "2026-11-02T15:00:00Z", restoration_tier: null },
    bags: [setupBag("g", "premium", "CD-2549-G", "2026-11-05")],
    cards: [
      setupCard("a", { tier: "premium", bag_id: "g", received_at: "2026-11-05T16:00:00Z", card_seq: 1, card_code: "CD-2549-01" }),
      setupCard("late1", { tier: "premium", created_at: "2026-11-20T15:00:00Z", photo_urls: ["https://x.test/late1.jpg"] }),
      setupCard("late2", { created_at: "2026-11-20T15:00:01Z", card_seq: 3, card_code: "CD-2549-03", catalog_image_url: "https://x.test/cat.png" }),
      setupCard("refunded", { tier: "premium", created_at: "2026-11-20T15:00:02Z", status: "refunded" }),
      setupCard("onTheWay", { tier: "premium", created_at: "2026-11-20T15:00:03Z", awaiting_arrival: true }),
    ],
  });
  const { plan, toBagIds } = pure.buildPreparePlan({
    order: pOrder({ status: "in_progress" }),
    cards: input.cards.map((c) => pCard(c.id, { card_name: c.card_name ?? null, tier: c.tier, bag_id: c.bag_id, received_at: c.received_at, status: c.status, awaiting_arrival: c.awaiting_arrival })),
    bags: [{ id: "g", code: "CD-2549-G", tier: "premium", cardCount: 1, createdAt: "2026-11-24T20:00:00.000Z" } as unknown as BagSummary],
    today: "2026-11-26", setupInput: input,
    guesses: { late2: { tier: "expedited", confidence: "likely", source: "price", why: "Paid for 1 Silver." } },
  });
  assert.deepEqual([plan.mode, plan.toBag, toBagIds], ["ready", 0, []], "the Gold bag prints; nothing is refused");
  assert.deepEqual(plan.addedLater.map((c) => [c.id, c.name, c.code, c.tier, c.tierName, c.photo]), [
    ["late1", "late1", null, "premium", "Gold", "https://x.test/late1.jpg"],
    ["late2", "late2", "CD-2549-03", null, null, "https://x.test/cat.png"],
  ], "refunded and awaiting-arrival cards are never listed");
  assert.deepEqual(plan.addedLaterQuestions.map((q) => [q.cardIds, q.guess, q.needsAnswer]), [[["late2"], "expedited", true]]);
  assert.deepEqual([plan.tierQuestions, plan.needsAnswers], [[], false], "the added-later question never blocks a plain print");
  assert.match(plan.reason ?? "", /^2 cards were added after the order arrived, so they are left for Receiving\./);
});

test("plan: an order whose only cards were added after it arrived (no bag yet) is ready to ask, not refused", () => {
  const input = setupInput({
    order: { id: "o1", order_number: "CD-2549", status: "received", inbound_method: "buy_label", created_at: "2026-11-04T02:38:07Z", restoration_tier: null },
    receivedEventAt: "2026-11-12T01:18:58Z",
    cards: [
      setupCard("x", { tier: "ultra_premium", created_at: "2026-11-12T01:19:09Z" }),
      setupCard("y", { tier: "regular", created_at: "2026-11-26T20:03:55Z" }),
      setupCard("z", { tier: "regular", created_at: "2026-11-26T20:04:35Z" }),
    ],
  });
  const { plan } = pure.buildPreparePlan({
    order: pOrder({ status: "received" }), cards: input.cards.map((c) => pCard(c.id, { tier: c.tier })), bags: [], today: "2026-11-26", setupInput: input, guesses: {},
  });
  assert.deepEqual([plan.mode, plan.toBag, plan.addedLater.map((c) => c.id), plan.bags.length], ["ready", 0, ["x", "y", "z"], 0]);
  assert.equal(plan.reason, "3 cards were added after the order arrived, so they are left for Receiving.");
});

test("addedLaterDays: join the open bag of the order's arrival day; otherwise Receiving's own day (arrival day while nothing is received, else today)", () => {
  const cards = [
    { id: "old", tier: "premium", status: "active", received_at: "2026-11-05T16:00:00Z" },
    { id: "g", tier: "premium", status: "active", received_at: null },
    { id: "s", tier: "expedited", status: "active", received_at: null },
    { id: "o", tier: null, status: "active", received_at: null },
  ];
  const bags = [
    { tier: "premium", received_on: "2026-11-05", completed_at: null },
    { tier: "expedited", received_on: "2026-11-05", completed_at: "2026-11-20T15:00:00Z" },
  ];
  const days = (over: Partial<Parameters<typeof pure.addedLaterDays>[0]>) =>
    Object.fromEntries(pure.addedLaterDays({ cardIds: ["g", "s", "o"], cards, bags, orderTier: null, orderDay: "2026-11-05", today: "2026-11-26", ...over }));
  // Gold joins the open Gold bag of Nov 5; the Silver bag of Nov 5 is finished: a card is received today (next batch);
  // a card with no tier anywhere is left out (its tier is filled first)
  assert.deepEqual(days({}), { "2026-11-05": ["g"], "2026-11-26": ["s"] });
  assert.deepEqual(days({ orderTier: "regular" }), { "2026-11-05": ["g"], "2026-11-26": ["s", "o"] });
  // Nothing received yet (no bags): Receiving's default, the order's arrival day
  assert.deepEqual(days({ cards: cards.filter((c) => c.id !== "old"), bags: [] }), { "2026-11-05": ["g", "s"] });
  // Nothing on record: today
  assert.deepEqual(days({ orderDay: null }), { "2026-11-26": ["g", "s"] });
  // A day still to come is no arrival day
  assert.deepEqual(days({ orderDay: "2026-12-01" }), { "2026-11-26": ["g", "s"] });
});

test("added later, in the shop: 'Not yet' prints the bags there are and changes nothing; 'Yes' receives the ticked cards into their tier bags (no status change, no email)", async () => {
  const oid = id(10);
  mock.store.table("orders").push(order(oid, "CD-4010", "in_progress"));
  mock.store.table("order_events").push(ev(oid, "status_updated", "Status updated to: Cards Received", "2026-11-06T16:00:00+00:00"));
  const orig = [card(oid, "Original Gold 1", { tier: "premium" }), card(oid, "Original Gold 2", { tier: "premium" })];
  for (const c of orig) mock.store.table("cards").push(c);
  const first = await pure.prepareLabels(admin, { orderId: oid, by: "gavin" });
  assert.ok(first.ok, first.ok ? "" : first.error);
  assert.deepEqual(bagsOf(oid).map((b) => [b.bag_code, b.received_on]), [["CD-4010-G", "2026-11-06"]]);

  // Then 3 cards added on the order page / an add-cards checkout (plus a refunded and a not-arrived one)
  const late = [
    card(oid, "Late Gold", { tier: "premium", created_at: "2026-11-20T15:00:01+00:00", photo_urls: ["https://x.test/g.jpg"] }),
    card(oid, "Late Silver", { tier: "expedited", created_at: "2026-11-20T15:00:02+00:00" }),
    card(oid, "Late Untiered", { created_at: "2026-11-20T15:00:03+00:00" }),
  ];
  const refundedLate = card(oid, "Late Refunded", { tier: "premium", status: "refunded", created_at: "2026-11-20T15:00:04+00:00" });
  const awaitingLate = card(oid, "Late On The Way", { tier: "premium", awaiting_arrival: true, created_at: "2026-11-20T15:00:05+00:00" });
  for (const c of [...late, refundedLate, awaitingLate]) mock.store.table("cards").push(c);
  const lateIds = late.map((c) => c.id as string);

  const p = await plan(oid);
  assert.deepEqual([p.mode, p.toBag, p.bags.map((b) => [b.code, b.cardCount])], ["ready", 0, [["CD-4010-G", 2]]]);
  assert.deepEqual(p.addedLater.map((c) => [c.name, c.tier]), [["Late Gold", "premium"], ["Late Silver", "expedited"], ["Late Untiered", null]]);
  assert.deepEqual(p.addedLaterQuestions.map((q) => [q.cardNames, q.needsAnswer]), [[["Late Untiered"], true]]);

  // "Not yet, just print": the existing bag prints, the cards stay for Receiving, nothing is written
  const eventsBefore = eventsOf(oid).length;
  const sentBefore = sent.length;
  const notYet = await pure.prepareLabels(admin, { orderId: oid, by: "gavin" });
  assert.ok(notYet.ok, notYet.ok ? "" : notYet.error);
  if (notYet.ok) {
    assert.deepEqual(notYet.response.bags.map((b) => [b.code, b.cardCount]), [["CD-4010-G", 2]]);
    assert.deepEqual([notYet.response.newlyBagged, notYet.response.addedLaterReceived, notYet.response.addedLaterLeft], [0, 0, 3]);
    assert.equal(notYet.response.message, "Nothing new to bag. 3 cards added after the order arrived are left for Receiving. 1 label to print.");
  }
  assert.ok([...late, refundedLate].every((c) => (cardRow(c.id).bag_id ?? null) === null && (cardRow(c.id).received_at ?? null) === null && !cardRow(c.id).awaiting_arrival));
  assert.equal(eventsOf(oid).length, eventsBefore);

  // "Yes" without the untiered card's tier: asked (409, the plan + unanswered), nothing written
  const bogus = "00000000-0000-4000-8000-00000000dead";
  const include = [...lateIds, refundedLate.id as string, awaitingLate.id as string, bogus];
  const ask = await pure.prepareLabels(admin, { orderId: oid, includeAddedLater: include, by: "gavin" });
  assert.ok(!ask.ok && ask.status === 409);
  const conflict = (ask as { conflict: PrepareConflict }).conflict;
  assert.deepEqual([conflict.unanswered, conflict.error, conflict.addedLater.length], [[late[2].id], "Pick a tier for 1 card first.", 3]);
  assert.equal(eventsOf(oid).length, eventsBefore);
  assert.equal(cardRow(late[2].id).tier ?? null, null);

  // "Yes, add them and print": Gold joins CD-4010-G (the order's arrival day, still open); Silver and Bronze
  // go where Receiving puts them now that the order's cards are in: a new bag received today
  const yes = await pure.prepareLabels(admin, { orderId: oid, includeAddedLater: include, tiers: { [late[2].id as string]: "regular" }, by: "gavin" });
  assert.ok(yes.ok, yes.ok ? "" : yes.error);
  const today = nyToday();
  if (yes.ok) {
    assert.deepEqual(yes.response.bags.map((b) => [b.code, b.cardCount]), [["CD-4010-G", 3], ["CD-4010-S", 1], ["CD-4010-B", 1]], "every bag prints, the Gold bag with its new card");
    assert.deepEqual([yes.response.newlyBagged, yes.response.addedLaterReceived, yes.response.addedLaterLeft, yes.response.emailed, yes.response.orderStatusChanged], [3, 3, 0, false, false]);
    assert.match(yes.response.message, /^Added 3 cards that came after the order arrived: Gold bag CD-4010-G \(\+1\), Silver bag CD-4010-S \(\+1\), Bronze bag CD-4010-B \(\+1\)\. 3 labels to print\./);
    assert.deepEqual(yes.response.shelves.map((x) => x.bagCode), ["CD-4010-S", "CD-4010-B"], "only the new bags go to a shelf");
  }
  const bag = (code: string) => bagsOf(oid).find((b) => b.bag_code === code)!;
  assert.deepEqual(["CD-4010-G", "CD-4010-S", "CD-4010-B"].map((c) => [bag(c).source, bag(c).received_on, bag(c).batch]), [
    ["migration", "2026-11-06", 1], ["receiving", today, 1], ["receiving", today, 1],
  ]);
  assert.deepEqual(late.map((c) => cardRow(c.id).bag_id), [bag("CD-4010-G").id, bag("CD-4010-S").id, bag("CD-4010-B").id]);
  assert.ok(late.every((c) => cardRow(c.id).received_at && cardRow(c.id).received_by === "gavin" && cardRow(c.id).awaiting_arrival === false));
  assert.deepEqual(late.map((c) => cardRow(c.id).card_code), ["CD-4010-03", "CD-4010-04", "CD-4010-05"], "Card IDs as usual");
  assert.equal(cardRow(late[2].id).tier, "regular");
  // Refunded and not-arrived cards are never included; nobody is flagged as on the way
  assert.deepEqual([cardRow(refundedLate.id).bag_id ?? null, cardRow(awaitingLate.id).bag_id ?? null, cardRow(awaitingLate.id).awaiting_arrival], [null, null, true]);
  assert.equal(orderRow(oid).status, "in_progress");
  assert.equal(sent.length, sentBefore, "no email");
  assert.deepEqual(eventsOf(oid).slice(eventsBefore).map((e) => [e.event_type, e.is_customer_visible]), [
    ["tier_changed", false], ["cards_received", false], ["cards_received", false],
  ]);

  // Again (a double tap): nothing new, the same bags
  const again = await pure.prepareLabels(admin, { orderId: oid, includeAddedLater: include, tiers: { [late[2].id as string]: "regular" }, by: "gavin" });
  assert.ok(again.ok);
  if (again.ok) assert.deepEqual([again.response.newlyBagged, again.response.addedLaterLeft, again.response.bags.map((b) => b.cardCount)], [0, 0, [3, 1, 1]]);
  assert.equal(eventsOf(oid).length, eventsBefore + 3);
  assert.deepEqual((await plan(oid)).addedLater, []);
});

test("added later, some ticked: the unticked card stays for Receiving (not flagged), the ticked one joins its bag", async () => {
  const oid = id(11);
  mock.store.table("orders").push(order(oid, "CD-4011", "received", { restoration_tier: "premium" }));
  mock.store.table("order_events").push(ev(oid, "status_updated", "Status updated to: Cards Received", "2026-11-06T16:00:00+00:00"));
  mock.store.table("cards").push(card(oid, "Here from the start"));
  assert.ok((await pure.prepareLabels(admin, { orderId: oid, by: "gavin" })).ok);
  const [here, notHere] = [card(oid, "Came later, here", { created_at: "2026-11-21T15:00:01+00:00" }), card(oid, "Came later, not here", { created_at: "2026-11-21T15:00:02+00:00" })];
  mock.store.table("cards").push(here, notHere);
  const r = await pure.prepareLabels(admin, { orderId: oid, includeAddedLater: [here.id as string], by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (r.ok) {
    assert.deepEqual([r.response.bags.map((b) => [b.code, b.cardCount]), r.response.addedLaterReceived, r.response.addedLaterLeft], [[["CD-4011-G", 2]], 1, 1]);
    assert.match(r.response.message, /Gold bag CD-4011-G \(\+1\)\. 1 card added after the order arrived is left for Receiving\. 1 label to print\./);
  }
  assert.equal(cardRow(here.id).tier, "premium", "the order's tier is written onto it, as on the other bagged cards");
  assert.deepEqual([cardRow(notHere.id).bag_id ?? null, cardRow(notHere.id).received_at ?? null, cardRow(notHere.id).awaiting_arrival], [null, null, false]);
  assert.deepEqual((await plan(oid)).addedLater.map((c) => c.id), [notHere.id]);
});

test("added later, no bag yet (CD-2370's case: every card typed in after Cards Received): 'Not yet' prints nothing and says so; 'Yes' bags them on the arrival day", async () => {
  const oid = id(12);
  mock.store.table("orders").push(order(oid, "CD-4012", "received", { inbound_method: "buy_label" }));
  mock.store.table("order_events").push(ev(oid, "status_updated", "Status updated to: Cards Received", "2026-11-12T01:18:58+00:00"));
  const cs = [
    card(oid, "Placeholder for 3 cards", { tier: "ultra_premium", created_at: "2026-11-12T01:19:09+00:00" }),
    card(oid, "Holo jam", { tier: "regular", created_at: "2026-11-20T20:03:55+00:00" }),
    card(oid, "Skybox", { tier: "regular", created_at: "2026-11-20T20:04:35+00:00" }),
  ];
  for (const c of cs) mock.store.table("cards").push(c);
  const p = await plan(oid);
  assert.deepEqual([p.mode, p.toBag, p.addedLater.length, p.reason], ["ready", 0, 3, "3 cards were added after the order arrived, so they are left for Receiving."]);

  const notYet = await pure.prepareLabels(admin, { orderId: oid, by: "gavin" });
  assert.ok(notYet.ok, notYet.ok ? "" : notYet.error);
  if (notYet.ok) {
    assert.deepEqual([notYet.response.bags, notYet.response.addedLaterLeft], [[], 3]);
    assert.equal(notYet.response.message, "Nothing new to bag. 3 cards added after the order arrived are left for Receiving. No labels to print.");
  }
  assert.equal(bagsOf(oid).length, 0);

  const yes = await pure.prepareLabels(admin, { orderId: oid, includeAddedLater: cs.map((c) => c.id as string), by: "gavin" });
  assert.ok(yes.ok, yes.ok ? "" : yes.error);
  if (yes.ok) assert.deepEqual(yes.response.bags.map((b) => [b.code, b.cardCount]), [["CD-4012-P", 1], ["CD-4012-B", 2]]);
  // Nothing of the order was received yet: Receiving's default day, the order's arrival (Nov 11 in New York)
  const holidays = new Set(["2026-11-26", "2026-12-25"]);
  assert.deepEqual(bagsOf(oid).map((b) => [b.bag_code, b.source, b.received_on, b.due_date, b.due_status]).sort(), [
    ["CD-4012-B", "receiving", "2026-11-11", addBusinessDays("2026-11-11", 60, holidays), "calculated"],
    ["CD-4012-P", "receiving", "2026-11-11", addBusinessDays("2026-11-11", 15, holidays), "calculated"],
  ]);
  assert.deepEqual(cs.map((c) => cardRow(c.id).card_code), ["CD-4012-01", "CD-4012-02", "CD-4012-03"]);
  assert.equal(orderRow(oid).status, "received");
});
