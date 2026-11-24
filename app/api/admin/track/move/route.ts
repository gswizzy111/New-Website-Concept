import { createAdminClient } from "@/lib/supabase/admin";
import { moveSlot } from "@/lib/intake/tracking/moves";
import { isStringArray, json, optString, readJson, trackAdmin, trackResponse } from "@/lib/intake/tracking/http";

export const dynamic = "force-dynamic";

/**
 * POST { fromCode, toCode, cardIds?, force?, sessionId? }
 *   → 200 TrackActionResponse; 409 CapacityConflict (to-slot full; force: true adds anyway);
 *     409 { error } when the from-slot is empty; 400 / 404 { error }
 * Moves the cards in the from-slot (all, or only cardIds) to the to-slot: the
 * from-slot frees up, the step follows the new slot (never backwards), one
 * customer email per order at most.
 */
export async function POST(request: Request) {
  const admin = await trackAdmin();
  if ("response" in admin) return admin.response;
  const body = await readJson(request);
  if (!body || typeof body.fromCode !== "string" || typeof body.toCode !== "string") return json({ error: "Invalid request" }, 400);
  if (body.cardIds !== undefined && body.cardIds !== null && !isStringArray(body.cardIds)) return json({ error: "Invalid request" }, 400);
  const result = await moveSlot(createAdminClient(), {
    fromCode: body.fromCode,
    toCode: body.toCode,
    cardIds: isStringArray(body.cardIds) ? body.cardIds : undefined,
    force: body.force === true,
    sessionId: optString(body.sessionId),
    by: admin.by,
  });
  return trackResponse(result);
}
