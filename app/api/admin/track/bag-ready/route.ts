import { createAdminClient } from "@/lib/supabase/admin";
import { putBagReadyToShip } from "@/lib/intake/tracking/bag-places";
import { json, readJson, trackStaff } from "@/lib/intake/tracking/http";

export const dynamic = "force-dynamic";

/**
 * POST { bagId } → 200 BagReadyResponse { bag: TrackBagPlace, changed, message }
 *   → 409 { error } while a card of the bag is still to do ("Not every card in
 *     CD-2549-P is done yet (3 of 4 done).") or it has no live cards
 *   → 404 { error: "Bag not found" }; 400 { error } bad body
 * "Bag finished: put it in the Ready to ship bin": the bag's place becomes
 * LOC-SHIP (tier_bags.location_id). Sending it again changes nothing.
 */
export async function POST(request: Request) {
  const admin = await trackStaff();
  if ("response" in admin) return admin.response;
  const body = await readJson(request);
  if (!body || typeof body.bagId !== "string") return json({ error: "Invalid request" }, 400);
  const result = await putBagReadyToShip(createAdminClient(), { bagId: body.bagId, by: admin.by });
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ bag: result.bag, changed: result.changed, message: result.message });
}
