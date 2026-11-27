import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Admin dashboard numbers, computed in the database (supabase/migrations/
 * 20261023_dashboard_metrics.sql) so every report reads the whole history
 * (no 1,000-row API limit) and every day is an America/New_York calendar day.
 * - Refunds come from the refund ledger (lib/refund-ledger.ts), dated when the
 *   money went back.
 * - An order made from a show drop-off (linked by show_dropoffs.order_id) is
 *   left out of revenue_series and service_report: no sale, no order, no cards
 *   (its revenue is on the Show Dropoffs tab). Money paid on it later through
 *   Stripe (added cards, a tier upgrade) counts as usual
 *   (supabase/migrations/20261123_dropoff_revenue.sql).
 * - The backlog counts restoration cards we've received and haven't finished
 *   (supabase/migrations/20261127_backlog_restoration_only.sql): cards of paid
 *   orders that are Cards Received or In Progress, not PSA Prep (a mixed order
 *   counts only its restoration cards), not ticked done, not refunded, and here
 *   (not awaiting arrival, and not added after the order arrived without being
 *   received: the intake rule). PSA Prep cards under the same rule are reported
 *   beside it (prep_cards), never in the total.
 * - Prep vs Restoration counts each paid order once, under its own service, on
 *   the day it was paid.
 */

export const BUSINESS_TIME_ZONE = "America/New_York";

