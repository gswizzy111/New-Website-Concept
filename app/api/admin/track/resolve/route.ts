import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTrackCode } from "@/lib/intake/tracking/resolve";
import { json, resultResponse, trackStaff } from "@/lib/intake/tracking/http";

export const dynamic = "force-dynamic";

/**
 * GET ?code=<slot | bag | order | Card ID, or its QR link>
 *   → 200 ResolveResponse: { kind: "location", code, location: TrackSlotSummary } (the slot, its
 *     cards, capacity, free, desks: the switched-on desks for "Move to my desk")
 *     | { kind: "bag", code, bag } | { kind: "order", code, order }
 *     (cards with their slots) | { kind: "card", code, card }
 *   → 400 { error } not a code; 404 { error } nothing has it
 */
export async function GET(request: Request) {
  const admin = await trackStaff();
  if ("response" in admin) return admin.response;
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!code.trim()) return json({ error: "Scan a code." }, 400);
  return resultResponse(await resolveTrackCode(createAdminClient(), code));
}
