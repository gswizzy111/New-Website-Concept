import type { SupabaseClient } from "@supabase/supabase-js";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import { likeExact } from "@/lib/like-exact";
import { cleanSearch, etDate, orderNumberFrom, statusLabel, tierLabel } from "@/lib/support-view";
import { RECEIVED_EVENT } from "@/lib/intake/migration";
import { INTAKE_START } from "@/lib/intake/start";
import { isMissingSchema, MIGRATION_NOTICE } from "./_components/schema";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  awaiting_payment: "bg-gray-100 text-gray-600",
  awaiting_cards: "bg-amber-100 text-amber-700",
  received: "bg-blue-100 text-blue-700",
  in_progress: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
  shipped_back: "bg-cyan-100 text-cyan-700",
  delivered: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

const ORDER_COLUMNS = "id, order_number, customer_name, customer_email, status, payment_status, restoration_tier, inbound_method, created_at";
const SEARCH_LIMIT = 50;
const PREVIEW = 10; // rows of each queue on the main view
const PAGE = 50; // rows per page of one queue

type OrderRow = {
  id: string; order_number: string; customer_name: string | null; customer_email: string | null;
  status: string; payment_status: string | null; restoration_tier: string | null; inbound_method: string | null; created_at: string;
};
type BagRow = {
  id: string; bag_code: string; tier: string; received_on: string | null; due_date: string | null; created_at: string;
  order_id: string; orders: { order_number: string; customer_name: string | null } | null;
};
type Counts = { total: number; received: number; awaiting: number };
type CodeMatch = { kind: "card" | "bag"; id: string; code: string; orderId: string };

const QUEUES = {
  awaiting: { title: "Waiting to receive", hint: "Orders whose cards haven't arrived yet (Awaiting Cards)." },
  unchecked: { title: "Waiting to receive: marked received, not checked in", hint: "Orders marked received since Receiving started (Nov 23) whose cards aren't checked in yet: drop-offs entered as received, or orders marked received from the order page. Orders already in the shop before then stay out." },
  partial: { title: "Partially received", hint: "Some cards arrived; the rest are still on the way." },
  labels: { title: "Bags missing labels", hint: "Bags still in work whose label hasn't been printed yet." },
} as const;
type QueueKey = keyof typeof QUEUES;
/** Orders that are done with (their bags need no label, their missing cards no chasing). */
const CLOSED_STATUSES = "(completed,shipped_back,delivered,cancelled)";

async function loadQueue(admin: SupabaseClient, key: QueueKey, from: number, to: number) {
  if (key === "awaiting") {
    const { data, count, error } = await admin.from("orders").select(ORDER_COLUMNS, { count: "exact" })
      .eq("status", "awaiting_cards").order("created_at", { ascending: false }).range(from, to);
    return { orders: (data ?? []) as OrderRow[], bags: [] as BagRow[], count: count ?? 0, error };
  }
  if (key === "unchecked") {
    // Unfinished, not-refunded cards that were never checked in through receiving,
    // on orders created or marked received since Receiving started (older orders stay out)
    const { data: events, error: eventsError } = await admin.from("order_events").select("order_id")
      .eq("event_type", "status_updated").eq("description", RECEIVED_EVENT).gte("created_at", INTAKE_START).limit(1000);
    if (eventsError) return { orders: [] as OrderRow[], bags: [] as BagRow[], count: 0, error: eventsError };
    const receivedSince = [...new Set(((events ?? []) as { order_id: string | null }[]).map((e) => e.order_id).filter((id): id is string => !!id))];
    let q = admin.from("orders").select(`${ORDER_COLUMNS}, cards!inner(id)`, { count: "exact" })
      .in("status", ["received", "in_progress"])
      .is("cards.received_at", null).is("cards.bag_id", null).eq("cards.awaiting_arrival", false)
      .eq("cards.completed", false).neq("cards.status", "refunded");
    q = receivedSince.length
      ? q.or(`created_at.gte.${INTAKE_START},id.in.(${receivedSince.join(",")})`)
      : q.gte("created_at", INTAKE_START);
    const { data, count, error } = await q.order("created_at", { ascending: false }).range(from, to);
    return { orders: (data ?? []) as OrderRow[], bags: [] as BagRow[], count: count ?? 0, error };
  }
  if (key === "partial") {
    const { data, count, error } = await admin.from("orders").select(`${ORDER_COLUMNS}, cards!inner(id)`, { count: "exact" })
      .eq("cards.awaiting_arrival", true).neq("cards.status", "refunded").eq("cards.completed", false)
      .not("status", "in", CLOSED_STATUSES)
      .order("created_at", { ascending: false }).range(from, to);
    return { orders: (data ?? []) as OrderRow[], bags: [] as BagRow[], count: count ?? 0, error };
  }
  const { data, count, error } = await admin.from("tier_bags")
    .select("id, bag_code, tier, received_on, due_date, created_at, order_id, orders!inner(order_number, customer_name, status)", { count: "exact" })
    // Completed bags (historical ones included) and bags of finished orders don't need a label any more
    .is("label_printed_at", null).is("completed_at", null).not("orders.status", "in", CLOSED_STATUSES)
    .order("created_at", { ascending: false }).range(from, to);
  return { orders: [] as OrderRow[], bags: (data ?? []) as unknown as BagRow[], count: count ?? 0, error };
}

