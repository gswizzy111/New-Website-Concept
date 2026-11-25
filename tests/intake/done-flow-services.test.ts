/**
 * The done flow end to end against the in-memory Supabase stand-in
 * (tests/intake/harness/mock-supabase.mjs): a card out of its bag files the
 * bag in the Open bags box (made on first use), Done (tracking and the step
 * picker's advanceCards) puts the card back in its bag and frees its holder,
 * and a finished bag goes in the Ready to ship bin. No real database; emails
 * are caught at fetch.
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
let moves: typeof import("@/lib/intake/tracking/moves");
let places: typeof import("@/lib/intake/tracking/bag-places");
let stages: typeof import("@/lib/intake/stages");
let shelf: typeof import("@/lib/intake/tracking/shelf");
const sent: { to: unknown; subject: string }[] = [];
const realFetch = globalThis.fetch;

const ORDER = "00000000-0000-4000-8000-0000000a0001";
const BAG = "00000000-0000-4000-8000-0000000ab001";
const C = (n: number) => `00000000-0000-4000-8000-0000000ac0${String(n).padStart(2, "0")}`;
const CLAMP = "00000000-0000-4000-8000-0000000af001";
const CLAMP2 = "00000000-0000-4000-8000-0000000af002";
const DESK = "00000000-0000-4000-8000-0000000af003";
const SHELF = "00000000-0000-4000-8000-0000000af004";

const card = (n: number, over: Row = {}): Row => ({
  id: C(n), order_id: ORDER, card_name: `Charizard ${n}`, card_set: "Base Set", card_year: "1999", card_number: `${n}/102`,
  variation: null, notes: null, photo_urls: [], catalog_image_url: null, tier: null, status: "active",
  completed: false, completed_at: null, current_round: 1, created_at: "2026-11-23T19:00:00.000000+00:00",
  card_seq: n, card_code: `CD-7001-0${n}`, bag_id: BAG, received_at: "2026-11-23T19:30:00+00:00", received_by: "gavin",
  awaiting_arrival: false, receiving_photo_urls: [], location_id: null, located_at: null, refunded_cents: 0, service_ids: [],
  slab_removal_selected: false, pregrade_selected: false, ...over,
});
const placeRow = (id: string, code: string, name: string, kind: string, over: Row = {}): Row => ({
  id, code, name, kind, station: null, serial: null, capacity: null, stage: null, due_date: null, sort: 0, active: true,
  created_at: "2026-11-24T00:00:00+00:00", created_by: "setup", ...over,
});
const cardRow = (id: string) => mock.store.table("cards").find((c) => c.id === id)!;
const bagRow = () => mock.store.table("tier_bags").find((b) => b.id === BAG)!;
const placeOf = (code: string) => mock.store.table("locations").find((l) => l.code === code);

before(async () => {
  const harness = pathToFileURL(path.resolve("tests/intake/harness/mock-supabase.mjs")).href;
  const { startMock } = (await import(harness)) as { startMock: (o: { port: number; quiet: boolean }) => Promise<Mock> };
  mock = await startMock({ port: 0, quiet: true });
  mock.store.load({
    tables: {
      orders: [{
        id: ORDER, order_number: "CD-7001", customer_name: "Maria Reyes", customer_email: "maria@example.com", customer_phone: "555-0100",
        ship_from_address: {}, ship_to_address: {}, subtotal_cents: 10000, total_cents: 10000, refunded_cents: 0,
        slab_crack_count: 0, instagram_feature: false, gift_card_discount_cents: 0, admin_notes: null,
        status: "in_progress", payment_status: "paid", restoration_tier: "premium", inbound_method: "self_ship", customer_notes: null,
        created_at: "2026-11-23T19:00:00+00:00", updated_at: "2026-11-23T19:00:00+00:00",
      }],
      tier_bags: [{
        id: BAG, order_id: ORDER, tier: "premium", batch: 1, bag_code: "CD-7001-G", received_on: "2026-11-16", due_date: "2026-12-07",
        due_status: "calculated", turnaround_days: 15, source: "receiving", created_at: "2026-11-23T19:30:00+00:00",
        location_id: SHELF, located_at: "2026-11-23T19:31:00+00:00",
      }],
      cards: [card(1), card(2), card(3, { status: "refunded" })],
      order_events: [],
      locations: [
        placeRow("00000000-0000-4000-8000-0000000af0d0", "LOC-DONE", "Done", "done", { sort: 900 }),
        placeRow(SHELF, "LOC-SHELF-20261207", "DUE MON DEC 7", "shelf", { due_date: "2026-12-07", sort: 20261207 }),
        placeRow(CLAMP, "LOC-CLAMP-01", "CLAMP 01", "station", { station: "clamp", serial: 1, capacity: 1, stage: "Clamp Work", sort: 1 }),
        placeRow(CLAMP2, "LOC-CLAMP-02", "CLAMP 02", "station", { station: "clamp", serial: 2, capacity: 1, stage: "Clamp Work", sort: 2 }),
        placeRow(DESK, "LOC-DESK", "DESK", "other"),
      ],
      card_moves: [],
      restoration_settings: [{ tier: "premium", display_name: "Gold", turnaround_min_days: 15, turnaround_max_days: 20 }],
      business_holidays: [],
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
  moves = await import("@/lib/intake/tracking/moves");
  places = await import("@/lib/intake/tracking/bag-places");
  stages = await import("@/lib/intake/stages");
  shelf = await import("@/lib/intake/tracking/shelf");
});

after(async () => {
  globalThis.fetch = realFetch;
  await mock?.close();
});

test("the first card out of the bag (to a desk) files the bag in the Open bags box, made on first use", async () => {
  assert.equal(placeOf("LOC-OPEN-BAGS"), undefined, "no box before");
  const r = await moves.assignCards(admin, { locationCode: "LOC-DESK", cardIds: [C(1)], by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.message, "In DESK. Put the bag in the Open bags box, under R.");
  const box = placeOf("LOC-OPEN-BAGS")!;
  assert.deepEqual([box.name, box.kind, box.active], ["OPEN BAGS", "other", true]);
  assert.equal(bagRow().location_id, box.id);
  assert.deepEqual(r.bags?.map((b) => [b.code, b.letter, b.location?.code, b.opened]), [["CD-7001-G", "R", "LOC-OPEN-BAGS", true]]);

  // Again (a second card out, the same card again): the bag is in the box already, nothing more to say
  const again = await moves.assignCards(admin, { locationCode: "LOC-DESK", cardIds: [C(2)], by: "gavin" });
  assert.ok(again.ok && again.message === "In DESK.", again.ok ? again.message : again.error);
  assert.equal(mock.store.table("locations").filter((l) => l.code === "LOC-OPEN-BAGS").length, 1, "one box");
});

test("a card moved holder to holder files nothing: the bag stays where staff left it", async () => {
  // Staff put the bag back on its shelf by hand
  await shelf.shelveBags(admin, { bagIds: [BAG], by: "gavin" });
  assert.equal(bagRow().location_id, SHELF);
  const r = await moves.assignCards(admin, { locationCode: "LOC-CLAMP-01", cardIds: [C(1)], by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.message, "In CLAMP 01. Step: Clamp Work.");
  assert.equal(bagRow().location_id, SHELF, "from the desk: the card was out already");
  assert.equal(r.bags?.[0].opened, false);
});

test("the step picker's Done (advanceCards) puts the card back in its bag and frees its holder", async () => {
  const before = mock.store.table("card_moves").length;
  const r = await stages.advanceCards(admin, { orderId: ORDER, cardIds: [C(1)], fromStages: { [C(1)]: "Clamp Work" }, toStage: "complete", by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.deepEqual(r.completed, [C(1)]);
  assert.deepEqual([cardRow(C(1)).completed, cardRow(C(1)).location_id, cardRow(C(1)).located_at], [true, null, null]);
  const row = mock.store.table("card_moves").slice(before);
  assert.deepEqual(row.map((m) => [m.card_id, m.action, m.from_location_id, m.to_location_id, m.stage_before, m.stage_after, m.by]), [
    [C(1), "done", CLAMP, null, "Clamp Work", "done", "gavin"],
  ]);
  assert.deepEqual(r.bagPlaces?.map((b) => [b.code, b.location?.code, b.returned, b.doneCount, b.cardCount, b.finished]), [
    ["CD-7001-G", "LOC-SHELF-20261207", 1, 1, 2, false],
  ]);
  // CLAMP 01 is free again
  const into = await moves.assignCards(admin, { locationCode: "LOC-CLAMP-01", cardIds: [C(2)], by: "gavin" });
  assert.ok(into.ok, into.ok ? "" : into.error);
});

test("Ready to ship is refused while a card is still to do", async () => {
  const r = await places.putBagReadyToShip(admin, { bagId: BAG, by: "gavin" });
  assert.deepEqual(r, { ok: false, status: 409, error: "Not every card in CD-7001-G is done yet (1 of 2 done)." });
  assert.equal(bagRow().location_id, SHELF);
  const nope = await places.putBagReadyToShip(admin, { bagId: "00000000-0000-4000-8000-000000000000", by: "gavin" });
  assert.ok(!nope.ok && nope.status === 404);
  const bad = await places.putBagReadyToShip(admin, { bagId: "junk", by: "gavin" });
  assert.ok(!bad.ok && bad.status === 404);
});

test("the bag's last card done: back in its bag, \"Bag finished\", the order completes once", async () => {
  const emails = sent.length;
  const r = await moves.markCardsDone(admin, { cardIds: [C(2)], by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.location, null);
  assert.equal(r.message, "Done. Put it back in REYES's bag: on shelf DUE MON DEC 7. Bag finished: put it in the Ready to ship bin.");
  assert.deepEqual([cardRow(C(2)).completed, cardRow(C(2)).location_id], [true, null]);
  assert.deepEqual(r.bagsCompleted, [BAG]);
  assert.deepEqual(r.freed.map((l) => l.code), ["LOC-CLAMP-01"]);
  assert.deepEqual(r.bags?.map((b) => [b.finished, b.returned, b.doneCount, b.cardCount]), [[true, 1, 2, 2]]);
  // The order's last card (card 3 is refunded): Completed, the customer's usual email, once
  assert.equal(r.orderCompletions?.[0]?.completed, true, JSON.stringify(r.orderCompletions));
  assert.equal(sent.length, emails + 1, "the completed email only: no step email for Done");
});

test("Ready to ship: the finished bag goes to LOC-SHIP; again changes nothing", async () => {
  const r = await places.putBagReadyToShip(admin, { bagId: BAG, by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.deepEqual([r.changed, r.message, r.bag.location?.code, r.bag.finished, r.bag.letter], [true, "In the Ready to ship bin.", "LOC-SHIP", true, "R"]);
  const ship = placeOf("LOC-SHIP")!;
  assert.deepEqual([ship.kind, ship.name], ["shipping", "Shipping"], "made when the seed is missing");
  assert.equal(bagRow().location_id, ship.id);
  const again = await places.putBagReadyToShip(admin, { bagId: BAG, by: "gavin" });
  assert.ok(again.ok && again.changed === false);
});

test("a switched-off Open bags box is switched back on when a bag needs it", async () => {
  const box = placeOf("LOC-OPEN-BAGS")!;
  box.active = false;
  // Card 1 comes out again (re-checked on the desk): its bag leaves the Ready to ship bin for the box
  const r = await moves.assignCards(admin, { locationCode: "LOC-DESK", cardIds: [C(1)], by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(placeOf("LOC-OPEN-BAGS")!.active, true);
  assert.equal(bagRow().location_id, box.id);
  assert.match(r.message, /Put the bag in the Open bags box, under R\.$/);
});

test("the order page's Done toggle ends like every Done: back in its bag, off the desk, one 'done' move row; un-doing moves nothing", async () => {
  const toggle = await import("@/lib/intake/card-completion");
  const { bagSentences } = await import("@/lib/intake/tracking/bag-home");
  const emails = sent.length;
  // Card 1 is done and on the desk (the test before): un-done, it stays where it is
  assert.deepEqual([cardRow(C(1)).completed, cardRow(C(1)).location_id], [true, DESK]);
  const off = await toggle.toggleCardCompletion(admin, { cardId: C(1), by: "gavin" });
  assert.ok(off.ok && off.completed === false && !off.bagPlaces && !off.orderCompletion, JSON.stringify(off));
  assert.equal(cardRow(C(1)).location_id, DESK, "un-doing never moves the card");
  assert.equal(bagRow().completed_at, null, "the bag reopens");

  const before = mock.store.table("card_moves").length;
  const on = await toggle.toggleCardCompletion(admin, { cardId: C(1), by: "gavin" });
  assert.ok(on.ok, on.ok ? "" : on.error);
  if (!on.ok) return;
  assert.equal(on.completed, true);
  assert.deepEqual([cardRow(C(1)).completed, cardRow(C(1)).location_id, cardRow(C(1)).located_at], [true, null, null]);
  assert.deepEqual(mock.store.table("card_moves").slice(before).map((m) => [m.card_id, m.action, m.from_location_id, m.to_location_id, m.stage_before, m.stage_after, m.by]), [
    [C(1), "done", DESK, null, "Clamp Work", "done", "gavin"],
  ]);
  assert.ok(bagRow().completed_at, "the bag is finished again");
  assert.deepEqual(on.bagPlaces?.map((b) => [b.code, b.location?.code, b.returned, b.doneCount, b.cardCount, b.finished]), [
    ["CD-7001-G", "LOC-OPEN-BAGS", 1, 2, 2, true],
  ]);
  assert.equal(bagSentences(on.bagPlaces ?? [], 1), "Put it back in REYES's bag: Open bags box, under R. Bag finished: put it in the Ready to ship bin.");
  // The order completed already (the test before): no second email
  assert.equal(on.orderCompletion?.reason, "already_done");
  assert.equal(sent.length, emails);

  // A card in no place: done all the same, no move row
  const off2 = await toggle.toggleCardCompletion(admin, { cardId: C(2), by: "gavin" });
  assert.ok(off2.ok && !off2.completed);
  const rows = mock.store.table("card_moves").length;
  const on2 = await toggle.toggleCardCompletion(admin, { cardId: C(2), by: "gavin" });
  assert.ok(on2.ok && on2.completed && on2.bagPlaces?.[0]?.returned === 1);
  assert.equal(mock.store.table("card_moves").length, rows, "nothing to move");
});
