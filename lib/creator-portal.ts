import { cache } from "react";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { newToken, sha256, TOKEN_PATTERN } from "@/lib/admin-session";
import { DEFAULT_COMMISSION_PERCENT } from "@/lib/commission";
import { likeExact } from "@/lib/like-exact";
import { fetchAll } from "@/lib/fetch-all";
import { BUSINESS_TIME_ZONE, etToday } from "@/lib/dashboard-metrics";

/**
 * The creator portal (/affiliates): creators sign in with their code and a
 * password they choose through a one-time setup link from the admin (codes
 * are public, so a code alone opens nothing). The cookie holds a random
 * session ID whose SHA-256 is in affiliate_sessions. The portal shows sales
 * totals for the creator's code and never customer details.
 */
export const CREATOR_SESSION_COOKIE = "creator_session";
// Before passwords the cookie held the creator's ID; cleared on sign-in and sign-out
export const LEGACY_CREATOR_COOKIE = "affiliate_session";
export const CREATOR_SESSION_DAYS = 30;
export const SETUP_LINK_DAYS = 7;
export const CREATOR_PASSWORD_MIN = 10;

export { DEFAULT_COMMISSION_PERCENT, formatPercent } from "@/lib/commission";

export type Creator = { id: string; name: string; code: string; discount_percent: number };

// A code matched literally (case-insensitive): LIKE wildcards don't count
export function literalCode(code: string) {
  return likeExact(code);
}

export async function createCreatorSession(affiliateId: string, userAgent?: string | null) {
  const token = newToken();
  const admin = createAdminClient();
  await admin.from("affiliate_sessions").delete().lt("expires_at", new Date().toISOString());
  const { error } = await admin.from("affiliate_sessions").insert({
    token_hash: await sha256(token),
    affiliate_id: affiliateId,
    expires_at: new Date(Date.now() + CREATOR_SESSION_DAYS * 86400_000).toISOString(),
    user_agent: userAgent?.slice(0, 300) ?? null,
  });
  if (error) throw new Error(`Could not start creator session: ${error.message}`);
  await admin.from("affiliates").update({ portal_last_login_at: new Date().toISOString() }).eq("id", affiliateId);
  const jar = await cookies();
  jar.set(CREATOR_SESSION_COOKIE, token, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: CREATOR_SESSION_DAYS * 86400,
  });
  jar.delete(LEGACY_CREATOR_COOKIE);
}

