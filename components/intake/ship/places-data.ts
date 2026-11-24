import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { isMissingTracking } from "./schema";

/**
 * Card places for the ship check and the Forgotten report: the places table,
 * and each card's latest card_moves row (supabase/migrations/
 * 20261124_card_tracking.sql). Reads only. Before that migration is applied
 * every helper answers "not ready" (empty) instead of failing the page.
 */

export type Place = { id: string; code: string; name: string; kind: string; stage: string | null };
export type LastMove = { at: string; action: string; fromId: string | null; toId: string | null };

const CHUNK = 100;
export function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Every place by id (slots, shelves, Done, Shipping; switched-off ones too: cards may still point at them). */
export async function loadPlaces(admin: SupabaseClient): Promise<{ places: Map<string, Place>; ready: boolean; error: string | null }> {
  try {
    const rows = await fetchAll<Place>((from, to) =>
      admin.from("locations").select("id, code, name, kind, stage").order("id").range(from, to));
    return { places: new Map(rows.map((p) => [p.id, p])), ready: true, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isMissingTracking({ message })) return { places: new Map(), ready: false, error: null };
    console.warn("[ship] places not read:", message);
    return { places: new Map(), ready: false, error: message };
  }
}

/**
 * Where each card is now: cards.location_id / located_at by card id (cards
 * read by order). Empty and not ready before the migration.
 */
export async function loadCardPlaces(
  admin: SupabaseClient,
  orderIds: readonly string[],
): Promise<{ byCard: Map<string, { locationId: string | null; locatedAt: string | null }>; ready: boolean }> {
  const byCard = new Map<string, { locationId: string | null; locatedAt: string | null }>();
  if (!orderIds.length) return { byCard, ready: true };
  try {
    const pages = await Promise.all(chunks(orderIds).map((ids) =>
      fetchAll<{ id: string; location_id: string | null; located_at: string | null }>((from, to) =>
        admin.from("cards").select("id, location_id, located_at").in("order_id", ids).order("id").range(from, to))));
    for (const r of pages.flat()) byCard.set(r.id, { locationId: r.location_id, locatedAt: r.located_at });
    return { byCard, ready: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!isMissingTracking({ message })) console.warn("[ship] card places not read:", message);
    return { byCard: new Map(), ready: false };
  }
}

/** Where each bag is now (tier_bags.location_id): bag id -> place id. Empty before the migration. */
export async function loadBagPlaces(admin: SupabaseClient, orderIds: readonly string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!orderIds.length) return out;
  try {
    const pages = await Promise.all(chunks(orderIds).map((ids) =>
      fetchAll<{ id: string; location_id: string | null }>((from, to) =>
        admin.from("tier_bags").select("id, location_id").in("order_id", ids).order("id").range(from, to))));
    for (const r of pages.flat()) out.set(r.id, r.location_id);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!isMissingTracking({ message })) console.warn("[ship] bag places not read:", message);
  }
  return out;
}

/**
 * Each card's latest card_moves row (into, out of or between places), read
 * by order, newest first. Empty before the migration.
 */
export async function loadLastMoves(admin: SupabaseClient, orderIds: readonly string[]): Promise<Map<string, LastMove>> {
  const out = new Map<string, LastMove>();
  if (!orderIds.length) return out;
  try {
    const pages = await Promise.all(chunks(orderIds).map((ids) =>
      fetchAll<{ card_id: string; action: string; from_location_id: string | null; to_location_id: string | null; created_at: string }>((from, to) =>
        admin.from("card_moves").select("card_id, action, from_location_id, to_location_id, created_at")
          .in("order_id", ids).order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to))));
    for (const r of pages.flat()) {
      const seen = out.get(r.card_id);
      if (seen && Date.parse(seen.at) >= Date.parse(r.created_at)) continue;
      out.set(r.card_id, { at: r.created_at, action: r.action, fromId: r.from_location_id, toId: r.to_location_id });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!isMissingTracking({ message })) console.warn("[ship] card moves not read:", message);
  }
  return out;
}

/** The slot a card last came out of (its latest move left a place for none), for "Out of CLAMP 07". */
export function lastOut(move: LastMove | undefined, places: Map<string, Place>): { from: string | null; at: string } | null {
  if (!move || move.toId || !move.fromId) return null;
  return { from: places.get(move.fromId)?.name ?? null, at: move.at };
}
