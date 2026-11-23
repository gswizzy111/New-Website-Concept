import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";
import { FINISHED_STATUSES, totalsFor, type OrderPlan } from "@/lib/intake/migration";
import { loadSetupData, MissingTablesError, MISSING_TABLES_NOTICE, planAll } from "../_lib/store";
import { matches, SetupFilters, type IssueOrder } from "../_lib/views";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.union([
  z.object({ orderIds: z.array(z.string().uuid()).min(1).max(5000) }),
  z.object({ all: z.literal(true), filters: SetupFilters.partial().optional() }),
]);

/**
 * POST /api/admin/intake/setup/preview
 *   { orderIds: [...] }               the orders picked
 *   { all: true, filters?: {...} }    every eligible order (matching the list's filters)
 * Nothing is written. Returns the totals, the ids of the orders that would
 * change (the page runs them in batches of 25), what each would get, and the
 * orders missing images, tiers or receiving dates.
 */
export async function POST(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick at least one order." }, { status: 400 });

  try {
    const admin = createAdminClient();
    const body = parsed.data;
    const data = await loadSetupData(admin, "all" in body ? { all: true } : { orderIds: body.orderIds });
    let plans = planAll(data);
    const byId = new Map(data.orders.map((o) => [o.id, o]));
    if ("all" in body) {
      // Every order matching the list's filters, set up or not (set-up ones count as "already set up")
      const filters = SetupFilters.parse({ ...(body.filters ?? {}), show: "all" });
      plans = plans.filter((p) => matches(byId.get(p.orderId)!, p, data.inputs.get(p.orderId), filters));
    } else {
      const found = new Set(plans.map((p) => p.orderId));
      const missing = body.orderIds.filter((id) => !found.has(id));
      if (missing.length) {
        plans = [...plans, ...missing.map((id) => notFound(id))];
      }
    }

    const issue = (p: OrderPlan, cards: IssueOrder["cards"]): IssueOrder => ({
      orderId: p.orderId,
      orderNumber: p.orderNumber,
      customerName: byId.get(p.orderId)?.customer_name ?? null,
      status: p.status,
      cards,
    });
    // A finished order's bags are complete, so its missing date needs no follow-up: counted, not listed
    const isFinished = (p: OrderPlan) => (FINISHED_STATUSES as readonly string[]).includes(p.status);
    const toChange = plans.filter((p) => p.eligible && !p.alreadySetUp && p.errors.length === 0);
    return Response.json({
      ready: true,
      totals: totalsFor(plans),
      orderIds: toChange.map((p) => p.orderId),
      orders: toChange.map((p) => ({
        orderId: p.orderId,
        orderNumber: p.orderNumber,
        customerName: byId.get(p.orderId)?.customer_name ?? null,
        status: p.status,
        cardsToUpdate: p.cardsToUpdate,
        cardCodes: p.cardCodes.length,
        newBags: p.newBags.map((b) => ({ code: b.bagCode, cards: b.cardIds.length, dueDate: b.dueDate, dueStatus: b.dueStatus, completed: !!b.completedAt })),
        bagFills: p.bagFills.length,
        receivedOn: p.receivedOn,
      })),
      missingImages: plans.filter((p) => p.eligible && p.missingImages.length).map((p) => issue(p, p.missingImages)),
      missingTiers: plans.filter((p) => p.eligible && p.missingTiers.length).map((p) => issue(p, p.missingTiers)),
      addedLater: plans.filter((p) => p.eligible && p.addedLater.length).map((p) => issue(p, p.addedLater)),
      missingReceivedDates: plans.filter((p) => p.eligible && p.missingReceivedDate && !isFinished(p)).map((p) => issue(p, [])),
      missingReceivedDatesFinished: plans.filter((p) => p.eligible && p.missingReceivedDate && isFinished(p)).length,
      finishedDateUnknown: plans.filter((p) => p.eligible && p.finishedDateUnknown).map((p) => issue(p, [])),
      errors: plans.filter((p) => p.errors.length).map((p) => ({ ...issue(p, []), message: p.errors.join(" ") })),
      notEligible: plans.filter((p) => !p.eligible).map((p) => ({ ...issue(p, []), message: p.ineligibleReason ?? "Not eligible" })),
      alreadySetUp: plans.filter((p) => p.eligible && p.alreadySetUp && p.errors.length === 0).length,
    });
  } catch (e) {
    if (e instanceof MissingTablesError) return Response.json({ ready: false, notice: MISSING_TABLES_NOTICE });
    console.error("[intake setup] preview failed:", e);
    return Response.json({ error: e instanceof Error ? e.message : "Couldn't prepare the preview." }, { status: 500 });
  }
}

function notFound(orderId: string): OrderPlan {
  return {
    orderId, orderNumber: null, status: "unknown", eligible: false, ineligibleReason: "Order not found",
    receivedOn: null, receivedSource: null, receivedAt: null, cardCodes: [], newBags: [], links: [], bagFills: [],
    touchedBagIds: [], receivedAtFills: [], missingImages: [], missingTiers: [], addedLater: [], missingReceivedDate: false,
    finishedDateUnknown: false, errors: [], cardsToUpdate: 0, bagsToCreate: 0, alreadySetUp: false,
  };
}
