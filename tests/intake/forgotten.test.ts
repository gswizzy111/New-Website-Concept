/** Forgotten-card rules and the ship check (components/intake/ship/rules.ts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FINAL_DRY_DAYS, SLOT_DAYS, STALE_DAYS, ago, allCardsOk, bagPastDue, countsForBadge, daysSince, finalDryReadBefore, finalDrySince,
  forgottenReasons, inNewSystem, isSlot, lastSeenText, latest, primaryRule, readyToShip, reasonText, shipCheckStatus,
  shipCounts, type ForgottenCardFacts,
} from "@/components/intake/ship/rules";
import { INTAKE_START } from "@/lib/intake/start";

const NOW = Date.parse("2026-12-10T15:00:00Z");
const daysAgo = (n: number, hours = 0) => new Date(NOW - n * 86_400_000 - hours * 3_600_000).toISOString();

const CLAMP = { kind: "station", stage: "Clamp Work" };
const FINAL_DRY_SLOT = { kind: "station", stage: "Final Dry" };
const DONE_PLACE = { kind: "done", stage: null };
const SHELF = { kind: "shelf", stage: null };

/** A received card of an in-progress, new-system order, touched an hour ago. */
function card(over: Partial<ForgottenCardFacts> = {}): ForgottenCardFacts {
  return {
    orderStatus: "in_progress",
    orderCreatedAt: "2026-11-25T12:00:00Z",
    inBag: true,
    bagSource: "receiving",
    done: false,
    refunded: false,
    awaiting: false,
    stage: "Humidor",
    stageSince: daysAgo(0, 1),
    lastStageActivityAt: daysAgo(0, 1),
    lastMoveAt: null,
    location: null,
    locatedAt: null,
    ...over,
  };
}
const rules = (f: ForgottenCardFacts, slotDays?: number) => forgottenReasons(f, NOW, slotDays).map((r) => r.rule);

// ── helpers ────────────────────────────────────────────────────────────────

test("daysSince, ago and latest", () => {
  assert.equal(daysSince(daysAgo(3), NOW), 3);
  // New York calendar days (NOW is 10 a.m. Dec 10 in New York)
  assert.equal(daysSince("2026-12-08T05:00:00Z", NOW), 2, "midnight Dec 8 New York");
  assert.equal(daysSince("2026-12-08T04:59:00Z", NOW), 3, "11:59 p.m. Dec 7 New York");
  assert.equal(daysSince(daysAgo(2, 23), NOW), 3, "Dec 7, 11 a.m. New York: 3 days though under 72 hours");
  assert.equal(daysSince("2026-12-10T05:00:00Z", NOW), 0, "earlier today");
  assert.equal(daysSince("2026-12-10T04:59:00Z", NOW), 1, "late yesterday");
  assert.equal(daysSince(null, NOW), 0);
  assert.equal(daysSince(new Date(NOW + 86_400_000).toISOString(), NOW), 0, "the future counts as 0");
  assert.equal(ago(new Date(NOW - 20_000).toISOString(), NOW), "just now");
  assert.equal(ago(new Date(NOW - 5 * 60_000).toISOString(), NOW), "5 min ago");
  assert.equal(ago(daysAgo(0, 2), NOW), "2 h ago");
  assert.equal(ago(daysAgo(1), NOW), "1 day ago");
  assert.equal(ago(daysAgo(12), NOW), "12 days ago");
  assert.equal(ago(null, NOW), "");
  assert.equal(latest(daysAgo(3), null, daysAgo(1), "not a time"), daysAgo(1));
  assert.equal(latest(null, undefined), null);
});

test("a slot is a work-station place; Done, Shipping and shelves are not", () => {
  assert.equal(isSlot({ kind: "station" }), true);
  for (const kind of ["done", "shipping", "shelf", "other"]) assert.equal(isSlot({ kind }), false, kind);
  assert.equal(isSlot(null), false);
});

test("last seen: the slot and how long ago, else the slot it came out of, else not in a slot", () => {
  assert.equal(lastSeenText({ name: "CLAMP 07" }, daysAgo(2), null, NOW), "CLAMP 07, 2 days ago");
  assert.equal(lastSeenText({ name: "CLAMP 07" }, null, null, NOW), "CLAMP 07");
  assert.equal(lastSeenText(null, null, { from: "HEAT PRESS 03", at: daysAgo(0, 3) }, NOW), "Out of HEAT PRESS 03, 3 h ago");
  assert.equal(lastSeenText(null, null, { from: null, at: daysAgo(1) }, NOW), "Not in a slot");
  assert.equal(lastSeenText(null, null, null, NOW), "Not in a slot");
});

