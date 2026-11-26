/**
 * The plain Scan page's flow (components/intake/scan/scan-flow.ts; owner, Nov
 * 26 2026: "if I scan a humidity press for example that has a card, it pulls
 * up the order and then if I scan another spot that has nothing in it twice,
 * it auto moves that card to the empty spot that I scanned"; and "when a card
 * is attached to a spot, I want to be able to see the notes when I scan on
 * the spot along with the photo"): what each scan and tap does given the
 * picked card and the waiting move, its words (flow-text.ts), the notes the
 * Scan page's reads add (summaries.ts cardNotes), then the saves the flow
 * sends, end to end against the in-memory Supabase stand-in
 * (tests/intake/harness/mock-supabase.mjs). Customer emails are caught at
 * fetch (Resend's API calls).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  MOVED_SHOW_MS, PENDING_MS, afterLookup, afterSave, afterScanProblem, backToList, bagCardList, cancelPending, canMove, cardActions,
  clearShownMessage, expirePending, hideMessage, listOfOrder, panelOf, pickCard, pickedCard, planScan, quickRepeat, refreshCard, saveCall,
  spotRole, startFlow, startSave, tapSave, type FlowState, type Found, type Panel, type SaveCall, type SaveOutcome, type Step,
} from "@/components/intake/scan/scan-flow";
import {
  NOTE_TITLES, PENDING_SUB, PICKED_SUB, READY_SUB, SAVE_BUSY_TEXT, SWITCHED_OFF_TEXT, addAnywayText, backLabel, holderFullTitle, cardDetails, cardNoteList, doneInBagLine, dueLine,
  emptySpotText, hasCardNotes, inItNowText, movedTitle, outLine, searchHeading, takenOutText, whereText,
} from "@/components/intake/scan/flow-text";
import { cardNotes } from "@/lib/intake/tracking/summaries";
import { deskRefs } from "@/lib/intake/tracking/desk";
import type {
  LocationRef, TrackActionResponse, TrackBagSummary, TrackCardSummary, TrackOrderSummary, TrackSlotSummary,
} from "@/lib/intake/tracking/types";

// ─── Fixtures ───────────────────────────────────────────────────────────

const T0 = Date.parse("2026-11-26T15:00:00Z");

const place = (code: string, name: string, kind: LocationRef["kind"] = "station", stage: string | null = null): LocationRef =>
  ({ id: `id-${code}`, code, name, kind, station: kind === "station" ? code.split("-")[1].toLowerCase() : null, serial: null, stage });
const CLAMP7 = place("LOC-CLAMP-07", "CLAMP 07", "station", "Clamp Work");
const CLAMP8 = place("LOC-CLAMP-08", "CLAMP 08", "station", "Clamp Work");
const PRESS2 = place("LOC-HEAT-PRESS-02", "HEAT PRESS 02", "station", "Heat Press");
const DESK = place("LOC-DESK", "DESK", "other");
const DONE = place("LOC-DONE", "Done", "done");
const SHELF = place("LOC-SHELF-20261207", "DUE MON DEC 7", "shelf");
const OPEN_BAGS = place("LOC-OPEN-BAGS", "OPEN BAGS", "other");

function card(n: number, over: Partial<TrackCardSummary> = {}): TrackCardSummary {
  const code = `CD-2549-${String(n).padStart(2, "0")}`;
  return {
    id: `card-${n}`, code, name: `Charizard ${n}`, set: "Base Set", year: "1999", number: `${n}/102`, tier: "premium", tierName: "Gold",
    customer: "Maria Reyes", orderNumber: "CD-2549", orderId: "order-1", bagId: "bag-1", bagCode: "CD-2549-G", dueDate: "2026-12-07",
    stage: null, stageLabel: "Not started", round: 1, done: false, refunded: false, awaiting: false, received: true,
    location: null, locatedAt: null, bagLocation: null, photoUrl: null, photos: [], photosUrl: "/p", cardUrl: `/admin/receiving/card/card-${n}`,
    ...over,
  };
}

function spot(loc: LocationRef, cards: TrackCardSummary[] = [], over: Partial<TrackSlotSummary> = {}): TrackSlotSummary {
  return {
    ...loc, stationName: null, capacity: loc.kind === "station" ? 1 : null, stageLabel: loc.stage, dueDate: null, sort: 0, active: true,
    createdAt: "2026-11-24T00:00:00Z", createdBy: null, qrUrl: `HTTPS://THECARDDOC1.COM/Q/${loc.code}`,
    cardCount: cards.length, free: true, overCapacity: false, cards: cards.map((c) => ({ ...c, location: loc })), bags: [], ...over,
  };
}

function bag(cards: TrackCardSummary[]): TrackBagSummary {
  return {
    id: "bag-1", code: "CD-2549-G", tier: "premium", tierName: "Gold", orderId: "order-1", orderNumber: "CD-2549", customer: "Maria Reyes",
    dueDate: "2026-12-07", cardCount: cards.length, doneCount: 0, complete: false, location: SHELF, locatedAt: null, photosUrl: "/p", cards,
  };
}

const at = (loc: LocationRef, over: Partial<TrackCardSummary> = {}) => ({ location: loc, locatedAt: "2026-11-24T15:00:00Z", ...over });

function response(over: Partial<TrackActionResponse> & { cardId: string }): TrackActionResponse {
  const { cardId, ...rest } = over;
  return {
    location: null, results: [{ cardId, code: null, name: null, ok: true, changed: true, message: "Done." }], message: "Done.",
    changed: 1, emailedOrders: [], bagsCompleted: [], freed: [], ...rest,
  };
}

/** Run a scan of `code` through the flow as the page does: plan, then the save or the lookup. */
function scan(state: FlowState, code: string, found: Found | null, now: number): { plan: ReturnType<typeof planScan>; step: Step | null; state: FlowState } {
  const plan = planScan(state, code, now);
  if (plan.do === "save") return { plan, step: null, state: startSave(state, plan.save) };
  if (plan.do === "wait") return { plan, step: null, state };
  assert.ok(found, `scan of ${code} needed a lookup`);
  const step = afterLookup(state, found, now);
  return { plan, step, state: step.state };
}

const spotFound = (s: TrackSlotSummary): Found => ({ kind: "spot", spot: s });
/** The panel's title and line, whatever it shows. */
const titleOf = (p: Panel) => (p.kind === "message" ? p.message.title : p.title);
const subOf = (p: Panel) => (p.kind === "message" ? p.message.sub : p.kind === "saving" ? undefined : p.sub);

/** A flow with `c` picked (as after scanning the spot it is in, or a bag with only it). */
function picking(c: TrackCardSummary): FlowState {
  return { ...startFlow(), screen: { kind: "card", card: c, from: null } };
}

// ─── Plain, bags and orders ─────────────────────────────────────────────

test("plain by default: 'Ready to scan' ('Getting ready…' until listening), nothing picked, nothing waiting", () => {
  const s = startFlow();
  assert.deepEqual(panelOf(s), { kind: "ready", title: "Ready to scan", sub: READY_SUB });
  assert.equal(titleOf(panelOf(s, false)), "Getting ready…");
  assert.equal(pickedCard(s), null);
  assert.deepEqual(planScan(s, "LOC-CLAMP-07", T0), { do: "lookup" });
});

test("a bag with one card still in it: picked at once; several: the list, tap one; cards out, done, refunded and not arrived are left out", () => {
  const one = scan(startFlow(), "CD-2549-G", { kind: "bag", bag: bag([card(1), card(2, at(CLAMP7)), card(3, at(DESK))]) }, T0);
  assert.equal(one.step?.sound, null);
  assert.equal(one.state.screen.kind, "card");
  assert.equal(pickedCard(one.state)?.id, "card-1", "the one card in the bag is picked");
  const from = one.state.screen.kind === "card" ? one.state.screen.from : null;
  assert.equal(from && outLine(from.out, from.cards.length, from.total), "2 more cards are out: CLAMP 07, DESK");
  assert.deepEqual(panelOf(one.state), { kind: "picked", title: "Picked: CD-2549-01", sub: PICKED_SUB, card: one.state.screen.kind === "card" ? one.state.screen.card : null });

  const cards = [
    card(1), card(2, { location: SHELF }), card(3, at(CLAMP7)), card(4, { done: true, stageLabel: "Done" }),
    card(5, { refunded: true }), card(6, { awaiting: true, received: false }), card(7, { location: OPEN_BAGS }),
  ];
  const several = scan(startFlow(), "CD-2549-G", { kind: "bag", bag: bag(cards) }, T0);
  assert.equal(several.state.screen.kind, "list");
  const list = several.state.screen.kind === "list" ? several.state.screen.list : null;
  assert.deepEqual(list?.cards.map((c) => c.id), ["card-1", "card-2", "card-7"], "in the bag (no place, a shelf, the Open bags box), to do, arrived");
  assert.deepEqual(list?.out.map((c) => c.id), ["card-3"]);
  assert.equal(list?.doneInBag, 1);
  assert.equal(list && outLine(list.out, list.cards.length, list.total), "1 more card is out: CLAMP 07");
  assert.equal(list && doneInBagLine(list.doneInBag), "1 card is done.");
  assert.equal(pickedCard(several.state), null, "nothing picked until a card is tapped");
  assert.equal(panelOf(several.state).kind, "ready");

  // Tap one: picked, the list kept for "Back"
  const tapped = pickCard(several.state, list!.cards[1]);
  assert.equal(pickedCard(tapped)?.id, "card-2");
  assert.equal(tapped.screen.kind === "card" && tapped.screen.from && backLabel(tapped.screen.from.source, tapped.screen.from.title), "Back to bag CD-2549-G");
  assert.equal(backToList(tapped).screen.kind, "list");
  assert.equal(pickedCard(backToList(tapped)), null);
});

test("an order with every card out: nothing to pick, one line says where they are", () => {
  const order: TrackOrderSummary = {
    id: "order-1", orderNumber: "CD-2549", customer: "Maria Reyes", status: "in_progress", photosUrl: "/p", looseCards: [card(9, { bagId: null, received: false })],
    bags: [bag([card(1, at(CLAMP7)), card(2, at(PRESS2)), card(3, at(DESK))])],
  };
  const s = scan(startFlow(), "CD-2549", { kind: "order", order }, T0).state;
  assert.equal(s.screen.kind, "list");
  const list = listOfOrder(order);
  assert.deepEqual([list.cards.length, list.out.length, list.total], [0, 3, 3], "cards not received yet are in no bag: left out");
  assert.equal(outLine(list.out, 0, list.total), "All 3 cards are out: CLAMP 07, HEAT PRESS 02, DESK");
  assert.equal(outLine(list.out.slice(0, 2), 0, 3), "2 cards are out: CLAMP 07, HEAT PRESS 02");
  assert.equal(outLine([card(1, at(DESK)), card(2, at(DESK))], 1, 3), "2 more cards are out: DESK", "a place once");
  assert.equal(outLine([], 2, 2), null);
  assert.equal(doneInBagLine(0), null);
  assert.equal(doneInBagLine(2), "2 cards are done.");
});

