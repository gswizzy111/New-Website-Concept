import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { requireAdmin } from "@/lib/admin-auth";
import { getDropoffServices } from "@/lib/show-dropoff-services";
import { FIVE_PLUS_LABEL, serviceName } from "@/lib/show-dropoffs";
import { allDropoffsForRevenue, dropoffRevenue, totalsFor, type DropoffMoney, type RevenueTotals } from "@/lib/show-dropoff-revenue";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  new:       { label: "To enter",  cls: "bg-blue-100 text-blue-700" },
  entered:   { label: "Entered",   cls: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelled", cls: "bg-gray-100 text-gray-500" },
};

type Row = {
  id: string; dropoff_number: number; created_at: string; show_name: string | null;
  customer_name: string; customer_email: string; customer_phone: string;
  tiers: string[]; five_plus: boolean; card_count: number | null; status: string;
};

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One drop-off's money in the list: the order's total, or the estimate while it waits. */
function MoneyCell({ m }: { m: DropoffMoney | undefined }) {
  if (!m || m.kind === "none") return <span className="text-muted-foreground">—</span>;
  if (m.kind === "entered") {
    return (
      <div>
        <span className="font-semibold tabular-nums">{usd(m.cents)}</span>
        {m.orderId && (
          <AdminLink href={`/admin/orders/${m.orderId}`} className="block text-xs text-primary hover:underline">
            {m.orderNumber ? `#${m.orderNumber}` : "Order"}
          </AdminLink>
        )}
      </div>
    );
  }
  if (!m.complete && m.cents === 0) return <span className="text-xs text-muted-foreground">Needs pricing</span>;
  return (
    <span className="tabular-nums text-muted-foreground" title="Estimate from the services picked at the table">
      ~{usd(m.cents)}{m.complete ? "" : "+"}
    </span>
  );
}