/** "3 of 5 received" for each order listed (one bounded read). */
async function cardCounts(admin: SupabaseClient, orderIds: string[]): Promise<{ counts: Map<string, Counts>; schemaMissing: boolean }> {
  const counts = new Map<string, Counts>();
  if (!orderIds.length) return { counts, schemaMissing: false };
  let schemaMissing = false;
  type Row = { order_id: string; status: string | null; received_at?: string | null; awaiting_arrival?: boolean };
  const first = await admin.from("cards").select("order_id, status, received_at, awaiting_arrival").in("order_id", orderIds).limit(5000);
  let rows = (first.data ?? []) as Row[];
  if (first.error && isMissingSchema(first.error)) {
    schemaMissing = true;
    const { data } = await admin.from("cards").select("order_id, status").in("order_id", orderIds).limit(5000);
    rows = (data ?? []) as Row[];
  }
  for (const c of rows as { order_id: string; status: string | null; received_at?: string | null; awaiting_arrival?: boolean }[]) {
    if (c.status === "refunded") continue;
    const n = counts.get(c.order_id) ?? { total: 0, received: 0, awaiting: 0 };
    n.total++;
    if (c.received_at) n.received++;
    if (c.awaiting_arrival) n.awaiting++;
    counts.set(c.order_id, n);
  }
  return { counts, schemaMissing };
}

/** "CD-2549-03" (a Card ID) or "CD-2549-P2" (a Bag ID) typed into the search. */
function codeFrom(q: string): string | null {
  const m = /^#?\s?(?:cd[\s-]?)?(\d{1,9})[\s-]([a-z]\d{0,3}|\d{2,4})$/i.exec(q);
  return m ? `CD-${m[1]}-${m[2].toUpperCase()}` : null;
}

