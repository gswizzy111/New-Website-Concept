/**
 * One card per holder (owner, Nov 26 2026: "okay so I want every single
 * sticker station thingy to only be able to hold one card other than my
 * desk"): every station slot, and every other place but a desk or the Open
 * bags box, holds at most ONE card, whatever its stored capacity says, and
 * `force` never bypasses it (lib/intake/tracking/places.ts holdsOneCard,
 * move-plan.ts oneCardRefusal, moves.ts). Pure rules first, then the
 * services against the in-memory Supabase stand-in
 * (tests/intake/harness/mock-supabase.mjs). Customer emails are caught at
 * fetch.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { holderTakenText, oneCardOnlyText, oneCardRefusal } from "@/lib/intake/tracking/move-plan";
import { ONE_CARD, OPEN_BAGS_CODE, holdsOneCard, locationView, placeCapacity } from "@/lib/intake/tracking/places";
import { OPEN_BAGS_CODE as BAG_HOME_OPEN_BAGS } from "@/lib/intake/tracking/bag-home";
import { STATION_TYPES } from "@/lib/intake/tracking/stations";
import type { LocationKind, LocationRow } from "@/lib/intake/tracking/types";

// ─── Pure ───────────────────────────────────────────────────────────────

const place = (code: string, kind: LocationKind, capacity: number | null = null): LocationRow => ({
  id: code, code, name: code.replace(/^LOC-/, "").replaceAll("-", " "), kind, station: kind === "station" ? "heat-press" : null,
  serial: kind === "station" ? 1 : null, capacity, stage: kind === "station" ? "Heat Press" : null, due_date: null, sort: 0, active: true,
  created_at: "2026-11-26T00:00:00Z", created_by: null,
});

test("which places hold one card: every station slot and every other place but a desk or the Open bags box", () => {
  const cases: [string, LocationKind, boolean][] = [
    ["LOC-CLAMP-07", "station", true],
    ["LOC-HEAT-PRESS-02", "station", true],
    ["LOC-DRYING-30", "station", true],
    ["LOC-BENCH-2", "other", true],
    ["LOC-GAVINS-DESK", "other", false], // "Gavins Desk": a code ending in -DESK is a desk (no limit)
    ["LOC-DESKTOP", "other", true],
    ["LOC-DESK", "other", false],
    ["LOC-DESK-GAVIN", "other", false],
    ["LOC-OPEN-BAGS", "other", false],
    ["LOC-SHELF-20261207", "shelf", false],
    ["LOC-DONE", "done", false],
    ["LOC-SHIP", "shipping", false],
  ];
  for (const [code, kind, one] of cases) assert.equal(holdsOneCard({ code, kind }), one, code);
  assert.equal(holdsOneCard(null), false);
  assert.equal(OPEN_BAGS_CODE, BAG_HOME_OPEN_BAGS, "one Open bags box code");
});

test("a one-card holder holds 1 whatever is stored; a desk, a shelf and the Open bags box keep what is stored", () => {
  assert.deepEqual(
    [
      placeCapacity(place("LOC-HEAT-PRESS-02", "station", null)), // made before the rule with no limit
      placeCapacity(place("LOC-HUMIDOR-03", "station", 8)),
      placeCapacity(place("LOC-CLAMP-07", "station", 1)),
      placeCapacity(place("LOC-BENCH-2", "other", null)),
      placeCapacity(place("LOC-DESK", "other", null)),
      placeCapacity(place("LOC-DESK-GAVIN", "other", 5)),
      placeCapacity(place("LOC-OPEN-BAGS", "other", null)),
      placeCapacity(place("LOC-SHELF-20261207", "shelf", null)),
    ],
    [1, 1, 1, 1, null, 5, null, null],
  );
  // What every page and the API see (TrackLocation.capacity)
  assert.equal(locationView(place("LOC-DRYING-04", "station", null)).capacity, ONE_CARD);
  assert.equal(locationView(place("LOC-DESK", "other", null)).capacity, null);
  // New slots of every type store one card
  assert.ok(STATION_TYPES.every((t) => t.defaultCapacity === ONE_CARD));
});

test("the rule: a card already in it, another card, several at once", () => {
  assert.equal(oneCardRefusal([], ["a"]), null, "nothing going in (the card is in it already): no change");
  assert.equal(oneCardRefusal(["a"], []), null, "one card into an empty holder");
  assert.equal(oneCardRefusal(["b"], ["a"]), "taken");
  assert.equal(oneCardRefusal(["b", "c"], ["a"]), "taken", "it has a card: say that, whatever is going");
  assert.equal(oneCardRefusal(["a", "b", "c"], []), "several");
  assert.equal(oneCardRefusal(["a", "a"], []), null, "a card listed twice counts once");
});

test("the words: what's in it and what to do; several at once: pick one card", () => {
  assert.equal(holderTakenText("CLAMP 07", [{ code: "CD-2549-03", name: "Charizard" }]),
    "CLAMP 07 already has a card (CD-2549-03 · Charizard). Take it out first, or pick another holder.");
  assert.equal(holderTakenText("CLAMP 07", [{ code: null, name: "Charizard" }]),
    "CLAMP 07 already has a card (Charizard). Take it out first, or pick another holder.");
  assert.equal(holderTakenText("CLAMP 07", []), "CLAMP 07 already has a card. Take it out first, or pick another holder.");
  assert.equal(holderTakenText("CLAMP 07", [{ code: "CD-1-01", name: null }, { code: "CD-1-02", name: "Pikachu" }]),
    "CLAMP 07 already has 2 cards (CD-1-01, CD-1-02 · Pikachu). Take them out first, or pick another holder.");
  assert.equal(oneCardOnlyText("CLAMP 07"), "CLAMP 07 holds one card. Pick one card to put here.");
});

// ─── Against the in-memory database ─────────────────────────────────────

type Row = Record<string, unknown>;
type Mock = { url: string; store: { table(name: string): Row[]; load(seed: { tables: Record<string, Row[]> }): void }; close(): Promise<void> };

let mock: Mock;
let admin: SupabaseClient;
let svc: {
  moves: typeof import("@/lib/intake/tracking/moves");
  locations: typeof import("@/lib/intake/tracking/locations");
  resolve: typeof import("@/lib/intake/tracking/resolve");
};
const realFetch = globalThis.fetch;

const ORDER = "00000000-0000-4000-8000-0000001c0001";
const BAG = "00000000-0000-4000-8000-0000001cb001";
const C = (n: number) => `00000000-0000-4000-8000-0000001cc0${String(n).padStart(2, "0")}`;
const card = (n: number): Row => ({
  id: C(n), order_id: ORDER, card_name: `Charizard ${n}`, card_set: "Base Set", card_year: "1999", card_number: `${n}/102`,
  variation: null, notes: null, known_defects: null, estimated_value_cents: null, photo_urls: [], catalog_image_url: null,
  tier: null, status: "active", completed: false, completed_at: null, current_round: 1, created_at: "2026-11-23T19:00:00.000000+00:00",
  card_seq: n, card_code: `CD-2549-${String(n).padStart(2, "0")}`, bag_id: BAG, received_at: "2026-11-23T19:30:00+00:00",
  received_by: "gavin", awaiting_arrival: false, receiving_photo_urls: [], location_id: null, located_at: null, refunded_cents: 0,
  service_ids: [], slab_removal_selected: false, pregrade_selected: false,
});
const loc = (code: string) => mock.store.table("locations").find((l) => l.code === code)!;
const cardRow = (n: number) => mock.store.table("cards").find((c) => c.id === C(n))!;
const moves = () => mock.store.table("card_moves");
const tick = () => new Promise((r) => setTimeout(r, 5));

before(async () => {
  const harness = pathToFileURL(path.resolve("tests/intake/harness/mock-supabase.mjs")).href;
  const { startMock } = (await import(harness)) as { startMock: (o: { port: number; quiet: boolean }) => Promise<Mock> };
  mock = await startMock({ port: 0, quiet: true });
  mock.store.load({
    tables: {
      orders: [{
        id: ORDER, order_number: "CD-2549", customer_name: "Maria Reyes", customer_email: "maria@example.com", customer_phone: null,
        status: "in_progress", payment_status: "paid", restoration_tier: "premium", inbound_method: "self_ship", customer_notes: null,
        created_at: "2026-11-23T19:00:00+00:00", updated_at: "2026-11-23T19:00:00+00:00",
      }],
      tier_bags: [{
        id: BAG, order_id: ORDER, tier: "premium", batch: 1, bag_code: "CD-2549-G", received_on: "2026-11-16", due_date: "2026-12-07",
        due_status: "calculated", turnaround_days: 15, source: "receiving", created_at: "2026-11-23T19:30:00+00:00",
      }],
      cards: Array.from({ length: 12 }, (_, i) => card(i + 1)),
      order_events: [],
      locations: [
        { id: "00000000-0000-4000-8000-0000001cf001", code: "LOC-DONE", name: "Done", kind: "done", sort: 900, active: true, created_at: "2026-11-24T00:00:00+00:00" },
        // Made before the rule, stored "no limit": it holds one card all the same
        { id: "00000000-0000-4000-8000-0000001cf002", code: "LOC-HEAT-PRESS-02", name: "HEAT PRESS 02", kind: "station", station: "heat-press", serial: 2,
          capacity: null, stage: "Heat Press", sort: 2, active: true, created_at: "2026-11-24T00:00:00+00:00" },
        { id: "00000000-0000-4000-8000-0000001cf003", code: "LOC-SHELF-20261207", name: "DUE MON DEC 7", kind: "shelf", due_date: "2026-12-07",
          capacity: null, sort: 20261207, active: true, created_at: "2026-11-24T00:00:00+00:00" },
      ],
      card_moves: [],
      restoration_settings: [{ tier: "premium", display_name: "Gold", turnaround_min_days: 15, turnaround_max_days: 20 }],
      business_holidays: [],
    },
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("resend")) return new Response(JSON.stringify({ id: "email" }), { status: 200, headers: { "Content-Type": "application/json" } });
    return realFetch(input, init);
  }) as typeof fetch;
  admin = createClient(mock.url, "service-role-test-key", { auth: { persistSession: false } });
  svc = {
    moves: await import("@/lib/intake/tracking/moves"),
    locations: await import("@/lib/intake/tracking/locations"),
    resolve: await import("@/lib/intake/tracking/resolve"),
  };
  const clamps = await svc.locations.createSlots(admin, { station: "clamp", count: 9, by: "gavin" });
  assert.ok(clamps.ok, clamps.ok ? "" : clamps.error);
  for (const [name, kind] of [["Desk", "other"], ["Bench 2", "other"]] as const) {
    const made = await svc.locations.createLocation(admin, { name, kind, by: "gavin" });
    assert.ok(made.ok, made.ok ? "" : made.error);
  }
});

after(async () => {
  globalThis.fetch = realFetch;
  await mock?.close();
});

test("a station slot that has a card refuses a second one with what's in it; nothing is written", async () => {
  const first = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-07", cardIds: [C(3)], by: "gavin" });
  assert.ok(first.ok, first.ok ? "" : first.error);
  await tick();
  const before = { moves: moves().length, events: mock.store.table("order_events").length };
  const second = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-07", cardIds: [C(4)], by: "gavin" });
  assert.ok(!second.ok && second.status === 409);
  if (second.ok) return;
  assert.equal(second.error, "CLAMP 07 already has a card (CD-2549-03 · Charizard 3). Take it out first, or pick another holder.");
  assert.ok(second.full && !second.conflict, "HolderFull, never a CapacityConflict (no \"Add anyway\")");
  assert.deepEqual([second.full?.holderFull, second.full?.holder, second.full?.occupants.map((c) => c.code)],
    [true, { code: "LOC-CLAMP-07", name: "CLAMP 07" }, ["CD-2549-03"]]);
  assert.equal(cardRow(4).location_id, null);
  assert.deepEqual({ moves: moves().length, events: mock.store.table("order_events").length }, before);
});

test("force can't bypass it: assign and move alike", async () => {
  const forced = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-07", cardIds: [C(4)], force: true, by: "gavin" });
  assert.deepEqual(forced.ok ? null : [forced.status, forced.error],
    [409, "CLAMP 07 already has a card (CD-2549-03 · Charizard 3). Take it out first, or pick another holder."]);
  const into = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-08", cardIds: [C(4)], by: "gavin" });
  assert.ok(into.ok, into.ok ? "" : into.error);
  await tick();
  const moved = await svc.moves.moveSlot(admin, { fromCode: "LOC-CLAMP-08", toCode: "LOC-CLAMP-07", force: true, by: "gavin" });
  assert.deepEqual(moved.ok ? null : [moved.status, moved.full?.holderFull], [409, true]);
  assert.equal(cardRow(4).location_id, loc("LOC-CLAMP-08").id, "still where it was");
});

test("several cards at once into one holder: refused, whatever is stored on it (a heat press made with no limit)", async () => {
  assert.equal(loc("LOC-HEAT-PRESS-02").capacity, null, "stored no limit");
  for (const force of [false, true]) {
    const r = await svc.moves.assignCards(admin, { locationCode: "LOC-HEAT-PRESS-02", cardIds: [C(5), C(6), C(7)], force, by: "gavin" });
    assert.deepEqual(r.ok ? null : [r.status, r.error, r.full?.occupants], [409, "HEAT PRESS 02 holds one card. Pick one card to put here.", []]);
  }
  assert.ok([5, 6, 7].every((n) => cardRow(n).location_id === null));
  // One of them goes in; the scanned holder says "has 1 card" (capacity 1, full)
  const one = await svc.moves.assignCards(admin, { locationCode: "LOC-HEAT-PRESS-02", cardIds: [C(5)], by: "gavin" });
  assert.ok(one.ok && one.changed === 1, one.ok ? one.message : one.error);
  const scanned = await svc.resolve.resolveTrackCode(admin, "LOC-HEAT-PRESS-02");
  assert.ok(scanned.ok && scanned.response.kind === "location");
  if (!scanned.ok || scanned.response.kind !== "location") return;
  assert.deepEqual([scanned.response.location.capacity, scanned.response.location.cardCount, scanned.response.location.free, scanned.response.location.overCapacity],
    [1, 1, false, false]);
  // The picker's list: full, with its card's ID
  const list = await svc.locations.listLocations(admin);
  assert.ok(list.ok);
  if (!list.ok) return;
  const press = list.locations.find((l) => l.code === "LOC-HEAT-PRESS-02")!;
  assert.deepEqual([press.capacity, press.free, press.cardCodes], [1, false, ["CD-2549-05"]]);
});

test("a card put in the holder it is already in: no change, no refusal", async () => {
  await tick();
  const before = moves().length;
  for (const force of [false, true]) {
    const again = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-07", cardIds: [C(3)], force, by: "gavin" });
    assert.ok(again.ok && again.changed === 0 && again.message === "Already in CLAMP 07.", again.ok ? again.message : again.error);
  }
  assert.equal(moves().length, before);
  // Its card listed with another: the other is refused (the holder has a card)
  const mixed = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-07", cardIds: [C(3), C(8)], by: "gavin" });
  assert.ok(!mixed.ok && mixed.status === 409 && /^CLAMP 07 already has a card \(CD-2549-03/.test(mixed.error));
});

test("a desk has no limit: several cards at once, and more on top, no force needed", async () => {
  const three = await svc.moves.assignCards(admin, { locationCode: "LOC-DESK", cardIds: [C(6), C(7), C(8)], by: "gavin" });
  assert.ok(three.ok && three.changed === 3, three.ok ? three.message : three.error);
  await tick();
  const more = await svc.moves.moveSlot(admin, { fromCode: "LOC-CLAMP-08", toCode: "LOC-DESK", by: "gavin" });
  assert.ok(more.ok && more.changed === 1, more.ok ? more.message : more.error);
  const desk = await svc.resolve.resolveTrackCode(admin, "LOC-DESK");
  assert.ok(desk.ok && desk.response.kind === "location");
  if (!desk.ok || desk.response.kind !== "location") return;
  assert.deepEqual([desk.response.location.capacity, desk.response.location.cardCount, desk.response.location.free], [null, 4, true]);
  // Off the desk into a holder: one card at a time
  await tick();
  const two = await svc.moves.moveSlot(admin, { fromCode: "LOC-DESK", toCode: "LOC-CLAMP-01", cardIds: [C(6), C(7)], by: "gavin" });
  assert.deepEqual(two.ok ? null : [two.status, two.error], [409, "CLAMP 01 holds one card. Pick one card to put here."]);
  const one = await svc.moves.moveSlot(admin, { fromCode: "LOC-DESK", toCode: "LOC-CLAMP-01", cardIds: [C(6)], by: "gavin" });
  assert.ok(one.ok && one.changed === 1, one.ok ? one.message : one.error);
});

test("another place that isn't a desk (BENCH 2) holds one card too; shelves and the Open bags box are unchanged", async () => {
  assert.equal(loc("LOC-BENCH-2").capacity, 1, "made with one card");
  const first = await svc.moves.assignCards(admin, { locationCode: "LOC-BENCH-2", cardIds: [C(9)], by: "gavin" });
  assert.ok(first.ok, first.ok ? "" : first.error);
  await tick();
  const second = await svc.moves.assignCards(admin, { locationCode: "LOC-BENCH-2", cardIds: [C(10)], force: true, by: "gavin" });
  assert.deepEqual(second.ok ? null : [second.status, second.error],
    [409, "Bench 2 already has a card (CD-2549-09 · Charizard 9). Take it out first, or pick another holder."]);
  // A shelf takes any number
  const shelf = await svc.moves.assignCards(admin, { locationCode: "LOC-SHELF-20261207", cardIds: [C(10), C(11)], by: "gavin" });
  assert.ok(shelf.ok && shelf.changed === 2, shelf.ok ? shelf.message : shelf.error);
  // The Open bags box (made by the first card out of its bag) holds bags: no one-card limit on it
  const open = loc(OPEN_BAGS_CODE);
  assert.ok(open, "made on first use");
  assert.equal(holdsOneCard(open as unknown as LocationRow), false);
  // Its limit can't be set on a one-card holder; a desk's can
  const bench = await svc.locations.updateLocation(admin, { id: loc("LOC-BENCH-2").id as string, capacity: 5 });
  assert.deepEqual(bench.ok ? null : [bench.status, bench.error], [400, "Bench 2 holds one card (the owner's rule), so its limit can't change."]);
  const desk = await svc.locations.updateLocation(admin, { id: loc("LOC-DESK").id as string, capacity: 10 });
  assert.ok(desk.ok && desk.location.capacity === 10);
  const back = await svc.locations.updateLocation(admin, { id: loc("LOC-DESK").id as string, capacity: null });
  assert.ok(back.ok && back.location.capacity === null);
});

test("two phones put a card in the same empty holder at the same moment: one card ends up in it, the other is refused and left where it was", async () => {
  // Both checks can see CLAMP 09 empty; the holder is read again after the write, and a second card goes back
  for (let round = 0; round < 3; round++) {
    const target = loc("LOC-CLAMP-09");
    const [a, b] = [11, 12];
    for (const n of [a, b]) {
      cardRow(n).location_id = null;
      cardRow(n).located_at = null;
    }
    const before = moves().length;
    const results = await Promise.all([a, b].map((n) => svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-09", cardIds: [C(n)], by: "gavin" })));
    const inIt = mock.store.table("cards").filter((c) => c.location_id === target.id).map((c) => c.id as string);
    assert.ok(inIt.length <= 1, `round ${round}: ${inIt.length} cards in CLAMP 09`);
    results.forEach((r, i) => {
      const n = [a, b][i];
      if (r.ok) {
        assert.deepEqual(inIt, [C(n)], `round ${round}: the card that got in is the one in it`);
      } else {
        assert.equal(r.status, 409, r.error);
        assert.ok(r.full?.holderFull, r.error);
        assert.equal(cardRow(n).location_id, null, `round ${round}: a refused card is back where it was`);
      }
    });
    // History only for the card that went in
    assert.equal(moves().length - before, results.filter((r) => r.ok).length);
    // Empty it for the next round
    for (const id of inIt) await svc.moves.releaseCards(admin, { cardIds: [id], by: "gavin" });
    await tick();
  }
});
