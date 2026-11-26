/**
 * Desks (lib/intake/tracking/desk.ts) and the Desk page's pure pieces
 * (app/admin/receiving/desk/_lib): desk codes, which desk to show, the
 * holder picker's groups and typed holders, what an action says, the photo
 * groups; then ensureDesk and loadDeskCards end to end against the in-memory
 * Supabase stand-in (tests/intake/harness/mock-supabase.mjs). Customer
 * emails are caught at fetch (Resend's API calls).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DESK_CODE, compareDeskCards, compareDesks, deskPagePath, deskPlaces, ensureDesk, isDeskCode, latestArrivals,
  loadDeskCards, pickDesk, type ArrivalRow,
} from "@/lib/intake/tracking/desk";
import { STATION_TYPES } from "@/lib/intake/tracking/stations";
import type { TrackActionResponse, TrackLocationWithCount } from "@/lib/intake/tracking/types";
import {
  BAG_ONLY_CODES, DONE_IN_PICKER_TEXT, holderFromText, holderGroups, isCardDestination, isTakenHolder, matchesHolder, oneEachText, takenText,
} from "@/app/admin/receiving/desk/_lib/holders";
import { outcomeOf, settledIds } from "@/app/admin/receiving/desk/_lib/outcome";
import { deskPanelCard, deskPhotoGroups } from "@/app/admin/receiving/desk/_lib/view";

// ─── Pure ───────────────────────────────────────────────────────────────

test("desk codes: LOC-DESK and LOC-DESK-<NAME>, typed, lower case or as a QR link; nothing else", () => {
  for (const yes of ["LOC-DESK", "LOC-DESK-GAVIN", "loc-desk-2", " LOC-DESK ", "HTTPS://THECARDDOC1.COM/Q/LOC-DESK-GAVIN", "https://x.netlify.app/q/loc-desk"]) {
    assert.equal(isDeskCode(yes), true, yes);
  }
  for (const no of ["LOC-DESKTOP", "LOC-DESK-", "LOC-CLAMP-07", "LOC-DONE", "DESK", "CD-2549", "", null, undefined]) {
    assert.equal(isDeskCode(no), false, String(no));
  }
  assert.equal(deskPagePath(), "/admin/receiving/desk");
  assert.equal(deskPagePath("loc-desk-gavin"), "/admin/receiving/desk?desk=LOC-DESK-GAVIN");
  assert.equal(deskPagePath("LOC-CLAMP-07"), "/admin/receiving/desk");
});

test("which desk shows: the one asked for, else the first switched-on one (LOC-DESK first)", () => {
  const d = (code: string, name: string, active = true, sort = 0) => ({ code, name, active, sort });
  const desks = [d("LOC-DESK-ZED", "DESK ZED"), d("LOC-DESK-OLD", "DESK OLD", false), d("LOC-DESK", "DESK"), d("LOC-DESK-AMY", "DESK AMY")].sort(compareDesks);
  assert.deepEqual(desks.map((x) => x.code), ["LOC-DESK", "LOC-DESK-AMY", "LOC-DESK-ZED", "LOC-DESK-OLD"]);
  assert.equal(pickDesk(desks)?.code, "LOC-DESK");
  assert.equal(pickDesk(desks, "loc-desk-amy")?.code, "LOC-DESK-AMY");
  assert.equal(pickDesk(desks, "LOC-DESK-OLD")?.code, "LOC-DESK-OLD", "asked for: shown even when switched off");
  assert.equal(pickDesk(desks, "LOC-CLAMP-07")?.code, "LOC-DESK", "not a desk: the first one");
  assert.equal(pickDesk([d("LOC-DESK-OLD", "DESK OLD", false)])?.code, "LOC-DESK-OLD", "only switched-off desks: still one to show");
  assert.equal(pickDesk([]), null);
});

test("where a card came from: its newest move onto the desk", () => {
  const DESK = "desk-1";
  const row = (id: string, card: string, from: string | null, to: string | null, at: string): ArrivalRow =>
    ({ id, card_id: card, from_location_id: from, to_location_id: to, action: "move", by: "gavin", created_at: at });
  const got = latestArrivals([
    row("m1", "a", "heat-1", DESK, "2026-11-24T10:00:00.000000+00:00"),
    row("m2", "a", "clamp-7", DESK, "2026-11-24T12:00:00.000000+00:00"),
    row("m3", "a", DESK, "clamp-8", "2026-11-24T13:00:00.000000+00:00"), // left: not an arrival
    row("m4", "b", null, DESK, "2026-11-24T09:00:00.000000+00:00"),
    row("m5", "b", DESK, DESK, "2026-11-24T14:00:00.000000+00:00"), // no change of place
    row("m6", "c", "heat-1", "other-desk", "2026-11-24T09:00:00.000000+00:00"),
  ], DESK);
  assert.deepEqual([...got.entries()].map(([card, r]) => [card, r.id]).sort(), [["a", "m2"], ["b", "m4"]]);
});

test("desk order: newest on the desk first; a stack moved together by Card ID", () => {
  const c = (id: string, code: string | null, at: string | null) => ({ id, code, locatedAt: at });
  const list = [
    c("1", "CD-10-10", "2026-11-24T10:00:00+00:00"),
    c("2", "CD-10-02", "2026-11-24T10:00:00+00:00"),
    c("3", "CD-9-01", "2026-11-24T11:00:00+00:00"),
    c("4", null, null),
    c("5", "CD-10-03", null),
  ].sort(compareDeskCards);
  assert.deepEqual(list.map((x) => x.id), ["3", "2", "1", "5", "4"]);
});

const loc = (over: Partial<TrackLocationWithCount>): TrackLocationWithCount => ({
  id: over.code ?? "id", code: "LOC-X", name: "X", kind: "station", station: null, stationName: null, serial: null, capacity: null,
  stage: null, stageLabel: null, dueDate: null, sort: 0, active: true, createdAt: "2026-11-24T00:00:00Z", createdBy: null,
  qrUrl: "", cardCount: 0, bagCount: 0, free: true, ...over,
});
const slot = (station: string, n: number, capacity: number | null, cardCount: number, active = true) => {
  const type = STATION_TYPES.find((t) => t.key === station)!;
  const nn = String(n).padStart(2, "0");
  return loc({ id: `${station}-${nn}`, code: `LOC-${station.toUpperCase()}-${nn}`, name: `${type.name.toUpperCase()} ${nn}`, kind: "station", station,
    stationName: type.name, serial: n, capacity, stage: type.stage, stageLabel: type.stage, cardCount, free: capacity == null || cardCount < capacity, active });
};
const PLACES: TrackLocationWithCount[] = [
  // Stored "no limit" (made before the one-card rule): HEAT PRESS 02 holds one card all the same
  slot("heat-press", 1, null, 0),
  { ...slot("heat-press", 2, null, 1), cardCodes: ["CD-2549-03"] },
  slot("clamp", 1, 1, 1),
  slot("clamp", 7, 1, 0),
  slot("clamp", 8, 1, 0, false),
  slot("final-dry", 1, 2, 2),
  loc({ id: "desk", code: "LOC-DESK", name: "DESK", kind: "other" }),
  loc({ id: "desk-gavin", code: "LOC-DESK-GAVIN", name: "DESK GAVIN", kind: "other" }),
  loc({ id: "done", code: "LOC-DONE", name: "Done", kind: "done" }),
  loc({ id: "shelf", code: "LOC-SHELF-20261207", name: "DUE MON DEC 7", kind: "shelf", dueDate: "2026-12-07" }),
];

test("holder picker: by station type in step order, room first, full ones apart; other places last; not the desk itself", () => {
  const groups = holderGroups(PLACES, STATION_TYPES, { excludeId: "desk" });
  assert.deepEqual(groups.map((g) => [g.title, g.free.map((l) => l.name), g.full.map((l) => l.name)]), [
    ["Heat Press", ["HEAT PRESS 01"], ["HEAT PRESS 02"]],
    ["Clamp", ["CLAMP 07"], ["CLAMP 01"]],
    ["Other places", ["DESK GAVIN"], []],
    ["Final Dry", [], ["FINAL DRY 01"]], // no room at all: after the groups with room
  ]);
  // Three cards: every holder takes one card, so only the desks are listed (and the sheet says why)
  const three = holderGroups(PLACES, STATION_TYPES, { excludeId: "desk", need: 3 });
  assert.deepEqual(three.map((g) => [g.title, g.free.map((l) => l.name), g.full.map((l) => l.name)]), [["Other places", ["DESK GAVIN"], []]]);
  assert.equal(oneEachText(3), "Each holder takes one card: put these 3 cards in one at a time, or on another desk.");
  // Typing narrows it
  assert.deepEqual(holderGroups(PLACES, STATION_TYPES, { excludeId: "desk", query: "clamp 7" }).map((g) => g.free.concat(g.full).map((l) => l.name)), [["CLAMP 07"]]);
  assert.deepEqual(holderGroups(PLACES, STATION_TYPES, { excludeId: "desk", query: "heat" }).map((g) => g.title), ["Heat Press"]);
  assert.equal(matchesHolder(PLACES[0], "HEAT PRESS"), true);
  assert.equal(matchesHolder(PLACES[0], "clamp"), false);
});

test("holder picker: a holder that has a card is full, greyed with its card's ID, never offered; a desk never is", () => {
  const by = new Map(PLACES.map((l) => [l.code, l]));
  assert.deepEqual(["LOC-HEAT-PRESS-01", "LOC-HEAT-PRESS-02", "LOC-CLAMP-01", "LOC-FINAL-DRY-01", "LOC-DESK-GAVIN"].map((c) => isTakenHolder(by.get(c)!)),
    [false, true, true, true, false]);
  assert.equal(takenText(by.get("LOC-HEAT-PRESS-02")!), "Has CD-2549-03");
  assert.equal(takenText(by.get("LOC-CLAMP-01")!), "Has a card", "no Card ID known");
  assert.equal(takenText(by.get("LOC-FINAL-DRY-01")!), "Has 2 cards", "2 from before the rule");
  // A desk that has cards is still offered, and another place but a desk is a one-card holder
  const desk = loc({ id: "d", code: "LOC-DESK-SAM", name: "DESK SAM", kind: "other", cardCount: 12 });
  const bench = loc({ id: "b", code: "LOC-BENCH-2", name: "BENCH 2", kind: "other", cardCount: 1, cardCodes: ["CD-1-01"] });
  assert.deepEqual([isTakenHolder(desk), isTakenHolder(bench)], [false, true]);
  const groups = holderGroups([desk, bench], STATION_TYPES);
  assert.deepEqual(groups.map((g) => [g.free.map((l) => l.name), g.full.map((l) => l.name)]), [[["DESK SAM"], ["BENCH 2"]]]);
});

test("holder picker box: a typed or scanned holder, else the one name that matches", () => {
  assert.equal(holderFromText("  ", PLACES), null);
  assert.deepEqual(holderFromText("clamp 7", PLACES, "desk"), { ok: true, code: "LOC-CLAMP-07", name: "CLAMP 07" });
  assert.deepEqual(holderFromText("HTTPS://THECARDDOC1.COM/Q/LOC-HEAT-PRESS-01", PLACES, "desk"), { ok: true, code: "LOC-HEAT-PRESS-01", name: "HEAT PRESS 01" });
  assert.deepEqual(holderFromText("desk gavin", PLACES, "desk"), { ok: true, code: "LOC-DESK-GAVIN", name: "DESK GAVIN" });
  // Not listed: still sent (the server says what's wrong with it)
  assert.deepEqual(holderFromText("clamp 99", PLACES, "desk"), { ok: true, code: "LOC-CLAMP-99", name: null });
  const self = holderFromText("LOC-DESK", PLACES, "desk");
  assert.ok(self && !self.ok && /already/.test(self.error));
  const card = holderFromText("CD-2549-03", PLACES, "desk");
  assert.ok(card && !card.ok && /card code, not a holder/.test(card.error));
  const many = holderFromText("clamp", PLACES, "desk");
  assert.ok(many && !many.ok && /2 holders match/.test(many.error));
  const none = holderFromText("toaster", PLACES, "desk");
  assert.ok(none && !none.ok && /No holder is called/.test(none.error));
});

test("holder picker: places that hold bags (the Open bags box, the Ready to ship bin, the Done shelf) are never offered for a card, listed or typed", () => {
  const withBags: TrackLocationWithCount[] = [
    ...PLACES,
    loc({ id: "open-bags", code: "LOC-OPEN-BAGS", name: "OPEN BAGS", kind: "other", bagCount: 12 }),
    loc({ id: "ship", code: "LOC-SHIP", name: "Shipping", kind: "shipping" }),
    loc({ id: "bench", code: "LOC-BENCH-2", name: "BENCH 2", kind: "other" }),
  ];
  const names = holderGroups(withBags, STATION_TYPES, { excludeId: "desk" }).flatMap((g) => [...g.free, ...g.full].map((l) => l.code));
  for (const code of ["LOC-OPEN-BAGS", "LOC-SHIP", "LOC-DONE"]) assert.ok(!names.includes(code), `${code} offered`);
  assert.ok(names.includes("LOC-BENCH-2"), "another place still is");
  assert.deepEqual(BAG_ONLY_CODES, ["LOC-OPEN-BAGS", "LOC-SHIP", "LOC-DONE"]);
  assert.deepEqual(["LOC-OPEN-BAGS", "LOC-SHIP", "LOC-DONE", "LOC-BENCH-2", "LOC-CLAMP-07"].map((code) => isCardDestination({ code, kind: code === "LOC-CLAMP-07" ? "station" : code === "LOC-SHIP" ? "shipping" : code === "LOC-DONE" ? "done" : "other" })),
    [false, false, false, true, true]);
  // Typed or scanned into the box: refused with why
  for (const [typed, name] of [["open bags", "OPEN BAGS"], ["LOC-OPEN-BAGS", "OPEN BAGS"], ["HTTPS://THECARDDOC1.COM/Q/LOC-SHIP", "Shipping"], ["LOC-SHELF-20261207", "DUE MON DEC 7"], ["HTTPS://THECARDDOC1.COM/Q/LOC-SHELF-20261207", "DUE MON DEC 7"]]) {
    const got = holderFromText(typed, withBags, "desk");
    assert.deepEqual(got, { ok: false, error: `${name} holds bags, not cards. Pick a holder, like clamp 7.` }, typed);
  }
});

test("holder picker box: the DONE sign scanned into it (a computer, box focused) says how to finish, listed or not; never a holder", () => {
  assert.equal(DONE_IN_PICKER_TEXT, "To finish it, close this list, then scan DONE or tap Done.");
  const withoutDone = PLACES.filter((l) => l.code !== "LOC-DONE");
  for (const typed of ["LOC-DONE", "HTTPS://THECARDDOC1.COM/Q/LOC-DONE", "https://thecarddoc1.com/q/LOC-DONE", "done", " Done "]) {
    for (const list of [PLACES, withoutDone, []]) {
      assert.deepEqual(holderFromText(typed, list, "desk"), { ok: false, error: DONE_IN_PICKER_TEXT }, `${typed} (${list.length} places)`);
    }
  }
  // Not "Done holds bags, not cards …" any more; the other places that hold bags keep that line
  assert.ok(!/holds bags/.test(DONE_IN_PICKER_TEXT));
  assert.deepEqual(holderFromText("LOC-SHIP", [...PLACES, loc({ id: "ship", code: "LOC-SHIP", name: "Shipping", kind: "shipping" })], "desk"),
    { ok: false, error: "Shipping holds bags, not cards. Pick a holder, like clamp 7." });
});

test("after an action: the API's sentence, each card's line when it helps, and what else happened", () => {
  const res = (results: TrackActionResponse["results"], extra: Partial<TrackActionResponse> = {}): TrackActionResponse =>
    ({ location: null, results, message: "2 cards in CLAMP 07. Step: Clamp Work.", changed: results.filter((r) => r.ok).length, emailedOrders: [], bagsCompleted: [], freed: [], ...extra });
  const one = outcomeOf(res([{ cardId: "a", code: "CD-1-01", name: "Charizard", ok: true, changed: true, message: "In CLAMP 07." }], { emailedOrders: ["o1"] }));
  assert.deepEqual([one.tone, one.lines.length, one.notes], ["ok", 0, ["The customer got an email about the new step."]]);
  const mixed = outcomeOf(res([
    { cardId: "a", code: "CD-1-01", name: "Charizard", ok: true, changed: true, message: "In CLAMP 07." },
    { cardId: "b", code: null, name: "Blastoise", ok: false, changed: false, message: "Blastoise was refunded. Not moved." },
  ], { bagsCompleted: ["b1", "b2"] }));
  assert.equal(mixed.tone, "warn");
  assert.deepEqual(mixed.lines.map((l) => [l.label, l.ok]), [["CD-1-01", true], ["Blastoise", false]]);
  assert.deepEqual(mixed.notes, ["2 bags are now all done."]);
  assert.deepEqual(settledIds(res([
    { cardId: "a", code: null, name: null, ok: true, changed: true, message: "" },
    { cardId: "b", code: null, name: null, ok: false, changed: false, message: "" },
  ])), ["a"]);
  const refused = outcomeOf(res([{ cardId: "b", code: "CD-1-02", name: null, ok: false, changed: false, message: "Refunded." }]));
  assert.deepEqual([refused.tone, refused.lines.length], ["error", 1]);
});

test("photos: receiving first, then the customer's, labelled; the catalog picture only when there are neither", () => {
  const base = { name: "Charizard", catalogImageUrl: "https://images.pokemontcg.io/base1/4_hires.png" };
  const both = deskPhotoGroups({ ...base, receivingPhotos: ["https://x/r1.jpg", "https://x/r2.jpg"], customerPhotos: ["https://x/c1.jpg"] }, "CD-1-01 Charizard");
  assert.deepEqual(both.map((g) => [g.kind, g.title, g.photos.length]), [["receiving", "Receiving photos (2)", 2], ["customer", "Customer photo", 1]]);
  assert.equal(both[0].photos[0].alt, "Receiving photo 1 of CD-1-01 Charizard");
  const none = deskPhotoGroups({ ...base, receivingPhotos: [], customerPhotos: [] }, "Charizard");
  assert.deepEqual(none.map((g) => g.kind), ["reference"]);
  assert.equal(deskPhotoGroups({ ...base, catalogImageUrl: null, receivingPhotos: [], customerPhotos: [] }, "Charizard").length, 0);
});

// ─── Against the in-memory database ─────────────────────────────────────

type Row = Record<string, unknown>;
type Mock = { url: string; store: { table(name: string): Row[]; load(seed: { tables: Record<string, Row[]> }): void }; close(): Promise<void> };

let mock: Mock;
let admin: SupabaseClient;
let svc: {
  moves: typeof import("@/lib/intake/tracking/moves");
  locations: typeof import("@/lib/intake/tracking/locations");
};
const sent: { to: unknown; subject: string }[] = [];
const realFetch = globalThis.fetch;

const ORDER = "00000000-0000-4000-8000-00000de50001";
const BAG = "00000000-0000-4000-8000-00000de5b001";
const C = (n: number) => `00000000-0000-4000-8000-00000de5c0${String(n).padStart(2, "0")}`;
const card = (n: number, over: Row = {}): Row => ({
  id: C(n), order_id: ORDER, card_name: `Charizard ${n}`, card_set: "Base Set", card_year: "1999", card_number: `${n}/102`,
  variation: null, notes: null, known_defects: null, estimated_value_cents: null, photo_urls: [], catalog_image_url: null,
  tier: null, status: "active", completed: false, completed_at: null, current_round: 1, created_at: "2026-11-23T19:00:00.000000+00:00",
  card_seq: n, card_code: `CD-5001-${String(n).padStart(2, "0")}`, bag_id: BAG, received_at: "2026-11-23T19:30:00+00:00",
  received_by: "gavin", awaiting_arrival: false, receiving_photo_urls: [], location_id: null, located_at: null, refunded_cents: 0,
  service_ids: [], slab_removal_selected: false, pregrade_selected: false, ...over,
});
const tick = () => new Promise((r) => setTimeout(r, 5));

before(async () => {
  const harness = pathToFileURL(path.resolve("tests/intake/harness/mock-supabase.mjs")).href;
  const { startMock } = (await import(harness)) as { startMock: (o: { port: number; quiet: boolean }) => Promise<Mock> };
  mock = await startMock({ port: 0, quiet: true });
  mock.store.load({
    tables: {
      orders: [{
        id: ORDER, order_number: "CD-5001", customer_name: "Pat Collector", customer_email: "pat@example.com", customer_phone: null,
        status: "in_progress", payment_status: "paid", restoration_tier: "premium", inbound_method: "self_ship",
        customer_notes: "Please be gentle with the corners.\nCall me first.", created_at: "2026-11-23T19:00:00+00:00", updated_at: "2026-11-23T19:00:00+00:00",
      }],
      tier_bags: [{
        id: BAG, order_id: ORDER, tier: "premium", batch: 1, bag_code: "CD-5001-G", received_on: "2026-11-16", due_date: "2026-12-07",
        due_status: "calculated", turnaround_days: 15, source: "receiving", created_at: "2026-11-23T19:30:00+00:00",
      }],
      cards: [
        card(1, { notes: "Small crease top left", known_defects: "Whitening on back", estimated_value_cents: 25000, variation: "Holo",
          receiving_photo_urls: ["https://example.supabase.co/r1.jpg"], photo_urls: ["https://example.supabase.co/c1.jpg", "not a link"] }),
        card(2), card(3), card(4),
      ],
      order_events: [],
      locations: [
        { id: "00000000-0000-4000-8000-00000de5f001", code: "LOC-DONE", name: "Done", kind: "done", sort: 900, active: true, created_at: "2026-11-24T00:00:00+00:00" },
        { id: "00000000-0000-4000-8000-00000de5f002", code: "LOC-SHIP", name: "Shipping", kind: "shipping", sort: 1000, active: true, created_at: "2026-11-24T00:00:00+00:00" },
        // Looks like a desk, isn't one
        { id: "00000000-0000-4000-8000-00000de5f003", code: "LOC-DESKTOP", name: "DESKTOP", kind: "other", sort: 0, active: true, created_at: "2026-11-24T00:00:00+00:00" },
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
  svc = {
    moves: await import("@/lib/intake/tracking/moves"),
    locations: await import("@/lib/intake/tracking/locations"),
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await mock?.close();
});

test("ensureDesk: no desk -> LOC-DESK \"DESK\" (other), made once even when two pages ask at the same moment", async () => {
  assert.deepEqual(await deskPlaces(admin), [], "LOC-DESKTOP isn't a desk");
  const [a, b] = await Promise.all([ensureDesk(admin, "gavin"), ensureDesk(admin, "gavin")]);
  assert.deepEqual([a.created, b.created].sort(), [false, true]);
  assert.equal(a.location.id, b.location.id);
  assert.deepEqual([a.location.code, a.location.name, a.location.kind, a.location.stage, a.location.active], [DESK_CODE, "DESK", "other", null, true]);
  assert.equal(mock.store.table("locations").filter((l) => l.code === DESK_CODE).length, 1);
  const desks = await deskPlaces(admin);
  assert.deepEqual(desks.map((d) => [d.code, d.cardCount]), [[DESK_CODE, 0]]);
  assert.deepEqual(await loadDeskCards(admin, desks[0].id), []);
});

test("heat press cards moved to the desk together: every card shows with its order, notes and where it came from; steps stay", async () => {
  const made = await svc.locations.createSlots(admin, { station: "heat-press", count: 3, by: "gavin" });
  assert.ok(made.ok, made.ok ? "" : made.error);
  // A heat press takes one card (owner, Nov 26 2026): three at once are refused, force or not
  const stack = await svc.moves.assignCards(admin, { locationCode: "LOC-HEAT-PRESS-01", cardIds: [C(1), C(2), C(3)], force: true, by: "gavin" });
  assert.deepEqual(stack.ok ? null : [stack.status, stack.error], [409, "HEAT PRESS 01 holds one card. Pick one card to put here."]);
  for (const n of [1, 2, 3]) {
    const press = await svc.moves.assignCards(admin, { locationCode: `LOC-HEAT-PRESS-0${n}`, cardIds: [C(n)], by: "gavin" });
    assert.ok(press.ok, press.ok ? "" : press.error);
  }
  await tick();
  // All three onto DESK in one go (the desk takes any number)
  const moved = await svc.moves.assignCards(admin, { locationCode: "https://thecarddoc1.com/q/loc-desk", cardIds: [C(1), C(2), C(3)], by: "sam" });
  assert.ok(moved.ok, moved.ok ? "" : moved.error);
  assert.equal(moved.ok && moved.changed, 3);
  await tick();
  // One more, straight from its bag
  const loose = await svc.moves.assignCards(admin, { locationCode: DESK_CODE, cardIds: [C(4)], by: "gavin" });
  assert.ok(loose.ok, loose.ok ? "" : loose.error);

  const [desk] = await deskPlaces(admin);
  assert.deepEqual([desk.code, desk.cardCount], [DESK_CODE, 4]);
  const cards = await loadDeskCards(admin, desk.id);
  // Newest on the desk first, then the stack by Card ID
  assert.deepEqual(cards.map((c) => c.code), ["CD-5001-04", "CD-5001-01", "CD-5001-02", "CD-5001-03"]);
  for (const c of cards) {
    assert.equal(c.location?.code, DESK_CODE);
    assert.equal(c.customer, "Pat Collector");
    assert.equal(c.orderNumber, "CD-5001");
    assert.equal(c.orderUrl, `/admin/orders/${ORDER}`);
    assert.equal(c.customerNotes, "Please be gentle with the corners.\nCall me first.");
    assert.equal(c.dueDate, "2026-12-07");
    assert.equal(c.tierName, "Gold");
    assert.ok(c.locatedAt);
  }
  const [four, one, two] = cards;
  // The desk changes the place only: the stack keeps Heat Press, the loose card stays not started
  assert.deepEqual([one.stageLabel, two.stageLabel, four.stageLabel], ["Heat Press", "Heat Press", "Not started"]);
  assert.deepEqual([one.arrival?.from?.name, one.arrival?.by, one.arrival?.action], ["HEAT PRESS 01", "sam", "assign"]);
  assert.deepEqual([four.arrival?.from, four.arrival?.by], [null, "gavin"]);
  assert.deepEqual(
    [one.name, one.year, one.set, one.number, one.variation, one.notes, one.knownDefects, one.declaredValueCents],
    ["Charizard 1", "1999", "Base Set", "1/102", "Holo", "Small crease top left", "Whitening on back", 25000],
  );
  assert.deepEqual([one.receivingPhotos, one.customerPhotos], [["https://example.supabase.co/r1.jpg"], ["https://example.supabase.co/c1.jpg"]]);
  assert.deepEqual([two.notes, two.knownDefects, two.declaredValueCents], [null, null, null]);

  // The panel's view of it
  const panel = deskPanelCard(one);
  assert.equal(panel.details, "1999 · Base Set · #1/102 · Holo");
  assert.equal(panel.declaredValue, "$250.00");
  assert.deepEqual(panel.photos.map((g) => g.kind), ["receiving", "customer"]);
  assert.deepEqual(panel.arrival && [panel.arrival.fromName, panel.arrival.by], ["HEAT PRESS 01", "sam"]);
  assert.equal(panel.step.label, "Heat Press");

  // Off the desk: gone from it
  const out = await svc.moves.releaseCards(admin, { cardIds: [C(4)], by: "gavin" });
  assert.ok(out.ok);
  assert.deepEqual((await loadDeskCards(admin, desk.id)).map((c) => c.code), ["CD-5001-01", "CD-5001-02", "CD-5001-03"]);
});

test("more desks: LOC-DESK-<NAME> places count; a switched-off LOC-DESK stays off", async () => {
  const gavin = await svc.locations.createLocation(admin, { name: "Desk Gavin", kind: "other", by: "gavin" });
  assert.ok(gavin.ok && gavin.location.code === "LOC-DESK-GAVIN");
  const first = mock.store.table("locations").find((l) => l.code === DESK_CODE)!;
  const off = await svc.locations.updateLocation(admin, { id: first.id as string, active: false });
  assert.ok(off.ok);
  const again = await ensureDesk(admin, "gavin");
  assert.deepEqual([again.created, again.location.active], [false, false]);
  const desks = await deskPlaces(admin);
  assert.deepEqual(desks.map((d) => [d.code, d.active, d.cardCount]), [["LOC-DESK-GAVIN", true, 0], [DESK_CODE, false, 3]]);
  assert.equal(pickDesk(desks)?.code, "LOC-DESK-GAVIN");
  assert.equal(pickDesk(desks, DESK_CODE)?.code, DESK_CODE);
});

test("Take out, then Undo (assign back to the desk with force): the cards are on the desk again with their step", async () => {
  const gavin = mock.store.table("locations").find((l) => l.code === "LOC-DESK-GAVIN")!;
  assert.equal(gavin.capacity ?? null, null, "a desk has no limit");
  // The heat press cards (on the switched-off LOC-DESK) go on DESK GAVIN
  const on = await svc.moves.assignCards(admin, { locationCode: "LOC-DESK-GAVIN", cardIds: [C(1), C(2), C(3)], by: "gavin" });
  assert.ok(on.ok, on.ok ? "" : on.error);
  await tick();
  // Take out two (the Desk page's "Take out"), then Undo
  const out = await svc.moves.releaseCards(admin, { cardIds: [C(1), C(2)], by: "gavin" });
  assert.ok(out.ok && out.results.every((r) => r.ok));
  assert.deepEqual((await loadDeskCards(admin, gavin.id as string)).map((c) => c.code), ["CD-5001-03"]);
  await tick();
  const undo = await svc.moves.assignCards(admin, { locationCode: "LOC-DESK-GAVIN", cardIds: [C(1), C(2)], force: true, by: "gavin" });
  assert.ok(undo.ok && undo.results.every((r) => r.ok), undo.ok ? undo.message : undo.error);
  const back = await loadDeskCards(admin, gavin.id as string);
  assert.deepEqual(back.map((c) => c.code).sort(), ["CD-5001-01", "CD-5001-02", "CD-5001-03"]);
  assert.ok(back.every((c) => c.stageLabel === "Heat Press" && c.location?.code === "LOC-DESK-GAVIN"), "the desk never changes the step");
  // Without force too: a desk never answers "full"
  const again = await svc.moves.assignCards(admin, { locationCode: "LOC-DESK-GAVIN", cardIds: [C(4)], by: "gavin" });
  assert.ok(again.ok, again.ok ? "" : again.error);
  assert.equal((await deskPlaces(admin)).find((d) => d.code === "LOC-DESK-GAVIN")?.cardCount, 4);
});

test("only 'other' places are desks: a Done place named \"Desk Bin\" (LOC-DESK-BIN) isn't listed", async () => {
  const bin = await svc.locations.createLocation(admin, { name: "Desk Bin", kind: "done", by: "gavin" });
  assert.ok(bin.ok && bin.location.code === "LOC-DESK-BIN" && bin.location.kind === "done");
  assert.deepEqual((await deskPlaces(admin)).map((d) => d.code), ["LOC-DESK-GAVIN", DESK_CODE]);
});
