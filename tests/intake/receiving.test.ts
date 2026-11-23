/** Receiving rules (lib/intake/receiving-plan.ts) and the order views (lib/intake/views.ts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planReceiving, type PlanBag, type PlanCard, type PlanOrder, type ReceivingPlan } from "@/lib/intake/receiving-plan";
import { buildOrderIntake, completionStatus, historicalReceivedOn, receivingStatus } from "@/lib/intake/views";
import type { IntakeCardRow, StageEventRow, TierBagRow } from "@/lib/intake/types";

const ORDER: PlanOrder = { id: "o1", order_number: "CD-2549", restoration_tier: null, status: "awaiting_cards" };
const T0 = "2026-11-10T15:00:00.000001+00:00";

function makeCards(spec: [tier: string | null, n: number][]): PlanCard[] {
  const out: PlanCard[] = [];
  for (const [tier, n] of spec) {
    for (let i = 0; i < n; i++) {
      const k = out.length + 1;
      out.push({
        id: `card-${String(k).padStart(2, "0")}`, order_id: ORDER.id, card_name: `Card ${k}`, tier, status: "active", completed: false,
        created_at: T0, card_seq: null, card_code: null, received_at: null, awaiting_arrival: false, bag_id: null,
      });
    }
  }
  return out;
}

function plan(input: Partial<Parameters<typeof planReceiving>[0]> & { cards: PlanCard[] }): ReceivingPlan {
  const r = planReceiving({ order: ORDER, bags: [], cardIds: input.cards.map((c) => c.id), receivedOn: "2026-11-15", ...input });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.plan;
}

/** Apply a plan the way receiveCards() writes it, to chain receipts. */
function apply(cards: PlanCard[], bags: PlanBag[], p: ReceivingPlan, receivedOn: string): { cards: PlanCard[]; bags: PlanBag[] } {
  const seq = new Map(p.seqs.map((s) => [s.id, s]));
  const nextBags = [...bags];
  const bagOf = new Map<string, string>();
  for (const b of p.bags) {
    const id = b.existingId ?? `bag-${b.code}`;
    if (!b.existingId) nextBags.push({ id, tier: b.tier, batch: b.batch, bag_code: b.code, received_on: receivedOn, completed_at: null });
    for (const c of b.cardIds) bagOf.set(c, id);
  }
  const nextCards = cards.map((c) => ({
    ...c,
    card_seq: c.card_seq ?? seq.get(c.id)?.seq ?? null,
    card_code: c.card_code ?? seq.get(c.id)?.code ?? null,
    received_at: bagOf.has(c.id) ? `${receivedOn}T15:00:00Z` : c.received_at,
    bag_id: bagOf.get(c.id) ?? c.bag_id,
    awaiting_arrival: bagOf.has(c.id) ? false : p.markAwaiting.includes(c.id) ? true : c.awaiting_arrival,
  }));
  return { cards: nextCards, bags: nextBags };
}

test("4 Gold + 2 Silver + 3 Platinum -> 3 bags under one order, fastest tier first", () => {
  const cards = makeCards([["premium", 4], ["expedited", 2], ["ultra_premium", 3]]);
  const p = plan({ cards });
  assert.deepEqual(p.bags.map((b) => [b.code, b.tierName, b.batch, b.cardIds.length, b.existingId]), [
    ["CD-2549-P", "Platinum", 1, 3, null],
    ["CD-2549-G", "Gold", 1, 4, null],
    ["CD-2549-S", "Silver", 1, 2, null],
  ]);
  assert.equal(p.markAwaiting.length, 0);
  assert.equal(p.seqs.length, 9);
  assert.deepEqual(p.seqs.slice(0, 2), [{ id: "card-01", seq: 1, code: "CD-2549-01" }, { id: "card-02", seq: 2, code: "CD-2549-02" }]);
  assert.equal(p.eventText, "Received 9 of 9 cards: Platinum bag CD-2549-P (3), Gold bag CD-2549-G (4), Silver bag CD-2549-S (2)");
});

