/**
 * The Scan page's keyboard wedge (components/intake/scan/wedge.ts): the
 * handheld scanner (a Bluetooth keyboard) types a label's text and presses
 * Enter, caught with nothing focused; its keys never reach a focused
 * button, link or select.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ENTER_GAP_MS, KEY_GAP_MS, MIN_LENGTH, newWedge, wedgeKey, type WedgeResult, type WedgeState } from "@/components/intake/scan/wedge";

const LINK = "HTTPS://THECARDDOC1.COM/Q/CD-2549-P";

/** Types `text` from `start` ms, `gap` ms apart; returns the results and the time of the last key. */
function type(w: WedgeState, text: string, start: number, gap: number, opts?: { select?: boolean }): { results: WedgeResult[]; last: number } {
  const results: WedgeResult[] = [];
  let at = start;
  for (const ch of text) {
    results.push(wedgeKey(w, ch, at, opts));
    at += gap;
  }
  return { results, last: at - gap };
}

test("wedge: the limits", () => {
  assert.equal(KEY_GAP_MS, 300);
  assert.equal(ENTER_GAP_MS, 1000);
  assert.equal(MIN_LENGTH, 4);
});

test("wedge: a fast scan + Enter is one scan; from its second key on nothing reaches the focused element", () => {
  const w = newWedge();
  const { results, last } = type(w, LINK, 1000, 5);
  assert.equal(results[0].block, false, "the first key could be a person's");
  assert.ok(results.slice(1).every((r) => r.block && r.scan === null));
  assert.deepEqual(wedgeKey(w, "Enter", last + 5), { scan: LINK, block: true });
  // Tab ends a scan too
  const t = type(w, "CD-2549-03", 5000, 4);
  assert.deepEqual(wedgeKey(w, "Tab", t.last + 4), { scan: "CD-2549-03", block: true });
});

test("wedge: a slow scanner (120 ms a key) still scans", () => {
  const w = newWedge();
  const { last } = type(w, LINK, 0, 120);
  assert.deepEqual(wedgeKey(w, "Enter", last + 120), { scan: LINK, block: true });
});

test("wedge: a 400 ms pause before Enter still sends the whole scan, and the Enter is kept from the focused element", () => {
  const w = newWedge();
  const { last } = type(w, LINK, 0, 8);
  assert.deepEqual(wedgeKey(w, "Enter", last + 400), { scan: LINK, block: true });
  // ... up to 1 s; later, an Enter is a person's
  const late = newWedge();
  const l = type(late, LINK, 0, 8);
  assert.deepEqual(wedgeKey(late, "Enter", l.last + ENTER_GAP_MS + 1), { scan: null, block: false });
});

test("wedge: a pause over 300 ms between characters starts a new scan (a stray key long ago is dropped)", () => {
  const w = newWedge();
  wedgeKey(w, "x", 0);
  const { last } = type(w, LINK, 60_000, 5);
  assert.deepEqual(wedgeKey(w, "Enter", last + 5), { scan: LINK, block: true });
  // Mid-scan, a stall over 300 ms keeps only what came after it
  const s = newWedge();
  const a = type(s, "HTTPS://THECARDDOC1.COM", 0, 5);
  const b = type(s, "/Q/CD-2549-P", a.last + KEY_GAP_MS + 1, 5);
  assert.equal(wedgeKey(s, "Enter", b.last + 5).scan, "/Q/CD-2549-P");
  // ... while 300 ms exactly is still the same scan
  const e = newWedge();
  const c = type(e, "CD-25", 0, 5);
  const d = type(e, "49-P", c.last + KEY_GAP_MS, 5);
  assert.equal(wedgeKey(e, "Enter", d.last + 5).scan, "CD-2549-P");
});

test("wedge: a broken scan (fewer than 4 characters + Enter or Tab) is not a scan, and its end key never reaches the focused element", () => {
  // A focused "Mark done" (or any button) must not be pressed by what's left of a broken read
  for (const [chars, gap] of [["abc", 5], ["Q", 5], ["CD", 40]] as const) {
    const w = newWedge();
    const { last } = type(w, chars, 0, gap);
    assert.deepEqual(wedgeKey(w, "Enter", last + 5), { scan: null, block: true }, `"${chars}" + Enter`);
    const t = newWedge();
    const tl = type(t, chars, 0, gap);
    assert.deepEqual(wedgeKey(t, "Tab", tl.last + 5), { scan: null, block: true }, `"${chars}" + Tab`);
  }
  // ... whatever the buffer length, up to ENTER_GAP_MS after the last character
  const w = newWedge();
  wedgeKey(w, "x", 0);
  assert.deepEqual(wedgeKey(w, "Enter", ENTER_GAP_MS), { scan: null, block: true }, "1 s after a stray key");
  // A lone Enter (no character before it) and an Enter over 1 s after the last key are a person's
  assert.deepEqual(wedgeKey(newWedge(), "Enter", 10_000), { scan: null, block: false }, "a lone Enter");
  const late = newWedge();
  wedgeKey(late, "x", 0);
  assert.deepEqual(wedgeKey(late, "Enter", ENTER_GAP_MS + 1), { scan: null, block: false }, "over 1 s after a stray key");
  // Blocked once: the next Enter (nothing typed since) is a person's again
  const again = newWedge();
  const a = type(again, "ab", 0, 5);
  assert.equal(wedgeKey(again, "Enter", a.last + 5).block, true);
  assert.equal(wedgeKey(again, "Enter", a.last + 400).block, false);
});

test("wedge: a person's Space on a button or tick box, then Tab or Enter, goes through (keyboard use isn't trapped)", () => {
  const w = newWedge();
  assert.deepEqual(wedgeKey(w, " ", 0), { scan: null, block: false }, "the Space presses the focused button");
  assert.deepEqual(wedgeKey(w, "Tab", 120), { scan: null, block: false }, "Tab moves on");
  const e = newWedge();
  wedgeKey(e, " ", 0);
  wedgeKey(e, " ", 150);
  assert.deepEqual(wedgeKey(e, "Enter", 300), { scan: null, block: false }, "Enter after two Spaces");
});

test("wedge: Shift, arrows and Escape are left alone and don't break a scan", () => {
  const w = newWedge();
  let at = 0;
  for (const ch of "CD-2549-P") {
    assert.deepEqual(wedgeKey(w, "Shift", at), { scan: null, block: false });
    wedgeKey(w, ch, at + 1);
    at += 6;
  }
  assert.deepEqual(wedgeKey(w, "ArrowDown", at), { scan: null, block: false });
  assert.equal(wedgeKey(w, "Enter", at + 5).scan, "CD-2549-P");
});

test("wedge: a focused select gets none of the scan's letters (no type-ahead), and the scan still goes through", () => {
  const w = newWedge();
  const { results, last } = type(w, LINK, 0, 5, { select: true });
  assert.ok(results.every((r) => r.block), "every character is kept from the select");
  assert.deepEqual(wedgeKey(w, "Enter", last + 5), { scan: LINK, block: true });
});

test("wedge: a second end key right after a scan's (CR LF, Enter + Tab) is kept from the focused element", () => {
  const w = newWedge();
  const { last } = type(w, LINK, 0, 5);
  assert.equal(wedgeKey(w, "Enter", last + 5).scan, LINK);
  assert.deepEqual(wedgeKey(w, "Enter", last + 15), { scan: null, block: true });
  assert.deepEqual(wedgeKey(w, "Tab", last + 20), { scan: null, block: true });
  // A person's Enter a moment later is theirs
  assert.deepEqual(wedgeKey(w, "Enter", last + 1000), { scan: null, block: false });
});
