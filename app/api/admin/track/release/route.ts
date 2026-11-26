import { createAdminClient } from "@/lib/supabase/admin";
import { releaseCards } from "@/lib/intake/tracking/moves";
import { isStringArray, json, optString, readJson, trackStaff, trackResponse } from "@/lib/intake/tracking/http";

export const dynamic = "force-dynamic";

/**
 * POST { cardIds: string[], fromCode?, sessionId? } → 200 TrackActionResponse (location null);
 * 400 / 404 { error }; 409 { error } when `fromCode` is given and none of the
 * cards is in that place any more (the others are refused per card, as Done).
 * Takes the cards out of their slots ("Take out"): no place, the step stays.
 */
export async function POST(request: Request) {
  const admin = await trackStaff();
  if ("response" in admin) return admin.response;
  const body = await readJson(request);
  if (!body || !isStringArray(body.cardIds)) return json({ error: "Invalid request" }, 400);
  // fromCode is optional (older pages leave it out); null counts as left out
  if (body.fromCode != null && typeof body.fromCode !== "string") return json({ error: "Invalid request" }, 400);
  const result = await releaseCards(createAdminClient(), {
    cardIds: body.cardIds,
    fromCode: optString(body.fromCode),
    sessionId: optString(body.sessionId),
    by: admin.by,
  });
  return trackResponse(result);
}