/** Today's date in New York as YYYY-MM-DD. */
export function etToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A YYYY-MM-DD date moved by whole days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Oct 23" or "Fri, Oct 23" for a YYYY-MM-DD date. */
export function formatDay(day: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

/** What the backlog counts, in one sentence (the Backlog page and the dashboard tile). */
export const BACKLOG_RULE_TEXT =
  "Backlog: restoration cards we've received and haven't finished (orders Cards Received or In Progress).";

/** The rule a backlog row was computed under: the current one, or null for a database without 20261127. */
export type BacklogRule = "restoration_received";

/** How well a backlog day is known. */
export type BacklogQuality =
  | "live"           // today, as of now
  | "recorded"       // every move logged as it happened
  | "reconstructed"  // rebuilt from order status history
  | "approximate"    // rebuilt; up to 10% of cards may be missing (arrival not logged)
  | "insufficient"   // rebuilt; too many cards with unlogged arrivals to give a number
  | "no_data";       // before the site logged order statuses

export type BacklogDay = {
  day: string;
  total: number;          // restoration cards in the backlog at the end of the day
  orders: number;         // restoration orders with at least one of them (0 before 20261127)
  prep: number;           // of which PSA Prep: always 0 now (kept for the old site, which shows total − prep)
  prep_cards: number;     // PSA Prep cards received and unfinished at the end of the day; NOT in total
  added: number;          // cards received (or added to an order already in, or received after being added later)
  completed: number;      // cards ticked done, or their order completed/shipped/delivered
  reopened: number;       // cards back in after being done
  sent_back: number;      // order moved back to Awaiting Cards
  removed: number;        // order cancelled or deleted, card refunded or deleted
  untracked: number;      // ticked done before tracking began (finish date not recorded)
  recount: number;        // count corrected: card rows entered on an order counted by quantity, or found when tracking began
  unknown_orders: number; // open orders whose card count isn't known
  uncertain: number;      // cards that may be missing from the total
  stale: number;          // cards that may have been finished earlier (order later marked Delivered straight from Received/In Progress)
  quality: BacklogQuality;
  rule: BacklogRule | null;
};

export type ServiceDay = {
  day: string;
  prep_orders: number;
  prep_cards: number;
  prep_cents: number;
  restoration_orders: number;
  restoration_cards: number;
  restoration_cents: number;
  unknown_card_orders: number;
};

export type RevenueDay = {
  day: string;
  sales_cents: number;
  orders: number;
  refund_cents: number;
  pending_refund_cents: number;
  kit_sales_cents: number;
  kit_orders: number;
  kit_refund_cents: number;
};

export type RevenueHour = {
  hour: string; // New York local time, "YYYY-MM-DDTHH:00:00"
  sales_cents: number;
  orders: number;
  refund_cents: number;
  kit_sales_cents: number;
  kit_orders: number;
  kit_refund_cents: number;
};

export type RevenueSeries = {
  today: string;
  now_hour: string;
  daily: RevenueDay[];
  hourly: RevenueHour[];
  refunds_this_month: { count: number; cents: number; pending_cents: number };
};

export const QUALITY_LABEL: Record<BacklogQuality, string> = {
  live: "Live",
  recorded: "Recorded",
  reconstructed: "Rebuilt",
  approximate: "Approximate",
  insufficient: "Insufficient data",
  no_data: "No data",
};

/** Whether a backlog day has a number to show. */
export function backlogKnown(d: BacklogDay): boolean {
  return d.quality !== "no_data" && d.quality !== "insufficient";
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const ruleOf = (v: unknown): BacklogRule | null => (v === "restoration_received" ? v : null);

/** A backlog_report row with every field present (fields added by 20261127 default to 0 / null). */
export function normalizeBacklogDay(row: Partial<Record<keyof BacklogDay, unknown>>): BacklogDay {
  return {
    day: String(row.day ?? ""),
    total: num(row.total),
    orders: num(row.orders),
    prep: num(row.prep),
    prep_cards: num(row.prep_cards),
    added: num(row.added),
    completed: num(row.completed),
    reopened: num(row.reopened),
    sent_back: num(row.sent_back),
    removed: num(row.removed),
    untracked: num(row.untracked),
    recount: num(row.recount),
    unknown_orders: num(row.unknown_orders),
    uncertain: num(row.uncertain),
    stale: num(row.stale),
    quality: (row.quality ?? "no_data") as BacklogQuality,
    rule: ruleOf(row.rule),
  };
}

/** Backlog days from..to (YYYY-MM-DD). Finished days are saved the first time they're computed. */
export async function getBacklogDays(admin: SupabaseClient, from: string, to: string): Promise<BacklogDay[]> {
  const { data, error } = await admin.rpc("backlog_report", { p_from: from, p_to: to });
  if (error) throw new Error(`backlog_report: ${error.message}`);
  return ((data ?? []) as Partial<Record<keyof BacklogDay, unknown>>[]).map(normalizeBacklogDay);
}

export type BacklogNow = {
  total: number;          // restoration cards in the backlog now
  orders: number;         // restoration orders with at least one of them
  unknown_orders: number; // open paid restoration orders entered by hand with no cards or quantity
  prep: number;           // of which PSA Prep: always 0 now (kept for the old site, which shows total − prep)
  prep_cards: number;     // PSA Prep cards received and unfinished in Cards Received / In Progress paid orders; NOT in total
  prep_orders: number;    // orders with at least one of those prep cards
  not_received: number;   // restoration cards on those orders that aren't here yet; NOT in total
  rule: BacklogRule | null;
  as_of: string;
  tracking_start: string | null;
};

/** A backlog_now() result with every field present (fields added by 20261127 default to 0 / null). */
export function normalizeBacklogNow(row: Partial<Record<keyof BacklogNow, unknown>>): BacklogNow {
  return {
    total: num(row.total),
    orders: num(row.orders),
    unknown_orders: num(row.unknown_orders),
    prep: num(row.prep),
    prep_cards: num(row.prep_cards),
    prep_orders: num(row.prep_orders),
    not_received: num(row.not_received),
    rule: ruleOf(row.rule),
    as_of: String(row.as_of ?? new Date().toISOString()),
    tracking_start: row.tracking_start == null ? null : String(row.tracking_start),
  };
}

/** The backlog right now (a quick count; the same rule as today's backlog row). */
export async function getBacklogNow(admin: SupabaseClient): Promise<BacklogNow> {
  const { data, error } = await admin.rpc("backlog_now");
  if (error) throw new Error(`backlog_now: ${error.message}`);
  return normalizeBacklogNow((data ?? {}) as Partial<Record<keyof BacklogNow, unknown>>);
}

export async function getServiceDays(admin: SupabaseClient, from: string, to: string): Promise<ServiceDay[]> {
  const { data, error } = await admin.rpc("service_report", { p_from: from, p_to: to });
  if (error) throw new Error(`service_report: ${error.message}`);
  return (data ?? []) as ServiceDay[];
}

export async function getRevenueSeries(admin: SupabaseClient): Promise<RevenueSeries> {
  const { data, error } = await admin.rpc("revenue_series");
  if (error) throw new Error(`revenue_series: ${error.message}`);
  return data as RevenueSeries;
}

/** What to say about a backlog day beside its quality label: gaps in the data, and moves besides added/completed. */
export function backlogNotes(d: BacklogDay): string[] {
  const notes: string[] = [];
  const cards = (n: number) => `${n} card${n === 1 ? "" : "s"}`;
  if (d.quality === "no_data") notes.push("Order statuses weren't logged yet");
  if (d.quality === "insufficient") notes.push(`Arrival of ${cards(d.uncertain)} wasn't logged, so no total is given`);
  if (d.quality === "approximate" && d.uncertain) notes.push(`Up to ${cards(d.uncertain)} may be missing (arrival not logged)`);
  if (d.stale && d.quality !== "no_data" && d.quality !== "insufficient") {
    notes.push(`${cards(d.stale)} in orders later marked Delivered straight from Cards Received or In Progress may have been finished earlier`);
  }
  if (d.reopened) notes.push(`+${d.reopened} reopened`);
  if (d.sent_back) notes.push(`−${d.sent_back} order sent back to Awaiting Cards`);
  if (d.removed) notes.push(`−${d.removed} cancelled, refunded or deleted`);
  if (d.untracked) notes.push(`−${d.untracked} ticked done before tracking began (finish dates not recorded)`);
  if (d.recount) notes.push(`${d.recount > 0 ? "+" : "−"}${Math.abs(d.recount)} recounted (card count corrected)`);
  if (d.unknown_orders) notes.push(`${d.unknown_orders} open order${d.unknown_orders === 1 ? "" : "s"} with no card count`);
  return notes;
}
