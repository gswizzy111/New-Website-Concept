import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { BUSINESS_TIME_ZONE, addDays, etToday } from "@/lib/dashboard-metrics";
import { getLiveTiers } from "@/lib/live-tiers";

/**
 * What the Tax, Sales Statement and P&L reports read, counted the way the
 * dashboard counts (revenue_series in supabase/migrations/20261023_dashboard_metrics.sql):
 * - Days, months, quarters and years are America/New_York calendar periods.
 * - A service order (restoration or PSA Prep) is a sale once it is paid: payment
 *   status paid or refunded, status not Awaiting Payment. It is dated when it was
 *   paid (its first "payment_received" event, else when it was created). Money
 *   paid later on the same order (added cards, a tier upgrade) is a sale of its
 *   own, on the day it was paid.
 * - A kit order is a sale on the day it was placed (kit orders are saved once paid).
 * - Refunds come from the refund ledger (lib/refund-ledger.ts), dated when the
 *   money went back. Succeeded, pending and requires-action refunds count; failed
 *   and canceled ones don't. A sale keeps its full amount; each refund is its own
 *   negative entry in the period it was made.
 * - Gift card purchases aren't sales in these reports (the card counts when it is
 *   spent on an order), so refunds of them (ledger kind "other") are left out too.
 * Every read is paged (lib/fetch-all.ts), so no report stops at 1,000 rows.
 */

// ── New York periods ─────────────────────────────────────────────────────────

/** [start, end): null means unbounded. */
export type Range = { start: Date | null; end: Date | null };

const NY_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE, hourCycle: "h23",
  year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
});

