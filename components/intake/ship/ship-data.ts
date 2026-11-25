import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOrderIntake } from "@/lib/intake/data";
import type { IntakeCard, IntakeOrder, IntakeResult } from "@/lib/intake/types";
import { allCardsOk, isSlot, lastSeenText, shipCheckStatus, shipCounts, type ShipCounts } from "./rules";
import { lastOut, loadBagPlaces, loadCardPlaces, loadLastMoves, loadPlaces, type Place } from "./places-data";
import type { ShipGroup, ShipPlace, ShipRow } from "./ship-types";

/**
 * The ship check page's data (/admin/receiving/ship/<orderId>): the order and
 * every card with whether it's done and whether it's back in its bag (not in a
 * holder, on a desk or on the old Done shelf), grouped
 * by tier bag. Reads only: the order workspace loader (lib/intake/data.ts; it
 * heals bag completion like every receiving page) plus the card places
 * (places-data.ts). Before the tracking migration the page still works on
 * done / not done (`trackPlaces` false).
 */

export type ShipCheckData = {
  order: IntakeOrder;
  groups: ShipGroup[];
  counts: ShipCounts;
  /** Every card that goes back is done and out of its slot. */
  allOk: boolean;
  /** The places tables exist: "still in a slot" is checked. */
  trackPlaces: boolean;
  placesError: string | null;
};

const placeOf = (p: Place | undefined): ShipPlace | null => (p ? { code: p.code, name: p.name, kind: p.kind } : null);

export async function loadShipCheck(
  admin: SupabaseClient,
  orderId: string,
  now = Date.now(),
): Promise<IntakeResult<{ data: ShipCheckData }>> {
  const [loaded, places, cardPlaces, bagPlaces, moves] = await Promise.all([
    loadOrderIntake(admin, orderId),
    loadPlaces(admin),
    loadCardPlaces(admin, [orderId]),
    loadBagPlaces(admin, [orderId]),
    loadLastMoves(admin, [orderId]),
  ]);
  if (!loaded.ok) return loaded;
  const { order, cards, bags } = loaded.intake;
  const trackPlaces = places.ready && cardPlaces.ready;

  const rowOf = (card: IntakeCard): ShipRow => {
    const at = cardPlaces.byCard.get(card.id);
    const p = at?.locationId ? places.places.get(at.locationId) : undefined;
    const inSlot = isSlot(p);
    return {
      id: card.id,
      code: card.code,
      name: card.name,
      detail: [card.year, card.set, card.number ? `#${card.number}` : ""].filter(Boolean).join(" · "),
      bagId: card.bagId,
      bagCode: card.bagCode,
      done: card.completed,
      refunded: card.refunded,
      // as the tracking API's isReceived (lib/intake/tracking/summaries.ts)
      received: !card.awaitingArrival && (!!card.bagId || !!card.receivedAt),
      stageLabel: card.stage.currentLabel,
      atFinalDry: !card.completed && card.stage.current === "Final Dry",
      place: placeOf(p),
      inSlot,
      lastSeen: trackPlaces ? lastSeenText(p ?? null, at?.locatedAt ?? null, lastOut(moves.get(card.id), places.places), now) : "",
      // Done and back in its bag (isBackInBag): a place no longer listed counts as out of the bag, as the Ready to ship bin reads it
      status: shipCheckStatus({
        refunded: card.refunded, done: card.completed, awaiting: card.awaitingArrival,
        place: trackPlaces && at?.locationId ? (p ? { code: p.code, kind: p.kind } : { code: "", kind: "other" }) : null,
      }),
    };
  };

  // One group per tier bag (fastest tier first, as loaded), then cards in no bag
  const groups: ShipGroup[] = bags.map((bag) => {
    const placeId = bagPlaces.get(bag.id);
    return {
      bag: { id: bag.id, code: bag.code, tierName: bag.tierName, place: placeId ? places.places.get(placeId)?.name ?? null : null },
      rows: cards.filter((c) => c.bagId === bag.id).map(rowOf),
    };
  });
  const loose = cards.filter((c) => !c.bagId || !bags.some((b) => b.id === c.bagId)).map(rowOf);
  if (loose.length) groups.push({ bag: null, rows: loose });
  // Refunded cards last within each group, otherwise by card number (as loaded)
  for (const g of groups) g.rows.sort((a, b) => Number(a.refunded) - Number(b.refunded));

  const statuses = groups.flatMap((g) => g.rows.map((r) => r.status));
  return {
    ok: true,
    data: {
      order,
      groups: groups.filter((g) => g.rows.length > 0),
      counts: shipCounts(statuses),
      allOk: allCardsOk(statuses),
      trackPlaces,
      placesError: places.error,
    },
  };
}