// ─── Spots ──────────────────────────────────────────────────────────────

test("a spot with a card: that card is picked (no sound); an empty spot with nothing picked just shows it", () => {
  const press = spot(PRESS2, [card(3)]);
  const s = scan(startFlow(), PRESS2.code, spotFound(press), T0);
  assert.equal(s.step?.sound, null);
  assert.equal(pickedCard(s.state)?.id, "card-3");
  assert.equal(pickedCard(s.state)?.location?.code, PRESS2.code);
  assert.equal(s.state.message, null);
  assert.equal(s.state.pending, null);

  const empty = scan(startFlow(), CLAMP7.code, spotFound(spot(CLAMP7)), T0);
  assert.deepEqual([empty.state.screen.kind, empty.state.pending, empty.step?.sound], ["place", null, null]);
  assert.equal(emptySpotText("CLAMP 07"), "To put a card here: scan the card's bag, order or spot, then scan CLAMP 07 twice.");
  assert.deepEqual([spotRole(CLAMP7), spotRole(DESK), spotRole(DONE), spotRole(SHELF), spotRole(OPEN_BAGS), spotRole(place("LOC-SHIP", "Shipping", "shipping")), spotRole(place("LOC-BENCH-2", "BENCH 2", "other"))],
    ["holder", "desk", "done", "bags", "bags", "bags", "holder"]);
  // A place that holds bags shows its bags, and drops what was picked
  const shelf = scan(picking(card(1)), SHELF.code, spotFound(spot(SHELF)), T0);
  assert.deepEqual([shelf.state.screen.kind, pickedCard(shelf.state), shelf.state.pending], ["place", null, null]);
});

test("an empty spot scanned twice moves the picked card: from its bag an assign, from its holder a move naming it", () => {
  const c = card(3, at(PRESS2));
  const first = scan(picking(c), CLAMP7.code, spotFound(spot(CLAMP7)), T0);
  assert.equal(first.step?.sound, "pending");
  assert.deepEqual(first.state.pending, { kind: "move", card: c, to: { code: CLAMP7.code, name: "CLAMP 07", kind: "station", desk: false }, at: T0 });
  assert.deepEqual(panelOf(first.state), { kind: "pending", title: "Scan CLAMP 07 again to move CD-2549-03 here", sub: PENDING_SUB, card: c });
  assert.equal(pickedCard(first.state)?.id, c.id, "still picked while it waits");

  const second = scan(first.state, CLAMP7.code, null, T0 + 5_000);
  assert.equal(second.plan.do, "save", "no lookup: the second scan saves");
  assert.equal(second.state.pending, null, "the waiting move is used up");
  assert.deepEqual(panelOf(second.state), { kind: "saving", title: "Moving CD-2549-03 to CLAMP 07…", card: c });
  const call = second.plan.do === "save" ? saveCall(second.plan.save) : null;
  assert.deepEqual(call, { route: "move", body: { fromCode: PRESS2.code, toCode: CLAMP7.code, cardIds: [c.id] } });

  const res = response({
    cardId: c.id, location: CLAMP7, message: "In CLAMP 07. Step: Clamp Work.",
    results: [{ cardId: c.id, code: c.code, name: c.name, ok: true, changed: true, stage: "Clamp Work", stageLabel: "Clamp Work", message: "In CLAMP 07. Step: Clamp Work." }],
  });
  const saved = afterSave(second.state, { ok: true, res }, T0 + 6_000);
  assert.equal(saved.sound, "moved");
  assert.equal(saved.state.screen.kind, "ready", "the page is plain again");
  assert.equal(saved.state.message?.title, "CD-2549-03 is in CLAMP 07 now");
  assert.equal(saved.state.message?.sub, "Step: Clamp Work.");
  assert.equal(saved.state.message?.tone, "ok");
  assert.equal(clearShownMessage(saved.state, T0 + 6_000 + MOVED_SHOW_MS - 1), null);
  assert.equal(panelOf(clearShownMessage(saved.state, T0 + 6_000 + MOVED_SHOW_MS)!).kind, "ready", "then plain");

  // From its bag (no place, or a shelf): an assign
  // From its bag (no place, a shelf, the Open bags box): an assign that names the bag (fromBag)
  assert.deepEqual(saveCall({ kind: "move", card: card(1), to: first.state.pending!.to }), { route: "assign", body: { locationCode: CLAMP7.code, cardIds: ["card-1"], fromBag: true } });
  assert.deepEqual(saveCall({ kind: "move", card: card(1, { location: SHELF }), to: first.state.pending!.to }), { route: "assign", body: { locationCode: CLAMP7.code, cardIds: ["card-1"], fromBag: true } });
  assert.deepEqual(saveCall({ kind: "move", card: card(1, { location: OPEN_BAGS }), to: first.state.pending!.to }).body, { locationCode: CLAMP7.code, cardIds: ["card-1"], fromBag: true });
  // A card out of its bag: the move files the bag in the Open bags box, and says so
  const opened = afterSave(startSave(picking(card(1)), { kind: "move", card: card(1), to: first.state.pending!.to }), {
    ok: true,
    res: response({
      cardId: "card-1", location: CLAMP7, emailedOrders: ["order-1"],
      results: [{ cardId: "card-1", code: "CD-2549-01", name: null, ok: true, changed: true, stageLabel: "Clamp Work", message: "x" }],
      bags: [{ id: "bag-1", code: "CD-2549-G", customer: "Maria Reyes", letter: "R", location: OPEN_BAGS, opened: true, returned: 0, finished: false, doneCount: 0, cardCount: 2 }],
    }),
  }, T0);
  assert.equal(opened.state.message?.sub, "Step: Clamp Work. Put the bag in the Open bags box, under R. The customer got an email about the new step.");
});

test("a different scan cancels the waiting move and does its own thing", () => {
  const c = card(3, at(PRESS2));
  const waiting = scan(picking(c), CLAMP7.code, spotFound(spot(CLAMP7)), T0).state;
  // Another empty spot: it waits there instead
  const other = scan(waiting, CLAMP8.code, spotFound(spot(CLAMP8)), T0 + 1_000);
  assert.equal(other.plan.do, "lookup");
  assert.equal(other.state.pending?.to.code, CLAMP8.code);
  // Then CLAMP 07 again: no longer the one waiting, so it only waits there (nothing saved)
  const back = scan(other.state, CLAMP7.code, spotFound(spot(CLAMP7)), T0 + 2_000);
  assert.equal(back.plan.do, "lookup");
  assert.equal(back.state.pending?.to.code, CLAMP7.code);
  // A bag: its list, the waiting move gone
  const bagged = scan(waiting, "CD-2549-G", { kind: "bag", bag: bag([card(1), card(2)]) }, T0 + 1_000);
  assert.deepEqual([bagged.state.pending, bagged.state.screen.kind], [null, "list"]);
  // Cancel (or Esc): it goes, the card stays picked
  const cancelled = cancelPending(waiting);
  assert.deepEqual([cancelled.pending, pickedCard(cancelled)?.id, panelOf(cancelled).kind], [null, c.id, "picked"]);
  assert.equal(cancelPending(cancelled), cancelled);
});

test("the 30 s timeout: the second scan after 30 s only waits again; the panel says nothing moved", () => {
  const c = card(1);
  const waiting = scan(picking(c), CLAMP7.code, spotFound(spot(CLAMP7)), T0).state;
  assert.equal(planScan(waiting, CLAMP7.code, T0 + PENDING_MS).do, "save", "at 30 s exactly it still counts");
  const late = scan(waiting, CLAMP7.code, spotFound(spot(CLAMP7)), T0 + PENDING_MS + 1);
  assert.equal(late.plan.do, "lookup", "too late: looked up, not saved");
  assert.equal(late.state.pending?.at, T0 + PENDING_MS + 1, "it waits again from now");
  assert.equal(late.step?.sound, "pending");

  assert.equal(expirePending(waiting, T0 + PENDING_MS), null);
  const step = expirePending(waiting, T0 + PENDING_MS + 1)!;
  assert.equal(step.sound, "expired", "a soft sound");
  const expired = step.state;
  assert.equal(expired.pending, null);
  assert.equal(pickedCard(expired)?.id, c.id, "the card stays picked");
  assert.deepEqual([expired.message?.tone, expired.message?.title, expired.message?.sub],
    ["warn", "Nothing moved", "That took over 30 seconds. Scan CLAMP 07 twice to move CD-2549-01 there."]);
  const doneWait = scan(picking(c), DONE.code, spotFound(spot(DONE)), T0).state;
  assert.equal(expirePending(doneWait, T0 + PENDING_MS + 1)?.state.message?.sub, "That took over 30 seconds. Scan DONE twice to mark CD-2549-01 done.");
  assert.equal(expirePending(startSave(waiting, { kind: "done", card: c }), T0 + PENDING_MS + 1), null, "not while a save runs");
  assert.equal(expirePending(startFlow(), T0), null);
});

test("a full spot with another card picked: its card is picked instead, and the panel says the first didn't move", () => {
  const was = card(3, at(PRESS2));
  const s = scan(picking(was), CLAMP7.code, spotFound(spot(CLAMP7, [card(5)])), T0);
  assert.equal(s.step?.sound, null, "browsing full holders is normal: the scan's read beep only, no error buzz");
  assert.equal(s.state.pending, null);
  assert.equal(pickedCard(s.state)?.id, "card-5");
  assert.deepEqual([s.state.message?.tone, s.state.message?.title, s.state.message?.sub],
    ["warn", "CLAMP 07 already has CD-2549-05", "CD-2549-03 didn't move. CD-2549-05 is picked now."]);
  // A holder with 2 cards (from before the one-card rule): its list, nothing picked
  const two = scan(picking(was), CLAMP7.code, spotFound(spot(CLAMP7, [card(5), card(6)])), T0);
  assert.deepEqual([two.state.screen.kind, pickedCard(two.state), two.state.message?.title, two.state.message?.sub],
    ["list", null, "CLAMP 07 already has 2 cards", "CD-2549-03 didn't move. Tap a card to pick it."]);
  // With nothing picked a holder of 2 just lists them
  const plain = scan(startFlow(), CLAMP7.code, spotFound(spot(CLAMP7, [card(5), card(6)])), T0);
  assert.deepEqual([plain.state.screen.kind, plain.state.message, plain.step?.sound], ["list", null, null]);
});

