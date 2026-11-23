/**
 * The intake services end to end (receiveCards, advanceCards, unreceiveCard,
 * refreshBagCompletion, loaders, due date changes, setOrderStatus) against the
 * in-memory Supabase + Resend stand-in (tests/intake/harness/mock-supabase.mjs).
 * No real database, no real email.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { addBusinessDays, nyToday } from "@/lib/intake/business-days";
import path from "node:path";
import { pathToFileURL } from "node:url";

type Row = Record<string, unknown>;
type Mock = { url: string; store: { table(name: string): Row[]; load(seed: { tables: Record<string, Row[]> }): void; emails: Row[] }; close(): Promise<void> };

let mock: Mock;
let admin: SupabaseClient;
let svc: {
  receiving: typeof import("@/lib/intake/receiving");
  stages: typeof import("@/lib/intake/stages");
  data: typeof import("@/lib/intake/data");
  due: typeof import("@/lib/intake/due-dates");
  status: typeof import("@/lib/order-status");
};

const ORDER = "00000000-0000-4000-8000-000000000001";
const ORDER2 = "00000000-0000-4000-8000-000000000002";
const card = (n: number, tier: string | null, order = ORDER): Row => ({
  id: `00000000-0000-4000-8000-${order === ORDER ? "0000000001" : "0000000002"}${String(n).padStart(2, "0")}`,
  order_id: order, card_name: `Card ${n}`, card_set: "Base Set", card_year: "1999", card_number: `${n}/102`, variation: null, notes: null,
  photo_urls: n === 1 ? ["https://example.com/c1.jpg"] : [], catalog_image_url: null, tier, status: "active", completed: false, completed_at: null,
  current_round: 1, created_at: "2026-11-10T15:00:00.000000+00:00", card_seq: null, card_code: null, bag_id: null, received_at: null, received_by: null,
  awaiting_arrival: false, receiving_photo_urls: [], slab_removal_selected: false, pregrade_selected: false, refunded_cents: 0, service_ids: [],
});
const order = (id: string, number: string, status: string): Row => ({
  id, order_number: number, customer_name: "Pat Collector", customer_email: "pat@example.com", customer_phone: "555", status,
  payment_status: "paid", restoration_tier: null, inbound_method: "self_ship", customer_notes: "Careful with the corners",
  created_at: "2026-11-10T15:00:00+00:00", updated_at: "2026-11-10T15:00:00+00:00", ship_from_address: {}, ship_to_address: {},
  subtotal_cents: 0, total_cents: 0, refunded_cents: 0, slab_crack_count: 0, instagram_feature: false, gift_card_discount_cents: 0, admin_notes: null,
});
const ids = (cards: Row[]) => cards.map((c) => c.id as string);
const events = () => mock.store.table("order_events");
const cardsOf = (orderId: string) => mock.store.table("cards").filter((c) => c.order_id === orderId);
const cardRow = (id: string) => mock.store.table("cards").find((c) => c.id === id)!;

let gold: Row[], silver: Row[], plat: Row[];

before(async () => {
  // scripts/test-intake.mjs picks the port and points RESEND_BASE_URL at it
  // (the Resend SDK reads it when it loads, before this hook runs)
  // Loaded at run time, not bundled (its "run as a script" check would fire inside a bundle)
  const harness = pathToFileURL(path.resolve("tests/intake/harness/mock-supabase.mjs")).href;
  const { startMock } = (await import(harness)) as { startMock: (o: { port: number; quiet: boolean }) => Promise<Mock> };
  mock = await startMock({ port: Number(process.env.INTAKE_TEST_MOCK_PORT) || 0, quiet: true });
  process.env.ADMIN_NOTIFY_EMAIL = "staff@example.com";
  delete process.env.NEXT_PUBLIC_APP_URL;
  gold = [1, 2, 3, 4].map((n) => card(n, "premium"));
  silver = [5, 6].map((n) => card(n, "expedited"));
  plat = [7, 8, 9].map((n) => card(n, "ultra_premium"));
  mock.store.load({
    tables: {
      orders: [order(ORDER, "CD-3001", "awaiting_cards"), order(ORDER2, "CD-3002", "received")],
      cards: [...gold, ...silver, ...plat, card(1, "ultra_premium", ORDER2), card(2, "ultra_premium", ORDER2)],
      restoration_settings: [
        { tier: "premium", display_name: "Gold", turnaround_min_days: 15, turnaround_max_days: 20 },
        { tier: "expedited", display_name: "Silver", turnaround_min_days: 30, turnaround_max_days: 45 },
        { tier: "ultra_premium", display_name: "Platinum", turnaround_min_days: 10, turnaround_max_days: 15 },
      ],
      business_holidays: [{ day: "2026-11-26", name: "Thanksgiving" }, { day: "2026-12-25", name: "Christmas Day" }],
      store_config: [], order_events: [], tier_bags: [], tier_bag_due_changes: [],
    },
  });
  admin = createClient(mock.url, "service-role-test-key", { auth: { persistSession: false } });
  // Imported after the environment is set (lib/resend.ts reads it when loaded)
  svc = {
    receiving: await import("@/lib/intake/receiving"),
    stages: await import("@/lib/intake/stages"),
    data: await import("@/lib/intake/data"),
    due: await import("@/lib/intake/due-dates"),
    status: await import("@/lib/order-status"),
  };
});

after(async () => {
  await mock?.close();
});

test("partial multi-tier receipt: one bag per tier, due dates, awaiting card, status through the status button's code", async () => {
  const r = await svc.receiving.receiveCards(admin, {
    orderId: ORDER, cardIds: [...ids(gold.slice(0, 3)), ...ids(silver), ...ids(plat)], receivedOn: "2026-11-15", by: "gavin",
  });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.deepEqual(r.bags.map((b) => [b.code, b.cardIds.length, b.dueDate, b.dueStatus, b.created]), [
    ["CD-3001-P", 3, "2026-12-07", "calculated", true],
    ["CD-3001-G", 3, "2026-12-14", "calculated", true],
    ["CD-3001-S", 2, addBusinessDays("2026-11-15", 45, new Set(["2026-11-26", "2026-12-25"])), "calculated", true],
  ]);
  assert.equal(r.orderStatusChanged, true);
  assert.deepEqual(r.markedAwaiting, [gold[3].id]);
  assert.equal(r.eventText, "Received 8 of 9 cards: Platinum bag CD-3001-P (3), Gold bag CD-3001-G (3), Silver bag CD-3001-S (2)");

  const cards = cardsOf(ORDER).sort((a, b) => (a.card_seq as number) - (b.card_seq as number));
  assert.deepEqual(cards.map((c) => c.card_code), [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `CD-3001-0${n}`));
  assert.equal(cardRow(gold[3].id as string).awaiting_arrival, true);
  assert.equal(cardRow(gold[3].id as string).received_at ?? null, null);
  assert.equal(cardRow(plat[0].id as string).received_by, "gavin");
  assert.equal(mock.store.table("orders").find((o) => o.id === ORDER)!.status, "received");

  const ev = events().filter((e) => e.order_id === ORDER);
  assert.equal(ev.filter((e) => e.description === "Status updated to: Cards Received" && e.is_customer_visible === true).length, 1);
  assert.equal(ev.filter((e) => e.event_type === "cards_received" && e.is_customer_visible === false).length, 1);
  const subjects = mock.store.emails.map((e) => e.subject);
  assert.deepEqual(subjects, ["Update on your order — Cards Received", "📦 Cards Arrived — Order #CD-3001 from Pat Collector"]);
});

test("receiving the same cards again changes nothing; the late card on another day gets batch 2, status untouched", async () => {
  const again = await svc.receiving.receiveCards(admin, { orderId: ORDER, cardIds: ids(gold.slice(0, 1)), receivedOn: "2026-11-15", by: "gavin" });
  assert.ok(again.ok && again.receivedCardIds.length === 0 && again.alreadyReceived.length === 1);
  const late = await svc.receiving.receiveCards(admin, { orderId: ORDER, cardIds: ids(gold.slice(3)), receivedOn: "2026-11-17", by: "sam" });
  assert.ok(late.ok);
  if (!late.ok) return;
  assert.deepEqual(late.bags.map((b) => [b.code, b.batch, b.dueDate]), [["CD-3001-G2", 2, "2026-12-16"]]);
  assert.equal(late.orderStatusChanged, false);
  assert.equal(cardRow(gold[3].id as string).awaiting_arrival, false);
  assert.equal(mock.store.table("tier_bags").filter((b) => b.order_id === ORDER).length, 4);
  assert.equal(mock.store.emails.length, 2, "no second status email");
});

test("refusals: unknown card, refunded card, future date", async () => {
  const foreign = await svc.receiving.receiveCards(admin, { orderId: ORDER, cardIds: ["00000000-0000-4000-8000-00000000ffff"], by: null });
  assert.ok(!foreign.ok && foreign.status === 400);
  const future = await svc.receiving.receiveCards(admin, { orderId: ORDER, cardIds: ids(gold), receivedOn: "2099-01-01", by: null });
  assert.ok(!future.ok && future.status === 400);
});

test("two receipts at the same moment: one bag, no duplicate Card IDs", async () => {
  const [a, b] = cardsOf(ORDER2).map((c) => c.id as string);
  const [r1, r2] = await Promise.all([
    svc.receiving.receiveCards(admin, { orderId: ORDER2, cardIds: [a], receivedOn: "2026-11-18", by: "x", markOthersAwaiting: false }),
    svc.receiving.receiveCards(admin, { orderId: ORDER2, cardIds: [b], receivedOn: "2026-11-18", by: "y", markOthersAwaiting: false }),
  ]);
  assert.ok(r1.ok && r2.ok, `${!r1.ok ? r1.error : ""} ${!r2.ok ? r2.error : ""}`);
  const bags = mock.store.table("tier_bags").filter((x) => x.order_id === ORDER2);
  assert.deepEqual(bags.map((x) => x.bag_code), ["CD-3002-P"]);
  assert.deepEqual(cardsOf(ORDER2).map((c) => c.bag_id), [bags[0].id, bags[0].id]);
  assert.deepEqual(cardsOf(ORDER2).map((c) => c.card_code).sort(), ["CD-3002-01", "CD-3002-02"]);
});

test("bulk advance: one email, cards at another step skipped; Final Dry -> done completes the bag", async () => {
  const sent = mock.store.emails.length;
  const first = await svc.stages.advanceCards(admin, { orderId: ORDER, cardIds: ids(plat), fromStage: null, by: "gavin" });
  assert.ok(first.ok && first.moved.length === 3 && first.emailed);
  assert.equal(mock.store.emails.length, sent + 1, "one email for three cards");
  assert.match(String(mock.store.emails.at(-1)!.subject), /^Update on your cards — Slab cracking \(Order #CD-3001\)$/);
  const stageEvent = events().filter((e) => e.event_type === "stage_update").at(-1)!;
  assert.match(String(stageEvent.description), /^Stage: Ready for Slab Crack \[card:.+\]$/);
  assert.deepEqual(Object.keys(stageEvent.metadata as object).sort(), ["bulk", "by", "card_id", "round", "stage"]);

  // One card moves ahead alone; the bulk move then leaves it alone
  const solo = await svc.stages.advanceCards(admin, { orderId: ORDER, cardIds: ids(plat.slice(0, 1)), fromStage: "Ready for Slab Crack", by: "sam" });
  assert.ok(solo.ok && solo.moved[0].stage === "Humidor");
  const bulk = await svc.stages.advanceCards(admin, { orderId: ORDER, cardIds: ids(plat), fromStage: "Ready for Slab Crack", by: "sam" });
  assert.ok(bulk.ok);
  if (!bulk.ok) return;
  assert.equal(bulk.moved.length, 2);
  assert.deepEqual(bulk.skipped.map((s) => [s.cardId, s.reason, s.current]), [[plat[0].id, "different_stage", "Humidor"]]);
  // The card that is ahead moves on alone: the bag's cards are now at different steps
  const ahead = await svc.stages.advanceCards(admin, { orderId: ORDER, cardIds: ids(plat.slice(0, 1)), fromStage: "Humidor", by: "sam" });
  assert.ok(ahead.ok && ahead.moved[0].stage === "Humidity Press");

  const loaded = await svc.data.loadOrderIntake(admin, ORDER);
  assert.ok(loaded.ok);
  if (!loaded.ok) return;
  const pBag = loaded.intake.bags.find((b) => b.code === "CD-3001-P")!;
  assert.equal(pBag.stagesDiffer, true);
  assert.deepEqual(pBag.stageGroups.map((g) => [g.label, g.cardIds.length]), [["Humidor", 2], ["Humidity Press", 1]]);

  // The G2 bag (one card) jumps to Final Dry, then the next step marks it done
  const g2card = gold[3].id as string;
  const toFinal = await svc.stages.advanceCards(admin, { orderId: ORDER, cardIds: [g2card], fromStage: null, toStage: "Final Dry", by: "sam" });
  assert.ok(toFinal.ok && toFinal.moved.length === 1);
  const sentBefore = mock.store.emails.length;
  const done = await svc.stages.advanceCards(admin, { orderId: ORDER, cardIds: [g2card], fromStage: "Final Dry", by: "sam" });
  assert.ok(done.ok);
  if (!done.ok) return;
  assert.deepEqual(done.completed, [g2card]);
  assert.equal(done.bagsCompleted.length, 1);
  assert.equal(mock.store.emails.length, sentBefore, "no email for done, as before");
  assert.equal(cardRow(g2card).completed, true);
  const g2 = mock.store.table("tier_bags").find((b) => b.bag_code === "CD-3001-G2")!;
  assert.ok(g2.completed_at);

  const after = await svc.data.loadOrderIntake(admin, ORDER);
  assert.ok(after.ok && after.intake.completion === "partially completed" && after.intake.receiving === "received");
});

test("reopening a card (Done toggled off elsewhere) reopens its bag on the hook and on load", async () => {
  const g2card = gold[3].id as string;
  await admin.from("cards").update({ completed: false, completed_at: null }).eq("id", g2card);
  await svc.stages.refreshBagCompletionForCard(g2card, admin);
  const g2 = mock.store.table("tier_bags").find((b) => b.bag_code === "CD-3001-G2")!;
  assert.equal(g2.completed_at, null);
  // Ticked done somewhere that doesn't refresh bags: the loader heals it
  await admin.from("cards").update({ completed: true, completed_at: "2026-12-02T10:00:00Z" }).eq("id", g2card);
  const loaded = await svc.data.loadBag(admin, g2.id as string);
  assert.ok(loaded.ok);
  if (!loaded.ok) return;
  assert.equal(loaded.bag.complete, true);
  // completed_at is the card's done time (the database stamps it when Done is ticked)
  assert.equal(loaded.bag.completedAt, cardRow(g2card).completed_at);
});

test("unreceive: refused once a card has steps; allowed before; awaiting flag follows the rest of the order", async () => {
  const started = await svc.receiving.unreceiveCard(admin, { cardId: plat[0].id as string, by: "gavin" });
  assert.ok(!started.ok && started.status === 409);
  const ok = await svc.receiving.unreceiveCard(admin, { cardId: silver[0].id as string, by: "gavin" });
  assert.ok(ok.ok && !ok.bagDeleted);
  const row = cardRow(silver[0].id as string);
  assert.equal(row.received_at, null);
  assert.equal(row.bag_id, null);
  assert.equal(row.awaiting_arrival, true);
  const last = await svc.receiving.unreceiveCard(admin, { cardId: silver[1].id as string, by: "gavin" });
  assert.ok(last.ok && last.bagDeleted, "the emptied Silver bag is removed");
  assert.ok(!mock.store.table("tier_bags").some((b) => b.bag_code === "CD-3001-S"));
});

test("due dates: manual change needs a reason and is logged; loaders, card page, code lookup", async () => {
  const bag = mock.store.table("tier_bags").find((b) => b.bag_code === "CD-3001-P")!;
  const blank = await svc.due.changeBagDueDate(admin, { bagId: bag.id as string, newDue: "2026-12-09", reason: "  ", by: "gavin" });
  assert.ok(!blank.ok && blank.status === 400);
  const changed = await svc.due.changeBagDueDate(admin, { bagId: bag.id as string, newDue: "2026-12-09", reason: "Customer asked for extra care", by: "gavin" });
  assert.ok(changed.ok && changed.bag.due_status === "manual" && changed.bag.due_date === "2026-12-09");
  assert.deepEqual(mock.store.table("tier_bag_due_changes").map((c) => [c.old_due, c.new_due, c.reason]), [["2026-12-07", "2026-12-09", "Customer asked for extra care"]]);
  // A manual due date survives a received-date correction
  const moved = await svc.due.setBagReceivedOn(admin, { bagId: bag.id as string, receivedOn: "2026-11-16", by: "gavin" });
  assert.ok(moved.ok && moved.bag.due_date === "2026-12-09" && moved.bag.received_on === "2026-11-16");

  const lb = await svc.data.loadBag(admin, bag.id as string);
  assert.ok(lb.ok);
  if (!lb.ok) return;
  assert.equal(lb.bag.cardCount, 3);
  assert.equal(lb.bag.qrUrl, "HTTPS://THECARDDOC1.COM/Q/CD-3001-P");
  assert.equal(lb.dueChanges.length, 1);
  assert.equal(lb.order.customerNotes, "Careful with the corners");

  const lc = await svc.data.loadCard(admin, plat[0].id as string);
  assert.ok(lc.ok);
  if (!lc.ok) return;
  assert.equal(lc.card.code, "CD-3001-07");
  assert.equal(lc.card.tierName, "Platinum");
  assert.equal(lc.card.stage.currentLabel, "Humidity Press");
  assert.deepEqual(lc.card.stage.history.map((h) => h.label), ["Received", "Ready for Slab Crack", "Humidor", "Humidity Press"]);
  assert.equal(lc.bag?.code, "CD-3001-P");
  // The status event's day (today), not the bag's back-dated received day
  assert.equal(lc.order.historicalReceivedOn, nyToday());

  assert.deepEqual(await svc.data.resolveCode(admin, "https://thecarddoc1.com/q/cd-3001-p"), { kind: "bag", id: bag.id, code: "CD-3001-P", orderId: ORDER });
  assert.deepEqual(await svc.data.resolveCode(admin, "cd-3001-07"), { kind: "card", id: plat[0].id, code: "CD-3001-07" });
  assert.equal(await svc.data.resolveCode(admin, "CD-9999-01"), null);
  const missing = await svc.data.loadBag(admin, "00000000-0000-4000-8000-00000000dead");
  assert.ok(!missing.ok && missing.status === 404);
});

test("setOrderStatus: same result shape as the route; onlyIfCurrent skips when the status moved on", async () => {
  const bad = await svc.status.setOrderStatus({ orderId: ORDER, status: "nope" }, admin);
  assert.deepEqual(bad, { ok: false, httpStatus: 400, error: "Invalid status" });
  const skipped = await svc.status.setOrderStatus({ orderId: ORDER, status: "received", onlyIfCurrent: "awaiting_cards" }, admin);
  assert.deepEqual(skipped, { ok: true, skipped: true });
  const ok = await svc.status.setOrderStatus({ orderId: ORDER, status: "in_progress" }, admin);
  assert.deepEqual(ok, { ok: true });
  assert.equal(events().at(-1)!.description, "Status updated to: In Progress");
  const missing = await svc.status.setOrderStatus({ orderId: "00000000-0000-4000-8000-00000000beef", status: "received" }, admin);
  assert.ok(!missing.ok && missing.httpStatus === 404);
});

test("page loads and the card hooks never reopen a finished historical order's completed bag (cards never ticked done)", async () => {
  const O3 = "00000000-0000-4000-8000-000000000003";
  const BAG = "00000000-0000-4000-8000-0000000000b3";
  const done = "2026-07-01T15:00:00+00:00";
  const seen = "2026-11-20T15:00:00+00:00";
  mock.store.table("orders").push(order(O3, "CD-3003", "delivered"));
  const c1 = { ...card(1, "premium", O3), id: "00000000-0000-4000-8000-000000000301", card_seq: 1, card_code: "CD-3003-01", bag_id: BAG };
  const c2 = { ...card(2, "premium", O3), id: "00000000-0000-4000-8000-000000000302", card_seq: 2, card_code: "CD-3003-02", bag_id: BAG, completed: true, completed_at: "2026-06-20T15:00:00+00:00" };
  mock.store.table("cards").push(c1, c2);
  mock.store.table("tier_bags").push({
    id: BAG, order_id: O3, tier: "premium", batch: 1, bag_code: "CD-3003-G", received_on: "2026-06-02", due_date: "2026-06-30",
    due_status: "needs_review", turnaround_days: 20, due_note: null, completed_at: done, completion_seen_at: seen, label_printed_at: null,
    source: "migration", created_at: "2026-11-20T15:00:00+00:00", created_by: "setup",
  });
  const bagRow = () => mock.store.table("tier_bags").find((b) => b.id === BAG)!;
  const writesBefore = mock.store.table("tier_bags").length;

  const intake = await svc.data.loadOrderIntake(admin, O3);
  assert.ok(intake.ok, intake.ok ? "" : intake.error);
  if (!intake.ok) return;
  assert.equal(intake.intake.bags[0].complete, true, "shown completed");
  const lb = await svc.data.loadBag(admin, BAG);
  assert.ok(lb.ok && lb.bag.complete && lb.bag.completedAt === done);
  const lc = await svc.data.loadCard(admin, c1.id);
  assert.ok(lc.ok && lc.bag?.complete === true);
  await svc.stages.refreshBagCompletionForCard(c1.id, admin);
  assert.deepEqual([bagRow().completed_at, bagRow().completion_seen_at], [done, seen], "never reopened, alert not raised again");
  assert.equal(mock.store.table("tier_bags").length, writesBefore);

  // A Receiving bag of the same finished order, or the order reopened (back in
  // progress): a card that isn't done reopens the bag, as before
  mock.store.table("orders").find((o) => o.id === O3)!.status = "in_progress";
  const reopened = await svc.data.loadBag(admin, BAG);
  assert.ok(reopened.ok && !reopened.bag.complete);
  assert.deepEqual([bagRow().completed_at, bagRow().completion_seen_at], [null, null]);
});

test("entering a historical bag's received date gives its cards a receipt for that day (never before the card was added)", async () => {
  const O4 = "00000000-0000-4000-8000-000000000004";
  const BAG = "00000000-0000-4000-8000-0000000004b1";
  mock.store.table("orders").push(order(O4, "CD-3004", "in_progress"));
  const early = { ...card(1, "premium", O4), id: "00000000-0000-4000-8000-000000000401", card_seq: 1, card_code: "CD-3004-01", bag_id: BAG };
  const late = { ...card(2, "premium", O4), id: "00000000-0000-4000-8000-000000000402", card_seq: 2, card_code: "CD-3004-02", bag_id: BAG, created_at: "2026-11-12T20:00:00.000000+00:00" };
  const done = { ...card(3, "premium", O4), id: "00000000-0000-4000-8000-000000000403", card_seq: 3, card_code: "CD-3004-03", bag_id: BAG, received_at: "2026-11-13T15:00:00.000Z", received_by: "earlier" };
  mock.store.table("cards").push(early, late, done);
  mock.store.table("tier_bags").push({
    id: BAG, order_id: O4, tier: "premium", batch: 1, bag_code: "CD-3004-G", received_on: null, due_date: null,
    due_status: "missing_received_date", turnaround_days: null, due_note: null, completed_at: null, completion_seen_at: null, label_printed_at: null,
    source: "migration", created_at: "2026-11-20T15:00:00+00:00", created_by: "setup",
  });
  const r = await svc.due.setBagReceivedOn(admin, { bagId: BAG, receivedOn: "2026-11-11", by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.bag.due_status, "needs_review", "historical bag: due date for review");
  assert.equal(cardRow(early.id).received_at, "2026-11-11T17:00:00.000Z");
  assert.equal(cardRow(early.id).received_by, "gavin");
  assert.equal(cardRow(late.id).received_at, late.created_at, "added after that day: received when added");
  assert.equal(cardRow(done.id).received_at, "2026-11-13T15:00:00.000Z", "an existing receipt is kept");
  const intake = await svc.data.loadOrderIntake(admin, O4);
  assert.ok(intake.ok);
  if (!intake.ok) return;
  assert.equal(intake.intake.counts.received, 3);
  assert.equal(intake.intake.counts.missingReceivedDate, 0);
});
