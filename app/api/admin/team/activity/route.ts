import { isAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { csvText } from "@/lib/csv";
import { nyToday } from "@/lib/intake/business-days";
import { activityCsvRows, applyFilters, dailyCsvRows, loadActivity, readFilters, summarize } from "@/lib/team-activity";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/team/activity?from=&to=&person=&action=[&format=daily]:
 * the Activity page's actions as a CSV file (lib/csv.ts), the same filters
 * as the page (lib/team-activity.ts readFilters); `format=daily`: the counts
 * per person per day instead. Full admins only (401 JSON otherwise).
 */
export async function GET(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filters = readFilters(params, nyToday());
  const load = await loadActivity(createAdminClient(), { from: filters.from, to: filters.to });
  if (!load.ok) return Response.json({ error: load.error }, { status: load.status, headers: { "Cache-Control": "no-store" } });

  const actions = applyFilters(load.actions, filters);
  const daily = params.format === "daily";
  const rows = daily ? dailyCsvRows(summarize(actions).days) : activityCsvRows(actions);
  const range = filters.from === filters.to ? filters.from : `${filters.from}-to-${filters.to}`;
  return new Response(csvText(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${daily ? "daily-counts" : "activity"}-${range}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