function RevenueSummary({ title, totals }: { title: string; totals: RevenueTotals }) {
  const box = "rounded-xl border border-border bg-white p-4";
  return (
    <section className="mb-6" aria-label={title}>
      <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className={box}>
          <p className="text-xs font-semibold text-muted-foreground">Revenue (entered orders)</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-foreground">{usd(totals.enteredCents)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Order totals, less refunds</p>
        </div>
        <div className={box}>
          <p className="text-xs font-semibold text-muted-foreground">Still to enter (estimate)</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-foreground">~{usd(totals.estimateCents)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {totals.unpriced > 0
              ? `${totals.unpriced} can't be fully priced yet (Diamond, or 5+ cards with several services)`
              : "At today's prices for the services picked"}
          </p>
        </div>
        <div className={box}>
          <p className="text-xs font-semibold text-muted-foreground">Drop-offs</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-foreground">{totals.dropoffs}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{totals.cards} card{totals.cards === 1 ? "" : "s"}, cancelled not counted</p>
        </div>
      </div>
    </section>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function ShowDropoffsAdminPage({ searchParams }: { searchParams: Promise<{ filter?: string; show?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const filter = sp.filter ?? "new";
  const show = sp.show ?? "";

  const admin = createAdminClient();
  let query = admin
    .from("show_dropoffs")
    .select("id, dropoff_number, created_at, show_name, customer_name, customer_email, customer_phone, tiers, five_plus, card_count, status")
    .order("created_at", { ascending: false })
    .limit(500);
  if (filter !== "all") query = query.eq("status", filter);
  if (show) query = query.eq("show_name", show);
  const [{ data, error }, services, { data: shows }, everyDropoff] = await Promise.all([
    query,
    getDropoffServices(),
    admin.from("show_dropoffs").select("show_name").not("show_name", "is", null).order("created_at", { ascending: false }).limit(1000),
    allDropoffsForRevenue().catch((e: Error) => e),
  ]);
  // Revenue covers every drop-off (paged), for the show picked or every show
  const revenueError = everyDropoff instanceof Error ? everyDropoff.message : null;
  const revenueRows = everyDropoff instanceof Error ? [] : everyDropoff;
  const money = revenueError ? new Map<string, DropoffMoney>() : await dropoffRevenue(revenueRows).catch(() => new Map<string, DropoffMoney>());
  const scoped = show ? revenueRows.filter((r) => r.show_name === show) : revenueRows;
  const totals = totalsFor(scoped, money);
  // Every show: one line per show, highest revenue first
  const byShow = show
    ? []
    : [...revenueRows.reduce((groups, r) => {
        const key = r.show_name ?? "";
        groups.set(key, [...(groups.get(key) ?? []), r]);
        return groups;
      }, new Map<string, typeof revenueRows>())]
        .map(([name, rows]) => ({ name, totals: totalsFor(rows, money) }))
        .filter((g) => g.totals.dropoffs > 0)
        .sort((a, b) => (b.totals.enteredCents + b.totals.estimateCents) - (a.totals.enteredCents + a.totals.estimateCents));
  const list = (data ?? []) as Row[];
  const showNames = [...new Set((shows ?? []).map((r) => r.show_name as string))].slice(0, 12);

  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ filter, ...(show ? { show } : {}), ...patch });
    if (!p.get("show")) p.delete("show");
    return `/admin/show-dropoffs?${p}`;
  };
  const chip = (label: string, href: string, active: boolean) => (
    <AdminLink
      key={href}
      href={href}
      className={`px-3 py-1.5 rounded-lg text-xs font-bold border whitespace-nowrap transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-white text-muted-foreground border-border hover:border-primary/40"}`}
    >
      {label}
    </AdminLink>
  );

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="font-heading font-black text-3xl text-foreground">Show Dropoffs</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Cards taken in at card shows. Open one and press Create Order to enter it.
            </p>
          </div>
          <a
            href="/show-dropoffs"
            target="_blank"
            rel="noreferrer"
            className="h-9 px-4 bg-primary text-primary-foreground rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors flex items-center"
          >
            Open the form ↗
          </a>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {chip("To enter", link({ filter: "new" }), filter === "new")}
          {chip("Entered", link({ filter: "entered" }), filter === "entered")}
          {chip("Cancelled", link({ filter: "cancelled" }), filter === "cancelled")}
          {chip("All", link({ filter: "all" }), filter === "all")}
        </div>
        {showNames.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {chip("Every show", link({ show: "" }), !show)}
            {showNames.map((n) => chip(n, link({ show: n }), show === n))}
          </div>
        )}

        {revenueError ? (
          <p className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Couldn&apos;t load revenue: {revenueError}</p>
        ) : (
          <RevenueSummary title={show ? `Revenue: ${show}` : "Revenue: every show"} totals={totals} />
        )}

        {byShow.length > 1 && (
          <div className="mb-6 overflow-x-auto rounded-xl border border-border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
                  <th className="px-4 py-3">Show</th>
                  <th className="px-4 py-3 text-right">Drop-offs</th>
                  <th className="px-4 py-3 text-right">Cards</th>
                  <th className="px-4 py-3 text-right">Revenue</th>
                  <th className="px-4 py-3 text-right">Still to enter</th>
                </tr>
              </thead>
              <tbody>
                {byShow.map((g) => (
                  <tr key={g.name || "none"} className="border-b border-border last:border-0 hover:bg-secondary/40">
                    <td className="px-4 py-3">
                      {g.name ? (
                        <AdminLink href={link({ show: g.name })} className="font-semibold text-primary hover:underline">{g.name}</AdminLink>
                      ) : (
                        <span className="text-muted-foreground">No show name</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{g.totals.dropoffs}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{g.totals.cards}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{usd(g.totals.enteredCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {g.totals.estimateCents > 0
                        ? `~${usd(g.totals.estimateCents)}${g.totals.unpriced ? "+" : ""}`
                        : g.totals.unpriced ? "Needs pricing" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Couldn&apos;t load drop-offs: {error.message}</p>
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-border bg-white p-10 text-center text-sm text-muted-foreground">
            No drop-offs here yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Services</th>
                  <th className="px-4 py-3">Cards</th>
                  <th className="px-4 py-3">Revenue</th>
                  <th className="px-4 py-3">Show</th>
                  <th className="px-4 py-3">Received</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const st = STATUS_STYLES[r.status] ?? STATUS_STYLES.new;
                  return (
                    <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/40">
                      <td className="px-4 py-3 font-bold tabular-nums">
                        <AdminLink href={`/admin/show-dropoffs/${r.id}`} className="text-primary hover:underline">#{r.dropoff_number}</AdminLink>
                      </td>
                      <td className="px-4 py-3">
                        <AdminLink href={`/admin/show-dropoffs/${r.id}`} className="font-semibold text-foreground hover:underline">{r.customer_name}</AdminLink>
                        <div className="text-xs text-muted-foreground">{r.customer_email}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">{r.tiers.map((t) => serviceName(services, t)).join(", ")}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {r.five_plus ? <span className="font-semibold">{FIVE_PLUS_LABEL}{r.card_count ? ` (~${r.card_count})` : ""}</span> : r.card_count ?? "—"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap"><MoneyCell m={money.get(r.id)} /></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{r.show_name ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{when(r.created_at)}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${st.cls}`}>{st.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
