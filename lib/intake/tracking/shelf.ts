import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCATION_COLUMNS, locationView, shelfSlotCode, shelfSlotName, shelfSlotSort } from "@/lib/intake/tracking/places";
import type { LocationRow, TrackLocation } from "@/lib/intake/tracking/types";

export { shelfSlotCode, shelfSlotName, shelfSlotSort } from "@/lib/intake/tracking/places";

/**
 * Due-date shelf slots, server only: one place per due date (kind 'shelf',
 * code LOC-SHELF-YYYYMMDD, name "DUE MON DEC 7", sort = the date as a number),
 * made the first time a bag with that due date needs it.
 */

/**
 * The shelf slot for `dueDate` ("YYYY-MM-DD"), made if it doesn't exist yet
 * (race-safe: insert ... on conflict (code) do nothing, then read it). A slot
 * that was switched off is switched back on. Throws on a bad date or a
 * database error.
 */
export async function ensureShelfSlot(admin: SupabaseClient, dueDate: string, by: string | null = null): Promise<TrackLocation> {
  return (await ensureShelfSlotRow(admin, dueDate, by)).location;
}

/** ensureShelfSlot, also saying whether this call made the slot. */
export async function ensureShelfSlotRow(
  admin: SupabaseClient,
  dueDate: string,
  by: string | null = null,
): Promise<{ location: TrackLocation; created: boolean }> {
  const code = shelfSlotCode(dueDate); // throws on a bad date
  const { data: inserted, error: insErr } = await admin.from("locations")
    .upsert(
      { code, name: shelfSlotName(dueDate), kind: "shelf", stage: null, due_date: dueDate, sort: shelfSlotSort(dueDate), active: true, created_by: by },
      { onConflict: "code", ignoreDuplicates: true },
    )
    .select(LOCATION_COLUMNS);
  if (insErr) throw new Error(insErr.message);
  if (inserted?.length) return { location: locationView(inserted[0] as LocationRow), created: true };

  const { data, error } = await admin.from("locations").select(LOCATION_COLUMNS).eq("code", code).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Shelf slot ${code} could not be made`);
  let row = data as LocationRow;
  if (row.active === false) {
    const { data: on, error: onErr } = await admin.from("locations").update({ active: true }).eq("id", row.id).select(LOCATION_COLUMNS).maybeSingle();
    if (onErr) throw new Error(onErr.message);
    if (on) row = on as LocationRow;
  }
  return { location: locationView(row), created: false };
}

/**
 * Put bags on their due-date shelf slot ("Put in shelf: DUE MON DEC 7"):
 * makes the slot if needed and sets tier_bags.location_id / located_at. Bags
 * without a due date are left alone (listed in `skipped`). Cards keep their
 * own place (they wait in their bag). Throws on a database error.
 */
export async function shelveBags(
  admin: SupabaseClient,
  input: { bagIds: readonly string[]; by: string | null },
): Promise<{ shelved: { bagId: string; bagCode: string; location: TrackLocation }[]; skipped: { bagId: string; bagCode: string | null; reason: "no_due_date" | "not_found" }[] }> {
  const ids = [...new Set(input.bagIds)];
  const out = { shelved: [] as { bagId: string; bagCode: string; location: TrackLocation }[], skipped: [] as { bagId: string; bagCode: string | null; reason: "no_due_date" | "not_found" }[] };
  if (!ids.length) return out;
  const { data, error } = await admin.from("tier_bags").select("id, bag_code, due_date, location_id").in("id", ids);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; bag_code: string; due_date: string | null; location_id: string | null }[];
  const slots = new Map<string, TrackLocation>();
  const now = new Date().toISOString();
  for (const id of ids) {
    const bag = rows.find((r) => r.id === id);
    if (!bag) { out.skipped.push({ bagId: id, bagCode: null, reason: "not_found" }); continue; }
    if (!bag.due_date) { out.skipped.push({ bagId: id, bagCode: bag.bag_code, reason: "no_due_date" }); continue; }
    const slot = slots.get(bag.due_date) ?? await ensureShelfSlot(admin, bag.due_date, input.by);
    slots.set(bag.due_date, slot);
    if (bag.location_id !== slot.id) {
      const { error: upErr } = await admin.from("tier_bags").update({ location_id: slot.id, located_at: now }).eq("id", bag.id);
      if (upErr) throw new Error(upErr.message);
    }
    out.shelved.push({ bagId: bag.id, bagCode: bag.bag_code, location: slot });
  }
  return out;
}