// ── scope ──────────────────────────────────────────────────────────────────

test("new system: a bagged card, or an order created since Receiving went live", () => {
  assert.equal(inNewSystem({ inBag: true, orderCreatedAt: "2025-01-01T00:00:00Z" }), true);
  assert.equal(inNewSystem({ inBag: false, orderCreatedAt: INTAKE_START }), true);
  assert.equal(inNewSystem({ inBag: false, orderCreatedAt: "2026-11-23T17:59:59Z" }), false);
  assert.equal(inNewSystem({ inBag: false, orderCreatedAt: null }), false);
});

// ── (a) finished order, card not done ──────────────────────────────────────

test("(a) a finished order's card that isn't done", () => {
  for (const status of ["completed", "shipped_back", "delivered"]) {
    assert.deepEqual(rules(card({ orderStatus: status })), ["finished_not_done"], status);
  }
  assert.deepEqual(rules(card({ orderStatus: "completed", done: true })), []);
  assert.deepEqual(rules(card({ orderStatus: "completed", refunded: true })), [], "refunded");
  assert.deepEqual(rules(card({ orderStatus: "completed", awaiting: true })), [], "never arrived");
  assert.deepEqual(rules(card({ orderStatus: "completed", bagSource: "migration" })), [], "Historical Order Setup bag");
  assert.deepEqual(rules(card({ orderStatus: "cancelled" })), [], "cancelled");
});

// ── (b) Final Dry ──────────────────────────────────────────────────────────

test("(b) at Final Dry for 3+ days by step", () => {
  assert.equal(FINAL_DRY_DAYS, 3);
  const r = forgottenReasons(card({ stage: "Final Dry", stageSince: daysAgo(5) }), NOW);
  assert.equal(r[0].rule, "final_dry");
  assert.equal(r[0].days, 5);
  assert.equal(r[0].since, daysAgo(5));
  assert.deepEqual(rules(card({ stage: "Final Dry", stageSince: "2026-12-08T05:00:00Z" })), [], "since Dec 8 New York: 2 days");
  assert.deepEqual(rules(card({ stage: "Final Dry", stageSince: "2026-12-08T04:59:00Z" })), ["final_dry"], "since Dec 7 New York: 3 days");
  assert.deepEqual(rules(card({ stage: "Final Dry", stageSince: daysAgo(3) })), ["final_dry"], "exactly 3 days");
  assert.deepEqual(rules(card({ stage: "Heat Press", stageSince: daysAgo(5) })), [], "another step");
});

test("(b) in a Final Dry slot or on the Done place for 3+ days, whichever is earlier", () => {
  assert.deepEqual(rules(card({ stage: "Book", location: FINAL_DRY_SLOT, locatedAt: daysAgo(3, 1) }))[0], "final_dry");
  assert.deepEqual(rules(card({ location: DONE_PLACE, locatedAt: daysAgo(4) })), ["final_dry"]);
  assert.deepEqual(rules(card({ location: FINAL_DRY_SLOT, locatedAt: daysAgo(1) })), [], "only a day");
  const f = card({ stage: "Final Dry", stageSince: daysAgo(6), location: FINAL_DRY_SLOT, locatedAt: daysAgo(4) });
  assert.equal(finalDrySince(f, NOW), daysAgo(6));
  assert.equal(forgottenReasons(f, NOW)[0].days, 6);
});

test("(b) the badge's database read never misses a card the rule flags (New York days, DST weeks too)", () => {
  // Any time 3+ New York days old must be <= the read cutoff
  for (const nowIso of ["2026-12-10T15:00:00Z", "2026-11-03T04:30:00Z", "2026-11-02T04:59:00Z", "2027-03-16T04:10:00Z", "2027-03-15T23:00:00Z"]) {
    const now = Date.parse(nowIso);
    const readBefore = Date.parse(finalDryReadBefore(now));
    for (let t = now - 5 * 86_400_000; t <= now; t += 15 * 60_000) {
      const iso = new Date(t).toISOString();
      if (daysSince(iso, now) >= FINAL_DRY_DAYS) assert.ok(t <= readBefore, `${iso} at ${nowIso}`);
    }
  }
});