/** New York's offset from UTC at an instant, in ms (e.g. -4h in summer). */
function nyOffsetMs(t: number): number {
  const p = Object.fromEntries(NY_PARTS.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** The instant a New York calendar day (YYYY-MM-DD) starts. */
export function etDayStart(day: string): Date {
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  let t = utcMidnight - nyOffsetMs(utcMidnight);
  t = utcMidnight - nyOffsetMs(t); // the offset at New York midnight itself
  return new Date(t);
}

/** The New York calendar day (YYYY-MM-DD) of an instant. */
export function etDateOf(t: string | Date): string {
  return etToday(new Date(t));
}

/** New York days `from` to `to`, both included. */
export function dayRange(from: string, to: string): Range {
  return { start: etDayStart(from), end: etDayStart(addDays(to, 1)) };
}

/** YYYY-MM-DD for the first of a month (month0 is 0-11; it may run past the year). */
export function monthStartDay(year: number, month0: number): string {
  const d = new Date(Date.UTC(year, month0, 1));
  return d.toISOString().slice(0, 10);
}

export function inRange(t: string | null | undefined, r: Range): boolean {
  if (!t) return false;
  const ms = new Date(t).getTime();
  return (!r.start || ms >= r.start.getTime()) && (!r.end || ms < r.end.getTime());
}

/** "Oct 26, 2026" in New York time. */
export function etDateLabel(t: string | Date, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string {
  return new Date(t).toLocaleDateString("en-US", { ...opts, timeZone: BUSINESS_TIME_ZONE });
}

// ── Rows ─────────────────────────────────────────────────────────────────────

const ORDER_COLUMNS = "id, order_number, created_at, customer_name, customer_email, ship_from_address, restoration_tier, subtotal_cents, discount_cents, gift_card_discount_cents, shipping_cents, total_cents, refunded_cents, payment_status, status, affiliate_code, loyalty_discount_percent";
const KIT_COLUMNS = "id, order_number, created_at, customer_name, customer_email, shipping_address, items, subtotal_cents, shipping_cents, total_cents, refunded_cents, status";

type Address = Record<string, string | null> | null;

export type ReportOrder = {
  id: string;
  order_number: number | string;
  created_at: string;
  customer_name: string | null;
  customer_email: string | null;
  ship_from_address: Address;
  restoration_tier: string | null;
  subtotal_cents: number | null;
  discount_cents: number | null;
  gift_card_discount_cents: number | null;
  shipping_cents: number | null;
  total_cents: number | null;
  refunded_cents: number | null;
  payment_status: string | null;
  status: string;
  affiliate_code: string | null;
  loyalty_discount_percent: number | null;
};

export type ReportKit = {
  id: string;
  order_number: number | null;
  created_at: string;
  customer_name: string | null;
  customer_email: string | null;
  shipping_address: Address;
  items: unknown;
  subtotal_cents: number | null;
  shipping_cents: number | null;
  total_cents: number | null;
  refunded_cents: number | null;
  status: string | null;
};

/** One payment on a service order: the order itself, or money added to it later. */
export type ServiceSale = {
  type: "order" | "cards_added" | "tier_upgraded";
  at: string;
  order: ReportOrder;
  /** This payment's part of the order (the order's own figures less later payments). */
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
};

export type ReportRefund = {
  id: string;
  at: string;
  amount_cents: number;
  pending: boolean;
  /** Service (restoration, prep, or no order found) or kit (kit order, Kit Club). */
  kind: "service" | "kit";
  order: ReportOrder | null;
  kit: ReportKit | null;
};

export type ReportData = { sales: ServiceSale[]; kits: ReportKit[]; refunds: ReportRefund[] };

// A payment lands within a day of its order (Checkout sessions expire after 24 hours,
// and Stripe retries the webhook for 3 days), so orders are read from this long before.
const PAYMENT_SLACK_MS = 4 * 86_400_000;
const ADDON_TAX_RATE = 0.06625;
const PAID = ["paid", "refunded"];
const COUNTED_REFUNDS = ["succeeded", "pending", "requires_action"];

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Rows by id, read in chunks so the request URL stays short. */
async function byIds<T extends { id: string }>(admin: SupabaseClient, table: string, columns: string, ids: string[]): Promise<Map<string, T>> {
  const map = new Map<string, T>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await admin.from(table).select(columns).in("id", unique.slice(i, i + 100));
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const row of (data ?? []) as unknown as T[]) map.set(row.id, row);
  }
  return map;
}

/** The amount in an add-on event ("... additional payment of $12.34 received"), as the dashboard reads it. */
function addonCents(description: string | null): number {
  const m = description?.match(/\$([0-9,]+\.[0-9]{2})/);
  return m ? Math.round(parseFloat(m[1].replace(/,/g, "")) * 100) : 0;
}

/** Sales and refunds in a range. `kits: false` skips kit orders and their refunds. */
export async function loadReport(admin: SupabaseClient, range: Range, { kits: withKits = true } = {}): Promise<ReportData> {
  const from = range.start ? new Date(range.start.getTime() - PAYMENT_SLACK_MS).toISOString() : null;
  const to = range.end?.toISOString() ?? null;
  const eventsTo = range.end ? new Date(range.end.getTime() + PAYMENT_SLACK_MS).toISOString() : null;

  type PaidEvent = { id: string; order_id: string; created_at: string };
  type AddonEvent = PaidEvent & { event_type: "cards_added" | "tier_upgraded"; description: string | null };
  type LedgerRow = { id: string; amount_cents: number; status: string; refunded_at: string; order_id: string | null; shop_order_id: string | null; kind: string };

  const [orders, paidEvents, addonEvents, kits, ledger] = await Promise.all([
    fetchAll<ReportOrder>((a, b) => {
      let q = admin.from("orders").select(ORDER_COLUMNS).in("payment_status", PAID).neq("status", "awaiting_payment");
      if (from) q = q.gte("created_at", from);
      if (to) q = q.lt("created_at", to);
      return q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(a, b) as unknown as Page<ReportOrder>;
    }),
    fetchAll<PaidEvent>((a, b) => {
      let q = admin.from("order_events").select("id, order_id, created_at").eq("event_type", "payment_received");
      if (from) q = q.gte("created_at", from);
      if (eventsTo) q = q.lt("created_at", eventsTo);
      return q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(a, b);
    }),
    // Every add-on payment: each order's own figures include them
    fetchAll<AddonEvent>((a, b) => admin.from("order_events").select("id, order_id, created_at, event_type, description")
      .in("event_type", ["cards_added", "tier_upgraded"])
      .order("created_at", { ascending: true }).order("id", { ascending: true }).range(a, b)),
    withKits
      ? fetchAll<ReportKit>((a, b) => {
          let q = admin.from("shop_orders").select(KIT_COLUMNS);
          if (range.start) q = q.gte("created_at", range.start.toISOString());
          if (to) q = q.lt("created_at", to);
          return q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(a, b) as unknown as Page<ReportKit>;
        })
      : Promise.resolve([] as ReportKit[]),
    fetchAll<LedgerRow>((a, b) => {
      let q = admin.from("refunds").select("id, amount_cents, status, refunded_at, order_id, shop_order_id, kind")
        .in("status", COUNTED_REFUNDS).neq("kind", "other");
      if (!withKits) q = q.not("kind", "in", "(kit,kit_club)");
      if (range.start) q = q.gte("refunded_at", range.start.toISOString());
      if (to) q = q.lt("refunded_at", to);
      return q.order("refunded_at", { ascending: true }).order("id", { ascending: true }).range(a, b);
    }),
  ]);

  // When each order was paid: its first payment event, else when it was created
  const paidAt = new Map<string, string>();
  for (const e of paidEvents) if (e.created_at && !paidAt.has(e.order_id)) paidAt.set(e.order_id, e.created_at);

  const addonsByOrder = new Map<string, { cents: number; subtotal: number }>();
  for (const e of addonEvents) {
    const cents = addonCents(e.description);
    const sum = addonsByOrder.get(e.order_id) ?? { cents: 0, subtotal: 0 };
    sum.cents += cents;
    // Added cards and upgrades are taxed and carry no shipping
    sum.subtotal += Math.round(cents / (1 + ADDON_TAX_RATE));
    addonsByOrder.set(e.order_id, sum);
  }

  const orderById = new Map(orders.map((o) => [o.id, o]));
  const addonsInRange = addonEvents.filter((e) => e.order_id && inRange(e.created_at, range));
  const ledgerOrderIds = ledger.map((r) => r.order_id).filter((v): v is string => !!v);
  const missingOrders = [...addonsInRange.map((e) => e.order_id), ...ledgerOrderIds].filter((id) => !orderById.has(id));
  const kitById = new Map(kits.map((k) => [k.id, k]));
  const missingKits = ledger.map((r) => r.shop_order_id).filter((id): id is string => !!id && !kitById.has(id));
  const [extraOrders, extraKits] = await Promise.all([
    missingOrders.length ? byIds<ReportOrder>(admin, "orders", ORDER_COLUMNS, missingOrders) : Promise.resolve(new Map<string, ReportOrder>()),
    missingKits.length ? byIds<ReportKit>(admin, "shop_orders", KIT_COLUMNS, missingKits) : Promise.resolve(new Map<string, ReportKit>()),
  ]);
  for (const [id, o] of extraOrders) orderById.set(id, o);
  for (const [id, k] of extraKits) kitById.set(id, k);

  const sales: ServiceSale[] = [];
  for (const o of orders) {
    const at = paidAt.get(o.id) ?? o.created_at;
    if (!inRange(at, range)) continue;
    const addons = addonsByOrder.get(o.id);
    sales.push({
      type: "order",
      at,
      order: o,
      subtotal_cents: (o.subtotal_cents ?? 0) - (addons?.subtotal ?? 0),
      shipping_cents: o.shipping_cents ?? 0,
      total_cents: (o.total_cents ?? 0) - (addons?.cents ?? 0),
    });
  }
  for (const e of addonsInRange) {
    const o = orderById.get(e.order_id);
    // Only on orders that count as paid sales (as the dashboard joins them)
    if (!o || !PAID.includes(o.payment_status ?? "") || o.status === "awaiting_payment") continue;
    const cents = addonCents(e.description);
    sales.push({ type: e.event_type, at: e.created_at, order: o, subtotal_cents: Math.round(cents / (1 + ADDON_TAX_RATE)), shipping_cents: 0, total_cents: cents });
  }
  sales.sort((a, b) => a.at.localeCompare(b.at));

  const refunds: ReportRefund[] = ledger.map((r) => {
    const kit = r.shop_order_id ? kitById.get(r.shop_order_id) ?? null : null;
    return {
      id: r.id,
      at: r.refunded_at,
      amount_cents: r.amount_cents,
      pending: r.status !== "succeeded",
      kind: r.shop_order_id || r.kind === "kit" || r.kind === "kit_club" ? "kit" : "service",
      order: r.order_id ? orderById.get(r.order_id) ?? null : null,
      kit,
    };
  });

  return { sales, kits, refunds };
}

/**
 * A refund's share of one part of its order (taxable subtotal, shipping, tax),
 * in proportion to the order's total: refunding half the total gives back half
 * of each part. Never more than the part itself.
 */
export function refundShare(amountCents: number, partCents: number | null | undefined, totalCents: number | null | undefined): number {
  const part = partCents ?? 0;
  const total = totalCents ?? 0;
  if (part <= 0 || total <= 0) return 0;
  return Math.min(part, Math.round((amountCents * part) / total));
}

// ── Tier names ───────────────────────────────────────────────────────────────

/**
 * Tier names as the admin has set them (restoration_settings, via getLiveTiers),
 * plus PSA Prep. An order without one tier had cards in several tiers, or was
 * entered by hand with custom prices.
 */
export async function tierNames(): Promise<(tier: string | null | undefined) => string> {
  const names = new Map<string, string>((await getLiveTiers()).map((t) => [t.id, t.name]));
  names.set("prep", "PSA Prep");
  names.set("prep_standard", "PSA Prep");
  return (tier) => (tier ? names.get(tier) ?? tier : "Mixed or custom");
}
