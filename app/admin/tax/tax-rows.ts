import type { SupabaseClient } from "@supabase/supabase-js";
import { etToday } from "@/lib/dashboard-metrics";
import { etDateOf, etDayStart, loadReport, refundShare, type ReportRefund } from "@/lib/sales-report";

/**
 * Rows for the Tax Reports page and its CSV export (the same rows in both).
 * One row per sale on the New York day it was paid, and one negative row per
 * refund on the New York day the money went back (lib/sales-report.ts). A
 * refund gives back the same share of each part of its order: half the total
 * refunded takes half the subtotal, half the shipping and half the tax.
 */
export const NJ_TAX_RATE = 0.06625;

export type TxType = "restoration" | "prep" | "kit" | "other";

export type TxRow = {
  date: string;             // when paid or refunded (ISO)
  day: string;              // that date in New York (YYYY-MM-DD)
  kind: "sale" | "refund";
  is_order: boolean;        // the order's own payment (not added cards, an upgrade or a refund)
  note: string | null;      // "Added cards", "Tier upgrade", "Refund", "Refund (pending)"
  order_id: string | null;
  order_number: string | number;
  customer_name: string;
  customer_email: string;
  city: string;
  state: string;
  country: string;          // "" when the refund has no order to tell
  service: string;
  subtotal_cents: number;
  shipping_cents: number;
  tax_cents: number;        // NJ tax computed or collected
  total_cents: number;
  is_nj: boolean;
  type: TxType;
};

type Address = Record<string, string | null> | null;

const PREP_TIERS = ["prep", "prep_standard"];

function place(addr: Address) {
  const state = addr?.state ?? "";
  return { city: addr?.city ?? "", state, country: addr?.country || "US", is_nj: state === "NJ" };
}

const njTax = (isNj: boolean, subtotalCents: number) => (isNj ? Math.round(subtotalCents * NJ_TAX_RATE) : 0);
// Negative, without a "-0" that would print as "-$0.00"
const neg = (cents: number) => (cents ? -cents : 0);

/** The selected year, or this year in New York. */
export function taxYear(param: string | null | undefined): number {
  return param && /^\d{4}$/.test(param) ? parseInt(param, 10) : Number(etToday().slice(0, 4));
}

function refundRow(r: ReportRefund): TxRow {
  const base = {
    date: r.at, day: etDateOf(r.at), kind: "refund" as const, is_order: false,
    note: r.pending ? "Refund (pending)" : "Refund", total_cents: neg(r.amount_cents),
  };
  if (r.order) {
    const o = r.order;
    const p = place(o.ship_from_address);
    const isPrep = PREP_TIERS.includes(o.restoration_tier ?? "");
    const subtotal = refundShare(r.amount_cents, o.subtotal_cents, o.total_cents);
    return {
      ...base, ...p, order_id: o.id, order_number: o.order_number,
      customer_name: o.customer_name ?? "", customer_email: o.customer_email ?? "",
      service: isPrep ? "Prep" : "Restoration", type: isPrep ? "prep" : "restoration",
      subtotal_cents: neg(subtotal),
      shipping_cents: neg(refundShare(r.amount_cents, o.shipping_cents, o.total_cents)),
      tax_cents: neg(njTax(p.is_nj, subtotal)),
    };
  }
  if (r.kit) {
    const k = r.kit;
    const p = place(k.shipping_address);
    const subtotal = refundShare(r.amount_cents, k.subtotal_cents, k.total_cents);
    return {
      ...base, ...p, order_id: null, order_number: "",
      customer_name: k.customer_name ?? "", customer_email: k.customer_email ?? "",
      service: "Kit", type: "kit",
      subtotal_cents: neg(subtotal),
      shipping_cents: neg(refundShare(r.amount_cents, k.shipping_cents ?? 599, k.total_cents)),
      tax_cents: neg(njTax(p.is_nj, subtotal)),
    };
  }
  // A Kit Club charge, or a refund the ledger couldn't match to an order: no address to place it
  return {
    ...base, city: "", state: "", country: "", is_nj: false, order_id: null, order_number: "",
    customer_name: "", customer_email: "",
    service: r.kind === "kit" ? "Kit" : "Unmatched", type: r.kind === "kit" ? "kit" : "other",
    subtotal_cents: neg(r.amount_cents), shipping_cents: 0, tax_cents: 0,
  };
}

/** Every sale and refund in a New York calendar year, newest first. */
export async function taxRowsForYear(admin: SupabaseClient, year: number): Promise<TxRow[]> {
  const data = await loadReport(admin, { start: etDayStart(`${year}-01-01`), end: etDayStart(`${year + 1}-01-01`) });
  const rows: TxRow[] = [];

  for (const s of data.sales) {
    const o = s.order;
    const p = place(o.ship_from_address);
    const isPrep = PREP_TIERS.includes(o.restoration_tier ?? "");
    rows.push({
      date: s.at, day: etDateOf(s.at), kind: "sale", is_order: s.type === "order",
      note: s.type === "cards_added" ? "Added cards" : s.type === "tier_upgraded" ? "Tier upgrade" : null,
      ...p, order_id: o.id, order_number: o.order_number,
      customer_name: o.customer_name ?? "", customer_email: o.customer_email ?? "",
      service: isPrep ? "Prep" : "Restoration", type: isPrep ? "prep" : "restoration",
      subtotal_cents: s.subtotal_cents, shipping_cents: s.shipping_cents,
      tax_cents: njTax(p.is_nj, s.subtotal_cents), total_cents: s.total_cents,
    });
  }

  for (const k of data.kits) {
    const p = place(k.shipping_address);
    const subtotal = k.subtotal_cents ?? 0;
    rows.push({
      date: k.created_at, day: etDateOf(k.created_at), kind: "sale", is_order: true, note: null,
      ...p, order_id: null, order_number: "",
      customer_name: k.customer_name ?? "", customer_email: k.customer_email ?? "",
      service: "Kit", type: "kit",
      subtotal_cents: subtotal, shipping_cents: k.shipping_cents ?? 599,
      tax_cents: njTax(p.is_nj, subtotal), total_cents: k.total_cents ?? 0,
    });
  }

  for (const r of data.refunds) rows.push(refundRow(r));

  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

/** 0-11, the row's New York month. */
export const rowMonth = (r: TxRow) => parseInt(r.day.slice(5, 7), 10) - 1;

const QUARTERS: Record<string, [number, number]> = { Q1: [0, 3], Q2: [3, 6], Q3: [6, 9], Q4: [9, 12] };
export const quarterMonths = (q: string): [number, number] => QUARTERS[q] ?? [0, 12];

export function filterTaxRows(
  rows: TxRow[],
  { month, quarter, state, type }: { month?: string | null; quarter?: string | null; state?: string | null; type?: string | null },
): TxRow[] {
  let out = rows;
  // Month takes priority over quarter
  if (month && month !== "all") {
    const m = parseInt(month, 10);
    out = out.filter((r) => rowMonth(r) === m);
  } else if (quarter && quarter !== "all") {
    const [startM, endM] = quarterMonths(quarter);
    out = out.filter((r) => rowMonth(r) >= startM && rowMonth(r) < endM);
  }
  if (state && state !== "all") {
    if (state === "NJ") out = out.filter((r) => r.is_nj);
    else if (state === "non-NJ-US") out = out.filter((r) => !r.is_nj && r.country === "US");
    else if (state === "international") out = out.filter((r) => r.country !== "US" && r.country !== "");
    else out = out.filter((r) => r.state === state);
  }
  if (type && type !== "all") out = out.filter((r) => r.type === type);
  return out;
}
