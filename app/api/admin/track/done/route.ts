import { createAdminClient } from "@/lib/supabase/admin";
import { markCardsDone } from "@/lib/intake/tracking/moves";
import { isStringArray, json, optString, readJson, trackAdmin, trackResponse } from "@/lib/intake/tracking/http";

export const dynamic = "force-dynamic";

/**
 * POST { cardIds: string[], fromCode?, fromBag?, sessionId? } → 200 TrackActionResponse (bagsCompleted lists bags
 * that became complete; `bags` where each card's bag is); 400 / 404 { error }; 409 { error }
 * when `fromCode` is given and none of the cards is in that place any more
 * (the others are refused per card: "Not in CLAMP 07 any more (now in HEAT
 * PRESS 01).", lib/intake/tracking/moves.ts), or `fromBag: true` and none is
 * with its bag any more ("CD-2549-07 isn't in its bag any more (now in CLAMP
 * 03)."; the others per card: "Not in its bag any more (…)."): nothing is
 * written and no email goes. Without either the cards are done wherever
 * they are (the Desk, the scan landing, older pages).
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
  // fromCode and fromBag are optional (older pages leave them out); null counts as left out; not both
  if (body.fromCode != null && typeof body.fromCode !== "string") return json({ error: "Invalid request" }, 400);
  if (body.fromBag != null && typeof body.fromBag !== "boolean") return json({ error: "Invalid request" }, 400);
  if (body.fromCode != null && body.fromBag === true) return json({ error: "Invalid request" }, 400);
  const result = await markCardsDone(createAdminClient(), {
    cardIds: body.cardIds,
    fromCode: optString(body.fromCode),
    fromBag: body.fromBag === true,
    sessionId: optString(body.sessionId),
    by: admin.by,
  });
  return trackResponse(result);
}
