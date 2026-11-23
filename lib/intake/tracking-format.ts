import { isDay, nyToday } from "@/lib/intake/business-days";

// Dates on the tracking pages (card, bag, completed). Stored days
// ('YYYY-MM-DD': received_on, due_date) are calendar days and are shown as
// they are; timestamps are shown in New York time, like the rest of the admin.

/** "Mon, Dec 7, 2026" for a stored day ('2026-12-07'); "—" when missing. */
export function dayText(day: string | null | undefined, weekday = true): string {
  if (!isDay(day)) return "—";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    ...(weekday ? { weekday: "short" as const } : {}),
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Nov 23, 2026, 4:12 PM" in New York time; "—" when missing. */
export function nyDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Nov 23, 2026" in New York time; "—" when missing. */
export function nyDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });
}

/** Whole calendar days from today (New York) to `day`: negative when past. */
export function daysUntil(day: string | null | undefined): number | null {
  if (!isDay(day)) return null;
  const ms = Date.parse(`${day}T00:00:00Z`) - Date.parse(`${nyToday()}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** "Due today", "Due in 3 days", "2 days overdue". */
export function dueHint(day: string | null | undefined): string | null {
  const n = daysUntil(day);
  if (n === null) return null;
  if (n === 0) return "Due today";
  if (n > 0) return `Due in ${n} day${n === 1 ? "" : "s"}`;
  return `${-n} day${n === -1 ? "" : "s"} overdue`;
}
