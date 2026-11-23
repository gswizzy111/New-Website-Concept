/**
 * Historical Order Setup (lib/intake/migration.ts): plan -> apply -> plan
 * again must be a no-op, with an in-memory store that enforces the same
 * unique keys as the database (card_code, (order_id, card_seq), bag_code,
 * (order_id, tier, batch)) and the same "fill only when empty" guards.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cardCode, nextCardSeqs } from "@/lib/intake/codes";
import { bagCompletionPatch } from "@/lib/intake/stage-plan";
import {
  applyOrderSetup,
  planOrderSetup,
  totalsFor,
  FINISHED_EVENT_PREFIXES,
  RECEIVED_EVENT,
  type NewBagRow,
  type PlanInput,
  type SetupBag,
  type SetupCard,
  type SetupOrder,
  type SetupStore,
} from "@/lib/intake/migration";

type Card = SetupCard & { order_id: string };
type Bag = SetupBag & { order_id: string; completion_seen_at: string | null; created_by: string | null };
type Event = { order_id: string; event_type: string; description: string; created_at: string; metadata?: unknown };

const HOLIDAYS = new Set(["2026-11-26"]);
const TURNAROUND: Record<string, number> = { regular: 60, expedited: 45, premium: 20, ultra_premium: 15, elite: 10, fast_pass: 7 };

class FakeDb implements SetupStore {
  orders = new Map<string, SetupOrder>();
  cards = new Map<string, Card>();
  bags: Bag[] = [];
  events: Event[] = [];
  /** Show drop-off form time by order id. */
  dropoffs = new Map<string, string>();
  private nextId = 1;

  id(prefix: string) {
    return `${prefix}-${String(this.nextId++).padStart(4, "0")}`;
  }

  addOrder(o: Partial<SetupOrder> & { order_number: string }): SetupOrder {
    const order: SetupOrder = {
      id: this.id("order"),
      status: "in_progress",
      inbound_method: "self_ship",
      created_at: "2026-11-01T15:00:00Z",
      restoration_tier: null,
      ...o,
    };
    this.orders.set(order.id, order);
    return order;
  }

  addCard(orderId: string, c: Partial<Card> = {}): Card {
    const card: Card = {
      id: this.id("card"),
      order_id: orderId,
      created_at: "2026-11-01T15:00:00.000000Z",
      tier: null,
      card_name: "Card",
      photo_urls: ["https://example.test/a.jpg"],
      receiving_photo_urls: [],
      catalog_image_url: null,
      completed: false,
      completed_at: null,
      status: "active",
      card_seq: null,
      card_code: null,
      bag_id: null,
      received_at: null,
      awaiting_arrival: false,
      ...c,
    };
    this.cards.set(card.id, card);
    return card;
  }

  event(orderId: string, description: string, at: string) {
    this.events.push({ order_id: orderId, event_type: "status_updated", description, created_at: at });
  }

  input(orderId: string): PlanInput {
    const order = this.orders.get(orderId)!;
    const firstAt = (match: (d: string) => boolean) =>
      this.events.filter((e) => e.order_id === orderId && e.event_type === "status_updated" && match(e.description))
        .map((e) => e.created_at).sort()[0] ?? null;
    return {
      order: { ...order },
      cards: [...this.cards.values()].filter((c) => c.order_id === orderId).map((c) => ({ ...c })),
      bags: this.bags.filter((b) => b.order_id === orderId).map((b) => ({ ...b })),
      receivedEventAt: firstAt((d) => d === RECEIVED_EVENT),
      finishedEventAt: firstAt((d) => FINISHED_EVENT_PREFIXES.some((p) => d.startsWith(p))),
      dropoffAt: this.dropoffs.get(orderId) ?? null,
      holidays: HOLIDAYS,
      turnaroundMaxDays: TURNAROUND,
    };
  }

  plan(orderId: string) {
    return planOrderSetup(this.input(orderId));
  }

  async setUp(orderId: string) {
    return applyOrderSetup(this.plan(orderId), this, "tester", new Date("2026-11-23T17:00:00Z"));
  }

  orderCards(orderId: string) {
    return [...this.cards.values()].filter((c) => c.order_id === orderId);
  }

  // ── SetupStore ──
  async ensureCardCodes(orderId: string) {
    const order = this.orders.get(orderId)!;
    const cards = this.orderCards(orderId);
    let n = 0;
    for (const { id, seq } of nextCardSeqs(cards)) {
      const code = cardCode(order.order_number!, seq);
      if ([...this.cards.values()].some((c) => c.card_code === code)) throw new Error(`duplicate card_code ${code}`);
      const c = this.cards.get(id)!;
      if (c.card_seq == null) { Object.assign(c, { card_seq: seq, card_code: code }); n++; }
    }
    for (const c of cards) if (c.card_seq != null && !c.card_code) { c.card_code = cardCode(order.order_number!, c.card_seq); n++; }
    return n;
  }

  async createBag(row: NewBagRow) {
    const same = this.bags.find((b) => b.order_id === row.order_id && b.tier === row.tier && b.batch === row.batch);
    if (same) return { id: same.id, created: false };
    if (this.bags.some((b) => b.bag_code === row.bag_code)) throw new Error(`duplicate bag_code ${row.bag_code}`);
    const bag: Bag = { id: this.id("bag"), ...row };
    this.bags.push(bag);
    return { id: bag.id, created: true };
  }

  async linkCards(bagId: string, cardIds: string[]) {
    let n = 0;
    for (const id of cardIds) {
      const c = this.cards.get(id);
      if (c && !c.bag_id) { c.bag_id = bagId; n++; }
    }
    return n;
  }

  async fillReceivedAt(cardIds: string[], at: string) {
    let n = 0;
    for (const id of cardIds) {
      const c = this.cards.get(id);
      if (c && !c.received_at) { c.received_at = at; n++; }
    }
    return n;
  }

  async fillBag(fill: Parameters<SetupStore["fillBag"]>[0], seenAt: string) {
    const b = this.bags.find((x) => x.id === fill.bagId)!;
    // As the real store: the date and its due date in one guarded update
    const dueFree = !b.due_date && (b.due_status === "missing_received_date" || b.due_status === "pending");
    if (fill.receivedOn && !b.received_on && (!fill.dueStatus || dueFree)) {
      b.received_on = fill.receivedOn;
      if (fill.dueStatus) {
        b.due_date = fill.dueDate ?? null;
        b.due_status = fill.dueStatus;
        b.turnaround_days = fill.turnaroundDays ?? null;
      }
    }
    if (fill.completedAt && !b.completed_at) {
      b.completed_at = fill.completedAt;
      b.completion_seen_at = seenAt;
    }
  }

  /** As lib/intake/stages.ts refreshBagCompletion (the same bagCompletionPatch rule). */
  async refreshBagCompletion(bagIds: string[]) {
    for (const id of bagIds) {
      const b = this.bags.find((x) => x.id === id)!;
      const cards = [...this.cards.values()].filter((c) => c.bag_id === id);
      const patch = bagCompletionPatch(b, cards, "2026-11-23T17:00:00Z", this.orders.get(b.order_id)?.status ?? null);
      if (patch) Object.assign(b, patch);
    }
  }

  async logSetup(orderId: string, description: string, metadata: Record<string, unknown>) {
    this.events.push({ order_id: orderId, event_type: "intake_setup", description, created_at: "2026-11-23T17:00:00Z", metadata });
  }
}