test("scanning the spot the picked card is in: nothing to move, it just shows (fresh)", () => {
  const was = card(3, at(CLAMP7, { stageLabel: "Humidor" }));
  const s = scan(picking(was), CLAMP7.code, spotFound(spot(CLAMP7, [card(3, { stageLabel: "Clamp Work" })])), T0);
  assert.deepEqual([s.step?.sound, s.state.pending], [null, null]);
  assert.equal(pickedCard(s.state)?.stageLabel, "Clamp Work", "as the spot answered");
  assert.deepEqual([s.state.message?.tone, s.state.message?.title, s.state.message?.sub], ["info", "CD-2549-03 is already in CLAMP 07", PICKED_SUB]);
  // Scanned again: the same, never a move
  assert.equal(scan(s.state, CLAMP7.code, spotFound(spot(CLAMP7, [card(3)])), T0 + 1_000).state.pending, null);
});

test("a desk scanned twice moves the picked card there (a desk is never full); with nothing picked it lists its cards", () => {
  const c = card(3, at(CLAMP7));
  const desk3 = spot(DESK, [card(5), card(6), card(7)]);
  const first = scan(picking(c), DESK.code, spotFound(desk3), T0);
  assert.equal(first.step?.sound, "pending");
  assert.equal(titleOf(panelOf(first.state)), "Scan DESK again to move CD-2549-03 here");
  const second = scan(first.state, DESK.code, null, T0 + 3_000);
  assert.equal(second.plan.do, "save");
  assert.deepEqual(second.plan.do === "save" && saveCall(second.plan.save), { route: "move", body: { fromCode: CLAMP7.code, toCode: DESK.code, cardIds: [c.id] } });
  const moved = afterSave(second.state, { ok: true, res: response({ cardId: c.id, location: DESK, message: "On DESK." }) }, T0);
  assert.deepEqual([moved.state.message?.title, moved.state.message?.sub], ["CD-2549-03 is on DESK now", undefined]);
  assert.equal(movedTitle(c, place("LOC-BENCH-2", "BENCH 2", "other")), "CD-2549-03 is at BENCH 2 now");

  // Nothing picked: the desk's cards (tap one); one card: picked; none: the empty desk
  const list = scan(startFlow(), DESK.code, spotFound(desk3), T0).state;
  assert.equal(list.screen.kind === "list" && list.screen.list.source, "desk");
  assert.equal(pickedCard(pickCard(list, card(6))!)?.id, "card-6");
  assert.equal(pickedCard(scan(startFlow(), DESK.code, spotFound(spot(DESK, [card(5)])), T0).state)?.id, "card-5");
  assert.equal(scan(startFlow(), DESK.code, spotFound(spot(DESK)), T0).state.screen.kind, "place");
  // The picked card is on this desk: the desk's list shows (nothing to move)
  const onIt = scan(picking(card(6, at(DESK))), DESK.code, spotFound(desk3), T0);
  assert.deepEqual([onIt.state.pending, onIt.state.screen.kind, onIt.state.message?.title, onIt.state.message?.sub],
    [null, "list", "CD-2549-06 is already on DESK", "Tap a card to pick it."]);
});

test("DONE scanned twice marks the picked card done; the answer says where its bag is and the order's line", () => {
  const c = card(3, at(CLAMP7));
  const first = scan(picking(c), DONE.code, spotFound(spot(DONE)), T0);
  assert.equal(first.step?.sound, "pending");
  assert.equal(titleOf(panelOf(first.state)), "Scan DONE again to mark CD-2549-03 done");
  const second = scan(first.state, DONE.code, null, T0 + 2_000);
  assert.equal(second.plan.do, "save");
  assert.deepEqual(second.plan.do === "save" && saveCall(second.plan.save), { route: "done", body: { cardIds: [c.id], fromCode: CLAMP7.code } }, "names the holder (fromCode)");
  assert.equal(titleOf(panelOf(second.state)), "Marking CD-2549-03 done…");
  const res = response({
    cardId: c.id, message: "Done. Put it back in REYES's bag: Open bags box, under R.",
    orderCompletions: [{ orderId: "order-1", orderNumber: "CD-2549", customerName: "Maria Reyes", completed: true, emailed: true, status: "completed", message: "Order completed. Maria Reyes emailed." }],
  });
  const done = afterSave(second.state, { ok: true, res }, T0);
  assert.equal(done.sound, "moved");
  assert.equal(done.state.screen.kind, "ready");
  assert.equal(done.state.message?.title, "Done. Put it back in REYES's bag: Open bags box, under R.");
  assert.deepEqual(done.state.message?.lines, [{ tone: "ok", text: "Order completed. Maria Reyes emailed." }]);
  assert.equal(done.state.message?.until, undefined, "stays until the next scan");
  // In its bag (no place, a shelf): it must still be with its bag (fromBag)
  assert.deepEqual(saveCall({ kind: "done", card: card(1) }), { route: "done", body: { cardIds: ["card-1"], fromBag: true } });
  assert.deepEqual(saveCall({ kind: "done", card: card(1, { location: SHELF }) }), { route: "done", body: { cardIds: ["card-1"], fromBag: true } });

  // DONE with nothing picked, or for a card done and back in its bag
  const none = scan(startFlow(), DONE.code, spotFound(spot(DONE)), T0);
  assert.deepEqual([none.step?.sound, none.state.pending, none.state.message?.title, none.state.message?.sub],
    ["refused", null, "Pick a card first", "Scan its spot, bag or order. Then scan DONE twice."]);
  const already = scan(picking(card(4, { done: true })), DONE.code, spotFound(spot(DONE)), T0);
  assert.deepEqual([already.state.pending, already.state.message?.title], [null, "CD-2549-04 is done already"]);
  // A waiting move, then DONE: the move goes, Done waits
  const moveThenDone = scan(scan(picking(c), CLAMP8.code, spotFound(spot(CLAMP8)), T0).state, DONE.code, spotFound(spot(DONE)), T0 + 1_000);
  assert.deepEqual([moveThenDone.state.pending?.kind, moveThenDone.state.pending?.to.code], ["done", DONE.code]);
});

test("an unknown code (or not one of ours): the waiting move goes, what's on screen and the picked card stay", () => {
  const c = card(3, at(CLAMP7));
  const waiting = scan(picking(c), CLAMP8.code, spotFound(spot(CLAMP8)), T0).state;
  const bad = afterScanProblem(waiting, "CD-9999-01: not found. The label may be from a deleted slot or bag.");
  assert.equal(bad.sound, "refused");
  assert.equal(bad.state.pending, null);
  assert.equal(pickedCard(bad.state)?.id, c.id);
  assert.deepEqual([bad.state.message?.tone, bad.state.message?.title], ["error", "CD-9999-01: not found. The label may be from a deleted slot or bag."]);
  // Then the empty spot again: it waits again (the first scan was cancelled)
  assert.equal(planScan(bad.state, CLAMP8.code, T0 + 2_000).do, "lookup");
  assert.equal(hideMessage(bad.state).message, null);
});

test("a scan while a save is running waits for it, then is read against what the save left (never a second move)", () => {
  const c = card(1);
  const waiting = scan(picking(c), CLAMP7.code, spotFound(spot(CLAMP7)), T0).state;
  const saving = scan(waiting, CLAMP7.code, null, T0 + 1_000).state;
  assert.ok(saving.saving);
  // The scanner reads CLAMP 07 a third time while the save runs
  assert.deepEqual(planScan(saving, CLAMP7.code, T0 + 1_200), { do: "wait" });
  // A tap meanwhile starts nothing and changes nothing on screen
  assert.deepEqual(tapSave(saving, "done", true), { ok: false, text: SAVE_BUSY_TEXT });
  const res = response({ cardId: c.id, location: CLAMP7, results: [{ cardId: c.id, code: c.code, name: c.name, ok: true, changed: true, stageLabel: "Clamp Work", message: "x" }] });
  const saved = afterSave(saving, { ok: true, res }, T0 + 1_500).state;
  // Then the held scan: looked up (the waiting move was used up), CLAMP 07 now has the card: it shows, nothing moves
  assert.equal(planScan(saved, CLAMP7.code, T0 + 1_600).do, "lookup");
  const held = afterLookup(saved, spotFound(spot(CLAMP7, [card(1)])), T0 + 1_600);
  assert.deepEqual([held.state.pending, held.sound, pickedCard(held.state)?.id, held.state.message], [null, null, "card-1", null]);
});

test("refusals: refunded or not-arrived cards and switched-off spots are refused before asking; the server's refusal keeps the card picked", () => {
  const refunded = scan(picking(card(1, { refunded: true })), CLAMP7.code, spotFound(spot(CLAMP7)), T0);
  assert.deepEqual([refunded.state.pending, refunded.step?.sound, refunded.state.message?.title], [null, "refused", "CD-2549-01 was refunded. Not moved."]);
  assert.equal(subOf(panelOf(picking(card(1, { refunded: true })))), "Refunded cards aren't worked on. Take it out and set it aside.");
  const notArrived = scan(picking(card(1, { received: false, awaiting: true })), DESK.code, spotFound(spot(DESK)), T0);
  assert.equal(notArrived.state.message?.title, "CD-2549-01 hasn't been received yet. Receive it first.");
  const off = scan(picking(card(1)), CLAMP7.code, spotFound(spot(CLAMP7, [], { active: false })), T0);
  assert.deepEqual([off.state.pending, off.state.message?.title], [null, "CLAMP 07 is switched off. Turn it back on in Places first."]);
  assert.deepEqual([canMove(card(1)), canMove(card(1, { refunded: true })), canMove(card(1, { received: false }))], [true, false, false]);

  // The server refuses (one-card holder taken meanwhile, a card someone moved): its sentence, the card stays picked
  const c = card(3, at(PRESS2));
  const saving = startSave(picking(c), { kind: "move", card: c, to: { code: CLAMP7.code, name: "CLAMP 07", kind: "station", desk: false } });
  const taken: SaveOutcome = { ok: false, status: 409, error: "CLAMP 07 already has a card (CD-2549-05 · Charizard). Take it out first, or pick another holder." };
  const refused = afterSave(saving, taken, T0);
  assert.equal(refused.sound, "refused");
  assert.deepEqual([refused.state.message?.tone, refused.state.message?.title, pickedCard(refused.state)?.id, refused.state.saving],
    ["error", taken.ok ? "" : taken.error, c.id, null]);
  // Read again: where it really is now
  const fresh = refreshCard(refused.state, { ...c, location: CLAMP8 });
  assert.equal(pickedCard(fresh)?.location?.code, CLAMP8.code);
  assert.equal(refreshCard(refused.state, card(9)), refused.state, "another card: nothing changes");
  // A card refused inside a 200 answer
  const partial = afterSave(saving, { ok: true, res: response({ cardId: c.id, results: [{ cardId: c.id, code: c.code, name: c.name, ok: false, changed: false, message: "CD-2549-03 was refunded. Not moved." }] }) }, T0);
  assert.deepEqual([partial.sound, partial.state.message?.title, partial.state.screen.kind], ["refused", "CD-2549-03 was refunded. Not moved.", "card"]);
});

