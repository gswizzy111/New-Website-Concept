import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { loadBoard, type BoardBag } from "../bags/load-board";
import { missingTracking, type PlaceKind } from "./_lib/places";

/**
 * The Shelf view's data: every open bag (the Bags board's list, already
 * soonest due first) with each card's place now (cards.location_id: a slot
 * such as CLAMP 07, a shelf slot, Done, Shipping, or none), the bag's own
 * place (tier_bags.location_id) and the shelf slot of each due date. Reads
 * only, paged and chunked like the board. Before the card tracking update is
 * applied the bags still load, without places (tracking: false).
 */

export type PlaceRef = { id: string; code: string; name: string; kind: PlaceKind; dueDate: string | null };

export type ShelfCard = {
  id: string;
  code: string | null;
  name: string;
  /** "Not started", "Humidor", "Drying", "Done" */
  stageLabel: string;
  done: boolean;
  place: PlaceRef | null;
  locatedAt: string | null;
};

export type ShelfBag = BoardBag & {
  /** Non-refunded cards, by Card ID. */
  cards: ShelfCard[];
  bagPlace: PlaceRef | null;
};

export type ShelfLoad =
  | { ok: true; bags: ShelfBag[]; holidays: Set<string>; tierNames: Record<string, string>; slots: Map<string, PlaceRef>; tracking: boolean }
  | { ok: false; missingSchema: boolean; error: string };

const CHUNK = 100;
const chunks = <T,>(items: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
};

type CardRow = {
  id: string;
  bag_id: string;
  card_code: string | null;
  card_name: string | null;
  status: string | null;
  completed: boolean | null;
  location_id?: string | null;
  located_at?: string | null;
};

type PlaceDbRow = { id: string; code: string; name: string; kind: PlaceKind; due_date: string | null };
const ref = (p: PlaceDbRow): PlaceRef => ({ id: p.id, code: p.code, name: p.name, kind: p.kind, dueDate: p.due_date });

/** Card IDs in number order ("CD-2549-02" before "CD-2549-10"); cards without one last. */
function byCode(a: ShelfCard, b: ShelfCard) {
  if (!a.code || !b.code) return a.code ? -1 : b.code ? 1 : a.name.localeCompare(b.name);
  return a.code.localeCompare(b.code, "en", { numeric: true });
}

export async function loadShelf(admin: SupabaseClient): Promise<ShelfLoad> {
  const board = await loadBoard(admin);
  if (!board.ok) return board;
  const bagIds = board.bags.map((b) => b.id);
  const dates = [...new Set(board.bags.map((b) => b.dueDate).filter((d): d is string => !!d))];

  // Cards with their places; without the tracking columns, without places
  let tracking = true;
  let cards: CardRow[] = [];
  try {
    const read = (cols: string) => Promise.all(chunks(bagIds).map((ids) => fetchAll<CardRow>((from, to) =>
      admin.from("cards").select(cols).in("bag_id", ids).order("id").range(from, to) as unknown as PromiseLike<{ data: CardRow[] | null; error: { message: string } | null }>)));
    try {
      cards = (await read("id, bag_id, card_code, card_name, status, completed, location_id, located_at")).flat();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!missingTracking(message) && !/location/.test(message)) throw e;
      tracking = false;
      cards = (await read("id, bag_id, card_code, card_name, status, completed")).flat();
    }
  } catch (e) {
    return { ok: false, missingSchema: false, error: e instanceof Error ? e.message : String(e) };
  }

  // The places those cards and bags are in, and the shelf slot of each due date
  const places = new Map<string, PlaceRef>();
  const slots = new Map<string, PlaceRef>();
  const bagPlaceId = new Map<string, string | null>();
  if (tracking) {
    try {
      const bagRows = (await Promise.all(chunks(bagIds).map(async (ids) => {
        const { data, error } = await admin.from("tier_bags").select("id, location_id").in("id", ids);
        return error ? [] : (data ?? []) as { id: string; location_id: string | null }[]; // best effort
      }))).flat();
      for (const b of bagRows) bagPlaceId.set(b.id, b.location_id);
      const ids = [...new Set([...cards.map((c) => c.location_id), ...bagRows.map((b) => b.location_id)].filter((id): id is string => !!id))];
      const [byId, shelfRows] = await Promise.all([
        Promise.all(chunks(ids).map(async (part) => {
          const { data, error } = await admin.from("locations").select("id, code, name, kind, due_date").in("id", part);
          if (error) throw new Error(error.message);
          return (data ?? []) as PlaceDbRow[];
        })),
        Promise.all(chunks(dates).map(async (part) => {
          const { data, error } = await admin.from("locations").select("id, code, name, kind, due_date, active").eq("kind", "shelf").in("due_date", part);
          if (error) throw new Error(error.message);
          return (data ?? []) as (PlaceDbRow & { active: boolean })[];
        })),
      ]);
      for (const p of byId.flat()) places.set(p.id, ref(p));
      for (const p of shelfRows.flat()) {
        if (p.due_date && (!slots.has(p.due_date) || p.active)) slots.set(p.due_date, ref(p));
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (!missingTracking(error)) return { ok: false, missingSchema: false, error };
      tracking = false;
    }
  }

  const byBag = new Map<string, CardRow[]>();
  for (const c of cards) {
    if (c.status === "refunded") continue;
    const list = byBag.get(c.bag_id);
    if (list) list.push(c);
    else byBag.set(c.bag_id, [c]);
  }

  const bags: ShelfBag[] = board.bags.map((b) => {
    const stageOf = new Map<string, string>();
    for (const g of b.stageGroups) for (const id of g.cardIds) stageOf.set(id, g.label);
    const list = (byBag.get(b.id) ?? []).map((c): ShelfCard => ({
      id: c.id,
      code: c.card_code,
      name: c.card_name?.trim() || "Card",
      stageLabel: stageOf.get(c.id) ?? (c.completed ? "Done" : "Not started"),
      done: !!c.completed,
      place: c.location_id ? places.get(c.location_id) ?? null : null,
      locatedAt: c.located_at ?? null,
    })).sort(byCode);
    const bp = bagPlaceId.get(b.id);
    return { ...b, cards: list, bagPlace: bp ? places.get(bp) ?? null : null };
  });

  return { ok: true, bags, holidays: board.holidays, tierNames: board.tierNames, slots, tracking };
}
