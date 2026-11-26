/**
 * Who did what (lib/team-activity.ts, the Team and Activity pages' words in
 * app/admin/team/_lib/view.ts): what each recorded row becomes, a move into
 * a holder counted once with its step, the step a change came from, New York
 * days, the per-person per-day counts, the filters, the CSV; then
 * loadActivity and loadCardActivity end to end against the in-memory
 * Supabase stand-in (tests/intake/harness/mock-supabase.mjs), including more
 * than 1,000 rows (every read is paged).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { csvText } from "@/lib/csv";
import {
  ACTIVITY_CSV_HEADER, DAILY_CSV_HEADER, IN_BAG, MAX_RANGE_DAYS, NOT_RECORDED, NOT_RECORDED_KEY, OUT, PHOTOS_LABELS_MISSING,
  activityCsvRows, activityQuery, applyFilters, buildActivity, cardsHandled, dailyCsvRows, fromToText, isMissingTable,
  loadActivity, loadCardActivity, moveKind, peopleIn, placeText, readBounds, readFilters, stepText, summarize, weekStart, withDoneBy,
  type ActivityAction, type CardRef, type EventRow, type MoveRow,
} from "@/lib/team-activity";
import {
  confirmFor, lastSignInText, personName, personOption, setupLinkText, signedOutText, turnedOffText, turnedOnText,
  workerDirectory, workerStatus, workerTitle,
} from "@/app/admin/team/_lib/view";
import type { StageHistoryEntry } from "@/lib/intake/types";

const ORDER = "00000000-0000-4000-8000-0000000a0001";
const ORDER2 = "00000000-0000-4000-8000-0000000a0002";
const BAG = "00000000-0000-4000-8000-0000000ab001";
const CLAMP = "00000000-0000-4000-8000-0000000af001";
const HEAT = "00000000-0000-4000-8000-0000000af002";
const DESK = "00000000-0000-4000-8000-0000000af003";
const C = (n: number) => `00000000-0000-4000-8000-0000000ac${String(n).padStart(3, "0")}`;

const places = new Map([[CLAMP, "CLAMP 07"], [HEAT, "HEAT PRESS 01"], [DESK, "DESK"]]);
const cards = new Map<string, CardRef>([
  [C(1), { orderId: ORDER, bagId: BAG, code: "CD-2549-01", name: "Charizard" }],
  [C(2), { orderId: ORDER, bagId: BAG, code: "CD-2549-02", name: "Blastoise" }],
]);
const orders = new Map([[ORDER, "CD-2549"]]);
const bags = new Map([[BAG, { orderId: ORDER, code: "CD-2549-P" }]]);

let n = 0;
const move = (over: Partial<MoveRow>): MoveRow => ({
  id: `m${++n}`, card_id: C(1), order_id: ORDER, bag_id: BAG, from_location_id: null, to_location_id: null,
  stage_before: null, stage_after: null, action: "assign", by: "sam", created_at: "2026-11-26T15:00:00.000000+00:00", ...over,
});
const step = (stage: string, at: string, over: Partial<EventRow> & { by?: string | null; card?: string; round?: number } = {}): EventRow => ({
  id: over.id ?? `e${++n}`,
  order_id: ORDER,
  event_type: "stage_update",
  description: `Stage: ${stage} [card:${over.card ?? C(1)}]`,
  metadata: { card_id: over.card ?? C(1), stage, round: over.round ?? 1, ...(over.by === null ? {} : { by: over.by ?? "sam" }), bulk: false },
  created_at: at,
});
const lookups = { cards, orders, places, bags };

// ─── Pure ───────────────────────────────────────────────────────────────

test("card_moves actions: put somewhere = Moved, release = Taken out, done = Done, receive = Received", () => {
  assert.equal(moveKind("assign"), "moved");
  assert.equal(moveKind("move"), "moved");
  assert.equal(moveKind("ship_check"), "moved");
  assert.equal(moveKind("release"), "taken_out");
  assert.equal(moveKind("done"), "done");
  assert.equal(moveKind("receive"), "received");
  assert.equal(moveKind("something else"), null);
});

test("a move into a holder writes its own stage event: one Moved line with the place and the step, no Step change line", () => {
  const actions = buildActivity({
    moves: [move({ from_location_id: CLAMP, to_location_id: HEAT, action: "move", stage_before: "Clamp Work", stage_after: "Heat Press", created_at: "2026-11-26T15:00:00.100000+00:00" })],
    events: [step("Heat Press", "2026-11-26T15:00:00.180000+00:00")],
    priorSteps: [],
    receipts: [],
    ...lookups,
  });
  assert.equal(actions.length, 1);
  const [a] = actions;
  assert.equal(a.kind, "moved");
  assert.equal(a.by, "sam");
  assert.equal(a.day, "2026-11-26");
  assert.deepEqual(a.place, { from: "CLAMP 07", to: "HEAT PRESS 01" });
  assert.deepEqual(a.step, { from: "Clamp Work", to: "Heat Press" });
  assert.equal(a.cardCode, "CD-2549-01");
  assert.equal(a.cardName, "Charizard");
  assert.equal(a.orderNumber, "CD-2549");
  assert.equal(a.bagCode, "CD-2549-P");
  assert.equal(fromToText(a), "CLAMP 07 → HEAT PRESS 01 · Step Clamp Work → Heat Press");
});

test("the stage event stays its own line when someone else, another step or much later wrote it", () => {
  const m = move({ from_location_id: null, to_location_id: CLAMP, stage_before: null, stage_after: "Clamp Work", created_at: "2026-11-26T15:00:00.000000+00:00" });
  const actions = buildActivity({
    moves: [m],
    events: [
      step("Clamp Work", "2026-11-26T15:00:00.050000+00:00", { by: "gavin" }), // someone else
      step("Heat Press", "2026-11-26T15:00:00.060000+00:00"),                  // another step
      step("Clamp Work", "2026-11-26T15:05:00.000000+00:00"),                  // five minutes later
    ],
    priorSteps: [],
    receipts: [],
    ...lookups,
  });
  assert.deepEqual(actions.map((a) => a.kind).sort(), ["moved", "step", "step", "step"]);
  const moved = actions.find((a) => a.kind === "moved")!;
  assert.deepEqual(moved.place, { from: IN_BAG, to: "CLAMP 07" }, "out of its bag");
  assert.deepEqual(moved.step, { from: "Not started", to: "Clamp Work" });
});

test("a step change says where it came from: the card's previous step this round (read before the range too)", () => {
  const before = step("Humidor", "2026-11-20T15:00:00+00:00", { id: "old" });
  const actions = buildActivity({
    moves: [],
    events: [
      step("Book", "2026-11-26T14:00:00+00:00", { id: "a" }),
      step("Heat Press", "2026-11-26T15:00:00+00:00", { id: "b" }),
      step("Ready for Slab Crack", "2026-11-26T16:00:00+00:00", { id: "c", round: 2 }),
      step("Humidor", "2026-11-26T16:30:00+00:00", { id: "d", card: C(2) }),
    ],
    priorSteps: [before],
    receipts: [],
    ...lookups,
  });
  const by = new Map(actions.map((a) => [a.id, a]));
  assert.deepEqual(by.get("event:a")!.step, { from: "Humidor", to: "Drying" }, "Book reads Drying");
  assert.deepEqual(by.get("event:b")!.step, { from: "Drying", to: "Heat Press" });
  assert.deepEqual(by.get("event:c")!.step, { from: "Not started", to: "Ready for Slab Crack (round 2)" }, "a new round starts from nothing");
  assert.deepEqual(by.get("event:d")!.step, { from: "Not started", to: "Humidor" }, "no earlier step at all");
  assert.equal(by.has("event:old"), false, "before the range: only used for where it came from");
  assert.equal(stepText(by.get("event:b")!), "Drying → Heat Press");

  // Without the earlier events the first step's origin isn't known
  const blind = buildActivity({ moves: [], events: [step("Book", "2026-11-26T14:00:00+00:00", { id: "x" })], receipts: [], ...lookups });
  assert.deepEqual(blind[0].step, { from: null, to: "Drying" });
  assert.equal(stepText(blind[0]), "→ Drying");
});

test("Take out, Done from a holder, Done in its bag, a desk move", () => {
  const actions = buildActivity({
    moves: [
      move({ id: "out", action: "release", from_location_id: CLAMP, to_location_id: null, stage_before: "Clamp Work", stage_after: "Clamp Work" }),
      move({ id: "done1", action: "done", from_location_id: HEAT, to_location_id: null, stage_before: "Heat Press", stage_after: "done" }),
      move({ id: "done2", action: "done", from_location_id: null, to_location_id: null, stage_before: "Final Dry", stage_after: "done" }),
      move({ id: "desk", action: "move", from_location_id: CLAMP, to_location_id: DESK, stage_before: "Clamp Work", stage_after: "Clamp Work" }),
    ],
    events: [],
    receipts: [],
    ...lookups,
  });
  const by = new Map(actions.map((a) => [a.id, a]));
  assert.equal(by.get("move:out")!.kind, "taken_out");
  assert.deepEqual(by.get("move:out")!.place, { from: "CLAMP 07", to: OUT });
  assert.equal(by.get("move:out")!.step, null, "the step stays");
  assert.deepEqual(by.get("move:done1")!.place, { from: "HEAT PRESS 01", to: IN_BAG });
  assert.deepEqual(by.get("move:done1")!.step, { from: "Heat Press", to: "Done" });
  assert.equal(by.get("move:done2")!.place, null, "done while in its bag: no place change");
  assert.equal(placeText(by.get("move:desk")!), "CLAMP 07 → DESK");
  assert.equal(by.get("move:desk")!.step, null);
});

test("receiving: cards.received_by, counted once when a 'receive' move records the same receipt", () => {
  const receipt = (id: string, at: string, by: string | null) => ({ id, order_id: ORDER, bag_id: BAG, card_code: "CD-2549-0x", card_name: "Card", received_at: at, received_by: by });
  const actions = buildActivity({
    moves: [move({ id: "rcv", card_id: C(1), action: "receive", created_at: "2026-11-26T15:00:05+00:00", to_location_id: null })],
    events: [],
    receipts: [
      receipt(C(1), "2026-11-26T15:00:00+00:00", "sam"),   // same receipt as the move
      receipt(C(2), "2026-11-26T15:00:00+00:00", "sam"),
      receipt(C(3), "2026-11-26T15:00:00+00:00", null),
    ],
    ...lookups,
  });
  const received = actions.filter((a) => a.kind === "received");
  assert.equal(received.length, 3);
  assert.deepEqual(received.map((a) => a.id).sort(), ["card:" + C(2), "card:" + C(3), "move:rcv"].sort());
  const c2 = received.find((a) => a.id === `card:${C(2)}`)!;
  assert.deepEqual(c2.place, { from: null, to: "Bag CD-2549-P" });
  assert.equal(placeText(c2), "→ Bag CD-2549-P");
  assert.equal(received.find((a) => a.id === `card:${C(3)}`)!.by, null, "no name saved");
});

test("photos, label prints, due dates, receiving undone, cards added, new rounds; old stage lines without a name", () => {
  const actions = buildActivity({
    moves: [],
    events: [
      { id: "u", order_id: ORDER, event_type: "card_unreceived", description: "Receiving undone", metadata: { card_id: C(2), by: "sam" }, created_at: "2026-11-26T16:00:00+00:00" },
      { id: "a", order_id: ORDER, event_type: "card_added_at_receiving", description: "Card added", metadata: { card_id: C(2), by: "gavin" }, created_at: "2026-11-26T16:01:00+00:00" },
      { id: "r", order_id: ORDER, event_type: "round_started", description: "Round 2 started", metadata: { card_id: C(1), round: 2 }, created_at: "2026-11-26T16:02:00+00:00" },
      // The old site's stage line: no metadata, the description only
      { id: "legacy", order_id: ORDER, event_type: "stage_update", description: `Stage: Humidor [card:${C(2)}]`, metadata: null, created_at: "2026-11-26T16:03:00+00:00" },
      { id: "status", order_id: ORDER, event_type: "status_updated", description: "x", metadata: { by: "gavin" }, created_at: "2026-11-26T16:04:00+00:00" },
    ],
    priorSteps: [],
    receipts: [],
    photoEvents: [
      { id: "p1", card_id: C(1), order_id: ORDER, action: "add", by: "sam", created_at: "2026-11-26T17:00:00+00:00" },
      { id: "p2", card_id: C(1), order_id: ORDER, action: "remove", by: "sam", created_at: "2026-11-26T17:01:00+00:00" },
    ],
    labelPrints: [{ id: BAG, order_id: ORDER, bag_code: "CD-2549-P", label_printed_at: "2026-11-26T17:02:00+00:00", label_printed_by: "sam" }],
    dueChanges: [{ id: "d", bag_id: BAG, old_due: "2026-12-07", new_due: "2026-12-11", reason: "Holiday week", changed_by: "gavin", created_at: "2026-11-26T17:03:00+00:00" }],
    ...lookups,
  });
  const by = new Map(actions.map((a) => [a.id, a]));
  assert.equal(by.has("event:status"), false, "status changes aren't card work");
  assert.equal(by.get("event:u")!.kind, "unreceived");
  assert.equal(by.get("event:a")!.kind, "card_added");
  assert.equal(by.get("event:r")!.kind, "new_round");
  assert.equal(by.get("event:r")!.detail, "Round 2");
  assert.equal(by.get("event:r")!.by, null, "round_started carries no name yet");
  assert.equal(by.get("event:legacy")!.kind, "step");
  assert.equal(by.get("event:legacy")!.by, null);
  assert.equal(by.get("event:legacy")!.cardCode, "CD-2549-02");
  assert.equal(by.get("photo:p1")!.detail, "Added a photo");
  assert.equal(by.get("photo:p2")!.detail, "Removed a photo");
  assert.equal(by.get(`label:${BAG}`)!.kind, "label_printed");
  assert.equal(by.get(`label:${BAG}`)!.bagCode, "CD-2549-P");
  assert.equal(by.get(`label:${BAG}`)!.cardId, null);
  assert.equal(by.get("due:d")!.detail, "Mon, Dec 7, 2026 → Fri, Dec 11, 2026 · Holiday week");
  assert.equal(by.get("due:d")!.orderNumber, "CD-2549");
  // Newest first
  assert.deepEqual(actions.map((a) => a.at), [...actions.map((a) => a.at)].sort().reverse());
});

test("New York days: 03:30 UTC on Nov 27 is still Nov 26; the range keeps only its days", () => {
  const rows = [
    move({ id: "late", created_at: "2026-11-27T03:30:00+00:00", to_location_id: CLAMP }),   // 10:30 PM Nov 26 in New York
    move({ id: "early", created_at: "2026-11-27T05:30:00+00:00", to_location_id: CLAMP }),  // 12:30 AM Nov 27
    move({ id: "before", created_at: "2026-11-26T04:30:00+00:00", to_location_id: CLAMP }), // 11:30 PM Nov 25
  ];
  const all = buildActivity({ moves: rows, events: [], receipts: [], ...lookups });
  assert.deepEqual(Object.fromEntries(all.map((a) => [a.id, a.day])), { "move:late": "2026-11-26", "move:early": "2026-11-27", "move:before": "2026-11-25" });
  const day = buildActivity({ moves: rows, events: [], receipts: [], ...lookups }, { from: "2026-11-26", to: "2026-11-26" });
  assert.deepEqual(day.map((a) => a.id), ["move:late"]);
  // The reads cover the New York days whatever the clock change
  assert.deepEqual(readBounds({ from: "2026-11-26", to: "2026-11-26" }), { lo: "2026-11-26T04:00:00.000Z", hi: "2026-11-27T05:00:00.000Z" });
});

function act(over: Partial<ActivityAction>): ActivityAction {
  return {
    id: `x${++n}`, at: "2026-11-26T15:00:00+00:00", day: "2026-11-26", by: "sam", kind: "moved", cardId: C(1), cardCode: "CD-2549-01",
    cardName: "Charizard", bagId: BAG, bagCode: "CD-2549-P", orderId: ORDER, orderNumber: "CD-2549", place: null, step: null, detail: null, ...over,
  };
}

test("per person per day: received, moved, done, taken out, step changes, other, different cards; Not recorded last", () => {
  const actions = [
    act({ kind: "received", cardId: C(1) }),
    act({ kind: "received", cardId: C(2) }),
    act({ kind: "moved", cardId: C(1) }),
    act({ kind: "moved", cardId: C(1) }),
    act({ kind: "done", cardId: C(1) }),
    act({ kind: "photo", cardId: C(2) }),
    act({ kind: "label_printed", cardId: null }),
    act({ by: "gavin", kind: "step", cardId: C(3) }),
    act({ by: null, kind: "step", cardId: C(4) }),
    act({ by: null, kind: "step", cardId: C(4) }),
    act({ by: null, kind: "step", cardId: C(4) }),
    act({ day: "2026-11-25", at: "2026-11-25T15:00:00+00:00", kind: "taken_out", cardId: C(5) }),
  ];
  const s = summarize(actions);
  assert.deepEqual(s.days.map((d) => d.day), ["2026-11-26", "2026-11-25"], "newest day first");
  const today = s.days[0];
  assert.deepEqual(today.people.map((p) => p.by), ["sam", "gavin", null], "more actions first, Not recorded last");
  assert.deepEqual(today.people[0].counts, { received: 2, moved: 2, done: 1, taken_out: 0, step: 0, other: 2, total: 7, cards: 2 });
  assert.deepEqual(today.people[2].counts, { received: 0, moved: 0, done: 0, taken_out: 0, step: 3, other: 0, total: 3, cards: 1 });
  assert.equal(s.days[1].people[0].counts.taken_out, 1);
  const sam = s.people.find((p) => p.by === "sam")!;
  assert.equal(sam.days, 2);
  assert.equal(sam.counts.cards, 3);
  assert.equal(s.counts.total, actions.length);
  assert.deepEqual([...cardsHandled(actions)], [["sam", 3], ["gavin", 1], [NOT_RECORDED_KEY, 1]]);
  assert.deepEqual(peopleIn(actions), [{ key: "sam", label: "sam" }, { key: "gavin", label: "gavin" }, { key: NOT_RECORDED_KEY, label: NOT_RECORDED }]);
});

test("filters: the last 7 days by default, never past today, at most 92 days, person and action", () => {
  const today = "2026-11-26";
  assert.deepEqual(readFilters({}, today), { from: "2026-11-20", to: today, person: null, action: null, note: null });
  assert.deepEqual(readFilters({ from: "2026-11-24", to: "2026-11-22" }, today), { from: "2026-11-22", to: "2026-11-24", person: null, action: null, note: null }, "swapped");
  assert.equal(readFilters({ to: "2026-12-30" }, today).to, today, "never past today");
  assert.equal(readFilters({ from: "2026-12-30" }, today).from, today);
  assert.equal(readFilters({ from: "2026-02-30" }, today).from, "2026-11-20", "not a real day");
  const long = readFilters({ from: "2026-01-01", to: today }, today);
  assert.equal(long.from, "2026-08-27");
  assert.equal(long.note, `Showing ${MAX_RANGE_DAYS} days at most: Thu, Aug 27, 2026 to Thu, Nov 26, 2026.`);
  const f = readFilters({ person: "  sam ", action: "taken_out", from: "2026-11-26", to: "2026-11-26" }, today);
  assert.equal(f.person, "sam");
  assert.equal(f.action, "taken_out");
  assert.equal(readFilters({ action: "delete_everything" }, today).action, null);
  assert.equal(readFilters({ person: ["sam", "gavin"] }, today).person, "sam");

  const actions = [act({ by: "sam", kind: "moved" }), act({ by: "sam", kind: "done" }), act({ by: "gavin", kind: "moved" }), act({ by: null, kind: "step" })];
  assert.equal(applyFilters(actions, { person: "sam", action: null }).length, 2);
  assert.equal(applyFilters(actions, { person: "sam", action: "done" }).length, 1);
  assert.equal(applyFilters(actions, { person: NOT_RECORDED_KEY, action: null }).length, 1);
  assert.equal(applyFilters(actions, { person: null, action: "moved" }).length, 2);

  assert.equal(activityQuery({ from: "2026-11-20", to: today, person: null, action: null }), "?from=2026-11-20&to=2026-11-26");
  assert.equal(activityQuery({ from: today, to: today, person: NOT_RECORDED_KEY, action: "step" }, { page: 2, format: null }), "?from=2026-11-26&to=2026-11-26&person=%7Enone&action=step&page=2");
});

test("this week starts on Monday (New York days)", () => {
  assert.equal(weekStart("2026-11-26"), "2026-11-23", "Thursday");
  assert.equal(weekStart("2026-11-23"), "2026-11-23", "Monday");
  assert.equal(weekStart("2026-11-29"), "2026-11-23", "Sunday");
  assert.equal(weekStart("2026-12-01"), "2026-11-30");
});

test("CSV: one row per action (formula-looking text kept as text), and the daily counts", () => {
  const actions = [
    act({ at: "2026-11-26T20:12:00+00:00", by: "=sam", kind: "moved", place: { from: "CLAMP 07", to: "HEAT PRESS 01" }, step: { from: "Clamp Work", to: "Heat Press" } }),
    act({ by: null, kind: "due_date", cardId: null, cardCode: null, cardName: null, detail: "Mon, Dec 7, 2026 → Fri, Dec 11, 2026" }),
  ];
  const rows = activityCsvRows(actions);
  assert.deepEqual(rows[0], ACTIVITY_CSV_HEADER);
  assert.deepEqual(rows[1], ["2026-11-26", "3:12 PM", "=sam", "Moved", "CD-2549-01", "Charizard", "CD-2549-P", "#CD-2549", "CLAMP 07", "HEAT PRESS 01", "Clamp Work", "Heat Press", ""]);
  assert.equal(rows[2][2], NOT_RECORDED);
  assert.equal(rows[2][3], "Due date changed");
  const text = csvText(rows);
  assert.ok(text.includes(",'=sam,"), "a name starting with = is text in a spreadsheet");
  const daily = dailyCsvRows(summarize(actions).days);
  assert.deepEqual(daily[0], DAILY_CSV_HEADER);
  assert.deepEqual(DAILY_CSV_HEADER, ["Date", "Person", "Received", "Moved", "Done", "Taken out", "Step changes", "Other", "Cards"]);
  assert.deepEqual(daily.slice(1), [["2026-11-26", "=sam", 0, 1, 0, 0, 0, 0, 1], ["2026-11-26", NOT_RECORDED, 0, 0, 0, 0, 0, 1, 0]]);
});

test("a missing table or column (20261126 not applied) is told apart from other errors", () => {
  assert.equal(isMissingTable('relation "public.card_photo_events" does not exist'), true);
  assert.equal(isMissingTable("Could not find the table 'public.card_photo_events' in the schema cache"), true);
  assert.equal(isMissingTable("column tier_bags.label_printed_by does not exist"), true);
  assert.equal(isMissingTable("canceling statement due to statement timeout"), false);
});

test("the Team page's words: names, states, the setup link, the questions and answers", () => {
  const dir = workerDirectory([{ username: "sam", name: "Sam Lee", active: true }, { username: "jo", name: null, active: false }]);
  assert.deepEqual(personName("sam", dir), { title: "Sam Lee", username: "sam", worker: true });
  assert.deepEqual(personName("jo", dir), { title: "jo", username: null, worker: true });
  assert.deepEqual(personName("gavin", dir), { title: "gavin", username: null, worker: false });
  assert.deepEqual(personName(null, dir), { title: "Not recorded", username: null, worker: false });
  assert.equal(personOption("sam", dir), "Sam Lee (sam)");
  assert.equal(personOption("gavin", dir), "gavin");
  assert.equal(workerTitle({ name: " ", username: "jo" }), "jo");

  const w = { active: true, hasPassword: true, setupPending: false };
  assert.deepEqual(workerStatus(w), { label: "Active", tone: "green" });
  assert.deepEqual(workerStatus({ ...w, active: false }), { label: "Turned off", tone: "gray" });
  assert.deepEqual(workerStatus({ ...w, hasPassword: false, setupPending: true }), { label: "Waiting for setup", tone: "amber" });
  assert.deepEqual(workerStatus({ ...w, hasPassword: false }), { label: "Setup link expired", tone: "red" });

  assert.equal(setupLinkText("Sam Lee"), "Send this link to Sam Lee. It works once, for 7 days.");
  assert.equal(lastSignInText(null), "Never signed in");
  assert.equal(lastSignInText("2026-11-26T21:12:00Z", new Date("2026-11-27T00:00:00Z")), "Last sign-in Nov 26, 4:12 PM");
  assert.equal(lastSignInText("2025-11-26T21:12:00Z", new Date("2026-11-27T00:00:00Z")), "Last sign-in Nov 26, 2025, 4:12 PM");
  assert.equal(signedOutText(0), "They weren't signed in anywhere.");
  assert.equal(signedOutText(2), "Signed out on 2 devices.");
  assert.equal(turnedOffText(1), "Turned off. Signed out on 1 device. They can't sign in until you turn them back on.");
  assert.equal(turnedOffText(0), "Turned off. They can't sign in until you turn them back on.");
  assert.equal(turnedOnText({ hasPassword: false }), "Turned on. They still need a password: make a new setup link.");
  const sam = { name: "Sam Lee", username: "sam", hasPassword: true };
  assert.deepEqual(confirmFor("off", sam), { question: "Turn off Sam Lee? They're signed out now and can't sign in until you turn them back on.", yes: "Yes, turn off" });
  assert.equal(confirmFor("reset", sam).question, "Make a new setup link for Sam Lee? Their password stops working now and they're signed out everywhere until they choose a new one.");
  assert.equal(confirmFor("reset", { ...sam, hasPassword: false }).question, "Make a new setup link for Sam Lee? Any earlier link stops working.");
  assert.equal(confirmFor("signout", sam).yes, "Yes, sign out everywhere");
});

test("the card page's Done line takes the name of the Done move saved with it", () => {
  const history: StageHistoryEntry[] = [
    { kind: "received", at: "2026-11-24T15:00:00+00:00", by: "sam", round: 1, stage: null, label: "Received", bulk: false },
    { kind: "completed", at: "2026-11-26T15:00:00+00:00", by: null, round: 1, stage: null, label: "Done", bulk: false },
  ];
  const filled = withDoneBy(history, [act({ kind: "done", by: "jo", at: "2026-11-26T15:00:01+00:00" })]);
  assert.equal(filled[1].by, "jo");
  assert.equal(filled[0].by, "sam");
  assert.equal(withDoneBy(history, [act({ kind: "done", by: "jo", at: "2026-11-26T16:00:00+00:00" })])[1].by, null, "an hour apart: another Done");
});

// ─── End to end (in-memory Supabase) ────────────────────────────────────

type Mock = { url: string; close: () => Promise<void>; store: { load: (s: unknown) => void } };
let mock: Mock | undefined;
let admin: SupabaseClient;

before(async () => {
  const harness = pathToFileURL(path.resolve("tests/intake/harness/mock-supabase.mjs")).href;
  const { startMock } = (await import(harness)) as { startMock: (o: { port: number; quiet: boolean }) => Promise<Mock> };
  mock = await startMock({ port: 0, quiet: true });
  const card = (k: number, order = ORDER, over: Record<string, unknown> = {}) => ({
    id: C(k), order_id: order, card_name: `Card ${k}`, card_code: `CD-2549-${String(k).padStart(2, "0")}`, card_seq: k, bag_id: order === ORDER ? BAG : null,
    status: "active", completed: false, current_round: 1, created_at: "2026-11-20T15:00:00+00:00", received_at: null, received_by: null,
    awaiting_arrival: false, receiving_photo_urls: [], photo_urls: [], refunded_cents: 0, slab_removal_selected: false, pregrade_selected: false, ...over,
  });
  // 1,205 moves on Nov 25 (more than one page of 1,000), by sam, CLAMP 07 <-> DESK
  const many = Array.from({ length: 1205 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, card_id: C(1 + (i % 3)), order_id: ORDER, bag_id: BAG,
    from_location_id: i % 2 ? CLAMP : DESK, to_location_id: i % 2 ? DESK : CLAMP, stage_before: "Clamp Work", stage_after: "Clamp Work",
    action: "move", by: "sam", session_id: null, created_at: `2026-11-25T16:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000000+00:00`,
  }));
  mock.store.load({
    tables: {
      orders: [
        { id: ORDER, order_number: "CD-2549", customer_name: "Pat Collector", status: "in_progress", payment_status: "paid", created_at: "2026-11-20T15:00:00+00:00" },
        { id: ORDER2, order_number: "CD-2600", customer_name: "Jo Reyes", status: "received", payment_status: "paid", created_at: "2026-11-20T15:00:00+00:00" },
      ],
      tier_bags: [{
        id: BAG, order_id: ORDER, tier: "ultra_premium", batch: 1, bag_code: "CD-2549-P", received_on: "2026-11-24", due_date: "2026-12-07",
        due_status: "calculated", source: "receiving", created_at: "2026-11-24T15:00:00+00:00",
        label_printed_at: "2026-11-24T15:10:00+00:00", label_printed_by: "sam",
      }],
      cards: [
        card(1, ORDER, { received_at: "2026-11-24T15:00:00+00:00", received_by: "sam" }),
        card(2, ORDER, { received_at: "2026-11-24T15:00:00+00:00", received_by: "sam" }),
        card(3, ORDER, { received_at: "2026-11-24T15:00:00+00:00", received_by: "gavin" }),
        card(4, ORDER2, { received_at: "2026-10-01T15:00:00+00:00", received_by: "gavin" }), // long before
      ],
      locations: [
        { id: CLAMP, code: "LOC-CLAMP-07", name: "CLAMP 07", kind: "station", station: "clamp", serial: 7, stage: "Clamp Work", capacity: 1, sort: 0, active: true, created_at: "2026-11-24T00:00:00+00:00" },
        { id: HEAT, code: "LOC-HEAT-PRESS-01", name: "HEAT PRESS 01", kind: "station", station: "heat-press", serial: 1, stage: "Heat Press", capacity: 1, sort: 0, active: true, created_at: "2026-11-24T00:00:00+00:00" },
        { id: DESK, code: "LOC-DESK", name: "DESK", kind: "other", sort: 0, active: true, created_at: "2026-11-24T00:00:00+00:00" },
      ],
      card_moves: [
        ...many,
        { id: "00000000-0000-4000-8000-0000000d0001", card_id: C(1), order_id: ORDER, bag_id: BAG, from_location_id: CLAMP, to_location_id: HEAT, stage_before: "Clamp Work", stage_after: "Heat Press", action: "move", by: "sam", session_id: null, created_at: "2026-11-26T15:00:00.100000+00:00" },
        { id: "00000000-0000-4000-8000-0000000d0002", card_id: C(1), order_id: ORDER, bag_id: BAG, from_location_id: HEAT, to_location_id: null, stage_before: "Heat Press", stage_after: "done", action: "done", by: "jo", session_id: null, created_at: "2026-11-26T18:00:00+00:00" },
      ],
      order_events: [
        { id: "00000000-0000-4000-8000-0000000e0001", order_id: ORDER, event_type: "stage_update", description: `Stage: Humidor [card:${C(2)}]`, metadata: { card_id: C(2), stage: "Humidor", round: 1, by: "gavin" }, created_at: "2026-11-10T15:00:00+00:00", is_customer_visible: true },
        { id: "00000000-0000-4000-8000-0000000e0002", order_id: ORDER, event_type: "stage_update", description: `Stage: Heat Press [card:${C(1)}]`, metadata: { card_id: C(1), stage: "Heat Press", round: 1, by: "sam" }, created_at: "2026-11-26T15:00:00.200000+00:00", is_customer_visible: true },
        { id: "00000000-0000-4000-8000-0000000e0003", order_id: ORDER, event_type: "stage_update", description: `Stage: Book [card:${C(2)}]`, metadata: { card_id: C(2), stage: "Book", round: 1, by: "gavin" }, created_at: "2026-11-26T16:00:00+00:00", is_customer_visible: false },
        { id: "00000000-0000-4000-8000-0000000e0004", order_id: ORDER, event_type: "status_updated", description: "Status updated to: In Progress", metadata: null, created_at: "2026-11-26T16:00:00+00:00", is_customer_visible: true },
      ],
      card_photo_events: [
        { id: "00000000-0000-4000-8000-0000000f0001", card_id: C(2), order_id: ORDER, action: "add", photo_url: "https://x/1.jpg", old_photo_url: null, by: "sam", created_at: "2026-11-24T15:05:00+00:00" },
      ],
      tier_bag_due_changes: [],
    },
  });
  admin = createClient(mock.url, "service-role-test-key", { auth: { persistSession: false } });
});

after(async () => {
  await mock?.close();
});

test("loadActivity: every source, paged past 1,000 rows, names, places, steps and New York days", async () => {
  const r = await loadActivity(admin, { from: "2026-11-24", to: "2026-11-26" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.deepEqual(r.notes, []);
  const moves = r.actions.filter((a) => a.kind === "moved");
  assert.equal(moves.length, 1205 + 1, "all 1,205 moves of Nov 25 (two pages) and the heat press move");
  const heat = moves.find((a) => a.place?.to === "HEAT PRESS 01")!;
  assert.deepEqual(heat.step, { from: "Clamp Work", to: "Heat Press" });
  assert.equal(r.actions.filter((a) => a.kind === "step").length, 1, "the heat press move's own stage event isn't a second line");
  const book = r.actions.find((a) => a.kind === "step")!;
  assert.deepEqual(book.step, { from: "Humidor", to: "Drying" }, "came from the step set on Nov 10 (read before the range)");
  assert.equal(book.by, "gavin");
  assert.equal(book.cardCode, "CD-2549-02");
  const done = r.actions.find((a) => a.kind === "done")!;
  assert.equal(done.by, "jo");
  assert.deepEqual(done.place, { from: "HEAT PRESS 01", to: IN_BAG });
  assert.equal(r.actions.filter((a) => a.kind === "received").length, 3, "Oct 1's receipt is outside the days");
  assert.equal(r.actions.filter((a) => a.kind === "photo").length, 1);
  const label = r.actions.find((a) => a.kind === "label_printed")!;
  assert.equal(label.by, "sam");
  assert.equal(label.orderNumber, "CD-2549");

  const s = summarize(r.actions);
  const nov25 = s.days.find((d) => d.day === "2026-11-25")!;
  assert.deepEqual(nov25.people.map((p) => [p.by, p.counts.moved, p.counts.cards]), [["sam", 1205, 3]]);
  const nov24 = s.days.find((d) => d.day === "2026-11-24")!;
  assert.deepEqual(nov24.people.map((p) => [p.by, p.counts.received, p.counts.other]), [["sam", 2, 2], ["gavin", 1, 0]]);
  assert.equal(cardsHandled(r.actions).get("jo"), 1);
});

test("loadActivity: one day, and bad days refused", async () => {
  const r = await loadActivity(admin, { from: "2026-11-26", to: "2026-11-26" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.actions.map((a) => a.kind).sort(), ["done", "moved", "step"]);
  const bad = await loadActivity(admin, { from: "yesterday", to: "2026-11-26" });
  assert.deepEqual(bad, { ok: false, status: 400, error: "Pick a start and an end day." });
});

test("loadCardActivity: one card's moves, steps, receipt and photos, newest first", async () => {
  const one = await loadCardActivity(admin, C(2));
  assert.ok(one.ok);
  if (!one.ok) return;
  const kinds = one.actions.map((a) => a.kind);
  assert.ok(kinds.includes("received") && kinds.includes("photo") && kinds.includes("step"));
  assert.ok(one.actions.every((a) => !a.cardId || a.cardId === C(2)), "only this card");
  const steps = one.actions.filter((a) => a.kind === "step");
  assert.deepEqual(steps.map((a) => a.step), [{ from: "Humidor", to: "Drying" }, { from: "Not started", to: "Humidor" }]);
  assert.equal(one.actions[0].at >= one.actions[one.actions.length - 1].at, true);
  const none = await loadCardActivity(admin, "00000000-0000-4000-8000-00000000ffff");
  assert.deepEqual(none, { ok: true, actions: [], notes: [] });
});

test("before 20261126 is applied: photos and label prints are left out with a note", async () => {
  // The stand-in answers like PostgREST for a column the database doesn't have yet
  const failing = new Proxy(admin, {
    get(target, prop, recv) {
      if (prop !== "from") return Reflect.get(target, prop, recv);
      return (table: string) => {
        const real = target.from(table);
        if (table !== "card_photo_events" && table !== "tier_bags") return real;
        return new Proxy(real, {
          get(t, p, r) {
            if (p !== "select") return Reflect.get(t, p, r);
            return (cols: string) => {
              if (table === "tier_bags" && !cols.includes("label_printed_by")) return t.select(cols);
              const message = table === "tier_bags" ? "column tier_bags.label_printed_by does not exist" : 'relation "public.card_photo_events" does not exist';
              const fail = { data: null, error: { message } };
              const chain: Record<string, unknown> = {};
              for (const m of ["gte", "lt", "eq", "order", "in"]) chain[m] = () => chain;
              chain.range = () => Promise.resolve(fail);
              return chain;
            };
          },
        });
      };
    },
  }) as SupabaseClient;
  const r = await loadActivity(failing, { from: "2026-11-24", to: "2026-11-26" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.deepEqual(r.notes, [PHOTOS_LABELS_MISSING]);
  assert.equal(r.actions.some((a) => a.kind === "photo" || a.kind === "label_printed"), false);
  assert.ok(r.actions.some((a) => a.kind === "moved"), "the rest is there");
});