function snapshot(db: FakeDb) {
  return JSON.stringify({ cards: [...db.cards.values()], bags: db.bags, events: db.events, orders: [...db.orders.values()] });
}

test("multi-tier order: Card IDs, one bag per tier, business-day due dates for review", async () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-2549", restoration_tier: "ultra_premium" });
  const c1 = db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000001Z" });
  const c2 = db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000002Z", tier: "premium" });
  const c3 = db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000003Z" });
  // Received Sun Nov 15, 2026 (10:00 New York)
  db.event(o.id, RECEIVED_EVENT, "2026-11-15T15:00:00Z");

  const plan = db.plan(o.id);
  assert.equal(plan.eligible, true);
  assert.equal(plan.receivedOn, "2026-11-15");
  assert.equal(plan.receivedSource, "event");
  assert.deepEqual(plan.cardCodes.map((p) => p.code), ["CD-2549-01", "CD-2549-02", "CD-2549-03"]);
  assert.deepEqual(plan.newBags.map((b) => b.bagCode).sort(), ["CD-2549-G", "CD-2549-P"]);
  const p = plan.newBags.find((b) => b.tier === "ultra_premium")!;
  assert.deepEqual(p.cardIds, [c1.id, c3.id]);
  assert.equal(p.dueDate, "2026-12-07");
  assert.equal(p.dueStatus, "needs_review");
  assert.equal(p.turnaroundDays, 15);
  assert.equal(plan.newBags.find((b) => b.tier === "premium")!.dueDate, "2026-12-14");
  assert.equal(plan.cardsToUpdate, 3);
  assert.equal(plan.alreadySetUp, false);

  const result = await db.setUp(o.id);
  assert.deepEqual(result.bagsCreated.sort(), ["CD-2549-G", "CD-2549-P"]);
  assert.equal(result.cardsLinked, 3);
  assert.equal(result.receivedAtSet, 3);
  assert.equal(db.cards.get(c2.id)!.bag_id, db.bags.find((b) => b.bag_code === "CD-2549-G")!.id);
  assert.equal(db.cards.get(c1.id)!.received_at, "2026-11-15T15:00:00Z");
  assert.equal(db.bags.every((b) => b.source === "migration" && b.batch === 1 && b.created_by === "tester"), true);
  assert.equal(db.events.filter((e) => e.event_type === "intake_setup").length, 1);

  // Plan again: nothing to do; apply again: nothing changes
  const again = db.plan(o.id);
  assert.equal(again.alreadySetUp, true);
  assert.equal(again.cardsToUpdate, 0);
  assert.equal(again.bagsToCreate, 0);
  const before = snapshot(db);
  const second = await db.setUp(o.id);
  assert.deepEqual(second, { cardCodes: 0, bagsCreated: [], cardsLinked: 0, receivedAtSet: 0, bagsFilled: 0 });
  assert.equal(snapshot(db), before);
});

