import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPreparePlan, prepareLabels, type PrepareConflict, type PreparePlan, type PrepareResponse } from "@/lib/intake/prepare-labels";
import { DAY, UUID, adminName, fail, smallJson } from "../../guard";

/**
 * "Print labels" for any order in one tap (lib/intake/prepare-labels.ts).
 * Full admins only, like the other receiving routes.
 *
 * GET  → 200 PreparePlan { orderId, orderNumber, status, mode: ready | bag_in_shop | receive_first | not_allowed,
 *        reason?, bags, toBag, tierQuestions, needsAnswers, receivedOn, receivedOnSource, skipped } | 401 / 404 / 500 { error }
 * POST { tiers?: { [cardId]: tierKey }, confirmReceive?: boolean, receivedOn?: "YYYY-MM-DD" }
 *      → 200 PrepareResponse { ok, bags: { id, code, tier, tierName, cardCount }[], newlyBagged, emailed, orderStatusChanged, message }
 *      | 409 PrepareConflict (the PreparePlan + error, needsConfirmReceive, unanswered) when a tier question is
 *        unanswered or an Awaiting Cards order needs confirmReceive
 *      | 400 / 401 / 404 / 409 (not allowed: cancelled, refunded, awaiting payment) / 500 { error }
 * Then print: GET /api/admin/intake/labels/order/<orderId>.
 */
const Body = z.object({
  tiers: z.record(z.string().regex(UUID, "Card not found"), z.string().trim().min(1).max(40)).optional(),
  confirmReceive: z.boolean().optional(),
  receivedOn: z.string().regex(DAY, "Pick a valid received date.").optional(),
});

const noStore = { "Cache-Control": "no-store" };

export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const who = await adminName();
  if ("response" in who) return who.response;
  const { orderId } = await params;
  if (!UUID.test(orderId)) return fail(404, "Order not found");

  const result = await loadPreparePlan(createAdminClient(), orderId);
  if (!result.ok) return fail(result.status, result.error);
  return Response.json(result.plan satisfies PreparePlan, { headers: noStore });
}

export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const who = await adminName();
  if ("response" in who) return who.response;
  const { orderId } = await params;
  if (!UUID.test(orderId)) return fail(404, "Order not found");

  const parsed = Body.safeParse((await smallJson(req)) ?? {});
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid request");

  const result = await prepareLabels(createAdminClient(), { orderId, ...parsed.data, by: who.by });
  if (!result.ok) {
    if (result.conflict) return Response.json(result.conflict satisfies PrepareConflict, { status: 409, headers: noStore });
    return fail(result.status, result.error);
  }
  return Response.json(result.response satisfies PrepareResponse, { headers: noStore });
}
