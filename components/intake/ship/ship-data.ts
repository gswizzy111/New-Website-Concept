import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOrderIntake } from "@/lib/intake/data";
import type { BagSummary, IntakeCard, IntakeOrder, IntakeResult } from "@/lib/intake/types";
import type { LocationKind } from "@/lib/intake/tracking/types";
import { isMissingTracking } from "./schema";
import { lastSeenText, readyToShip, shipCheckStatus, shipCounts, type ShipCounts, type ShipRowStatus } from "./rules";

/**
 * The ship check page's data (/admin/receiving/ship/<orderId>): the order,
 * every card with whether it's done and where it was last scanned, grouped by
 * tier bag. Reads only: the order workspace loader (lib/intake/data.ts; it
 * heals bag completion like every receiving page) plus each card's and bag's
 * place (cards.location_id / tier_bags.location_id, supabase/migrations/
 * 20261124_card_tracking.sql). Before that migration is applied the page still
 * works on done / not done (`trackPlaces` false).
 */

export type ShipPlace = { code: string; name: string; kind: LocationKind };

export type ShipRow = {
  id: string;
  code: string | null;
  name: string;
  /** "2023 · Obsidian Flames · #125" */
  detail: string;
  bagId: string | null;
  bagCode: string | null;
  done: boolean;
  refunded: boolean;
  awaiting: boolean;
  /** "Final Dry", "Drying", "Not started", "Done". */
  stageLabel: string;
  atFinalDry: boolean;
  place: ShipPlace | null;
  locatedAt: string | null;
  /** "Humidor, 2 days ago" / "Never scanned". */
  lastSeen: string;
  status: ShipRowStatus;
};

export type ShipGroup = {
  bag: { id: string; code: string; tierName: string; place: ShipPlace | null } | null;
  rows: ShipRow[];
};

export type ShipCheckData = {
  order: IntakeOrder;
  bags: BagSummary[];
  groups: ShipGroup[];
  counts: ShipCounts;
  ready: boolean;
  /** The places tables exist: "at Shipping" is checked. */
  trackPlaces: boolean;
  /** A places read failed for another reason (shown, the page still works). */
  placesError: string | null;
};

type PlaceJoin = { code: string; name: string; kind: LocationKind } | null;
type CardPlaceRow = { id: string; location_id: string | null; located_at: string | null; locations: PlaceJoin };
type BagPlaceRow = { id: string; location_id: string | null; located_at: string | null; locations: PlaceJoin };

/** Where each of the order's cards and bags is now; empty maps when the places tables aren't there yet. */
async function loadPlaces(admin: SupabaseClient, orderId: string): Promise<{
  cards: Map<string, { place: ShipPlace | null; at: string | null }>;
  bags: Map<string, ShipPlace | null>;
  ready: boolean;
  error: string | null;
}> {
  const cards = new Map<string, { place: ShipPlace | null; at: string | null }>();
  const bags = new Map<string, ShipPlace | null>();
  const [c, b] = await Promise.all([
    admin.from("cards").select("id, location_id, located_at, locations(code, name, kind)").eq("order_id", orderId).limit(5000),
    admin.from("tier_bags").select("id, location_id, located_at, locations(code, name, kind)").eq("order_id", orderId).limit(500),
  ]);
  const err = c.error ?? b.error;
  if (err) {
    if (isMissingTracking(err)) return { cards, bags, ready: false, error: null };
    console.warn("[ship check] places not read:", err.message);
    return { cards, bags, ready: false, error: err.message };
  }
  // A many-to-one embed is one object (the select parser types it as a list)
  for (const r of (c.data ?? []) as unknown as CardPlaceRow[]) {
    cards.set(r.id, { place: r.location_id && r.locations ? r.locations : null, at: r.located_at });
  }
  for (const r of (b.data ?? []) as unknown as BagPlaceRow[]) {
    bags.set(r.id, r.location_id && r.locations ? r.locations : null);
  }
  return { cards, bags, ready: true, error: null };
}

function detailOf(card: IntakeCard): string {
  return [card.year, card.set, card.number ? `#${card.number}` : ""].filter(Boolean).join(" · ");
}

export async function loadShipCheck(
  admin: SupabaseClient,
  orderId: string,
  now = Date.now(),
): Promise<IntakeResult<{ data: ShipCheckData }>> {
  const [loaded, places] = await Promise.all([loadOrderIntake(admin, orderId), loadPlaces(admin, orderId)]);
  if (!loaded.ok) return loaded;
  const { order, cards, bags } = loaded.intake;

  const rowOf = (card: IntakeCard): ShipRow => {
    const where = places.cards.get(card.id) ?? { place: null, at: null };
    const done = card.completed;
    return {
      id: card.id,
      code: card.code,
      name: card.name,
      detail: detailOf(card),
      bagId: card.bagId,
      bagCode: card.bagCode,
      done,
      refunded: card.refunded,
      awaiting: card.awaitingArrival,
      stageLabel: card.stage.currentLabel,
      atFinalDry: !done && card.stage.current === "Final Dry",
      place: where.place,
      locatedAt: where.at,
      lastSeen: lastSeenText(where.place, where.at, now),
      status: shipCheckStatus(
        { refunded: card.refunded, done, awaiting: card.awaitingArrival, locationKind: where.place?.kind ?? null },
        places.ready,
      ),
    };
  };

  // One group per tier bag (fastest tier first, as loaded), then cards in no bag
  const groups: ShipGroup[] = bags.map((bag) => ({
    bag: { id: bag.id, code: bag.code, tierName: bag.tierName, place: places.bags.get(bag.id) ?? null },
    rows: cards.filter((c) => c.bagId === bag.id).map(rowOf),
  }));
  const loose = cards.filter((c) => !c.bagId || !bags.some((b) => b.id === c.bagId)).map(rowOf);
  if (loose.length) groups.push({ bag: null, rows: loose });
  // Refunded cards last within each group, otherwise by card number (as loaded)
  for (const g of groups) g.rows.sort((a, b) => Number(a.refunded) - Number(b.refunded));

  const statuses = groups.flatMap((g) => g.rows.map((r) => r.status));
  return {
    ok: true,
    data: {
      order,
      bags,
      groups: groups.filter((g) => g.rows.length > 0),
      counts: shipCounts(statuses),
      ready: readyToShip(statuses),
      trackPlaces: places.ready,
      placesError: places.error,
    },
  };
}