test("two orders: separate codes and bags, totals add up, second run is a no-op", async () => {
  const db = new FakeDb();
  const a = db.addOrder({ order_number: "CD-1001", restoration_tier: "premium" });
  const b = db.addOrder({ order_number: "CD-1002", restoration_tier: "premium", inbound_method: "dropoff", created_at: "2026-11-20T23:30:00Z" });
  db.addCard(a.id);
  db.addCard(a.id);
  db.addCard(b.id);
  db.event(a.id, RECEIVED_EVENT, "2026-11-10T14:00:00Z");

  const plans = [db.plan(a.id), db.plan(b.id)];
  const totals = totalsFor(plans);
  assert.equal(totals.ordersToChange, 2);
  assert.equal(totals.cardsToUpdate, 3);
  assert.equal(totals.bagsToCreate, 2);
  // Drop-off: the order's creation day in New York (Nov 20, 6:30 PM)
  assert.equal(plans[1].receivedOn, "2026-11-20");
  assert.equal(plans[1].receivedSource, "dropoff");

  await db.setUp(a.id);
  await db.setUp(b.id);
  assert.deepEqual(db.bags.map((x) => x.bag_code).sort(), ["CD-1001-G", "CD-1002-G"]);
  assert.deepEqual([...db.cards.values()].map((c) => c.card_code).sort(), ["CD-1001-01", "CD-1001-02", "CD-1002-01"]);

  const before = snapshot(db);
  await db.setUp(a.id);
  await db.setUp(b.id);
  assert.equal(snapshot(db), before);
  assert.equal(totalsFor([db.plan(a.id), db.plan(b.id)]).alreadySetUp, 2);
});

test("missing tier: the card gets its Card ID but no bag, and is listed", async () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-2000", restoration_tier: null });
  const tiered = db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000001Z", tier: "expedited" });
  const untiered = db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000002Z", card_name: "No Tier Card" });
  db.event(o.id, RECEIVED_EVENT, "2026-11-02T15:00:00Z");

  const plan = db.plan(o.id);
  assert.deepEqual(plan.missingTiers.map((r) => [r.code, r.name]), [["CD-2000-02", "No Tier Card"]]);
  assert.equal(plan.newBags.length, 1);
  await db.setUp(o.id);
  assert.equal(db.cards.get(untiered.id)!.card_code, "CD-2000-02");
  assert.equal(db.cards.get(untiered.id)!.bag_id, null);
  assert.ok(db.cards.get(tiered.id)!.bag_id);

  const again = db.plan(o.id);
  assert.equal(again.alreadySetUp, true);
  assert.equal(again.missingTiers.length, 1);

  // Once a tier is set, the next run bags the card (new bag for that tier)
  db.cards.get(untiered.id)!.tier = "premium";
  const fixed = db.plan(o.id);
  assert.deepEqual(fixed.newBags.map((b) => b.bagCode), ["CD-2000-G"]);
  await db.setUp(o.id);
  assert.equal(db.plan(o.id).alreadySetUp, true);
  assert.equal(db.bags.length, 2);
});

test("missing received date: never invented; filled once a real date exists", async () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-3000", restoration_tier: "ultra_premium", inbound_method: "buy_label" });
  const c = db.addCard(o.id);

  const plan = db.plan(o.id);
  assert.equal(plan.receivedOn, null);
  assert.equal(plan.missingReceivedDate, true);
  assert.equal(plan.newBags[0].dueDate, null);
  assert.equal(plan.newBags[0].dueStatus, "missing_received_date");
  assert.deepEqual(plan.receivedAtFills, []);
  await db.setUp(o.id);
  assert.equal(db.cards.get(c.id)!.received_at, null);
  assert.equal(db.bags[0].received_on, null);

  const again = db.plan(o.id);
  assert.equal(again.alreadySetUp, true);
  assert.equal(again.missingReceivedDate, true);
  assert.equal(totalsFor([again]).missingReceivedDates, 1);

  // A received event shows up later: the bag gets the date and a due date
  db.event(o.id, RECEIVED_EVENT, "2026-11-15T15:00:00Z");
  const later = db.plan(o.id);
  assert.equal(later.alreadySetUp, false);
  assert.equal(later.bagFills[0].receivedOn, "2026-11-15");
  assert.equal(later.bagFills[0].dueDate, "2026-12-07");
  await db.setUp(o.id);
  assert.equal(db.bags[0].received_on, "2026-11-15");
  assert.equal(db.bags[0].due_date, "2026-12-07");
  assert.equal(db.bags[0].due_status, "needs_review");
  assert.equal(db.plan(o.id).alreadySetUp, true);
});

