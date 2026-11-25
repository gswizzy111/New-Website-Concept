/**
 * The done flow's pure pieces (owner, Nov 25 2026): a finished card goes back
 * in its own bag, bags are filed A-Z by last name in one Open bags box, a
 * finished bag goes in the Ready to ship bin. Filing letter
 * (lib/intake/filing-letter.ts), the words and the bag-location rule
 * (lib/intake/tracking/bag-home.ts), the scan landing's Done helpers, the
 * Desk's outcome and the step picker's Done line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_LETTER, customerLastName, filingLetter } from "@/lib/intake/filing-letter";
import {
  BAG_FINISHED_TEXT, OPEN_BAGS_CODE, bagPlaceOf, bagPlaceOrNone, bagPlacePhrase, bagPlaceText, bagSentences, bagsToOpen,
  binAllowed, binClosedText, cardOutPhrase, doneCountText, doneText, finishedSentence, fullBagName, isBackInBag,
  isReadyToShipPlace, isWithBag, openBagsSentence, orderCompletionNotes, outOfBinSentence, ownerName, putBackSentence,
  stillOutText, takesCardOut, withBagSentences,
} from "@/lib/intake/tracking/bag-home";
import type { LocationRef, TrackActionResponse, TrackBagPlace } from "@/lib/intake/tracking/types";
import { pickerOutcome } from "@/lib/intake/step-picker";
import { placeSubtitle } from "@/components/intake/scan/format";
import { outcomeOf } from "@/app/admin/receiving/desk/_lib/outcome";
import {
  bagStepTitle, bagSteps, canFinish, doneAllIds, doneAllLabel, doneAllQuestion, doneOutcome, openBagsLine, whereText, type OpenCard,
} from "@/app/admin/receiving/open/[code]/_lib/view";

const loc = (id: string, code: string, name: string, kind: LocationRef["kind"]): LocationRef => ({ id, code, name, kind, station: null, serial: null, stage: null });
const OPEN = loc("open", OPEN_BAGS_CODE, "OPEN BAGS", "other");
const SHELF = loc("shelf", "LOC-SHELF-20261207", "DUE MON DEC 7", "shelf");
const SHIP = loc("ship", "LOC-SHIP", "Shipping", "shipping");
const DONE = loc("done", "LOC-DONE", "Done", "done");
const DESK = loc("desk", "LOC-DESK", "DESK", "other");
const CLAMP: LocationRef = { ...loc("clamp", "LOC-CLAMP-07", "CLAMP 07", "station"), station: "clamp", serial: 7, stage: "Clamp Work" };
const BENCH = loc("bench", "LOC-BENCH-2", "BENCH 2", "other");

const bag = (over: Partial<TrackBagPlace> = {}): TrackBagPlace => ({
  id: "bag-1", code: "CD-2549-P", customer: "Maria Reyes", letter: "R", location: OPEN,
  opened: false, returned: 0, finished: false, doneCount: 1, cardCount: 4, ...over,
});

// ─── Filing letter ──────────────────────────────────────────────────────────

test("filing letter: the first letter of the customer's LAST name", () => {
  assert.equal(filingLetter("Maria Reyes"), "R");
  assert.equal(filingLetter("  maria   de la cruz "), "C", "the last word");
  assert.equal(filingLetter("Reyes"), "R", "one word: that word");
  assert.equal(filingLetter("John Smith Jr."), "S", "suffixes skipped");
  assert.equal(filingLetter("John Smith, Jr."), "S");
  assert.equal(filingLetter("Robert Brown III"), "B");
  assert.equal(filingLetter("Reyes, Maria"), "R", "last name first keeps it");
  assert.equal(filingLetter("José Ávila"), "A", "accents dropped");
  assert.equal(filingLetter("Sean o'neil"), "O", "lower case, an apostrophe");
  assert.equal(filingLetter("Ann (Smith)"), "S", "marks around the name skipped");
});

test("filing letter: letters with no accent to drop file under their base letter (Ø, Ł, Æ, Œ, Đ, ß, Þ)", () => {
  assert.equal(filingLetter("Bjørn Ølsen"), "O");
  assert.equal(filingLetter("Łukasz Łapiński"), "L");
  assert.equal(filingLetter("łukasz łapiński"), "L", "lower case too");
  assert.equal(filingLetter("Anna Æsir"), "A");
  assert.equal(filingLetter("Marie Œuvre"), "O");
  assert.equal(filingLetter("Đorđe Đoković"), "D");
  assert.equal(filingLetter("Ðan Ðuric"), "D");
  assert.equal(filingLetter("Þór Þórsson"), "T");
  assert.equal(filingLetter("ßeta"), "S");
  assert.equal(filingLetter("Ø 2"), "O", "the name's first letter, folded, when the last word has none");
});

test("filing letter: business suffixes skipped; Roman numerals only in capitals or in a 3+ word name", () => {
  assert.equal(filingLetter("Card Shop LLC"), "S");
  assert.equal(filingLetter("Acme Cards, Inc."), "C");
  assert.equal(filingLetter("Acme Co"), "A");
  assert.equal(filingLetter("Mint Collectibles Ltd"), "C");
  assert.equal(filingLetter("John Smith IV"), "S", "capitals: a suffix");
  assert.equal(filingLetter("John Smith Iv"), "S", "three words: a suffix");
  assert.equal(filingLetter("Robert Brown iii"), "B");
  assert.equal(filingLetter("Lee Iv"), "I", "two words, not in capitals: the last name Iv");
  assert.equal(filingLetter("Mary Ii"), "I");
  assert.equal(customerLastName("Lee Iv"), "Iv");
  assert.equal(customerLastName("Lee IV"), "Lee");
  assert.equal(customerLastName("Smith, John III"), "Smith");
});

test("filing letter: no A-Z letter in the last name falls back to the first letter of the name, else #", () => {
  assert.equal(filingLetter("Maria 2"), "M", "a number for a last name: the first letter");
  assert.equal(filingLetter("Bo 王"), "B");
  assert.equal(filingLetter("王小明"), NO_LETTER);
  assert.equal(filingLetter("1234"), "#");
  assert.equal(filingLetter(""), "#");
  assert.equal(filingLetter("   "), "#");
  assert.equal(filingLetter(null), "#");
  assert.equal(filingLetter(undefined), "#");
});

test("the customer's last name, for \"REYES's bag\"", () => {
  assert.equal(customerLastName("Maria Reyes"), "Reyes");
  assert.equal(customerLastName("Reyes, Maria"), "Reyes");
  assert.equal(customerLastName("John Smith Jr."), "Smith");
  assert.equal(customerLastName("Jr"), "Jr", "only a suffix: kept");
  assert.equal(customerLastName(""), null);
  assert.equal(ownerName("Maria Reyes"), "REYES");
  assert.equal(ownerName(null), null);
});

// ─── Where a bag is ─────────────────────────────────────────────────────────

test("where a bag is, short: Open bags box · R, Shelf DUE MON DEC 7, Ready to ship", () => {
  assert.equal(bagPlaceText(OPEN, "R"), "Open bags box · R");
  assert.equal(bagPlaceText(OPEN, "R", true), "Open bags · R", "the Bags board");
  assert.equal(bagPlaceText(SHELF, "R"), "Shelf DUE MON DEC 7");
  assert.equal(bagPlaceText(SHIP, "R"), "Ready to ship");
  assert.equal(bagPlaceText(loc("s2", "LOC-SHIPPING-2", "Shipping 2", "shipping"), "R"), "Ready to ship", "any Shipping place");
  assert.equal(bagPlaceText(DONE, "R"), "Done shelf");
  assert.equal(bagPlaceText(BENCH, "R"), "BENCH 2");
  assert.equal(bagPlaceText(null, "R"), null);
  assert.equal(bagPlaceOrNone(null, "R"), "No place yet");
  // Scanning the box's own sign on the Scan page
  assert.equal(placeSubtitle({ kind: "other", code: OPEN_BAGS_CODE, stationName: null, stageLabel: null, dueDate: null }), "Bags with a card out, A-Z by last name");
});

test("where a bag is, in a sentence", () => {
  assert.equal(bagPlacePhrase(OPEN, "R"), "Open bags box, under R");
  assert.equal(bagPlacePhrase(SHELF, "R"), "on shelf DUE MON DEC 7");
  assert.equal(bagPlacePhrase(SHIP, "R"), "in the Ready to ship bin");
  assert.equal(bagPlacePhrase(DONE, "R"), "on the Done shelf");
  assert.equal(bagPlacePhrase(BENCH, "R"), "at BENCH 2");
  assert.equal(bagPlacePhrase(null, "R"), null);
});

// ─── The words after Done and after a card comes out ────────────────────────

test("Done: \"Done. Put it back in REYES's bag: Open bags box, under R.\"", () => {
  assert.equal(doneText(bag()), "Done. Put it back in REYES's bag: Open bags box, under R.");
  assert.equal(doneText(bag({ location: SHELF })), "Done. Put it back in REYES's bag: on shelf DUE MON DEC 7.");
  assert.equal(doneText(bag({ location: null })), "Done. Put it back in REYES's bag.");
  assert.equal(doneText(bag({ customer: null, letter: "#" })), "Done. Put it back in its bag: Open bags box, under #.");
  assert.equal(doneText(null), "Done.");
  assert.equal(putBackSentence([bag()], 3), "Put them back in REYES's bag: Open bags box, under R.");
  assert.equal(
    putBackSentence([bag(), bag({ id: "bag-2", code: "CD-2600-G", customer: "Sam Smith", letter: "S", location: SHELF })], 4),
    "Put each back in its bag: REYES's (Open bags box, under R), SMITH's (on shelf DUE MON DEC 7).",
  );
  assert.equal(putBackSentence([]), "");
});

test("one customer's bags (a mixed-tier order) are told apart by tier and Bag ID, with the cards for each", () => {
  const p = bag({ returned: 2, tierName: "Platinum", returnedCodes: ["CD-2549-07", "CD-2549-08"] });
  const g = bag({ id: "bag-2", code: "CD-2549-G", tierName: "Gold", location: SHELF, returned: 1, returnedCodes: ["CD-2549-01"] });
  assert.equal(putBackSentence([p, g], 3),
    "Put each back in its bag: CD-2549-07, CD-2549-08 in REYES's Platinum bag CD-2549-P (Open bags box, under R); CD-2549-01 in REYES's Gold bag CD-2549-G (on shelf DUE MON DEC 7).");
  assert.equal(withBagSentences("3 cards done.", [p, g], 3),
    "3 cards done. Put each back in its bag: CD-2549-07, CD-2549-08 in REYES's Platinum bag CD-2549-P (Open bags box, under R); CD-2549-01 in REYES's Gold bag CD-2549-G (on shelf DUE MON DEC 7).");
  // Without the codes or the tier (older answers): still told apart by Bag ID
  assert.equal(putBackSentence([bag(), bag({ id: "bag-2", code: "CD-2549-G", location: SHELF })], 2),
    "Put each back in its bag: REYES's bag CD-2549-P (Open bags box, under R); REYES's bag CD-2549-G (on shelf DUE MON DEC 7).");
  // Two bags with no name
  assert.equal(putBackSentence([bag({ customer: null, letter: "#", tierName: "Gold" }), bag({ id: "b2", code: "CD-1-S", customer: null, letter: "#", tierName: "Silver", location: null })], 2),
    "Put each back in its bag: the Gold bag CD-2549-P (Open bags box, under #); the Silver bag CD-1-S.");
  // A card out of each: both bags of one customer in the box, each named
  assert.equal(openBagsSentence([p, { ...g, location: OPEN }]),
    "Put the bags in the Open bags box: REYES's Platinum bag CD-2549-P under R, REYES's Gold bag CD-2549-G under R.");
  // One bag, or bags of different customers: as before
  assert.equal(putBackSentence([p], 2), "Put them back in REYES's bag: Open bags box, under R.");
  assert.equal(fullBagName(p), "REYES's Platinum bag CD-2549-P");
});

test("un-doing a card takes its finished bag out of the Ready to ship bin", () => {
  assert.equal(outOfBinSentence([bag()]), "Take REYES's bag out of the Ready to ship bin: Open bags box, under R.");
  assert.equal(outOfBinSentence([bag({ tierName: "Platinum" }), bag({ id: "b2", code: "CD-2549-G", tierName: "Gold" })]),
    "Take these bags out of the Ready to ship bin and put them in the Open bags box: REYES's Platinum bag CD-2549-P under R, REYES's Gold bag CD-2549-G under R.");
  assert.equal(outOfBinSentence([]), "");
});

test("a done card is back in its bag only with no place or a bag's place; else Ready to ship waits for it", () => {
  for (const l of [null, SHELF, OPEN, SHIP]) assert.equal(isBackInBag(l), true, l?.code ?? "no place");
  for (const l of [CLAMP, DESK, BENCH, DONE]) assert.equal(isBackInBag(l), false, l.code);
  assert.equal(cardOutPhrase(CLAMP), "in CLAMP 07");
  assert.equal(cardOutPhrase(DESK), "on DESK");
  assert.equal(cardOutPhrase(DONE), "on the Done shelf");
  assert.equal(cardOutPhrase(BENCH), "at BENCH 2");
  assert.equal(stillOutText([{ code: "CD-2549-03", location: CLAMP }, { code: "CD-2549-04", location: null }]), "CD-2549-03 is still in CLAMP 07: tap Done on it first.");
  assert.equal(stillOutText([{ code: "CD-2549-03", location: CLAMP }, { code: "CD-2549-04", location: DONE }]),
    "2 cards are still out of the bag (CD-2549-03 in CLAMP 07, CD-2549-04 on the Done shelf): tap Done on them first.");
  assert.equal(stillOutText([{ code: "CD-2549-03", location: SHELF }]), "");
  // A bag isn't finished while a done card is out
  const b = bagPlaceOf({ bag: { id: "b", bag_code: "CD-2549-P", location_id: null }, customer: "Maria Reyes", location: null,
    cards: [{ completed: true, refunded: false, inBag: true }, { completed: true, refunded: false, inBag: false }] });
  assert.deepEqual([b.finished, b.doneCount, b.cardCount], [false, 2, 2]);
  // Orders shipped back, delivered or cancelled: no bin
  for (const st of ["received", "in_progress", "completed", null]) assert.equal(binAllowed(st), true, String(st));
  for (const st of ["shipped_back", "delivered", "cancelled"]) assert.equal(binAllowed(st), false, st);
  assert.equal(binClosedText("CD-2549-P", "shipped_back"), "CD-2549-P isn't going in the Ready to ship bin: the order was shipped back already.");
  assert.equal(binClosedText("CD-2549-P", "cancelled"), "CD-2549-P isn't going in the Ready to ship bin: the order was cancelled.");
});

test("a finished bag and a card out of its bag", () => {
  assert.equal(BAG_FINISHED_TEXT, "Bag finished: put it in the Ready to ship bin");
  assert.equal(finishedSentence(1), "Bag finished: put it in the Ready to ship bin.");
  assert.equal(finishedSentence(2), "2 bags finished: put them in the Ready to ship bin.");
  assert.equal(finishedSentence(0), "");
  assert.equal(openBagsSentence([bag()]), "Put the bag in the Open bags box, under R.");
  assert.equal(openBagsSentence([bag(), bag({ id: "b2", customer: "Sam Smith", letter: "S" })]),
    "Put the bags in the Open bags box: REYES's under R, SMITH's under S.");
  assert.equal(openBagsSentence([]), "");
});

test("the request's line then the bag sentences (what the tracking API answers in `message`)", () => {
  // One card done, its bag in the box
  assert.equal(withBagSentences("Done.", [bag({ returned: 1 })], 1), "Done. Put it back in REYES's bag: Open bags box, under R.");
  // The bag's last cards: put back, then the bin
  assert.equal(withBagSentences("3 cards done.", [bag({ returned: 3, finished: true, doneCount: 4 })], 3),
    "3 cards done. Put them back in REYES's bag: Open bags box, under R. Bag finished: put it in the Ready to ship bin.");
  // A finished bag already in the bin isn't sent there again
  assert.equal(bagSentences([bag({ returned: 1, finished: true, location: SHIP })], 1), "Put it back in REYES's bag: in the Ready to ship bin.");
  // A card out to a holder: where the bag goes
  assert.equal(withBagSentences("In CLAMP 07. Step: Clamp Work.", [bag({ opened: true })], 0),
    "In CLAMP 07. Step: Clamp Work. Put the bag in the Open bags box, under R.");
  // Nothing about bags: the line as it is
  assert.equal(withBagSentences("Taken out of its slot.", [bag()], 0), "Taken out of its slot.");
  assert.equal(withBagSentences("Done.", undefined, 1), "Done.");
});

test("the bag count: \"4 cards\" while none is done, then \"3 of 4 done\"", () => {
  assert.equal(doneCountText(0, 4), "4 cards");
  assert.equal(doneCountText(0, 1), "1 card");
  assert.equal(doneCountText(3, 4), "3 of 4 done");
  assert.equal(doneCountText(4, 4), "4 of 4 done");
  assert.equal(doneCountText(0, 0), "No cards");
});

test("the order auto-complete lines: green when completed, amber otherwise, said once", () => {
  assert.deepEqual(orderCompletionNotes([
    { completed: true, message: "Order completed. Pat Collector emailed." },
    { completed: false, message: undefined },
    { completed: false, message: "Not completed: the order is Awaiting Payment." },
    { completed: true, message: "Order completed. Pat Collector emailed." },
    null,
  ]), [
    { tone: "ok", text: "Order completed. Pat Collector emailed." },
    { tone: "warn", text: "Not completed: the order is Awaiting Payment." },
  ]);
  assert.deepEqual(orderCompletionNotes(undefined), []);
});

// ─── The bag-location rule ──────────────────────────────────────────────────

test("which places keep a card with its bag, and which take it out", () => {
  for (const p of [null, SHELF, OPEN, DONE, SHIP]) assert.equal(isWithBag(p), true, p?.code ?? "no place");
  for (const p of [DESK, CLAMP, BENCH]) assert.equal(isWithBag(p), false, p.code);
  for (const p of [DESK, CLAMP, BENCH, loc("d2", "LOC-DESK-GAVIN", "DESK GAVIN", "other")]) assert.equal(takesCardOut(p), true, p.code);
  for (const p of [null, SHELF, OPEN, DONE, SHIP]) assert.equal(takesCardOut(p), false, p?.code ?? "no place");
  assert.equal(isReadyToShipPlace(SHIP), true);
  assert.equal(isReadyToShipPlace(OPEN), false);
});

test("bag rule: the first card out of a bag (to a desk or holder) files the bag in the Open bags box", () => {
  const bags = new Map<string, LocationRef | null>([["b-shelf", SHELF], ["b-none", null], ["b-open", OPEN], ["b-ship", SHIP]]);
  const at = (id: string) => (bags.has(id) ? bags.get(id)! : undefined);
  const m = (bagId: string | null, from: LocationRef | null, locationChanges = true) => ({ bagId, from, locationChanges });
  // Out of the bag to a desk: the bag on its shelf and the bag with no place go to the box
  assert.deepEqual(bagsToOpen(DESK, [m("b-shelf", null), m("b-none", null), m("b-shelf", null)], at), ["b-shelf", "b-none"], "each bag once");
  // To a holder from a shelf slot (cards put on the shelf) or from the old Done shelf
  assert.deepEqual(bagsToOpen(CLAMP, [m("b-shelf", SHELF), m("b-none", DONE)], at), ["b-shelf", "b-none"]);
  // Already in the box: nothing to do (a repeat files nothing twice)
  assert.deepEqual(bagsToOpen(DESK, [m("b-open", null)], at), []);
  // Holder to holder or desk to holder: the card was out already, the bag stays where staff left it
  assert.deepEqual(bagsToOpen(CLAMP, [m("b-shelf", DESK), m("b-none", CLAMP)], at), []);
  // A card already there (no change), a card in no bag, an unknown bag
  assert.deepEqual(bagsToOpen(DESK, [m("b-shelf", null, false), m(null, null), m("b-gone", null)], at), []);
  // Places that keep the card with its bag file nothing: a shelf, Done, Shipping, the box itself, no place
  for (const target of [SHELF, DONE, SHIP, OPEN, null]) assert.deepEqual(bagsToOpen(target, [m("b-shelf", null)], at), [], target?.code ?? "no place");
  // A bag in the Ready to ship bin whose card comes out again goes back to the box
  assert.deepEqual(bagsToOpen(DESK, [m("b-ship", SHIP)], at), ["b-ship"]);
});

test("a bag's place and counts from rows (refunded cards not counted)", () => {
  const b = bagPlaceOf({
    bag: { id: "b1", bag_code: "CD-2549-P", location_id: "open" },
    customer: "Maria Reyes",
    location: OPEN,
    cards: [{ completed: true, refunded: false }, { completed: true, refunded: false }, { completed: false, refunded: true }],
    opened: true,
    returned: 2,
  });
  assert.deepEqual(b, {
    id: "b1", code: "CD-2549-P", customer: "Maria Reyes", letter: "R", location: OPEN, opened: true, returned: 2,
    finished: true, doneCount: 2, cardCount: 2,
  });
  const none = bagPlaceOf({ bag: { id: "b2", bag_code: "CD-1-B", location_id: null }, customer: null, location: null, cards: [{ completed: false, refunded: true }] });
  assert.deepEqual([none.letter, none.finished, none.cardCount, none.opened, none.returned], ["#", false, 0, false, 0], "every card refunded: not finished");
});

// ─── The scan landing ───────────────────────────────────────────────────────

const pc = (id: string, state: OpenCard["state"], bagId: string | null = "bag-1", location: LocationRef | null = null) => ({ id, state, bagId, location });

test("scan landing: Done for cards here and not done; \"Mark all N done\" from 2 cards", () => {
  assert.equal(canFinish(pc("a", "ready")), true);
  for (const s of ["done", "refunded", "not_here"] as const) assert.equal(canFinish(pc("a", s)), false, s);
  // A done card still out of its bag: Done again puts it back; it says where it is
  assert.equal(canFinish(pc("a", "done", "bag-1", CLAMP)), true);
  assert.equal(canFinish(pc("a", "done", "bag-1", SHELF)), false);
  assert.equal(whereText(pc("a", "done", "bag-1", CLAMP), "desk"), "Done · in CLAMP 07");
  assert.equal(whereText(pc("a", "done", "bag-1", DESK), "desk"), "Done · on your desk");
  assert.equal(whereText(pc("a", "done", "bag-1", DESK), "other-desk"), "Done · on DESK");
  assert.equal(whereText(pc("a", "done", "bag-1", DONE), "desk"), "Done · on the Done shelf");
  assert.equal(whereText(pc("a", "done"), "desk"), "Done");
  assert.deepEqual(doneAllIds([pc("a", "ready"), pc("b", "done", "bag-1", CLAMP), pc("c", "done")]), ["a", "b"]);
  assert.deepEqual(doneAllIds([pc("a", "ready"), pc("b", "done"), pc("c", "ready"), pc("d", "refunded"), pc("e", "not_here")]), ["a", "c"]);
  assert.equal(doneAllIds([pc("a", "ready"), pc("b", "done")]), null, "one card: its own Done");
  assert.equal(doneAllLabel(4), "Mark all 4 done");
  assert.equal(doneAllLabel(1), "Mark 1 card done");
  assert.equal(doneAllQuestion(4), "Mark all 4 cards done?");
  assert.equal(doneAllQuestion(1), "Mark 1 card done?");
});

test("scan landing: what a Done said (the server's line, refused cards, the order's line)", () => {
  const ok = (cardId: string) => ({ cardId, code: cardId.toUpperCase(), name: null, ok: true, changed: true, message: "Done." });
  const one = doneOutcome([{ ok: true, res: {
    results: [ok("a")],
    message: "Done. Put it back in REYES's bag: Open bags box, under R.",
    orderCompletions: [{ orderId: "o", orderNumber: "CD-2549", customerName: "Maria Reyes", completed: true, emailed: true, status: "completed", message: "Order completed. Maria Reyes emailed." }],
  } }]);
  assert.deepEqual([one.tone, one.title, one.failedTitle, one.doneIds], ["ok", "Done. Put it back in REYES's bag: Open bags box, under R.", null, ["a"]]);
  assert.deepEqual(one.notes, [{ tone: "ok", text: "Order completed. Maria Reyes emailed." }]);

  const some = doneOutcome([
    { ok: true, res: { results: [ok("a"), { cardId: "r", code: "CD-1-09", name: null, ok: false, changed: false, message: "CD-1-09 was refunded. Not moved." }], message: "1 card done." } },
    { ok: false, error: "You're signed out. Sign in again, then scan again.", count: 2 },
  ]);
  assert.deepEqual([some.tone, some.title, some.failedTitle, some.doneIds], ["warn", "1 card done.", "3 not done:", ["a"]]);
  assert.deepEqual(some.failed.map((f) => [f.label, f.message]), [
    ["CD-1-09", "CD-1-09 was refunded. Not moved."],
    ["", "You're signed out. Sign in again, then scan again."],
  ]);
  const none = doneOutcome([{ ok: false, error: "No connection. Nothing was saved: scan again.", count: 1 }]);
  assert.deepEqual([none.tone, none.title, none.failed.map((f) => f.message), none.notes], ["error", "Not done", ["No connection. Nothing was saved: scan again."], []]);
});

test("scan landing: \"Put the bag in the Open bags box, under R.\" once per bag after a move", () => {
  const opened = bag({ opened: true });
  assert.equal(openBagsLine([{ ok: true, results: [], bags: [opened] }, { ok: true, results: [], bags: [opened] }]), "Put the bag in the Open bags box, under R.");
  assert.equal(openBagsLine([{ ok: true, results: [], bags: [bag()] }, { ok: false, error: "x", count: 1 }]), "");
  assert.equal(openBagsLine([{ ok: true, results: [] }]), "");
});

test("scan landing: the one big step once every live card of a bag is done, until it is in the bin", () => {
  const bags = [{ id: "bag-1", code: "CD-2549-P", location: OPEN }, { id: "bag-2", code: "CD-2549-G", location: SHIP }, { id: "bag-3", code: "CD-2549-S", location: null }];
  const cards = [
    pc("a", "done"), pc("b", "done"), pc("c", "refunded"),
    pc("d", "done", "bag-2"),
    pc("e", "done", "bag-3"), pc("f", "ready", "bag-3"),
  ];
  assert.deepEqual(bagSteps(bags, cards), [
    { id: "bag-1", code: "CD-2549-P", total: 2, inBin: false },
    { id: "bag-2", code: "CD-2549-G", total: 1, inBin: true },
  ]);
  assert.deepEqual(bagSteps(bags, cards, new Set(["bag-1"]))[0].inBin, true, "just put in the bin on this page");
  assert.deepEqual(bagSteps([{ id: "x", code: "CD-1-B", location: null }], [pc("r", "refunded", "x")]), [], "every card refunded: no step");
  // A done card still in a holder (or on the Done shelf): no step until its Done puts it back
  assert.deepEqual(bagSteps(bags, [pc("a", "done", "bag-1", CLAMP), pc("b", "done")]), []);
  assert.deepEqual(bagSteps(bags, [pc("a", "done", "bag-1", DONE), pc("b", "done")]), []);
  assert.deepEqual(bagSteps(bags, [pc("a", "done", "bag-1", SHELF), pc("b", "done")]).length, 1, "a shelf is with the bag");
  // The order shipped back, delivered or cancelled: no step
  for (const st of ["shipped_back", "delivered", "cancelled"]) assert.deepEqual(bagSteps(bags, cards, new Set(), st), [], st);
  assert.equal(bagSteps(bags, cards, new Set(), "completed").length, 2, "Completed: the bags still wait to ship");
  assert.equal(bagStepTitle({ code: "CD-2549-P" }, false), "Bag finished: put it in the Ready to ship bin");
  assert.equal(bagStepTitle({ code: "CD-2549-P" }, true), "Bag CD-2549-P finished: put it in the Ready to ship bin");
});

// ─── The Desk and the step picker ───────────────────────────────────────────

test("Desk: Done's title is the API's line; the order's line in colour; a finished bag links to its page", () => {
  const res: TrackActionResponse = {
    location: null,
    results: [{ cardId: "a", code: "CD-2549-03", name: "Charizard", ok: true, changed: true, message: "Done." }],
    message: "Done. Put it back in REYES's bag: Open bags box, under R. Bag finished: put it in the Ready to ship bin.",
    changed: 1,
    emailedOrders: [],
    bagsCompleted: ["bag-1"],
    freed: [],
    bags: [bag({ returned: 1, finished: true, doneCount: 4 })],
    orderCompletions: [{ orderId: "o", orderNumber: "CD-2549", customerName: "Maria Reyes", completed: false, emailed: false, status: "in_progress", reason: "not_all_done" }],
  };
  const out = outcomeOf(res);
  assert.equal(out.title, res.message);
  assert.deepEqual(out.notes, [], "the title already says the bag is finished");
  assert.equal(out.orderNotes, undefined, "no line when the order wasn't the point");
  assert.deepEqual(out.bagLinks, [{ key: "bag-1", href: "/admin/receiving/open/CD-2549-P", label: "Open REYES's bag" }]);

  const completed = outcomeOf({ ...res, bags: [bag({ returned: 1, finished: true, location: SHIP })], orderCompletions: [{ ...res.orderCompletions![0], completed: true, emailed: true, status: "completed", message: "Order completed. Maria Reyes emailed." }] });
  assert.deepEqual(completed.orderNotes, [{ tone: "ok", text: "Order completed. Maria Reyes emailed." }]);
  assert.equal(completed.bagLinks, undefined, "already in the Ready to ship bin");
  // Without bag places (an older answer): the old note
  assert.deepEqual(outcomeOf({ ...res, bags: undefined }).notes, ["1 bag is now all done."]);
});

test("step picker: Done says where the card goes back and the order's line", () => {
  const out = pickerOutcome("done", 1, {
    moved: ["a"],
    bagPlaces: [bag({ returned: 1 })],
    orderCompletion: { completed: true, message: "Order completed. Maria Reyes emailed." },
  });
  assert.deepEqual(out, {
    tone: "ok",
    text: "Marked done. Put it back in REYES's bag: Open bags box, under R.",
    notes: [{ tone: "ok", text: "Order completed. Maria Reyes emailed." }],
  });
  const why = pickerOutcome("done", 3, { moved: ["a", "b", "c"], bagPlaces: [bag({ returned: 3, finished: true })], orderCompletion: { completed: false, message: "Not completed: the order isn't paid." } });
  assert.equal(why.text, "3 cards marked done. Put them back in REYES's bag: Open bags box, under R. Bag finished: put it in the Ready to ship bin.");
  assert.deepEqual(why.notes, [{ tone: "warn", text: "Not completed: the order isn't paid." }]);
  // A step (not Done): no bag words, no order line
  assert.deepEqual(pickerOutcome("Humidor", 1, { moved: ["a"], newStep: ["a"], emailed: true, bagPlaces: [bag()] }), { tone: "ok", text: "Now at Humidor. Customer emailed." });
  // Done without bag places (the route before this change): as before
  assert.deepEqual(pickerOutcome("done", 1, { moved: ["a"] }), { tone: "ok", text: "Marked done." });
});
