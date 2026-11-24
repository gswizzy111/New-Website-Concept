/** The Scan page's code parser and repeat gate (components/intake/scan/parse.ts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createScanGate, isLocationCode, parseScan, scanKey, scanKindLabel } from "@/components/intake/scan/parse";

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
