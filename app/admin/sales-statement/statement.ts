import type { SupabaseClient } from "@supabase/supabase-js";
import { etToday } from "@/lib/dashboard-metrics";
import { dayRange, etDayStart, loadReport, monthStartDay, refundShare, tierNames, type Range } from "@/lib/sales-report";

/**
 * The Sales Statement (page and CSV): service orders (restoration and PSA Prep)
 * paid in the period, each on the New York day it was paid, plus money added to
 * an order later (added cards, tier upgrades) on its own day; and every refund
 * of a service order made in the period, on the day the money went back, from
 * the refund ledger. Gross is what was paid in the period, Refunds what went
 * back in it, and Net the difference, as on the dashboard.
 */
export const TAX_RATE = 0.06625;

export type Preset = "this_month" | "last_month" | "this_year" | "all";
export const PRESETS: Preset[] = ["this_month", "last_month", "this_year", "all"];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d: string | null | undefined): d is string => !!d && DAY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

export function parsePreset(p: string | null | undefined): Preset {
  return PRESETS.includes(p as Preset) ? (p as Preset) : "this_month";
}

/** The period in New York calendar days. A custom range takes both of its days in full. */
export function statementRange(preset: Preset, from?: string | null, to?: string | null): Range & { label: string; custom: boolean } {
  if (validDay(from) && validDay(to)) {
    return { ...dayRange(from, to), label: `${from} – ${to}`, custom: true };
  }
  const today = etToday();
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  const monthLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  switch (preset) {
    case "this_month": {
      const s = monthStartDay(y, m);
      return { start: etDayStart(s), end: etDayStart(monthStartDay(y, m + 1)), label: monthLabel(s), custom: false };
    }
    case "last_month": {
      const s = monthStartDay(y, m - 1);
      return { start: etDayStart(s), end: etDayStart(monthStartDay(y, m)), label: monthLabel(s), custom: false };
    }
    case "this_year":
      return { start: etDayStart(`${y}-01-01`), end: etDayStart(`${y + 1}-01-01`), label: `Year ${y}`, custom: false };
    case "all":
      return { start: null, end: null, label: "All Time", custom: false };
  }
}

export type StatementRow = {
  key: string;
  kind: "sale" | "refund";
  /** "Sale", "Added cards", "Tier upgrade", "Refund" or "Refund (pending)" */
  type: string;
  at: string;
  order_id: string | null;
  order_number: string | number | null;
  customer_name: string;
  customer_email: string;
  tier: string;
  subtotal_cents: number;
  discount_cents: number;
  gift_card_discount_cents: number;
  shipping_cents: number;
  tax_cents: number;        // estimated: sales add it, refunds take back their share
  total_cents: number;      // paid (sales only)
  refunded_cents: number;   // given back (refunds only)
  affiliate_code: string;
  loyalty_discount_percent: number;
};

export type Statement = {
  rows: StatementRow[];     // newest first
  orders: number;
  gross: number;
  refunds: number;
  net: number;
  tax: number;
  discounts: number;
  shipping: number;
  subtotal: number;
};

// Tax as checkout charged it: on the subtotal less the order's discount (bulk,
// code or loyalty). A gift card is applied after tax, so it never lowers the tax.
const estTax = (subtotal: number, discount: number) => Math.round(Math.max(0, subtotal - discount) * TAX_RATE);

export async function loadStatement(admin: SupabaseClient, range: Range): Promise<Statement> {
  const [data, tierName] = await Promise.all([loadReport(admin, range, { kits: false }), tierNames()]);
  const rows: StatementRow[] = [];

  for (const s of data.sales) {
    const o = s.order;
    const own = s.type === "order";
    const discount = own ? o.discount_cents ?? 0 : 0;
    const giftCard = own ? o.gift_card_discount_cents ?? 0 : 0;
    rows.push({
      key: `${s.type}-${o.id}-${s.at}`,
      kind: "sale",
      type: s.type === "cards_added" ? "Added cards" : s.type === "tier_upgraded" ? "Tier upgrade" : "Sale",
      at: s.at,
      order_id: o.id,
      order_number: o.order_number,
      customer_name: o.customer_name ?? "",
      customer_email: o.customer_email ?? "",
      tier: tierName(o.tier_key),
      subtotal_cents: s.subtotal_cents,
      discount_cents: discount,
      gift_card_discount_cents: giftCard,
      shipping_cents: s.shipping_cents,
      tax_cents: estTax(s.subtotal_cents, discount),
      total_cents: s.total_cents,
      refunded_cents: 0,
      affiliate_code: own ? o.affiliate_code ?? "" : "",
      loyalty_discount_percent: own ? o.loyalty_discount_percent ?? 0 : 0,
    });
  }

  for (const r of data.refunds) {
    if (r.kind !== "service") continue;
    const o = r.order;
    const orderTax = o ? estTax(o.subtotal_cents ?? 0, o.discount_cents ?? 0) : 0;
    rows.push({
      key: `refund-${r.id}`,
      kind: "refund",
      type: r.pending ? "Refund (pending)" : "Refund",
      at: r.at,
      order_id: o?.id ?? null,
      order_number: o?.order_number ?? null,
      customer_name: o?.customer_name ?? "",
      customer_email: o?.customer_email ?? "",
      tier: o ? tierName(o.tier_key) : "",
      subtotal_cents: 0,
      discount_cents: 0,
      gift_card_discount_cents: 0,
      shipping_cents: 0,
      tax_cents: o ? 0 - refundShare(r.amount_cents, orderTax, o.total_cents) : 0, // 0 - x: never "-0"
      total_cents: 0,
      refunded_cents: r.amount_cents,
      affiliate_code: o?.affiliate_code ?? "",
      loyalty_discount_percent: 0,
    });
  }

  rows.sort((a, b) => b.at.localeCompare(a.at));
  const sum = (f: (r: StatementRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const gross = sum((r) => r.total_cents);
  const refunds = sum((r) => r.refunded_cents);
  return {
    rows,
    orders: data.sales.filter((s) => s.type === "order").length,
    gross,
    refunds,
    net: gross - refunds,
    tax: sum((r) => r.tax_cents),
    discounts: sum((r) => r.discount_cents + r.gift_card_discount_cents),
    shipping: sum((r) => r.shipping_cents),
    subtotal: sum((r) => r.subtotal_cents),
  };
}