test("a desk with a limit set that is full: 'Add anyway?' sends the card again to that same desk, with force", () => {
  const c = card(3, at(CLAMP7));
  const to = { code: "LOC-DESK-GAVIN", name: "DESK GAVIN", kind: "other" as const, desk: true };
  const saving = startSave(picking(c), { kind: "move", card: c, to });
  const conflict = { error: "x", overCapacity: true as const, capacity: 1, occupants: [card(9, { name: "Charizard 9", code: "CD-6001-09" })] };
  const asked = afterSave(saving, { ok: false, status: 409, error: "x", conflict }, T0);
  assert.deepEqual([asked.sound, asked.state.message?.tone, asked.state.message?.title, asked.state.message?.sub],
    ["refused", "warn", "DESK GAVIN already holds Charizard 9. Add anyway?", "In it now: CD-6001-09 · holds 1 card"]);
  assert.equal(inItNowText({ capacity: 2, occupants: [] }), "It holds 2 cards.");
  const retry = tapSave(asked.state, "retry", false);
  assert.ok(retry.ok);
  assert.deepEqual(retry.ok && saveCall(retry.save), { route: "move", body: { fromCode: CLAMP7.code, toCode: "LOC-DESK-GAVIN", cardIds: [c.id], force: true } });
  assert.deepEqual(tapSave(asked.state, "retry", true), { ok: false, text: SAVE_BUSY_TEXT }, "busy: nothing starts");
});

test("a holder filled meanwhile (409 with what's in it): no 'Add anyway?', the line names its card, the picked card stays", () => {
  const c = card(3, at(PRESS2));
  const saving = startSave(picking(c), { kind: "move", card: c, to: { code: "LOC-CLAMP-09", name: "CLAMP 09", kind: "station", desk: false } });
  const conflict = { error: "CLAMP 09 holds 1 card and has 1 in it. Add anyway?", overCapacity: true as const, capacity: 1, occupants: [card(5)] };
  const full = afterSave(saving, { ok: false, status: 409, error: conflict.error, conflict }, T0);
  assert.equal(full.sound, "refused");
  assert.deepEqual([full.state.message?.tone, full.state.message?.title, full.state.message?.sub, full.state.message?.retry],
    ["warn", "CLAMP 09 already has CD-2549-05 · Charizard 5", "CD-2549-03 didn't move.", undefined]);
  assert.equal(pickedCard(full.state)?.id, c.id, "still picked");
  assert.equal(panelOf(full.state).kind, "message");
  assert.ok(!/add anyway/i.test(`${full.state.message?.title} ${full.state.message?.sub}`), "never asks Add anyway for a holder");
  assert.deepEqual(tapSave(full.state, "retry", false), { ok: false, text: SAVE_BUSY_TEXT }, "nothing to send again");
  assert.equal(holderFullTitle("CLAMP 09", [card(5), card(6)]), "CLAMP 09 already has 2 cards (CD-2549-05, CD-2549-06)");
  assert.equal(holderFullTitle("CLAMP 09", []), "CLAMP 09 already has a card");
  assert.equal(holderFullTitle("CLAMP 09", [card(5, { name: null })]), "CLAMP 09 already has CD-2549-05");
});

test("the picked card's buttons: Done (asks first) and Take out (out of its bag only); taps", () => {
  assert.deepEqual(cardActions(card(1)), { done: true, takeout: false }, "in its bag: Done only");
  assert.deepEqual(cardActions(card(1, at(CLAMP7))), { done: true, takeout: true });
  assert.deepEqual(cardActions(card(1, { ...at(CLAMP7), refunded: true })), { done: false, takeout: true });
  assert.deepEqual(cardActions(card(1, { done: true })), { done: false, takeout: false }, "done and back in its bag: nothing to do");
  assert.deepEqual(cardActions(card(1, { ...at(DESK), done: true })), { done: true, takeout: true }, "done but out: Done puts it back");

  const c = card(3, at(CLAMP7));
  const t = tapSave(picking(c), "takeout", false);
  assert.ok(t.ok);
  assert.deepEqual(t.ok && saveCall(t.save), { route: "release", body: { cardIds: [c.id], fromCode: CLAMP7.code } });
  const out = afterSave(startSave(picking(c), { kind: "takeout", card: c }), {
    ok: true,
    res: response({ cardId: c.id, message: "Taken out.", bags: [{ id: "bag-1", code: "CD-2549-G", customer: "Maria Reyes", letter: "R", location: OPEN_BAGS, opened: false, returned: 1, finished: false, doneCount: 0, cardCount: 2 }] }),
  }, T0);
  assert.deepEqual([out.sound, out.state.screen.kind, out.state.message?.title],
    ["moved", "ready", "CD-2549-03 taken out of CLAMP 07, not done. Put it back in REYES's bag: Open bags box, under R."]);
  assert.equal(takenOutText("CD-2549-03", "CLAMP 07", undefined), "CD-2549-03 taken out of CLAMP 07, not done. Put it back in its bag.");
  assert.deepEqual(tapSave(picking(card(1)), "takeout", false), { ok: false, text: SAVE_BUSY_TEXT }, "in its bag: no Take out");
  assert.deepEqual(tapSave(startFlow(), "done", false), { ok: false, text: SAVE_BUSY_TEXT }, "nothing picked");
});

test("a typed search: its list (one hit is picked at once); a typed Card ID: that card", () => {
  const s = afterLookup(startFlow(), { kind: "search", query: "char", cards: [card(1), card(2, at(DESK))], truncated: true }, T0).state;
  assert.equal(s.screen.kind === "list" && s.screen.list.source, "search");
  assert.equal(searchHeading("char", 2, true), "2+ cards for “char”");
  assert.equal(searchHeading("char", 1, false), "1 card for “char”");
  assert.equal(pickedCard(afterLookup(startFlow(), { kind: "search", query: "char", cards: [card(1)], truncated: false }, T0).state)?.id, "card-1");
  assert.equal(pickedCard(afterLookup(startFlow(), { kind: "card", card: card(7) }, T0).state)?.id, "card-7");
  assert.deepEqual(bagCardList("bag", "X", null, []).cards, []);
});

// ─── Words ──────────────────────────────────────────────────────────────

test("the picked card's words: details with the variation, due, where it is and for how long", () => {
  assert.equal(cardDetails({ year: "1999", set: "Base Set", number: "4/102", variation: "1st Edition" }), "1999 · Base Set · #4/102 · 1st Edition");
  assert.equal(cardDetails({ year: null, set: null, number: "#4", variation: null }), "#4");
  assert.equal(dueLine("2026-12-07", "2026-12-04").text, "Due Mon Dec 7 · 3 days left");
  assert.deepEqual(dueLine("2026-12-07", "2026-12-10"), { text: "Due Mon Dec 7 · 3 days late", late: true });
  assert.equal(dueLine("2026-12-07", "2026-12-07").text, "Due Mon Dec 7 · today");
  assert.equal(dueLine(null).text, "No due date");
  const now = Date.parse("2026-11-26T15:00:00Z");
  assert.equal(whereText(card(1, at(CLAMP7)), now), "In CLAMP 07 for 2 days");
  assert.equal(whereText(card(1, { location: DESK, locatedAt: "2026-11-26T12:00:00Z" }), now), "On DESK for 3 hours");
  assert.equal(whereText(card(1, { location: place("LOC-BENCH-2", "BENCH 2", "other"), locatedAt: "2026-11-26T14:59:40Z" }), now), "Put at BENCH 2 just now");
  assert.equal(whereText(card(1), now), "In its bag");
  assert.equal(whereText(card(1, { bagLocation: OPEN_BAGS }), now), "In its bag · Bag: Open bags box · R");
  assert.equal(whereText(card(1, { location: SHELF }), now), "In its bag · Bag: Shelf DUE MON DEC 7");
});

test("notes: the card's note, its known defects and the order's notes, each in its labelled box, only when written", () => {
  assert.deepEqual(NOTE_TITLES, { card: "Notes on this card", defects: "Known defects", order: "Customer's notes" });
  assert.deepEqual(cardNoteList({ notes: " Small crease top left ", knownDefects: "Whitening on back", customerNotes: "Please be gentle.\nCall me first." }), [
    { kind: "card", title: "Notes on this card", text: "Small crease top left" },
    { kind: "defects", title: "Known defects", text: "Whitening on back" },
    { kind: "order", title: "Customer's notes", text: "Please be gentle.\nCall me first." },
  ]);
  assert.deepEqual(cardNoteList({ notes: "  ", knownDefects: null }), []);
  assert.deepEqual(cardNoteList({}), [], "an answer without notes");
  assert.deepEqual([hasCardNotes({ notes: "x" }), hasCardNotes({ knownDefects: "y" }), hasCardNotes({ notes: " ", knownDefects: null })], [true, true, false]);
  // Built on the server only from rows read with the note columns
  assert.deepEqual(cardNotes({ variation: " Holo ", notes: "", known_defects: "Whitening" }, { customer_notes: "Gentle" }),
    { variation: "Holo", notes: null, knownDefects: "Whitening", customerNotes: "Gentle" });
  assert.deepEqual(cardNotes({}, {}), {}, "read without them: no note fields (not 'no notes')");
  assert.deepEqual(cardNotes({ notes: null }, null), { notes: null });
});

