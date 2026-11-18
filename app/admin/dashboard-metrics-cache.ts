import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBacklogDays, getBacklogNow, getRevenueSeries } from "@/lib/dashboard-metrics";

/**
 * The dashboard's three metric functions (lib/dashboard-metrics.ts), cached
 * for a minute. They are the slowest database calls on the dashboard
 * (revenue_series ~250 ms, backlog_report ~450 ms, backlog_now ~60 ms, and up
 * to several seconds when the database is busy), and the numbers are the same
 * for every admin, so one computation serves every load and every
 * router.refresh() for FRESH_SECONDS.
 *
 * Server only (it uses the service-role client): lib/dashboard-metrics.ts is
 * also imported by the client charts, so the cache can't live there.
 *
 * Lifetime: an entry is fresh for 60 s. Next's cache then serves the old entry
 * once while it recomputes in the background, so after a quiet spell the
 * first load could show numbers from long ago: anything older than
 * MAX_AGE_MS (2 minutes) is never shown, it's recomputed on the spot.
 *
 * Invalidated (tag DASHBOARD_METRICS_TAG) when the dashboard's after-response
 * Stripe refund sync saves refunds (app/admin/page.tsx) and when an admin
 * decides a refund request (app/admin/dashboard-actions.ts). Other changes
 * (an order paid, a card ticked done) show within the minute.
 */
export const DASHBOARD_METRICS_TAG = "admin-dashboard-metrics";
const FRESH_SECONDS = 60;
const MAX_AGE_MS = 2 * FRESH_SECONDS * 1000;

type Stamped<T> = { at: number; value: T };

function cachedMetric<A extends string[], T>(name: string, load: (...args: A) => Promise<T>) {
  const fromCache = unstable_cache(
    async (...args: A): Promise<Stamped<T>> => ({ at: Date.now(), value: await load(...args) }),
    [`admin-dashboard-metric:${name}:v1`],
    { revalidate: FRESH_SECONDS, tags: [DASHBOARD_METRICS_TAG] },
  );
  return async (...args: A): Promise<T> => {
    let hit: Stamped<T>;
    try {
      hit = await fromCache(...args);
    } catch (e) {
      // The cache itself failed (or the computation did): compute directly once
      console.error(`[admin] metrics cache ${name}:`, e instanceof Error ? e.message : e);
      return load(...args);
    }
    return Date.now() - hit.at <= MAX_AGE_MS ? hit.value : load(...args);
  };
}

/** revenue_series(): sales and refunds by New York day and hour, refunds this month. */
export const cachedRevenueSeries = cachedMetric("revenue_series", () => getRevenueSeries(createAdminClient()));

/** backlog_report(from, to): the card backlog per New York day (YYYY-MM-DD bounds). */
export const cachedBacklogDays = cachedMetric("backlog_report", (from: string, to: string) => getBacklogDays(createAdminClient(), from, to));

/** backlog_now(): unfinished cards right now. */
export const cachedBacklogNow = cachedMetric("backlog_now", () => getBacklogNow(createAdminClient()));
