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
  ADD_HERE_TEXT, EMPTY_HOLDER_TEXT, PICKS_LOCKED_TEXT, SAVE_BUSY_TEXT, SWITCHED_OFF_TEXT, actionLabel, actionShortLabel, addAnywayText,
  barCardLine, cardDetails, deskLinkCode, doneQuestion, doneYesLabel, dueLine, durationText, holderActionDisabled, holderButtons,
  holderCountText, holderHeading, holderOutcome, inHolderText, inItNowText, isHolderPlace, isStack, myDesk, onYourDeskText, orderLine,
  pickedText, savingText, scanSaveResult, settledCardIds, shortDay, takenOutText, withoutGone, type HolderAction, type HolderButtonState,
} from "@/components/intake/scan/holder-format";
import { scanReadLabel } from "@/components/intake/scan/parse";
import { newWedge, wedgeKey } from "@/components/intake/scan/wedge";
import { deskRefs } from "@/lib/intake/tracking/desk";
import type { CapacityConflict, TrackActionResponse, TrackBagPlace, TrackCardSummary, TrackDeskRef, TrackSlotSummary } from "@/lib/intake/tracking/types";

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

test("the header: 'has 1 card' for a holder (one card each), '8 cards' for a desk (the only stack), 'empty'", () => {
  const clamp = { name: "CLAMP 07", kind: "station" as const, code: "LOC-CLAMP-07" };
  const press = { name: "HEAT PRESS 02", kind: "station" as const, code: "LOC-HEAT-PRESS-02" };
  const desk = { name: "DESK", kind: "other" as const, code: "LOC-DESK" };
  assert.equal(holderHeading({ ...clamp, cardCount: 1 }), "CLAMP 07 · has 1 card");
  assert.equal(holderHeading({ ...clamp, cardCount: 2 }), "CLAMP 07 · has 2 cards", "2 from before the rule");
  assert.equal(holderHeading({ ...press, cardCount: 1 }), "HEAT PRESS 02 · has 1 card", "a heat press holds one card now");
  assert.equal(holderHeading({ ...desk, cardCount: 8 }), "DESK · 8 cards");
  assert.equal(holderHeading({ ...desk, cardCount: 1 }), "DESK · 1 card");
  assert.equal(holderHeading({ ...clamp, cardCount: 0 }), "CLAMP 07 · empty");
  assert.equal(holderCountText({ ...desk, cardCount: 0 }), "empty");
  // Only a desk is a stack (tick boxes, "Move all N to my desk"): a heat press, BENCH 2 or LOC-DESKTOP is not
  assert.deepEqual(
    [desk, { kind: "other" as const, code: "LOC-DESK-GAVIN" }, press, clamp, { kind: "other" as const, code: "LOC-BENCH-2" }, { kind: "other" as const, code: "LOC-DESKTOP" }].map(isStack),
    [true, true, false, false, false, false],
  );
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

// ─── Review fixes (Nov 26): no destructive focus, greyed while re-reading, switched off, ticks fixed ───

const ACTIONS: HolderAction[] = ["desk", "other", "done", "takeout"];
const enabled = (s: HolderButtonState) => ACTIONS.filter((a) => !holderActionDisabled(a, s));
const ONE: HolderButtonState = { blocked: false, stack: false, active: true, hasDesk: true, movable: 1, chosen: 0, refunded: false };

test("a broken scan's Enter never answers 'Mark done': the wedge keeps it from the focused element", () => {
  // The scanner's last 2 characters and its Enter (the rest of the read was lost), and a stray key + Enter
  for (const keys of [["P", "-", "Enter"], ["x", "Enter"]]) {
    const w = newWedge();
    let at = 5_000;
    const last = keys.map((k) => wedgeKey(w, k, (at += 8))).at(-1)!;
    assert.deepEqual(last, { scan: null, block: true }, keys.join(" "));
  }
});

test("the buttons: greyed while a save or its re-read runs; a switched-off holder keeps Take out and Done only", () => {
  assert.deepEqual(enabled(ONE), ["desk", "other", "done", "takeout"]);
  assert.deepEqual(enabled({ ...ONE, blocked: true }), [], "a save, its re-read of the holder, or a scan still running");
  assert.deepEqual(enabled({ ...ONE, active: false }), ["done", "takeout"], "switched off: moving out of it would be refused");
  assert.deepEqual(enabled({ ...ONE, hasDesk: false }), ["other", "done", "takeout"]);
  assert.deepEqual(enabled({ ...ONE, refunded: true }), ["takeout"]);
  const STACK: HolderButtonState = { ...ONE, stack: true, movable: 3, chosen: 0 };
  assert.deepEqual(enabled(STACK), ["desk"], "a stack with nothing ticked: Move all only");
  assert.deepEqual(enabled({ ...STACK, chosen: 2 }), ["desk", "other", "done", "takeout"]);
  assert.deepEqual(enabled({ ...STACK, chosen: 2, active: false }), ["done", "takeout"]);
  assert.equal(SWITCHED_OFF_TEXT, "This holder is switched off: use Take out or Done, or switch it on in Places.");
  assert.equal(SAVE_BUSY_TEXT, "Still saving the last change. Try again in a moment.");
  assert.equal(PICKS_LOCKED_TEXT, "Cancel to change the cards.");
  assert.equal(ADD_HERE_TEXT, "Scan a bag to add a card here.");
});

test("phone words: 'Another holder' for one card's Move to another holder; the bar's card line; 'Got it' says a place's name", () => {
  assert.equal(actionShortLabel("other", false), "Another holder");
  assert.equal(actionLabel("other", false), "Move to another holder", "its name stays the full words");
  assert.deepEqual(ACTIONS.filter((a) => a !== "other").map((a) => actionShortLabel(a, false)), [null, null, null]);
  assert.equal(actionShortLabel("other", true), null, "a stack's Move selected is short already");
  assert.equal(barCardLine({ code: "CD-2549-07", name: "Charizard", customer: "Maria Reyes" }), "CD-2549-07 · Charizard · Maria Reyes");
  assert.equal(barCardLine({ code: null, name: " ", customer: null }), "No Card ID");
  assert.equal(scanReadLabel("LOC-HEAT-PRESS-02"), "HEAT PRESS 02");
  assert.equal(scanReadLabel("LOC-DESK-GAVIN"), "DESK GAVIN");
  assert.equal(scanReadLabel("LOC-SHELF-20261207"), "DUE MON DEC 7");
  assert.equal(scanReadLabel("LOC-SHELF-20261399"), "SHELF 20261399", "not a day: read as is");
  assert.equal(scanReadLabel("CD-2549-P"), "CD-2549-P");
});

test("a full desk (a limit set in Places): 'Add anyway?' names what's in it", () => {
  const occ = (code: string, name: string | null) => ({ code, name } as TrackCardSummary);
  const conflict: CapacityConflict = { error: "DESK holds 2 cards and has 2 in it. Add anyway?", overCapacity: true, capacity: 2, occupants: [occ("CD-1-01", "Pikachu"), occ("CD-1-02", null)] };
  assert.equal(addAnywayText("DESK", conflict), "DESK already holds Pikachu and CD-1-02. Add anyway?");
  assert.equal(inItNowText(conflict), "In it now: CD-1-01, CD-1-02 · holds 2 cards");
  assert.equal(addAnywayText("DESK", { ...conflict, occupants: [] }), conflict.error);
  assert.equal(inItNowText({ capacity: 1, occupants: [] }), "It holds 1 card.");
  const five = ["A", "B", "C", "D", "E"].map((n) => occ(`CD-${n}`, n));
  assert.equal(addAnywayText("DESK", { ...conflict, occupants: five }), "DESK already holds A, B, C and 2 more. Add anyway?");
});

test("after a save the cards it took out leave the list at once, until the holder is read again", () => {
  const card = (id: string) => ({ id, code: id, name: id } as TrackCardSummary);
  const slot = { code: "LOC-HEAT-PRESS-01", name: "HEAT PRESS 01", cardCount: 3, cards: [card("a"), card("b"), card("c")] } as TrackSlotSummary;
  const res = { results: [{ cardId: "a", ok: true }, { cardId: "b", ok: false }, { cardId: "c", ok: true }] } as TrackActionResponse;
  assert.deepEqual(settledCardIds(res), ["a", "c"]);
  const shown = withoutGone(slot, { slot, ids: new Set(settledCardIds(res)) });
  assert.deepEqual([shown.cards.map((c) => c.id), shown.cardCount], [["b"], 1], "a failed re-read leaves only the refused card");
  const fresh = { ...slot } as TrackSlotSummary;
  assert.equal(withoutGone(fresh, { slot, ids: new Set(["a", "c"]) }), fresh, "a fresh read is shown as it is (a card put back meanwhile shows)");
  assert.equal(withoutGone(slot, null), slot);
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

  // A stack goes on a desk only: a heat press takes one card (owner, Nov 26 2026)
  const notPress = await svc.moves.assignCards(admin, { locationCode: "LOC-HEAT-PRESS-01", cardIds: [C(2), C(3), C(4)], force: true, by: "gavin" });
  assert.deepEqual(notPress.ok ? null : [notPress.status, notPress.error], [409, "HEAT PRESS 01 holds one card. Pick one card to put here."]);
  // 3 cards on DESK GAVIN, then Move all 3 to my desk
  const stack = await svc.moves.assignCards(admin, { locationCode: "LOC-DESK-GAVIN", cardIds: [C(2), C(3), C(4)], by: "gavin" });
  assert.ok(stack.ok, stack.ok ? "" : stack.error);
  const gavin = await holder("LOC-DESK-GAVIN");
  assert.equal(holderHeading(gavin), "Desk Gavin · 3 cards");
  assert.equal(isStack(gavin), true);
  await tick();
  const all = await svc.moves.moveSlot(admin, { fromCode: gavin.code, toCode: "LOC-DESK", cardIds: gavin.cards.map((c) => c.id), by: "gavin" });
  assert.ok(all.ok, all.ok ? "" : all.error);
  assert.equal(holderOutcome("desk", gavin.cards, all as TrackActionResponse, gavin.name).outcome.title, "All 3 cards are on your desk.");
  await tick();

  // Move to another holder (the picker or a scan): the server's sentence with the new step
  const other = await svc.moves.moveSlot(admin, { fromCode: "LOC-DESK", toCode: "LOC-CLAMP-02", cardIds: [C(2)], by: "gavin" });
  assert.ok(other.ok, other.ok ? "" : other.error);
  const otherOut = holderOutcome("other", [], other as TrackActionResponse, "DESK");
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
  const doneOut = holderOutcome("done", [], done as TrackActionResponse, "DESK");
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

test("Done / Take out from a holder name it (fromCode): a card moved meanwhile is refused with where it is now, never finished", async () => {
  for (const n of [5, 6, 7, 8, 9, 10]) mock.store.table("cards").push(card(n));
  // Two cards in one place: a desk (every other holder takes one card)
  const put = await svc.moves.assignCards(admin, { locationCode: "LOC-DESK-GAVIN", cardIds: [C(5), C(6)], by: "gavin" });
  assert.ok(put.ok, put.ok ? "" : put.error);
  await tick();
  // Another phone moves CD-6001-06 to CLAMP 02 while this one still shows DESK GAVIN with both
  const away = await svc.moves.moveSlot(admin, { fromCode: "LOC-DESK-GAVIN", toCode: "LOC-CLAMP-02", cardIds: [C(6)], by: "gavin" });
  assert.ok(away.ok, away.ok ? "" : away.error);
  await tick();
  const moves0 = mock.store.table("card_moves").length;
  const done = await svc.moves.markCardsDone(admin, { cardIds: [C(5), C(6)], fromCode: "LOC-DESK-GAVIN", by: "gavin" });
  assert.ok(done.ok, done.ok ? "" : done.error);
  assert.deepEqual(done.results.map((r) => [r.code, r.ok, r.message]), [
    ["CD-6001-05", true, "Done."],
    ["CD-6001-06", false, "Not in Desk Gavin any more (now in CLAMP 02)."],
  ]);
  const six = mock.store.table("cards").find((c) => c.id === C(6))!;
  assert.deepEqual([six.completed, six.location_id], [false, loc("LOC-CLAMP-02")!.id], "CD-6001-06 left alone: not done, still in CLAMP 02");
  assert.equal(mock.store.table("card_moves").length - moves0, 1, "one history row (CD-6001-05's)");
  const out = holderOutcome("done", [], done as TrackActionResponse, "Desk Gavin");
  assert.equal(out.outcome.tone, "warn");
  assert.deepEqual(out.outcome.lines.map((l) => [l.label, l.ok]), [["CD-6001-05", true], ["CD-6001-06", false]]);
  assert.deepEqual(settledCardIds(done as TrackActionResponse), [C(5)], "only the card that was done leaves the list");
  await tick();

  // None left in it: 409, nothing written; Done and Take out alike
  const again = await svc.moves.markCardsDone(admin, { cardIds: [C(6)], fromCode: "LOC-DESK-GAVIN", by: "gavin" });
  assert.deepEqual(again.ok ? null : [again.status, again.error], [409, "CD-6001-06 isn't in Desk Gavin any more (now in CLAMP 02)."]);
  const both = await svc.moves.releaseCards(admin, { cardIds: [C(5), C(6)], fromCode: "LOC-DESK-GAVIN", by: "gavin" });
  assert.deepEqual(both.ok ? null : [both.status, both.error],
    [409, "Those cards aren't in Desk Gavin any more: CD-6001-05 (now in its bag), CD-6001-06 (now in CLAMP 02)."]);
  assert.equal(mock.store.table("card_moves").length - moves0, 1, "nothing more written");
  const unknown = await svc.moves.releaseCards(admin, { cardIds: [C(6)], fromCode: "LOC-NOPE-01", by: "gavin" });
  assert.deepEqual(unknown.ok ? null : [unknown.status, unknown.error], [404, "No slot or place has the code LOC-NOPE-01."]);

  // From where it really is: taken out; without fromCode (the Desk, the scan landing) a card is done wherever it is
  const out6 = await svc.moves.releaseCards(admin, { cardIds: [C(6)], fromCode: "LOC-CLAMP-02", by: "gavin" });
  assert.ok(out6.ok && out6.results[0].ok, out6.ok ? out6.results[0].message : out6.error);
  await tick();
  const onDesk = await svc.moves.assignCards(admin, { locationCode: "LOC-DESK-GAVIN", cardIds: [C(6)], by: "gavin" });
  assert.ok(onDesk.ok);
  await tick();
  const fromClamp = await svc.moves.markCardsDone(admin, { cardIds: [C(6)], fromCode: "LOC-CLAMP-02", by: "gavin" });
  assert.deepEqual(fromClamp.ok ? null : fromClamp.error, "CD-6001-06 isn't in CLAMP 02 any more (now on Desk Gavin).");
  const anywhere = await svc.moves.markCardsDone(admin, { cardIds: [C(6)], by: "gavin" });
  assert.ok(anywhere.ok && anywhere.results[0].ok, anywhere.ok ? anywhere.results[0].message : anywhere.error);
  assert.equal(mock.store.table("cards").find((c) => c.id === C(6))!.completed, true);
});

test("a switched-off holder: moving out of it is refused (Move buttons greyed), Take out and Done with fromCode still work", async () => {
  const clampId = loc("LOC-CLAMP-01")!.id as string;
  const seven = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-01", cardIds: [C(7)], by: "gavin" });
  assert.ok(seven.ok, seven.ok ? "" : seven.error);
  const off = await svc.locations.updateLocation(admin, { id: clampId, active: false });
  assert.ok(off.ok);
  await tick();
  const clamp = await holder("LOC-CLAMP-01");
  assert.equal(clamp.active, false);
  assert.deepEqual(enabled({ ...ONE, active: clamp.active }), ["done", "takeout"]);
  const move = await svc.moves.moveSlot(admin, { fromCode: "LOC-CLAMP-01", toCode: "LOC-DESK", cardIds: [C(7)], by: "gavin" });
  assert.deepEqual(move.ok ? null : [move.status, move.error], [409, "CLAMP 01 is switched off. Turn it back on in Places first."]);
  const out = await svc.moves.releaseCards(admin, { cardIds: [C(7)], fromCode: "LOC-CLAMP-01", by: "gavin" });
  assert.ok(out.ok && out.results[0].ok, out.ok ? out.results[0].message : out.error);
  await tick();
  // The next card: in while it's on, then Done while it's off
  assert.ok((await svc.locations.updateLocation(admin, { id: clampId, active: true })).ok);
  const eight = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-01", cardIds: [C(8)], by: "gavin" });
  assert.ok(eight.ok, eight.ok ? "" : eight.error);
  assert.ok((await svc.locations.updateLocation(admin, { id: clampId, active: false })).ok);
  await tick();
  const done = await svc.moves.markCardsDone(admin, { cardIds: [C(8)], fromCode: "LOC-CLAMP-01", by: "gavin" });
  assert.ok(done.ok && done.results[0].ok, done.ok ? done.results[0].message : done.error);
  assert.equal((await holder("LOC-CLAMP-01")).cardCount, 0);
  const on = await svc.locations.updateLocation(admin, { id: clampId, active: true });
  assert.ok(on.ok);
});

test("Move to my desk sends no force: a desk with a limit set in Places that is full answers 409 overCapacity ('Add anyway?'), force adds it", async () => {
  const desk = loc("LOC-DESK")!;
  const limit = await svc.locations.updateLocation(admin, { id: desk.id as string, capacity: 1 });
  assert.ok(limit.ok, limit.ok ? "" : limit.error);
  const first = await svc.moves.assignCards(admin, { locationCode: "LOC-DESK", cardIds: [C(9)], by: "gavin" });
  assert.ok(first.ok, first.ok ? "" : first.error);
  const into = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-02", cardIds: [C(10)], by: "gavin" });
  assert.ok(into.ok);
  await tick();
  const full = await svc.moves.moveSlot(admin, { fromCode: "LOC-CLAMP-02", toCode: "LOC-DESK", cardIds: [C(10)], by: "gavin" });
  assert.ok(!full.ok && full.status === 409 && full.conflict, "409 with the conflict");
  if (full.ok || !full.conflict) return;
  assert.equal(addAnywayText("Desk", full.conflict), "Desk already holds Charizard 9. Add anyway?");
  assert.equal(inItNowText(full.conflict), "In it now: CD-6001-09 · holds 1 card");
  assert.equal(mock.store.table("cards").find((c) => c.id === C(10))!.location_id, loc("LOC-CLAMP-02")!.id, "not moved");
  const anyway = await svc.moves.moveSlot(admin, { fromCode: "LOC-CLAMP-02", toCode: "LOC-DESK", cardIds: [C(10)], force: true, by: "gavin" });
  assert.ok(anyway.ok, anyway.ok ? "" : anyway.error);
  assert.equal(holderOutcome("desk", [{ code: "CD-6001-10", name: "Charizard 10" }], anyway as TrackActionResponse, "CLAMP 02").outcome.title, "CD-6001-10 is on your desk.");
  await svc.locations.updateLocation(admin, { id: desk.id as string, capacity: null });
});

test("the DONE sign after 'Move to another holder': the from-holder says where the bag is (the answer has no place)", async () => {
  const into = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-02", cardIds: [C(9)], by: "gavin" });
  assert.ok(into.ok, into.ok ? "" : into.error);
  await tick();
  const res = await svc.moves.markCardsDone(admin, { cardIds: [C(9)], by: "gavin" });
  assert.ok(res.ok, res.ok ? "" : res.error);
  const answer = res as TrackActionResponse;
  assert.equal(answer.location, null);
  const save = { key: 1, res: answer, at: "LOC-CLAMP-02", action: "done" as const, cards: [{ code: "CD-6001-09", name: "Charizard 9" }] };
  const here = scanSaveResult(save, { code: "LOC-CLAMP-02", name: "CLAMP 02" });
  assert.ok(here, "shown in CLAMP 02");
  assert.match(here!.outcome.title, /^Done\. Put it back in REYES's bag: Open bags box, under R\./);
  assert.equal(here!.outcome.title, holderOutcome("done", save.cards, answer, "CLAMP 02").outcome.title, "worded as the holder's own Done");
  assert.equal(scanSaveResult(save, { code: "LOC-CLAMP-01", name: "CLAMP 01" }), null, "another holder: not shown");
  assert.equal(scanSaveResult({ key: 1, res: answer }, { code: "LOC-CLAMP-02", name: "CLAMP 02" }), null, "before the fix: a Done answer has no place, so nothing showed");
  // Cards put into a holder by the Scan page's own flow still show there
  const moved = { ...answer, location: { id: "x", code: "LOC-HEAT-PRESS-01", name: "HEAT PRESS 01", kind: "station" as const, station: "heat-press", serial: 1, stage: "Heat Press" }, message: "In HEAT PRESS 01. Step: Heat Press." };
  assert.equal(scanSaveResult({ key: 2, res: moved }, { code: "LOC-HEAT-PRESS-01", name: "HEAT PRESS 01" })?.outcome.title, "In HEAT PRESS 01. Step: Heat Press.");
});
