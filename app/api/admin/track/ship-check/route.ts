import { createAdminClient } from "@/lib/supabase/admin";
import { loadShipCheck } from "@/lib/intake/tracking/ship-check";
import { json, resultResponse, trackAdmin } from "@/lib/intake/tracking/http";

export const dynamic = "force-dynamic";

/**
 * GET ?code=<Bag ID | order code | Card ID (checks its bag)>
 *   → 200 ShipCheckResponse { scope, order, bags, cards: [{ …, status: ok | not_done | in_slot |
 *     refunded }], counts, ready }; 400 / 404 { error }
 * Read only: done and back in its bag = ok; done but still in a holder, on a
 * desk or on the old Done shelf ("still in CLAMP 07") = in_slot (isBackInBag).
 */
export async function GET(request: Request) {
  const admin = await trackAdmin();
  if ("response" in admin) return admin.response;
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!code.trim()) return json({ error: "Scan the bag's or the order's QR." }, 400);
  return resultResponse(await loadShipCheck(createAdminClient(), code));
}
