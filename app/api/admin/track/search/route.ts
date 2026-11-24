import { createAdminClient } from "@/lib/supabase/admin";
import { searchCards } from "@/lib/intake/tracking/resolve";
import { resultResponse, trackAdmin } from "@/lib/intake/tracking/http";

export const dynamic = "force-dynamic";

/**
 * GET ?q=<Card ID, Bag ID, order number, card name or customer name> (2+ characters)
 *   → 200 SearchResponse { query, cards: TrackCardSummary[] (at most 30; cards still to do
 *     first, then by due date), truncated }; 400 { error }
 * Only cards that went through Receiving (they have a Card ID).
 */
export async function GET(request: Request) {
  const admin = await trackAdmin();
  if ("response" in admin) return admin.response;
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return resultResponse(await searchCards(createAdminClient(), q));
}
