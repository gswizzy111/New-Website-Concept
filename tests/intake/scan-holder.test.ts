/**
 * The Scan page's holder view (components/intake/scan/holder-view.tsx; owner,
 * Nov 26 2026: "when you scan on a station that has a card in it, it is a
 * little more clear"): its words and rules (holder-format.ts), the desks a
 * scanned place now answers with (TrackSlotSummary.desks, desk.ts
 * deskRefs / loadDeskRefs), and what the result line says after real
 * Move to my desk, Move to another holder, Done and Take out answers from the
 * in-memory Supabase stand-in (tests/intake/harness/mock-supabase.mjs).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  EMPTY_HOLDER_TEXT, actionLabel, cardDetails, deskLinkCode, doneQuestion, doneYesLabel, dueLine, durationText, holderButtons,
  holderCountText, holderHeading, holderOutcome, inHolderText, isHolderPlace, isStack, myDesk, onYourDeskText, orderLine,
  pickedText, savingText, shortDay, takenOutText,
} from "@/components/intake/scan/holder-format";
import { deskRefs } from "@/lib/intake/tracking/desk";
import type { TrackActionResponse, TrackBagPlace, TrackDeskRef } from "@/lib/intake/tracking/types";

// ─── Pure ───────────────────────────────────────────────────────────────

test("which places get the holder view: work-station slots and other places (desks), not the Open bags box, shelves, Done or Shipping", () => {
  assert.equal(isHolderPlace({ kind: "station", code: "LOC-CLAMP-07" }), true);
  assert.equal(isHolderPlace({ kind: "other", code: "LOC-DESK" }), true);
  assert.equal(isHolderPlace({ kind: "other", code: "LOC-BENCH-2" }), true);
  assert.equal(isHolderPlace({ kind: "other", code: "LOC-OPEN-BAGS" }), false);
  assert.equal(isHolderPlace({ kind: "shelf", code: "LOC-SHELF-20261207" }), false);
  assert.equal(isHolderPlace({ kind: "done", code: "LOC-DONE" }), false);
  assert.equal(isHolderPlace({ kind: "shipping", code: "LOC-SHIP" }), false);
});

test("the header: 'has 1 card' with a limit, '8 cards' for a stack, 'empty'", () => {
  assert.equal(holderHeading({ name: "CLAMP 07", capacity: 1, cardCount: 1 }), "CLAMP 07 · has 1 card");
  assert.equal(holderHeading({ name: "CLAMP 07", capacity: 1, cardCount: 2 }), "CLAMP 07 · has 2 cards");
  assert.equal(holderHeading({ name: "HEAT PRESS 02", capacity: null, cardCount: 8 }), "HEAT PRESS 02 · 8 cards");
  assert.equal(holderHeading({ name: "HEAT PRESS 02", capacity: null, cardCount: 1 }), "HEAT PRESS 02 · 1 card");
  assert.equal(holderHeading({ name: "CLAMP 07", capacity: 1, cardCount: 0 }), "CLAMP 07 · empty");
  assert.equal(holderCountText({ capacity: null, cardCount: 0 }), "empty");
  assert.deepEqual([isStack({ capacity: null }), isStack({ capacity: 1 }), isStack({ capacity: 3 })], [true, false, false]);
  assert.equal(EMPTY_HOLDER_TEXT, "Empty. Scan a bag or card to put one here.");
});

test("the card's lines: year · set · #, whose order and tier", () => {
  assert.equal(cardDetails({ year: "1999", set: "Base Set", number: "4/102" }), "1999 · Base Set · #4/102");
  assert.equal(cardDetails({ year: null, set: "Jungle", number: "#7" }), "Jungle · #7");
  assert.equal(cardDetails({ year: " ", set: null, number: null }), "");
  assert.equal(orderLine({ customer: "Maria Reyes", orderNumber: "CD-2549", tierName: "Gold" }), "Maria Reyes · Order CD-2549 · Gold");
  assert.equal(orderLine({ customer: null, orderNumber: "CD-2549", tierName: "Gold" }), "No name · Order CD-2549 · Gold");
});

test("due date with days left or late, in New York days", () => {
  const today = "2026-12-10";
  assert.equal(shortDay("2026-12-07", today), "Mon Dec 7");
  assert.equal(shortDay("2027-01-04", today), "Mon Jan 4, 2027");
  assert.deepEqual(dueLine("2026-12-07", today), { text: "Due Mon Dec 7 · 3 days late", late: true });
  assert.deepEqual(dueLine("2026-12-09", today), { text: "Due Wed Dec 9 · 1 day late", late: true });
  assert.deepEqual(dueLine("2026-12-10", today), { text: "Due Thu Dec 10 · today", late: false });
  assert.deepEqual(dueLine("2026-12-11", today), { text: "Due Fri Dec 11 · 1 day left", late: false });
  assert.deepEqual(dueLine("2026-12-14", today), { text: "Due Mon Dec 14 · 4 days left", late: false });
  assert.deepEqual(dueLine("2027-01-04", today), { text: "Due Mon Jan 4, 2027 · 25 days left", late: false });
  assert.deepEqual(dueLine(null, today), { text: "No due date", late: false });
  assert.deepEqual(dueLine("soon", today), { text: "No due date", late: false });
});

test("time in this holder: 'In CLAMP 07 for 2 days', on a desk, at another place, just now", () => {
  const now = Date.parse("2026-11-26T18:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const MIN = 60_000;
  const H = 60 * MIN;
  assert.deepEqual([durationText(30_000), durationText(MIN), durationText(12 * MIN), durationText(H), durationText(5 * H), durationText(24 * H), durationText(47 * H), durationText(50 * H)],
    [null, "1 minute", "12 minutes", "1 hour", "5 hours", "1 day", "1 day", "2 days"]);
  const clamp = { kind: "station" as const, code: "LOC-CLAMP-07", name: "CLAMP 07" };
  assert.equal(inHolderText(clamp, ago(2 * 24 * H + 3 * H), now), "In CLAMP 07 for 2 days");
  assert.equal(inHolderText(clamp, ago(10_000), now), "Put in CLAMP 07 just now");
  assert.equal(inHolderText(clamp, ago(-5 * MIN), now), "Put in CLAMP 07 just now", "a server clock a little ahead");
  assert.equal(inHolderText(clamp, null, now), "In CLAMP 07");
  assert.equal(inHolderText({ kind: "other", code: "LOC-DESK-GAVIN", name: "DESK GAVIN" }, ago(3 * H), now), "On DESK GAVIN for 3 hours");
  assert.equal(inHolderText({ kind: "other", code: "LOC-DESK", name: "DESK" }, ago(5_000), now), "Put on DESK just now");
  assert.equal(inHolderText({ kind: "other", code: "LOC-BENCH-2", name: "BENCH 2" }, ago(12 * MIN), now), "At BENCH 2 for 12 minutes");
});

test("my desk: the one this phone picked while it is a switched-on desk, else the first; none; an answer without desks", () => {
  const desks: TrackDeskRef[] = [{ id: "d1", code: "LOC-DESK", name: "DESK" }, { id: "d2", code: "LOC-DESK-GAVIN", name: "DESK GAVIN" }];
  assert.equal(myDesk(desks, "")?.code, "LOC-DESK");
  assert.equal(myDesk(desks, "loc-desk-gavin")?.code, "LOC-DESK-GAVIN");
  assert.equal(myDesk(desks, "LOC-DESK-GONE")?.code, "LOC-DESK", "switched off or deleted: the first");
  assert.equal(myDesk([], "LOC-DESK-GAVIN"), null, "no desk at all");
  assert.deepEqual(myDesk(undefined, "LOC-DESK-GAVIN"), { id: "", code: "LOC-DESK-GAVIN", name: "your desk" });
  assert.deepEqual(myDesk(undefined, "LOC-CLAMP-07"), { id: "", code: "LOC-DESK", name: "your desk" });
});

test("the buttons: one obvious primary; one card, a stack, on my own desk, a refunded card", () => {
  assert.deepEqual(holderButtons({ stack: false, onMyDesk: false }), { primary: "desk", others: ["other", "done", "takeout"] });
  assert.deepEqual(holderButtons({ stack: false, onMyDesk: true }), { primary: "other", others: ["done", "takeout"] });
  assert.deepEqual(holderButtons({ stack: false, onMyDesk: false, refunded: true }), { primary: "takeout", others: [] });
  assert.deepEqual(holderButtons({ stack: true, onMyDesk: false }), { primary: "desk", others: ["done", "other", "takeout"] });
  assert.deepEqual(holderButtons({ stack: true, onMyDesk: true }), { primary: "other", others: ["done", "takeout"] });
  assert.deepEqual((["desk", "other", "done", "takeout"] as const).map((a) => actionLabel(a, false)),
    ["Move to my desk", "Move to another holder", "Done", "Take out"]);
  assert.deepEqual((["desk", "other", "done", "takeout"] as const).map((a) => actionLabel(a, true, 8)),
    ["Move all 8 to my desk", "Move selected", "Done for selected", "Take out selected"]);
  assert.equal(actionLabel("desk", true, 1), "Move 1 card to my desk");
  assert.deepEqual([pickedText(0, 8), pickedText(3, 8), pickedText(8, 8)], ["None picked", "3 of 8 picked", "All 8 picked"]);
  assert.deepEqual([doneQuestion(1), doneYesLabel(1)], ["Mark it done? Then put it back in its bag.", "Mark done"]);
  assert.deepEqual([doneQuestion(3), doneYesLabel(3)], ["Mark 3 cards done? Then put each back in its bag.", "Mark 3 cards done"]);
  assert.deepEqual(
    [savingText("desk", "CD-2549-03"), savingText("other", "3 cards", "HEAT PRESS 02"), savingText("done", "CD-2549-03"), savingText("takeout", "CD-2549-03")],
    ["Moving CD-2549-03 to your desk…", "Moving 3 cards to HEAT PRESS 02…", "Marking CD-2549-03 done…", "Taking CD-2549-03 out…"],
  );
});

test("result words: on your desk, taken out (not done) and where the bag is, the desk link", () => {
  assert.equal(onYourDeskText("CD-2549-03", 1), "CD-2549-03 is on your desk.");
  assert.equal(onYourDeskText("8 cards", 8), "All 8 cards are on your desk.");
  const bag: TrackBagPlace = {
    id: "b1", code: "CD-2549-P", customer: "Maria Reyes", letter: "R", opened: false, returned: 0, finished: false, doneCount: 1, cardCount: 4,
    location: { id: "l1", code: "LOC-OPEN-BAGS", name: "OPEN BAGS", kind: "other", station: null, serial: null, stage: null },
  };
  assert.equal(takenOutText("CD-2549-03", 1, "CLAMP 07", [bag]), "CD-2549-03 taken out of CLAMP 07, not done. Put it back in REYES's bag: Open bags box, under R.");
  assert.equal(takenOutText("3 cards", 3, "HEAT PRESS 02", [bag]), "3 cards taken out of HEAT PRESS 02, not done. Put them back in REYES's bag: Open bags box, under R.");
  assert.equal(takenOutText("CD-2549-03", 1, "CLAMP 07", undefined), "CD-2549-03 taken out of CLAMP 07, not done. Put it back in its bag.");
  const desk = { id: "d", code: "LOC-DESK-GAVIN", name: "DESK GAVIN", kind: "other" as const, station: null, serial: null, stage: null };
  const ok = { cardId: "c", code: "CD-2549-03", name: "Charizard", ok: true, changed: true, message: "In DESK GAVIN." };
  assert.equal(deskLinkCode({ location: desk, results: [ok] }), "LOC-DESK-GAVIN");
  assert.equal(deskLinkCode({ location: desk, results: [{ ...ok, ok: false }] }), null, "nothing went: no link");
  assert.equal(deskLinkCode({ location: { ...desk, code: "LOC-CLAMP-07", kind: "station" }, results: [ok] }), null);
  assert.equal(deskLinkCode({ location: null, results: [ok] }), null);
});

test("deskRefs: switched-on 'other' places with a desk code, LOC-DESK first", () => {
  const row = (code: string, name: string, over: Partial<{ active: boolean; kind: "other" | "done"; sort: number }> = {}) =>
    ({ id: code, code, name, kind: "other" as const, active: true, sort: 0, ...over });
  assert.deepEqual(deskRefs([
    row("LOC-DESK-ZED", "DESK ZED"), row("LOC-DESK-OLD", "DESK OLD", { active: false }), row("LOC-DESKTOP", "DESKTOP"),
    row("LOC-DESK", "DESK"), row("LOC-DESK-AMY", "DESK AMY"), row("LOC-DESK-X", "DESK X", { kind: "done" }),
  ]).map((d) => [d.code, d.name]), [["LOC-DESK", "DESK"], ["LOC-DESK-AMY", "DESK AMY"], ["LOC-DESK-ZED", "DESK ZED"]]);
  assert.deepEqual(Object.keys(deskRefs([row("LOC-DESK", "DESK")])[0]).sort(), ["code", "id", "name"]);
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

const ORDER = "00000000-0000-4000-8000-00000ab00001";
const BAG = "00000000-0000-4000-8000-00000ab0b001";
const C = (n: number) => `00000000-0000-4000-8000-00000ab0c0${String(n).padStart(2, "0")}`;
const card = (n: number, over: Row = {}): Row => ({
  id: C(n), order_id: ORDER, card_name: `Charizard ${n}`, card_set: "Base Set", card_year: "1999", card_number: `${n}/102`,
  variation: null, notes: null, known_defects: null, estimated_value_cents: null, photo_urls: [], catalog_image_url: null,
  tier: null, status: "active", completed: false, completed_at: null, current_round: 1, created_at: "2026-11-23T19:00:00.000000+00:00",
  card_seq: n, card_code: `CD-6001-${String(n).padStart(2, "0")}`, bag_id: BAG, received_at: "2026-11-23T19:30:00+00:00",
  received_by: "gavin", awaiting_arrival: false, receiving_photo_urls: [], location_id: null, located_at: null, refunded_cents: 0,
  service_ids: [], slab_removal_selected: false, pregrade_selected: false, ...over,
});
const tick = () => new Promise((r) => setTimeout(r, 5));
const loc = (code: string) => mock.store.table("locations").find((l) => l.code === code);

before(async () => {
  const harness = pathToFileURL(path.resolve("tests/intake/harness/mock-supabase.mjs")).href;
  const { startMock } = (await import(harness)) as { startMock: (o: { port: number; quiet: boolean }) => Promise<Mock> };
  mock = await startMock({ port: 0, quiet: true });
  mock.store.load({
    tables: {
      orders: [{
        id: ORDER, order_number: "CD-6001", customer_name: "Maria Reyes", customer_email: "maria@example.com", customer_phone: "555-0100",
        ship_from_address: {}, ship_to_address: {}, subtotal_cents: 10000, total_cents: 10000, refunded_cents: 0,
        slab_crack_count: 0, instagram_feature: false, gift_card_discount_cents: 0, admin_notes: null,
        status: "in_progress", payment_status: "paid", restoration_tier: "premium", inbound_method: "self_ship",
        customer_notes: null, created_at: "2026-11-23T19:00:00+00:00", updated_at: "2026-11-23T19:00:00+00:00",
      }],
      tier_bags: [{
        id: BAG, order_id: ORDER, tier: "premium", batch: 1, bag_code: "CD-6001-G", received_on: "2026-11-16", due_date: "2026-12-07",
        due_status: "calculated", turnaround_days: 15, source: "receiving", created_at: "2026-11-23T19:30:00+00:00",
      }],
      cards: [card(1), card(2), card(3), card(4)],
      order_events: [],
      locations: [
        { id: "00000000-0000-4000-8000-00000ab0f001", code: "LOC-DONE", name: "Done", kind: "done", sort: 900, active: true, created_at: "2026-11-24T00:00:00+00:00" },
        { id: "00000000-0000-4000-8000-00000ab0f002", code: "LOC-SHIP", name: "Shipping", kind: "shipping", sort: 1000, active: true, created_at: "2026-11-24T00:00:00+00:00" },
        { id: "00000000-0000-4000-8000-00000ab0f003", code: "LOC-DESKTOP", name: "DESKTOP", kind: "other", sort: 0, active: true, created_at: "2026-11-24T00:00:00+00:00" },
      ],
      card_moves: [],
      restoration_settings: [{ tier: "premium", display_name: "Gold", turnaround_min_days: 15, turnaround_max_days: 20 }],
      business_holidays: [],
    },
  });
  // No customer email leaves the test: Resend's API is caught here
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
  const clamps = await svc.locations.createSlots(admin, { station: "clamp", count: 2, by: "gavin" });
  assert.ok(clamps.ok, clamps.ok ? "" : clamps.error);
  const press = await svc.locations.createSlots(admin, { station: "heat-press", count: 1, by: "gavin" });
  assert.ok(press.ok, press.ok ? "" : press.error);
});

after(async () => {
  globalThis.fetch = realFetch;
  await mock?.close();
});

async function holder(code: string) {
  const r = await svc.resolve.resolveTrackCode(admin, code);
  assert.ok(r.ok && r.response.kind === "location", r.ok ? r.response.kind : r.error);
  if (!r.ok || r.response.kind !== "location") throw new Error("not a place");
  return r.response.location;
}

test("a scanned place answers with the desks for Move to my desk: none yet, then the switched-on ones, LOC-DESK first", async () => {
  assert.deepEqual((await holder("LOC-CLAMP-01")).desks, [], "LOC-DESKTOP isn't a desk; nothing is made by a scan");
  assert.equal(loc("LOC-DESK"), undefined);
  for (const name of ["Desk", "Desk Gavin", "Desk Old"]) {
    const made = await svc.locations.createLocation(admin, { name, kind: "other", by: "gavin" });
    assert.ok(made.ok, made.ok ? "" : made.error);
  }
  const old = await svc.locations.updateLocation(admin, { id: loc("LOC-DESK-OLD")!.id as string, active: false });
  assert.ok(old.ok);
  const clamp = await holder("LOC-CLAMP-01");
  assert.deepEqual(clamp.desks?.map((d) => [d.code, d.name]), [["LOC-DESK", "Desk"], ["LOC-DESK-GAVIN", "Desk Gavin"]]);
  assert.deepEqual(clamp.desks?.[0], { id: loc("LOC-DESK")!.id, code: "LOC-DESK", name: "Desk" });
  // Every place answers with them, a desk too (the holder view leaves out "Move to my desk" on your own desk)
  assert.equal((await holder("LOC-DESK-GAVIN")).desks?.length, 2);
});

test("a holder with a card, then each button's answer as the result line says it", async () => {
  // A card into CLAMP 01: the header and the card's lines
  const put = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-01", cardIds: [C(1)], by: "gavin" });
  assert.ok(put.ok, put.ok ? "" : put.error);
  const clamp = await holder("LOC-CLAMP-01");
  assert.equal(holderHeading(clamp), "CLAMP 01 · has 1 card");
  const [c1] = clamp.cards;
  assert.deepEqual([c1.code, c1.name, cardDetails(c1), orderLine(c1), c1.stageLabel], ["CD-6001-01", "Charizard 1", "1999 · Base Set · #1/102", "Maria Reyes · Order CD-6001 · Gold", "Clamp Work"]);
  assert.equal(dueLine(c1.dueDate, "2026-12-10").text, "Due Mon Dec 7 · 3 days late");
  assert.equal(inHolderText(c1.location!, c1.locatedAt, Date.parse(c1.locatedAt!) + 2 * 86_400_000), "In CLAMP 01 for 2 days");
  await tick();

  // Move to my desk (POST move, the holder to the desk)
  const desk = myDesk(clamp.desks, "")!;
  const toDesk = await svc.moves.moveSlot(admin, { fromCode: clamp.code, toCode: desk.code, cardIds: [C(1)], force: true, by: "gavin" });
  assert.ok(toDesk.ok, toDesk.ok ? "" : toDesk.error);
  const deskOut = holderOutcome("desk", [c1], toDesk as TrackActionResponse, clamp.name);
  assert.deepEqual([deskOut.outcome.tone, deskOut.outcome.title, deskOut.outcome.lines, deskOut.deskCode], ["ok", "CD-6001-01 is on your desk.", [], "LOC-DESK"]);
  assert.equal(holderHeading(await holder("LOC-CLAMP-01")), "CLAMP 01 · empty");
  await tick();

  // A stack: 3 cards in HEAT PRESS 01, then Move all 3 to my desk
  const stack = await svc.moves.assignCards(admin, { locationCode: "LOC-HEAT-PRESS-01", cardIds: [C(2), C(3), C(4)], by: "gavin" });
  assert.ok(stack.ok, stack.ok ? "" : stack.error);
  const press = await holder("LOC-HEAT-PRESS-01");
  assert.equal(holderHeading(press), "HEAT PRESS 01 · 3 cards");
  await tick();
  const all = await svc.moves.moveSlot(admin, { fromCode: press.code, toCode: "LOC-DESK-GAVIN", cardIds: press.cards.map((c) => c.id), force: true, by: "gavin" });
  assert.ok(all.ok, all.ok ? "" : all.error);
  assert.equal(holderOutcome("desk", press.cards, all as TrackActionResponse, press.name).outcome.title, "All 3 cards are on your desk.");
  await tick();

  // Move to another holder (the picker or a scan): the server's sentence with the new step
  const other = await svc.moves.moveSlot(admin, { fromCode: "LOC-DESK-GAVIN", toCode: "LOC-CLAMP-02", cardIds: [C(2)], by: "gavin" });
  assert.ok(other.ok, other.ok ? "" : other.error);
  const otherOut = holderOutcome("other", [], other as TrackActionResponse, "DESK GAVIN");
  assert.deepEqual([otherOut.outcome.title, otherOut.deskCode], ["In CLAMP 02. Step: Clamp Work.", null]);
  await tick();

  // Take out: back in its bag, not done; where the bag is (filed in the Open bags box when the card first came out)
  const out = await svc.moves.releaseCards(admin, { cardIds: [C(2)], by: "gavin" });
  assert.ok(out.ok, out.ok ? "" : out.error);
  const clamp2 = { name: "CLAMP 02" };
  assert.equal(
    holderOutcome("takeout", [{ code: "CD-6001-02", name: "Charizard 2" }], out as TrackActionResponse, clamp2.name).outcome.title,
    "CD-6001-02 taken out of CLAMP 02, not done. Put it back in REYES's bag: Open bags box, under R.",
  );
  assert.equal((await holder("LOC-CLAMP-02")).cardCount, 0);
  await tick();

  // Done for selected on the desk: the server's sentence (where the bag is) and the order's line
  const done = await svc.moves.markCardsDone(admin, { cardIds: [C(3), C(4)], by: "gavin" });
  assert.ok(done.ok, done.ok ? "" : done.error);
  const doneOut = holderOutcome("done", [], done as TrackActionResponse, "DESK GAVIN");
  assert.equal(doneOut.outcome.tone, "ok");
  assert.equal(doneOut.outcome.title, "2 cards done. Put them back in REYES's bag: Open bags box, under R.");
  assert.deepEqual(doneOut.outcome.lines, [], "every card went: no line per card");
  assert.equal(doneOut.deskCode, null);
});

test("a refused card keeps its line; the order's line after its last card; a failed move says why", async () => {
  // C(1) is on LOC-DESK; asking to move it out of CLAMP 01 (it left) is refused as a whole: the result line is the error
  const gone = await svc.moves.moveSlot(admin, { fromCode: "LOC-CLAMP-01", toCode: "LOC-DESK", cardIds: [C(1)], force: true, by: "gavin" });
  assert.ok(!gone.ok && gone.status === 409);
  assert.equal(gone.error, "Those cards aren't in CLAMP 01 any more.");
  // Done for selected with a refunded card picked: it is refused (its line stays), the other is done and was the order's last
  const two = mock.store.table("cards").find((c) => c.id === C(2))!;
  two.status = "refunded";
  const mixed = await svc.moves.markCardsDone(admin, { cardIds: [C(1), C(2)], by: "gavin" });
  assert.ok(mixed.ok, mixed.ok ? "" : mixed.error);
  const r = holderOutcome("done", [], mixed as TrackActionResponse, "DESK");
  assert.equal(r.outcome.tone, "warn");
  assert.deepEqual(r.outcome.lines.map((l) => [l.label, l.ok, l.message]), [
    ["CD-6001-01", true, "Done."],
    ["CD-6001-02", false, "CD-6001-02 was refunded. Not moved."],
  ]);
  assert.deepEqual(r.outcome.orderNotes?.map((n) => n.tone), ["ok"], "the order completed (green)");
  assert.match(r.outcome.orderNotes?.[0].text ?? "", /^Order completed\./);
});