export default async function ReceivingPage({ searchParams }: { searchParams: Promise<{ q?: string; queue?: string; page?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const query = cleanSearch(sp.q);
  const queue = (Object.keys(QUEUES) as QueueKey[]).find((k) => k === sp.queue) ?? null;
  const page = Math.max(1, Math.min(1000, Number.parseInt(sp.page ?? "1", 10) || 1));
  const admin = createAdminClient();

  let schemaMissing = false;
  let loadError = "";

  // ── Search ──────────────────────────────────────────────────────────────
  let results: OrderRow[] = [];
  const codeMatches: CodeMatch[] = [];
  if (query) {
    const n = orderNumberFrom(query);
    const code = codeFrom(query);
    const pattern = `%${likeExact(query)}%`;
    const [byNumber, byName, byEmail, byCard, cardCode, bagCode] = await Promise.all([
      n.restoration ? admin.from("orders").select(ORDER_COLUMNS).eq("order_number", n.restoration) : { data: [], error: null },
      admin.from("orders").select(ORDER_COLUMNS).ilike("customer_name", pattern).order("created_at", { ascending: false }).limit(SEARCH_LIMIT),
      admin.from("orders").select(ORDER_COLUMNS).ilike("customer_email", pattern).order("created_at", { ascending: false }).limit(SEARCH_LIMIT),
      admin.from("cards").select("order_id").ilike("card_name", pattern).limit(SEARCH_LIMIT),
      code ? admin.from("cards").select("id, order_id, card_code").ilike("card_code", likeExact(code)).limit(5) : { data: [], error: null },
      code ? admin.from("tier_bags").select("id, order_id, bag_code").ilike("bag_code", likeExact(code)).limit(5) : { data: [], error: null },
    ]);
    for (const r of [cardCode, bagCode]) if (r.error && isMissingSchema(r.error)) schemaMissing = true;
    for (const c of (cardCode.data ?? []) as { id: string; order_id: string; card_code: string }[]) codeMatches.push({ kind: "card", id: c.id, code: c.card_code, orderId: c.order_id });
    for (const b of (bagCode.data ?? []) as { id: string; order_id: string; bag_code: string }[]) codeMatches.push({ kind: "bag", id: b.id, code: b.bag_code, orderId: b.order_id });

    const otherIds = [...new Set([
      ...((byCard.data ?? []) as { order_id: string }[]).map((c) => c.order_id),
      ...codeMatches.map((m) => m.orderId),
    ])];
    const { data: byIdOrders } = otherIds.length
      ? await admin.from("orders").select(ORDER_COLUMNS).in("id", otherIds).limit(SEARCH_LIMIT)
      : { data: [] };
    const exact = [...((byNumber.data ?? []) as OrderRow[]), ...((byIdOrders ?? []) as OrderRow[]).filter((o) => codeMatches.some((m) => m.orderId === o.id))];
    const rest = [...((byName.data ?? []) as OrderRow[]), ...((byEmail.data ?? []) as OrderRow[]), ...((byIdOrders ?? []) as OrderRow[])]
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const found = [...new Map([...exact, ...rest].map((o) => [o.id, o])).values()];
    // Checkouts that were never paid for go last, marked "Not paid"
    results = [...found.filter((o) => o.status !== "awaiting_payment"), ...found.filter((o) => o.status === "awaiting_payment")]
      .slice(0, SEARCH_LIMIT);
  }

  // ── Queues ──────────────────────────────────────────────────────────────
  const shown: QueueKey[] = queue ? [queue] : (query ? [] : ["awaiting", "unchecked", "partial", "labels"]);
  const queueData = await Promise.all(shown.map(async (key) => {
    const from = queue ? (page - 1) * PAGE : 0;
    const to = queue ? from + PAGE - 1 : PREVIEW - 1;
    const r = await loadQueue(admin, key, from, to);
    return { key, ...r, missing: !!r.error && isMissingSchema(r.error) };
  }));
  for (const q of queueData) {
    if (q.missing) schemaMissing = true;
    else if (q.error) loadError ||= q.error.message;
  }

  // Card counts for every order on the page, and bag sizes for the label queue
  const listedOrderIds = [...new Set([...results.map((o) => o.id), ...queueData.flatMap((q) => q.orders.map((o) => o.id))])];
  const { counts, schemaMissing: countsMissing } = await cardCounts(admin, listedOrderIds);
  if (countsMissing) schemaMissing = true;
  const bagIds = queueData.flatMap((q) => q.bags.map((b) => b.id));
  const bagSize = new Map<string, number>();
  if (bagIds.length) {
    const { data } = await admin.from("cards").select("bag_id").in("bag_id", bagIds).neq("status", "refunded").limit(5000);
    for (const c of (data ?? []) as { bag_id: string }[]) bagSize.set(c.bag_id, (bagSize.get(c.bag_id) ?? 0) + 1);
  }

  const orderRow = (o: OrderRow, note?: string) => {
    const c = counts.get(o.id);
    return (
      <li key={o.id}>
        <AdminLink href={`/admin/receiving/${o.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 sm:px-5 py-3 min-h-14 hover:bg-secondary/40 transition-colors">
          <span className="font-heading font-black text-foreground w-20 shrink-0">{o.order_number}</span>
          <span className="flex-1 min-w-[10rem]">
            <span className="block text-sm font-semibold text-foreground truncate">{o.customer_name ?? "—"}</span>
            <span className="block text-xs text-muted-foreground truncate">{o.customer_email}</span>
            {note && <span className="block text-xs font-semibold text-primary">{note}</span>}
          </span>
          <span className="text-xs font-semibold text-muted-foreground">{tierLabel(o.restoration_tier)}{o.inbound_method === "dropoff" ? " · Drop-off" : ""}</span>
          {c && c.total > 0 && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${c.received === c.total ? "bg-green-100 text-green-700" : c.received > 0 ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-600"}`}>
              {c.received} of {c.total} received
            </span>
          )}
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_STYLES[o.status] ?? "bg-gray-100 text-gray-600"}`}>{statusLabel(o.status)}</span>
          {o.payment_status === "refunded" ? (
            <span className="text-xs font-black px-2 py-0.5 rounded-full bg-gray-900 text-white">Refunded</span>
          ) : o.payment_status !== "paid" ? (
            <span className="text-xs font-black px-2 py-0.5 rounded-full bg-red-600 text-white">Not paid</span>
          ) : null}
          <span className="text-xs text-muted-foreground w-24 sm:text-right">{etDate(o.created_at)}</span>
        </AdminLink>
      </li>
    );
  };

  const queueHref = (key: QueueKey, p = 1) => `/admin/receiving?queue=${key}${p > 1 ? `&page=${p}` : ""}`;

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-heading font-black text-3xl text-foreground">Receiving</h1>
            <p className="text-sm text-muted-foreground mt-1">Find the order, tick the cards that arrived, photograph them and receive. Bags and due dates appear right after.</p>
          </div>
          <nav className="flex flex-wrap gap-2 text-sm font-bold" aria-label="Receiving sections">
            <AdminLink href="/admin/receiving/completed" className="inline-flex items-center min-h-11 px-4 rounded-lg border border-border bg-white hover:border-primary/40">Completed bags</AdminLink>
            <AdminLink href="/admin/receiving/settings" className="inline-flex items-center min-h-11 px-4 rounded-lg border border-border bg-white hover:border-primary/40">Settings</AdminLink>
          </nav>
        </div>

        {schemaMissing && (
          <p role="status" className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">{MIGRATION_NOTICE}</p>
        )}
        {loadError && (
          <p role="alert" className="mb-5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">Some lists couldn&apos;t load: {loadError}</p>
        )}

        <form method="GET" action="/admin/receiving" className="flex gap-2 mb-6">
          <label htmlFor="receiving-q" className="sr-only">Search orders</label>
          <input
            id="receiving-q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Order number, customer name, email, card name, Card ID or Bag ID"
            className="flex-1 min-w-0 h-12 px-4 rounded-lg border border-border bg-white text-base sm:text-sm outline-none focus:border-primary transition-colors"
            autoFocus={!queue}
            enterKeyHint="search"
            autoComplete="off"
          />
          <button type="submit" className="h-12 px-5 bg-primary text-primary-foreground text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors">
            Search
          </button>
        </form>

        {query && (
          <section aria-labelledby="results-h" className="mb-8">
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <h2 id="results-h" className="font-heading font-black text-lg text-foreground">
                Orders <span className="text-muted-foreground font-medium text-sm">({results.length}{results.length === SEARCH_LIMIT ? "+" : ""})</span>
              </h2>
              <AdminLink href="/admin/receiving" className="text-sm font-bold text-primary hover:underline min-h-11 inline-flex items-center">Back to queues</AdminLink>
            </div>
            {codeMatches.length > 0 && (
              <ul className="flex flex-wrap gap-2 mb-3">
                {codeMatches.map((m) => (
                  <li key={`${m.kind}-${m.id}`}>
                    <AdminLink href={`/admin/receiving/${m.kind}/${m.id}`} className="inline-flex items-center min-h-11 px-4 rounded-lg bg-primary/10 text-primary text-sm font-bold hover:bg-primary/15">
                      Open {m.kind === "card" ? "card" : "bag"} {m.code}
                    </AdminLink>
                  </li>
                ))}
              </ul>
            )}
            {results.length === 0 ? (
              <p className="bg-white rounded-xl border border-border p-6 text-sm text-muted-foreground">No orders match &ldquo;{query}&rdquo;.</p>
            ) : (
              <ul className="bg-white rounded-xl border border-border divide-y divide-border">
                {results.map((o) => orderRow(o))}
              </ul>
            )}
          </section>
        )}

        {queue && (
          <div className="mb-4">
            <AdminLink href="/admin/receiving" className="text-sm font-bold text-primary hover:underline min-h-11 inline-flex items-center">← All queues</AdminLink>
          </div>
        )}

        <div className="flex flex-col gap-6">
          {queueData.map((q) => {
            const meta = QUEUES[q.key];
            const pages = Math.max(1, Math.ceil(q.count / PAGE));
            return (
              <section key={q.key} aria-labelledby={`queue-${q.key}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <h2 id={`queue-${q.key}`} className="font-heading font-black text-lg text-foreground">
                    {meta.title} <span className="text-muted-foreground font-medium text-sm">({q.missing ? "—" : q.count})</span>
                  </h2>
                  {!queue && q.count > PREVIEW && (
                    <AdminLink href={queueHref(q.key)} className="text-sm font-bold text-primary hover:underline min-h-11 inline-flex items-center">Show all {q.count}</AdminLink>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mb-2">{meta.hint}</p>
                {q.missing ? (
                  <p className="bg-white rounded-xl border border-border p-5 text-sm text-muted-foreground">Available once the intake database update is applied.</p>
                ) : q.key === "labels" ? (
                  q.bags.length === 0 ? (
                    <p className="bg-white rounded-xl border border-border p-5 text-sm text-muted-foreground">Every bag has its label.</p>
                  ) : (
                    <ul className="bg-white rounded-xl border border-border divide-y divide-border">
                      {q.bags.map((b) => (
                        <li key={b.id}>
                          <AdminLink href={`/admin/receiving/${b.order_id}#bags`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 sm:px-5 py-3 min-h-14 hover:bg-secondary/40 transition-colors">
                            <span className="font-heading font-black text-foreground">{b.bag_code}</span>
                            <span className="flex-1 min-w-[10rem] text-sm">
                              <span className="font-semibold text-foreground">{b.orders?.customer_name ?? "—"}</span>
                              <span className="text-muted-foreground"> · {b.orders?.order_number}</span>
                            </span>
                            <span className="text-xs font-semibold text-muted-foreground">{tierLabel(b.tier)} · {bagSize.get(b.id) ?? 0} card{bagSize.get(b.id) === 1 ? "" : "s"}</span>
                            <span className="text-xs text-muted-foreground">{b.received_on ? `Received ${etDay(b.received_on)}` : "No received date"}</span>
                          </AdminLink>
                        </li>
                      ))}
                    </ul>
                  )
                ) : q.orders.length === 0 ? (
                  <p className="bg-white rounded-xl border border-border p-5 text-sm text-muted-foreground">Nothing here.</p>
                ) : (
                  <ul className="bg-white rounded-xl border border-border divide-y divide-border">
                    {q.orders.map((o) => {
                      const c = counts.get(o.id);
                      return orderRow(o, q.key === "partial" && c ? `${c.awaiting} card${c.awaiting === 1 ? "" : "s"} still on the way` : undefined);
                    })}
                  </ul>
                )}
                {queue && pages > 1 && (
                  <nav className="flex items-center justify-between gap-3 mt-3 text-sm" aria-label="Pages">
                    {page > 1 ? <AdminLink href={queueHref(q.key, page - 1)} className="min-h-11 inline-flex items-center px-4 rounded-lg border border-border bg-white font-bold">← Newer</AdminLink> : <span />}
                    <span className="text-muted-foreground">Page {page} of {pages}</span>
                    {page < pages ? <AdminLink href={queueHref(q.key, page + 1)} className="min-h-11 inline-flex items-center px-4 rounded-lg border border-border bg-white font-bold">Older →</AdminLink> : <span />}
                  </nav>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** "Nov 15, 2026" for a stored New York day ("2026-11-15"). */
function etDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}