test("an employee's received date and due date are never overwritten", async () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-3100", restoration_tier: "premium" });
  db.addCard(o.id);
  await db.setUp(o.id);
  Object.assign(db.bags[0], { received_on: "2026-11-03", due_date: "2026-12-30", due_status: "manual" });
  db.event(o.id, RECEIVED_EVENT, "2026-11-15T15:00:00Z");
  const plan = db.plan(o.id);
  assert.deepEqual(plan.bagFills, []);
  await db.setUp(o.id);
  assert.equal(db.bags[0].received_on, "2026-11-03");
  assert.equal(db.bags[0].due_date, "2026-12-30");
  assert.equal(db.bags[0].due_status, "manual");
});

test("finished orders stay finished: bags created completed, cards and status untouched", async () => {
  const db = new FakeDb();
  // Delivered before cards were ticked done
  const d = db.addOrder({ order_number: "CD-4000", status: "delivered", restoration_tier: "regular" });
  db.addCard(d.id);
  db.addCard(d.id);
  db.event(d.id, RECEIVED_EVENT, "2026-06-01T15:00:00Z");
  db.event(d.id, "Status updated to: Completed", "2026-08-01T15:00:00Z");
  db.event(d.id, "Marked Delivered", "2026-08-05T15:00:00Z");
  // Completed, every card ticked
  const c = db.addOrder({ order_number: "CD-4001", status: "completed", restoration_tier: "premium" });
  db.addCard(c.id, { completed: true, completed_at: "2026-09-01T12:00:00Z" });
  db.addCard(c.id, { completed: true, completed_at: "2026-09-03T12:00:00Z" });
  db.event(c.id, RECEIVED_EVENT, "2026-08-01T15:00:00Z");
  db.event(c.id, "Status updated to: Completed", "2026-09-04T15:00:00Z");
  const cardsBefore = JSON.stringify([...db.cards.values()].map(({ completed, completed_at, status }) => ({ completed, completed_at, status })));

  await db.setUp(d.id);
  await db.setUp(c.id);
  const dBag = db.bags.find((b) => b.order_id === d.id)!;
  const cBag = db.bags.find((b) => b.order_id === c.id)!;
  assert.equal(dBag.completed_at, "2026-08-01T15:00:00Z");
  assert.equal(cBag.completed_at, "2026-09-03T12:00:00Z");
  // Historical completions don't raise the "bag completed" alert
  assert.ok(dBag.completion_seen_at && cBag.completion_seen_at);
  assert.equal(db.orders.get(d.id)!.status, "delivered");
  assert.equal(db.orders.get(c.id)!.status, "completed");
  assert.equal(JSON.stringify([...db.cards.values()].map(({ completed, completed_at, status }) => ({ completed, completed_at, status }))), cardsBefore);
  assert.equal(db.events.filter((e) => e.event_type === "stage_update").length, 0);
  assert.equal(db.plan(d.id).alreadySetUp, true);
  assert.equal(db.plan(c.id).alreadySetUp, true);
});

test("refunded cards: no bag, no flags, and they never hold a bag open", async () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-5000", status: "in_progress", restoration_tier: "premium" });
  const done = db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000001Z", completed: true, completed_at: "2026-11-20T12:00:00Z" });
  const refunded = db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000002Z", status: "refunded", photo_urls: [] });
  db.event(o.id, RECEIVED_EVENT, "2026-11-02T15:00:00Z");

  const plan = db.plan(o.id);
  assert.equal(plan.missingImages.length, 0);
  assert.deepEqual(plan.newBags[0].cardIds, [done.id]);
  assert.equal(plan.newBags[0].completedAt, "2026-11-20T12:00:00Z");
  await db.setUp(o.id);
  assert.equal(db.cards.get(refunded.id)!.bag_id, null);
  assert.equal(db.cards.get(refunded.id)!.card_code, "CD-5000-02");
  assert.equal(db.bags[0].completed_at, "2026-11-20T12:00:00Z");

  // A refunded card already in an existing (receiving) bag doesn't hold it open either
  const o2 = db.addOrder({ order_number: "CD-5001", status: "in_progress", restoration_tier: "premium" });
  db.event(o2.id, RECEIVED_EVENT, "2026-11-02T15:00:00Z");
  const bag = await db.createBag({
    order_id: o2.id, tier: "premium", batch: 1, bag_code: "CD-5001-G", received_on: "2026-11-02", due_date: "2026-12-01",
    due_status: "calculated", turnaround_days: 20, completed_at: null, completion_seen_at: null, source: "migration", created_by: null,
  });
  db.addCard(o2.id, { status: "refunded", bag_id: bag.id, card_seq: 1, card_code: "CD-5001-01", received_at: "2026-11-02T15:00:00Z" });
  db.addCard(o2.id, { completed: true, completed_at: "2026-11-21T12:00:00Z", card_seq: 2, card_code: "CD-5001-02", received_at: "2026-11-02T15:00:00Z" });
  const p2 = db.plan(o2.id);
  assert.equal(p2.newBags.length, 0);
  assert.equal(p2.links.length, 1);
  await db.setUp(o2.id);
  assert.equal(db.bags.find((b) => b.id === bag.id)!.completed_at, "2026-11-21T12:00:00Z");
  assert.equal(db.plan(o2.id).alreadySetUp, true);
});