test("the card's own tier wins over the order's; the order's tier fills in", () => {
  const cards = makeCards([[null, 2], ["elite", 1]]);
  const p = plan({ cards, order: { ...ORDER, restoration_tier: "premium" } });
  assert.deepEqual(p.bags.map((b) => [b.code, b.cardIds]), [["CD-2549-D", ["card-03"]], ["CD-2549-G", ["card-01", "card-02"]]]);
});

test("partial receipt: missing cards stay not received and are flagged awaiting arrival", () => {
  const cards = makeCards([["premium", 3], ["expedited", 2]]);
  const p = plan({ cards, cardIds: ["card-01", "card-04"] });
  assert.deepEqual(p.bags.map((b) => [b.code, b.cardIds]), [["CD-2549-G", ["card-01"]], ["CD-2549-S", ["card-04"]]]);
  assert.deepEqual(p.markAwaiting, ["card-02", "card-03", "card-05"]);
  assert.equal(p.receivedAfter, 2);
  assert.equal(p.totalCards, 5);
  assert.equal(p.eventText, "Received 2 of 5 cards: Gold bag CD-2549-G (1), Silver bag CD-2549-S (1)");
  // Historical setup: no awaiting flags
  assert.deepEqual(plan({ cards, cardIds: ["card-01"], markOthersAwaiting: false }).markAwaiting, []);
});

test("same-day re-receive reuses the open bag; a later day makes batch 2", () => {
  let state = { cards: makeCards([["ultra_premium", 4]]), bags: [] as PlanBag[] };
  const first = plan({ cards: state.cards, cardIds: ["card-01", "card-02"] });
  state = apply(state.cards, state.bags, first, "2026-11-15");
  assert.deepEqual(state.cards.map((c) => c.awaiting_arrival), [false, false, true, true]);

  const sameDay = plan({ cards: state.cards, bags: state.bags, cardIds: ["card-03"], receivedOn: "2026-11-15" });
  assert.deepEqual(sameDay.bags.map((b) => [b.code, b.existingId, b.cardIds]), [["CD-2549-P", "bag-CD-2549-P", ["card-03"]]]);
  assert.deepEqual(sameDay.seqs, [], "Card IDs are assigned once");
  assert.equal(sameDay.eventText, "Received 1 more card (3 of 4 in): Platinum bag CD-2549-P (1)");
  state = apply(state.cards, state.bags, sameDay, "2026-11-15");

  const nextDay = plan({ cards: state.cards, bags: state.bags, cardIds: ["card-04"], receivedOn: "2026-11-17" });
  assert.deepEqual(nextDay.bags.map((b) => [b.code, b.batch, b.existingId]), [["CD-2549-P2", 2, null]]);
  assert.deepEqual(nextDay.markAwaiting, []);
});

test("a completed bag is never reused, even the same day", () => {
  const cards = makeCards([["premium", 2]]);
  const bags: PlanBag[] = [{ id: "b1", tier: "premium", batch: 1, bag_code: "CD-2549-G", received_on: "2026-11-15", completed_at: "2026-11-15T20:00:00Z" }];
  const p = plan({ cards, bags, cardIds: ["card-02"] });
  assert.deepEqual(p.bags.map((b) => [b.code, b.existingId]), [["CD-2549-G2", null]]);
});

