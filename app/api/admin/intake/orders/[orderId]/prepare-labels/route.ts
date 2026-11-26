import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPreparePlan, prepareLabels, type PrepareConflict, type PreparePlan, type PrepareResponse } from "@/lib/intake/prepare-labels";
import { UUID, staffActor, fail } from "../../guard";

/**
 * "Print labels" for any order in one tap (lib/intake/prepare-labels.ts).
 * Full admins only, like the other receiving routes.
 *
 * GET  → 200 PreparePlan { orderId, orderNumber, status, payment, mode: ready | bag_in_shop | receive_first | not_allowed,
 *        reason?, bags, toBag, tierQuestions, needsAnswers, dueDatesToFill, receivedOn, receivedOnSource, skipped,
 *        addedLater: { id, name, code, tier, tierName, photo, addedAt }[], addedLaterQuestions }
 *        | 401 / 404 / 500 { error }. Read-only.
 * POST { tiers?: { [cardId]: tierKey }, confirmReceive?: boolean, allowUnpaid?: boolean, includeAddedLater?: cardId[] }
 *      (an empty body is {}; a body that isn't JSON, or is over 40 KB, is 400 as on the receive route).
 *      includeAddedLater: the added-later cards staff say are here ("Yes, add them and print"): received now into their
 *      tier bag, no status change, no email; left out ("Not yet, just print"): they stay for Receiving.
 *      → 200 PrepareResponse { ok, bags: { id, code, tier, tierName, cardCount }[], newlyBagged, addedLaterReceived,
 *        addedLaterLeft, emailed, orderStatusChanged, shelves, dueDatesFilled, message }
 *      | 409 PrepareConflict (the PreparePlan + error, needsConfirmReceive, needsAllowUnpaid, unpaid?, unanswered) when a tier
 *        question is unanswered, an Awaiting Cards order needs confirmReceive, or an unpaid one needs allowUnpaid
 *        (the Receive button's confirm: error UNPAID_ERROR, unpaid: true)
 *      | 400 / 401 / 404 / 409 (not allowed: cancelled, refunded, awaiting payment) / 500 { error }
 * Then print: GET /api/admin/intake/labels/order/<orderId>.
 */
const Body = z.object({
  tiers: z.record(z.string().regex(UUID, "Card not found"), z.string().trim().min(1).max(40)).optional(),
  confirmReceive: z.boolean().optional(),
  allowUnpaid: z.boolean().optional(),
  includeAddedLater: z.array(z.string().regex(UUID, "Card not found")).max(500).optional(),
});

const MAX_BODY = 40_000;

/** The body as JSON: {} when empty; undefined when it isn't JSON or is too large (the receive route's smallJson limit). */
async function readBody(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return undefined;
  const text = await req.text().catch(() => null);
  if (text == null || text.length > MAX_BODY) return undefined;
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const noStore = { "Cache-Control": "no-store" };

export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const who = await staffActor();
  if ("response" in who) return who.response;
  const { orderId } = await params;
  if (!UUID.test(orderId)) return fail(404, "Order not found");

  const result = await loadPreparePlan(createAdminClient(), orderId);
  if (!result.ok) return fail(result.status, result.error);
  return Response.json(result.plan satisfies PreparePlan, { headers: noStore });
}

export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const who = await staffActor();
  if ("response" in who) return who.response;
  const { orderId } = await params;
  if (!UUID.test(orderId)) return fail(404, "Order not found");

  const raw = await readBody(req);
  if (raw === undefined) return fail(400, "Invalid request");
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid request");

  const result = await prepareLabels(createAdminClient(), { orderId, ...parsed.data, by: who.by });
  if (!result.ok) {
    if (result.conflict) return Response.json(result.conflict satisfies PrepareConflict, { status: 409, headers: noStore });
    return fail(result.status, result.error);
  }
  return Response.json(result.response satisfies PrepareResponse, { headers: noStore });
}
