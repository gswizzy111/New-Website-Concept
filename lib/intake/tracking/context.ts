import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { loadTierNames } from "@/lib/intake/data";
import type { StageEventRow } from "@/lib/intake/types";
import { locationRef } from "@/lib/intake/tracking/places";
import {
  TRACK_BAG_COLUMNS, TRACK_CARD_COLUMNS, TRACK_ORDER_COLUMNS,
  type SummaryContext, type TrackBagRow, type TrackCardRow, type TrackOrderRow,
} from "@/lib/intake/tracking/summaries";
import type { LocationRef, LocationRow } from "@/lib/intake/tracking/types";

/**
 * Reads shared by the tracking services (server only): every card, bag and
 * stage event of some orders, and every place. Throws on a failed read (the
 * callers turn it into { ok: false, status: 500 }).
 */

const CHUNK = 100;
const chunks = <T>(xs: readonly T[], n = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};
export { chunks };

/** Every place by id (a small table: stations, a slot per due date, a few others). */
export async function loadLocationRefs(admin: SupabaseClient): Promise<Map<string, LocationRef>> {
  const rows = await fetchAll<Pick<LocationRow, "id" | "code" | "name" | "kind">>((from, to) =>
    admin.from("locations").select("id, code, name, kind").order("id").range(from, to));
  return new Map(rows.map((r) => [r.id, locationRef(r)]));
}

export type OrdersContext = SummaryContext & {
  orders: Map<string, TrackOrderRow>;
  bags: Map<string, TrackBagRow>;
  events: Map<string, StageEventRow[]>;
  locations: Map<string, LocationRef>;
  /** Every card of the orders (refunded and not received included). */
  cards: TrackCardRow[];
};

/** Orders, all their cards and bags, their stage events (newest first per order), every place and the tier names. */
export async function loadOrdersContext(admin: SupabaseClient, orderIds: readonly string[]): Promise<OrdersContext> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  const [orders, cards, bags, events, locations, tierNames] = await Promise.all([
    Promise.all(chunks(ids).map(async (part) => {
      const { data, error } = await admin.from("orders").select(TRACK_ORDER_COLUMNS).in("id", part);
      if (error) throw new Error(error.message);
      return (data ?? []) as TrackOrderRow[];
    })).then((p) => p.flat()),
    Promise.all(chunks(ids).map((part) => fetchAll<TrackCardRow>((from, to) =>
      admin.from("cards").select(TRACK_CARD_COLUMNS).in("order_id", part).order("id").range(from, to)))).then((p) => p.flat()),
    Promise.all(chunks(ids).map((part) => fetchAll<TrackBagRow>((from, to) =>
      admin.from("tier_bags").select(TRACK_BAG_COLUMNS).in("order_id", part).order("id").range(from, to)))).then((p) => p.flat()),
    Promise.all(chunks(ids).map((part) => fetchAll<StageEventRow & { order_id: string }>((from, to) =>
      admin.from("order_events").select("order_id, event_type, description, metadata, created_at").in("order_id", part)
        .in("event_type", ["stage_update", "round_started"])
        .order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to)))).then((p) => p.flat()),
    ids.length ? loadLocationRefs(admin) : Promise.resolve(new Map<string, LocationRef>()),
    ids.length ? loadTierNames(admin) : Promise.resolve({} as Record<string, string>),
  ]);
  const byOrder = new Map<string, StageEventRow[]>();
  for (const e of events) {
    const list = byOrder.get(e.order_id) ?? [];
    list.push(e);
    byOrder.set(e.order_id, list);
  }
  // Newest first across chunks too (each order sits in one chunk, so its order is kept)
  return {
    orders: new Map(orders.map((o) => [o.id, o])),
    cards,
    bags: new Map(bags.map((b) => [b.id, b])),
    events: byOrder,
    locations,
    tierNames,
  };
}
