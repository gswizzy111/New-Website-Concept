import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { codeKind, normalizeCode, orderPhotosPath } from "@/lib/intake/codes";
import { resolveCode } from "@/lib/intake/data";
import type { IntakeResult } from "@/lib/intake/types";
import { chunks, loadOrdersContext, type OrdersContext } from "@/lib/intake/tracking/context";
import { loadDeskRefs } from "@/lib/intake/tracking/desk";
import { getLocationById } from "@/lib/intake/tracking/locations";
import { hasRoom, locationView } from "@/lib/intake/tracking/places";
import {
  TRACK_BAG_COLUMNS, bagSummary, byBag, bySeq, cardSummary,
  type TrackBagRow, type TrackCardRow,
} from "@/lib/intake/tracking/summaries";
import type {
  ResolveResponse, SearchResponse, TrackBagSummary, TrackCardSummary, TrackOrderSummary, TrackSlotSummary,
} from "@/lib/intake/tracking/types";

/**
 * What the Scan page shows for a scanned or typed code, and the card search
 * (server only; admin access is checked by the route).
 */

const SLOT_CARD_LIMIT = 200;
const SEARCH_LIMIT = 30;

/** Card summaries by id, in the order given (unknown ids left out); `notes`: with their notes. Throws on a failed read. */
export async function loadCardSummaries(admin: SupabaseClient, cardIds: readonly string[], opts: { notes?: boolean } = {}): Promise<TrackCardSummary[]> {
  const ids = [...new Set(cardIds)];
  if (!ids.length) return [];
  const orderIds = new Set<string>();
  for (const part of chunks(ids)) {
    const { data, error } = await admin.from("cards").select("id, order_id").in("id", part);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) if (r.order_id) orderIds.add(r.order_id as string);
  }
  const ctx = await loadOrdersContext(admin, [...orderIds], opts);
  const byId = new Map(ctx.cards.map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter((c): c is TrackCardRow => !!c).map((c) => cardSummary(c, ctx));
}

function withoutCards(s: TrackBagSummary): Omit<TrackBagSummary, "cards"> {
  const copy: Partial<TrackBagSummary> = { ...s };
  delete copy.cards;
  return copy as Omit<TrackBagSummary, "cards">;
}

function orderSummary(orderId: string, ctx: OrdersContext): TrackOrderSummary | null {
  const order = ctx.orders.get(orderId);
  if (!order) return null;
  const cards = ctx.cards.filter((c) => c.order_id === orderId);
  const bags = [...ctx.bags.values()].filter((b) => b.order_id === orderId).sort(byBag).map((b) => bagSummary(b, cards, ctx));
  const looseCards = cards.filter((c) => !c.bag_id).sort(bySeq).map((c) => cardSummary(c, ctx));
  return { id: order.id, orderNumber: order.order_number, customer: order.customer_name, status: order.status, bags, looseCards, photosUrl: orderPhotosPath(order.id) };
}

