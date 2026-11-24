import { createAdminClient } from "@/lib/supabase/admin";
import { markCardsDone } from "@/lib/intake/tracking/moves";
import { isStringArray, json, optString, readJson, trackAdmin, trackResponse } from "@/lib/intake/tracking/http";

export const dynamic = "force-dynamic";

/**
 * POST { cardIds: string[], sessionId? } → 200 TrackActionResponse (bagsCompleted lists bags
 * that became complete); 400 { error }
 * Marks the cards done (as the card's Done toggle), takes them out of their
 * slots and puts them at the Done place (LOC-DONE). No customer email (as the
 * Done toggle).
 */
export async function POST(request: Request) {
  const admin = await trackAdmin();
  if ("response" in admin) return admin.response;
  const body = await readJson(request);
  if (!body || !isStringArray(body.cardIds)) return json({ error: "Invalid request" }, 400);
  const result = await markCardsDone(createAdminClient(), { cardIds: body.cardIds, sessionId: optString(body.sessionId), by: admin.by });
  return trackResponse(result);
}
