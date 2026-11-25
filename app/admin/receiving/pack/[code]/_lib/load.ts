import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { codeKind, normalizeCode, openCodePath } from "@/lib/intake/codes";
import { resolveCode } from "@/lib/intake/data";
import { loadPacking } from "@/lib/intake/shipping/bag-shipments";
import { paidServiceOf, returnAddress, type ReturnLabelOrder } from "@/lib/intake/shipping/bag-label";
import { serviceName, type PackCardExtra, type PackExtras } from "@/lib/intake/shipping/packing-view";
import type { PackingResponse } from "@/lib/intake/shipping/types";
import { thumbnail } from "@/lib/thumbnail";

/**
 * The reads behind the packing page (server only; the page checks admin
 * access): the packing API's own answer (loadPacking, exactly what GET
 * /api/admin/intake/bags/<id>/ship-label returns, so the page needs no
 * second request to show), plus what the API doesn't carry: each card's
 * small photo and details, where the package goes (city, state, country)
 * and the service the customer paid for. Reads only.
 */

export type PackLoad =
  | { ok: true; packing: PackingResponse; extras: PackExtras }
  | { ok: false; status: 404 }
  | { ok: false; status: 500; error: string };

type OrderRow = ReturnLabelOrder & { id: string };
type CardRow = {
  id: string;
  card_year: string | null;
  card_set: string | null;
  card_number: string | null;
  photo_urls: (string | null)[] | null;
  receiving_photo_urls: (string | null)[] | null;
  catalog_image_url: string | null;
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const web = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u);
/** The photo shown at 64 CSS px (the order of the Scan page's: receiving photo, the customer's, the catalog picture). */
const PHOTO_PX = 64;

/** "Philadelphia, PA, US" from the order's return address, or null. */
export function shipToText(addr: Record<string, string> | null | undefined): string | null {
  if (!addr) return null;
  const text = [addr.city, addr.state, addr.country || (addr.street1 ? "US" : "")].map((x) => (x ?? "").trim()).filter(Boolean).join(", ");
  return text || null;
}

function cardExtra(c: CardRow): PackCardExtra {
  const photo = [...(c.receiving_photo_urls ?? []), ...(c.photo_urls ?? []), c.catalog_image_url].find(web) ?? null;
  return {
    photo: photo ? thumbnail(photo, PHOTO_PX) : null,
    details: [c.card_year, c.card_set, c.card_number ? `#${c.card_number}` : ""].map((x) => (x ?? "").trim()).filter(Boolean).join(" · "),
    cardUrl: `/admin/receiving/card/${encodeURIComponent(c.id)}`,
  };
}

/** A Bag ID (any case) and everything the packing page shows; 404 for any other code, or a bag nothing has. */
export async function loadPack(admin: SupabaseClient, raw: string): Promise<PackLoad> {
  const code = normalizeCode(raw);
  if (!code || codeKind(code) !== "bag") return { ok: false, status: 404 };
  try {
    const found = await resolveCode(admin, code);
    if (!found || found.kind !== "bag") return { ok: false, status: 404 };
    const answer = await loadPacking(admin, found.id);
    if (!answer.ok) {
      if (answer.status === 404) return { ok: false, status: 404 };
      return { ok: false, status: 500, error: answer.body.error };
    }
    const packing = answer.body;
    const orderId = packing.order.id;
    const [orderRes, cards] = await Promise.all([
      admin.from("orders")
        .select("id, customer_email, ship_from_address, inbound_carrier, inbound_service_level, return_carrier, return_service_level")
        .eq("id", orderId).maybeSingle(),
      fetchAll<CardRow>((from, to) =>
        admin.from("cards").select("id, card_year, card_set, card_number, photo_urls, receiving_photo_urls, catalog_image_url")
          .eq("bag_id", packing.bag.id).order("id").range(from, to)),
    ]);
    if (orderRes.error) throw new Error(orderRes.error.message);
    const order = (orderRes.data ?? { id: orderId }) as OrderRow;
    const bagCode = packing.bag.code;
    const extras: PackExtras = {
      customerEmail: typeof order.customer_email === "string" && order.customer_email.trim() ? order.customer_email.trim() : null,
      shipTo: shipToText(returnAddress(order)),
      paidService: serviceName(paidServiceOf(order)),
      cards: Object.fromEntries(cards.map((c) => [c.id, cardExtra(c)])),
      links: {
        order: `/admin/orders/${encodeURIComponent(orderId)}`,
        shipping: `/admin/orders/${encodeURIComponent(orderId)}#shipping`,
        shipCheck: `/admin/receiving/ship/${encodeURIComponent(orderId)}?bag=${encodeURIComponent(packing.bag.id)}`,
        open: openCodePath(bagCode),
      },
    };
    return { ok: true, packing, extras };
  } catch (e) {
    return { ok: false, status: 500, error: errText(e) };
  }
}