test("'already in this spot' trusts the spot's answer, not the picked card's old place: swapped, now empty, left a desk", () => {
  // Picked in CLAMP 07 a while ago; someone swapped it for CD-2549-05 meanwhile: CLAMP 07's card is picked instead
  const stale = card(3, at(CLAMP7));
  const swapped = scan(picking(stale), CLAMP7.code, spotFound(spot(CLAMP7, [card(5)])), T0);
  assert.deepEqual([pickedCard(swapped.state)?.id, swapped.state.message?.title, swapped.state.pending], ["card-5", "CLAMP 07 already has CD-2549-05", null]);
  // CLAMP 07 is empty now (someone took it out): it is an empty spot, so the card waits to go there (the save names CLAMP 07 and the server says where it really is)
  const emptied = scan(picking(stale), CLAMP7.code, spotFound(spot(CLAMP7)), T0);
  assert.deepEqual([emptied.state.pending?.to.code, emptied.step?.sound, emptied.state.message], [CLAMP7.code, "pending", null]);
  // It was on DESK; someone took it off: the desk is a place to move it, not "already on DESK"
  const leftDesk = scan(picking(card(3, at(DESK))), DESK.code, spotFound(spot(DESK, [card(5), card(6)])), T0);
  assert.deepEqual([leftDesk.state.pending?.to.code, leftDesk.state.message], [DESK.code, null]);
  // Still listed: it shows (fresh)
  const still = scan(picking(card(3, at(DESK))), DESK.code, spotFound(spot(DESK, [card(5), card(3)])), T0);
  assert.deepEqual([still.state.pending, still.state.message?.title], [null, "CD-2549-03 is already on DESK"]);
  // An answer cut short (a place with 200+ cards): its place is trusted, as the list can't tell
  const big = spot(DESK, [card(5), card(6)], { cardCount: 250 });
  assert.deepEqual([scan(picking(card(3, at(DESK))), DESK.code, spotFound(big), T0).state.pending, scan(picking(card(3, at(DESK))), DESK.code, spotFound(big), T0).state.message?.title],
    [null, "CD-2549-03 is already on DESK"]);
  assert.equal(scan(picking(card(3, at(CLAMP8))), DESK.code, spotFound(big), T0).state.pending?.to.code, DESK.code, "cut short, but it was elsewhere: it waits to go there");
});

test("the waiting spot scanned again within 750 ms (the repeat gate): 'Scan CLAMP 09 again', not the second scan", () => {
  const c = card(3, at(PRESS2));
  const nine = place("LOC-CLAMP-09", "CLAMP 09", "station", "Clamp Work");
  const waiting = scan(picking(c), nine.code, spotFound(spot(nine)), T0).state;
  assert.equal(quickRepeat(waiting, nine.code), "Scan CLAMP 09 again");
  assert.equal(quickRepeat(waiting, CLAMP7.code), null, "another code: a plain double read, nothing said");
  assert.equal(quickRepeat(picking(c), nine.code), null, "nothing waiting");
  assert.equal(quickRepeat(startSave(waiting, { kind: "done", card: c }), nine.code), null, "a save runs");
  assert.equal(waiting.pending?.at, T0, "the dropped read changes nothing: the next scan of CLAMP 09 is the second");
  const doneWait = scan(picking(c), DONE.code, spotFound(spot(DONE)), T0).state;
  assert.equal(quickRepeat(doneWait, DONE.code), "Scan DONE again");
});

