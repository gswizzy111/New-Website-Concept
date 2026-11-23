import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdminSession, isAdmin } from "@/lib/admin-auth";
import { planOrderSetup, SETUP_BATCH } from "@/lib/intake/migration";
import { loadSetupData, mapLimit, MissingTablesError, MISSING_TABLES_NOTICE, runPlan, supabaseSetupStore, type RunOutcome } from "../_lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ orderIds: z.array(z.string().uuid()).min(1).max(SETUP_BATCH) });

/**
 * POST /api/admin/intake/setup/run { orderIds: [...] } (at most 25)
 * Sets the orders up from a fresh read of each (never from the preview), so
 * a repeat, a second tab or a run after Receiving is harmless. Per order:
 * { outcome: 'ok' | 'skipped' | 'error', message, changes, issue counts }.
 */
export async function POST(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: `Send 1 to ${SETUP_BATCH} order ids.` }, { status: 400 });
  const orderIds = [...new Set(parsed.data.orderIds)];
  const by = (await getAdminSession())?.username ?? null;

  try {
    const admin = createAdminClient();
    const data = await loadSetupData(admin, { orderIds });
    const store = supabaseSetupStore(admin);
    const results = await mapLimit(orderIds, 5, async (orderId): Promise<RunOutcome> => {
      const input = data.inputs.get(orderId);
      if (!input) {
        return { orderId, orderNumber: null, outcome: "error", message: "Order not found", changes: null, missingImages: 0, missingTiers: 0, addedLater: 0, missingReceivedDate: false };
      }
      try {
        return await runPlan(planOrderSetup(input), store, by);
      } catch (e) {
        return {
          orderId, orderNumber: input.order.order_number, outcome: "error",
          message: e instanceof Error ? e.message : String(e), changes: null, missingImages: 0, missingTiers: 0, addedLater: 0, missingReceivedDate: false,
        };
      }
    });
    return Response.json({ ready: true, results });
  } catch (e) {
    if (e instanceof MissingTablesError) return Response.json({ ready: false, notice: MISSING_TABLES_NOTICE });
    console.error("[intake setup] run failed:", e);
    return Response.json({ error: e instanceof Error ? e.message : "Couldn't set the orders up." }, { status: 500 });
  }
}
