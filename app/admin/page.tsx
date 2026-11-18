import { createAdminClient } from "@/lib/supabase/admin";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/constants";
import { formatCurrency } from "@/lib/utils";
import { after } from "next/server";
import { revalidateTag } from "next/cache";
import { RefundRequestsTab } from "./refund-requests-tab";
import { pendingRefundRequestCount } from "@/lib/refund-requests";
import { CardSearch } from "./card-search";
import { Suspense } from "react";
import type { RestorationTierId } from "@/lib/restoration-tiers";
import { cachedTrackingStatus, type TrackingSnapshot } from "@/lib/tracking-cache";
import { SyncTrackingButton } from "./sync-tracking-button";
import { SyncDeliveredButton } from "./sync-delivered-button";
import { ResendConfirmationsButton } from "./resend-confirmations-button";
import { requireAdmin } from "@/lib/admin-auth";
import { INQUIRY_TYPE, OPEN_CASE_STATUSES, orderLabel } from "@/lib/card-inquiries";
import { addDays, etToday } from "@/lib/dashboard-metrics";
import { syncRefundsQuietly } from "@/lib/refund-ledger";
import { DashboardLink } from "./dashboard-link";
import { DASHBOARD_METRICS_TAG } from "./dashboard-metrics-cache";
import { BacklogBadge, DashboardMetrics, DashboardMetricsFallback } from "./dashboard-metrics-section";
import { Skeleton } from "@/components/admin-ui/skeleton";
import { fetchAll } from "@/lib/fetch-all";
import { trackingCarrier } from "@/lib/tracking-carrier";
import { thumbnail } from "@/lib/thumbnail";
import { pregradeCounts, pregradeLabel } from "@/lib/pregrade";

// Whole days since a customer asked for an update (the page renders per request)
function daysWaiting(askedAt: string) {
  return Math.floor((Date.now() - new Date(askedAt).getTime()) / 86_400_000);
}

const TIER_BADGES: Record<string, { label: string; color: string }> = {
  regular:       { label: "Bronze",    color: "bg-amber-100 text-amber-700" },
  expedited:     { label: "Silver",    color: "bg-slate-100 text-slate-600" },
  premium:       { label: "Gold",      color: "bg-yellow-100 text-yellow-700" },
  ultra_premium: { label: "Platinum",  color: "bg-blue-100 text-blue-600" },
  elite:         { label: "Diamond",   color: "bg-cyan-100 text-cyan-700" },
  fast_pass:     { label: "Fast Pass", color: "bg-orange-100 text-orange-700" },
  prep:          { label: "Prep",      color: "bg-emerald-100 text-emerald-700" },
  prep_standard: { label: "Prep",      color: "bg-emerald-100 text-emerald-700" },
};

const TIER_STYLES: Record<string, { label: string; cls: string }> = {
  regular:       { label: "Bronze",    cls: "bg-amber-100 text-amber-700" },
  expedited:     { label: "Silver",    cls: "bg-slate-100 text-slate-600" },
  premium:       { label: "Gold",      cls: "bg-yellow-100 text-yellow-700" },
  ultra_premium: { label: "Platinum",  cls: "bg-blue-100 text-blue-600" },
  elite:         { label: "Diamond",   cls: "bg-cyan-100 text-cyan-700" },
  fast_pass:     { label: "Fast Pass", cls: "bg-orange-100 text-orange-700" },
};

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  awaiting_payment: "bg-gray-100 text-gray-600",
  awaiting_cards: "bg-yellow-100 text-yellow-700",
  received: "bg-blue-100 text-blue-700",
  in_progress: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
  shipped_back: "bg-cyan-100 text-cyan-700",
  delivered: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

const FULFILLMENT_STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  received:    { label: "Cards Received", cls: "bg-blue-100 text-blue-700" },
  in_progress: { label: "In Progress",    cls: "bg-purple-100 text-purple-700" },
};

// Day math works on New York calendar days (YYYY-MM-DD), not the server's
// clock (UTC on Netlify), so an order that arrives in the New York evening
// counts on its own day.

/** The New York calendar day of a timestamp. */
function nyDay(iso: string): string {
  return etToday(new Date(iso));
}

function isWeekday(day: string): boolean {
  const w = new Date(`${day}T12:00:00Z`).getUTCDay();
  return w !== 0 && w !== 6;
}

/** Weekdays after `from`, up to and including `to` (0 when `to` isn't later). */
function businessDaysBetween(from: string, to: string): number {
  let count = 0;
  for (let d = from; d < to; ) {
    d = addDays(d, 1);
    if (isWeekday(d)) count++;
  }
  return count;
}

function businessDaysSince(iso: string, today: string): number {
  return businessDaysBetween(nyDay(iso), today);
}

function addBusinessDays(day: string, days: number): string {
  let result = day;
  let remaining = Math.abs(days);
  const dir = days >= 0 ? 1 : -1;
  while (remaining > 0) {
    result = addDays(result, dir);
    if (isWeekday(result)) remaining--;
  }
  return result;
}

/** Business days from today to `target`; negative when it's past. */
function businessDaysUntil(target: string, today: string): number {
  if (target === today) return 0;
  return target > today ? businessDaysBetween(today, target) : -businessDaysBetween(target, today);
}

/**
 * A case-insensitive regex (PostgREST imatch, Postgres ~*) that finds `text`
 * anywhere, every character taken literally: the ***= prefix makes Postgres
 * read the rest as plain text. Not ilike: PostgREST turns every * in a like
 * pattern into %, and that can't be escaped.
 */
function literalPattern(text: string): string {
  return `***=${text}`;
}

// Paid orders in these statuses make up the Fulfillment Queue
const FULFILLMENT_STATUSES = ["received", "in_progress", "awaiting_restoration"];

// Columns the search results list shows
const SEARCH_COLUMNS = "id, order_number, customer_name, customer_email, customer_phone, total_cents, status, created_at, restoration_tier";
type SearchRow = {
  id: string;
  order_number: string | number;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  total_cents: number;
  status: string;
  created_at: string;
  restoration_tier: string | null;
};

// Columns the All Orders list shows; each order's cards come embedded
const ORDER_LIST_COLUMNS = "id, order_number, customer_name, customer_email, customer_phone, total_cents, status, created_at, restoration_tier, payment_method, instagram_feature, insurance_declared_value_cents";
// Past orders (Shipped Out or Delivered) the All Orders list shows before "Show all"
const PAST_LIMIT = 50;
const PAST_STATUSES = ["shipped_back", "delivered"];
// Orders we consider "done" for grader-notes purposes
const DONE_STATUSES = ["completed", "shipped_back", "delivered"];
// Text that is empty once trimmed, as JavaScript's trim() sees it: a Postgres
// regex for the Missing Notes filter (no commas or parentheses, so it can sit
// in a PostgREST or=() filter unquoted)
const BLANK_TEXT = String.raw`^[\t\n\v\f\r\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$`;
const PREGRADE_ORDER_COLUMNS = "id, order_number, customer_name, customer_email, status, created_at, restoration_tier";

// The rows each tab reads
type EmbeddedCard = { card_name: string; photo_urls: string[] | null };
type ListedOrder = {
  id: string;
  order_number: string | number;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  total_cents: number;
  status: string;
  created_at: string;
  restoration_tier: string | null;
  payment_method: string | null;
  instagram_feature: boolean | null;
  insurance_declared_value_cents: number | null;
  cards: EmbeddedCard[] | null;
};
type AwaitingOrderRow = {
  id: string;
  order_number: string | number;
  customer_name: string;
  customer_email: string;
  created_at: string;
  total_cents: number;
  restoration_tier: string | null;
  inbound_method: string | null;
};
type CardPhotosRow = { order_id: string; card_name: string; photo_urls: unknown };
type FulfillmentOrderRow = {
  id: string;
  order_number: string | number;
  customer_name: string;
  customer_email: string;
  created_at: string;
  status: string;
  restoration_tier: string | null;
  total_cents: number;
  instagram_feature: boolean | null;
  inbound_method: string | null;
};
type ShippedRow = {
  id: string;
  order_number: string | number;
  customer_name: string;
  customer_email: string;
  created_at: string;
  updated_at: string;
  tracking_number: string | null;
  return_label_url: string | null;
  admin_notes: string | null;
  outbound_tracking_number: string | null;
  outbound_carrier: string | null;
};
type InsuredOrderRow = {
  id: string;
  order_number: string | number;
  customer_name: string;
  customer_email: string;
  status: string;
  created_at: string;
  total_cents: number;
  restoration_tier: string | null;
  insurance_declared_value_cents: number;
  insurance_type: string | null;
};
type VideoOrderRow = {
  id: string;
  order_number: string | number;
  customer_name: string;
  customer_email: string;
  status: string;
  created_at: string;
  total_cents: number;
  restoration_tier: string | null;
  cards: EmbeddedCard[] | null;
};
type GiftCardRow = {
  id: string;
  code: string;
  status: string;
  value_cents: number | null;
  remaining_cents: number | null;
  purchaser_name: string | null;
  purchaser_email: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  created_at: string;
};
type UpdateRequestRow = { id: string; created_at: string; customer_name: string | null; customer_email: string; order_ref: string | null };
// Open orders: only `id` is read except on the Pre-Grades tab, which lists them
type PregradeOrderRow = {
  id: string;
  order_number: string | number;
  customer_name: string;
  customer_email: string;
  status: string;
  created_at: string;
  restoration_tier: string | null;
};

