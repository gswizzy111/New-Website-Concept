import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { isDay } from "@/lib/intake/business-days";
import { isLocationCode, normalizeCode } from "@/lib/intake/codes";
import type { IntakeResult } from "@/lib/intake/types";
import {
  LOCATION_COLUMNS, compareLocations, isLocationKind, isStage, locationCodeCandidates, locationView,
} from "@/lib/intake/tracking/places";
import { ensureShelfSlotRow } from "@/lib/intake/tracking/shelf";
import type { LocationKind, LocationRow, TrackLocation, TrackLocationWithCount } from "@/lib/intake/tracking/types";

/**
 * Places (the `locations` table), server only. Admin access is checked by the
 * calling route. Codes are made here from the name (LOC-<SLUG>) and never
 * change, so printed signs keep working; places are switched off
 * (active = false), never deleted.
 */

const MAX_NAME = 60;

/** A place by its code (LOC-HUMIDOR or its scanned QR link), active or not; null if there is none. Throws on a failed read. */
export async function getLocationByCode(admin: SupabaseClient, raw: string): Promise<LocationRow | null> {
  const code = normalizeCode(raw);
  if (!code || !isLocationCode(code)) return null;
  const { data, error } = await admin.from("locations").select(LOCATION_COLUMNS).eq("code", code).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LocationRow | null) ?? null;
}

/** A place by id; null if there is none. Throws on a failed read. */
export async function getLocationById(admin: SupabaseClient, id: string): Promise<LocationRow | null> {
  const { data, error } = await admin.from("locations").select(LOCATION_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LocationRow | null) ?? null;
}

/** How many cards are at each place now (place id -> count; refunded cards included, they're physically there). */
export async function cardCountsByLocation(admin: SupabaseClient): Promise<Map<string, number>> {
  const rows = await fetchAll<{ id: string; location_id: string | null }>((from, to) =>
    admin.from("cards").select("id, location_id").not("location_id", "is", null).order("id").range(from, to));
  const out = new Map<string, number>();
  for (const r of rows) if (r.location_id) out.set(r.location_id, (out.get(r.location_id) ?? 0) + 1);
  return out;
}

/**
 * Every place, in list order (stations by step, shelf slots by due date, Done,
 * Shipping, others), with how many cards are there. Inactive places only with
 * `includeInactive`.
 */
export async function listLocations(
  admin: SupabaseClient,
  opts: { includeInactive?: boolean } = {},
): Promise<IntakeResult<{ locations: TrackLocationWithCount[] }>> {
  try {
    const [rows, counts] = await Promise.all([
      fetchAll<LocationRow>((from, to) => {
        let q = admin.from("locations").select(LOCATION_COLUMNS);
        if (!opts.includeInactive) q = q.eq("active", true);
        return q.order("id").range(from, to);
      }),
      cardCountsByLocation(admin),
    ]);
    const locations = rows.sort(compareLocations).map((r) => ({ ...locationView(r), cardCount: counts.get(r.id) ?? 0 }));
    return { ok: true, locations };
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the places. (${e instanceof Error ? e.message : String(e)})` };
  }
}

/**
 * Add a place. The code is made from the name (LOC-BACK-SHELF; -2, -3 ... if
 * taken). A station needs `stage` (one of the 8 steps); a shelf needs
 * `dueDate` and is the due date's slot (ensureShelfSlot: never two slots for
 * one day; the name is the slot's own, "DUE MON DEC 7").
 */
export async function createLocation(
  admin: SupabaseClient,
  input: { name: string; kind: LocationKind; stage?: string | null; dueDate?: string | null; by: string | null },
): Promise<IntakeResult<{ location: TrackLocation; created: boolean }>> {
  if (!isLocationKind(input.kind)) return { ok: false, status: 400, error: "Pick what kind of place it is." };
  if (input.kind === "shelf") {
    if (!input.dueDate || !isDay(input.dueDate)) return { ok: false, status: 400, error: "A shelf slot needs its due date." };
    try {
      const { location, created } = await ensureShelfSlotRow(admin, input.dueDate, input.by);
      return { ok: true, location, created };
    } catch (e) {
      return { ok: false, status: 500, error: `Couldn't add the shelf slot. (${e instanceof Error ? e.message : String(e)})` };
    }
  }
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, status: 400, error: "Give the place a name." };
  if (name.length > MAX_NAME) return { ok: false, status: 400, error: `Keep the name under ${MAX_NAME} characters.` };
  const stage = input.kind === "station" ? input.stage ?? null : null;
  if (input.kind === "station" && !isStage(stage)) return { ok: false, status: 400, error: "A station needs the step it sets." };

  const candidates = locationCodeCandidates(name);
  const { data: taken, error: readErr } = await admin.from("locations").select("code").in("code", candidates);
  if (readErr) return { ok: false, status: 500, error: `Couldn't add the place. (${readErr.message})` };
  const used = new Set((taken ?? []).map((r) => r.code as string));
  for (const code of candidates.filter((c) => !used.has(c))) {
    const { data, error } = await admin.from("locations")
      .insert({ code, name, kind: input.kind, stage, sort: 0, active: true, created_by: input.by })
      .select(LOCATION_COLUMNS).single();
    if (!error && data) return { ok: true, location: locationView(data as LocationRow), created: true };
    // Taken in the meantime: try the next code
    if (error && error.code !== "23505") return { ok: false, status: 500, error: `Couldn't add the place. (${error.message})` };
  }
  return { ok: false, status: 409, error: "Too many places have that name. Pick another name." };
}

/** Rename a place, switch it off or on, or change its sort. The code never changes. */
export async function updateLocation(
  admin: SupabaseClient,
  input: { id: string; name?: string; active?: boolean; sort?: number },
): Promise<IntakeResult<{ location: TrackLocation }>> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim().replace(/\s+/g, " ");
    if (!name) return { ok: false, status: 400, error: "Give the place a name." };
    if (name.length > MAX_NAME) return { ok: false, status: 400, error: `Keep the name under ${MAX_NAME} characters.` };
    patch.name = name;
  }
  if (input.active !== undefined) patch.active = !!input.active;
  if (input.sort !== undefined) {
    if (!Number.isInteger(input.sort) || Math.abs(input.sort) > 1e9) return { ok: false, status: 400, error: "Invalid sort." };
    patch.sort = input.sort;
  }
  if (!Object.keys(patch).length) return { ok: false, status: 400, error: "Nothing to change." };
  const { data, error } = await admin.from("locations").update(patch).eq("id", input.id).select(LOCATION_COLUMNS).maybeSingle();
  if (error) return { ok: false, status: 500, error: `Couldn't save the place. (${error.message})` };
  if (!data) return { ok: false, status: 404, error: "Place not found" };
  return { ok: true, location: locationView(data as LocationRow) };
}