test("Receiving's work is left alone: codes, bags and awaiting cards", async () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-6000", status: "received", restoration_tier: "premium" });
  db.event(o.id, RECEIVED_EVENT, "2026-11-23T15:00:00Z");
  const bag = await db.createBag({
    order_id: o.id, tier: "premium", batch: 1, bag_code: "CD-6000-G", received_on: "2026-11-23", due_date: "2026-12-22",
    due_status: "calculated", turnaround_days: 20, completed_at: null, completion_seen_at: null, source: "migration", created_by: "staff",
  });
  db.bags[0].source = "receiving";
  db.addCard(o.id, { card_seq: 1, card_code: "CD-6000-01", bag_id: bag.id, received_at: "2026-11-23T15:00:00Z" });
  const awaiting = db.addCard(o.id, { card_seq: 2, card_code: "CD-6000-02", awaiting_arrival: true, photo_urls: [] });

  const plan = db.plan(o.id);
  assert.equal(plan.alreadySetUp, true);
  assert.equal(plan.missingImages.length, 0);
  const before = snapshot(db);
  await db.setUp(o.id);
  assert.equal(snapshot(db), before);
  assert.equal(db.cards.get(awaiting.id)!.awaiting_arrival, true);
  assert.equal(db.cards.get(awaiting.id)!.bag_id, null);
});

test("not eligible: awaiting cards, cancelled, no cards", () => {
  const db = new FakeDb();
  const awaiting = db.addOrder({ order_number: "CD-7000", status: "awaiting_cards" });
  db.addCard(awaiting.id);
  const cancelled = db.addOrder({ order_number: "CD-7001", status: "cancelled" });
  db.addCard(cancelled.id);
  const empty = db.addOrder({ order_number: "CD-7002", status: "received" });
  const plans = [db.plan(awaiting.id), db.plan(cancelled.id), db.plan(empty.id)];
  assert.deepEqual(plans.map((p) => p.eligible), [false, false, false]);
  assert.match(plans[0].ineligibleReason ?? "", /Receiving/);
  assert.equal(totalsFor(plans).notEligible, 3);
});

test("two runs at once: the second finds the first one's bag and makes no duplicate", async () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-8000", restoration_tier: "elite" });
  db.addCard(o.id);
  db.addCard(o.id);
  db.event(o.id, RECEIVED_EVENT, "2026-11-02T15:00:00Z");
  const first = db.plan(o.id);
  const second = db.plan(o.id);
  await applyOrderSetup(first, db, "a");
  const events = db.events.length;
  const r = await applyOrderSetup(second, db, "b");
  assert.deepEqual(r, { cardCodes: 0, bagsCreated: [], cardsLinked: 0, receivedAtSet: 0, bagsFilled: 0 });
  assert.equal(db.events.length, events);
  assert.deepEqual(r.bagsCreated, []);
  assert.equal(r.cardsLinked, 0);
  assert.equal(db.bags.length, 1);
  assert.equal(new Set([...db.cards.values()].map((c) => c.card_code)).size, 2);
  assert.equal(db.plan(o.id).alreadySetUp, true);
});

test("missing images: no customer photo or receiving photo (a catalog picture is only a reference)", () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-9000", restoration_tier: "premium" });
  db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000001Z", photo_urls: [], card_name: "Bare" });
  db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000002Z", photo_urls: [], catalog_image_url: "https://assets.tcgdex.net/x.png" });
  db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000003Z", photo_urls: null, receiving_photo_urls: ["https://example.test/r.jpg"] });
  const plan = db.plan(o.id);
  // The bare card and the catalog-only one; the card with a receiving photo is fine
  assert.deepEqual(plan.missingImages.map((r) => r.code), ["CD-9000-01", "CD-9000-02"]);
  assert.equal(plan.missingImages[0].name, "Bare");
});

test("a received day staff entered on a setup bag counts for the order's later bags (a card bagged after a tier fix)", async () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-9930", status: "in_progress", restoration_tier: null });
  const gold = db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000001Z", tier: "premium" });
  const noTier = db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000002Z", tier: null });
  await db.setUp(o.id);
  assert.equal(db.bags.length, 1);
  assert.equal(db.bags[0].due_status, "missing_received_date");
  assert.equal(db.plan(o.id).missingTiers.length, 1);
  // Staff enter the day on the Gold bag (setBagReceivedOn), then fix the other card's tier
  Object.assign(db.bags[0], { received_on: "2026-11-02", due_date: "2026-12-01", due_status: "needs_review" });
  db.cards.get(gold.id)!.received_at = "2026-11-02T17:00:00.000Z";
  db.cards.get(noTier.id)!.tier = "ultra_premium";
  const plan = db.plan(o.id);
  assert.equal(plan.receivedSource, "entered");
  assert.equal(plan.receivedOn, "2026-11-02");
  assert.equal(plan.missingReceivedDate, false);
  assert.deepEqual(plan.newBags.map((b) => [b.bagCode, b.receivedOn, b.dueStatus]), [["CD-9930-P", "2026-11-02", "needs_review"]]);
  assert.deepEqual(plan.receivedAtFills, [noTier.id], "the newly bagged card gets that day too");
  await db.setUp(o.id);
  assert.equal(db.cards.get(noTier.id)!.received_at, "2026-11-02T17:00:00.000Z");
  assert.equal(db.plan(o.id).alreadySetUp, true);
});