test("already received cards are skipped; refused: no tier, refunded, not on the order, none ticked", () => {
  const cards = makeCards([["premium", 2], [null, 1]]);
  cards[0] = { ...cards[0], received_at: "2026-11-14T15:00:00Z", card_seq: 1, card_code: "CD-2549-01" };
  const ok = plan({ cards, cardIds: ["card-01", "card-02"] });
  assert.deepEqual(ok.alreadyReceived, ["card-01"]);
  assert.deepEqual(ok.bags.map((b) => b.cardIds), [["card-02"]]);

  const noTier = planReceiving({ order: ORDER, cards, bags: [], cardIds: ["card-02", "card-03"], receivedOn: "2026-11-15" });
  assert.equal(noTier.ok, false);
  if (!noTier.ok) {
    assert.equal(noTier.status, 400);
    assert.match(noTier.error, /#3/);
    assert.deepEqual(noTier.needsTier, [{ cardId: "card-03", seq: 3, name: "Card 3" }]);
  }
  const refundedCards = cards.map((c) => (c.id === "card-02" ? { ...c, status: "refunded" } : c));
  const refunded = planReceiving({ order: ORDER, cards: refundedCards, bags: [], cardIds: ["card-02"], receivedOn: "2026-11-15" });
  assert.ok(!refunded.ok && /refunded/.test(refunded.error));
  const foreign = planReceiving({ order: ORDER, cards: [...cards, { ...cards[1], id: "other", order_id: "o2" }], bags: [], cardIds: ["other"], receivedOn: "2026-11-15" });
  assert.ok(!foreign.ok && /isn't on this order/.test(foreign.error));
  assert.equal(planReceiving({ order: ORDER, cards, bags: [], cardIds: [], receivedOn: "2026-11-15" }).ok, false);
});

test("cards the Historical Order Setup bagged with no received date: never flagged awaiting, never received again", () => {
  // Setup bagged cards 1-2 (Gold) with no receipt record; card 3 was added later and is here now
  const cards = makeCards([["premium", 3], ["premium", 1]]).map((c, i) => (i < 2 ? { ...c, bag_id: "bag-G", card_seq: i + 1, card_code: `CD-2549-0${i + 1}` } : c));
  const bags: PlanBag[] = [{ id: "bag-G", tier: "premium", batch: 1, bag_code: "CD-2549-G", received_on: null, completed_at: null }];
  const p = plan({ cards, bags, cardIds: ["card-03"] });
  assert.deepEqual(p.markAwaiting, ["card-04"], "only the card that isn't here and isn't bagged");
  assert.equal(p.receivedBefore, 2, "bagged cards count as in");
  assert.equal(p.receivedAfter, 3);
  assert.deepEqual(p.bags.map((b) => [b.code, b.existingId]), [["CD-2549-G2", null]], "no date on the setup bag, so a new batch");
  const again = planReceiving({ order: ORDER, cards, bags, cardIds: ["card-01", "card-03"], receivedOn: "2026-11-15" });
  assert.ok(!again.ok);
  assert.equal(again.status, 409);
  assert.match(again.error, /^Card #1 is already in bag CD-2549-G\. Enter the bag's received date/);
});

test("refunded and done cards are never flagged awaiting; unknown tiers share the U letter without clashing", () => {
  const cards = makeCards([["mystery", 1], ["other_new", 1], ["premium", 2]]);
  cards[3] = { ...cards[3], status: "refunded" };
  const p = plan({ cards, cardIds: ["card-01", "card-02"] });
  assert.deepEqual(p.bags.map((b) => b.code).sort(), ["CD-2549-U", "CD-2549-U2"]);
  assert.deepEqual(p.markAwaiting, ["card-03"]);
  assert.equal(p.totalCards, 3);
});

test("order views: receiving and completion status, historical received day", () => {
  assert.equal(receivingStatus([{ refunded: false, receivedAt: null }]), "not received");
  assert.equal(receivingStatus([{ refunded: false, receivedAt: "x" }, { refunded: false, receivedAt: null }]), "partially received");
  assert.equal(receivingStatus([{ refunded: false, receivedAt: "x" }, { refunded: true, receivedAt: null }]), "received");
  assert.equal(completionStatus([{ refunded: false, completed: false }]), "in progress");
  assert.equal(completionStatus([{ refunded: false, completed: true }, { refunded: false, completed: false }]), "partially completed");
  assert.equal(completionStatus([{ refunded: false, completed: true }, { refunded: true, completed: false }]), "all cards done");

  const ev = (description: string, created_at: string, event_type = "status_updated"): StageEventRow => ({ event_type, description, metadata: null, created_at });
  const mail = { inbound_method: "self_ship", created_at: "2026-11-01T12:00:00Z" };
  assert.equal(historicalReceivedOn(mail, [ev("Status updated to: Cards Received", "2026-11-16T02:30:00Z"), ev("Status updated to: Cards Received", "2026-11-20T15:00:00Z")]), "2026-11-15");
  assert.equal(historicalReceivedOn(mail, [ev("Status updated to: In Progress", "2026-11-16T15:00:00Z")]), null);
  assert.equal(historicalReceivedOn({ inbound_method: "dropoff", created_at: "2026-11-02T18:00:00Z" }, []), "2026-11-02");
});

test("buildOrderIntake: a Gold bag done while Silver works -> partially completed; bags compute completion and stage spread", () => {
  const row = (id: string, seq: number, tier: string, bag: string, completed: boolean): IntakeCardRow => ({
    id, order_id: "o1", card_name: `Card ${seq}`, card_set: "Base", card_year: "1999", card_number: `${seq}/102`, variation: null, notes: null,
    photo_urls: seq === 1 ? ["https://x/1.jpg"] : [], catalog_image_url: null, tier, status: "active", completed, completed_at: completed ? "2026-12-01T10:00:00Z" : null,
    current_round: 1, created_at: T0, card_seq: seq, card_code: `CD-2549-0${seq}`, bag_id: bag, received_at: "2026-11-15T15:00:00Z", received_by: "gavin",
    awaiting_arrival: false, receiving_photo_urls: [],
  });
  const bag = (id: string, tier: string, code: string): TierBagRow => ({
    id, order_id: "o1", tier, batch: 1, bag_code: code, received_on: "2026-11-15", due_date: "2026-12-07", due_status: "calculated", turnaround_days: 15,
    due_note: null, completed_at: null, completion_seen_at: null, label_printed_at: null, source: "receiving", created_at: "2026-11-15T15:00:00Z", created_by: "gavin",
  });
  const intake = buildOrderIntake({
    order: { id: "o1", order_number: "CD-2549", customer_name: "Pat", customer_email: null, customer_phone: null, status: "in_progress", payment_status: "paid", restoration_tier: null, inbound_method: "self_ship", customer_notes: null, created_at: T0 },
    cards: [row("c3", 3, "expedited", "bs", false), row("c1", 1, "premium", "bg", true), row("c2", 2, "premium", "bg", true), row("c4", 4, "expedited", "bs", false)],
    bags: [bag("bs", "expedited", "CD-2549-S"), bag("bg", "premium", "CD-2549-G")],
    events: [{ event_type: "stage_update", description: "Stage: Humidor [card:c3]", metadata: { card_id: "c3", stage: "Humidor", round: 1 }, created_at: "2026-11-16T15:00:00Z" }],
  });
  assert.equal(intake.completion, "partially completed");
  assert.equal(intake.receiving, "received");
  assert.deepEqual(intake.cards.map((c) => c.seq), [1, 2, 3, 4]);
  assert.deepEqual(intake.bags.map((b) => [b.code, b.complete, b.cardCount, b.completedCount, b.stagesDiffer]), [
    ["CD-2549-G", true, 2, 2, false],
    ["CD-2549-S", false, 2, 0, true],
  ]);
  assert.equal(intake.bags[1].qrUrl.endsWith("/Q/CD-2549-S"), true);
  assert.deepEqual(intake.bags[1].cards.map((c) => c.code), ["CD-2549-03", "CD-2549-04"]);
  assert.equal(intake.counts.missingImage, 3);
  assert.equal(intake.cards[0].flags.missingImage, false);
  assert.equal(intake.cards[2].stage.currentLabel, "Humidor");
});

test("a printed label is out of date once the due date changes or a card joins the bag after it", async () => {
  const { labelIsOutdated } = await import("@/lib/intake/views");
  const printed = "2026-11-16T15:00:00.000Z";
  assert.equal(labelIsOutdated(null, ["2026-11-17T15:00:00Z"], "2026-11-17T15:00:00Z"), false, "never printed: nothing to reprint");
  assert.equal(labelIsOutdated(printed, ["2026-11-15T15:00:00Z"], null), false);
  assert.equal(labelIsOutdated(printed, ["2026-11-15T15:00:00Z"], "2026-11-16T16:00:00Z"), true, "due date set or changed after printing");
  assert.equal(labelIsOutdated(printed, ["2026-11-15T15:00:00Z", "2026-11-16T15:30:00Z"], null), true, "a card received into the bag after printing");
  assert.equal(labelIsOutdated(printed, [null], "2026-11-16T14:00:00Z"), false, "changes before printing are on the label");
});
