/**
 * Business days in New York: Monday-Friday, not a holiday (business_holidays,
 * editable in the admin). Days are "YYYY-MM-DD" strings, compared as calendar
 * dates (noon UTC, so no time zone can move them). Pure (safe in client
 * components and tests).
 */

export const NY_TIME_ZONE = "America/New_York";

/** The seeded holidays (supabase/migrations/20261123_intake_tracking.sql); the fallback if the table can't be read. */
export const DEFAULT_HOLIDAYS: ReadonlyArray<{ day: string; name: string }> = [
  { day: "2026-01-01", name: "New Year's Day" },
  { day: "2026-05-25", name: "Memorial Day" },
  { day: "2026-07-03", name: "Independence Day (observed)" },
  { day: "2026-09-07", name: "Labor Day" },
  { day: "2026-11-26", name: "Thanksgiving" },
  { day: "2026-12-25", name: "Christmas Day" },
  { day: "2027-01-01", name: "New Year's Day" },
  { day: "2027-05-31", name: "Memorial Day" },
  { day: "2027-07-05", name: "Independence Day (observed)" },
  { day: "2027-09-06", name: "Labor Day" },
  { day: "2027-11-25", name: "Thanksgiving" },
  { day: "2027-12-24", name: "Christmas Day (observed)" },
  { day: "2027-12-31", name: "New Year's Day (observed)" },
  { day: "2028-05-29", name: "Memorial Day" },
  { day: "2028-07-04", name: "Independence Day" },
  { day: "2028-09-04", name: "Labor Day" },
  { day: "2028-11-23", name: "Thanksgiving" },
  { day: "2028-12-25", name: "Christmas Day" },
];

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day written YYYY-MM-DD ("2026-02-30" is not). */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DAY_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function assertDay(day: string): void {
  if (!isDay(day)) throw new Error(`Not a YYYY-MM-DD date: ${day}`);
}

const nyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: NY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** Today in New York (YYYY-MM-DD). */
export function nyToday(now: Date = new Date()): string {
  return nyFormat.format(now);
}

/** The New York day of a timestamp (ISO string or Date); null if it isn't a valid time. */
export function toNyDate(ts: string | Date | null | undefined): string | null {
  if (ts == null || ts === "") return null;
  const d = ts instanceof Date ? ts : new Date(ts);
  return Number.isNaN(d.getTime()) ? null : nyFormat.format(d);
}

/** A day moved by whole calendar days. */
export function addCalendarDays(day: string, n: number): string {
  assertDay(day);
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(day: string): number {
  assertDay(day);
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

export function isWeekend(day: string): boolean {
  const w = weekday(day);
  return w === 0 || w === 6;
}

/** Monday-Friday and not a holiday. */
export function isBusinessDay(day: string, holidays: ReadonlySet<string> = new Set()): boolean {
  return !isWeekend(day) && !holidays.has(day);
}

/**
 * The day `n` business days after `fromDay`. The count starts the business
 * day after `fromDay` (the received day itself never counts, whatever day it
 * is), skips weekends and holidays, and crosses months and years.
 * n = 0 returns fromDay. Received Sun 2026-11-15 + 15 with Thanksgiving
 * (2026-11-26) off = Mon 2026-12-07.
 */
export function addBusinessDays(fromDay: string, n: number, holidays: ReadonlySet<string> = new Set()): string {
  assertDay(fromDay);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Business days must be a whole number >= 0, got ${n}`);
  let day = fromDay;
  for (let left = n; left > 0; ) {
    day = addCalendarDays(day, 1);
    if (isBusinessDay(day, holidays)) left--;
  }
  return day;
}

/**
 * Business days from `from` to `to`: positive when `to` is later (days after
 * `from` up to and including `to`), negative when earlier, 0 on the same day.
 * E.g. due in 3 business days, or overdue by 2 (-2).
 */
export function businessDaysBetween(from: string, to: string, holidays: ReadonlySet<string> = new Set()): number {
  assertDay(from);
  assertDay(to);
  if (from === to) return 0;
  const sign = to > from ? 1 : -1;
  const [a, b] = sign > 0 ? [from, to] : [to, from];
  let count = 0;
  for (let day = addCalendarDays(a, 1); day <= b; day = addCalendarDays(day, 1)) {
    if (isBusinessDay(day, holidays)) count++;
  }
  return sign * count;
}

/** A Set of holiday days from rows like { day: "2026-11-26" }. */
export function holidaySet(rows: ReadonlyArray<{ day: string }>): Set<string> {
  return new Set(rows.map((r) => r.day).filter(isDay));
}