test("Bag IDs never clash: two unknown tiers get U and U2; a Receiving bag of the same tier keeps its batch", async () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-9100", restoration_tier: null });
  db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000001Z", tier: "mystery" });
  db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000002Z", tier: "other" });
  db.event(o.id, RECEIVED_EVENT, "2026-11-02T15:00:00Z");
  const plan = db.plan(o.id);
  assert.deepEqual(plan.newBags.map((b) => b.bagCode).sort(), ["CD-9100-U", "CD-9100-U2"]);
  await db.setUp(o.id);
  assert.equal(db.plan(o.id).alreadySetUp, true);

  // Receiving made CD-9200-P on another day; a historical Platinum card gets batch 2
  const r = db.addOrder({ order_number: "CD-9200", restoration_tier: "ultra_premium", status: "in_progress" });
  db.event(r.id, RECEIVED_EVENT, "2026-11-02T15:00:00Z");
  const bag = await db.createBag({
    order_id: r.id, tier: "ultra_premium", batch: 1, bag_code: "CD-9200-P", received_on: "2026-11-20", due_date: "2026-12-11",
    due_status: "calculated", turnaround_days: 15, completed_at: null, completion_seen_at: null, source: "migration", created_by: "staff",
  });
  db.bags.find((b) => b.id === bag.id)!.source = "receiving";
  db.addCard(r.id, { card_seq: 1, card_code: "CD-9200-01", bag_id: bag.id, received_at: "2026-11-20T15:00:00Z" });
  db.addCard(r.id, { created_at: "2026-11-01T15:00:00.000009Z" });
  const p2 = db.plan(r.id);
  assert.deepEqual(p2.cardCodes.map((c) => c.code), ["CD-9200-02"]);
  assert.deepEqual(p2.newBags.map((b) => [b.bagCode, b.receivedOn]), [["CD-9200-P2", "2026-11-02"]]);
  await db.setUp(r.id);
  assert.equal(db.bags.find((b) => b.id === bag.id)!.received_on, "2026-11-20");
  assert.equal(db.plan(r.id).alreadySetUp, true);
});

test("prep (no turnaround setting): due date left for review, never guessed", () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-9300", restoration_tier: "prep_standard" });
  db.addCard(o.id);
  db.event(o.id, RECEIVED_EVENT, "2026-11-02T15:00:00Z");
  const [bag] = db.plan(o.id).newBags;
  assert.equal(bag.tier, "prep");
  assert.equal(bag.bagCode, "CD-9300-R");
  assert.equal(bag.dueDate, null);
  assert.equal(bag.dueStatus, "needs_review");
});

test("finished order with no completion record: flagged, bag left open", () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-9400", status: "shipped_back", restoration_tier: "premium" });
  db.addCard(o.id);
  db.event(o.id, RECEIVED_EVENT, "2026-06-02T15:00:00Z");
  const plan = db.plan(o.id);
  assert.equal(plan.newBags[0].completedAt, null);
  assert.equal(plan.finishedDateUnknown, true);
  // "Shipped Back — Tracking: ..." counts as the finishing event
  db.event(o.id, "Status updated to: Shipped Back — Tracking: 1Z999", "2026-07-01T15:00:00Z");
  assert.equal(db.plan(o.id).newBags[0].completedAt, "2026-07-01T15:00:00Z");
});

test("bag completion heal never reopens a finished historical order's bag", () => {
  const open = [{ completed: false, completed_at: null, status: "active" }];
  const now = "2026-11-23T17:00:00Z";
  const done = { completed_at: "2026-08-01T15:00:00Z" };
  // Setup bag of a delivered order whose cards were never ticked: stays completed
  assert.equal(bagCompletionPatch({ ...done, source: "migration" }, open, now, "delivered"), null);
  // A Receiving bag, or a Setup bag of an open order, reopens as before
  assert.deepEqual(bagCompletionPatch({ ...done, source: "receiving" }, open, now, "delivered"), { completed_at: null, completion_seen_at: null });
  assert.deepEqual(bagCompletionPatch({ ...done, source: "migration" }, open, now, "in_progress"), { completed_at: null, completion_seen_at: null });
  assert.deepEqual(bagCompletionPatch(done, open, now), { completed_at: null, completion_seen_at: null });
});

