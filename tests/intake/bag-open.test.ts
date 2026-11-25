/**
 * The scan landing (app/admin/receiving/open/[code]: where a bag or order QR
 * opens): its pure pieces (_lib/view.ts: due dates, where a card is in plain
 * words, the big button's count and words, what a move says, which desk),
 * the bag label's QR caption, then the loader (_lib/load.ts) and a move to
 * the desk end to end against the in-memory Supabase stand-in
 * (tests/intake/harness/mock-supabase.mjs). Customer emails are caught at
 * fetch (Resend's API calls): moving to a desk sends none.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { codeTargetPath } from "@/lib/intake/codes";
import { BAG_QR_CAPTION, layoutBagLabel } from "@/lib/intake/labels/layout";
import { normalizeLabelSettings, stockPoints } from "@/lib/intake/labels/stock";
import type { LabelBag, LabelText } from "@/lib/intake/labels/types";
import type { LocationRef, TrackActionResponse } from "@/lib/intake/tracking/types";
import {
  alreadyText, buildOpenView, canMove, cardState, chooseDesk, chunkedMoveOutcome, dueText, failedMove, moveAllLabel, moveAllState,
  moveChunks, moveOutcome, MOVE_CHUNK, onDeskText, stateText, whereText, type OpenCard,
} from "@/app/admin/receiving/open/[code]/_lib/view";

// ─── Pure ───────────────────────────────────────────────────────────────

const TODAY = "2026-11-25";
const loc = (id: string, code: string, name: string, kind: LocationRef["kind"]): LocationRef =>
  ({ id, code, name, kind, station: null, serial: null, stage: null });
const DESK = loc("desk-1", "LOC-DESK", "DESK", "other");
const GAVIN = loc("desk-2", "LOC-DESK-GAVIN", "DESK GAVIN", "other");
const CLAMP = loc("clamp-7", "LOC-CLAMP-07", "CLAMP 07", "station");
const pc = (id: string, state: OpenCard["state"], location: LocationRef | null = null, bagId: string | null = "bag-1") =>
  ({ id, state, location, bagId });

test("due dates read \"Due Mon Dec 7\"; the year only when it isn't this year's; overdue until the bag is done", () => {
  assert.deepEqual(dueText("2026-12-07", TODAY), { text: "Due Mon Dec 7", overdue: false });
  assert.deepEqual(dueText("2027-01-04", TODAY), { text: "Due Mon Jan 4, 2027", overdue: false });
  assert.deepEqual(dueText("2026-11-20", TODAY), { text: "Due Fri Nov 20", overdue: true });
  assert.deepEqual(dueText("2026-11-20", TODAY, true), { text: "Due Fri Nov 20", overdue: false }, "a finished bag is never overdue");
  assert.deepEqual(dueText(TODAY, TODAY), { text: "Due Wed Nov 25", overdue: false }, "due today isn't overdue");
  assert.deepEqual(dueText(null, TODAY), { text: "No due date yet", overdue: false });
  assert.deepEqual(dueText("2026-02-30", TODAY), { text: "No due date yet", overdue: false });
});

test("a card's state: refunded, then done, then not here yet, else ready; greyed ones say so", () => {
  assert.equal(cardState({ refunded: true, done: true, received: true }), "refunded");
  assert.equal(cardState({ refunded: false, done: true, received: true }), "done");
  assert.equal(cardState({ refunded: false, done: false, received: false }), "not_here");
  assert.equal(cardState({ refunded: false, done: false, received: true }), "ready");
  assert.deepEqual(["done", "refunded", "not_here", "ready"].map((s) => stateText(s as OpenCard["state"])), ["Done", "Refunded", "Not here yet", null]);
});

test("where a card is now, in plain words, for the desk picked on this phone", () => {
  assert.equal(whereText(pc("a", "ready"), DESK.id), "In the bag");
  assert.equal(whereText(pc("a", "ready", null, null), DESK.id), "Not in a holder");
  assert.equal(whereText(pc("a", "ready", DESK), DESK.id), "On your desk");
  assert.equal(whereText(pc("a", "ready", DESK), GAVIN.id), "On DESK", "another desk is named");
  assert.equal(whereText(pc("a", "ready", GAVIN), DESK.id), "On DESK GAVIN");
  assert.equal(whereText(pc("a", "ready", CLAMP), DESK.id), "In CLAMP 07");
  assert.equal(whereText(pc("a", "ready", loc("s", "LOC-SHELF-20261207", "DUE MON DEC 7", "shelf")), DESK.id), "On the shelf");
  assert.equal(whereText(pc("a", "ready", loc("d", "LOC-DONE", "Done", "done")), DESK.id), "On the Done shelf");
  assert.equal(whereText(pc("a", "ready", loc("p", "LOC-SHIP", "Shipping", "shipping")), DESK.id), "In Shipping");
  assert.equal(whereText(pc("a", "ready", loc("b", "LOC-BENCH-2", "BENCH 2", "other")), DESK.id), "At BENCH 2");
  assert.equal(whereText(pc("a", "ready", loc("t", "LOC-DESKTOP", "DESKTOP", "other")), DESK.id), "At DESKTOP", "LOC-DESKTOP isn't a desk");
  // Done flow (Nov 25 2026): a done card belongs in its bag; one left on the old Done shelf says so (its Done puts it back)
  assert.equal(whereText(pc("a", "done", loc("d", "LOC-DONE", "Done", "done")), DESK.id), "Done · on the Done shelf");
  assert.equal(whereText(pc("a", "done", null), DESK.id), "Done");
  assert.equal(whereText(pc("a", "refunded", CLAMP), DESK.id), "Refunded");
  assert.equal(whereText(pc("a", "not_here", null, null), DESK.id), "Not here yet");
  assert.equal(whereText(pc("a", "ready", DESK), null), "On DESK", "no desk picked: it's just a desk");
});

test("the big button moves every card that's here, not done, not refunded and not on that desk yet", () => {
  const cards = [
    pc("bag", "ready"), pc("clamp", "ready", CLAMP), pc("other-desk", "ready", GAVIN), pc("mine", "ready", DESK),
    pc("done", "done"), pc("refunded", "refunded"), pc("away", "not_here", null, null),
  ];
  assert.deepEqual(moveAllState(cards, DESK.id), { kind: "move", ids: ["bag", "clamp", "other-desk"], alreadyOnDesk: 1 });
  assert.deepEqual(cards.map((c) => canMove(c, DESK.id)), [true, true, true, false, false, false, false]);
  // On DESK GAVIN instead: the card on DESK goes too, the one on GAVIN is there already
  assert.deepEqual(moveAllState(cards, GAVIN.id), { kind: "move", ids: ["bag", "clamp", "mine"], alreadyOnDesk: 1 });
  assert.equal(moveAllLabel(3), "Move all 3 cards to my desk");
  assert.equal(moveAllLabel(1), "Move 1 card to my desk");
  assert.equal(alreadyText(2), "2 already on your desk");

  assert.deepEqual(moveAllState([pc("mine", "ready", DESK), pc("done", "done")], DESK.id), { kind: "all_on_desk", onDesk: 1 });
  assert.deepEqual(moveAllState([], DESK.id), { kind: "nothing", text: "No cards yet." });
  assert.deepEqual(moveAllState([pc("r", "refunded")], DESK.id), { kind: "nothing", text: "Every card was refunded." });
  assert.deepEqual(moveAllState([pc("d", "done"), pc("r", "refunded")], DESK.id), { kind: "nothing", text: "Every card is done." });
  assert.deepEqual(moveAllState([pc("a", "not_here"), pc("b", "not_here")], DESK.id), { kind: "nothing", text: "No cards are here yet." });
  assert.deepEqual(moveAllState([pc("a", "not_here"), pc("d", "done")], DESK.id), { kind: "nothing", text: "Nothing to move: every card is done or not here yet." });
});

test("what a move says: \"N cards are on your desk\", and the server's words for each card that didn't go", () => {
  const res = (results: TrackActionResponse["results"]) => ({ results });
  const all = moveOutcome(res([
    { cardId: "a", code: "CD-1-01", name: "Charizard", ok: true, changed: true, message: "In DESK." },
    { cardId: "b", code: "CD-1-02", name: "Blastoise", ok: true, changed: false, message: "Already in DESK." },
  ]));
  assert.deepEqual([all.tone, all.title, all.failedTitle, all.failed, all.movedIds], ["ok", "2 cards are on your desk", null, [], ["a", "b"]]);
  assert.equal(onDeskText(1), "1 card is on your desk");
  const some = moveOutcome(res([
    { cardId: "a", code: "CD-1-01", name: "Charizard", ok: true, changed: true, message: "In DESK." },
    { cardId: "b", code: null, name: "Blastoise", ok: false, changed: false, message: "Blastoise was refunded. Not moved." },
  ]));
  assert.deepEqual([some.tone, some.title, some.failedTitle], ["warn", "1 card is on your desk", "1 not moved:"]);
  assert.deepEqual(some.failed.map((f) => [f.label, f.message]), [["Blastoise", "Blastoise was refunded. Not moved."]]);
  const none = moveOutcome(res([{ cardId: "b", code: "CD-1-02", name: null, ok: false, changed: false, message: "Someone moved it just now. Scan the slot again." }]));
  assert.deepEqual([none.tone, none.title, none.movedIds], ["error", "Not moved", []]);
  const failed = failedMove("DESK is switched off. Turn it back on in Places.");
  assert.deepEqual([failed.tone, failed.title, failed.failed.map((f) => f.message)], ["error", "Not moved", ["DESK is switched off. Turn it back on in Places."]]);
});

test("a big order moves in requests of at most 200 cards; the answers read as one", () => {
  assert.equal(MOVE_CHUNK, 200); // = MAX_CARDS of lib/intake/tracking/moves.ts (checked with the database tests below)
  const ids = Array.from({ length: 401 }, (_, i) => `c${i}`);
  assert.deepEqual(moveChunks(ids).map((c) => c.length), [200, 200, 1]);
  assert.deepEqual(moveChunks(ids).flat(), ids, "every card once, in order");
  assert.deepEqual(moveChunks(["a"]), [["a"]]);
  assert.deepEqual(moveChunks([]), []);

  const ok = (cardId: string) => ({ cardId, code: cardId.toUpperCase(), name: null, ok: true, changed: true, message: "In DESK." });
  const all = chunkedMoveOutcome([{ ok: true, results: [ok("a"), ok("b")] }, { ok: true, results: [ok("c")] }]);
  assert.deepEqual([all.tone, all.title, all.failedTitle, all.movedIds], ["ok", "3 cards are on your desk", null, ["a", "b", "c"]]);
  // The first request went, the second was refused as a whole: the 2 cards of it (and any after) are not moved
  const half = chunkedMoveOutcome([
    { ok: true, results: [ok("a"), { cardId: "r", code: "CD-1-09", name: null, ok: false, changed: false, message: "CD-1-09 was refunded. Not moved." }] },
    { ok: false, error: "DESK is switched off. Turn it back on in Places.", count: 2 },
  ]);
  assert.deepEqual([half.tone, half.title, half.failedTitle, half.movedIds], ["warn", "1 card is on your desk", "3 not moved:", ["a"]]);
  assert.deepEqual(half.failed.map((f) => [f.label, f.message]), [
    ["CD-1-09", "CD-1-09 was refunded. Not moved."],
    ["", "DESK is switched off. Turn it back on in Places."],
  ]);
  // One request refused as a whole reads as before
  assert.deepEqual(chunkedMoveOutcome([{ ok: false, error: "You're signed out. Sign in again, then scan again.", count: 3 }]),
    failedMove("You're signed out. Sign in again, then scan again."));
});

test("which desk: the one this phone kept while it's still switched on, else LOC-DESK", () => {
  const desks = [{ id: "desk-1", code: "LOC-DESK", name: "DESK" }, { id: "desk-2", code: "LOC-DESK-GAVIN", name: "DESK GAVIN" }];
  assert.equal(chooseDesk(desks, "", "desk-1")?.code, "LOC-DESK");
  assert.equal(chooseDesk(desks, "LOC-DESK-GAVIN", "desk-1")?.code, "LOC-DESK-GAVIN");
  assert.equal(chooseDesk(desks, "loc-desk-gavin", "desk-1")?.code, "LOC-DESK-GAVIN", "any case");
  assert.equal(chooseDesk(desks, "LOC-DESK-OLD", "desk-1")?.code, "LOC-DESK", "a desk switched off (or gone) since");
  assert.equal(chooseDesk(desks, null, null)?.code, "LOC-DESK");
  assert.equal(chooseDesk([], "LOC-DESK", null), null);
});

test("the bag label's QR says it opens the order, on the 4 x 6 and the 50 x 80 mm labels", () => {
  assert.equal(BAG_QR_CAPTION, "SCAN TO OPEN THE ORDER");
  const bag: LabelBag = {
    bagCode: "CD-2549-P", tierName: "Platinum", orderNumber: "CD-2549", customerName: "Pat Collector", receivedOn: "2026-11-16", dueDate: "2026-12-07",
    cards: [3, 4].map((seq) => ({ seq, code: `CD-2549-0${seq}`, name: "Charizard", year: "1999", set: "Base Set", number: "4/102" })),
  };
  for (const [name, stock] of [["4x6", stockPoints("4x6", 3.2)], ["50x80mm", stockPoints("50x80mm", normalizeLabelSettings("50x80mm", undefined).contentWidthIn)]] as const) {
    const words = layoutBagLabel(bag, stock).elements.filter((e): e is LabelText => e.kind === "text").map((t) => t.text).join(" ");
    assert.match(words.replace(/\s+/g, " "), /SCAN TO OPEN THE ORDER/, name);
    assert.doesNotMatch(words, /PHOTOS/, name);
  }
  assert.equal(codeTargetPath("bag", "b1", "o1", "CD-2549-P"), "/admin/receiving/open/CD-2549-P", "and the QR opens the scan landing");
});

// ─── Against the in-memory database ─────────────────────────────────────

type Row = Record<string, unknown>;
type Mock = { url: string; store: { table(name: string): Row[]; load(seed: { tables: Record<string, Row[]> }): void }; close(): Promise<void> };

let mock: Mock;
let admin: SupabaseClient;
let load: typeof import("@/app/admin/receiving/open/[code]/_lib/load");
let moves: typeof import("@/lib/intake/tracking/moves");
let locations: typeof import("@/lib/intake/tracking/locations");
const sent: { to: unknown; subject: string }[] = [];
const realFetch = globalThis.fetch;

const ORDER = "00000000-0000-4000-8000-0000000be001";
const GOLD = "00000000-0000-4000-8000-0000000beb01";
const PLAT = "00000000-0000-4000-8000-0000000beb02";
const CLAMP_ID = "00000000-0000-4000-8000-0000000bef07";
const C = (n: number) => `00000000-0000-4000-8000-0000000bec${String(n).padStart(2, "0")}`;
const card = (n: number, over: Row = {}): Row => ({
  id: C(n), order_id: ORDER, card_name: `Charizard ${n}`, card_set: "Base Set", card_year: "1999", card_number: `${n}/102`,
  variation: null, notes: null, known_defects: null, estimated_value_cents: null, photo_urls: [], catalog_image_url: null,
  tier: null, status: "active", completed: false, completed_at: null, current_round: 1, created_at: `2026-11-23T19:00:0${n % 10}.000000+00:00`,
  card_seq: n, card_code: `CD-6001-${String(n).padStart(2, "0")}`, bag_id: GOLD, received_at: "2026-11-23T19:30:00+00:00",
  received_by: "gavin", awaiting_arrival: false, receiving_photo_urls: [], location_id: null, located_at: null, refunded_cents: 0,
  service_ids: [], slab_removal_selected: false, pregrade_selected: false, ...over,
});

before(async () => {
  const harness = pathToFileURL(path.resolve("tests/intake/harness/mock-supabase.mjs")).href;
  const { startMock } = (await import(harness)) as { startMock: (o: { port: number; quiet: boolean }) => Promise<Mock> };
  mock = await startMock({ port: 0, quiet: true });
  mock.store.load({
    tables: {
      orders: [{
        id: ORDER, order_number: "CD-6001", customer_name: "Pat Collector", customer_email: "pat@example.com", customer_phone: null,
        status: "in_progress", payment_status: "paid", restoration_tier: "premium", inbound_method: "self_ship",
        customer_notes: "Please be gentle with the corners.", created_at: "2026-11-23T19:00:00+00:00", updated_at: "2026-11-23T19:00:00+00:00",
      }],
      tier_bags: [
        { id: GOLD, order_id: ORDER, tier: "premium", batch: 1, bag_code: "CD-6001-G", received_on: "2026-11-16", due_date: "2026-12-07",
          due_status: "calculated", turnaround_days: 15, source: "receiving", created_at: "2026-11-23T19:30:00+00:00" },
        { id: PLAT, order_id: ORDER, tier: "ultra_premium", batch: 1, bag_code: "CD-6001-P", received_on: "2026-11-16", due_date: "2026-11-20",
          due_status: "calculated", turnaround_days: 3, source: "receiving", created_at: "2026-11-23T19:30:00+00:00" },
      ],
      cards: [
        card(1, { notes: "Small crease top left", known_defects: "Whitening on back", estimated_value_cents: 25000, variation: "Holo",
          receiving_photo_urls: ["https://example.supabase.co/r1.jpg"] }),
        card(2, { status: "refunded" }),
        card(3, { completed: true, completed_at: "2026-11-24T19:00:00+00:00" }),
        card(4, { tier: "ultra_premium", bag_id: PLAT, location_id: CLAMP_ID, located_at: "2026-11-24T18:00:00+00:00" }),
        card(5, { bag_id: null, received_at: null, card_code: null, card_seq: 5 }),
        card(6),
      ],
      order_events: [{
        id: "00000000-0000-4000-8000-0000000bee01", order_id: ORDER, event_type: "stage_update", description: `Stage: Clamp Work [card:${C(4)}]`,
        metadata: { card_id: C(4), stage: "Clamp Work", round: 1, by: "gavin", bulk: false }, is_customer_visible: true, created_at: "2026-11-24T18:00:00+00:00",
      }],
      locations: [
        { id: "00000000-0000-4000-8000-0000000bef01", code: "LOC-DONE", name: "Done", kind: "done", sort: 900, active: true, created_at: "2026-11-24T00:00:00+00:00" },
        { id: CLAMP_ID, code: "LOC-CLAMP-07", name: "CLAMP 07", kind: "station", station: "clamp", serial: 7, capacity: 1, stage: "Clamp Work", sort: 0, active: true, created_at: "2026-11-24T00:00:00+00:00" },
      ],
      card_moves: [],
      restoration_settings: [
        { tier: "premium", display_name: "Gold", turnaround_min_days: 15, turnaround_max_days: 20 },
        { tier: "ultra_premium", display_name: "Platinum", turnaround_min_days: 3, turnaround_max_days: 5 },
      ],
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
  load = await import("@/app/admin/receiving/open/[code]/_lib/load");
  moves = await import("@/lib/intake/tracking/moves");
  locations = await import("@/lib/intake/tracking/locations");
});

after(async () => {
  globalThis.fetch = realFetch;
  await mock?.close();
});

test("only a Bag ID or an order number that exists opens the page; anything else is not found", async () => {
  for (const raw of ["CD-6001-B", "CD-9999", "CD-6001-01", "LOC-DONE", "LOC-CLAMP-07", "2549", "junk", "", "CD-6001-G%"]) {
    assert.deepEqual(await load.loadOpen(admin, raw), { ok: false, status: 404 }, raw);
  }
});

test("a bag code: the customer, the bag's tier and due date, its cards (refunded last) and where each one is", async () => {
  const got = await load.loadOpen(admin, "cd-6001-g");
  assert.ok(got.ok);
  const { header, groups } = buildOpenView(got.input, TODAY);
  assert.deepEqual(
    [header.kind, header.code, header.customer, header.orderNumber, header.cardCount, header.customerNotes],
    ["bag", "CD-6001-G", "Pat Collector", "CD-6001", 3, "Please be gentle with the corners."],
  );
  assert.deepEqual(header.bag && [header.bag.code, header.bag.tierName, header.bag.due.text, header.bag.due.overdue], ["CD-6001-G", "Gold", "Due Mon Dec 7", false]);
  assert.deepEqual(header.bags, []);
  assert.equal(header.orderUrl, `/admin/orders/${ORDER}`);
  assert.equal(header.photosUrl, `/admin/receiving/${ORDER}/photos?bag=${GOLD}`);
  assert.deepEqual(groups.map((g) => [g.title, g.cards.map((c) => c.code)]), [["Cards in this bag", ["CD-6001-01", "CD-6001-03", "CD-6001-06", "CD-6001-02"]]]);
  const [one, three, , two] = groups[0].cards;
  assert.deepEqual(
    [one.name, one.details, one.declaredValue, one.notes, one.knownDefects, one.stepLabel, one.state],
    ["Charizard 1", "1999 · Base Set · #1/102 · Holo", "$250.00", "Small crease top left", "Whitening on back", "Not started", "ready"],
  );
  assert.deepEqual(one.photos.map((g) => g.kind), ["receiving"]);
  assert.deepEqual([three.state, two.state], ["done", "refunded"]);
  assert.deepEqual(groups[0].cards.map((c) => whereText(c, null)), ["In the bag", "Done", "In the bag", "Refunded"]);
});

test("an order code: every card under its bag (fastest tier first), then the cards not here yet; the clamp card says where it is", async () => {
  const got = await load.loadOpen(admin, "CD-6001");
  assert.ok(got.ok);
  const { header, groups } = buildOpenView(got.input, TODAY);
  assert.deepEqual([header.kind, header.code, header.cardCount, header.bag], ["order", "CD-6001", 5, null]);
  assert.deepEqual(header.bags.map((b) => [b.code, b.tierName, b.due.text, b.due.overdue, b.cardCount]), [
    ["CD-6001-P", "Platinum", "Due Fri Nov 20", true, 1],
    ["CD-6001-G", "Gold", "Due Mon Dec 7", false, 3],
  ]);
  assert.equal(header.photosUrl, `/admin/receiving/${ORDER}/photos`);
  assert.deepEqual(groups.map((g) => [g.title, g.subtitle, g.overdue, g.cards.length]), [
    ["Platinum · CD-6001-P", "Due Fri Nov 20 · 1 card", true, 1],
    ["Gold · CD-6001-G", "Due Mon Dec 7 · 3 cards", false, 4],
    ["Not here yet", null, false, 1],
  ]);
  const clamp = groups[0].cards[0];
  assert.deepEqual([whereText(clamp, null), clamp.stepLabel], ["In CLAMP 07", "Clamp Work"]);
  const away = groups[2].cards[0];
  assert.deepEqual([away.code, away.state, whereText(away, null)], [null, "not_here", "Not here yet"]);
});

test("the desk: LOC-DESK is made on the first visit; \"Move all 3 cards to my desk\" moves them there, steps kept, no email", async () => {
  assert.equal(MOVE_CHUNK, moves.MAX_CARDS, "the page's requests are at most the assign route's limit");
  const first = await load.loadDeskChoice(admin, "gavin");
  assert.equal(first.problem, null);
  assert.deepEqual(first.desks.map((d) => [d.code, d.name]), [["LOC-DESK", "DESK"]]);
  assert.equal(first.defaultId, first.desks[0].id);
  const again = await load.loadDeskChoice(admin, "gavin");
  assert.deepEqual(again.desks.map((d) => d.id), [first.desks[0].id], "made once");
  const desk = first.desks[0];

  let got = await load.loadOpen(admin, "CD-6001");
  assert.ok(got.ok);
  let cards = buildOpenView(got.input, TODAY).groups.flatMap((g) => g.cards);
  const state = moveAllState(cards, desk.id);
  assert.equal(state.kind, "move");
  assert.ok(state.kind === "move");
  assert.deepEqual(state.ids.sort(), [C(1), C(4), C(6)].sort(), "the clamp card and the two in the bag; not done, refunded or not-here cards");
  assert.equal(moveAllLabel(state.ids.length), "Move all 3 cards to my desk");
  const eventsBefore = mock.store.table("order_events").length;

  // What the button sends: POST /api/admin/track/assign { locationCode, cardIds }
  const res = await moves.assignCards(admin, { locationCode: desk.code, cardIds: state.ids, by: "gavin" });
  assert.ok(res.ok, res.ok ? "" : res.error);
  const out = moveOutcome(res.ok ? res : { results: [] });
  assert.deepEqual([out.tone, out.title], ["ok", "3 cards are on your desk"]);
  assert.equal(mock.store.table("order_events").length, eventsBefore, "no step event: a desk changes the place only");
  assert.deepEqual(sent, [], "no email");
  assert.deepEqual(mock.store.table("card_moves").filter((m) => m.to_location_id === desk.id).map((m) => m.action), ["assign", "assign", "assign"]);

  got = await load.loadOpen(admin, "CD-6001");
  assert.ok(got.ok);
  cards = buildOpenView(got.input, TODAY).groups.flatMap((g) => g.cards);
  const byId = new Map(cards.map((c) => [c.id, c]));
  assert.deepEqual([C(1), C(4), C(6)].map((id) => whereText(byId.get(id)!, desk.id)), ["On your desk", "On your desk", "On your desk"]);
  assert.deepEqual([byId.get(C(4))!.stepLabel, byId.get(C(1))!.stepLabel], ["Clamp Work", "Not started"], "steps kept");
  assert.deepEqual(moveAllState(cards, desk.id), { kind: "all_on_desk", onDesk: 3 });
  assert.equal(mock.store.table("cards").find((c) => c.id === C(4))!.location_id, desk.id, "the clamp is free again");

  // A second desk: the picker shows both, LOC-DESK stays the default; seen from DESK GAVIN they're "On DESK"
  const made = await locations.createLocation(admin, { name: "Desk Gavin", kind: "other", by: "gavin" });
  assert.ok(made.ok && made.location.code === "LOC-DESK-GAVIN");
  const two = await load.loadDeskChoice(admin, "gavin");
  assert.deepEqual(two.desks.map((d) => d.code), ["LOC-DESK", "LOC-DESK-GAVIN"]);
  assert.equal(two.defaultId, desk.id);
  const gavin = chooseDesk(two.desks, "LOC-DESK-GAVIN", two.defaultId)!;
  assert.equal(whereText(byId.get(C(1))!, gavin.id), "On DESK");
  assert.deepEqual(moveAllState(cards, gavin.id), { kind: "move", ids: [C(4), C(1), C(6)], alreadyOnDesk: 0 });

  // A desk switched off isn't offered
  const off = await locations.updateLocation(admin, { id: made.ok ? made.location.id : "", active: false });
  assert.ok(off.ok);
  assert.deepEqual((await load.loadDeskChoice(admin, "gavin")).desks.map((d) => d.code), ["LOC-DESK"]);
});