// Max business days per tier (used to compute due date from cards-received timestamp).
// regular/expedited promise "months" of calendar time; converted here to approx business days
// (22 business days ≈ 1 calendar month): regular = 3 months → 65 bd, expedited = 1.5 months → 33 bd.
const TIER_TURNAROUND_DAYS: Record<string, number> = {
  regular:       65,   // Bronze  — 2–3 months  (≈ 65 business days)
  expedited:     33,   // Silver  — 1–1.5 months (≈ 33 business days)
  premium:       20,   // Gold    — 15–20 business days
  ultra_premium: 15,   // Platinum — 10–15 business days
  elite:         10,   // Diamond  — 5–10 business days
  fast_pass:      7,   // Fast Pass — skip the queue (≤ 7 business days)
};

/** Holds the Refund Requests tab's place while its requests load. */
function RefundRequestsFallback() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading refund requests">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string; tier?: string; period?: string; notes?: string; sort?: string; method?: string; past?: string }>;
}) {
  await requireAdmin();
  const { q, tab, tier: tierFilter, period: shippedPeriod, notes: notesFilter, sort: sortMode, method: methodFilter, past: pastParam } = await searchParams;
  const query = q?.trim() ?? "";
  const activeTab = tab === "fulfillment" ? "fulfillment" : tab === "shipped" ? "shipped" : tab === "awaiting" ? "awaiting" : tab === "insured" ? "insured" : tab === "videos" ? "videos" : tab === "gift-cards" ? "gift-cards" : tab === "updates" ? "updates" : tab === "pregrades" ? "pregrades" : tab === "refunds" ? "refunds" : "orders";
  const activePeriod = shippedPeriod === "week" ? "week" : shippedPeriod === "month" ? "month" : shippedPeriod === "all" ? "all" : "today";
  const showAllPast = pastParam === "all";

  const admin = createAdminClient();
  // New York's date: the Shipped Out periods, due dates and dashboard all use New York days
  const today = etToday();

  // ── Card/name search mode ─────────────────────────────────────────────────
  if (query) {
    // One plain filter per column (no .or() string, so commas, dots and
    // parentheses in the search are just text), every match read in pages, and
    // card matches joined through the cards table instead of a long list of IDs
    const pattern = literalPattern(query);
    const settle = <T,>(what: string, rows: Promise<T[]>) => rows.then(
      (r) => ({ rows: r, ok: true }),
      (e: unknown) => { console.error(`[admin] search ${what}:`, e); return { rows: [] as T[], ok: false }; },
    );
    const [names, emails, cardHits] = await Promise.all([
      settle("names", fetchAll<SearchRow>((from, to) => admin
        .from("orders")
        .select(SEARCH_COLUMNS)
        .regexIMatch("customer_name", pattern)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to))),
      settle("emails", fetchAll<SearchRow>((from, to) => admin
        .from("orders")
        .select(SEARCH_COLUMNS)
        .regexIMatch("customer_email", pattern)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to))),
      settle("cards", fetchAll<SearchRow & { cards: { card_name: string }[] | null }>((from, to) => admin
        .from("orders")
        .select(`${SEARCH_COLUMNS}, cards!inner(card_name)`)
        .regexIMatch("cards.card_name", pattern)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to))),
    ]);
    const searchFailed = !names.ok || !emails.ok || !cardHits.ok;
    const cardMatches = cardHits.rows;

    const seen = new Set<string>();
    const matchedOrders: SearchRow[] = [];
    for (const o of [...names.rows, ...emails.rows, ...cardMatches]) {
      if (!seen.has(o.id)) { seen.add(o.id); matchedOrders.push(o); }
    }
    matchedOrders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Tier chips: counts come from every match, the list shows the chosen tier
    const searchTier = (t: string | null) => (t === "prep" || t === "prep_standard" ? "prep" : t ?? "none");
    const tierCounts: Record<string, number> = {};
    for (const o of matchedOrders) tierCounts[searchTier(o.restoration_tier)] = (tierCounts[searchTier(o.restoration_tier)] ?? 0) + 1;
    const searchTierFilter = tierFilter && tierFilter !== "all" ? tierFilter : null;
    const shownOrders = searchTierFilter ? matchedOrders.filter((o) => searchTier(o.restoration_tier) === searchTierFilter) : matchedOrders;
    const searchHref = (t: string) => `/admin?q=${encodeURIComponent(query)}${t !== "all" ? `&tier=${t}` : ""}`;

    // The matching cards come back embedded in their order (only the ones that match)
    const hitsByOrder: Record<string, string[]> = {};
    for (const o of cardMatches) {
      hitsByOrder[o.id] = (o.cards ?? []).map((c) => c.card_name);
    }

    return (
      <div className="min-h-screen bg-secondary/30">
        <div className="max-w-6xl mx-auto px-6 py-10">
          <div className="mb-8 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <h1 className="font-heading font-black text-3xl text-foreground">Orders</h1>
              <p className="text-muted-foreground text-sm mt-1">
                {matchedOrders?.length ?? 0} order{matchedOrders?.length !== 1 ? "s" : ""} matching &ldquo;{query}&rdquo;
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap justify-end">
              <ResendConfirmationsButton />
              <Suspense>
                <CardSearch />
              </Suspense>
              <DashboardLink
                href="/admin/orders/new"
                className="h-9 px-4 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors flex items-center whitespace-nowrap"
              >
                + New Order
              </DashboardLink>
            </div>
          </div>

          {searchFailed && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4 text-sm font-semibold text-red-700">
              Part of the search couldn&apos;t run, so some matches may be missing. Try again.
            </div>
          )}
          {matchedOrders.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-4">
              {[["all", "All Tiers"], ["fast_pass", "Fast Pass"], ["elite", "Diamond"], ["ultra_premium", "Platinum"], ["premium", "Gold"], ["expedited", "Silver"], ["regular", "Bronze"], ["prep", "Prep"], ["none", "No Tier"]].map(([val, label]) => {
                const count = val === "all" ? matchedOrders.length : tierCounts[val] ?? 0;
                if (val !== "all" && count === 0 && searchTierFilter !== val) return null;
                return (
                  <DashboardLink key={val} href={searchHref(val)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
                      (searchTierFilter ?? "all") === val
                        ? "bg-foreground text-background border-foreground"
                        : "bg-white text-muted-foreground border-border hover:border-foreground"
                    }`}
                  >{label} <span className="opacity-60">{count}</span></DashboardLink>
                );
              })}
            </div>
          )}

          {shownOrders.length === 0 ? (
            <div className="bg-white rounded-xl border border-border p-12 text-center text-muted-foreground">
              {matchedOrders.length === 0 ? <>No orders found matching &ldquo;{query}&rdquo;.</> : <>No orders in this tier match &ldquo;{query}&rdquo;.</>}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {shownOrders.map((order) => (
                <DashboardLink
                  key={order.id}
                  href={`/admin/orders/${order.id}`}
                  className="bg-white rounded-xl border border-border p-5 flex flex-col sm:flex-row sm:items-center gap-4 hover:border-primary/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <span className="font-heading font-black text-foreground">{/^\d+$/.test(String(order.order_number)) ? `R${order.order_number}` : order.order_number}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {ORDER_STATUSES[order.status as OrderStatus]?.label ?? order.status}
                      </span>
                      {order.restoration_tier && TIER_BADGES[order.restoration_tier] && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TIER_BADGES[order.restoration_tier].color}`}>
                          {TIER_BADGES[order.restoration_tier].label}
                        </span>
                      )}
                    </div>
                    <p className="font-medium text-foreground">{order.customer_name}</p>
                    <p className="text-sm text-muted-foreground">{order.customer_email}</p>
                    {hitsByOrder[order.id]?.length > 0 && (
                      <p className="text-sm text-primary font-semibold mt-1">
                        🃏 {hitsByOrder[order.id].join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="flex sm:flex-col items-center sm:items-end gap-4 sm:gap-1">
                    <span className="font-heading font-black text-xl text-primary">{formatCurrency(order.total_cents)}</span>
                    <span className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleString("en-US", { timeZone: "America/New_York" })}</span>
                  </div>
                </DashboardLink>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Refunds made in the Stripe Dashboard reach the refund ledger after the page
  // is sent (at most one sync a minute, lib/refund-ledger.ts; a scheduled job
  // keeps it current too), so the page never waits on Stripe: the numbers show
  // the ledger as of the last sync. When this sync saves anything (or can't
  // tell), the cached month numbers are dropped so the next load shows it.
  if (activeTab === "orders") {
    after(async () => {
      const result = await syncRefundsQuietly(admin);
      if (result === null || (!result.skipped && result.synced > 0)) {
        revalidateTag(DASHBOARD_METRICS_TAG, { expire: 0 });
      }
    });
  }

  // ── One parallel wave for the whole page ──────────────────────────────────
  // Every tab's badge is a count (no rows), and only the open tab's rows are
  // read. The month tiles and charts stream in later (DashboardMetrics).
  type DbError = { message: string } | null;
  const countOf = async (what: string, query: PromiseLike<{ count: number | null; error: DbError }>) => {
    const { count, error } = await query;
    if (error) console.error(`[admin] count ${what}:`, error.message);
    return count ?? 0;
  };
  const rowsOf = async <T,>(what: string, query: PromiseLike<{ data: T[] | null; error: DbError }>): Promise<T[]> => {
    const { data, error } = await query;
    if (error) console.error(`[admin] ${what}:`, error.message);
    return data ?? [];
  };
  const allRowsOf = <T,>(what: string, page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: DbError }>): Promise<T[]> =>
    fetchAll<T>(page).catch((e) => { console.error(`[admin] ${what}:`, e); return []; });
  /** `load()` on the open tab; `empty` on every other tab. */
  const onTab = <T,>(tabName: typeof activeTab, load: () => Promise<T>, empty: T): Promise<T> =>
    activeTab === tabName ? load() : Promise.resolve(empty);
  const headCount = { count: "exact", head: true } as const;
  const openOrderColumns: string = activeTab === "pregrades" ? PREGRADE_ORDER_COLUMNS : "id";

  // All Orders: every active order, and the newest PAST_LIMIT past ones (all of
  // them with ?past=all), each with its cards. The chips filter in the query:
  // tier, how it was paid, and Missing Notes (done orders with no restorer notes).
  function ordersListQuery(which: "active" | "past", withCount: boolean) {
    let q = admin
      .from("orders")
      .select(`${ORDER_LIST_COLUMNS}, cards(card_name, photo_urls)`, withCount ? { count: "exact" } : undefined);
    q = which === "active"
      ? q.neq("status", "awaiting_payment").not("status", "in", `(${PAST_STATUSES.join(",")})`)
      : q.in("status", PAST_STATUSES);
    if (tierFilter && tierFilter !== "all") {
      q = tierFilter === "prep" ? q.in("restoration_tier", ["prep", "prep_standard"]) : q.eq("restoration_tier", tierFilter);
    }
    if (methodFilter && methodFilter !== "all") {
      // "Not Set": no method saved (the app only ever saves a method or null)
      q = methodFilter === "unset" ? q.is("payment_method", null) : q.eq("payment_method", methodFilter);
    }
    if (notesFilter === "missing") {
      q = q.in("status", DONE_STATUSES).or(`admin_notes.is.null,admin_notes.match.${BLANK_TEXT}`);
    }
    // Cards in the order the list always showed them (by card id)
    return q.order("created_at", { ascending: false }).order("id").order("id", { referencedTable: "cards" });
  }

  const [
    listedOrderCount, shopOrderCount, awaitingCount, fulfillmentCount, shippedCount,
    insuredCount, videosCount, giftCardCount, updateRequestCount, refundRequestCount,
    pregradesByOrder, openOrders,
    activeOrders, past,
    awaitingOrders, awaitingCards,
    fulfillmentOrders, fulfillmentCards, receivedEvents,
    shippedRaw, insuredOrders, videoOrders, giftCards, updateRequests,
  ] = await Promise.all([
    // ── Badges and the header total ──
    countOf("orders", admin.from("orders").select("id", headCount).neq("status", "awaiting_payment")),
    countOf("kit orders", admin.from("shop_orders").select("id", headCount)),
    countOf("awaiting", admin.from("orders").select("id", headCount).eq("status", "awaiting_cards").eq("payment_status", "paid")),
    // The Fulfillment Queue badge counts cards, in paid orders in the queue's statuses
    countOf("fulfillment cards", admin
      .from("cards")
      .select("id, orders!inner(status, payment_status)", headCount)
      .in("orders.status", FULFILLMENT_STATUSES)
      .eq("orders.payment_status", "paid")),
    countOf("shipped", admin.from("orders").select("id", headCount).eq("status", "shipped_back")),
    countOf("insured", admin
      .from("orders")
      .select("id", headCount)
      .not("insurance_declared_value_cents", "is", null)
      .gt("insurance_declared_value_cents", 0)
      .neq("status", "awaiting_payment")),
    countOf("videos", admin.from("orders").select("id", headCount).eq("instagram_feature", true).neq("status", "awaiting_payment")),
    countOf("gift cards", admin.from("gift_cards").select("id", headCount)),
    // Update requests: customers waiting on a reply (Update Requests tab)
    countOf("update requests", admin.from("cases").select("id", headCount).eq("type", INQUIRY_TYPE).in("status", OPEN_CASE_STATUSES)),
    // Refunds support asked for, waiting on an admin (Refund Requests tab)
    pendingRefundRequestCount(admin),
    // Pre-grades paid for and sent, per order (lib/pregrade.ts): the row
    // badges, and with the open orders below, the Pre-Grades tab and its badge
    pregradeCounts(),
    // (only their IDs, except on the Pre-Grades tab, which lists them)
    allRowsOf<PregradeOrderRow>("open orders", (from, to) => admin
      .from("orders")
      .select(openOrderColumns)
      .not("status", "in", "(delivered,cancelled,awaiting_payment)")
      .order("created_at", { ascending: true })
      .order("id")
      .range(from, to)
      .overrideTypes<PregradeOrderRow[], { merge: false }>()),

    // ── All Orders tab ──
    // Every row (the API returns at most 1,000 per request); errors fail the page as before
    onTab("orders", () => fetchAll<ListedOrder>((from, to) => ordersListQuery("active", false).range(from, to)), [] as ListedOrder[]),
    onTab("orders", async () => {
      if (showAllPast) {
        const rows = await fetchAll<ListedOrder>((from, to) => ordersListQuery("past", false).range(from, to));
        return { rows, count: rows.length };
      }
      const { data, error, count } = await ordersListQuery("past", true).range(0, PAST_LIMIT - 1);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as ListedOrder[], count: count ?? 0 };
    }, { rows: [] as ListedOrder[], count: 0 }),

    // ── Awaiting Cards tab ──
    onTab("awaiting", () => rowsOf<AwaitingOrderRow>("awaiting", admin
      .from("orders")
      .select("id, order_number, customer_name, customer_email, created_at, total_cents, restoration_tier, inbound_method")
      .eq("status", "awaiting_cards")
      .eq("payment_status", "paid")
      .order("created_at", { ascending: true })), [] as AwaitingOrderRow[]),
    // Their cards (names + photos). Found by joining their order with the
    // queue's own filter, not a list of order IDs: a few hundred IDs make the
    // request URL too long for the API gateway. Every row, read in pages.
    onTab("awaiting", () => allRowsOf<CardPhotosRow>("awaiting cards", (from, to) => admin
      .from("cards")
      .select("id, order_id, card_name, photo_urls, orders!inner(status, payment_status)")
      .eq("orders.status", "awaiting_cards")
      .eq("orders.payment_status", "paid")
      .order("created_at")
      .order("id")
      .range(from, to)), [] as CardPhotosRow[]),

    // ── Fulfillment Queue tab ──
    onTab("fulfillment", () => rowsOf<FulfillmentOrderRow>("fulfillment", admin
      .from("orders")
      .select("id, order_number, customer_name, customer_email, created_at, status, restoration_tier, total_cents, instagram_feature, inbound_method")
      .in("status", FULFILLMENT_STATUSES)
      .eq("payment_status", "paid")
      .order("created_at", { ascending: true })), [] as FulfillmentOrderRow[]),
    // Card counts + completion (every row: the queue is counted in cards), joined
    // to the queue's orders by its own filter (see the awaiting cards above)
    onTab("fulfillment", () => allRowsOf<{ order_id: string; completed: boolean | null }>("fulfillment cards", (from, to) => admin
      .from("cards")
      .select("id, order_id, completed, orders!inner(status, payment_status)")
      .in("orders.status", FULFILLMENT_STATUSES)
      .eq("orders.payment_status", "paid")
      .order("id")
      .range(from, to)), [] as { order_id: string; completed: boolean | null }[]),
    // When each queue order was marked received (for accurate "days since received")
    onTab("fulfillment", () => allRowsOf<{ order_id: string; created_at: string }>("received events", (from, to) => admin
      .from("order_events")
      .select("id, order_id, created_at, orders!inner(status, payment_status)")
      .in("orders.status", FULFILLMENT_STATUSES)
      .eq("orders.payment_status", "paid")
      .like("description", "%Cards Received%")
      .neq("event_type", "support_note") // a support note can mention it too
      .order("created_at", { ascending: true })
      .order("id")
      .range(from, to)), [] as { order_id: string; created_at: string }[]),

    // ── Shipped Out, Insured, Videos, Gift Cards and Update Requests tabs ──
    onTab("shipped", () => rowsOf<ShippedRow>("shipped", admin
      .from("orders")
      .select("id, order_number, customer_name, customer_email, created_at, updated_at, tracking_number, return_label_url, admin_notes, outbound_tracking_number, outbound_carrier")
      .eq("status", "shipped_back")
      .order("updated_at", { ascending: false })), [] as ShippedRow[]),
    onTab("insured", () => rowsOf<InsuredOrderRow>("insured", admin
      .from("orders")
      .select("id, order_number, customer_name, customer_email, status, created_at, total_cents, restoration_tier, insurance_declared_value_cents, insurance_type")
      .not("insurance_declared_value_cents", "is", null)
      .gt("insurance_declared_value_cents", 0)
      .neq("status", "awaiting_payment")
      .order("created_at", { ascending: false })), [] as InsuredOrderRow[]),
    // Video orders with their cards (which cards to film)
    onTab("videos", () => rowsOf<VideoOrderRow>("videos", admin
      .from("orders")
      .select("id, order_number, customer_name, customer_email, status, created_at, total_cents, restoration_tier, cards(card_name, photo_urls)")
      .eq("instagram_feature", true)
      .neq("status", "awaiting_payment")
      .order("created_at", { ascending: false })
      .order("created_at", { referencedTable: "cards" })
      .order("id", { referencedTable: "cards" })), [] as VideoOrderRow[]),
    onTab("gift-cards", () => rowsOf<GiftCardRow>("gift cards", admin
      .from("gift_cards")
      .select("id, code, status, value_cents, remaining_cents, purchaser_name, purchaser_email, recipient_name, recipient_email, created_at")
      .order("created_at", { ascending: false })), [] as GiftCardRow[]),
    // Oldest first
    onTab("updates", () => rowsOf<UpdateRequestRow>("update requests", admin
      .from("cases")
      .select("id, created_at, customer_name, customer_email, order_ref")
      .eq("type", INQUIRY_TYPE)
      .in("status", OPEN_CASE_STATUSES)
      .order("created_at", { ascending: true })), [] as UpdateRequestRow[]),
  ]);

  // Update Requests tab: their orders, for the status and link (kit orders are filed as K<number>)
  const updateRefs = updateRequests.map((u) => u.order_ref).filter((r): r is string => !!r);
  const restorationRefs = updateRefs.filter((r) => !/^K\d+$/.test(r));
  const kitNumbers = updateRefs.filter((r) => /^K\d+$/.test(r)).map((r) => Number(r.slice(1)));
  const [updateOrders, updateKits] = await Promise.all([
    restorationRefs.length
      ? rowsOf<{ id: string; order_number: string | number; status: string }>("update orders", admin.from("orders").select("id, order_number, status").in("order_number", restorationRefs))
      : [],
    kitNumbers.length
      ? rowsOf<{ id: string; order_number: string | number; status: string }>("update kits", admin.from("shop_orders").select("id, order_number, status").in("order_number", kitNumbers))
      : [],
  ]);
  const updateOrderMap = new Map(updateOrders.map((o) => [String(o.order_number), o]));
  const updateKitMap = new Map(updateKits.map((o) => [`K${o.order_number}`, o]));

  const videoCardsByOrder: Record<string, { name: string; photo: string | null }[]> = {};
  for (const order of videoOrders) {
    videoCardsByOrder[order.id] = (order.cards ?? []).map((card) => {
      const urls: string[] = Array.isArray(card.photo_urls) ? card.photo_urls : [];
      return { name: card.card_name, photo: urls[0] ?? null };
    });
  }

  // Shippo tracking for shipped orders that have a tracking number, through the
  // shared 10-minute cache (lib/tracking-cache.ts), so a view doesn't make one
  // live Shippo call per order. Only this tab loads it.
  type ShippedWithTracking = ShippedRow & { track: TrackingSnapshot | null };
  let shippedOrders: ShippedWithTracking[] = [];
  if (activeTab === "shipped" && shippedRaw.length > 0) {
    const results = await Promise.allSettled(
      shippedRaw.map(async (o) => {
        let track: TrackingSnapshot | null = null;
        if (o.tracking_number) {
          try {
            // The label's saved carrier while it goes with this number, else told from the number
            const carrier = trackingCarrier(o.tracking_number, o.outbound_tracking_number === o.tracking_number ? o.outbound_carrier : null);
            track = await cachedTrackingStatus(o.tracking_number, carrier.token);
          } catch { /* fail silently per order */ }
        }
        return { ...o, track };
      })
    );
    shippedOrders = results
      .filter((r): r is PromiseFulfilledResult<ShippedWithTracking> => r.status === "fulfilled")
      .map((r) => r.value);
  }

  // Date-filter shipped orders by when they were updated (shipped out), in New York days
  function filterByPeriod<T extends { updated_at: string }>(list: T[], period: string): T[] {
    const weekStart = addDays(today, -6);
    const monthStart = `${today.slice(0, 7)}-01`;
    return list.filter((o) => {
      const day = nyDay(o.updated_at);
      if (period === "today") return day >= today;
      if (period === "week") return day >= weekStart;
      if (period === "month") return day >= monthStart;
      return true;
    });
  }
  const filteredShippedOrders = filterByPeriod(shippedOrders, activePeriod);

  // Open orders still owing pre-grades, oldest first (Pre-Grades tab and its badge)
  const pregradeOrders = openOrders.filter((o) => {
    const c = pregradesByOrder.get(o.id);
    return !!c && c.done < c.owed;
  });

  // All Orders: each listed order's card names and photos (from the embedded cards)
  const pastOrders = past.rows;
  const pastCount = past.count;
  const cardsByOrder: Record<string, string[]> = {};
  const photosByOrder: Record<string, string[]> = {};
  for (const order of [...activeOrders, ...pastOrders]) {
    for (const card of order.cards ?? []) {
      (cardsByOrder[order.id] ??= []).push(card.card_name);
      const urls: string[] = Array.isArray(card.photo_urls) ? card.photo_urls : [];
      if (urls.length > 0) (photosByOrder[order.id] ??= []).push(...urls);
    }
  }

  const awaitingCardsByOrder: Record<string, { name: string; photos: string[] }[]> = {};
  for (const card of awaitingCards) {
    if (!awaitingCardsByOrder[card.order_id]) awaitingCardsByOrder[card.order_id] = [];
    awaitingCardsByOrder[card.order_id].push({
      name: card.card_name,
      photos: Array.isArray(card.photo_urls) ? card.photo_urls : [],
    });
  }

  const cardCountByOrder: Record<string, number> = {};
  const completedCountByOrder: Record<string, number> = {};
  for (const row of fulfillmentCards) {
    cardCountByOrder[row.order_id] = (cardCountByOrder[row.order_id] ?? 0) + 1;
    if (row.completed) completedCountByOrder[row.order_id] = (completedCountByOrder[row.order_id] ?? 0) + 1;
  }

  const receivedAtByOrder: Record<string, string> = {};
  for (const ev of receivedEvents) {
    if (!receivedAtByOrder[ev.order_id]) receivedAtByOrder[ev.order_id] = ev.created_at;
  }

  // Due date (New York day) per fulfillment order, counted from when its cards arrived
  const dueDayByOrder: Record<string, string> = {};
  for (const o of fulfillmentOrders) {
    const rec = receivedAtByOrder[o.id] ?? o.created_at;
    dueDayByOrder[o.id] = addBusinessDays(nyDay(rec), TIER_TURNAROUND_DAYS[(o.restoration_tier as string) ?? "regular"] ?? 20);
  }

  // Sort fulfillment orders by due date (default) or completion progress
  const sortedFulfillmentOrders = [...fulfillmentOrders].sort((a, b) => {
    if (sortMode === "completion") {
      const totalA = cardCountByOrder[a.id] ?? 0;
      const doneA = completedCountByOrder[a.id] ?? 0;
      const totalB = cardCountByOrder[b.id] ?? 0;
      const doneB = completedCountByOrder[b.id] ?? 0;
      const pctA = totalA > 0 ? doneA / totalA : 0;
      const pctB = totalB > 0 ? doneB / totalB : 0;
      if (pctB !== pctA) return pctB - pctA; // most complete first
      return doneB - doneA;
    }
    const dueA = dueDayByOrder[a.id];
    const dueB = dueDayByOrder[b.id];
    if (dueA !== dueB) return dueA < dueB ? -1 : 1;
    // Same due day: the cards that arrived first go first
    const recA = receivedAtByOrder[a.id] ?? a.created_at;
    const recB = receivedAtByOrder[b.id] ?? b.created_at;
    return new Date(recA).getTime() - new Date(recB).getTime();
  }).filter((o) => !tierFilter || tierFilter === "all" || o.restoration_tier === tierFilter);

  // The All Orders chips' links: each keeps the other chips, and "Show all" past orders
  function ordersHref(overrides: Record<string, string | undefined>, allPast = showAllPast) {
    const p = new URLSearchParams();
    const merged = { tier: tierFilter, notes: notesFilter, method: methodFilter, ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== "all") p.set(k, v);
    }
    if (allPast) p.set("past", "all");
    const qs = p.toString();
    return `/admin${qs ? `?${qs}` : ""}`;
  }

  const totalOrderCount = listedOrderCount + shopOrderCount;
  // The Fulfillment Queue tab counts cards; the empty state checks orders
  const fulfillmentOrderCount = fulfillmentOrders.length;

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-6xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <h1 className="font-heading font-black text-3xl text-foreground">
              {activeTab === "fulfillment" ? "Fulfillment Queue" : "Orders"}
            </h1>
            <p className="text-muted-foreground text-sm mt-1 flex items-center gap-2">
              {activeTab === "fulfillment"
                ? "Cards in your hands — sorted oldest first"
                : `${totalOrderCount} total`}
              {activeTab !== "fulfillment" && (
                <Suspense fallback={null}>
                  <BacklogBadge />
                </Suspense>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {activeTab === "orders" && (
              <Suspense>
                <CardSearch />
              </Suspense>
            )}
            <DashboardLink
              href="/admin/orders/new"
              className="h-9 px-4 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors flex items-center whitespace-nowrap"
            >
              + New Order
            </DashboardLink>
          </div>
        </div>

        {/* Tabs */}
        <div className="relative flex gap-0.5 mb-7 overflow-x-auto after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border">
          <DashboardLink
            href="/admin"
            className={`px-3 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 relative z-10 shrink-0 whitespace-nowrap transition-colors ${
              activeTab === "orders"
                ? "bg-white border-border text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            All Orders
          </DashboardLink>
          <DashboardLink
            href="/admin?tab=pregrades"
            className={`px-3 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 relative z-10 shrink-0 whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === "pregrades"
                ? "bg-white border-border text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Pre-Grades
            {(pregradeOrders?.length ?? 0) > 0 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                activeTab === "pregrades" ? "bg-indigo-100 text-indigo-700" : "bg-indigo-600 text-white"
              }`}>
                {pregradeOrders?.length}
              </span>
            )}
          </DashboardLink>
          <DashboardLink
            href="/admin?tab=refunds"
            className={`px-3 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 relative z-10 shrink-0 whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === "refunds"
                ? "bg-white border-border text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Refund Requests
            {refundRequestCount > 0 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                activeTab === "refunds" ? "bg-red-100 text-red-700" : "bg-red-600 text-white"
              }`}>
                {refundRequestCount}
              </span>
            )}
          </DashboardLink>
          <DashboardLink
            href="/admin?tab=updates"
            className={`px-3 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 relative z-10 shrink-0 whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === "updates"
                ? "bg-white border-border text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Update Requests
            {updateRequestCount > 0 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                activeTab === "updates" ? "bg-red-100 text-red-700" : "bg-red-600 text-white"
              }`}>
                {updateRequestCount}
              </span>
            )}
          </DashboardLink>
          <DashboardLink
            href="/admin?tab=awaiting"
            className={`px-3 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 relative z-10 shrink-0 whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === "awaiting"
                ? "bg-white border-border text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Awaiting Cards
            {awaitingCount > 0 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                activeTab === "awaiting" ? "bg-orange-100 text-orange-700" : "bg-orange-500 text-white"
              }`}>
                {awaitingCount}
              </span>
            )}
          </DashboardLink>
          <DashboardLink
            href="/admin?tab=fulfillment"
            className={`px-3 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 relative z-10 shrink-0 whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === "fulfillment"
                ? "bg-white border-border text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Fulfillment Queue
            {fulfillmentCount > 0 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                activeTab === "fulfillment" ? "bg-primary/10 text-primary" : "bg-primary text-white"
              }`}>
                {fulfillmentCount}
              </span>
            )}
          </DashboardLink>
          <DashboardLink
            href="/admin?tab=shipped"
            className={`px-3 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 relative z-10 shrink-0 whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === "shipped"
                ? "bg-white border-border text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Shipped Out
            {shippedCount > 0 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                activeTab === "shipped" ? "bg-cyan-100 text-cyan-700" : "bg-cyan-600 text-white"
              }`}>
                {shippedCount}
              </span>
            )}
          </DashboardLink>
          <DashboardLink
            href="/admin?tab=insured"
            className={`px-3 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 relative z-10 shrink-0 whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === "insured"
                ? "bg-white border-border text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Insured
            {insuredCount > 0 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                activeTab === "insured" ? "bg-emerald-100 text-emerald-700" : "bg-emerald-600 text-white"
              }`}>
                {insuredCount}
              </span>
            )}
          </DashboardLink>
          <DashboardLink
            href="/admin?tab=videos"
            className={`px-3 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 relative z-10 shrink-0 whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === "videos"
                ? "bg-white border-border text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Videos
            {videosCount > 0 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                activeTab === "videos" ? "bg-pink-100 text-pink-700" : "bg-pink-600 text-white"
              }`}>
                {videosCount}
              </span>
            )}
          </DashboardLink>
          <DashboardLink
            href="/admin?tab=gift-cards"
            className={`px-3 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 relative z-10 shrink-0 whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === "gift-cards"
                ? "bg-white border-border text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            🎁 Gift Cards
            {giftCardCount > 0 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                activeTab === "gift-cards" ? "bg-yellow-100 text-yellow-700" : "bg-yellow-500 text-white"
              }`}>
                {giftCardCount}
              </span>
            )}
          </DashboardLink>
        </div>

        {/* ── ORDERS TAB ── */}
        {activeTab === "orders" && (
          <>
            {/* Month tiles and charts: streamed in, so the list below doesn't wait for them */}
            <Suspense fallback={<DashboardMetricsFallback />}>
              <DashboardMetrics today={today} />
            </Suspense>

            {/* Tier filter + Missing Notes toggle */}
            {(() => {
              return (
                <>
                  <div className="flex gap-2 flex-wrap mb-2">
                    {[["all", "All Tiers"], ["fast_pass", "Fast Pass"], ["elite", "Diamond"], ["ultra_premium", "Platinum"], ["premium", "Gold"], ["expedited", "Silver"], ["regular", "Bronze"], ["prep", "Prep"]].map(([val, label]) => (
                      <DashboardLink key={val} href={ordersHref({ tier: val })}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
                          (tierFilter ?? "all") === val
                            ? "bg-foreground text-background border-foreground"
                            : "bg-white text-muted-foreground border-border hover:border-foreground"
                        }`}
                      >{label}</DashboardLink>
                    ))}
                    <div className="h-px w-px" />
                    <DashboardLink
                      href={ordersHref({ notes: notesFilter === "missing" ? undefined : "missing" })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
                        notesFilter === "missing"
                          ? "bg-red-600 text-white border-red-600"
                          : "bg-white text-muted-foreground border-border hover:border-foreground"
                      }`}
                    >
                      {notesFilter === "missing" ? "★ Missing Notes" : "Missing Notes"}
                    </DashboardLink>
                  </div>
                  <div className="flex gap-2 flex-wrap mb-3 items-center">
                    <span className="text-xs text-muted-foreground font-semibold">Paid via:</span>
                    {[["all", "All"], ["card", "Card"], ["gift_card", "Gift Card"], ["cash", "Cash"], ["venmo", "Venmo"], ["zelle", "Zelle"], ["check", "Check"], ["other", "Other"], ["unset", "Not Set"]].map(([val, label]) => (
                      <DashboardLink key={val} href={ordersHref({ method: val })}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
                          (methodFilter ?? "all") === val
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-white text-muted-foreground border-border hover:border-primary/40"
                        }`}
                      >{label}</DashboardLink>
                    ))}
                  </div>
                </>
              );
            })()}

            {/* Active orders */}
            {activeOrders.length === 0 ? (
              <div className="bg-white rounded-xl border border-border p-12 text-center text-muted-foreground">
                {notesFilter === "missing"
                  ? "No completed orders with missing restorer notes."
                  : tierFilter && tierFilter !== "all"
                  ? `No active ${TIER_STYLES[tierFilter]?.label ?? tierFilter} orders.`
                  : "No active orders."}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {activeOrders.map((order) => (
                  <DashboardLink
                    key={order.id}
                    href={`/admin/orders/${order.id}`}
                    className="bg-white rounded-xl border border-border p-5 flex flex-col sm:flex-row sm:items-center gap-4 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1 flex-wrap">
                        <span className="font-heading font-black text-foreground">{/^\d+$/.test(String(order.order_number)) ? `R${order.order_number}` : order.order_number}</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-600"}`}>
                          {ORDER_STATUSES[order.status as OrderStatus]?.label ?? order.status}
                        </span>
                        {order.restoration_tier && TIER_BADGES[order.restoration_tier] && (
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TIER_BADGES[order.restoration_tier as RestorationTierId].color}`}>
                            {TIER_BADGES[order.restoration_tier as RestorationTierId].label}
                          </span>
                        )}
                        {(order.insurance_declared_value_cents ?? 0) > 0 && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                            Insured ${((order.insurance_declared_value_cents ?? 0) / 100).toFixed(0)}
                          </span>
                        )}
                        {pregradesByOrder.get(order.id) && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                            🔍 {pregradeLabel(pregradesByOrder.get(order.id)!)}
                          </span>
                        )}
                        {order.instagram_feature && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-pink-100 text-pink-700">
                            🎬 Video
                          </span>
                        )}
                        {order.payment_method && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                            {({ card: "💳 Card", gift_card: "🎁 Gift Card", cash: "💵 Cash", venmo: "Venmo", zelle: "Zelle", check: "Check", other: "Other" } as Record<string, string>)[order.payment_method] ?? order.payment_method}
                          </span>
                        )}
                      </div>
                      <p className="font-medium text-foreground">{order.customer_name}</p>
                      <p className="text-sm text-muted-foreground">{order.customer_email}</p>
                      {order.customer_phone && <p className="text-sm text-muted-foreground">{order.customer_phone}</p>}
                      {cardsByOrder[order.id]?.length > 0 && (
                        <p className="text-sm text-foreground font-medium mt-1">{cardsByOrder[order.id].join(", ")}</p>
                      )}
                      {photosByOrder[order.id]?.length > 0 && (
                        <div className="flex gap-1.5 mt-2 flex-wrap">
                          {photosByOrder[order.id].slice(0, 5).map((url, i) => (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img key={i} src={thumbnail(url, 48)} alt="Card" loading="lazy" decoding="async" className="w-12 h-12 object-cover rounded-lg border border-border" />
                          ))}
                          {photosByOrder[order.id].length > 5 && (
                            <div className="w-12 h-12 rounded-lg border border-border bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground">
                              +{photosByOrder[order.id].length - 5}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex sm:flex-col items-center sm:items-end gap-4 sm:gap-1">
                      <span className="font-heading font-black text-xl text-primary">{formatCurrency(order.total_cents)}</span>
                      <span className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleString("en-US", { timeZone: "America/New_York" })}</span>
                    </div>
                  </DashboardLink>
                ))}
              </div>
            )}

            {/* Past orders */}
            {pastOrders.length > 0 && (
              <div className="mt-10">
                <h2 className="font-heading font-black text-xl text-foreground mb-4">
                  Past Orders
                  <span className="ml-2 text-sm font-normal text-muted-foreground">({pastCount})</span>
                </h2>
                <div className="flex flex-col gap-3">
                  {pastOrders.map((order) => (
                    <DashboardLink
                      key={order.id}
                      href={`/admin/orders/${order.id}`}
                      className="bg-white rounded-xl border border-border p-5 flex flex-col sm:flex-row sm:items-center gap-4 hover:border-primary/40 transition-colors opacity-70 hover:opacity-100"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1 flex-wrap">
                          <span className="font-heading font-black text-foreground">{/^\d+$/.test(String(order.order_number)) ? `R${order.order_number}` : order.order_number}</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-600"}`}>
                            {ORDER_STATUSES[order.status as OrderStatus]?.label ?? order.status}
                          </span>
                          {order.restoration_tier && TIER_BADGES[order.restoration_tier] && (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TIER_BADGES[order.restoration_tier as RestorationTierId].color}`}>
                              {TIER_BADGES[order.restoration_tier as RestorationTierId].label}
                            </span>
                          )}
                          {(order.insurance_declared_value_cents ?? 0) > 0 && (
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                              Insured ${((order.insurance_declared_value_cents ?? 0) / 100).toFixed(0)}
                            </span>
                          )}
                          {pregradesByOrder.get(order.id) && (
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                              🔍 {pregradeLabel(pregradesByOrder.get(order.id)!)}
                            </span>
                          )}
                          {order.instagram_feature && (
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-pink-100 text-pink-700">
                              Video
                            </span>
                          )}
                          {order.payment_method && (
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                              {({ card: "💳 Card", gift_card: "🎁 Gift Card", cash: "💵 Cash", venmo: "Venmo", zelle: "Zelle", check: "Check", other: "Other" } as Record<string, string>)[order.payment_method] ?? order.payment_method}
                            </span>
                          )}
                        </div>
                        <p className="font-medium text-foreground">{order.customer_name}</p>
                        <p className="text-sm text-muted-foreground">{order.customer_email}</p>
                        {cardsByOrder[order.id]?.length > 0 && (
                          <p className="text-sm text-foreground font-medium mt-1">{cardsByOrder[order.id].join(", ")}</p>
                        )}
                        {photosByOrder[order.id]?.length > 0 && (
                          <div className="flex gap-1.5 mt-2 flex-wrap">
                            {photosByOrder[order.id].slice(0, 5).map((url, i) => (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img key={i} src={thumbnail(url, 48)} alt="Card" loading="lazy" decoding="async" className="w-12 h-12 object-cover rounded-lg border border-border" />
                            ))}
                            {photosByOrder[order.id].length > 5 && (
                              <div className="w-12 h-12 rounded-lg border border-border bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground">
                                +{photosByOrder[order.id].length - 5}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex sm:flex-col items-center sm:items-end gap-4 sm:gap-1">
                        <span className="font-heading font-black text-xl text-primary">{formatCurrency(order.total_cents)}</span>
                        <span className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleString("en-US", { timeZone: "America/New_York" })}</span>
                      </div>
                    </DashboardLink>
                  ))}
                </div>
                {pastCount > pastOrders.length && (
                  <DashboardLink
                    href={ordersHref({}, true)}
                    className="mt-4 h-11 px-5 inline-flex items-center rounded-lg border border-border bg-white text-sm font-bold text-foreground hover:border-foreground transition-colors"
                  >
                    Show all {pastCount} past orders
                  </DashboardLink>
                )}
              </div>
            )}
          </>
        )}

        {/* ── AWAITING CARDS TAB ── */}
        {activeTab === "awaiting" && (() => {
          function ageBadge(createdAt: string) {
            const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
            let cls: string;
            if (days <= 3)       cls = "bg-green-100 text-green-700";
            else if (days <= 7)  cls = "bg-yellow-100 text-yellow-800";
            else if (days <= 14) cls = "bg-orange-100 text-orange-700";
            else                 cls = "bg-red-100 text-red-700";
            return { days, cls };
          }

          return (awaitingOrders ?? []).length === 0 ? (
            <div className="bg-white rounded-xl border border-border p-16 text-center">
              <p className="text-2xl mb-2">📬</p>
              <p className="font-heading font-black text-lg text-foreground">All cards received!</p>
              <p className="text-sm text-muted-foreground mt-1">No orders are waiting for cards to arrive.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {(awaitingOrders ?? []).map((order) => {
                const { days, cls } = ageBadge(order.created_at);
                return (
                  <DashboardLink
                    key={order.id}
                    href={`/admin/orders/${order.id}`}
                    className="bg-white rounded-xl border border-border p-5 flex flex-col sm:flex-row sm:items-start gap-4 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1 flex-wrap">
                        <span className="font-heading font-black text-foreground">{/^\d+$/.test(String(order.order_number)) ? `R${order.order_number}` : order.order_number}</span>
                        {order.restoration_tier && TIER_BADGES[order.restoration_tier] && (
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TIER_BADGES[order.restoration_tier as RestorationTierId].color}`}>
                            {TIER_BADGES[order.restoration_tier as RestorationTierId].label}
                          </span>
                        )}
                      </div>
                      <p className="font-medium text-foreground">{order.customer_name}</p>
                      <p className="text-sm text-muted-foreground mb-3">{order.customer_email}</p>
                      {(awaitingCardsByOrder[order.id] ?? []).map((card, i) => (
                        <div key={i} className="flex items-center gap-3 mb-2">
                          {card.photos[0] && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={thumbnail(card.photos[0], 48)} alt={card.name} loading="lazy" decoding="async" className="w-12 h-12 object-cover rounded-lg border border-border flex-shrink-0" />
                          )}
                          <span className="text-sm font-medium text-foreground">{card.name}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex sm:flex-col items-center sm:items-end gap-3 sm:pt-0.5">
                      <span className={`text-xs font-black px-3 py-1.5 rounded-full ${cls}`}>
                        {days === 0 ? "Today" : days === 1 ? "1 day" : `${days} days`}
                      </span>
                      <span className="font-heading font-black text-xl text-primary">{formatCurrency(order.total_cents)}</span>
                    </div>
                  </DashboardLink>
                );
              })}
            </div>
          );
        })()}

        {/* ── FULFILLMENT TAB ── */}
        {activeTab === "fulfillment" && (
          <>
            {/* Tier filter + sort */}
            <div className="flex gap-2 flex-wrap mb-3 items-center">
              {[["all", "All Tiers"], ["elite", "Diamond"], ["ultra_premium", "Platinum"], ["premium", "Gold"], ["expedited", "Silver"], ["regular", "Bronze"]].map(([val, label]) => {
                const sortSuffix = sortMode === "completion" ? "&sort=completion" : "";
                return (
                  <DashboardLink
                    key={val}
                    href={`/admin?tab=fulfillment&tier=${val}${sortSuffix}`}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
                      (tierFilter ?? "all") === val
                        ? "bg-foreground text-background border-foreground"
                        : "bg-white text-muted-foreground border-border hover:border-foreground"
                    }`}
                  >
                    {label}
                  </DashboardLink>
                );
              })}
              <div className="h-4 w-px bg-border mx-1" />
              {[["due", "Sort: Due Date"], ["completion", "Sort: Most Complete"]].map(([val, label]) => {
                const tierSuffix = tierFilter && tierFilter !== "all" ? `&tier=${tierFilter}` : "";
                return (
                  <DashboardLink
                    key={val}
                    href={`/admin?tab=fulfillment${tierSuffix}&sort=${val}`}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
                      (sortMode ?? "due") === val
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-white text-muted-foreground border-border hover:border-foreground"
                    }`}
                  >
                    {label}
                  </DashboardLink>
                );
              })}
            </div>

            {fulfillmentOrderCount === 0 ? (
              <div className="bg-white rounded-xl border border-border p-16 text-center">
                <p className="text-2xl mb-2">✅</p>
                <p className="font-heading font-black text-lg text-foreground">All caught up!</p>
                <p className="text-sm text-muted-foreground mt-1">No orders are waiting to be fulfilled.</p>
              </div>
            ) : sortedFulfillmentOrders.length === 0 ? (
              <div className="bg-white rounded-xl border border-border p-12 text-center text-muted-foreground text-sm">
                No {tierFilter && tierFilter !== "all" ? TIER_STYLES[tierFilter]?.label : ""} orders in queue.
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/40">
                      <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Order</th>
                      <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Customer</th>
                      <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Tier</th>
                      <th className="text-center px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Progress</th>
                      <th className="text-center px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Biz Days In</th>
                      <th className="text-center px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Biz Days Left</th>
                      <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFulfillmentOrders.map((order) => {
                      const tier = (order.restoration_tier as RestorationTierId | null) ?? "regular";
                      const tierStyle = TIER_STYLES[tier] ?? null;
                      const statusStyle = FULFILLMENT_STATUS_STYLES[order.status];
                      // Drop-off orders already have the cards — start the clock at order creation.
                      // Mail-in orders start the clock when "Cards Received" is pressed.
                      const isDropoff = (order as Record<string,unknown>).inbound_method === "dropoff";
                      const receivedAt = receivedAtByOrder[order.id] ?? (isDropoff ? order.created_at : null);
                      const bizDaysIn = receivedAt ? businessDaysSince(receivedAt, today) : null;
                      const turnaround = TIER_TURNAROUND_DAYS[tier] ?? 20;
                      const dueDay = receivedAt ? addBusinessDays(nyDay(receivedAt), turnaround) : null;
                      const daysUntilDue = dueDay ? businessDaysUntil(dueDay, today) : null;
                      const isOverdue = daysUntilDue !== null && daysUntilDue < 0;
                      const isDueSoon = daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= 2;
                      const cards = cardCountByOrder[order.id] ?? 0;

                      return (
                        <tr
                          key={order.id}
                          className={`border-b border-border last:border-0 hover:bg-secondary/20 transition-colors ${
                            isOverdue ? "bg-red-50/50" : isDueSoon ? "bg-yellow-50/40" : ""
                          }`}
                        >
                          <td className="px-4 py-3">
                            <DashboardLink href={`/admin/orders/${order.id}`} className="font-mono font-bold text-primary hover:underline">
                              {/^\d+$/.test(String(order.order_number)) ? `R${order.order_number}` : order.order_number}
                            </DashboardLink>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-foreground">{order.customer_name}</p>
                            <p className="text-xs text-muted-foreground">{order.customer_email}</p>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {tierStyle ? (
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${tierStyle.cls}`}>
                                  {tierStyle.label}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                              {order.instagram_feature && (
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-pink-100 text-pink-700">🎬</span>
                              )}
                              {pregradesByOrder.get(order.id) && (
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                                  🔍 {pregradeLabel(pregradesByOrder.get(order.id)!)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {(() => {
                              const done = completedCountByOrder[order.id] ?? 0;
                              const allDone = cards > 0 && done === cards;
                              return (
                                <span className={`font-bold text-sm ${allDone ? "text-green-600" : done > 0 ? "text-yellow-600" : "text-foreground"}`}>
                                  {done}/{cards}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {bizDaysIn !== null
                              ? <span className="font-bold text-sm text-foreground">{bizDaysIn}d</span>
                              : <span className="text-xs text-muted-foreground">—</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-center">
                            {daysUntilDue !== null
                              ? <span className={`font-black text-sm ${isOverdue ? "text-red-600" : isDueSoon ? "text-yellow-600" : "text-green-600"}`}>
                                  {isOverdue ? `${Math.abs(daysUntilDue)}d over` : `${daysUntilDue}d`}
                                </span>
                              : <span className="text-xs text-muted-foreground">—</span>
                            }
                          </td>
                          <td className="px-4 py-3">
                            {statusStyle && (
                              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${statusStyle.cls}`}>
                                {statusStyle.label}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <DashboardLink href={`/admin/orders/${order.id}`} className="text-xs font-bold text-primary hover:underline">
                              View →
                            </DashboardLink>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ── SHIPPED OUT TAB ── */}
        {activeTab === "shipped" && (() => {
          const missingTracking = shippedOrders.filter((o) => !o.tracking_number);
          const SHIP_BADGE: Record<string, { label: string; cls: string }> = {
            UNKNOWN:     { label: "Waiting to be Shipped Out", cls: "bg-gray-100 text-gray-700" },
            PRE_TRANSIT: { label: "Waiting to be Shipped Out", cls: "bg-gray-100 text-gray-700" },
            TRANSIT:     { label: "Out for Delivery",           cls: "bg-blue-100 text-blue-700" },
            DELIVERED:   { label: "Delivered",                  cls: "bg-green-100 text-green-700" },
            RETURNED:    { label: "Being Returned",             cls: "bg-orange-100 text-orange-700" },
            FAILURE:     { label: "Delivery Issue",             cls: "bg-red-100 text-red-700" },
          };
          const PERIOD_FILTERS = [
            { value: "today", label: "Today" },
            { value: "week",  label: "This Week" },
            { value: "month", label: "This Month" },
            { value: "all",   label: "All Time" },
          ];
          return (
            <>
              {/* Sync delivered — always shown on shipped tab */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-5 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1">
                  <p className="font-bold text-emerald-800 text-sm">Sync delivered status</p>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    Checks every shipped order against USPS via Shippo and marks any confirmed deliveries as Delivered.
                  </p>
                </div>
                <SyncDeliveredButton />
              </div>

              {/* Sync banner — shown when there are orders with no tracking number */}
              {missingTracking.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-5 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1">
                    <p className="font-bold text-yellow-800 text-sm">
                      {missingTracking.length} order{missingTracking.length !== 1 ? "s" : ""} missing tracking numbers
                    </p>
                    <p className="text-xs text-yellow-700 mt-0.5">
                      Click to pull tracking numbers from Shippo automatically. Orders with no Shippo label will need manual entry.
                    </p>
                  </div>
                  <SyncTrackingButton />
                </div>
              )}

              {/* Period filter pills */}
              <div className="flex gap-2 flex-wrap mb-4 items-center">
                {PERIOD_FILTERS.map(({ value, label }) => (
                  <DashboardLink
                    key={value}
                    href={`/admin?tab=shipped&period=${value}`}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
                      activePeriod === value
                        ? "bg-foreground text-background border-foreground"
                        : "bg-white text-muted-foreground border-border hover:border-foreground"
                    }`}
                  >
                    {label}
                  </DashboardLink>
                ))}
                <span className="text-xs text-muted-foreground ml-1">
                  {filteredShippedOrders.length} order{filteredShippedOrders.length !== 1 ? "s" : ""}
                </span>
                <span className="text-xs text-red-500 font-semibold ml-1 flex items-center gap-1">
                  <span className="text-red-500 font-black">*</span> = restorer notes missing
                </span>
              </div>

              {shippedRaw.length === 0 ? (
                <div className="bg-white rounded-xl border border-border p-16 text-center">
                  <p className="text-2xl mb-2">📦</p>
                  <p className="font-heading font-black text-lg text-foreground">No packages out</p>
                  <p className="text-sm text-muted-foreground mt-1">No orders have been shipped yet.</p>
                </div>
              ) : filteredShippedOrders.length === 0 ? (
                <div className="bg-white rounded-xl border border-border p-12 text-center text-muted-foreground text-sm">
                  No shipped orders for this time period.
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-secondary/40">
                        <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Order</th>
                        <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Customer</th>
                        <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Shipped</th>
                        <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Tracking #</th>
                        <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Status</th>
                        <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Details</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredShippedOrders.map((order) => {
                        const hasTracking = !!order.tracking_number;
                        const missingNotes = !order.admin_notes || (order.admin_notes as string).trim() === "";
                        const trackStatus = order.track?.trackingStatus?.status ?? "UNKNOWN";
                        const statusDetails = order.track?.trackingStatus?.statusDetails ?? null;
                        const eta = order.track?.eta ?? null;
                        const badge = hasTracking
                          ? (SHIP_BADGE[trackStatus] ?? SHIP_BADGE.UNKNOWN)
                          : { label: "No Tracking Number", cls: "bg-red-100 text-red-700" };

                        return (
                          <tr key={order.id} className={`border-b border-border last:border-0 hover:bg-secondary/20 transition-colors ${!hasTracking ? "bg-red-50/30" : ""}`}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                <DashboardLink href={`/admin/orders/${order.id}`} className="font-mono font-bold text-primary hover:underline">
                                  {/^\d+$/.test(String(order.order_number)) ? `R${order.order_number}` : order.order_number}
                                </DashboardLink>
                                {missingNotes && (
                                  <span className="text-red-500 font-black text-base leading-none" title="Restorer notes missing">*</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-foreground">{order.customer_name}</p>
                              <p className="text-xs text-muted-foreground">{order.customer_email}</p>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(order.updated_at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                            </td>
                            <td className="px-4 py-3">
                              {hasTracking
                                ? <p className="font-mono text-xs text-foreground">{order.tracking_number}</p>
                                : <p className="text-xs text-red-500 font-medium">Missing</p>
                              }
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${badge.cls}`}>
                                {badge.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 max-w-[200px]">
                              {statusDetails && (
                                <p className="text-xs text-muted-foreground truncate">{statusDetails}</p>
                              )}
                              {eta && (
                                <p className="text-xs font-semibold text-foreground mt-0.5">
                                  ETA: {new Date(eta).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <DashboardLink href={`/admin/orders/${order.id}`} className="text-xs font-bold text-primary hover:underline">
                                View →
                              </DashboardLink>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          );
        })()}

        {/* ── INSURED TAB ── */}
        {activeTab === "insured" && (
          <>
            {(insuredOrders ?? []).length === 0 ? (
              <div className="bg-white rounded-xl border border-border p-16 text-center">
                <p className="text-2xl mb-2">🛡️</p>
                <p className="font-heading font-black text-lg text-foreground">No insured orders</p>
                <p className="text-sm text-muted-foreground mt-1">Orders with package insurance will appear here.</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/40">
                      <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Order</th>
                      <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Customer</th>
                      <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Status</th>
                      <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Tier</th>
                      <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Declared Value</th>
                      <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Coverage</th>
                      <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Date</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {(insuredOrders ?? []).map((order) => {
                      const tier = order.restoration_tier ? TIER_STYLES[order.restoration_tier] : null;
                      const declaredValue = order.insurance_declared_value_cents as number;
                      const insuranceType = order.insurance_type as string | null;
                      return (
                        <tr key={order.id} className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-3">
                            <DashboardLink href={`/admin/orders/${order.id}`} className="font-mono font-bold text-primary hover:underline">
                              {/^\d+$/.test(String(order.order_number)) ? `R${order.order_number}` : order.order_number}
                            </DashboardLink>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-foreground">{order.customer_name}</p>
                            <p className="text-xs text-muted-foreground">{order.customer_email}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-600"}`}>
                              {ORDER_STATUSES[order.status as OrderStatus]?.label ?? order.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {tier ? (
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${tier.cls}`}>{tier.label}</span>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-3 font-bold text-foreground">
                            ${(declaredValue / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${insuranceType === "round_trip" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>
                              {insuranceType === "round_trip" ? "Round Trip" : insuranceType === "return" ? "Return" : "Inbound"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(order.created_at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <DashboardLink href={`/admin/orders/${order.id}`} className="text-xs font-bold text-primary hover:underline">View →</DashboardLink>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ── GIFT CARDS TAB ── */}
        {/* ── PRE-GRADES TAB ── */}
        {activeTab === "pregrades" && (
          <>
            {(pregradeOrders ?? []).length === 0 ? (
              <div className="bg-white rounded-xl border border-border p-16 text-center">
                <p className="text-2xl mb-2">🔍</p>
                <p className="font-heading font-black text-lg text-foreground">No pre-grades owed</p>
                <p className="text-sm text-muted-foreground mt-1">Open orders with a paid pre-grade that hasn&apos;t been sent will appear here.</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/40">
                      <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Order</th>
                      <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Customer</th>
                      <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Status</th>
                      <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Tier</th>
                      <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Pre-Grades</th>
                      <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(pregradeOrders ?? []).map((order) => {
                      const count = pregradesByOrder.get(order.id)!;
                      const tier = order.restoration_tier ? TIER_BADGES[order.restoration_tier] : null;
                      return (
                        <tr key={order.id} className="border-b border-border last:border-0 hover:bg-secondary/30">
                          <td className="px-4 py-3">
                            <DashboardLink href={`/admin/orders/${order.id}`} className="font-heading font-black text-primary hover:underline">
                              {/^\d+$/.test(String(order.order_number)) ? `R${order.order_number}` : order.order_number}
                            </DashboardLink>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-foreground">{order.customer_name}</p>
                            <p className="text-xs text-muted-foreground">{order.customer_email}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-600"}`}>
                              {ORDER_STATUSES[order.status as OrderStatus]?.label ?? order.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {tier ? <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${tier.color}`}>{tier.label}</span> : <span className="text-xs text-muted-foreground">{order.restoration_tier ?? "—"}</span>}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-bold text-indigo-700">{count.owed - count.done} owed</span>
                            <span className="text-xs text-muted-foreground"> · {count.done}/{count.owed} done</span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(order.created_at).toLocaleDateString("en-US", { timeZone: "America/New_York" })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ── REFUND REQUESTS TAB ── */}
        {activeTab === "refunds" && (
          <Suspense fallback={<RefundRequestsFallback />}>
            <RefundRequestsTab />
          </Suspense>
        )}

        {/* ── UPDATE REQUESTS TAB ── */}
        {activeTab === "updates" && (
          <div className="bg-white rounded-xl border border-border overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border">
              <div>
                <h2 className="font-heading font-black text-lg text-foreground">Customers waiting on an update</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Asked from their account, oldest first. Your reply is emailed to them and closes the request.</p>
              </div>
              <DashboardLink href="/admin/cases?filter=all&type=inquiry" className="text-sm font-semibold text-primary hover:underline">All update requests →</DashboardLink>
            </div>
            {(updateRequests ?? []).length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-muted-foreground">No one is waiting on an update right now.</p>
            ) : (
              <ul className="divide-y divide-border">
                {(updateRequests ?? []).map((u) => {
                  const ref = (u.order_ref as string | null) ?? "";
                  const isKit = /^K\d+$/.test(ref);
                  const order = isKit ? updateKitMap.get(ref) : updateOrderMap.get(ref);
                  const statusLabel = order
                    ? isKit ? order.status : ORDER_STATUSES[order.status as OrderStatus]?.label ?? order.status
                    : null;
                  const days = daysWaiting(u.created_at);
                  return (
                    <li key={u.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4">
                      <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                        <p className="font-semibold text-foreground">
                          {isKit ? `Kit order ${ref}` : `Order ${orderLabel(ref)}`}
                          {statusLabel && <span className="ml-2 text-xs font-medium text-muted-foreground capitalize">{statusLabel}</span>}
                        </p>
                        <p className="text-sm text-muted-foreground truncate">{u.customer_name || "Customer"} · {u.customer_email}</p>
                      </div>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${days >= 2 ? "bg-red-100 text-red-700" : "bg-secondary text-muted-foreground"}`}>
                        {days === 0 ? "Asked today" : `Waiting ${days} day${days === 1 ? "" : "s"}`}
                      </span>
                      {order && (
                        <DashboardLink href={isKit ? "/admin/shop-orders" : `/admin/orders/${order.id}`} className="text-sm font-semibold text-muted-foreground hover:text-foreground">
                          Open order
                        </DashboardLink>
                      )}
                      <DashboardLink href={`/admin/cases/${u.id}`} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold flex items-center hover:bg-primary/90 transition-colors">
                        Reply
                      </DashboardLink>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {activeTab === "gift-cards" && (() => {
          const gc = giftCards ?? [];
          const active = gc.filter((c) => c.status === "active");
          const totalValueCents = gc.reduce((s, c) => s + (c.value_cents ?? 0), 0);
          const totalRemainingCents = gc.reduce((s, c) => s + (c.remaining_cents ?? 0), 0);
          return (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-xl border border-border p-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Total Issued</p>
                  <p className="font-heading font-black text-3xl text-foreground">{gc.length}</p>
                </div>
                <div className="bg-white rounded-xl border border-border p-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Active</p>
                  <p className="font-heading font-black text-3xl text-green-600">{active.length}</p>
                </div>
                <div className="bg-white rounded-xl border border-border p-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Total Sold</p>
                  <p className="font-heading font-black text-3xl text-foreground">{formatCurrency(totalValueCents)}</p>
                </div>
                <div className="bg-white rounded-xl border border-border p-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Outstanding</p>
                  <p className="font-heading font-black text-3xl text-blue-600">{formatCurrency(totalRemainingCents)}</p>
                </div>
              </div>

              {gc.length === 0 ? (
                <div className="bg-white rounded-xl border border-border p-16 text-center">
                  <p className="text-3xl mb-2">🎁</p>
                  <p className="font-heading font-black text-lg text-foreground">No gift cards yet</p>
                  <p className="text-sm text-muted-foreground mt-1">Gift card purchases will appear here.</p>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-secondary/40">
                        <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Code</th>
                        <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Status</th>
                        <th className="text-right px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Value</th>
                        <th className="text-right px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Remaining</th>
                        <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Purchaser</th>
                        <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Recipient</th>
                        <th className="text-left px-4 py-3 font-bold text-muted-foreground text-xs uppercase tracking-wide">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gc.map((card) => (
                        <tr key={card.id} className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-3 font-mono font-bold text-xs text-foreground">{card.code}</td>
                          <td className="px-4 py-3">
                            {card.status === "active" ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">Active</span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-500">Used</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(card.value_cents ?? 0)}</td>
                          <td className="px-4 py-3 text-right font-bold">
                            {(card.remaining_cents ?? 0) === (card.value_cents ?? 0) ? (
                              <span className="text-blue-600">{formatCurrency(card.remaining_cents ?? 0)}</span>
                            ) : (card.remaining_cents ?? 0) === 0 ? (
                              <span className="text-gray-400">$0.00</span>
                            ) : (
                              <span className="text-amber-600">{formatCurrency(card.remaining_cents ?? 0)}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-foreground">{card.purchaser_name ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">{card.purchaser_email ?? ""}</p>
                          </td>
                          <td className="px-4 py-3">
                            {card.recipient_name ? (
                              <>
                                <p className="font-medium text-foreground">{card.recipient_name}</p>
                                <p className="text-xs text-muted-foreground">{card.recipient_email ?? ""}</p>
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">Self</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(card.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          );
        })()}

        {/* ── VIDEOS TAB ── */}
        {activeTab === "videos" && (
          <>
            <div className="bg-pink-50 border border-pink-200 rounded-xl p-4 mb-5">
              <p className="font-bold text-pink-900 text-sm">Instagram Feature Orders</p>
              <p className="text-xs text-pink-700 mt-0.5">
                These customers paid $100 to have their card featured in an Instagram video. Film and post before shipping their cards back.
              </p>
            </div>
            {(videoOrders ?? []).length === 0 ? (
              <div className="bg-white rounded-xl border border-border p-16 text-center">
                <p className="text-2xl mb-2">🎬</p>
                <p className="font-heading font-black text-lg text-foreground">No video orders</p>
                <p className="text-sm text-muted-foreground mt-1">Orders with the Instagram feature add-on will appear here.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {(videoOrders ?? []).map((order) => {
                  const tier = order.restoration_tier ? TIER_STYLES[order.restoration_tier] : null;
                  const cards = videoCardsByOrder[order.id] ?? [];
                  return (
                    <DashboardLink
                      key={order.id}
                      href={`/admin/orders/${order.id}`}
                      className="bg-white rounded-xl border-2 border-pink-200 p-5 flex flex-col sm:flex-row sm:items-start gap-4 hover:border-pink-400 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1 flex-wrap">
                          <span className="font-heading font-black text-foreground">{/^\d+$/.test(String(order.order_number)) ? `R${order.order_number}` : order.order_number}</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-600"}`}>
                            {ORDER_STATUSES[order.status as OrderStatus]?.label ?? order.status}
                          </span>
                          {tier && (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${tier.cls}`}>{tier.label}</span>
                          )}
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-pink-100 text-pink-700">Instagram Video</span>
                        </div>
                        <p className="font-medium text-foreground">{order.customer_name}</p>
                        <p className="text-sm text-muted-foreground mb-3">{order.customer_email}</p>
                        {cards.length > 0 && (
                          <div className="flex flex-wrap gap-3 mt-2">
                            {cards.map((card, i) => (
                              <div key={i} className="flex items-center gap-2">
                                {card.photo && (
                                  /* eslint-disable-next-line @next/next/no-img-element */
                                  <img src={thumbnail(card.photo, 48)} alt={card.name} loading="lazy" decoding="async" className="w-12 h-12 object-cover rounded-lg border border-pink-200 flex-shrink-0" />
                                )}
                                <span className="text-sm font-medium text-foreground">{card.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex sm:flex-col items-center sm:items-end gap-3 sm:pt-0.5">
                        <span className="font-heading font-black text-xl text-primary">{formatCurrency(order.total_cents)}</span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(order.created_at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })}
                        </span>
                      </div>
                    </DashboardLink>
                  );
                })}
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