test("a bought return label finishes an order (its first finishing event dates the bag)", async () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-9500", status: "delivered", restoration_tier: "premium" });
  db.addCard(o.id);
  db.event(o.id, RECEIVED_EVENT, "2026-05-01T15:00:00Z");
  db.event(o.id, "Return label purchased — marked Shipped Back. Tracking: 9400TEST", "2026-06-10T15:00:00Z");
  db.event(o.id, "Marked Delivered — confirmed via Shippo transaction tracking.", "2026-06-14T15:00:00Z");
  const plan = db.plan(o.id);
  assert.equal(plan.finishedDateUnknown, false);
  assert.equal(plan.newBags[0].completedAt, "2026-06-10T15:00:00Z");
  await db.setUp(o.id);
  assert.equal(db.bags[0].completed_at, "2026-06-10T15:00:00Z");
  assert.equal(db.cards.get([...db.cards.keys()][0])!.completed, false);
});

test("a card added on a later day gets no invented received time; an open order's is left for Receiving", async () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-9600", status: "in_progress", restoration_tier: "premium" });
  const first = db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000001Z" });
  // Added by staff the same New York day it was received (11:30 PM): counted as received
  const sameDay = db.addCard(o.id, { created_at: "2026-11-03T04:30:00Z" });
  // Added a week later (an add-cards checkout, say): it may not be here
  const later = db.addCard(o.id, { created_at: "2026-11-09T15:00:00Z", card_name: "Late" });
  db.event(o.id, RECEIVED_EVENT, "2026-11-02T15:00:00Z");
  const plan = db.plan(o.id);
  assert.deepEqual(plan.receivedAtFills.sort(), [first.id, sameDay.id].sort());
  assert.deepEqual(plan.newBags[0].cardIds, [first.id, sameDay.id]);
  assert.deepEqual(plan.addedLater.map((r) => [r.code, r.name]), [["CD-9600-03", "Late"]]);
  assert.equal(totalsFor([plan]).addedLater, 1);
  await db.setUp(o.id);
  assert.equal(db.cards.get(later.id)!.received_at, null);
  assert.equal(db.cards.get(later.id)!.bag_id, null);
  assert.equal(db.cards.get(later.id)!.card_code, "CD-9600-03");
  assert.equal(db.cards.get(later.id)!.awaiting_arrival, false);
  assert.equal(db.cards.get(first.id)!.received_at, "2026-11-02T15:00:00Z");
  assert.equal(db.plan(o.id).alreadySetUp, true);

  // A finished order's later card was worked and shipped: bagged, still no received time
  const f = db.addOrder({ order_number: "CD-9601", status: "delivered", restoration_tier: "premium" });
  db.addCard(f.id, { created_at: "2026-11-01T15:00:00.000001Z" });
  const fLate = db.addCard(f.id, { created_at: "2026-11-09T15:00:00Z" });
  db.event(f.id, RECEIVED_EVENT, "2026-11-02T15:00:00Z");
  db.event(f.id, "Status updated to: Completed", "2026-11-20T15:00:00Z");
  const fp = db.plan(f.id);
  assert.deepEqual(fp.addedLater, []);
  assert.equal(fp.newBags[0].cardIds.length, 2);
  await db.setUp(f.id);
  assert.ok(db.cards.get(fLate.id)!.bag_id);
  assert.equal(db.cards.get(fLate.id)!.received_at, null);
  assert.equal(db.plan(f.id).alreadySetUp, true);
});

test("show drop-off entered days later: received on the show day, its cards get that time", async () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-9700", status: "received", inbound_method: "dropoff", restoration_tier: "elite", created_at: "2026-11-18T16:00:00Z" });
  const c = db.addCard(o.id, { created_at: "2026-11-18T16:00:00.200000Z" });
  db.dropoffs.set(o.id, "2026-11-14T19:00:00Z");
  const plan = db.plan(o.id);
  assert.equal(plan.receivedSource, "dropoff");
  assert.equal(plan.receivedOn, "2026-11-14");
  assert.deepEqual(plan.receivedAtFills, [c.id]);
  await db.setUp(o.id);
  assert.equal(db.cards.get(c.id)!.received_at, "2026-11-14T19:00:00Z");
  assert.equal(db.bags[0].received_on, "2026-11-14");
  // Without a show form: the order's own creation
  const plain = db.addOrder({ order_number: "CD-9701", status: "received", inbound_method: "dropoff", restoration_tier: "elite", created_at: "2026-11-18T16:00:00Z" });
  db.addCard(plain.id, { created_at: "2026-11-18T16:00:00.200000Z" });
  assert.equal(db.plan(plain.id).receivedOn, "2026-11-18");
});

test("a Receiving bag of a finished order is never forced completed by the setup", async () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-9800", status: "completed", restoration_tier: "premium" });
  db.event(o.id, RECEIVED_EVENT, "2026-11-02T15:00:00Z");
  db.event(o.id, "Status updated to: Completed", "2026-11-20T15:00:00Z");
  const bag = await db.createBag({
    order_id: o.id, tier: "premium", batch: 1, bag_code: "CD-9800-G", received_on: "2026-11-02", due_date: "2026-12-01",
    due_status: "calculated", turnaround_days: 20, completed_at: null, completion_seen_at: null, source: "migration", created_by: "staff",
  });
  db.bags[0].source = "receiving";
  db.addCard(o.id, { card_seq: 1, card_code: "CD-9800-01", bag_id: bag.id, received_at: "2026-11-02T15:00:00Z" });
  const loose = db.addCard(o.id, { card_seq: 2, card_code: "CD-9800-02" });
  const plan = db.plan(o.id);
  assert.deepEqual(plan.links.map((l) => [l.cardId, l.bagId]), [[loose.id, bag.id]]);
  assert.equal(plan.bagFills.some((f) => f.completedAt), false);
  await db.setUp(o.id);
  // Its cards aren't done, so the live rule keeps it open
  assert.equal(db.bags[0].completed_at, null);
  assert.equal(db.cards.get(loose.id)!.bag_id, bag.id);
  assert.equal(db.plan(o.id).alreadySetUp, true);
});

