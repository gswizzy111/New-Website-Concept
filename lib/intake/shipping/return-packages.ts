import type { SupabaseClient } from "@supabase/supabase-js";
import { trackingLink } from "@/lib/tracking-carrier";
import { cardList, returnPackagesToShow } from "@/lib/intake/shipping/types";

/**
 * The customer's order pages (/orders/<number>, /account/orders/<id>): one
 * return tracking panel per package when the order ships back in several
 * bags. [] means "show the order's single return tracking number as before"
 * (every single-bag order, every order from before per-bag labels, and any
 * read error, including before the bag_shipments migration).
 */

export type ReturnPackage = {
  id: string;
  /** "Return Tracking: Package 1 of 2" */
  label: string;
  number: string;
  href: string;
  delivered: boolean;
  /** "Charizard, Blastoise" (the cards in it) */
  cards: string;
};

type ShipmentRow = { id: string; bag_id: string; status: string; tracking_number: string | null; tracking_url: string | null; carrier: string | null };
type CardRow = { bag_id?: string | null; status?: string | null; card_name?: string | null };

export async function loadReturnPackages(
  admin: SupabaseClient,
  order: { id: string; tracking_number?: string | null },
  cards: readonly CardRow[],
): Promise<ReturnPackage[]> {
  try {
    const { data, error } = await admin
      .from("bag_shipments")
      .select("id, bag_id, status, tracking_number, tracking_url, carrier")
      .eq("order_id", order.id)
      .in("status", ["shipped", "delivered"])
      .order("shipped_at", { ascending: true })
      .order("id");
    if (error || !data) return [];
    const show = returnPackagesToShow(order.tracking_number ?? null, data as ShipmentRow[]);
    if (show.length === 0) return [];
    const live = cards.filter((c) => c.status !== "refunded");
    const bagCount = new Set(live.map((c) => c.bag_id).filter(Boolean)).size;
    const total = Math.max(bagCount, show.length);
    return show.map((s, i) => ({
      id: s.id,
      label: total > 1 ? `Return Tracking: Package ${i + 1} of ${total}` : "Return Tracking",
      number: s.tracking_number as string,
      href: trackingLink(s.tracking_number as string, s.carrier, s.tracking_url),
      delivered: s.status === "delivered",
      cards: cardList(live.filter((c) => c.bag_id === s.bag_id).map((c) => c.card_name ?? "")),
    }));
  } catch {
    return [];
  }
}
