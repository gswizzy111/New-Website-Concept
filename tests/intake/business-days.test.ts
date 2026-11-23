/** Business days and due dates (lib/intake/business-days.ts, computeDueDate in lib/intake/due-dates.ts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_HOLIDAYS, addBusinessDays, businessDaysBetween, holidaySet, isBusinessDay, isDay, isWeekend, nyToday, toNyDate,
} from "@/lib/intake/business-days";
import { computeDueDate } from "@/lib/intake/due-dates";

const THANKSGIVING = new Set(["2026-11-26"]);
const ALL = holidaySet(DEFAULT_HOLIDAYS);

test("owner's example: received Sun Nov 15 2026, 15 business days, Thanksgiving off -> Mon Dec 7 2026", () => {
  assert.equal(addBusinessDays("2026-11-15", 15, THANKSGIVING), "2026-12-07");
  assert.equal(addBusinessDays("2026-11-15", 15, ALL), "2026-12-07");
  // Without the holiday it would be a day earlier
  assert.equal(addBusinessDays("2026-11-15", 15), "2026-12-04");
});

test("the received day itself never counts; n = 0 is the received day", () => {
  assert.equal(addBusinessDays("2026-11-16", 1), "2026-11-17"); // Mon -> Tue
  assert.equal(addBusinessDays("2026-11-20", 1), "2026-11-23"); // Fri -> Mon
  assert.equal(addBusinessDays("2026-11-16", 0), "2026-11-16");
});

test("received on a weekend or a holiday counts from the next business day", () => {
  assert.equal(addBusinessDays("2026-11-21", 1), "2026-11-23"); // Sat -> Mon
  assert.equal(addBusinessDays("2026-11-22", 1), "2026-11-23"); // Sun -> Mon
  assert.equal(addBusinessDays("2026-11-26", 1, THANKSGIVING), "2026-11-27"); // Thanksgiving -> Fri
  assert.equal(addBusinessDays("2026-11-25", 1, THANKSGIVING), "2026-11-27"); // Wed -> skips Thu
});

test("crosses months and years, skipping New Year's Day", () => {
  assert.equal(addBusinessDays("2026-01-29", 3), "2026-02-03"); // Thu -> Tue
  assert.equal(addBusinessDays("2026-02-27", 1), "2026-03-02"); // Fri -> Mon (non-leap February)
  assert.equal(addBusinessDays("2026-12-30", 3, ALL), "2027-01-05"); // Dec 31, (Jan 1 off), Jan 4, Jan 5
  assert.equal(addBusinessDays("2026-12-23", 2, ALL), "2026-12-28"); // Dec 24, (Christmas off), Dec 28
  assert.equal(addBusinessDays("2027-12-22", 3, ALL), "2027-12-28"); // Dec 23, (Dec 24 observed Christmas off), Dec 27, Dec 28
  assert.equal(addBusinessDays("2027-12-29", 3, ALL), "2028-01-04"); // Dec 30, (Dec 31 observed New Year's off), Jan 3, Jan 4
});

test("Bronze 60 business days spans months and holidays", () => {
  const due = addBusinessDays("2026-11-15", 60, ALL);
  assert.equal(businessDaysBetween("2026-11-15", due, ALL), 60);
  assert.ok(isBusinessDay(due, ALL));
});

test("businessDaysBetween is signed and skips weekends and holidays", () => {
  assert.equal(businessDaysBetween("2026-11-15", "2026-12-07", THANKSGIVING), 15);
  assert.equal(businessDaysBetween("2026-12-07", "2026-11-15", THANKSGIVING), -15);
  assert.equal(businessDaysBetween("2026-11-23", "2026-11-23"), 0);
  assert.equal(businessDaysBetween("2026-11-20", "2026-11-23"), 1); // Fri -> Mon
});

test("day helpers", () => {
  assert.ok(isDay("2026-02-28"));
  assert.ok(!isDay("2026-02-30"));
  assert.ok(!isDay("2026-2-3"));
  assert.ok(!isDay(null));
  assert.ok(isWeekend("2026-11-21") && isWeekend("2026-11-22") && !isWeekend("2026-11-23"));
  assert.throws(() => addBusinessDays("2026-13-01", 1));
  assert.throws(() => addBusinessDays("2026-11-16", -1));
  // New York day of a timestamp: 03:00 UTC on Nov 16 is still Nov 15 in New York
  assert.equal(toNyDate("2026-11-16T03:00:00Z"), "2026-11-15");
  assert.equal(toNyDate("2026-11-16T06:00:00Z"), "2026-11-16");
  assert.equal(toNyDate("not a date"), null);
  assert.equal(nyToday(new Date("2026-07-04T02:00:00Z")), "2026-07-03"); // EDT
});

test("the seeded holidays are weekdays and match the migration's seed", () => {
  for (const h of DEFAULT_HOLIDAYS) assert.ok(!isWeekend(h.day), `${h.day} ${h.name} falls on a weekend`);
  const sql = readFileSync("supabase/migrations/20261123_intake_tracking.sql", "utf8");
  const seeded = [...sql.matchAll(/\('(\d{4}-\d{2}-\d{2})', '((?:[^']|'')+)'\)/g)].map((m) => ({ day: m[1], name: m[2].replace(/''/g, "'") }));
  assert.deepEqual(seeded, [...DEFAULT_HOLIDAYS]);
});

test("computeDueDate: calculated, needs review, missing received date, historical", () => {
  assert.deepEqual(computeDueDate({ receivedOn: "2026-11-15", turnaroundDays: 15, holidays: THANKSGIVING }),
    { due_date: "2026-12-07", due_status: "calculated", turnaround_days: 15 });
  assert.deepEqual(computeDueDate({ receivedOn: "2026-11-15", turnaroundDays: null, holidays: THANKSGIVING }),
    { due_date: null, due_status: "needs_review", turnaround_days: null });
  assert.deepEqual(computeDueDate({ receivedOn: null, turnaroundDays: 15, holidays: THANKSGIVING }),
    { due_date: null, due_status: "missing_received_date", turnaround_days: 15 });
  assert.deepEqual(computeDueDate({ receivedOn: "2026-11-15", turnaroundDays: 15, holidays: THANKSGIVING, historical: true }),
    { due_date: "2026-12-07", due_status: "needs_review", turnaround_days: 15 });
});
