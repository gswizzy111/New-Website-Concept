import { createAdminClient } from "@/lib/supabase/admin";
import { assignCards } from "@/lib/intake/tracking/moves";
import { isStringArray, json, optString, readJson, trackAdmin, trackResponse } from "@/lib/intake/tracking/http";

export const dynamic = "force-dynamic";

/**
 * POST { locationCode, cardIds: string[], force?, fromBag?, sessionId? }
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
 * their result. `fromBag: true` (the Scan page, a card picked while in its bag): only cards still with
 * their bag go in; the others are refused, "Not in its bag any more (now in CLAMP 03).", and none
 * left is 409 { error } ("CD-2549-07 isn't in its bag any more (now in CLAMP 03).") with nothing written.
 */
export async function POST(request: Request) {
  const admin = await trackAdmin();
  if ("response" in admin) return admin.response;
  const body = await readJson(request);
  if (!body || typeof body.locationCode !== "string" || !isStringArray(body.cardIds)) return json({ error: "Invalid request" }, 400);
  // fromBag is optional (older pages leave it out); null counts as left out
  if (body.fromBag != null && typeof body.fromBag !== "boolean") return json({ error: "Invalid request" }, 400);
  const result = await assignCards(createAdminClient(), {
    locationCode: body.locationCode,
    cardIds: body.cardIds,
    force: body.force === true,
    fromBag: body.fromBag === true,
    sessionId: optString(body.sessionId),
    by: admin.by,
  });
  return trackResponse(result);
}
