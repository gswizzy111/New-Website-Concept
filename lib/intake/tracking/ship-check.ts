import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { codeKind, normalizeCode } from "@/lib/intake/codes";
import { resolveCode } from "@/lib/intake/data";
import type { IntakeResult } from "@/lib/intake/types";
import { loadOrdersContext } from "@/lib/intake/tracking/context";
import { buildShipCheck } from "@/lib/intake/tracking/summaries";
import type { ShipCheckResponse } from "@/lib/intake/tracking/types";

/**
 * GET /api/admin/track/ship-check?code=: before a bag or order ships, every
 * card is checked: done and out of the work-station slots = ok; still in a
 * slot = "still in CLAMP 07" (in_slot); not done = not_done; refunded cards
 * are listed apart. A Card ID checks its bag (or its order when it has no
 * bag). Read only. Server only; admin access is checked by the route.
 */
export async function loadShipCheck(admin: SupabaseClient, raw: string): Promise<IntakeResult<{ response: ShipCheckResponse }>> {
  const code = normalizeCode(raw);
  const kind = code ? codeKind(code) : null;
  if (!kind) return { ok: false, status: 400, error: "Scan the bag's or the order's QR." };
  if (kind === "location") return { ok: false, status: 400, error: "That's a slot. Scan the bag's or the order's QR." };
  try {
    const found = await resolveCode(admin, code);
    if (!found || found.kind === "location") return { ok: false, status: 404, error: `Nothing has the code ${code}.` };
    let orderId = found.orderId ?? null;
    let bagId: string | null = found.kind === "bag" ? found.id : null;
    if (found.kind === "card") {
      const { data, error } = await admin.from("cards").select("order_id, bag_id").eq("id", found.id).maybeSingle();
      if (error) throw new Error(error.message);
      orderId = (data?.order_id as string | null) ?? null;
      bagId = (data?.bag_id as string | null) ?? null;
    }
    if (!orderId) return { ok: false, status: 404, error: `Nothing has the code ${code}.` };
    const ctx = await loadOrdersContext(admin, [orderId]);
    const order = ctx.orders.get(orderId);
    if (!order) return { ok: false, status: 404, error: "Order not found" };
    const bags = [...ctx.bags.values()].filter((b) => (bagId ? b.id === bagId : b.order_id === orderId));
    const cards = ctx.cards.filter((c) => (bagId ? c.bag_id === bagId : c.order_id === orderId));
    return { ok: true, response: buildShipCheck({ scope: bagId ? "bag" : "order", order, bags, cards, ctx }) };
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't check ${code}. (${e instanceof Error ? e.message : String(e)})` };
  }
}