test("a partly set-up order (run cut off) gets the rest, nothing doubled", async () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-9900", status: "in_progress", restoration_tier: "premium" });
  const a = db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000001Z", tier: "ultra_premium" });
  const b = db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000002Z" });
  db.event(o.id, RECEIVED_EVENT, "2026-11-15T15:00:00Z");
  // The first run stopped after the Card IDs and the Gold bag
  const cut = db.plan(o.id);
  await db.ensureCardCodes(o.id);
  const gold = cut.newBags.find((x) => x.tier === "premium")!;
  await db.createBag({
    order_id: o.id, tier: gold.tier, batch: gold.batch, bag_code: gold.bagCode, received_on: gold.receivedOn, due_date: gold.dueDate,
    due_status: gold.dueStatus, turnaround_days: gold.turnaroundDays, completed_at: null, completion_seen_at: null, source: "migration", created_by: "tester",
  });

  const rest = db.plan(o.id);
  assert.deepEqual(rest.cardCodes, []);
  assert.deepEqual(rest.newBags.map((x) => x.bagCode), ["CD-9900-P"]);
  assert.deepEqual(rest.links.map((l) => [l.cardId, l.bagCode]).sort(), [[a.id, "CD-9900-P"], [b.id, "CD-9900-G"]].sort());
  const r = await db.setUp(o.id);
  assert.deepEqual(r.bagsCreated, ["CD-9900-P"]);
  assert.equal(r.cardsLinked, 2);
  assert.deepEqual(db.bags.map((x) => x.bag_code).sort(), ["CD-9900-G", "CD-9900-P"]);
  assert.deepEqual([...db.cards.values()].map((c) => c.card_code).sort(), ["CD-9900-01", "CD-9900-02"]);
  assert.equal(db.plan(o.id).alreadySetUp, true);
});

test("two runs at the same moment (interleaved): one bag, one set of codes, card fields filled once", async () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-9910", restoration_tier: "premium" });
  db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000001Z" });
  db.addCard(o.id, { created_at: "2026-11-01T15:00:00.000002Z", tier: "expedited" });
  db.event(o.id, RECEIVED_EVENT, "2026-11-02T15:00:00Z");
  const [p1, p2] = [db.plan(o.id), db.plan(o.id)];
  const [r1, r2] = await Promise.all([applyOrderSetup(p1, db, "a"), applyOrderSetup(p2, db, "b")]);
  assert.equal(db.bags.length, 2);
  assert.equal(new Set(db.bags.map((x) => x.bag_code)).size, 2);
  assert.equal(r1.bagsCreated.length + r2.bagsCreated.length, 2);
  assert.equal(r1.cardsLinked + r2.cardsLinked, 2);
  assert.equal(r1.receivedAtSet + r2.receivedAtSet, 2);
  assert.deepEqual([...db.cards.values()].map((c) => c.card_code).sort(), ["CD-9910-01", "CD-9910-02"]);
  assert.equal(db.plan(o.id).alreadySetUp, true);
});

test("missing received date is fixable by hand: the employee's date is kept and the flag clears", async () => {
  const db = new FakeDb();
  const o = db.addOrder({ order_number: "CD-9920", status: "completed", restoration_tier: "premium" });
  db.addCard(o.id, { completed: true, completed_at: "2026-10-01T12:00:00Z" });
  await db.setUp(o.id);
  assert.equal(db.bags[0].due_status, "missing_received_date");
  assert.equal(db.bags[0].completed_at, "2026-10-01T12:00:00Z");
  assert.equal(db.plan(o.id).missingReceivedDate, true);
  // Entered on the bag (setBagReceivedOn): due date worked out for review
  Object.assign(db.bags[0], { received_on: "2026-09-01", due_date: "2026-09-29", due_status: "needs_review" });
  db.event(o.id, RECEIVED_EVENT, "2026-09-03T15:00:00Z"); // even a record found later doesn't overwrite it
  const plan = db.plan(o.id);
  assert.equal(plan.missingReceivedDate, false);
  assert.deepEqual(plan.bagFills, []);
  await db.setUp(o.id);
  assert.equal(db.bags[0].received_on, "2026-09-01");
  assert.equal(db.bags[0].due_date, "2026-09-29");
  assert.equal(db.bags[0].completed_at, "2026-10-01T12:00:00Z");
  assert.equal(db.orders.get(o.id)!.status, "completed");
});