/** A slot or place with the cards (and bags) in it. */
export async function loadSlotSummary(admin: SupabaseClient, locationId: string): Promise<IntakeResult<{ location: TrackSlotSummary }>> {
  try {
    const row = await getLocationById(admin, locationId);
    if (!row) return { ok: false, status: 404, error: "Place not found" };
    const [{ data: cardRows, error: cErr, count }, bagRows, desks] = await Promise.all([
      admin.from("cards").select("id, order_id", { count: "exact" }).eq("location_id", row.id)
        .order("located_at", { ascending: false, nullsFirst: false }).order("id").limit(SLOT_CARD_LIMIT),
      fetchAll<TrackBagRow>((from, to) => admin.from("tier_bags").select(TRACK_BAG_COLUMNS).eq("location_id", row.id).order("id").range(from, to)),
      // For "Move to my desk": a failed read leaves `desks` out, the place still shows
      loadDeskRefs(admin).catch((e) => {
        console.warn("[tracking] desks not read for the scanned place:", e instanceof Error ? e.message : String(e));
        return undefined;
      }),
    ]);
    if (cErr) throw new Error(cErr.message);
    const ids = (cardRows ?? []).map((r) => r.id as string);
    // With the cards' notes: the Scan page shows them with the card (owner, Nov 26 2026)
    const ctx = await loadOrdersContext(admin, [...new Set([...(cardRows ?? []).map((r) => r.order_id as string), ...bagRows.map((b) => b.order_id)])], { notes: true });
    const byId = new Map(ctx.cards.map((c) => [c.id, c]));
    const cards = ids.map((id) => byId.get(id)).filter((c): c is TrackCardRow => !!c).map((c) => cardSummary(c, ctx));
    const cardCount = count ?? cards.length;
    const bags = bagRows.sort(byBag).map((b) => withoutCards(bagSummary(b, ctx.cards, ctx)));
    return {
      ok: true,
      location: {
        ...locationView(row),
        cardCount,
        free: hasRoom(row.capacity, cardCount),
        overCapacity: row.capacity != null && cardCount > row.capacity,
        cards,
        bags,
        ...(desks ? { desks } : {}),
      },
    };
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the place. (${e instanceof Error ? e.message : String(e)})` };
  }
}

/**
 * GET /api/admin/track/resolve: a slot or place (LOC-...) -> the slot and its
 * cards; a Bag ID -> the bag's cards with their slots; an order code -> its
 * bags and cards; a Card ID -> the card. Every card comes with its notes
 * (variation, notes, knownDefects, customerNotes). 400 when it isn't a code,
 * 404 when nothing has it.
 */
export async function resolveTrackCode(admin: SupabaseClient, raw: string): Promise<IntakeResult<{ response: ResolveResponse }>> {
  const code = normalizeCode(raw);
  if (!code || !codeKind(code)) return { ok: false, status: 400, error: "That isn't a slot, bag, order or card code." };
  let found: Awaited<ReturnType<typeof resolveCode>>;
  try {
    found = await resolveCode(admin, code);
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't look up ${code}. (${e instanceof Error ? e.message : String(e)})` };
  }
  if (!found) return { ok: false, status: 404, error: `Nothing has the code ${code}.` };
  if (found.kind === "location") {
    const slot = await loadSlotSummary(admin, found.id);
    return slot.ok ? { ok: true, response: { kind: "location", code, location: slot.location } } : slot;
  }
  try {
    if (found.kind === "card") {
      const [card] = await loadCardSummaries(admin, [found.id], { notes: true });
      if (!card) return { ok: false, status: 404, error: `Nothing has the code ${code}.` };
      return { ok: true, response: { kind: "card", code, card } };
    }
    const orderId = found.orderId ?? found.id;
    const ctx = await loadOrdersContext(admin, [orderId], { notes: true });
    if (found.kind === "bag") {
      const bag = ctx.bags.get(found.id);
      if (!bag) return { ok: false, status: 404, error: `Nothing has the code ${code}.` };
      return { ok: true, response: { kind: "bag", code, bag: bagSummary(bag, ctx.cards, ctx) } };
    }
    const order = orderSummary(orderId, ctx);
    if (!order) return { ok: false, status: 404, error: `Nothing has the code ${code}.` };
    return { ok: true, response: { kind: "order", code, order } };
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read ${code}. (${e instanceof Error ? e.message : String(e)})` };
  }
}

/** Letters, digits, spaces, dashes, apostrophes and dots only (safe inside a PostgREST ilike filter). */
function searchTerm(q: string): string {
  return q.normalize("NFKC").replace(/[^\p{L}\p{N}\s\-'.]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/**
 * GET /api/admin/track/search?q=: cards to put in a slot, by Card ID, Bag ID
 * or order code (exact), else card name, customer name or order number
 * (contains). Only cards that went through Receiving (they have a Card ID);
 * at most 30, cards still to do first, then by due date.
 */
export async function searchCards(admin: SupabaseClient, raw: string): Promise<IntakeResult<{ response: SearchResponse }>> {
  const query = String(raw ?? "").trim().slice(0, 100);
  const term = searchTerm(query);
  if (term.length < 2) return { ok: false, status: 400, error: "Type at least 2 letters or digits." };
  try {
    const ids = new Set<string>();
    const orderIds = new Set<string>();
    const code = normalizeCode(query);
    const kind = code ? codeKind(code) : null;
    if (kind === "card" || kind === "bag" || kind === "order") {
      const found = await resolveCode(admin, code);
      if (found?.kind === "card") ids.add(found.id);
      else if (found?.kind === "order") orderIds.add(found.id);
      else if (found?.kind === "bag") {
        const { data, error } = await admin.from("cards").select("id").eq("bag_id", found.id);
        if (error) throw new Error(error.message);
        for (const r of data ?? []) ids.add(r.id as string);
      }
    }
    if (!ids.size && !orderIds.size) {
      const like = `%${term}%`;
      const [byName, byCode, byCustomer, byNumber] = await Promise.all([
        admin.from("cards").select("id").not("card_code", "is", null).ilike("card_name", like).limit(SEARCH_LIMIT + 1),
        admin.from("cards").select("id").ilike("card_code", like).limit(SEARCH_LIMIT + 1),
        admin.from("orders").select("id").ilike("customer_name", like).limit(SEARCH_LIMIT + 1),
        admin.from("orders").select("id").ilike("order_number", like).limit(SEARCH_LIMIT + 1),
      ]);
      const err = byName.error ?? byCode.error ?? byCustomer.error ?? byNumber.error;
      if (err) throw new Error(err.message);
      for (const r of [...(byCode.data ?? []), ...(byName.data ?? [])]) ids.add(r.id as string);
      for (const r of [...(byCustomer.data ?? []), ...(byNumber.data ?? [])]) orderIds.add(r.id as string);
    }
    if (orderIds.size) {
      for (const part of chunks([...orderIds])) {
        const { data, error } = await admin.from("cards").select("id").in("order_id", part).not("card_code", "is", null).limit(500);
        if (error) throw new Error(error.message);
        for (const r of data ?? []) ids.add(r.id as string);
      }
    }
    const all = (await loadCardSummaries(admin, [...ids], { notes: true })).filter((c) => c.code);
    const rank = (c: TrackCardSummary) => (c.refunded ? 2 : c.done ? 1 : 0);
    all.sort((a, b) => rank(a) - rank(b) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || (a.code ?? "").localeCompare(b.code ?? "", undefined, { numeric: true }));
    return { ok: true, response: { query, cards: all.slice(0, SEARCH_LIMIT), truncated: all.length > SEARCH_LIMIT } };
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't search. (${e instanceof Error ? e.message : String(e)})` };
  }
}

/** The bags of a place, newest first (used by the shelf view). Throws on a failed read. */
export async function loadBagsAt(admin: SupabaseClient, locationIds: readonly string[]): Promise<Map<string, TrackBagSummary[]>> {
  const out = new Map<string, TrackBagSummary[]>();
  if (!locationIds.length) return out;
  const rows = (await Promise.all(chunks([...locationIds]).map((part) => fetchAll<TrackBagRow>((from, to) =>
    admin.from("tier_bags").select(TRACK_BAG_COLUMNS).in("location_id", part).order("id").range(from, to))))).flat();
  const ctx = await loadOrdersContext(admin, [...new Set(rows.map((b) => b.order_id))]);
  for (const b of rows.sort(byBag)) {
    const list = out.get(b.location_id!) ?? [];
    list.push(bagSummary(b, ctx.cards, ctx));
    out.set(b.location_id!, list);
  }
  return out;
}

