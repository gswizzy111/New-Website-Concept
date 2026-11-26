import { createAdminClient } from "@/lib/supabase/admin";
import { assignCards } from "@/lib/intake/tracking/moves";
import { isStringArray, json, optString, readJson, trackAdmin, trackResponse } from "@/lib/intake/tracking/http";

export const dynamic = "force-dynamic";

/**
 * POST { locationCode, cardIds: string[], force?, sessionId? }
 *   → 200 TrackActionResponse (lib/intake/tracking/types.ts)
 *   → 409 HolderFull { error, holderFull: true, holder, occupants } when a one-card holder (every
 *     slot, every other place but a desk or the Open bags box) has a card, or several cards would
 *     go in at once: force never bypasses it
 *   → 409 CapacityConflict { error, overCapacity: true, capacity, occupants } when a desk with a
 *     limit set is full (send again with force: true to add anyway); 409 { error } for a switched-off slot
 *   → 400 / 404 { error }
 * Puts the cards in the slot (or any place). Each card leaves its old slot; in
 * a slot its step becomes the slot's step (later or earlier: any order), with at
 * most one customer email per order, for steps new to the customer only. Refunded and not-received cards are refused in
 * their result.
 */
export async function POST(request: Request) {
  const admin = await trackAdmin();
  if ("response" in admin) return admin.response;
  const body = await readJson(request);
  if (!body || typeof body.locationCode !== "string" || !isStringArray(body.cardIds)) return json({ error: "Invalid request" }, 400);
  const result = await assignCards(createAdminClient(), {
    locationCode: body.locationCode,
    cardIds: body.cardIds,
    force: body.force === true,
    sessionId: optString(body.sessionId),
    by: admin.by,
  });
  return trackResponse(result);
}