test("(b) never for a done card or a finished order (that is (a))", () => {
  assert.deepEqual(rules(card({ done: true, stage: null, location: DONE_PLACE, locatedAt: daysAgo(9) })), []);
  assert.deepEqual(rules(card({ orderStatus: "completed", stage: "Final Dry", stageSince: daysAgo(9) })), ["finished_not_done"]);
});

// ── (e) same slot for N days ───────────────────────────────────────────────

test("(e) in the same slot for N+ days with no move (default 3)", () => {
  assert.equal(SLOT_DAYS, 3);
  const f = card({ stage: "Clamp Work", stageSince: daysAgo(4), location: CLAMP, locatedAt: daysAgo(4) });
  const r = forgottenReasons(f, NOW);
  assert.equal(r[0].rule, "slot_idle");
  assert.equal(r[0].days, 4);
  assert.deepEqual(rules(f, 5), [], "the report's 5-day setting");
  assert.deepEqual(rules(card({ location: CLAMP, locatedAt: daysAgo(2) })), [], "2 days");
  assert.deepEqual(rules(card({ location: SHELF, locatedAt: daysAgo(10) })), [], "a shelf isn't a slot");
});

test("(e) a later move resets the clock", () => {
  assert.deepEqual(rules(card({ location: CLAMP, locatedAt: daysAgo(6), lastMoveAt: daysAgo(1) })), []);
});

test("(e) a done card still in a slot is flagged (it may have been left behind)", () => {
  const f = card({ done: true, stage: null, location: CLAMP, locatedAt: daysAgo(5) });
  assert.deepEqual(rules(f), ["slot_idle"]);
  assert.deepEqual(rules({ ...f, orderStatus: "shipped_back" }), ["slot_idle"], "even after the order shipped");
  assert.deepEqual(rules({ ...f, refunded: true }), [], "refunded");
});

test("a Final Dry slot past 3 days is (b) first, (e) as well", () => {
  assert.deepEqual(rules(card({ stage: "Final Dry", stageSince: daysAgo(4), location: FINAL_DRY_SLOT, locatedAt: daysAgo(4) })), ["final_dry", "slot_idle"]);
});

// ── (c) untouched for 14 days ──────────────────────────────────────────────

test("(c) an open order's card with no step change or move for 14+ days", () => {
  assert.equal(STALE_DAYS, 14);
  const f = card({ stage: "Humidor", stageSince: daysAgo(15), lastStageActivityAt: daysAgo(15) });
  const r = forgottenReasons(f, NOW);
  assert.deepEqual(r.map((x) => x.rule), ["stale"]);
  assert.equal(r[0].days, 15);
  assert.deepEqual(rules({ ...f, lastMoveAt: daysAgo(2) }), [], "a recent move");
  assert.deepEqual(rules({ ...f, lastStageActivityAt: daysAgo(13) }), [], "13 days");
  assert.deepEqual(rules({ ...f, orderStatus: "awaiting_cards" }), [], "order not in the shop");
});

test("(c) nothing ever happened: counts from the order's creation", () => {
  const f = card({ stage: null, stageSince: null, lastStageActivityAt: null, orderCreatedAt: daysAgo(20) });
  assert.deepEqual(rules(f), ["stale"]);
  assert.deepEqual(rules({ ...f, orderCreatedAt: daysAgo(3) }), []);
});

test("(c) in a slot a long time is (e) first, (c) as well", () => {
  const f = card({ stage: "Clamp Work", stageSince: daysAgo(20), lastStageActivityAt: daysAgo(20), location: CLAMP, locatedAt: daysAgo(20) });
  assert.deepEqual(rules(f), ["slot_idle", "stale"]);
});

// ── primary rule and badge ─────────────────────────────────────────────────

test("listed once under the first rule; the badge counts (a) and (b) only", () => {
  assert.equal(primaryRule(card(), NOW), null);
  assert.equal(primaryRule(card({ orderStatus: "delivered" }), NOW), "finished_not_done");
  assert.equal(primaryRule(card({ stage: "Final Dry", stageSince: daysAgo(4), location: FINAL_DRY_SLOT, locatedAt: daysAgo(4) }), NOW), "final_dry");
  assert.equal(countsForBadge("finished_not_done"), true);
  assert.equal(countsForBadge("final_dry"), true);
  assert.equal(countsForBadge("slot_idle"), false);
  assert.equal(countsForBadge("stale"), false);
  assert.equal(countsForBadge(null), false);
});

