import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { isMissingSchema } from "../_components/schema";
import { missingTracking, PLACE_COLUMNS, type PlaceRow } from "../shelf/_lib/places";

/**
 * Every place (active and turned off) with how many cards are there now:
 * cards whose location_id is the place, not refunded, of orders still in the
 * shop (not shipped back, delivered or cancelled). Paged reads (the API
 * returns at most 1,000 rows).
 */

export type PlaceWithCount = PlaceRow & { cardCount: number };

export type PlacesLoad =
  | { ok: true; places: PlaceWithCount[] }
  | { ok: false; missingSchema: boolean; error: string };

/** Orders whose cards have left the shop (their last place doesn't count any more). */
const GONE_STATUSES = "(shipped_back,delivered,cancelled)";

export async function loadPlaces(admin: SupabaseClient): Promise<PlacesLoad> {
  try {
    const [places, cards] = await Promise.all([
      fetchAll<PlaceRow>((from, to) => admin.from("locations").select(PLACE_COLUMNS).order("id").range(from, to)),
      fetchAll<{ location_id: string; status: string | null }>((from, to) =>
        admin.from("cards").select("id, location_id, status, orders!inner(status)")
          .not("location_id", "is", null).not("orders.status", "in", GONE_STATUSES)
          .order("id").range(from, to)),
    ]);
    const counts = new Map<string, number>();
    for (const c of cards) {
      if (c.status === "refunded") continue;
      counts.set(c.location_id, (counts.get(c.location_id) ?? 0) + 1);
    }
    return { ok: true, places: places.map((p) => ({ ...p, cardCount: counts.get(p.id) ?? 0 })) };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, missingSchema: isMissingSchema({ message: error }) || missingTracking(error), error };
  }
}
