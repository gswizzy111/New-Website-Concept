import { createAdminClient } from "@/lib/supabase/admin";
import { markCardsDone } from "@/lib/intake/tracking/moves";
import { isStringArray, json, optString, readJson, trackAdmin, trackResponse } from "@/lib/intake/tracking/http";

export const dynamic = "force-dynamic";

/**
 * POST { cardIds: string[], sessionId? } → 200 TrackActionResponse (bagsCompleted lists bags
 * that became complete; `bags` where each card's bag is); 400 { error }
 * Marks the cards done (as the card's Done toggle), takes them out of their
 * holder or desk and puts them back IN THEIR BAG (no place; never LOC-DONE).
 * `message` says where: "Done. Put it back in REYES's bag: Open bags box,
 * under R." No step email for Done; but when these were the order's last
 * cards, the order becomes Completed and the customer gets the usual
 * completed email (`orderCompletions`, lib/intake/order-autocomplete.ts).
 */
export async function POST(request: Request) {
  const admin = await trackAdmin();
  if ("response" in admin) return admin.response;
  const body = await readJson(request);
  if (!body || !isStringArray(body.cardIds)) return json({ error: "Invalid request" }, 400);
  const result = await markCardsDone(createAdminClient(), { cardIds: body.cardIds, sessionId: optString(body.sessionId), by: admin.by });
  return trackResponse(result);
}
