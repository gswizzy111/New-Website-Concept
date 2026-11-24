import { createAdminClient } from "@/lib/supabase/admin";
import { releaseCards } from "@/lib/intake/tracking/moves";
import { isStringArray, json, optString, readJson, trackAdmin, trackResponse } from "@/lib/intake/tracking/http";

export const dynamic = "force-dynamic";

/**
 * POST { cardIds: string[], sessionId? } → 200 TrackActionResponse (location null); 400 { error }
 * Takes the cards out of their slots ("Take out"): no place, the step stays.
 */
export async function POST(request: Request) {
  const admin = await trackAdmin();
  if ("response" in admin) return admin.response;
  const body = await readJson(request);
  if (!body || !isStringArray(body.cardIds)) return json({ error: "Invalid request" }, 400);
  const result = await releaseCards(createAdminClient(), { cardIds: body.cardIds, sessionId: optString(body.sessionId), by: admin.by });
  return trackResponse(result);
}