test("a card picked in a switched-off holder or desk says so (panel and 'already here' line); somewhere else after a refresh, it doesn't", () => {
  const off = { active: false };
  const s = scan(startFlow(), CLAMP7.code, spotFound(spot(CLAMP7, [card(3)], off)), T0).state;
  assert.equal(s.screen.kind === "card" && s.screen.off, true);
  assert.deepEqual(panelOf(s).kind === "picked" && [panelOf(s).kind, (panelOf(s) as { sub: string }).sub], ["picked", SWITCHED_OFF_TEXT]);
  assert.equal(SWITCHED_OFF_TEXT, "This holder is switched off: use Take out or Done, or switch it on in Places.");
  // Scanned again: "already in CLAMP 07" with the same line
  const again = scan(s, CLAMP7.code, spotFound(spot(CLAMP7, [card(3)], off)), T0 + 1_000).state;
  assert.equal(again.message?.sub, SWITCHED_OFF_TEXT);
  // A switched-off desk's list: the card tapped there says so too
  const desk = scan(startFlow(), DESK.code, spotFound(spot(DESK, [card(5), card(6)], off)), T0).state;
  const tapped = pickCard(desk, card(6, at(DESK)));
  assert.equal(tapped.screen.kind === "card" && tapped.screen.off, true);
  // A refused save, then read again: now in CLAMP 08 (on), the line goes; still there, it stays
  const moved = refreshCard(s, card(3, at(CLAMP8)));
  assert.equal(moved.screen.kind === "card" && !!moved.screen.off, false);
  assert.equal(panelOf(moved).kind === "picked" && (panelOf(moved) as { sub: string }).sub, PICKED_SUB);
  const same = refreshCard(s, card(3, at(CLAMP7, { stageLabel: "Clamp Work" })));
  assert.equal(same.screen.kind === "card" && same.screen.off, true);
  // A switched-on holder: no line
  const on = scan(startFlow(), CLAMP7.code, spotFound(spot(CLAMP7, [card(3)])), T0).state;
  assert.equal(on.screen.kind === "card" && "off" in on.screen, false);
  // Refunded and not-arrived lines come first
  const refunded = scan(startFlow(), CLAMP7.code, spotFound(spot(CLAMP7, [card(3, { refunded: true })], off)), T0).state;
  assert.equal((panelOf(refunded) as { sub: string }).sub, "Refunded cards aren't worked on. Take it out and set it aside.");
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
let emails = 0;

const ORDER = "00000000-0000-4000-8000-00000ac00001";
const BAG = "00000000-0000-4000-8000-00000ac0b001";
const C = (n: number) => `00000000-0000-4000-8000-00000ac0c0${String(n).padStart(2, "0")}`;
const row = (n: number, over: Row = {}): Row => ({
  id: C(n), order_id: ORDER, card_name: `Charizard ${n}`, card_set: "Base Set", card_year: "1999", card_number: `${n}/102`,
  variation: null, notes: null, known_defects: null, estimated_value_cents: null, photo_urls: [], catalog_image_url: null,
  tier: null, status: "active", completed: false, completed_at: null, current_round: 1, created_at: "2026-11-23T19:00:00.000000+00:00",
  card_seq: n, card_code: `CD-6101-${String(n).padStart(2, "0")}`, bag_id: BAG, received_at: "2026-11-23T19:30:00+00:00",
  received_by: "gavin", awaiting_arrival: false, receiving_photo_urls: [], location_id: null, located_at: null, refunded_cents: 0,
  service_ids: [], slab_removal_selected: false, pregrade_selected: false, ...over,
});
const tick = () => new Promise((r) => setTimeout(r, 5));
const loc = (code: string) => mock.store.table("locations").find((l) => l.code === code);
const dbCard = (n: number) => mock.store.table("cards").find((c) => c.id === C(n))!;

before(async () => {
  const harness = pathToFileURL(path.resolve("tests/intake/harness/mock-supabase.mjs")).href;
  const { startMock } = (await import(harness)) as { startMock: (o: { port: number; quiet: boolean }) => Promise<Mock> };
  mock = await startMock({ port: 0, quiet: true });
  mock.store.load({
    tables: {
      orders: [{
        id: ORDER, order_number: "CD-6101", customer_name: "Maria Reyes", customer_email: "maria@example.com", customer_phone: "555-0100",
        ship_from_address: {}, ship_to_address: {}, subtotal_cents: 10000, total_cents: 10000, refunded_cents: 0,
        slab_crack_count: 0, instagram_feature: false, gift_card_discount_cents: 0, admin_notes: null,
        status: "in_progress", payment_status: "paid", restoration_tier: "premium", inbound_method: "self_ship",
        customer_notes: "Please be gentle with the corners.\nCall me first.", created_at: "2026-11-23T19:00:00+00:00", updated_at: "2026-11-23T19:00:00+00:00",
      }],
      tier_bags: [{
        id: BAG, order_id: ORDER, tier: "premium", batch: 1, bag_code: "CD-6101-G", received_on: "2026-11-16", due_date: "2026-12-07",
        due_status: "calculated", turnaround_days: 15, source: "receiving", created_at: "2026-11-23T19:30:00+00:00",
      }],
      cards: [row(1, { notes: "Small crease top left", known_defects: "Whitening on back", variation: "Holo" }), row(2), row(3), row(4)],
      order_events: [],
      locations: [
        { id: "00000000-0000-4000-8000-00000ac0f001", code: "LOC-DONE", name: "Done", kind: "done", sort: 900, active: true, created_at: "2026-11-24T00:00:00+00:00" },
        { id: "00000000-0000-4000-8000-00000ac0f002", code: "LOC-SHIP", name: "Shipping", kind: "shipping", sort: 1000, active: true, created_at: "2026-11-24T00:00:00+00:00" },
      ],
      card_moves: [],
      restoration_settings: [{ tier: "premium", display_name: "Gold", turnaround_min_days: 15, turnaround_max_days: 20 }],
      business_holidays: [],
    },
  });
  // No customer email leaves the test: Resend's API is caught (and counted) here
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("resend")) {
      emails += 1;
      return new Response(JSON.stringify({ id: "email" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  admin = createClient(mock.url, "service-role-test-key", { auth: { persistSession: false } });
  svc = {
    moves: await import("@/lib/intake/tracking/moves"),
    locations: await import("@/lib/intake/tracking/locations"),
    resolve: await import("@/lib/intake/tracking/resolve"),
  };
  for (const station of ["clamp", "heat-press"]) {
    const made = await svc.locations.createSlots(admin, { station, count: 2, by: "gavin" });
    assert.ok(made.ok, made.ok ? "" : made.error);
  }
  const desk = await svc.locations.createLocation(admin, { name: "Desk", kind: "other", by: "gavin" });
  assert.ok(desk.ok, desk.ok ? "" : desk.error);
});

after(async () => {
  globalThis.fetch = realFetch;
  await mock?.close();
});

/** What the page sends for a save, through the real services (as the routes call them). */
function send(call: SaveCall) {
  const by = "gavin";
  if (call.route === "assign") return svc.moves.assignCards(admin, { ...call.body, by });
  if (call.route === "move") return svc.moves.moveSlot(admin, { ...call.body, by });
  if (call.route === "done") return svc.moves.markCardsDone(admin, { ...call.body, by });
  return svc.moves.releaseCards(admin, { ...call.body, by });
}
const outcomeOfResult = (r: Awaited<ReturnType<typeof send>>): SaveOutcome =>
  (r.ok ? { ok: true, res: r as TrackActionResponse }
    : { ok: false, status: r.status, error: r.error, ...(r.conflict ? { conflict: r.conflict } : {}), ...(r.full ? { full: r.full } : {}) });

async function resolved(code: string): Promise<Found> {
  const r = await svc.resolve.resolveTrackCode(admin, code);
  if (!r.ok) throw new Error(r.error);
  const x = r.response;
  if (x.kind === "location") return { kind: "spot", spot: x.location };
  if (x.kind === "bag") return { kind: "bag", bag: x.bag };
  if (x.kind === "order") return { kind: "order", order: x.order };
  return { kind: "card", card: x.card };
}

/** One scan as the page runs it: the save goes to the services, the lookup to resolve. */
async function scanLive(state: FlowState, code: string, now: number): Promise<FlowState> {
  const plan = planScan(state, code, now);
  if (plan.do === "save") {
    const saving = startSave(state, plan.save);
    return afterSave(saving, outcomeOfResult(await send(saveCall(plan.save))), now).state;
  }
  return afterLookup(state, await resolved(code), now).state;
}

test("the Scan page's reads carry each card's notes: a bag, a spot, a typed Card ID and a search; other reads don't", async () => {
  const b = await resolved("CD-6101-G");
  assert.equal(b.kind, "bag");
  const first = b.kind === "bag" ? b.bag.cards.find((c) => c.id === C(1)) : undefined;
  assert.deepEqual([first?.variation, first?.notes, first?.knownDefects, first?.customerNotes],
    ["Holo", "Small crease top left", "Whitening on back", "Please be gentle with the corners.\nCall me first."]);
  const second = b.kind === "bag" ? b.bag.cards.find((c) => c.id === C(2)) : undefined;
  assert.deepEqual([second?.notes, second?.knownDefects, second?.customerNotes], [null, null, "Please be gentle with the corners.\nCall me first."]);
  const typed = await resolved("CD-6101-01");
  assert.equal(typed.kind === "card" && typed.card.knownDefects, "Whitening on back");
  const search = await svc.resolve.searchCards(admin, "Charizard 1");
  assert.ok(search.ok);
  assert.equal(search.ok && search.response.cards.find((c) => c.id === C(1))?.notes, "Small crease top left");
  // Other reads (a move's 409 occupants, the ship check) are as before: no note fields
  const [plain] = await svc.resolve.loadCardSummaries(admin, [C(1)]);
  assert.equal("notes" in plain, false);
  assert.equal("customerNotes" in plain, false);
});

test("live: bag -> its one card picked; empty clamp twice -> in it (assign); press twice -> moved (move with fromCode); a spot with it shows its notes", async () => {
  // Three of the four cards are out first, so the bag has one left in it
  for (const n of [2, 3, 4]) {
    const r = await svc.moves.assignCards(admin, { locationCode: "LOC-DESK", cardIds: [C(n)], by: "gavin" });
    assert.ok(r.ok, r.ok ? "" : r.error);
  }
  await tick();
  let s = await scanLive(startFlow(), "CD-6101-G", T0);
  assert.equal(pickedCard(s)?.id, C(1), "the one card still in the bag is picked at once");
  assert.equal(s.screen.kind === "card" && s.screen.from && outLine(s.screen.from.out, s.screen.from.cards.length, s.screen.from.total), "3 more cards are out: Desk");

  s = await scanLive(s, "LOC-CLAMP-01", T0 + 1_000);
  assert.equal(s.pending?.to.code, "LOC-CLAMP-01");
  assert.equal(dbCard(1).location_id, null, "one scan changes nothing");
  s = await scanLive(s, "LOC-CLAMP-01", T0 + 2_000);
  assert.equal(s.message?.title, "CD-6101-01 is in CLAMP 01 now");
  // (the bag went in the Open bags box when the first card came out: nothing to file now)
  assert.equal(s.message?.sub, "Step: Clamp Work. The customer got an email about the new step.");
  assert.equal(dbCard(1).location_id, loc("LOC-CLAMP-01")!.id);
  await tick();

  // Scan the clamp: its card picked, with its notes
  s = await scanLive(s, "LOC-CLAMP-01", T0 + 3_000);
  const picked = pickedCard(s);
  assert.equal(picked?.location?.code, "LOC-CLAMP-01");
  assert.deepEqual(cardNoteList(picked!).map((n) => n.title), ["Notes on this card", "Known defects", "Customer's notes"]);
  // Then the empty heat press twice: a move naming CLAMP 01
  s = await scanLive(s, "LOC-HEAT-PRESS-01", T0 + 4_000);
  assert.equal(s.pending?.kind, "move");
  const moves0 = mock.store.table("card_moves").length;
  s = await scanLive(s, "LOC-HEAT-PRESS-01", T0 + 5_000);
  assert.equal(s.message?.title, "CD-6101-01 is in HEAT PRESS 01 now");
  assert.equal(dbCard(1).location_id, loc("LOC-HEAT-PRESS-01")!.id);
  assert.equal(mock.store.table("card_moves").length - moves0, 1);
  await tick();
  // Its old clamp is empty now: scanned with nothing picked, it just shows
  s = await scanLive(startFlow(), "LOC-CLAMP-01", T0 + 6_000);
  assert.equal(s.screen.kind, "place");
});

test("live: the desk twice takes the card from its holder; a stale card is refused (fromCode), never done, no email", async () => {
  let s = await scanLive(startFlow(), "LOC-HEAT-PRESS-01", T0);
  assert.equal(pickedCard(s)?.id, C(1));
  s = await scanLive(s, "LOC-DESK", T0 + 1_000);
  s = await scanLive(s, "LOC-DESK", T0 + 2_000);
  assert.equal(s.message?.title, "CD-6101-01 is on Desk now");
  assert.equal(dbCard(1).location_id, loc("LOC-DESK")!.id);
  await tick();

  // The desk with nothing picked: its 4 cards, tap one
  s = await scanLive(startFlow(), "LOC-DESK", T0 + 3_000);
  assert.equal(s.screen.kind === "list" && s.screen.list.cards.length, 4);
  s = pickCard(s, s.screen.kind === "list" ? s.screen.list.cards.find((c) => c.id === C(2))! : card(0));
  assert.equal(pickedCard(s)?.id, C(2));
  // DONE once; meanwhile another phone moves CD-6101-02 into CLAMP 02; DONE again: refused, nothing done, no email
  s = await scanLive(s, "LOC-DONE", T0 + 4_000);
  assert.equal(s.pending?.kind, "done");
  const away = await svc.moves.moveSlot(admin, { fromCode: "LOC-DESK", toCode: "LOC-CLAMP-02", cardIds: [C(2)], by: "gavin" });
  assert.ok(away.ok, away.ok ? "" : away.error);
  await tick();
  const sent = emails;
  s = await scanLive(s, "LOC-DONE", T0 + 5_000);
  assert.deepEqual([s.message?.tone, s.message?.title], ["error", "CD-6101-02 isn't in Desk any more (now in CLAMP 02)."]);
  assert.equal(pickedCard(s)?.id, C(2), "still picked: the page reads it again");
  assert.deepEqual([dbCard(2).completed, dbCard(2).location_id], [false, loc("LOC-CLAMP-02")!.id]);
  assert.equal(emails, sent, "no email");
  const again = await resolved("CD-6101-02");
  s = refreshCard(s, again.kind === "card" ? again.card : card(0));
  assert.equal(pickedCard(s)?.location?.code, "LOC-CLAMP-02");

  // Now DONE twice from where it really is: done, back in its bag
  s = await scanLive(s, "LOC-DONE", T0 + 6_000);
  s = await scanLive(s, "LOC-DONE", T0 + 7_000);
  assert.equal(s.message?.title, "Done. Put it back in REYES's bag: Open bags box, under R.");
  assert.deepEqual([dbCard(2).completed, dbCard(2).location_id], [true, null]);
  assert.equal(s.screen.kind, "ready");
});

test("live: Take out from a spot names it; the last cards done complete the order (its line)", async () => {
  // CD-6101-03 on the desk: Take out -> back in its bag, not done
  let s = await scanLive(startFlow(), "LOC-DESK", T0);
  s = pickCard(s, s.screen.kind === "list" ? s.screen.list.cards.find((c) => c.id === C(3))! : card(0));
  const t = tapSave(s, "takeout", false);
  assert.ok(t.ok);
  assert.deepEqual(t.ok && saveCall(t.save), { route: "release", body: { cardIds: [C(3)], fromCode: "LOC-DESK" } });
  s = afterSave(startSave(s, t.ok ? t.save : (null as never)), outcomeOfResult(await send(saveCall(t.ok ? t.save : (null as never)))), T0).state;
  assert.equal(s.message?.title, "CD-6101-03 taken out of Desk, not done. Put it back in REYES's bag: Open bags box, under R.");
  assert.deepEqual([dbCard(3).completed, dbCard(3).location_id], [false, null]);
  await tick();

  // Done for the others: the last one completes the order
  for (const n of [1, 3]) {
    const r = await svc.moves.markCardsDone(admin, { cardIds: [C(n)], by: "gavin" });
    assert.ok(r.ok, r.ok ? "" : r.error);
    await tick();
  }
  s = await scanLive(startFlow(), "LOC-DESK", T0 + 1_000);
  assert.equal(pickedCard(s)?.id, C(4), "the desk's one card is picked");
  s = await scanLive(s, "LOC-DONE", T0 + 2_000);
  s = await scanLive(s, "LOC-DONE", T0 + 3_000);
  assert.match(s.message?.title ?? "", /^Done\. Put it back in REYES's bag: Open bags box, under R\./);
  assert.deepEqual(s.message?.lines?.map((l) => l.tone), ["ok"]);
  assert.match(s.message?.lines?.[0].text ?? "", /^Order completed\./);
  // The bag now: nothing waiting in it, every card done
  s = await scanLive(startFlow(), "CD-6101-G", T0 + 4_000);
  const list = s.screen.kind === "list" ? s.screen.list : null;
  assert.deepEqual([list?.cards.length, list?.out.length, list?.doneInBag], [0, 0, 4]);
});

test("live: a card in a switched-off holder says so when picked and can still leave it (desk twice, DONE twice); a switched-off spot isn't a target", async () => {
  mock.store.table("cards").push(row(5), row(6));
  for (const [n, code] of [[5, "LOC-CLAMP-02"], [6, "LOC-CLAMP-01"]] as const) {
    const into = await svc.moves.assignCards(admin, { locationCode: code, cardIds: [C(n)], by: "gavin" });
    assert.ok(into.ok, into.ok ? "" : into.error);
  }
  for (const code of ["LOC-CLAMP-01", "LOC-CLAMP-02", "LOC-HEAT-PRESS-02"]) {
    const off = await svc.locations.updateLocation(admin, { id: loc(code)!.id as string, active: false });
    assert.ok(off.ok);
  }
  await tick();
  let s = await scanLive(startFlow(), "LOC-CLAMP-02", T0);
  assert.equal(pickedCard(s)?.id, C(5));
  assert.deepEqual(panelOf(s).kind === "picked" ? panelOf(s) : null, { kind: "picked", title: "Picked: CD-6101-05", sub: SWITCHED_OFF_TEXT, card: pickedCard(s) });
  // A switched-off spot isn't a place to put it: refused before asking
  s = await scanLive(s, "LOC-HEAT-PRESS-02", T0 + 1_000);
  assert.deepEqual([s.pending, s.message?.title], [null, "HEAT PRESS 02 is switched off. Turn it back on in Places first."]);
  // The desk twice: it leaves the switched-off holder (moveSlot reads the from-place like Done and Take out)
  s = await scanLive(s, "LOC-DESK", T0 + 2_000);
  s = await scanLive(s, "LOC-DESK", T0 + 3_000);
  assert.equal(s.message?.title, "CD-6101-05 is on Desk now");
  assert.equal(dbCard(5).location_id, loc("LOC-DESK")!.id);
  await tick();
  // DONE twice for the card in switched-off CLAMP 01 (fromCode)
  s = await scanLive(startFlow(), "LOC-CLAMP-01", T0 + 4_000);
  assert.equal(pickedCard(s)?.id, C(6));
  s = await scanLive(s, "LOC-DONE", T0 + 5_000);
  s = await scanLive(s, "LOC-DONE", T0 + 6_000);
  assert.match(s.message?.title ?? "", /^Done\./);
  assert.deepEqual([dbCard(6).completed, dbCard(6).location_id], [true, null]);
  // Into a switched-off holder is still refused by the server
  const into = await svc.moves.moveSlot(admin, { fromCode: "LOC-DESK", toCode: "LOC-CLAMP-02", cardIds: [C(5)], by: "gavin" });
  assert.deepEqual(into.ok ? null : [into.status, into.error], [409, "CLAMP 02 is switched off. Turn it back on in Places first."]);
  for (const code of ["LOC-CLAMP-01", "LOC-CLAMP-02", "LOC-HEAT-PRESS-02"]) await svc.locations.updateLocation(admin, { id: loc(code)!.id as string, active: true });
});

test("live: DONE twice for an order's last card after someone moved it: refused (409), nothing changes, no order completion, no email", async () => {
  // An order whose only card is this one: finishing it would complete the order and email the customer
  const order2 = "00000000-0000-4000-8000-00000ac00002";
  const bag2 = "00000000-0000-4000-8000-00000ac0b002";
  const id = C(20);
  const base = mock.store.table("orders").find((o) => o.id === ORDER)!;
  mock.store.table("orders").push({ ...base, id: order2, order_number: "CD-6102", customer_name: "Sam Ortiz", customer_email: "sam@example.com",
    status: "in_progress", payment_status: "paid", updated_at: "2026-11-23T19:00:00+00:00" });
  mock.store.table("tier_bags").push({ ...mock.store.table("tier_bags").find((b) => b.id === BAG)!, id: bag2, order_id: order2, bag_code: "CD-6102-G" });
  mock.store.table("cards").push(row(20, { order_id: order2, bag_id: bag2, card_code: "CD-6102-01", card_seq: 1 }));
  const put = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-01", cardIds: [id], by: "gavin" });
  assert.ok(put.ok, put.ok ? "" : put.error);
  await tick();

  // This phone: CLAMP 01 scanned (its card picked), then DONE once
  let s = await scanLive(startFlow(), "LOC-CLAMP-01", T0);
  assert.equal(pickedCard(s)?.code, "CD-6102-01");
  s = await scanLive(s, "LOC-DONE", T0 + 1_000);
  assert.equal(s.pending?.kind, "done");
  // Another phone moves it to HEAT PRESS 02
  const away = await svc.moves.moveSlot(admin, { fromCode: "LOC-CLAMP-01", toCode: "LOC-HEAT-PRESS-02", cardIds: [id], by: "gavin" });
  assert.ok(away.ok, away.ok ? "" : away.error);
  await tick();
  const card20 = () => mock.store.table("cards").find((c) => c.id === id)!;
  const snapshot = () => ({
    card: { ...card20() },
    moves: mock.store.table("card_moves").length,
    order: mock.store.table("orders").find((o) => o.id === order2)!.status,
    events: mock.store.table("order_events").filter((e) => e.order_id === order2).length,
    bag: { ...mock.store.table("tier_bags").find((b) => b.id === bag2)! },
    emails,
  });
  const before = snapshot();
  // DONE again: the body names CLAMP 01 (fromCode), so the card (now in HEAT PRESS 02) is refused
  s = await scanLive(s, "LOC-DONE", T0 + 2_000);
  assert.deepEqual([s.message?.tone, s.message?.title], ["error", "CD-6102-01 isn't in CLAMP 01 any more (now in HEAT PRESS 02)."]);
  await tick();
  assert.deepEqual(snapshot(), before, "nothing changed: the card, its history, the order, its events, the bag, no email");
  assert.equal(pickedCard(s)?.id, id, "still picked (the page reads it again)");
});

test("live: a card picked in its bag that another phone put in a holder: the double scan and DONE are refused (fromBag), nothing written, no email", async () => {
  // An order whose only card is this one: finishing it would complete the order and email the customer
  const order3 = "00000000-0000-4000-8000-00000ac00003";
  const bag3 = "00000000-0000-4000-8000-00000ac0b003";
  const id = C(30);
  const base = mock.store.table("orders").find((o) => o.id === ORDER)!;
  mock.store.table("orders").push({ ...base, id: order3, order_number: "CD-6103", customer_name: "Lee Park", customer_email: "lee@example.com",
    status: "in_progress", payment_status: "paid", updated_at: "2026-11-23T19:00:00+00:00" });
  mock.store.table("tier_bags").push({ ...mock.store.table("tier_bags").find((b) => b.id === BAG)!, id: bag3, order_id: order3, bag_code: "CD-6103-G", location_id: null });
  mock.store.table("cards").push(row(30, { order_id: order3, bag_id: bag3, card_code: "CD-6103-01", card_seq: 1 }));
  const three = await svc.locations.createSlots(admin, { station: "clamp", count: 2, startAt: 3, by: "gavin" });
  assert.ok(three.ok, three.ok ? "" : three.error);

  // This phone: the bag scanned, its one card picked (in its bag)
  let s = await scanLive(startFlow(), "CD-6103-G", T0);
  assert.equal(pickedCard(s)?.id, id);
  assert.equal(pickedCard(s)?.location, null);
  // Another phone puts it in CLAMP 03
  const away = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-03", cardIds: [id], by: "gavin" });
  assert.ok(away.ok, away.ok ? "" : away.error);
  await tick();
  const card30 = () => mock.store.table("cards").find((c) => c.id === id)!;
  const snapshot = () => ({
    card: { ...card30() },
    moves: mock.store.table("card_moves").length,
    order: mock.store.table("orders").find((o) => o.id === order3)!.status,
    events: mock.store.table("order_events").filter((e) => e.order_id === order3).length,
    bag: { ...mock.store.table("tier_bags").find((b) => b.id === bag3)! },
    emails,
  });
  const before = snapshot();

  // The empty CLAMP 04 twice: an assign with fromBag, refused; it is not yanked out of CLAMP 03
  s = await scanLive(s, "LOC-CLAMP-04", T0 + 1_000);
  assert.equal(s.pending?.to.code, "LOC-CLAMP-04");
  s = await scanLive(s, "LOC-CLAMP-04", T0 + 2_000);
  assert.deepEqual([s.message?.tone, s.message?.title], ["error", "CD-6103-01 isn't in its bag any more (now in CLAMP 03)."]);
  assert.equal(pickedCard(s)?.id, id, "still picked (the page reads it again)");
  // DONE twice: a done with fromBag, refused; no order completion, no email
  s = await scanLive(s, "LOC-DONE", T0 + 3_000);
  s = await scanLive(s, "LOC-DONE", T0 + 4_000);
  assert.deepEqual([s.message?.tone, s.message?.title], ["error", "CD-6103-01 isn't in its bag any more (now in CLAMP 03)."]);
  await tick();
  assert.deepEqual(snapshot(), before, "nothing changed: the card, its history, the order, its events, the bag, no email");
  assert.deepEqual([card30().completed, card30().location_id], [false, loc("LOC-CLAMP-03")!.id]);

  // Several at once: the one still in its bag goes, the other is refused with where it is
  mock.store.table("cards").push(row(31, { order_id: order3, bag_id: bag3, card_code: "CD-6103-02", card_seq: 2 }));
  const mixed = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-04", cardIds: [id, C(31)], fromBag: true, by: "gavin" });
  assert.ok(mixed.ok, mixed.ok ? "" : mixed.error);
  assert.deepEqual(mixed.ok && mixed.results.map((r) => [r.code, r.ok, r.ok ? "" : r.message]).sort(), [
    ["CD-6103-01", false, "Not in its bag any more (now in CLAMP 03)."],
    ["CD-6103-02", true, ""],
  ]);
  assert.equal(card30().location_id, loc("LOC-CLAMP-03")!.id, "left where it is");
  await tick();
  const both = await svc.moves.markCardsDone(admin, { cardIds: [id, C(31)], fromBag: true, by: "gavin" });
  assert.deepEqual(both.ok ? null : [both.status, both.error],
    [409, "Those cards aren't in their bags any more: CD-6103-01 (now in CLAMP 03), CD-6103-02 (now in CLAMP 04)."]);
  // Without fromBag (older pages, the Desk): as before, wherever the card is
  const anywhere = await svc.moves.markCardsDone(admin, { cardIds: [id], by: "gavin" });
  assert.ok(anywhere.ok && anywhere.results[0].ok, anywhere.ok ? anywhere.results[0].message : anywhere.error);
  // With fromBag, a card still in its bag (on its shelf, or none) is done
  mock.store.table("cards").push(row(32, { order_id: order3, bag_id: bag3, card_code: "CD-6103-03", card_seq: 3 }));
  const inBag = await svc.moves.markCardsDone(admin, { cardIds: [C(32)], fromBag: true, by: "gavin" });
  assert.ok(inBag.ok && inBag.results[0].ok, inBag.ok ? inBag.results[0].message : inBag.error);
});

// ─── Kept from the retired holder view's tests (scan-holder.test.ts: #81's fromCode, #83's one card per holder) ───

test("deskRefs: switched-on 'other' places with a desk code, LOC-DESK first", () => {
  const ref = (code: string, name: string, over: Partial<{ active: boolean; kind: "other" | "done"; sort: number }> = {}) =>
    ({ id: code, code, name, kind: "other" as const, active: true, sort: 0, ...over });
  assert.deepEqual(deskRefs([
    ref("LOC-DESK-ZED", "DESK ZED"), ref("LOC-DESK-OLD", "DESK OLD", { active: false }), ref("LOC-DESKTOP", "DESKTOP"),
    ref("LOC-DESK", "DESK"), ref("LOC-DESK-AMY", "DESK AMY"), ref("LOC-DESK-X", "DESK X", { kind: "done" }),
  ]).map((d) => [d.code, d.name]), [["LOC-DESK", "DESK"], ["LOC-DESK-AMY", "DESK AMY"], ["LOC-DESK-ZED", "DESK ZED"]]);
  assert.deepEqual(Object.keys(deskRefs([ref("LOC-DESK", "DESK")])[0]).sort(), ["code", "id", "name"]);
});

/** Order CD-6104 (Ana Diaz), bag CD-6104-G, cards CD-6104-40..45 in the bag; HUMIDOR 01..02 and the desk "Desk Gavin". */
const ORDER4 = "00000000-0000-4000-8000-00000ac00004";
const BAG4 = "00000000-0000-4000-8000-00000ac0b004";
async function order4() {
  if (mock.store.table("orders").some((o) => o.id === ORDER4)) return;
  const base = mock.store.table("orders").find((o) => o.id === ORDER)!;
  mock.store.table("orders").push({ ...base, id: ORDER4, order_number: "CD-6104", customer_name: "Ana Diaz", customer_email: "ana@example.com",
    status: "in_progress", payment_status: "paid", customer_notes: null, updated_at: "2026-11-23T19:00:00+00:00" });
  mock.store.table("tier_bags").push({ ...mock.store.table("tier_bags").find((b) => b.id === BAG)!, id: BAG4, order_id: ORDER4, bag_code: "CD-6104-G", location_id: null });
  for (const n of [40, 41, 42, 43, 44, 45]) mock.store.table("cards").push(row(n, { order_id: ORDER4, bag_id: BAG4, card_code: `CD-6104-${n}`, card_seq: n }));
  const humidors = await svc.locations.createSlots(admin, { station: "humidor", count: 2, by: "gavin" });
  assert.ok(humidors.ok, humidors.ok ? "" : humidors.error);
  const gavin = await svc.locations.createLocation(admin, { name: "Desk Gavin", kind: "other", by: "gavin" });
  assert.ok(gavin.ok, gavin.ok ? "" : gavin.error);
  assert.ok(loc("LOC-DESK-GAVIN") && loc("LOC-HUMIDOR-02"));
}

test("server: Done / Take out naming a place (fromCode): a card moved meanwhile is refused with where it is now, never finished; none left: 409; an unknown place: 404", async () => {
  await order4();
  // Two cards on a desk (every other holder takes one card)
  const put = await svc.moves.assignCards(admin, { locationCode: "LOC-DESK-GAVIN", cardIds: [C(40), C(41)], by: "gavin" });
  assert.ok(put.ok, put.ok ? "" : put.error);
  await tick();
  // Another phone moves CD-6104-41 to HUMIDOR 01 while this one still has it on Desk Gavin
  const away = await svc.moves.moveSlot(admin, { fromCode: "LOC-DESK-GAVIN", toCode: "LOC-HUMIDOR-01", cardIds: [C(41)], by: "gavin" });
  assert.ok(away.ok, away.ok ? "" : away.error);
  await tick();
  const moves0 = mock.store.table("card_moves").length;
  const sent0 = emails;
  const done = await svc.moves.markCardsDone(admin, { cardIds: [C(40), C(41)], fromCode: "LOC-DESK-GAVIN", by: "gavin" });
  assert.ok(done.ok, done.ok ? "" : done.error);
  assert.deepEqual(done.ok && done.results.map((r) => [r.code, r.ok, r.message]), [
    ["CD-6104-40", true, "Done."],
    ["CD-6104-41", false, "Not in Desk Gavin any more (now in HUMIDOR 01)."],
  ]);
  assert.deepEqual([dbCard(41).completed, dbCard(41).location_id], [false, loc("LOC-HUMIDOR-01")!.id], "CD-6104-41 left alone: not done, still in HUMIDOR 01");
  assert.equal(mock.store.table("card_moves").length - moves0, 1, "one history row (CD-6104-40's)");
  await tick();

  // None left in it: 409, nothing written; Done and Take out alike
  const again = await svc.moves.markCardsDone(admin, { cardIds: [C(41)], fromCode: "LOC-DESK-GAVIN", by: "gavin" });
  assert.deepEqual(again.ok ? null : [again.status, again.error], [409, "CD-6104-41 isn't in Desk Gavin any more (now in HUMIDOR 01)."]);
  const both = await svc.moves.releaseCards(admin, { cardIds: [C(40), C(41)], fromCode: "LOC-DESK-GAVIN", by: "gavin" });
  assert.deepEqual(both.ok ? null : [both.status, both.error],
    [409, "Those cards aren't in Desk Gavin any more: CD-6104-40 (now in its bag), CD-6104-41 (now in HUMIDOR 01)."]);
  assert.equal(mock.store.table("card_moves").length - moves0, 1, "nothing more written");
  assert.equal(emails, sent0, "no email");
  const unknown = await svc.moves.releaseCards(admin, { cardIds: [C(41)], fromCode: "LOC-NOPE-01", by: "gavin" });
  assert.deepEqual(unknown.ok ? null : [unknown.status, unknown.error], [404, "No slot or place has the code LOC-NOPE-01."]);

  // From where it really is: taken out; without fromCode (the Desk page, the scan landing) a card is done wherever it is
  const out41 = await svc.moves.releaseCards(admin, { cardIds: [C(41)], fromCode: "LOC-HUMIDOR-01", by: "gavin" });
  assert.ok(out41.ok && out41.results[0].ok, out41.ok ? out41.results[0].message : out41.error);
  await tick();
  const onDesk = await svc.moves.assignCards(admin, { locationCode: "LOC-DESK-GAVIN", cardIds: [C(41)], by: "gavin" });
  assert.ok(onDesk.ok, onDesk.ok ? "" : onDesk.error);
  await tick();
  const fromHumidor = await svc.moves.markCardsDone(admin, { cardIds: [C(41)], fromCode: "LOC-HUMIDOR-01", by: "gavin" });
  assert.deepEqual(fromHumidor.ok ? null : fromHumidor.error, "CD-6104-41 isn't in HUMIDOR 01 any more (now on Desk Gavin).");
  const anywhere = await svc.moves.markCardsDone(admin, { cardIds: [C(41)], by: "gavin" });
  assert.ok(anywhere.ok && anywhere.results[0].ok, anywhere.ok ? anywhere.results[0].message : anywhere.error);
  assert.deepEqual([dbCard(41).completed, dbCard(41).location_id], [true, null]);
});

test("server: a desk with a limit set in Places that is full answers 409 overCapacity (the page's 'Add anyway?', no force); force adds it", async () => {
  await order4();
  const desk = loc("LOC-DESK-GAVIN")!;
  const limit = await svc.locations.updateLocation(admin, { id: desk.id as string, capacity: 1 });
  assert.ok(limit.ok, limit.ok ? "" : limit.error);
  try {
    const first = await svc.moves.assignCards(admin, { locationCode: "LOC-DESK-GAVIN", cardIds: [C(42)], by: "gavin" });
    assert.ok(first.ok, first.ok ? "" : first.error);
    const into = await svc.moves.assignCards(admin, { locationCode: "LOC-HUMIDOR-02", cardIds: [C(43)], by: "gavin" });
    assert.ok(into.ok, into.ok ? "" : into.error);
    await tick();
    const full = await svc.moves.moveSlot(admin, { fromCode: "LOC-HUMIDOR-02", toCode: "LOC-DESK-GAVIN", cardIds: [C(43)], by: "gavin" });
    assert.ok(!full.ok && full.status === 409 && full.conflict, "409 with the conflict");
    if (full.ok || !full.conflict) return;
    assert.equal(addAnywayText("Desk Gavin", full.conflict), "Desk Gavin already holds Charizard 42. Add anyway?");
    assert.equal(inItNowText(full.conflict), "In it now: CD-6104-42 · holds 1 card");
    assert.equal(dbCard(43).location_id, loc("LOC-HUMIDOR-02")!.id, "not moved");
    const anyway = await svc.moves.moveSlot(admin, { fromCode: "LOC-HUMIDOR-02", toCode: "LOC-DESK-GAVIN", cardIds: [C(43)], force: true, by: "gavin" });
    assert.ok(anyway.ok, anyway.ok ? "" : anyway.error);
    assert.equal(dbCard(43).location_id, desk.id);
  } finally {
    await svc.locations.updateLocation(admin, { id: desk.id as string, capacity: null });
  }
});

test("live: a holder filled between the two scans (one card per holder: 409 HolderFull): '… already has CD-… · name' / '… didn't move.', no Add anyway, nothing written, no email", async () => {
  await order4();
  // CD-6104-44 and -45 are still in their bag: the bag's list, tap -44
  let s = await scanLive(startFlow(), "CD-6104-G", T0);
  assert.equal(s.screen.kind, "list");
  s = pickCard(s, s.screen.kind === "list" ? s.screen.list.cards.find((c) => c.id === C(44))! : card(0));
  assert.equal(pickedCard(s)?.id, C(44));
  s = await scanLive(s, "LOC-HUMIDOR-01", T0 + 1_000);
  assert.equal(s.pending?.to.code, "LOC-HUMIDOR-01");
  // Another phone puts CD-6104-45 in HUMIDOR 01 meanwhile
  const other = await svc.moves.assignCards(admin, { locationCode: "LOC-HUMIDOR-01", cardIds: [C(45)], by: "gavin" });
  assert.ok(other.ok, other.ok ? "" : other.error);
  await tick();
  const moves0 = mock.store.table("card_moves").length;
  const sent0 = emails;
  // The page's save as sent (assign from its bag, fromBag) answers HolderFull, force or not
  const plan = planScan(s, "LOC-HUMIDOR-01", T0 + 2_000);
  assert.equal(plan.do, "save");
  const answer = await send(saveCall(plan.do === "save" ? plan.save : (null as never)));
  assert.ok(!answer.ok && answer.status === 409 && answer.full && !answer.conflict, `409 HolderFull (${JSON.stringify(answer).slice(0, 160)})`);
  s = await scanLive(s, "LOC-HUMIDOR-01", T0 + 2_000);
  assert.deepEqual([s.message?.tone, s.message?.title, s.message?.sub, s.message?.retry ?? null],
    ["warn", "HUMIDOR 01 already has CD-6104-45 · Charizard 45", "CD-6104-44 didn't move.", null]);
  assert.equal(pickedCard(s)?.id, C(44), "still picked");
  assert.equal(s.pending, null);
  assert.deepEqual([dbCard(44).location_id, dbCard(45).location_id], [null, loc("LOC-HUMIDOR-01")!.id]);
  assert.equal(mock.store.table("card_moves").length - moves0, 0, "nothing written");
  assert.equal(emails, sent0, "no email");
});
