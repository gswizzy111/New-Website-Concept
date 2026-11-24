/** The Scan page's code parser and repeat gate (components/intake/scan/parse.ts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createScanGate, isLocationCode, parseScan, scanKey, scanKindLabel, slotCodeGuess, typedSlotGuess } from "@/components/intake/scan/parse";
import { cardsLabel, fillText, placeSubtitle, roomLeft, sinceText, whereLine } from "@/components/intake/scan/format";
import { deskPagePath, isDeskCode } from "@/lib/intake/tracking/desk-codes";

test("QR links: the code after /Q/, any host, any case", () => {
  assert.deepEqual(parseScan("HTTPS://THECARDDOC1.COM/Q/CD-2549-03"), { code: "CD-2549-03", kind: "card" });
  assert.deepEqual(parseScan("https://thecarddoc1.com/q/cd-2549-p"), { code: "CD-2549-P", kind: "bag" });
  assert.deepEqual(parseScan("https://preview--example.netlify.app/Q/CD-2549"), { code: "CD-2549", kind: "order" });
  assert.deepEqual(parseScan("http://localhost:3000/q/loc-humidor"), { code: "LOC-HUMIDOR", kind: "location" });
  assert.deepEqual(parseScan("HTTPS://THECARDDOC1.COM/Q/LOC-SHELF-20261207"), { code: "LOC-SHELF-20261207", kind: "location" });
  // A trailing slash, a query or a fragment after the code
  assert.deepEqual(parseScan("https://thecarddoc1.com/q/CD-2549-03/"), { code: "CD-2549-03", kind: "card" });
  assert.deepEqual(parseScan("https://thecarddoc1.com/q/CD-2549-03?x=1#y"), { code: "CD-2549-03", kind: "card" });
  // Percent-encoded and without a scheme
  assert.deepEqual(parseScan("thecarddoc1.com/Q/CD%2D2549%2D03"), { code: "CD-2549-03", kind: "card" });
});

test("bare codes: cards, bags, orders and places", () => {
  assert.deepEqual(parseScan("CD-2549-03"), { code: "CD-2549-03", kind: "card" });
  assert.deepEqual(parseScan("CD-2549-104"), { code: "CD-2549-104", kind: "card" });
  assert.deepEqual(parseScan("CD-2549-P"), { code: "CD-2549-P", kind: "bag" });
  assert.deepEqual(parseScan("CD-2549-P2"), { code: "CD-2549-P2", kind: "bag" });
  assert.deepEqual(parseScan("CD-2549"), { code: "CD-2549", kind: "order" });
  assert.deepEqual(parseScan("LOC-DONE"), { code: "LOC-DONE", kind: "location" });
  assert.deepEqual(parseScan("LOC-SHIP"), { code: "LOC-SHIP", kind: "location" });
  assert.deepEqual(parseScan("LOC-BOOK-WEIGHTS"), { code: "LOC-BOOK-WEIGHTS", kind: "location" });
  // Serial-numbered slots
  assert.deepEqual(parseScan("HTTPS://THECARDDOC1.COM/Q/LOC-CLAMP-07"), { code: "LOC-CLAMP-07", kind: "location" });
  assert.deepEqual(parseScan("loc-heat-press-03"), { code: "LOC-HEAT-PRESS-03", kind: "location" });
  // A place whose slug is a number is still a place, never an order
  assert.deepEqual(parseScan("LOC-2"), { code: "LOC-2", kind: "location" });
});

test("what a handheld scanner or a person types: case, spaces, #, line endings", () => {
  assert.deepEqual(parseScan("  cd-2549-03\r\n"), { code: "CD-2549-03", kind: "card" });
  assert.deepEqual(parseScan("cd 2549 03"), { code: "CD-2549-03", kind: "card" });
  assert.deepEqual(parseScan("#CD-2549"), { code: "CD-2549", kind: "order" });
  assert.deepEqual(parseScan("cd2549"), { code: "CD-2549", kind: "order" });
  assert.deepEqual(parseScan("loc-humidity-press\t"), { code: "LOC-HUMIDITY-PRESS", kind: "location" });
});

test("not our codes: null", () => {
  for (const raw of [
    "", "   ", null, undefined, "2549", "#2549", "hello", "https://example.com/", "https://example.com/products/42",
    "9400111899223197428490", "CD-2549-03-XY-", "CD--2549", "LOC-", "LOC", "CD-2549-PP",
  ]) {
    assert.equal(parseScan(raw as string | null | undefined), null, String(raw));
  }
});

test("place codes", () => {
  assert.equal(isLocationCode("LOC-HUMIDOR"), true);
  assert.equal(isLocationCode("LOC-SHELF-20261207"), true);
  assert.equal(isLocationCode("CD-2549"), false);
  assert.equal(isLocationCode("LOC-"), false);
  assert.equal(isLocationCode("loc-humidor"), false, "codes are normalized (upper case) first");
});

test("labels", () => {
  assert.deepEqual(["card", "bag", "order", "location", null].map(scanKindLabel), ["Card", "Bag", "Order", "Place", "Code"]);
});

test("the repeat gate: the same code within 2 s is ignored", () => {
  const accept = createScanGate(2000);
  assert.equal(accept("CD-2549-03", 0), true);
  assert.equal(accept("CD-2549-03", 500), false, "same code again at once");
  assert.equal(accept("CD-2549-03", 2400), false, "still in view: every sighting renews the time");
  assert.equal(accept("CD-2549-03", 4500), true, "out of view for 2 s: counts again");
  // Another code fires at once, and two codes in one frame don't fire turn about
  assert.equal(accept("CD-2549-04", 4600), true);
  assert.equal(accept("CD-2549-03", 4700), false);
  assert.equal(accept("CD-2549-04", 4800), false);
  assert.equal(accept("CD-2549-03", 4900), false);
});

test("the gate's key: the code when it parses, the text otherwise", () => {
  assert.equal(scanKey("https://thecarddoc1.com/q/cd-2549-03"), "CD-2549-03");
  assert.equal(scanKey("CD-2549-03"), "CD-2549-03");
  assert.equal(scanKey(" hello "), "HELLO");
});

test("a slot typed by its name", () => {
  assert.equal(slotCodeGuess("clamp 7"), "LOC-CLAMP-07");
  assert.equal(slotCodeGuess("CLAMP 07"), "LOC-CLAMP-07");
  assert.equal(slotCodeGuess("Heat Press 3"), "LOC-HEAT-PRESS-03");
  assert.equal(slotCodeGuess("heat-press-12"), "LOC-HEAT-PRESS-12");
  assert.equal(slotCodeGuess("humidor 104"), "LOC-HUMIDOR-104");
  assert.equal(slotCodeGuess(" done "), "LOC-DONE");
  assert.equal(slotCodeGuess("Ship"), "LOC-SHIP");
  for (const text of ["smith", "2549", "cd 2549", "charizard base set", "", "loc 3"]) assert.equal(slotCodeGuess(text), null, text);
  // A typed place code: the "LOC" in front is dropped, the number padded
  assert.equal(slotCodeGuess("loc-clamp-7"), "LOC-CLAMP-07");
  assert.equal(slotCodeGuess("LOC CLAMP 07"), "LOC-CLAMP-07");
  assert.equal(slotCodeGuess("LOC-DONE"), "LOC-DONE");
  assert.equal(slotCodeGuess("lock 3"), "LOC-LOCK-03", "only a separate LOC word is dropped");
  // Never a Card ID, Bag ID or order code
  for (const text of ["CD-2549-03", "CD 2549 03", "CD-2549-P2", "cd2549", "CD-2549"]) assert.equal(slotCodeGuess(text), null, text);
});

test("typed slot names win over the order-code shape (the code box)", () => {
  // "clamp 7" also parses as an order code CLAMP-7: typed, it is the slot CLAMP 07
  assert.deepEqual(parseScan("clamp 7"), { code: "CLAMP-7", kind: "order" });
  assert.equal(typedSlotGuess("clamp 7"), "LOC-CLAMP-07");
  assert.equal(typedSlotGuess("CLAMP 07"), "LOC-CLAMP-07");
  assert.equal(typedSlotGuess("Humidor 12"), "LOC-HUMIDOR-12");
  assert.equal(typedSlotGuess("heat press 3"), "LOC-HEAT-PRESS-03");
  assert.equal(typedSlotGuess("loc-clamp-7"), "LOC-CLAMP-07", "a place code without the zero");
  assert.equal(typedSlotGuess("done"), "LOC-DONE");
  // Already the right code, or not a slot: parseScan (or a search) decides
  for (const text of [
    "LOC-CLAMP-07", "loc-heat-press-03", "LOC-DONE", "HTTPS://THECARDDOC1.COM/Q/LOC-CLAMP-07", "https://thecarddoc1.com/q/clamp-7",
    "CD-2549", "cd 2549", "CD-2549-03", "CD-2549-P", "CD-2549-P2", "smith", "charizard base set", "",
  ]) {
    assert.equal(typedSlotGuess(text), null, text);
  }
});

test("QR links: lower-case percent-encoding and odd scanner endings", () => {
  assert.deepEqual(parseScan("https://thecarddoc1.com/q/loc%2dclamp%2d07"), { code: "LOC-CLAMP-07", kind: "location" });
  assert.deepEqual(parseScan("HTTPS://THECARDDOC1.COM/Q/LOC-HEAT-PRESS-03\r"), { code: "LOC-HEAT-PRESS-03", kind: "location" });
  assert.deepEqual(parseScan("HTTPS://THECARDDOC1.COM/Q/CD-2549-P2"), { code: "CD-2549-P2", kind: "bag" });
  assert.deepEqual(parseScan("HTTPS://THECARDDOC1.COM/Q/LOC-SHELF-20261207"), { code: "LOC-SHELF-20261207", kind: "location" });
  // A scanned order label, any host
  assert.deepEqual(parseScan("http://192.168.1.20:3000/Q/CD-2549"), { code: "CD-2549", kind: "order" });
});

test("wording: how long ago, where a card is, a slot's line", () => {
  const now = Date.parse("2026-11-24T18:00:00Z");
  assert.equal(sinceText(null, now), null);
  assert.equal(sinceText("2026-11-24T17:59:40Z", now), "just now");
  assert.equal(sinceText("2026-11-24T17:48:00Z", now), "12 min");
  assert.equal(sinceText("2026-11-24T16:00:00Z", now), "2 h");
  assert.equal(sinceText("2026-11-21T18:00:00Z", now), "3 d");
  const slot = { id: "l1", code: "LOC-CLAMP-07", name: "CLAMP 07", kind: "station" as const, station: "clamp", serial: 7, stage: "Clamp Work" };
  assert.equal(whereLine({ location: slot, locatedAt: "2026-11-24T16:00:00Z", stageLabel: "Clamp Work" }, now), "CLAMP 07 · Clamp Work · 2 h");
  assert.equal(whereLine({ location: null, locatedAt: null, stageLabel: "Humidor" }, now), "Not in a slot");
  assert.equal(placeSubtitle({ kind: "station", stationName: "Clamp", stageLabel: "Clamp Work", dueDate: null }), "Clamp · step: Clamp Work");
  assert.equal(placeSubtitle({ kind: "shelf", stationName: null, stageLabel: null, dueDate: "2026-12-07" }), "Shelf for cards due Mon, Dec 7, 2026");
  assert.equal(placeSubtitle({ kind: "done", stationName: null, stageLabel: null, dueDate: null }), "Finished cards");
});

test("wording: how full a slot is", () => {
  assert.equal(roomLeft(1, 0), 1);
  assert.equal(roomLeft(1, 1), 0);
  assert.equal(roomLeft(1, 3), 0);
  assert.equal(roomLeft(null, 50), Infinity);
  assert.equal(fillText(1, 0), "Empty");
  assert.equal(fillText(1, 1), "Full (1 of 1)");
  assert.equal(fillText(1, 2), "Over full (2 of 1)");
  assert.equal(fillText(3, 2), "2 of 3 cards");
  assert.equal(fillText(null, 1), "1 card");
  assert.equal(fillText(null, 4), "4 cards");
  assert.equal(cardsLabel([{ code: "CD-2549-03", name: "Charizard" }]), "CD-2549-03");
  assert.equal(cardsLabel([{ code: null, name: "Charizard" }]), "Charizard");
  assert.equal(cardsLabel([{ code: "A", name: null }, { code: "B", name: null }]), "2 cards");
});

test("desks: typed \"desk\" is LOC-DESK; a named desk by its name; the Desk page link", () => {
  assert.equal(slotCodeGuess("desk"), "LOC-DESK");
  assert.equal(slotCodeGuess(" Desk "), "LOC-DESK");
  assert.equal(slotCodeGuess("desk gavin"), "LOC-DESK-GAVIN");
  assert.equal(slotCodeGuess("DESK-GAVIN"), "LOC-DESK-GAVIN");
  assert.equal(slotCodeGuess("desk gavin's"), "LOC-DESK-GAVIN-S", "as the code is made from the name");
  assert.equal(slotCodeGuess("desk 2"), "LOC-DESK-2", "a desk's number is never padded");
  assert.equal(slotCodeGuess("loc desk"), "LOC-DESK");
  for (const text of ["desks", "desktop", "my desk"]) assert.notEqual(slotCodeGuess(text)?.startsWith("LOC-DESK"), true, text);
  // In the code box: "desk" and "desk 2" (an order code's shape) go to the desk; a typed LOC code is read as it is
  assert.equal(parseScan("desk"), null);
  assert.equal(typedSlotGuess("desk"), "LOC-DESK");
  assert.equal(typedSlotGuess("desk gavin"), "LOC-DESK-GAVIN");
  assert.deepEqual(parseScan("desk 2"), { code: "DESK-2", kind: "order" });
  assert.equal(typedSlotGuess("desk 2"), "LOC-DESK-2");
  assert.equal(typedSlotGuess("LOC-DESK"), null);
  assert.equal(typedSlotGuess("LOC-DESK-GAVIN"), null);
  assert.deepEqual(parseScan("HTTPS://THECARDDOC1.COM/Q/LOC-DESK-GAVIN"), { code: "LOC-DESK-GAVIN", kind: "location" });

  assert.equal(isDeskCode("LOC-DESK"), true);
  assert.equal(isDeskCode("LOC-DESK-GAVIN"), true);
  assert.equal(isDeskCode("LOC-DESK-2"), true);
  for (const code of ["LOC-DESKS", "LOC-DESKTOP", "LOC-PHOTO-DESK", "LOC-DONE", "", null, undefined]) assert.equal(isDeskCode(code), false, String(code));
  assert.equal(deskPagePath("LOC-DESK-GAVIN"), "/admin/receiving/desk?desk=LOC-DESK-GAVIN");
  // The Scan page, Places and the Desk page share one rule (desk-codes.ts): a code read from a QR link or typed in lower case too
  assert.equal(isDeskCode("https://thecarddoc1.com/q/loc-desk-gavin"), true);
  assert.equal(isDeskCode("LOC-DESK-"), false);
  assert.equal(placeSubtitle({ kind: "done", code: "LOC-DESK", stationName: null, stageLabel: null, dueDate: null }), "Finished cards", "only an 'other' place is a desk");
  assert.equal(placeSubtitle({ kind: "other", code: "LOC-DESK", stationName: null, stageLabel: null, dueDate: null }), "Desk · cards keep their step");
  assert.equal(placeSubtitle({ kind: "other", code: "LOC-BACK-TABLE", stationName: null, stageLabel: null, dueDate: null }), "Place");
  // A stack holder with no limit always has room
  assert.equal(fillText(null, 8), "8 cards");
  assert.equal(roomLeft(null, 8) >= 8, true);
});
