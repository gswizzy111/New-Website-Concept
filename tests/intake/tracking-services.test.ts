/**
 * Slot tracking end to end (lib/intake/tracking: slots, assign, move, take
 * out, done, resolve, search, ship check, history, shelf slots) against the
 * in-memory Supabase stand-in (tests/intake/harness/mock-supabase.mjs). No
 * real database. Customer emails are caught at fetch (Resend's API calls),
 * so this file never shares an email box with the other test files.
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
  moves: typeof import("@/lib/intake/tracking/moves");
  locations: typeof import("@/lib/intake/tracking/locations");
  resolve: typeof import("@/lib/intake/tracking/resolve");
  history: typeof import("@/lib/intake/tracking/history");
  ship: typeof import("@/lib/intake/tracking/ship-check");
  shelf: typeof import("@/lib/intake/tracking/shelf");
  data: typeof import("@/lib/intake/data");
};
const sent: { to: unknown; subject: string; html: string }[] = [];
const realFetch = globalThis.fetch;

const ORDER = "00000000-0000-4000-8000-0000000d0001";
const ORDER2 = "00000000-0000-4000-8000-0000000d0002";
const BAG = "00000000-0000-4000-8000-0000000db001";
const BAG2 = "00000000-0000-4000-8000-0000000db002";
const cid = (n: number, order = ORDER) => `00000000-0000-4000-8000-0000000${order === ORDER ? "c" : "e"}00${String(n).padStart(2, "0")}`;
const C = (n: number) => cid(n);
const D = (n: number) => cid(n, ORDER2);

const card = (n: number, order: string, over: Row = {}): Row => ({
  id: cid(n, order), order_id: order, card_name: `${order === ORDER ? "Charizard" : "Blastoise"} ${n}`, card_set: "Base Set", card_year: "1999",
  card_number: `${n}/102`, variation: null, notes: null, photo_urls: [], catalog_image_url: null, tier: null, status: "active",
  completed: false, completed_at: null, current_round: 1, created_at: "2026-11-23T19:00:00.000000+00:00",
  card_seq: n, card_code: `${order === ORDER ? "CD-4001" : "CD-4002"}-${String(n).padStart(2, "0")}`,
  bag_id: order === ORDER ? BAG : BAG2, received_at: "2026-11-23T19:30:00+00:00", received_by: "gavin",
  awaiting_arrival: false, receiving_photo_urls: [], location_id: null, located_at: null, refunded_cents: 0, service_ids: [],
  slab_removal_selected: false, pregrade_selected: false, ...over,
});
const order = (id: string, num: string, name: string, email: string): Row => ({
  id, order_number: num, customer_name: name, customer_email: email, customer_phone: null, status: "in_progress",
  payment_status: "paid", restoration_tier: "premium", inbound_method: "self_ship", customer_notes: null,
  created_at: "2026-11-23T19:00:00+00:00", updated_at: "2026-11-23T19:00:00+00:00",
});
const tick = () => new Promise((r) => setTimeout(r, 5));
const stageEvents = (orderId?: string) => mock.store.table("order_events")
  .filter((e) => e.event_type === "stage_update" && (!orderId || e.order_id === orderId));
const moves = () => mock.store.table("card_moves");
const cardRow = (id: string) => mock.store.table("cards").find((c) => c.id === id)!;
const loc = (code: string) => mock.store.table("locations").find((l) => l.code === code)!;

before(async () => {
  const harness = pathToFileURL(path.resolve("tests/intake/harness/mock-supabase.mjs")).href;
  const { startMock } = (await import(harness)) as { startMock: (o: { port: number; quiet: boolean }) => Promise<Mock> };
  mock = await startMock({ port: 0, quiet: true });
  mock.store.load({
    tables: {
      orders: [order(ORDER, "CD-4001", "Pat Collector", "pat@example.com"), order(ORDER2, "CD-4002", "Sam Collector", "sam@example.com")],
      tier_bags: [
        { id: BAG, order_id: ORDER, tier: "premium", batch: 1, bag_code: "CD-4001-G", received_on: "2026-11-16", due_date: "2026-12-07",
          due_status: "calculated", turnaround_days: 15, source: "receiving", created_at: "2026-11-23T19:30:00+00:00" },
        { id: BAG2, order_id: ORDER2, tier: "premium", batch: 1, bag_code: "CD-4002-G", received_on: "2026-11-23", due_date: null,
          due_status: "needs_review", turnaround_days: null, source: "receiving", created_at: "2026-11-23T19:30:00+00:00" },
      ],
      cards: [
        card(1, ORDER), card(2, ORDER), card(3, ORDER), card(4, ORDER),
        card(5, ORDER, { status: "refunded" }),
        card(6, ORDER, { bag_id: null, received_at: null, awaiting_arrival: true, card_code: null, card_seq: 6 }),
        card(1, ORDER2), card(2, ORDER2),
      ],
      order_events: [
        // Card 4 is already at Humidor
        { id: "00000000-0000-4000-8000-00000000ee01", order_id: ORDER, event_type: "stage_update", description: `Stage: Humidor [card:${C(4)}]`,
          metadata: { card_id: C(4), stage: "Humidor", round: 1, by: "gavin", bulk: false }, is_customer_visible: true, created_at: "2026-11-24T10:00:00+00:00" },
      ],
      locations: [
        { id: "00000000-0000-4000-8000-0000000f0001", code: "LOC-DONE", name: "Done", kind: "done", sort: 900, active: true, created_at: "2026-11-24T00:00:00+00:00" },
        { id: "00000000-0000-4000-8000-0000000f0002", code: "LOC-SHIP", name: "Shipping", kind: "shipping", sort: 1000, active: true, created_at: "2026-11-24T00:00:00+00:00" },
      ],
      card_moves: [],
      restoration_settings: [{ tier: "premium", display_name: "Gold", turnaround_min_days: 15, turnaround_max_days: 20 }],
      business_holidays: [],
    },
  });
  // Catch Resend's API calls (the SDK calls the global fetch at send time)
  const resendBase = process.env.RESEND_BASE_URL ?? "https://api.resend.com";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(resendBase) || url.startsWith("https://api.resend.com")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      sent.push({ to: body.to, subject: body.subject, html: body.html });
      return new Response(JSON.stringify({ id: `email-${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  admin = createClient(mock.url, "service-role-test-key", { auth: { persistSession: false } });
  svc = {
    moves: await import("@/lib/intake/tracking/moves"),
    locations: await import("@/lib/intake/tracking/locations"),
    resolve: await import("@/lib/intake/tracking/resolve"),
    history: await import("@/lib/intake/tracking/history"),
    ship: await import("@/lib/intake/tracking/ship-check"),
    shelf: await import("@/lib/intake/tracking/shelf"),
    data: await import("@/lib/intake/data"),
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await mock?.close();
});

test("slots are made in numbered runs: CLAMP 01..03, then 04..05; numbers in use are skipped", async () => {
  const a = await svc.locations.createSlots(admin, { station: "clamp", count: 3, by: "gavin" });
  assert.ok(a.ok, a.ok ? "" : a.error);
  if (!a.ok) return;
  assert.deepEqual(a.created.map((l) => [l.code, l.name, l.kind, l.stage, l.capacity, l.serial, l.stationName]), [
    ["LOC-CLAMP-01", "CLAMP 01", "station", "Clamp Work", 1, 1, "Clamp"],
    ["LOC-CLAMP-02", "CLAMP 02", "station", "Clamp Work", 1, 2, "Clamp"],
    ["LOC-CLAMP-03", "CLAMP 03", "station", "Clamp Work", 1, 3, "Clamp"],
  ]);
  assert.equal(a.created[0].qrUrl.endsWith("/Q/LOC-CLAMP-01"), true);
  const b = await svc.locations.createSlots(admin, { station: "clamp", count: 2, by: "gavin" });
  assert.ok(b.ok && b.created.map((l) => l.code).join() === "LOC-CLAMP-04,LOC-CLAMP-05" && b.skipped.length === 0);
  const c = await svc.locations.createSlots(admin, { station: "clamp", count: 2, startAt: 5, by: "gavin" });
  assert.ok(c.ok);
  if (c.ok) assert.deepEqual([c.created.map((l) => l.code), c.skipped], [["LOC-CLAMP-06"], ["LOC-CLAMP-05"]]);
  const h = await svc.locations.createSlots(admin, { station: "heat-press", count: 2, by: "gavin" });
  assert.ok(h.ok && h.created.map((l) => l.name).join() === "HEAT PRESS 01,HEAT PRESS 02");
  // Every slot holds one card (owner, Nov 26 2026), a heat press too: stored as 1
  assert.ok(h.ok && h.created.every((l) => l.capacity === 1), "new heat press slots hold one card");
  assert.ok(["LOC-HEAT-PRESS-01", "LOC-CLAMP-01"].every((c) => loc(c).capacity === 1));
  // Its limit can't change: 1 is accepted (tidying), anything else is refused
  const one = await svc.locations.updateLocation(admin, { id: loc("LOC-HEAT-PRESS-01").id as string, capacity: 1 });
  assert.ok(one.ok && one.location.capacity === 1);
  const stack = await svc.locations.updateLocation(admin, { id: loc("LOC-HEAT-PRESS-01").id as string, capacity: null });
  assert.ok(!stack.ok && stack.status === 400 && stack.error === "HEAT PRESS 01 holds one card (the owner's rule), so its limit can't change.");
  assert.equal(loc("LOC-HEAT-PRESS-01").capacity, 1);
  const bad = await svc.locations.createSlots(admin, { station: "toaster", count: 2, by: "gavin" });
  assert.ok(!bad.ok && bad.status === 400);
  const tooMany = await svc.locations.createSlots(admin, { station: "clamp", count: 201, by: "gavin" });
  assert.ok(!tooMany.ok && tooMany.status === 400);
  // Other places get a code from the name
  const t1 = await svc.locations.createLocation(admin, { name: "Back table", kind: "other", by: "gavin" });
  const t2 = await svc.locations.createLocation(admin, { name: "Back  table", kind: "other", by: "gavin" });
  assert.ok(t1.ok && t2.ok && t1.location.code === "LOC-BACK-TABLE" && t2.location.code === "LOC-BACK-TABLE-2");
  // An other place that isn't a desk holds one card too (stored as 1)
  assert.deepEqual([t1.ok && t1.location.capacity, loc("LOC-BACK-TABLE").capacity], [1, 1]);
  // A desk (Places: "Add a desk" sends { name: "DESK <NAME>", kind: "other" })
  const d1 = await svc.locations.createLocation(admin, { name: "DESK GAVIN", kind: "other", by: "gavin" });
  assert.ok(d1.ok && d1.location.code === "LOC-DESK-GAVIN" && d1.location.kind === "other" && d1.location.capacity === null);
  assert.equal(loc("LOC-DESK-GAVIN").capacity, null, "a desk has no limit");
  const st = await svc.locations.createLocation(admin, { name: "x", kind: "station", by: "gavin" });
  assert.ok(!st.ok && st.status === 400);
});

test("a LOC code resolves to its place (for /q and the Scan page)", async () => {
  const found = await svc.data.resolveCode(admin, "https://thecarddoc1.com/q/loc-clamp-01");
  assert.deepEqual(found, { kind: "location", id: loc("LOC-CLAMP-01").id, code: "LOC-CLAMP-01" });
  assert.equal(await svc.data.resolveCode(admin, "LOC-CLAMP-99"), null);
});

test("assign: a holder takes one card; several at once, or force, are refused; the step is set and the customer emailed", async () => {
  const several = await svc.moves.assignCards(admin, { locationCode: "LOC-HEAT-PRESS-01", cardIds: [C(1), C(2)], by: "gavin" });
  assert.ok(!several.ok && several.status === 409 && several.full?.holderFull && !several.conflict);
  if (several.ok) return;
  assert.equal(several.error, "HEAT PRESS 01 holds one card. Pick one card to put here.");
  assert.deepEqual([several.full?.holder, several.full?.occupants], [{ code: "LOC-HEAT-PRESS-01", name: "HEAT PRESS 01" }, []]);
  const forced = await svc.moves.assignCards(admin, { locationCode: "LOC-HEAT-PRESS-01", cardIds: [C(1), C(2)], force: true, by: "gavin" });
  assert.ok(!forced.ok && forced.status === 409 && forced.error === several.error, "force can't bypass it");
  assert.equal(moves().length, 0, "nothing written");

  const r = await svc.moves.assignCards(admin, { locationCode: "HTTPS://THECARDDOC1.COM/Q/LOC-HEAT-PRESS-01", cardIds: [C(1)], by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.location?.code, "LOC-HEAT-PRESS-01");
  // The first card out of the bag files it in the Open bags box (made on first use), under C for Collector
  assert.equal(r.message, "In HEAT PRESS 01. Step: Heat Press. Put the bag in the Open bags box, under C.");
  assert.equal(r.changed, 1);
  assert.deepEqual([loc("LOC-OPEN-BAGS").name, loc("LOC-OPEN-BAGS").kind], ["OPEN BAGS", "other"]);
  assert.equal(mock.store.table("tier_bags").find((b) => b.id === BAG)!.location_id, loc("LOC-OPEN-BAGS").id);
  assert.deepEqual(r.bags?.map((b) => [b.code, b.letter, b.location?.code, b.opened, b.doneCount, b.cardCount]), [["CD-4001-G", "C", "LOC-OPEN-BAGS", true, 0, 4]]);
  assert.deepEqual(r.emailedOrders, [ORDER]);
  assert.deepEqual(stageEvents(ORDER).filter((e) => (e.metadata as Row).stage === "Heat Press").map((e) => [e.description, (e.metadata as Row).bulk, (e.metadata as Row).by, e.is_customer_visible]), [
    [`Stage: Heat Press [card:${C(1)}]`, false, "gavin", true],
  ]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, "Update on your card — Heat press (Order #CD-4001)");
  assert.equal(cardRow(C(1)).location_id, loc("LOC-HEAT-PRESS-01").id);
  assert.ok(cardRow(C(1)).located_at);
  assert.deepEqual(moves().map((m) => [m.card_id, m.action, m.from_location_id, m.to_location_id, m.stage_before, m.stage_after, m.by]), [
    [C(1), "assign", null, loc("LOC-HEAT-PRESS-01").id, null, "Heat Press", "gavin"],
  ]);

  // A second card: refused, force or not, with the card that's in it
  const second = await svc.moves.assignCards(admin, { locationCode: "LOC-HEAT-PRESS-01", cardIds: [C(2)], force: true, by: "gavin" });
  assert.ok(!second.ok && second.status === 409);
  if (second.ok) return;
  assert.equal(second.error, "HEAT PRESS 01 already has a card (CD-4001-01 · Charizard 1). Take it out first, or pick another holder.");
  assert.deepEqual(second.full?.occupants.map((c) => c.code), ["CD-4001-01"]);
  assert.equal(cardRow(C(2)).location_id, null);
  assert.equal(moves().length, 1);
});

test("assigning again changes nothing: no event, no email, no move row", async () => {
  const before = { events: stageEvents().length, moves: moves().length, emails: sent.length };
  const r = await svc.moves.assignCards(admin, { locationCode: "LOC-HEAT-PRESS-01", cardIds: [C(1)], by: "gavin" });
  assert.ok(r.ok && r.changed === 0 && r.message === "Already in HEAT PRESS 01.");
  assert.deepEqual({ events: stageEvents().length, moves: moves().length, emails: sent.length }, before);
});

test("a holder with a card shows what's in it; no \"Add anyway\"", async () => {
  const r = await svc.moves.assignCards(admin, { locationCode: "LOC-HEAT-PRESS-01", cardIds: [C(3)], by: "gavin" });
  assert.ok(!r.ok && r.status === 409 && r.full && !r.conflict);
  if (r.ok || !r.full) return;
  assert.deepEqual(r.full.occupants.map((c) => c.code), ["CD-4001-01"]);
  assert.equal(r.error, "HEAT PRESS 01 already has a card (CD-4001-01 · Charizard 1). Take it out first, or pick another holder.");
});

test("cards of two orders, one per holder: each step is set and each customer emailed", async () => {
  await tick();
  const emails = sent.length;
  const d1 = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-01", cardIds: [D(1)], by: "gavin" });
  assert.ok(d1.ok && d1.emailedOrders.join() === ORDER2, d1.ok ? d1.message : d1.error);
  await tick();
  // Card 4 goes Humidor -> Clamp Work; card 2 not started -> Clamp Work
  const c4 = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-05", cardIds: [C(4)], by: "gavin" });
  assert.ok(c4.ok && c4.emailedOrders.join() === ORDER, c4.ok ? c4.message : c4.error);
  await tick();
  const c2 = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-04", cardIds: [C(2)], by: "gavin" });
  assert.ok(c2.ok && c2.emailedOrders.join() === ORDER, c2.ok ? c2.message : c2.error);
  assert.equal(sent.length - emails, 3);
  const sam = sent.slice(emails).find((e) => JSON.stringify(e.to).includes("sam@example.com"))!;
  assert.equal(sam.subject, "Update on your card — Clamp work (Order #CD-4002)");
  assert.match(sam.html, /Blastoise 1/);
  const clamps = ["LOC-CLAMP-01", "LOC-CLAMP-04", "LOC-CLAMP-05"].map((c) => loc(c).id);
  assert.deepEqual(moves().filter((m) => clamps.includes(m.to_location_id)).map((m) => [m.card_id, m.stage_before, m.stage_after]).sort(), [
    [C(2), null, "Clamp Work"], [C(4), "Humidor", "Clamp Work"], [D(1), null, "Clamp Work"],
  ].sort());
  // CLAMP 01 has order 2's card: the other one is refused
  const d2 = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-01", cardIds: [D(2)], force: true, by: "gavin" });
  assert.ok(!d2.ok && d2.error === "CLAMP 01 already has a card (CD-4002-01 · Blastoise 1). Take it out first, or pick another holder.");
});

test("move: a slot's card goes to the next slot, the old slot frees up, the step follows; a holder with a card refuses it", async () => {
  await tick();
  const emails = sent.length;
  const r = await svc.moves.moveSlot(admin, { fromCode: "LOC-HEAT-PRESS-01", toCode: "LOC-CLAMP-02", by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.changed, 1);
  assert.deepEqual(r.freed.map((l) => l.code), ["LOC-HEAT-PRESS-01"]);
  assert.equal(cardRow(C(1)).location_id, loc("LOC-CLAMP-02").id);
  assert.equal(sent.length - emails, 1, "one email for the order");
  assert.deepEqual(moves().slice(-1).map((m) => [m.action, m.from_location_id, m.stage_before, m.stage_after]), [
    ["move", loc("LOC-HEAT-PRESS-01").id, "Heat Press", "Clamp Work"],
  ]);
  const empty = await svc.moves.moveSlot(admin, { fromCode: "LOC-HEAT-PRESS-01", toCode: "LOC-CLAMP-03", by: "gavin" });
  assert.ok(!empty.ok && empty.status === 409 && /HEAT PRESS 01 is empty/.test(empty.error));
  const same = await svc.moves.moveSlot(admin, { fromCode: "LOC-CLAMP-02", toCode: "loc-clamp-02", by: "gavin" });
  assert.ok(!same.ok && same.status === 400);
  // Into a holder that has a card: refused, force or not; nothing moves
  const before = moves().length;
  for (const force of [false, true]) {
    const full = await svc.moves.moveSlot(admin, { fromCode: "LOC-CLAMP-04", toCode: "LOC-CLAMP-02", force, by: "gavin" });
    assert.ok(!full.ok && full.status === 409 && full.full);
    if (!full.ok) assert.equal(full.error, "CLAMP 02 already has a card (CD-4001-01 · Charizard 1). Take it out first, or pick another holder.");
  }
  assert.deepEqual([moves().length, cardRow(C(2)).location_id], [before, loc("LOC-CLAMP-04").id]);
});

test("backwards: into a heat press (an earlier step) the step is Heat Press; a staff-only event, no email", async () => {
  await tick();
  const before = { events: stageEvents().length, emails: sent.length };
  const r = await svc.moves.moveSlot(admin, { fromCode: "LOC-CLAMP-02", toCode: "LOC-HEAT-PRESS-02", cardIds: [C(1)], by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.results[0].message, "In HEAT PRESS 02. Step: Heat Press.");
  assert.deepEqual(r.emailedOrders, []);
  assert.deepEqual({ events: stageEvents().length, emails: sent.length }, { ...before, events: before.events + 1 });
  const back = stageEvents(ORDER).at(-1)!;
  assert.deepEqual([back.description, (back.metadata as Row).stage, back.is_customer_visible], [`Stage: Heat Press [card:${C(1)}]`, "Heat Press", false]);
  const loaded = await svc.data.loadCard(admin, C(1));
  assert.ok(loaded.ok && loaded.card.stage.current === "Heat Press" && loaded.card.stage.furthestIndex === 5);
  assert.equal(cardRow(C(1)).location_id, loc("LOC-HEAT-PRESS-02").id);
  assert.deepEqual(r.freed.map((l) => l.code), ["LOC-CLAMP-02"]);
  // CLAMP 02 is free now: card 2 goes in it
  const c2 = await svc.moves.moveSlot(admin, { fromCode: "LOC-CLAMP-04", toCode: "LOC-CLAMP-02", by: "gavin" });
  assert.ok(c2.ok && c2.changed === 1, c2.ok ? c2.message : c2.error);
  const notInside = await svc.moves.moveSlot(admin, { fromCode: "LOC-CLAMP-02", toCode: "LOC-CLAMP-03", cardIds: [C(2), C(1)], by: "gavin" });
  assert.ok(notInside.ok);
  if (!notInside.ok) return;
  assert.deepEqual(notInside.results.map((x) => [x.cardId, x.ok, x.message]), [
    [C(2), true, "In CLAMP 03."], [C(1), false, "Not in CLAMP 02 any more."],
  ]);
  const backAgain = await svc.moves.moveSlot(admin, { fromCode: "LOC-CLAMP-03", toCode: "LOC-CLAMP-02", by: "gavin" });
  assert.ok(backAgain.ok && backAgain.changed === 1);
});

test("coming back to Clamp Work (reached before this round) and skipping on to Final Dry: only the new step emails", async () => {
  await tick();
  const before = { events: stageEvents().length, emails: sent.length };
  const again = await svc.moves.moveSlot(admin, { fromCode: "LOC-HEAT-PRESS-02", toCode: "LOC-CLAMP-03", cardIds: [C(1)], by: "gavin" });
  assert.ok(again.ok && again.results[0].message === "In CLAMP 03. Step: Clamp Work.", again.ok ? again.message : again.error);
  assert.deepEqual({ events: stageEvents().length, emails: sent.length }, { ...before, events: before.events + 1 });
  assert.equal(stageEvents(ORDER).at(-1)!.is_customer_visible, false);
  await tick();
  const fd = await svc.locations.createSlots(admin, { station: "final-dry", count: 1, by: "gavin" });
  assert.ok(fd.ok);
  const on = await svc.moves.moveSlot(admin, { fromCode: "LOC-CLAMP-03", toCode: "LOC-FINAL-DRY-01", cardIds: [C(1)], by: "gavin" });
  assert.ok(on.ok, on.ok ? "" : on.error);
  if (!on.ok) return;
  assert.deepEqual(on.emailedOrders, [ORDER]);
  assert.equal(sent.length, before.emails + 1);
  assert.equal(sent.at(-1)!.subject, "Update on your card — Final drying (Order #CD-4001)");
  assert.equal(stageEvents(ORDER).at(-1)!.is_customer_visible, true);
  // Back where the rest of this file expects it: HEAT PRESS 02, at Heat Press, no email
  await tick();
  const home = await svc.moves.moveSlot(admin, { fromCode: "LOC-FINAL-DRY-01", toCode: "LOC-HEAT-PRESS-02", cardIds: [C(1)], by: "gavin" });
  assert.ok(home.ok && home.changed === 1 && home.emailedOrders.length === 0);
  assert.equal(sent.length, before.emails + 1);
});

test("refunded and not-arrived cards are refused; nothing is written for them", async () => {
  const before = moves().length;
  const r = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-03", cardIds: [C(5), C(6)], by: "gavin" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.results.map((x) => [x.ok, x.message]), [
    [false, "CD-4001-05 was refunded. Not moved."],
    [false, "Charizard 6 hasn't been received yet. Receive it first."],
  ]);
  assert.equal(moves().length, before);
  const bad = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-03", cardIds: ["not-a-uuid"], by: "gavin" });
  assert.ok(!bad.ok && bad.status === 400);
  const nowhere = await svc.moves.assignCards(admin, { locationCode: "LOC-NOPE-01", cardIds: [C(1)], by: "gavin" });
  assert.ok(!nowhere.ok && nowhere.status === 404);
});

test("take out: the card has no place, its step stays, the slot frees up", async () => {
  const r = await svc.moves.releaseCards(admin, { cardIds: [C(1)], by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.location, null);
  assert.deepEqual(r.freed.map((l) => l.code), ["LOC-HEAT-PRESS-02"]);
  assert.equal(cardRow(C(1)).location_id, null);
  assert.equal(cardRow(C(1)).located_at, null);
  assert.deepEqual([moves().at(-1)!.action, moves().at(-1)!.to_location_id, moves().at(-1)!.stage_after], ["release", null, "Heat Press"]);
  const again = await svc.moves.releaseCards(admin, { cardIds: [C(1)], by: "gavin" });
  assert.ok(again.ok && again.changed === 0 && again.message === "Not in a slot.");
});

test("done: cards marked done go back in their bag (no place), their slots free up, the bag completes, no email", async () => {
  const emails = sent.length;
  const r = await svc.moves.markCardsDone(admin, { cardIds: [C(1), C(2), C(3), C(4)], by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.location, null, "in the bag, not on the Done shelf");
  assert.deepEqual(r.bagsCompleted, [BAG], "card 5 is refunded, card 6 is in no bag");
  assert.deepEqual(r.freed.map((l) => l.code).sort(), ["LOC-CLAMP-02", "LOC-CLAMP-05"], "card 1 was taken out and card 3 never went in");
  for (const n of [1, 2, 3, 4]) {
    assert.equal(cardRow(C(n)).completed, true);
    assert.equal(cardRow(C(n)).location_id, null);
    assert.equal(cardRow(C(n)).located_at, null);
  }
  assert.equal(r.message, "4 cards done. Put them back in COLLECTOR's bag: Open bags box, under C. Bag finished: put it in the Ready to ship bin.");
  assert.deepEqual(r.bags?.map((b) => [b.code, b.location?.code, b.opened, b.returned, b.finished, b.doneCount, b.cardCount]), [
    ["CD-4001-G", "LOC-OPEN-BAGS", false, 4, true, 4, 4],
  ]);
  assert.equal(mock.store.table("tier_bags").find((b) => b.id === BAG)!.location_id, loc("LOC-OPEN-BAGS").id, "Done never moves the bag");
  assert.equal(sent.length, emails);
  assert.ok(mock.store.table("tier_bags").find((b) => b.id === BAG)!.completed_at);
  assert.deepEqual(moves().slice(-4).map((m) => [m.action, m.stage_after]), Array(4).fill(["done", "done"]));
});

test("resolve: a slot with its cards and capacity; a bag and an order with their cards' slots", async () => {
  // A slot holding 2 cards from before the one-card rule (written straight in the table): over what it holds
  cardRow(D(2)).location_id = loc("LOC-CLAMP-01").id;
  cardRow(D(2)).located_at = "2026-11-24T12:00:00+00:00";
  const s = await svc.resolve.resolveTrackCode(admin, "https://thecarddoc1.com/q/loc-clamp-01");
  assert.ok(s.ok, s.ok ? "" : s.error);
  if (!s.ok || s.response.kind !== "location") return;
  const slot = s.response.location;
  assert.deepEqual([slot.code, slot.name, slot.stageLabel, slot.capacity, slot.cardCount, slot.free, slot.overCapacity], ["LOC-CLAMP-01", "CLAMP 01", "Clamp Work", 1, 2, false, true]);
  assert.deepEqual(slot.cards.map((c) => [c.code, c.customer, c.stageLabel, c.dueDate]).sort(), [
    ["CD-4002-01", "Sam Collector", "Clamp Work", null], ["CD-4002-02", "Sam Collector", "Not started", null],
  ]);
  const empty = await svc.resolve.resolveTrackCode(admin, "LOC-HEAT-PRESS-01");
  assert.ok(empty.ok && empty.response.kind === "location" && empty.response.location.free && empty.response.location.cards.length === 0);

  const b = await svc.resolve.resolveTrackCode(admin, "CD-4001-G");
  assert.ok(b.ok && b.response.kind === "bag");
  if (!b.ok || b.response.kind !== "bag") return;
  assert.deepEqual([b.response.bag.cardCount, b.response.bag.doneCount, b.response.bag.complete, b.response.bag.tierName], [4, 4, true, "Gold"]);
  assert.deepEqual(b.response.bag.cards.map((c) => [c.code, c.location?.code ?? null, c.done, c.refunded]), [
    ["CD-4001-01", null, true, false], ["CD-4001-02", null, true, false], ["CD-4001-03", null, true, false],
    ["CD-4001-04", null, true, false], ["CD-4001-05", null, false, true],
  ]);

  const o = await svc.resolve.resolveTrackCode(admin, "cd-4002");
  assert.ok(o.ok && o.response.kind === "order");
  if (!o.ok || o.response.kind !== "order") return;
  assert.deepEqual(o.response.order.bags[0].cards.map((c) => c.location?.name), ["CLAMP 01", "CLAMP 01"]);

  const typed = await svc.resolve.resolveTrackCode(admin, "cd-4001-03");
  assert.ok(typed.ok && typed.response.kind === "card" && typed.response.card.cardUrl === `/admin/receiving/card/${C(3)}`);
  const none = await svc.resolve.resolveTrackCode(admin, "LOC-CLAMP-77");
  assert.ok(!none.ok && none.status === 404);
  const junk = await svc.resolve.resolveTrackCode(admin, "hello");
  assert.ok(!junk.ok && junk.status === 400);
});

test("search: by customer, order number, Card ID, card name; only cards with a Card ID", async () => {
  const pat = await svc.resolve.searchCards(admin, "pat coll");
  assert.ok(pat.ok);
  if (!pat.ok) return;
  assert.deepEqual(pat.response.cards.map((c) => c.code).sort(), ["CD-4001-01", "CD-4001-02", "CD-4001-03", "CD-4001-04", "CD-4001-05"]);
  assert.equal(pat.response.cards.at(-1)!.code, "CD-4001-05", "refunded last");
  const num = await svc.resolve.searchCards(admin, "CD-4002");
  assert.ok(num.ok && num.response.cards.map((c) => c.code).join() === "CD-4002-01,CD-4002-02");
  const id = await svc.resolve.searchCards(admin, "https://thecarddoc1.com/q/cd-4002-02");
  assert.ok(id.ok && id.response.cards.map((c) => c.code).join() === "CD-4002-02");
  const name = await svc.resolve.searchCards(admin, "blastoise 1");
  assert.ok(name.ok && name.response.cards.map((c) => c.code).join() === "CD-4002-01");
  const digits = await svc.resolve.searchCards(admin, "4002");
  assert.ok(digits.ok && digits.response.cards.length === 2);
  const wild = await svc.resolve.searchCards(admin, "%_*,()");
  assert.ok(!wild.ok && wild.status === 400);
});

test("ship check: done and out of the slots = ok; a done card back in a slot is flagged", async () => {
  const ok = await svc.ship.loadShipCheck(admin, "CD-4001-G");
  assert.ok(ok.ok, ok.ok ? "" : ok.error);
  if (!ok.ok) return;
  assert.deepEqual([ok.response.scope, ok.response.ready, ok.response.counts], ["bag", true, { ok: 4, notDone: 0, inSlot: 0, refunded: 1 }]);

  const back = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-03", cardIds: [C(1)], by: "gavin" });
  assert.ok(back.ok && back.results[0].message === "In CLAMP 03. It's done, so the step wasn't changed.");
  const flagged = await svc.ship.loadShipCheck(admin, "CD-4001");
  assert.ok(flagged.ok);
  if (!flagged.ok) return;
  assert.equal(flagged.response.scope, "order");
  assert.equal(flagged.response.ready, false);
  const c1 = flagged.response.cards.find((c) => c.id === C(1))!;
  assert.deepEqual([c1.status, c1.location?.name], ["in_slot", "CLAMP 03"]);
  assert.equal(flagged.response.cards.find((c) => c.id === C(6))!.status, "not_done", "a card that never arrived");

  const other = await svc.ship.loadShipCheck(admin, "CD-4002-G");
  assert.ok(other.ok && other.response.counts.notDone === 2 && !other.response.ready);
  const slotCode = await svc.ship.loadShipCheck(admin, "LOC-CLAMP-03");
  assert.ok(!slotCode.ok && slotCode.status === 400);
});

test("history: a card's moves newest first, with places and step labels; a slot's moves in and out", async () => {
  const h = await svc.history.loadHistory(admin, "CD-4001-01");
  assert.ok(h.ok, h.ok ? "" : h.error);
  if (!h.ok) return;
  assert.deepEqual(h.response.moves.map((m) => [m.action, m.from?.name ?? null, m.to?.name ?? null, m.stageBeforeLabel, m.stageAfterLabel]), [
    ["assign", null, "CLAMP 03", "Done", "Done"],
    ["done", null, null, "Heat Press", "Done"],
    ["release", "HEAT PRESS 02", null, "Heat Press", "Heat Press"],
    ["move", "FINAL DRY 01", "HEAT PRESS 02", "Final Dry", "Heat Press"],
    ["move", "CLAMP 03", "FINAL DRY 01", "Clamp Work", "Final Dry"],
    ["move", "HEAT PRESS 02", "CLAMP 03", "Heat Press", "Clamp Work"],
    ["move", "CLAMP 02", "HEAT PRESS 02", "Clamp Work", "Heat Press"],
    ["move", "HEAT PRESS 01", "CLAMP 02", "Heat Press", "Clamp Work"],
    ["assign", null, "HEAT PRESS 01", "Not started", "Heat Press"],
  ]);
  assert.equal(h.response.moves[0].cardCode, "CD-4001-01");
  const slot = await svc.history.loadHistory(admin, "LOC-HEAT-PRESS-01");
  assert.ok(slot.ok && slot.response.moves.length === 2, "1 in, 1 out");
  const bag = await svc.history.loadHistory(admin, "CD-4002-G");
  assert.ok(bag.ok && bag.response.moves.length === 1, "card 1 into CLAMP 01 (card 2 was written straight in the table)");
});

test("shelf slots: one per due date, made once; bags go on their due date's slot", async () => {
  const a = await svc.shelf.ensureShelfSlotRow(admin, "2026-12-07", "gavin");
  const b = await svc.shelf.ensureShelfSlotRow(admin, "2026-12-07", "gavin");
  assert.deepEqual([a.created, b.created, a.location.id === b.location.id], [true, false, true]);
  assert.deepEqual([a.location.code, a.location.name, a.location.kind, a.location.dueDate, a.location.capacity], ["LOC-SHELF-20261207", "DUE MON DEC 7", "shelf", "2026-12-07", null]);
  assert.equal(mock.store.table("locations").filter((l) => l.code === "LOC-SHELF-20261207").length, 1);
  await assert.rejects(svc.shelf.ensureShelfSlot(admin, "2026-13-01"));

  const r = await svc.shelf.shelveBags(admin, { bagIds: [BAG, BAG2], by: "gavin" });
  assert.deepEqual(r.shelved.map((s) => [s.bagCode, s.location.code]), [["CD-4001-G", "LOC-SHELF-20261207"]]);
  assert.deepEqual(r.skipped, [{ bagId: BAG2, bagCode: "CD-4002-G", reason: "no_due_date" }]);
  assert.equal(mock.store.table("tier_bags").find((x) => x.id === BAG)!.location_id, a.location.id);
  const shelf = await svc.resolve.resolveTrackCode(admin, "LOC-SHELF-20261207");
  assert.ok(shelf.ok && shelf.response.kind === "location" && shelf.response.location.bags.map((x) => x.code).join() === "CD-4001-G");
});

test("places list with occupancy; rename and switch off; a switched-off slot refuses cards", async () => {
  const list = await svc.locations.listLocations(admin);
  assert.ok(list.ok);
  if (!list.ok) return;
  const by = new Map(list.locations.map((l) => [l.code, l]));
  assert.deepEqual([by.get("LOC-CLAMP-01")!.cardCount, by.get("LOC-CLAMP-01")!.free], [2, false]);
  assert.deepEqual([by.get("LOC-HEAT-PRESS-01")!.cardCount, by.get("LOC-HEAT-PRESS-01")!.free], [0, true]);
  assert.equal(by.get("LOC-SHELF-20261207")!.bagCount, 1);
  assert.equal(list.locations[0].code, "LOC-HEAT-PRESS-01", "heat press comes before clamp (step order)");
  const clamps = await svc.locations.listLocations(admin, { station: "clamp" });
  assert.ok(clamps.ok && clamps.locations.map((l) => l.serial).join() === "1,2,3,4,5,6");

  // A one-card holder with a card lists its Card IDs (the picker's "Has CD-4002-01"); others don't
  assert.deepEqual(by.get("LOC-CLAMP-01")!.cardCodes?.sort(), ["CD-4002-01", "CD-4002-02"]);
  assert.equal(by.get("LOC-HEAT-PRESS-01")!.cardCodes, undefined);

  const id = loc("LOC-CLAMP-06").id as string;
  const big = await svc.locations.updateLocation(admin, { id, name: "CLAMP 06 (big)", capacity: 3 });
  assert.ok(!big.ok && big.status === 400 && /holds one card/.test(big.error), "a slot's limit can't change");
  const renamed = await svc.locations.updateLocation(admin, { id, name: "CLAMP 06 (big)" });
  assert.ok(renamed.ok && renamed.location.name === "CLAMP 06 (big)" && renamed.location.code === "LOC-CLAMP-06" && renamed.location.capacity === 1);
  const off = await svc.locations.updateLocation(admin, { id, active: false });
  assert.ok(off.ok && off.location.active === false);
  const refused = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-06", cardIds: [D(1)], by: "gavin" });
  assert.ok(!refused.ok && refused.status === 409 && /switched off/.test(refused.error));
  const hidden = await svc.locations.listLocations(admin);
  assert.ok(hidden.ok && !hidden.locations.some((l) => l.code === "LOC-CLAMP-06"));
  const missing = await svc.locations.updateLocation(admin, { id: "00000000-0000-4000-8000-000000000999", name: "x" });
  assert.ok(!missing.ok && missing.status === 404);
});
