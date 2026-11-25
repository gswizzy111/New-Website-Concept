/**
 * Order auto-complete (lib/intake/order-autocomplete.ts, owner Nov 25 2026:
 * "Do it automatically"): the last non-refunded card done makes the order
 * Completed through setOrderStatus (the status button's event and emails),
 * once, only from Cards Received / In Progress on a paid order. Run against
 * the in-memory Supabase stand-in (tests/intake/harness/mock-supabase.mjs);
 * Resend's API calls are caught at fetch, so nothing is sent.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Mock = { url: string; store: { table(name: string): Row[]; load(seed: { tables: Record<string, Row[]> }): void }; close(): Promise<void> };

let mock: Mock;
let admin: SupabaseClient;
let svc: {
  auto: typeof import("@/lib/intake/order-autocomplete");
  toggle: typeof import("@/lib/intake/card-completion");
  stages: typeof import("@/lib/intake/stages");
  moves: typeof import("@/lib/intake/tracking/moves");
};
const sent: { to: string; subject: string; html: string }[] = [];
const realFetch = globalThis.fetch;

const COMPLETED_SUBJECT = "Update on your order — Completed";
const NOTES_SUBJECT = "Restoration complete — notes from The Card Doc";
const DONE_LOC = "00000000-0000-4000-8000-0000000f0001";

let seq = 0;
type Seeded = { id: string; num: string; email: string; cards: string[] };
/** An order with cards (all received, not done unless `over` says so). */
function seedOrder(over: Row = {}, cardsOver: Row[] = [{}, {}]): Seeded {
  seq++;
  const id = `00000000-0000-4000-8000-0000000a${String(seq).padStart(4, "0")}`;
  const num = `CD-${5000 + seq}`;
  const email = `pat${seq}@example.com`;
  mock.store.table("orders").push({
    id, order_number: num, customer_name: "Pat Collector", customer_email: email, customer_phone: "555-0100",
    ship_from_address: {}, ship_to_address: {}, subtotal_cents: 10000, total_cents: 10000, refunded_cents: 0,
    slab_crack_count: 0, instagram_feature: false, gift_card_discount_cents: 0, admin_notes: null,
    status: "in_progress", payment_status: "paid", restoration_tier: "premium", inbound_method: "self_ship",
    created_at: "2026-11-20T15:00:00+00:00", updated_at: "2026-11-20T15:00:00+00:00", ...over,
  });
  const cards = cardsOver.map((c, i) => {
    const cid = `00000000-0000-4000-8000-0000000b${String(seq).padStart(2, "0")}${String(i + 1).padStart(2, "0")}`;
    mock.store.table("cards").push({
      id: cid, order_id: id, card_name: `Charizard ${i + 1}`, card_set: "Base Set", card_year: "1999", card_number: `${i + 1}/102`,
      variation: null, notes: null, photo_urls: [], catalog_image_url: null, tier: null, status: "active",
      completed: false, completed_at: null, current_round: 1, created_at: `2026-11-20T15:00:0${i}.000000+00:00`,
      card_seq: i + 1, card_code: `${num}-${String(i + 1).padStart(2, "0")}`, bag_id: null,
      received_at: "2026-11-21T15:00:00+00:00", received_by: "gavin", awaiting_arrival: false, receiving_photo_urls: [],
      location_id: null, located_at: null, refunded_cents: 0, service_ids: [], slab_removal_selected: false, pregrade_selected: false,
      ...c,
    });
    return cid;
  });
  return { id, num, email, cards };
}

const orderRow = (id: string) => mock.store.table("orders").find((o) => o.id === id)!;
const eventsOf = (id: string) => mock.store.table("order_events").filter((e) => e.order_id === id);
const statusEvents = (id: string) => eventsOf(id).filter((e) => e.event_type === "status_updated");
const autoEvents = (id: string) => eventsOf(id).filter((e) => e.event_type === "order_auto_completed");
const mailTo = (o: Seeded, subject?: string) => sent.filter((m) => m.to === o.email && (!subject || m.subject === subject));
const DONE = { completed: true, completed_at: "2026-11-24T15:00:00+00:00" };