test("reason texts", () => {
  assert.equal(reasonText({ rule: "finished_not_done", days: 0, since: null }, { orderStatusLabel: "Completed" }), "Order is Completed, card not marked done");
  assert.match(reasonText({ rule: "final_dry", days: 5, since: daysAgo(5) }, { orderStatusLabel: "In Progress" }), /Final Dry .* 5 days, not marked done/);
  assert.equal(reasonText({ rule: "slot_idle", days: 1, since: daysAgo(1) }, { orderStatusLabel: "x", placeName: "CLAMP 07" }), "In CLAMP 07 for 1 day with no move");
  assert.equal(
    reasonText({ rule: "slot_idle", days: 4, since: daysAgo(4) }, { orderStatusLabel: "x", placeName: "CLAMP 07", done: true }),
    "In CLAMP 07 for 4 days with no move (marked done, still in the slot)",
  );
  assert.equal(reasonText({ rule: "stale", days: 16, since: daysAgo(16) }, { orderStatusLabel: "x" }), "No slot move or step change for 16 days");
});

// ── (d) bags past due ──────────────────────────────────────────────────────

test("(d) a bag past its due date with cards not done", () => {
  assert.equal(bagPastDue({ dueDate: "2026-12-07", orderStatus: "in_progress", openCards: 2 }, "2026-12-10"), 3);
  assert.equal(bagPastDue({ dueDate: "2026-12-10", orderStatus: "in_progress", openCards: 2 }, "2026-12-10"), null, "due today");
  assert.equal(bagPastDue({ dueDate: "2026-12-07", orderStatus: "in_progress", openCards: 0 }, "2026-12-10"), null, "all done");
  assert.equal(bagPastDue({ dueDate: null, orderStatus: "received", openCards: 2 }, "2026-12-10"), null, "no due date");
  assert.equal(bagPastDue({ dueDate: "2026-12-07", orderStatus: "completed", openCards: 1 }, "2026-12-10"), null, "finished order is (a)");
  assert.equal(bagPastDue({ dueDate: "2026-12-07", orderStatus: "cancelled", openCards: 1 }, "2026-12-10"), null);
  assert.equal(bagPastDue({ dueDate: "2026-11-30", orderStatus: "received", openCards: 1 }, "2026-12-01"), 1, "across a month");
});

// ── ship check ─────────────────────────────────────────────────────────────

test("ship check status: refunded > never arrived > not done > still in a slot > ok", () => {
  const base = { refunded: false, done: true, awaiting: false, inSlot: false };
  assert.equal(shipCheckStatus(base), "ok");
  assert.equal(shipCheckStatus({ ...base, inSlot: true }), "in_slot");
  assert.equal(shipCheckStatus({ ...base, done: false }), "not_done");
  assert.equal(shipCheckStatus({ ...base, done: false, inSlot: true }), "not_done");
  assert.equal(shipCheckStatus({ ...base, done: false, awaiting: true }), "not_received");
  assert.equal(shipCheckStatus({ ...base, refunded: true, inSlot: true }), "refunded");
});

test("ship check: ready once every card is ok and ticked in the box", () => {
  const rows = [
    { id: "a", status: "ok" as const },
    { id: "b", status: "ok" as const },
    { id: "r", status: "refunded" as const },
    { id: "n", status: "not_received" as const },
  ];
  assert.deepEqual(shipCounts(rows.map((r) => r.status)), { ok: 2, notDone: 0, inSlot: 0, refunded: 1, notReceived: 1 });
  assert.equal(allCardsOk(rows.map((r) => r.status)), true);
  assert.equal(readyToShip(rows, { a: true }), false, "b not ticked");
  assert.equal(readyToShip(rows, { a: true, b: true }), true, "refunded / never arrived don't block");
  assert.equal(readyToShip([...rows, { id: "c", status: "in_slot" }], { a: true, b: true, c: true }), false, "still in a slot");
  assert.equal(readyToShip([...rows, { id: "d", status: "not_done" }], { a: true, b: true, d: true }), false, "not done");
  assert.equal(readyToShip([{ id: "r", status: "refunded" }], {}), false, "nothing to ship");
});
