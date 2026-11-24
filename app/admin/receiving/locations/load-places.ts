import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { isMissingSchema } from "../_components/schema";
import { missingTracking, PLACE_COLUMNS, type PlaceRow } from "../shelf/_lib/places";

/**
 * Every place (active and turned off) with the cards in it now: cards whose
 * location_id is the place, each with its Card ID, name, customer and its
 * bag's due date (slot tiles show who is in the slot). Station slots list
 * every card the tracking library counts there (refunded cards and cards of
 * finished orders too, flagged, so a tile never says Empty while the Scan
 * page calls the slot full); shelves, Done, Shipping and other places only
 * cards still in the shop (not refunded, order not shipped back, delivered or
 * cancelled). Shelf slots also count the open bags put on them. Paged reads
 * (the API returns at most 1,000 rows).
 */

export type Occupant = {
  id: string;
  code: string | null;
  name: string;
  customer: string | null;
  orderId: string;
  dueDate: string | null;
  locatedAt: string | null;
  /** "Refunded", "Order shipped", "Order cancelled": still recorded in a station slot (take it out on the Scan page). */
  note: string | null;
};

export type PlaceWithCards = PlaceRow & { cards: Occupant[]; /** Open bags put on the place (shelf slots). */ bagCount: number };

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
  orders: { customer_name: string | null; status: string | null } | null;
};

const CARD_COLUMNS = "id, card_code, card_name, location_id, located_at, status, order_id, bag_id";
const chunks = <T,>(xs: readonly T[], n = 100): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

function noteFor(c: CardRow): string | null {
  if (c.status === "refunded") return "Refunded";
  const s = c.orders?.status;
  if (s === "cancelled") return "Order cancelled";
  if (s === "shipped_back" || s === "delivered") return "Order shipped";
  return null;
}

export async function loadPlaces(admin: SupabaseClient): Promise<PlacesLoad> {
  try {
    const [places, cards, bags] = await Promise.all([
      fetchAll<PlaceRow>((from, to) => admin.from("locations").select(PLACE_COLUMNS).order("id").range(from, to)),
      fetchAll<CardRow>((from, to) =>
        admin.from("cards").select(`${CARD_COLUMNS}, orders!inner(customer_name, status)`)
          .not("location_id", "is", null).not("orders.status", "in", GONE_STATUSES)
          .order("id").range(from, to) as unknown as PromiseLike<{ data: CardRow[] | null; error: { message: string } | null }>),
      fetchAll<{ id: string; location_id: string }>((from, to) =>
        admin.from("tier_bags").select("id, location_id").not("location_id", "is", null).is("completed_at", null)
          .order("id").range(from, to) as unknown as PromiseLike<{ data: { id: string; location_id: string }[] | null; error: { message: string } | null }>),
    ]);
    // Station slots: every card recorded there, as the tracking library counts them (capacity, "full")
    const slotIds = places.filter((p) => p.kind === "station").map((p) => p.id);
    const inSlots = (await Promise.all(chunks(slotIds).map((ids) => fetchAll<CardRow>((from, to) =>
      admin.from("cards").select(`${CARD_COLUMNS}, orders(customer_name, status)`).in("location_id", ids)
        .order("id").range(from, to) as unknown as PromiseLike<{ data: CardRow[] | null; error: { message: string } | null }>)))).flat();
    const slotSet = new Set(slotIds);
    const live = [...cards.filter((c) => c.status !== "refunded" && !slotSet.has(c.location_id)), ...inSlots];
    const bagCount = new Map<string, number>();
    for (const b of bags) bagCount.set(b.location_id, (bagCount.get(b.location_id) ?? 0) + 1);

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
        note: noteFor(c),
      });
      byPlace.set(c.location_id, list);
    }
    // Longest there first
    for (const list of byPlace.values()) list.sort((a, b) => (a.locatedAt ?? "").localeCompare(b.locatedAt ?? ""));
    return { ok: true, places: places.map((p) => ({ ...p, cards: byPlace.get(p.id) ?? [], bagCount: bagCount.get(p.id) ?? 0 })) };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, missingSchema: isMissingSchema({ message: error }) || missingTracking(error), error };
  }
}
