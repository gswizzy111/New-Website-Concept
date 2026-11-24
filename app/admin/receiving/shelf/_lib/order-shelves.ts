import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureShelfSlot } from "@/lib/intake/tracking/shelf";
import type { OrderIntake } from "@/lib/intake/types";
import { PLACE_COLUMNS, shelfSlotCode, shelfSlotName, type PlaceRow } from "./places";

/**
 * The receiving workspace's "Put in shelf" box: for each open bag of the
 * order, its received cards that haven't started a step and have no place
 * yet (cards.location_id null) go on the shelf slot of the bag's due date
 * (LOC-SHELF-YYYYMMDD, "DUE MON DEC 7"). Cards already scanned somewhere, or
 * already at a step (they're at a station), are left out, so the box goes
 * away once the cards are scanned onto the shelf. A missing slot is made with
 * ensureShelfSlot (best effort: preview mode refuses the write; the box still
 * shows the shelf's name, without a sign to print).
 */

export type ShelfPlace = { id: string | null; code: string; name: string };

export type ShelfGroupBag = {
  id: string;
  code: string;
  tierName: string;
  /** Cards of the bag still to put on the shelf. */
  toShelve: number;
  /** Cards of the bag already on this shelf. */
  onShelf: number;
};

export type ShelfGroup = {
  /** The bags' due date; null for bags without one (no shelf slot). */
  dueDate: string | null;
  place: ShelfPlace | null;
  bags: ShelfGroupBag[];
  /** Every card to shelve is on the shelf (shown as a short "on shelf" line). */
  done: boolean;
};

export type OrderShelves =
  | { ok: true; groups: ShelfGroup[] }
  /** The card tracking update isn't applied (no location columns) or a read failed: no box. */
  | { ok: false; error: string };

/** ensureShelfSlot's result as a place, whatever wrapper it comes in. */
function asPlace(value: unknown): { id: string; code: string; name: string } | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const row = (v.location && typeof v.location === "object" ? v.location : v) as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.code === "string" && typeof row.name === "string"
    ? { id: row.id, code: row.code, name: row.name }
    : null;
}

export async function loadOrderShelves(admin: SupabaseClient, intake: OrderIntake): Promise<OrderShelves> {
  const { data: rows, error } = await admin.from("cards").select("id, location_id").eq("order_id", intake.order.id).limit(2000);
  if (error) return { ok: false, error: error.message };
  const placeOf = new Map(((rows ?? []) as { id: string; location_id: string | null }[]).map((r) => [r.id, r.location_id]));

  // Open bags with cards waiting at the start (in the bag, not refunded, not done, no step this round)
  const bags = intake.bags.filter((b) => !b.complete && b.cardCount > 0);
  const waiting = new Map(bags.map((b) => [b.id, intake.cards.filter((c) =>
    c.bagId === b.id && !c.refunded && !c.completed && c.stage.current === null)]));
  const dates = [...new Set(bags.filter((b) => waiting.get(b.id)?.length && b.dueDate).map((b) => b.dueDate as string))];

  // The shelf slots of those dates (made if missing)
  const slots = new Map<string, ShelfPlace>();
  if (dates.length) {
    const { data: found, error: slotErr } = await admin.from("locations").select(PLACE_COLUMNS).eq("kind", "shelf").in("due_date", dates);
    if (slotErr) return { ok: false, error: slotErr.message };
    for (const p of (found ?? []) as PlaceRow[]) {
      if (p.due_date && (!slots.has(p.due_date) || p.active)) slots.set(p.due_date, { id: p.id, code: p.code, name: p.name });
    }
    for (const day of dates) {
      if (slots.has(day)) continue;
      try {
        const made = asPlace(await ensureShelfSlot(admin, day));
        if (made) {
          slots.set(day, made);
          continue;
        }
      } catch (e) {
        console.warn("[shelf] slot not made:", e instanceof Error ? e.message : e);
      }
      slots.set(day, { id: null, code: shelfSlotCode(day), name: shelfSlotName(day) });
    }
  }

  const groups = new Map<string, ShelfGroup>();
  for (const b of bags) {
    const cards = waiting.get(b.id) ?? [];
    if (!cards.length) continue;
    const place = b.dueDate ? slots.get(b.dueDate) ?? null : null;
    const onShelf = place?.id ? cards.filter((c) => placeOf.get(c.id) === place.id).length : 0;
    const toShelve = cards.filter((c) => !placeOf.get(c.id)).length;
    // Cards scanned somewhere else (a station, another shelf) aren't this box's business
    if (!toShelve && !onShelf) continue;
    const key = b.dueDate ?? "none";
    const g = groups.get(key) ?? { dueDate: b.dueDate, place, bags: [], done: true };
    g.bags.push({ id: b.id, code: b.code, tierName: b.tierName, toShelve, onShelf });
    if (toShelve) g.done = false;
    groups.set(key, g);
  }
  // Soonest due first, no due date last
  const list = [...groups.values()].sort((a, b) =>
    a.dueDate === b.dueDate ? 0 : !a.dueDate ? 1 : !b.dueDate ? -1 : a.dueDate < b.dueDate ? -1 : 1);
  return { ok: true, groups: list };
}