before(async () => {
  const harness = pathToFileURL(path.resolve("tests/intake/harness/mock-supabase.mjs")).href;
  const { startMock } = (await import(harness)) as { startMock: (o: { port: number; quiet: boolean }) => Promise<Mock> };
  mock = await startMock({ port: 0, quiet: true });
  mock.store.load({
    tables: {
      orders: [], cards: [], order_events: [], tier_bags: [], card_moves: [],
      locations: [{ id: DONE_LOC, code: "LOC-DONE", name: "Done", kind: "done", sort: 900, active: true, created_at: "2026-11-24T00:00:00+00:00" }],
    },
  });
  const resendBase = process.env.RESEND_BASE_URL ?? "https://api.resend.com";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(resendBase) || url.startsWith("https://api.resend.com")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      sent.push({ to: Array.isArray(body.to) ? body.to[0] : body.to, subject: body.subject, html: body.html });
      return new Response(JSON.stringify({ id: `email-${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  admin = createClient(mock.url, "service-role-test-key", { auth: { persistSession: false } });
  svc = {
    auto: await import("@/lib/intake/order-autocomplete"),
    toggle: await import("@/lib/intake/card-completion"),
    stages: await import("@/lib/intake/stages"),
    moves: await import("@/lib/intake/tracking/moves"),
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await mock?.close();
});

/** advanceCards to done, as the Desk / bag page / stages route do. */
const markDone = (o: Seeded, cardIds: string[], by = "gavin") =>
  svc.stages.advanceCards(admin, { orderId: o.id, cardIds, fromStages: Object.fromEntries(cardIds.map((id) => [id, null])), toStage: "complete", by });

test("the last card done: the order becomes Completed, one customer email, the status event, who did it", async () => {
  const o = seedOrder({}, [{}, {}, {}]);
  const first = await markDone(o, o.cards.slice(0, 2));
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.deepEqual(first.completed.sort(), o.cards.slice(0, 2).sort());
  assert.equal(first.orderCompletion?.completed, false, "2 of 3 done: nothing yet");
  assert.equal(first.orderCompletion?.reason, "not_all_done");
  assert.equal(first.orderCompletion?.message, undefined);
  assert.equal(orderRow(o.id).status, "in_progress");
  assert.equal(mailTo(o).length, 0);

  const last = await markDone(o, [o.cards[2]], "sam");
  assert.ok(last.ok);
  if (!last.ok) return;
  assert.deepEqual(last.orderCompletion && {
    completed: last.orderCompletion.completed, emailed: last.orderCompletion.emailed, status: last.orderCompletion.status,
    orderNumber: last.orderCompletion.orderNumber, message: last.orderCompletion.message,
  }, { completed: true, emailed: true, status: "completed", orderNumber: o.num, message: "Order completed. Pat Collector emailed." });
  assert.equal(orderRow(o.id).status, "completed");
  // Exactly what the status button writes: the event the dashboard reads, customer visible
  assert.deepEqual(statusEvents(o.id).map((e) => [e.description, e.is_customer_visible]), [["Status updated to: Completed", true]]);
  // The usual completed email, once
  const mails = mailTo(o);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].subject, COMPLETED_SUBJECT);
  assert.match(mails[0].html, /Your cards are finished and looking great!/);
  // Who: a staff-only line
  assert.deepEqual(autoEvents(o.id).map((e) => [e.description, e.is_customer_visible, (e.metadata as Row).by]),
    [["Order completed automatically: last card done by sam.", false, "sam"]]);

  // Done again (already done): nothing more
  const again = await markDone(o, [o.cards[2]]);
  assert.ok(again.ok && again.completed.length === 0 && !again.orderCompletion, "no card newly done: no check");
  assert.equal(mailTo(o).length, 1);
});

test("refunded cards are ignored: the other cards done completes the order", async () => {
  const o = seedOrder({}, [{}, { status: "refunded" }, {}]);
  const r = await markDone(o, [o.cards[0], o.cards[2]]);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.orderCompletion?.completed, true);
  assert.equal(orderRow(o.id).status, "completed");
  assert.equal(mailTo(o, COMPLETED_SUBJECT).length, 1);
});

test("not all done: nothing changes (a card still on its way counts as not done)", async () => {
  const o = seedOrder({ status: "received" }, [{}, {}, { awaiting_arrival: true, received_at: null }]);
  const r = await markDone(o, o.cards.slice(0, 2));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.orderCompletion?.completed, false);
  assert.equal(r.orderCompletion?.reason, "not_all_done");
  assert.equal(orderRow(o.id).status, "received");
  assert.equal(statusEvents(o.id).length, 0);
  assert.equal(autoEvents(o.id).length, 0);
  assert.equal(mailTo(o).length, 0);
  // Only refunded cards: nothing to complete
  const empty = seedOrder({}, [{ status: "refunded", ...DONE }]);
  const e = await svc.auto.completeOrderIfAllDone(admin, empty.id, "gavin");
  assert.equal(e.reason, "no_cards");
  assert.equal(orderRow(empty.id).status, "in_progress");
});

test("Cards Received works too (an in-shop status)", async () => {
  const o = seedOrder({ status: "received" }, [{}]);
  const r = await markDone(o, o.cards);
  assert.ok(r.ok && r.orderCompletion?.completed === true);
  assert.equal(orderRow(o.id).status, "completed");
  assert.equal(mailTo(o, COMPLETED_SUBJECT).length, 1);
});

test("two requests finishing the last two cards at the same moment send ONE email", async () => {
  const o = seedOrder({}, [DONE, {}, {}]);
  const [a, b] = await Promise.all([markDone(o, [o.cards[1]], "gavin"), markDone(o, [o.cards[2]], "sam")]);
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.equal([a, b].filter((r) => r.orderCompletion?.completed).length, 1, "exactly one request completed the order");
  assert.equal(orderRow(o.id).status, "completed");
  assert.equal(statusEvents(o.id).length, 1);
  assert.equal(autoEvents(o.id).length, 1);
  assert.equal(mailTo(o, COMPLETED_SUBJECT).length, 1);

  // The check itself, twice at once on a finished order: one wins, the other is "taken"
  const p = seedOrder({}, [DONE, DONE]);
  const both = await Promise.all([
    svc.auto.completeOrderIfAllDone(admin, p.id, "gavin"),
    svc.auto.completeOrderIfAllDone(admin, p.id, "sam"),
  ]);
  assert.deepEqual(both.map((r) => r.completed).sort(), [false, true]);
  const loser = both.find((r) => !r.completed)!;
  assert.equal(loser.reason, "taken");
  assert.equal(loser.status, "completed");
  assert.equal(loser.message, undefined);
  assert.equal(statusEvents(p.id).length, 1);
  assert.equal(autoEvents(p.id).length, 1);
  assert.equal(mailTo(p, COMPLETED_SUBJECT).length, 1);
});

test("wrong status or not paid: nothing changes, no email (staff are told when it matters)", async () => {
  const cases: [Row, string, string | undefined][] = [
    [{ status: "awaiting_cards" }, "wrong_status", "Every card is done. The order is Awaiting Cards, so its status wasn't changed."],
    [{ status: "awaiting_payment", payment_status: "pending" }, "wrong_status", "Every card is done. The order is Awaiting Payment, so its status wasn't changed."],
    [{ status: "cancelled", payment_status: "refunded" }, "wrong_status", "Every card is done. The order is Cancelled, so its status wasn't changed."],
    [{ status: "in_progress", payment_status: "pending" }, "not_paid", "Every card is done, but the order isn't paid, so it wasn't marked Completed. Change its status on the order page."],
    [{ status: "in_progress", payment_status: "refunded" }, "not_paid", "Every card is done, but the order isn't paid, so it wasn't marked Completed. Change its status on the order page."],
    [{ status: "completed" }, "already_done", undefined],
    [{ status: "shipped_back" }, "already_done", undefined],
    [{ status: "delivered" }, "already_done", undefined],
  ];
  for (const [over, reason, message] of cases) {
    const o = seedOrder(over, [DONE, {}]);
    const r = await markDone(o, [o.cards[1]]);
    assert.ok(r.ok, `${JSON.stringify(over)}: ${r.ok ? "" : r.error}`);
    if (!r.ok) continue;
    assert.equal(r.completed.length, 1, `${JSON.stringify(over)}: the card is still marked done`);
    assert.equal(r.orderCompletion?.completed, false, JSON.stringify(over));
    assert.equal(r.orderCompletion?.reason, reason, JSON.stringify(over));
    assert.equal(r.orderCompletion?.message, message, JSON.stringify(over));
    assert.equal(orderRow(o.id).status, over.status, `${JSON.stringify(over)}: status unchanged`);
    assert.equal(statusEvents(o.id).length + autoEvents(o.id).length, 0, JSON.stringify(over));
    assert.equal(mailTo(o).length, 0, JSON.stringify(over));
  }
});

test("the held restoration notes go with it (as the status button sends them), once", async () => {
  const o = seedOrder({ admin_notes: "Pressed out the corner bend." }, [{}]);
  mock.store.table("order_events").push({
    id: "00000000-0000-4000-8000-0000000e0001", order_id: o.id, event_type: "completion_notes_held",
    description: "Restoration notes saved.", is_customer_visible: false, created_at: "2026-11-22T15:00:00+00:00",
  });
  const r = await markDone(o, o.cards);
  assert.ok(r.ok && r.orderCompletion?.completed && r.orderCompletion.notesEmailed === "sent");
  assert.deepEqual(mailTo(o).map((m) => m.subject).sort(), [NOTES_SUBJECT, COMPLETED_SUBJECT].sort());
});

test("no email address: completed, nothing sent, and the line says so", async () => {
  const o = seedOrder({ customer_email: "" }, [{}]);
  const r = await markDone(o, o.cards);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.orderCompletion?.completed, true);
  assert.equal(r.orderCompletion?.emailed, false);
  assert.equal(r.orderCompletion?.message, "Order completed. No email sent: the order has no email address.");
  assert.equal(orderRow(o.id).status, "completed");
});

test("the order page's Done toggle: last card completes the order; un-doing never un-completes; redoing sends nothing", async () => {
  const o = seedOrder({}, [DONE, {}]);
  const on = await svc.toggle.toggleCardCompletion(admin, { cardId: o.cards[1], by: "gavin" });
  assert.ok(on.ok);
  if (!on.ok) return;
  assert.equal(on.completed, true);
  assert.equal(on.orderCompletion?.completed, true);
  assert.equal(on.orderCompletion?.message, "Order completed. Pat Collector emailed.");
  assert.equal(orderRow(o.id).status, "completed");
  assert.equal(mailTo(o, COMPLETED_SUBJECT).length, 1);
  assert.equal((autoEvents(o.id)[0]?.metadata as Row | undefined)?.by, "gavin");

  const off = await svc.toggle.toggleCardCompletion(admin, { cardId: o.cards[1], by: "gavin" });
  assert.ok(off.ok);
  if (!off.ok) return;
  assert.equal(off.completed, false);
  assert.equal(off.orderCompletion, undefined, "un-doing a card runs no check");
  assert.equal(orderRow(o.id).status, "completed", "the order stays Completed");

  const back = await svc.toggle.toggleCardCompletion(admin, { cardId: o.cards[1], by: "gavin" });
  assert.ok(back.ok && back.completed && back.orderCompletion?.reason === "already_done");
  assert.equal(mailTo(o).length, 1, "no second email");
  assert.equal(statusEvents(o.id).length, 1);

  // A card that isn't the last: done, the order stays as it is
  const p = seedOrder({}, [{}, {}]);
  const one = await svc.toggle.toggleCardCompletion(admin, { cardId: p.cards[0], by: "gavin" });
  assert.ok(one.ok && one.completed && one.orderCompletion?.reason === "not_all_done");
  assert.equal(orderRow(p.id).status, "in_progress");
  // Unknown card: as before
  const missing = await svc.toggle.toggleCardCompletion(admin, { cardId: "00000000-0000-4000-8000-0000000bffff", by: "gavin" });
  assert.equal(missing.ok, false);
});

test("tracking Done (Scan page / Desk): orderCompletions for each order; one email per order", async () => {
  const o = seedOrder({}, [DONE, {}]);
  const p = seedOrder({}, [{}, {}]);
  const r = await svc.moves.markCardsDone(admin, { cardIds: [o.cards[1], p.cards[0]], by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  const byOrder = new Map((r.orderCompletions ?? []).map((c) => [c.orderId, c]));
  assert.equal(byOrder.size, 2);
  assert.equal(byOrder.get(o.id)?.completed, true);
  assert.equal(byOrder.get(o.id)?.message, "Order completed. Pat Collector emailed.");
  assert.equal(byOrder.get(p.id)?.reason, "not_all_done");
  assert.equal(orderRow(o.id).status, "completed");
  assert.equal(orderRow(p.id).status, "in_progress");
  assert.equal(mailTo(o, COMPLETED_SUBJECT).length, 1);
  assert.equal(mailTo(p).length, 0);

  // Again: nothing newly done, no check, no email
  const again = await svc.moves.markCardsDone(admin, { cardIds: [o.cards[1]], by: "gavin" });
  assert.ok(again.ok && !again.orderCompletions);
  assert.equal(mailTo(o).length, 1);

  // Putting a card in a slot (not done) never runs the check
  const q = seedOrder({}, [{}]);
  mock.store.table("locations").push({ id: "00000000-0000-4000-8000-0000000f0010", code: "LOC-HUMIDOR-01", name: "HUMIDOR 01", kind: "station",
    station: "humidor", serial: 1, stage: "Humidor", capacity: null, sort: 10, active: true, created_at: "2026-11-24T00:00:00+00:00" });
  const put = await svc.moves.assignCards(admin, { locationCode: "LOC-HUMIDOR-01", cardIds: q.cards, by: "gavin" });
  assert.ok(put.ok && !put.orderCompletions);
  assert.equal(orderRow(q.id).status, "in_progress");
});

test("the staff line for each outcome", () => {
  const base = { orderId: "o", orderNumber: "CD-1", customerName: "Pat Collector", status: "completed" };
  assert.equal(svc.auto.autoCompleteMessage({ ...base, completed: true, emailed: true }, true), "Order completed. Pat Collector emailed.");
  assert.equal(svc.auto.autoCompleteMessage({ ...base, completed: true, emailed: false }, true), "Order completed, but the email to Pat Collector didn't send.");
  assert.equal(svc.auto.autoCompleteMessage({ ...base, customerName: null, completed: true, emailed: true }, true), "Order completed. Customer emailed.");
  assert.equal(svc.auto.autoCompleteMessage({ ...base, status: "in_progress", completed: false, emailed: false, reason: "failed", error: "boom" }, true),
    "Every card is done, but the order couldn't be marked Completed (boom). Change its status on the order page.");
  for (const reason of ["not_all_done", "no_cards", "already_done", "taken"] as const) {
    assert.equal(svc.auto.autoCompleteMessage({ ...base, completed: false, emailed: false, reason }, true), undefined, reason);
  }
  assert.deepEqual([...svc.auto.AUTO_COMPLETE_FROM], ["received", "in_progress"]);
});