/** The creator signed in on this request, if any (looked up once per request). */
export const getCreator = cache(async (): Promise<Creator | null> => {
  const jar = await cookies();
  const token = jar.get(CREATOR_SESSION_COOKIE)?.value;
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("affiliate_sessions")
    .select("affiliates(id, name, code, discount_percent, password_hash)")
    .eq("token_hash", await sha256(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  const raw = data?.affiliates as unknown;
  const a = (Array.isArray(raw) ? raw[0] : raw) as (Creator & { password_hash: string | null }) | null;
  // Turning portal access off (clearing the password) ends sessions too
  if (!a?.password_hash) return null;
  return { id: a.id, name: a.name, code: a.code, discount_percent: a.discount_percent ?? 0 };
});

export async function endCreatorSession() {
  const jar = await cookies();
  const token = jar.get(CREATOR_SESSION_COOKIE)?.value;
  if (token && TOKEN_PATTERN.test(token)) {
    await createAdminClient().from("affiliate_sessions").delete().eq("token_hash", await sha256(token));
  }
  jar.delete(CREATOR_SESSION_COOKIE);
  jar.delete(LEGACY_CREATOR_COOKIE);
}

// ── Sales ─────────────────────────────────────────────────────────────────

/** Whether an order with a creator code earns commission: paid, not cancelled. */
export function countsForCommission(kind: "kit" | "restoration", status: string | null) {
  if (status === "cancelled") return false;
  if (kind === "restoration" && status === "awaiting_payment") return false;
  return true;
}

/** An order's amount after refunds. */
export function netCents(totalCents: number | null, refundedCents: number | null) {
  return Math.max(0, (totalCents ?? 0) - (refundedCents ?? 0));
}

/**
 * What an order with a creator code counts for: its amount after refunds, or
 * null when it doesn't count (unpaid, cancelled or fully refunded). Refunds
 * are the larger of the order's refunded_cents and `ledgerCents`, its refund
 * ledger total (ledgerRefundCents), as refundedSoFar in lib/refund-ledger.ts
 * does: the admin refund routes write both, a Stripe Dashboard refund only
 * the ledger. The creator dashboard and the admin Affiliates page both count
 * sales with this.
 */
export function saleCents(
  kind: "kit" | "restoration",
  o: { status: string | null; total_cents: number | null; refunded_cents: number | null },
  ledgerCents = 0,
) {
  if (!countsForCommission(kind, o.status)) return null;
  const cents = netCents(o.total_cents, Math.max(o.refunded_cents ?? 0, ledgerCents));
  return cents > 0 ? cents : null;
}

/** Ledger refunds that count as refunded (as refundedSoFar in lib/refund-ledger.ts). */
const COUNTED_REFUNDS = ["succeeded", "pending", "requires_action"];

/** An order given to ledgerRefundCents: its id, or its id and status. */
type LedgerOrder = string | { id: string; status: string | null };

/**
 * The refund ledger's total for each order (`order_id`) or kit order
 * (`shop_order_id`), by id. Orders given with their status are read only if
 * they count for commission (countsForCommission; saleCents skips the rest).
 * Read in chunks of 100 ids at once, each in pages.
 */
export async function ledgerRefundCents(column: "order_id" | "shop_order_id", orders: LedgerOrder[]): Promise<Map<string, number>> {
  const kind = column === "shop_order_id" ? "kit" : "restoration";
  const ids = orders.flatMap((o) => (typeof o === "string" ? [o] : countsForCommission(kind, o.status) ? [o.id] : []));
  const admin = createAdminClient();
  type Row = { order_id: string | null; shop_order_id: string | null; amount_cents: number | null };
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  const results = await Promise.all(chunks.map((chunk) => fetchAll<Row>((from, to) => admin
    .from("refunds")
    .select("order_id, shop_order_id, amount_cents")
    .in(column, chunk)
    .in("status", COUNTED_REFUNDS)
    .order("id", { ascending: true })
    .range(from, to))));
  const sums = new Map<string, number>();
  for (const r of results.flat()) {
    const id = r[column];
    if (id) sums.set(id, (sums.get(id) ?? 0) + (r.amount_cents ?? 0));
  }
  return sums;
}

/** What a kit order held, for the sales lists ("Restoration Kit ×2"). */
export function kitSummary(items: unknown) {
  const list = Array.isArray(items) ? (items as { product_name?: string; quantity?: number }[]) : [];
  return list.map((i) => `${i.product_name ?? "Item"} ×${i.quantity ?? 1}`).join(", ") || "Kit order";
}

/** A sale's date as creators and the admin see it (New York time). */
export function saleDate(iso: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  return new Date(iso).toLocaleDateString("en-US", { ...opts, timeZone: BUSINESS_TIME_ZONE });
}

/** The New York month of a date, as "YYYY-MM". */
export const saleMonth = (iso: string) => etToday(new Date(iso)).slice(0, 7);

export function commissionCents(cents: number, percent: number) {
  return Math.round((cents * percent) / 100);
}

// ── Commission rates ──────────────────────────────────────────────────────

/**
 * A code's commission rate over time: each row starts at effective_from and
 * runs until the next one. A sale earns the rate in effect when it was placed,
 * so changing a rate "from now on" leaves past sales as they were. No rows
 * means the default rate for every sale.
 */
export type CommissionRate = { percent: number; effective_from: string };

export async function commissionRatesFor(affiliateIds: string[]): Promise<Map<string, CommissionRate[]>> {
  const map = new Map<string, CommissionRate[]>();
  if (!affiliateIds.length) return map;
  const admin = createAdminClient();
  const data: { affiliate_id: string; percent: number | string; effective_from: string }[] = [];
  // In chunks of ids, each read in pages
  for (let i = 0; i < affiliateIds.length; i += 100) {
    const ids = affiliateIds.slice(i, i + 100);
    data.push(...await fetchAll<{ affiliate_id: string; percent: number | string; effective_from: string }>((from, to) => admin
      .from("affiliate_commission_rates")
      .select("affiliate_id, percent, effective_from")
      .in("affiliate_id", ids)
      .order("effective_from", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)));
  }
  data.sort((a, b) => new Date(a.effective_from).getTime() - new Date(b.effective_from).getTime());
  for (const r of data) {
    const list = map.get(r.affiliate_id) ?? [];
    list.push({ percent: Number(r.percent), effective_from: r.effective_from });
    map.set(r.affiliate_id, list);
  }
  return map;
}

/** The rate for a sale placed at `date`. `rates` is sorted oldest first. */
export function rateAt(rates: CommissionRate[] | undefined, date: string) {
  let percent = DEFAULT_COMMISSION_PERCENT;
  const t = new Date(date).getTime();
  for (const r of rates ?? []) {
    if (new Date(r.effective_from).getTime() <= t) percent = r.percent;
    else break;
  }
  return percent;
}

/** The rate new sales earn today. */
export function currentRate(rates: CommissionRate[] | undefined) {
  return rateAt(rates, new Date().toISOString());
}


export type CreatorSale = {
  date: string;
  type: "kit" | "restoration";
  cents: number;
  /** The commission rate in effect when the order was placed */
  percent: number;
  commissionCents: number;
  /** What was bought (product names for kits); never who bought it. */
  summary: string;
};

/**
 * Sales made with a creator's code, newest first. Selects only the columns
 * the portal shows (plus the internal id, to match refunds): no names,
 * emails, addresses or order numbers.
 */
export async function creatorSales(code: string, rates: CommissionRate[] | undefined): Promise<CreatorSale[]> {
  const admin = createAdminClient();
  const match = literalCode(code);
  type Row = { id: string; items?: unknown; total_cents: number | null; refunded_cents: number | null; status: string | null; created_at: string };
  // Every order with the code, read in pages (the API returns at most 1,000 rows a request)
  const [kits, restorations] = await Promise.all([
    fetchAll<Row>((from, to) => admin.from("shop_orders").select("id, items, total_cents, refunded_cents, status, created_at")
      .ilike("affiliate_code", match).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)),
    fetchAll<Row>((from, to) => admin.from("orders").select("id, total_cents, refunded_cents, status, created_at")
      .ilike("affiliate_code", match).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)),
  ]);
  // Refunds made in the Stripe Dashboard are only in the refund ledger
  const [kitRefunds, restorationRefunds] = await Promise.all([
    ledgerRefundCents("shop_order_id", kits),
    ledgerRefundCents("order_id", restorations),
  ]);
  const sales: CreatorSale[] = [];
  for (const o of kits) {
    const cents = saleCents("kit", o, kitRefunds.get(o.id));
    if (cents === null) continue;
    const percent = rateAt(rates, o.created_at);
    sales.push({ date: o.created_at, type: "kit", cents, percent, commissionCents: commissionCents(cents, percent), summary: kitSummary(o.items) });
  }
  for (const o of restorations) {
    const cents = saleCents("restoration", o, restorationRefunds.get(o.id));
    if (cents === null) continue;
    const percent = rateAt(rates, o.created_at);
    sales.push({ date: o.created_at, type: "restoration", cents, percent, commissionCents: commissionCents(cents, percent), summary: "Restoration service" });
  }
  return sales.sort((a, b) => b.date.localeCompare(a.date));
}

export type CreatorTotals = { sales: number; cents: number; commissionCents: number };

function total(sales: CreatorSale[]): CreatorTotals {
  return {
    sales: sales.length,
    cents: sales.reduce((s, o) => s + o.cents, 0),
    // Each sale at its own rate, so a rate change doesn't reprice past sales
    commissionCents: sales.reduce((s, o) => s + o.commissionCents, 0),
  };
}

/** Totals overall, by type, for this month, and for each of the last `months` months (New York months). */
export function summarizeSales(sales: CreatorSale[], months = 6, now = new Date()) {
  const today = etToday(now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  const byMonth: { key: string; label: string; totals: CreatorTotals }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(year, month - i, 1));
    const key = d.toISOString().slice(0, 7);
    byMonth.push({
      key,
      label: d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
      totals: total(sales.filter((s) => saleMonth(s.date) === key)),
    });
  }
  return {
    all: total(sales),
    restoration: total(sales.filter((s) => s.type === "restoration")),
    kit: total(sales.filter((s) => s.type === "kit")),
    thisMonth: byMonth[0].totals,
    byMonth,
  };
}
