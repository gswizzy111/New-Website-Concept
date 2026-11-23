import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";
import { loadSetupData, MissingTablesError, MISSING_TABLES_NOTICE, planAll } from "../_lib/store";
import { matches, orderView, SetupFilters, stateOf } from "../_lib/views";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Paging = z.object({
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).catch(25),
});

/**
 * GET /api/admin/intake/setup/orders?status=&show=needs|done|all&from=&to=&q=&page=&pageSize=
 * Orders the Historical Order Setup can work on (received, in progress,
 * completed, shipped back, delivered; with cards), newest first, with each
 * one's cards, issues and set-up state. Counts cover every listed order.
 */
export async function GET(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filters = SetupFilters.parse(params);
  const { page, pageSize } = Paging.parse(params);

  try {
    const admin = createAdminClient();
    const data = await loadSetupData(admin, { all: true });
    const plans = planAll(data);
    const counts = { needsSetup: 0, setUp: 0, errors: 0 };
    const listed: number[] = [];
    plans.forEach((plan, i) => {
      if (!plan.eligible) return;
      const state = stateOf(plan);
      if (state === "needs_setup") counts.needsSetup += 1;
      else if (state === "set_up") counts.setUp += 1;
      else counts.errors += 1;
      if (matches(data.orders[i], plan, data.inputs.get(plan.orderId), filters)) listed.push(i);
    });
    const start = (page - 1) * pageSize;
    const orders = listed.slice(start, start + pageSize).map((i) => orderView(data.orders[i], plans[i], data.inputs.get(plans[i].orderId)!));
    return Response.json({
      ready: true,
      orders,
      total: listed.length,
      // Orders matching the filters that still need setting up (for "Select all eligible")
      eligibleMatching: listed.filter((i) => stateOf(plans[i]) === "needs_setup").length,
      page,
      pageSize,
      counts,
    });
  } catch (e) {
    if (e instanceof MissingTablesError) return Response.json({ ready: false, notice: MISSING_TABLES_NOTICE });
    console.error("[intake setup] list failed:", e);
    return Response.json({ error: e instanceof Error ? e.message : "Couldn't load the orders." }, { status: 500 });
  }
}
