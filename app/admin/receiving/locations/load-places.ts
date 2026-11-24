import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { isMissingSchema } from "../_components/schema";
import { missingTracking, PLACE_COLUMNS, type PlaceRow } from "../shelf/_lib/places";

/**
 * Every place (active and turned off) with the cards in it now: cards whose
 * location_id is the place, not refunded, of orders still in the shop (not
 * shipped back, delivered or cancelled), each with its Card ID, name,
 * customer and its bag's due date (slot tiles show who is in the slot).
 * Paged reads (the API returns at most 1,000 rows).
 */

export type Occupant = {
  id: string;
  code: string | null;
  name: string;
  customer: string | null;
  orderId: string;
  dueDate: string | null;
  locatedAt: string | null;
};

export type PlaceWithCards = PlaceRow & { cards: Occupant[] };

export type PlacesLoad =
  | { ok: true; places: PlaceWithCards[] }
  | { ok: false; missingSchema: boolean; error: string };

/** Orders whose cards have left the shop (their last place doesn't count any more). */
const GONE_STATUSES = "(shipped_back,delivered,cancelled)";

type CardRow = {
  id: string;
  card_code: string | null;
  card_name: string | null;
  location_id: string;
  located_at: string | null;
  status: string | null;
  order_id: string;
  bag_id: string | null;
  orders: { customer_name: string | null } | null;
};

export async function loadPlaces(admin: SupabaseClient): Promise<PlacesLoad> {
  try {
    const [places, cards] = await Promise.all([
      fetchAll<PlaceRow>((from, to) => admin.from("locations").select(PLACE_COLUMNS).order("id").range(from, to)),
      fetchAll<CardRow>((from, to) =>
        admin.from("cards").select("id, card_code, card_name, location_id, located_at, status, order_id, bag_id, orders!inner(customer_name, status)")
          .not("location_id", "is", null).not("orders.status", "in", GONE_STATUSES)
          .order("id").range(from, to) as unknown as PromiseLike<{ data: CardRow[] | null; error: { message: string } | null }>),
    ]);
    const live = cards.filter((c) => c.status !== "refunded");

    // The bags' due dates (slot tiles say when each card is due)
    const bagIds = [...new Set(live.map((c) => c.bag_id).filter((id): id is string => !!id))];
    const due = new Map<string, string | null>();
    for (let i = 0; i < bagIds.length; i += 100) {
      const { data, error } = await admin.from("tier_bags").select("id, due_date").in("id", bagIds.slice(i, i + 100));
      if (error) break; // the tiles just leave the date out
      for (const b of (data ?? []) as { id: string; due_date: string | null }[]) due.set(b.id, b.due_date);
    }

    const byPlace = new Map<string, Occupant[]>();
    for (const c of live) {
      const list = byPlace.get(c.location_id) ?? [];
      list.push({
        id: c.id,
        code: c.card_code,
        name: c.card_name?.trim() || "Card",
        customer: c.orders?.customer_name?.trim() || null,
        orderId: c.order_id,
        dueDate: c.bag_id ? due.get(c.bag_id) ?? null : null,
        locatedAt: c.located_at,
      });
      byPlace.set(c.location_id, list);
    }
    // Longest there first
    for (const list of byPlace.values()) list.sort((a, b) => (a.locatedAt ?? "").localeCompare(b.locatedAt ?? ""));
    return { ok: true, places: places.map((p) => ({ ...p, cards: byPlace.get(p.id) ?? [] })) };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, missingSchema: isMissingSchema({ message: error }) || missingTracking(error), error };
  }
}
