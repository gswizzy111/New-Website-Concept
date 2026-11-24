/**
 * Slot tracking without a database (lib/intake/tracking): place codes, slot
 * and shelf names, the planner's rules (forward-only steps, done, take out,
 * idempotency, refused cards), capacity and ship-check statuses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { codeKind, codeTargetPath, normalizeCode, qrUrl, scanPathForLocation } from "@/lib/intake/codes";
import { overCapacity, planCards, type PlanCard, type PlanLocation } from "@/lib/intake/tracking/move-plan";
import {
  compareLocations, hasRoom, locationCodeCandidates, locationSlug, moveStageLabel, shelfSlotCode, shelfSlotName, shelfSlotSort,
} from "@/lib/intake/tracking/places";
import { STATION_TYPES, slotCode, slotName, stationType } from "@/lib/intake/tracking/stations";
import { shipCheckStatus } from "@/lib/intake/tracking/summaries";
import { STAGES } from "@/lib/restoration-stages";

const CLAMP: PlanLocation = { id: "loc-clamp-07", code: "LOC-CLAMP-07", name: "CLAMP 07", kind: "station", stage: "Clamp Work" };
const HEAT: PlanLocation = { id: "loc-heat-03", code: "LOC-HEAT-PRESS-03", name: "HEAT PRESS 03", kind: "station", stage: "Heat Press" };
const DONE: PlanLocation = { id: "loc-done", code: "LOC-DONE", name: "Done", kind: "done", stage: null };
const SHELF: PlanLocation = { id: "loc-shelf", code: "LOC-SHELF-20261207", name: "DUE MON DEC 7", kind: "shelf", stage: null };

const card = (id: string, over: Partial<PlanCard> = {}): PlanCard => ({
  id, code: `CD-2549-${id.slice(-2)}`, name: `Card ${id}`, orderId: "order-1", bagId: "bag-1", locationId: null,
  refunded: false, received: true, completed: false, current: null, round: 1, ...over,
});

test("place codes: LOC- codes are their own kind, checked before order/card shapes", () => {
  for (const c of ["LOC-CLAMP-07", "LOC-HEAT-PRESS-03", "LOC-SHELF-20261207", "LOC-DONE", "LOC-SHIP", "LOC-2026-12", "LOC-123"]) {
    assert.equal(codeKind(c), "location", c);
  }
  assert.equal(normalizeCode("https://thecarddoc1.com/q/loc-clamp-07"), "LOC-CLAMP-07");
  assert.equal(normalizeCode("HTTPS://THECARDDOC1.COM/Q/LOC-CLAMP-07\r\n"), "LOC-CLAMP-07");
  assert.equal(normalizeCode("loc clamp 07"), "LOC-CLAMP-07");
  assert.equal(codeKind("LOC-"), null);
  assert.equal(codeKind(normalizeCode("LOC--CLAMP")), null);
  assert.equal(codeKind(`LOC-${"A".repeat(37)}`), null, "over 40 characters");
  // Unchanged kinds
  assert.equal(codeKind("CD-2549"), "order");
  assert.equal(codeKind("CD-2549-03"), "card");
  assert.equal(codeKind("CD-2549-P"), "bag");
  assert.equal(codeKind("JOHN-SMITH"), null);
});

test("a place QR opens the Scan page at that place", () => {
  assert.equal(scanPathForLocation("loc-clamp-07"), "/admin/scan?loc=LOC-CLAMP-07");
  assert.equal(codeTargetPath("location", "some-id", null, "LOC-CLAMP-07"), "/admin/scan?loc=LOC-CLAMP-07");
  const saved = process.env.NEXT_PUBLIC_APP_URL;
  try {
    delete process.env.NEXT_PUBLIC_APP_URL;
    assert.equal(qrUrl("loc-clamp-07"), "HTTPS://THECARDDOC1.COM/Q/LOC-CLAMP-07");
  } finally {
    if (saved !== undefined) process.env.NEXT_PUBLIC_APP_URL = saved;
  }
});

test("slots: one station type per step, codes LOC-CLAMP-07, names CLAMP 07", () => {
  assert.deepEqual(STATION_TYPES.map((t) => t.stage), [...STAGES]);
  assert.equal(stationType("drying")?.stage, "Book");
  assert.equal(slotCode("clamp", 7), "LOC-CLAMP-07");
  assert.equal(slotCode("heat-press", 3), "LOC-HEAT-PRESS-03");
  assert.equal(slotCode("clamp", 120), "LOC-CLAMP-120");
  assert.equal(slotName(stationType("clamp")!, 7), "CLAMP 07");
  assert.equal(slotName(stationType("book-weights")!, 12), "BOOK WEIGHTS 12");
  for (const t of STATION_TYPES) assert.equal(codeKind(slotCode(t.key, 9999)), "location", t.key);
  assert.throws(() => slotCode("clamp", 0));
  assert.throws(() => slotCode("Clamp", 1));
});

test("shelf slots: code, name and sort from the due date", () => {
  assert.equal(shelfSlotCode("2026-12-07"), "LOC-SHELF-20261207");
  assert.equal(shelfSlotName("2026-12-07"), "DUE MON DEC 7");
  assert.equal(shelfSlotName("2027-01-01"), "DUE FRI JAN 1");
  assert.equal(shelfSlotSort("2026-12-07"), 20261207);
  assert.throws(() => shelfSlotCode("2026-02-30"));
});

test("other places: codes from the name, within 40 characters, -2.. when taken", () => {
  assert.equal(locationSlug("Back table #2"), "BACK-TABLE-2");
  assert.equal(locationSlug("Café shelf"), "CAFE-SHELF");
  assert.equal(locationSlug("!!!"), "PLACE");
  const c = locationCodeCandidates("A very long name for a place that goes on and on");
  assert.ok(c.every((x) => x.length <= 40 && codeKind(x) === "location"));
  assert.equal(c[1].endsWith("-2"), true);
});

test("places list order: slots by step then number, shelves by date, Done, Shipping, others", () => {
  const rows = [
    { kind: "other" as const, stage: null, due_date: null, sort: 0, name: "Back table" },
    { kind: "shipping" as const, stage: null, due_date: null, sort: 1000, name: "Shipping" },
    { kind: "station" as const, station: "clamp", serial: 2, stage: "Clamp Work", due_date: null, sort: 2, name: "CLAMP 02" },
    { kind: "shelf" as const, stage: null, due_date: "2026-12-07", sort: 20261207, name: "DUE MON DEC 7" },
    { kind: "station" as const, station: "humidor", serial: 1, stage: "Humidor", due_date: null, sort: 1, name: "HUMIDOR 01" },
    { kind: "done" as const, stage: null, due_date: null, sort: 900, name: "Done" },
    { kind: "shelf" as const, stage: null, due_date: "2026-12-01", sort: 20261201, name: "DUE TUE DEC 1" },
    { kind: "station" as const, station: "clamp", serial: 1, stage: "Clamp Work", due_date: null, sort: 1, name: "CLAMP 01" },
  ];
  assert.deepEqual(rows.sort(compareLocations).map((r) => r.name), [
    "HUMIDOR 01", "CLAMP 01", "CLAMP 02", "DUE TUE DEC 1", "DUE MON DEC 7", "Done", "Shipping", "Back table",
  ]);
});

test("into a slot: the step jumps forward to the slot's step, the old slot frees up", () => {
  const plan = planCards({
    action: "assign", target: CLAMP, cardIds: ["c01", "c02"],
    cards: [card("c01", { current: "Humidor", locationId: "loc-humidor-1" }), card("c02")],
  });
  assert.equal(plan.moves.length, 2);
  assert.deepEqual(plan.moves.map((m) => [m.cardId, m.fromLocationId, m.toLocationId, m.stageBefore, m.stageAfter, m.stageEvent?.stage, m.action]), [
    ["c01", "loc-humidor-1", "loc-clamp-07", "Humidor", "Clamp Work", "Clamp Work", "assign"],
    ["c02", null, "loc-clamp-07", null, "Clamp Work", "Clamp Work", "assign"],
  ]);
  assert.deepEqual(plan.results.map((r) => [r.ok, r.changed, r.stage, r.message]), [
    [true, true, "Clamp Work", "In CLAMP 07. Step: Clamp Work."],
    [true, true, "Clamp Work", "In CLAMP 07. Step: Clamp Work."],
  ]);
  assert.equal(plan.message, "2 cards in CLAMP 07. Step: Clamp Work.");
});

test("never backwards: a card past the slot's step keeps its step (said so); a done card stays done", () => {
  const plan = planCards({
    action: "move", target: HEAT, cardIds: ["c01", "c02"],
    cards: [card("c01", { current: "Book with Weights", locationId: "loc-clamp-07" }), card("c02", { completed: true, locationId: "loc-clamp-07" })],
  });
  assert.deepEqual(plan.moves.map((m) => [m.stageEvent, m.stageBefore, m.stageAfter, m.locationChanges, m.complete, m.action]), [
    [null, "Book with Weights", "Book with Weights", true, false, "move"],
    [null, "done", "done", true, false, "move"],
  ]);
  assert.equal(plan.results[0].message, "In HEAT PRESS 03. Step stays Book with Weights (past Heat Press).");
  assert.equal(plan.results[0].stage, undefined, "not at the slot's step");
  assert.equal(plan.results[1].message, "In HEAT PRESS 03. It's done, so the step wasn't changed.");
  assert.match(plan.message, /1 card past Heat Press kept its step \(Book with Weights\)/);
});

test("the same step in another slot: only the place changes, no event", () => {
  const plan = planCards({ action: "move", target: CLAMP, cardIds: ["c01"], cards: [card("c01", { current: "Clamp Work", locationId: "loc-clamp-03" })] });
  assert.equal(plan.moves.length, 1);
  assert.equal(plan.moves[0].stageEvent, null);
  assert.equal(plan.results[0].stage, "Clamp Work");
  assert.equal(plan.results[0].message, "In CLAMP 07.");
});

test("idempotent: a card already in the slot at that step is left alone; repeats count once", () => {
  const plan = planCards({
    action: "assign", target: CLAMP, cardIds: ["c01", "c01"],
    cards: [card("c01", { current: "Clamp Work", locationId: "loc-clamp-07" })],
  });
  assert.equal(plan.moves.length, 0);
  assert.deepEqual(plan.results.map((r) => [r.ok, r.changed, r.message]), [[true, false, "Already in CLAMP 07."]]);
  assert.equal(plan.message, "Already in CLAMP 07.");
});

test("refunded and not-received cards are refused, the others still go in", () => {
  const plan = planCards({
    action: "assign", target: CLAMP, cardIds: ["c01", "c02", "c03", "nope"],
    cards: [card("c01"), card("c02", { refunded: true }), card("c03", { received: false })],
  });
  assert.deepEqual(plan.moves.map((m) => m.cardId), ["c01"]);
  assert.deepEqual(plan.results.map((r) => [r.cardId, r.ok, r.message]), [
    ["c01", true, "In CLAMP 07. Step: Clamp Work."],
    ["c02", false, "CD-2549-02 was refunded. Not moved."],
    ["c03", false, "CD-2549-03 hasn't been received yet. Receive it first."],
    ["nope", false, "Card not found."],
  ]);
  assert.equal(plan.message, "1 card in CLAMP 07. Step: Clamp Work. Not moved: 1 refunded, 1 not received yet, 1 not found.");
});

test("done: marked done and put at the Done place; already done and there = nothing", () => {
  const plan = planCards({
    action: "done", target: DONE, cardIds: ["c01", "c02"],
    cards: [card("c01", { current: "Final Dry", locationId: "loc-final-1" }), card("c02", { completed: true, locationId: "loc-done" })],
  });
  assert.deepEqual(plan.moves.map((m) => [m.cardId, m.complete, m.stageBefore, m.stageAfter, m.toLocationId, m.action]), [
    ["c01", true, "Final Dry", "done", "loc-done", "done"],
  ]);
  assert.deepEqual(plan.results.map((r) => r.message), ["Done. In Done.", "Already done."]);
  // Without a Done place the card just leaves its slot
  const bare = planCards({ action: "done", target: null, cardIds: ["c01"], cards: [card("c01", { locationId: "loc-clamp-07" })] });
  assert.deepEqual(bare.moves.map((m) => [m.complete, m.toLocationId]), [[true, null]]);
});

test("take out: no place, the step stays; a card in no slot is left alone", () => {
  const plan = planCards({
    action: "release", target: CLAMP, cardIds: ["c01", "c02"],
    cards: [card("c01", { current: "Clamp Work", locationId: "loc-clamp-07" }), card("c02")],
  });
  assert.deepEqual(plan.moves.map((m) => [m.cardId, m.fromLocationId, m.toLocationId, m.stageEvent, m.stageAfter, m.action]), [
    ["c01", "loc-clamp-07", null, null, "Clamp Work", "release"],
  ]);
  assert.deepEqual(plan.results.map((r) => r.message), ["Taken out of its slot.", "Not in a slot."]);
});

test("a shelf only changes the place; the move row's action can be overridden (receive)", () => {
  const plan = planCards({ action: "assign", target: SHELF, cardIds: ["c01"], cards: [card("c01", { current: "Humidor" })], actionName: "receive" });
  assert.deepEqual(plan.moves.map((m) => [m.stageEvent, m.stageAfter, m.action]), [[null, "Humidor", "receive"]]);
  assert.equal(plan.results[0].message, "In DUE MON DEC 7.");
});

test("a later round restarts the steps: a new-round card with no step yet goes forward", () => {
  const plan = planCards({ action: "assign", target: HEAT, cardIds: ["c01"], cards: [card("c01", { current: null, round: 2 })] });
  assert.deepEqual(plan.moves[0].stageEvent, { stage: "Heat Press", round: 2 });
});

test("capacity: null = no limit; cards already inside count once", () => {
  assert.equal(overCapacity(null, ["a", "b"], ["c"]), false);
  assert.equal(overCapacity(1, [], ["a"]), false);
  assert.equal(overCapacity(1, ["a"], ["a"]), false, "already in it");
  assert.equal(overCapacity(1, ["a"], ["b"]), true);
  assert.equal(overCapacity(2, ["a"], ["b"]), false);
  assert.equal(hasRoom(null, 50), true);
  assert.equal(hasRoom(1, 1), false);
  assert.equal(hasRoom(1, 0), true);
});

test("ship check: refunded > not done > still in a slot > ok", () => {
  const slot = { kind: "station" as const };
  assert.equal(shipCheckStatus({ refunded: true, done: false, location: slot }), "refunded");
  assert.equal(shipCheckStatus({ refunded: false, done: false, location: null }), "not_done");
  assert.equal(shipCheckStatus({ refunded: false, done: true, location: slot }), "in_slot");
  assert.equal(shipCheckStatus({ refunded: false, done: true, location: null }), "ok");
  assert.equal(shipCheckStatus({ refunded: false, done: true, location: { kind: "done" } }), "ok");
  assert.equal(shipCheckStatus({ refunded: false, done: true, location: { kind: "shipping" } }), "ok");
});

test("history labels: null = Not started, done = Done, Book = Drying", () => {
  assert.equal(moveStageLabel(null), "Not started");
  assert.equal(moveStageLabel("done"), "Done");
  assert.equal(moveStageLabel("Book"), "Drying");
  assert.equal(moveStageLabel("Clamp Work"), "Clamp Work");
});
