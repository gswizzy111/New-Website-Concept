import { cache } from "react";
import { formatCurrency } from "@/lib/utils";
import { addDays } from "@/lib/dashboard-metrics";
import { Skeleton } from "@/components/admin-ui/skeleton";
import { RevenueChart } from "./revenue-chart";
import { BacklogChart } from "./backlog-chart";
import { DashboardLink } from "./dashboard-link";
import { cachedBacklogDays, cachedBacklogNow, cachedRevenueSeries } from "./dashboard-metrics-cache";

// The dashboard's numbers (lib/dashboard-metrics.ts): sales by the day paid,
// refunds by the day refunded (from the refund ledger, which the page syncs
// with Stripe after each response and a scheduled job keeps current), backlog
// in unfinished cards. All days are New York days. These render in their own
// <Suspense> boundaries, so the order list never waits for them.

/** Unfinished cards right now, read once per request (header badge and tile share it). */
const backlogNowOnce = cache(() =>
  cachedBacklogNow().catch((e) => { console.error("[admin] backlog_now:", e); return null; }),
);

/** "N cards in backlog" beside the order total in the page header. */
export async function BacklogBadge() {
  const count = (await backlogNowOnce())?.total ?? 0;
  if (count <= 0) return null;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700">
      {count} card{count !== 1 ? "s" : ""} in backlog
    </span>
  );
}

/** The Orders tab's month tiles and charts. `today` is New York's date (YYYY-MM-DD). */
export async function DashboardMetrics({ today }: { today: string }) {
  const [backlogNow, metrics] = await Promise.all([
    backlogNowOnce(),
    Promise.all([cachedRevenueSeries(), cachedBacklogDays(addDays(today, -29), today)])
      .then(([series, backlogDays]) => ({ series, backlogDays }))
      .catch((e) => { console.error("[admin] dashboard metrics:", e); return null; }),
  ]);
  const month = (() => {
    if (!metrics) return null;
    const days = metrics.series.daily.filter((d) => d.day.slice(0, 7) === today.slice(0, 7));
    const sales = days.reduce((s, d) => s + d.sales_cents, 0);
    const refunds = metrics.series.refunds_this_month;
    return { orders: days.reduce((s, d) => s + d.orders, 0), sales, refunds, net: sales - refunds.cents };
  })();

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Orders This Month</p>
          <p className="font-heading font-black text-3xl text-foreground">{month ? month.orders : "—"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">paid restoration, prep and kit orders</p>
        </div>
        <div className="bg-white rounded-xl border border-border p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Net Revenue This Month</p>
          <p className="font-heading font-black text-3xl text-primary">{month ? formatCurrency(month.net) : "—"}</p>
          {month && <p className="text-xs text-muted-foreground mt-0.5">{formatCurrency(month.sales)} sales − {formatCurrency(month.refunds.cents)} refunds</p>}
        </div>
        <div className="bg-white rounded-xl border border-red-100 p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-red-700 mb-1">Refunds This Month</p>
          <p className="font-heading font-black text-3xl text-red-600">{month ? formatCurrency(month.refunds.cents) : "—"}</p>
          {month && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {month.refunds.count} refund{month.refunds.count !== 1 ? "s" : ""}, partial included
              {month.refunds.pending_cents > 0 ? ` · ${formatCurrency(month.refunds.pending_cents)} still pending` : ""}
            </p>
          )}
        </div>
        <DashboardLink href="/admin/backlog" className="bg-white rounded-xl border border-border p-5 hover:border-foreground/30 transition-colors">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Active Backlog</p>
          <p className="font-heading font-black text-3xl text-purple-600">{backlogNow ? backlogNow.total : "—"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            unfinished cards{backlogNow ? ` · ${backlogNow.prep} PSA Prep` : ""}
            {backlogNow?.unknown_orders ? ` · ${backlogNow.unknown_orders} order${backlogNow.unknown_orders !== 1 ? "s" : ""} with no card count` : ""}
          </p>
        </DashboardLink>
      </div>

      {/* Charts */}
      {metrics ? (
        <div className="mb-8 flex flex-col gap-6">
          <RevenueChart series={metrics.series} label="Total Revenue" />
          <BacklogChart days={metrics.backlogDays} />
          <RevenueChart series={metrics.series} label="Kit Sales" kitsOnly />
        </div>
      ) : (
        <div className="mb-8 bg-white rounded-xl border border-border p-6 text-sm text-muted-foreground">
          The charts couldn&apos;t load. Refresh the page to try again.
        </div>
      )}
    </>
  );
}

/** Holds the tiles' and charts' space while they load, so the order list below doesn't jump. */
export function DashboardMetricsFallback() {
  return (
    <div aria-busy="true" aria-label="Loading the dashboard numbers">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="bg-white rounded-xl border border-border p-5">
            <Skeleton className="h-3 w-24 mb-3" />
            <Skeleton className="h-8 w-20 mb-2" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="mb-8 flex flex-col gap-6">
        {/* About the height of the revenue, backlog and kit charts */}
        {["h-[31rem]", "h-[21rem]", "h-[31rem]"].map((h, i) => (
          <Skeleton key={i} className={`${h} w-full rounded-xl`} />
        ))}
      </div>
    </div>
  );
}
