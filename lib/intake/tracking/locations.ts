import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { isDay } from "@/lib/intake/business-days";
import { isLocationCode, normalizeCode } from "@/lib/intake/codes";
import type { IntakeResult } from "@/lib/intake/types";
import {
  LOCATION_COLUMNS, ONE_CARD, compareLocations, hasRoom, holdsOneCard, isLocationKind, locationCodeCandidates, locationView,
} from "@/lib/intake/tracking/places";
import { ensureShelfSlotRow } from "@/lib/intake/tracking/shelf";
import { slotCode, slotName, stationType } from "@/lib/intake/tracking/stations";
import type { LocationKind, LocationRow, TrackLocation, TrackLocationWithCount } from "@/lib/intake/tracking/types";

/**
 * Slots and places (the `locations` table), server only. Admin access is
 * checked by the calling route. Codes are made here and never change, so
 * printed QR labels keep working; places are switched off (active = false),
 * never deleted. Every slot, and every other place but a desk or the Open
 * bags box, holds one card (places.ts holdsOneCard; owner, Nov 26 2026): new
 * ones store capacity 1, and their capacity can't be changed.
 */

const MAX_NAME = 60;
export const MAX_SLOTS_PER_CALL = 200;
const MAX_SERIAL = 9999;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A place by its code (LOC-CLAMP-07 or its scanned QR link), active or not; null if there is none. Throws on a failed read. */
export async function getLocationByCode(admin: SupabaseClient, raw: string): Promise<LocationRow | null> {
  const code = normalizeCode(raw);
  if (!code || !isLocationCode(code)) return null;
  const { data, error } = await admin.from("locations").select(LOCATION_COLUMNS).eq("code", code).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LocationRow | null) ?? null;
}

/** A place by id; null if there is none. Throws on a failed read. */
export async function getLocationById(admin: SupabaseClient, id: string): Promise<LocationRow | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { data, error } = await admin.from("locations").select(LOCATION_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LocationRow | null) ?? null;
}

async function countBy(admin: SupabaseClient, table: "cards" | "tier_bags"): Promise<Map<string, number>> {
  const rows = await fetchAll<{ id: string; location_id: string | null }>((from, to) =>
    admin.from(table).select("id, location_id").not("location_id", "is", null).order("id").range(from, to));
  const out = new Map<string, number>();
  for (const r of rows) if (r.location_id) out.set(r.location_id, (out.get(r.location_id) ?? 0) + 1);
  return out;
}

/** The cards in each place: how many, and the first few Card IDs (a one-card holder shows its card as "Has CD-2549-03"). */
async function cardsByPlace(admin: SupabaseClient): Promise<Map<string, { count: number; codes: string[] }>> {
  const rows = await fetchAll<{ id: string; location_id: string | null; card_code: string | null }>((from, to) =>
    admin.from("cards").select("id, location_id, card_code").not("location_id", "is", null).order("id").range(from, to));
  const out = new Map<string, { count: number; codes: string[] }>();
  for (const r of rows) {
    if (!r.location_id) continue;
    const at = out.get(r.location_id) ?? { count: 0, codes: [] };
    at.count += 1;
    if (r.card_code && at.codes.length < 5) at.codes.push(r.card_code);
    out.set(r.location_id, at);
  }
  return out;
}

/**
 * Every slot and place in list order (slots by station type and number,
 * shelf slots by due date, Done, Shipping, others) with what's in it
 * (`capacity` and `free` with the one-card rule applied; a one-card holder
 * with a card in it lists its Card IDs, `cardCodes`). Switched-off places
 * only with `includeInactive`; `station` limits it to one station type's
 * slots.
 */
export async function listLocations(
  admin: SupabaseClient,
  opts: { includeInactive?: boolean; station?: string | null } = {},
): Promise<IntakeResult<{ locations: TrackLocationWithCount[] }>> {
  try {
    const [rows, cards, bags] = await Promise.all([
      fetchAll<LocationRow>((from, to) => {
        let q = admin.from("locations").select(LOCATION_COLUMNS);
        if (!opts.includeInactive) q = q.eq("active", true);
        if (opts.station) q = q.eq("station", opts.station);
        return q.order("id").range(from, to);
      }),
      cardsByPlace(admin),
      countBy(admin, "tier_bags"),
    ]);
    const locations = rows.sort(compareLocations).map((r): TrackLocationWithCount => {
      const view = locationView(r);
      const inIt = cards.get(r.id);
      const cardCount = inIt?.count ?? 0;
      return {
        ...view,
        cardCount,
        bagCount: bags.get(r.id) ?? 0,
        free: hasRoom(view.capacity, cardCount),
        ...(cardCount && holdsOneCard(r) ? { cardCodes: inIt?.codes ?? [] } : {}),
      };
    });
    return { ok: true, locations };
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the places. (${errText(e)})` };
  }
}

/**
 * Add `count` numbered slots of a station type: { station: "clamp", count: 20 }
 * makes CLAMP 01..20 (LOC-CLAMP-01..20), each with the type's step and
 * capacity 1 (every slot holds one card). Numbers start at `startAt`, else after the highest
 * number the type has. Numbers already used are skipped (listed), never
 * changed. Race-safe (insert ... on conflict do nothing).
 */
export async function createSlots(
  admin: SupabaseClient,
  input: { station: string; count: number; startAt?: number | null; by: string | null },
): Promise<IntakeResult<{ created: TrackLocation[]; skipped: string[] }>> {
  const type = stationType(input.station);
  if (!type) return { ok: false, status: 400, error: "Pick a station type." };
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_SLOTS_PER_CALL) {
    return { ok: false, status: 400, error: `Add between 1 and ${MAX_SLOTS_PER_CALL} slots at a time.` };
  }
  let start = input.startAt ?? null;
  if (start !== null && (!Number.isInteger(start) || start < 1)) return { ok: false, status: 400, error: "Start at 1 or more." };
  try {
    if (start === null) {
      const { data, error } = await admin.from("locations").select("serial").eq("station", type.key)
        .order("serial", { ascending: false }).limit(1);
      if (error) throw new Error(error.message);
      start = ((data?.[0]?.serial as number | null) ?? 0) + 1;
    }
    const last = start + input.count - 1;
    if (last > MAX_SERIAL) return { ok: false, status: 400, error: `Slot numbers go up to ${MAX_SERIAL}.` };
    const serials = Array.from({ length: input.count }, (_, i) => start! + i);
    const rows = serials.map((serial) => ({
      code: slotCode(type.key, serial),
      name: slotName(type, serial),
      kind: "station",
      station: type.key,
      serial,
      // One card per slot (owner, Nov 26 2026), whatever the type
      capacity: ONE_CARD,
      stage: type.stage,
      sort: serial,
      active: true,
      created_by: input.by,
    }));
    const { data, error } = await admin.from("locations")
      .upsert(rows, { onConflict: "code", ignoreDuplicates: true })
      .select(LOCATION_COLUMNS);
    if (error) throw new Error(error.message);
    const created = ((data ?? []) as LocationRow[]).sort(compareLocations).map(locationView);
    const made = new Set(created.map((l) => l.code));
    return { ok: true, created, skipped: rows.map((r) => r.code).filter((c) => !made.has(c)) };
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't add the slots. (${errText(e)})` };
  }
}

/**
 * Add one place that isn't a numbered slot (Done, Shipping, other). The code
 * is made from the name (LOC-BACK-TABLE; -2, -3 ... if taken). A shelf needs
 * `dueDate` and is that day's slot (ensureShelfSlot: never two for one day).
 * An other place that isn't a desk stores capacity 1 (it holds one card); a
 * desk, Done and Shipping store no limit.
 */
export async function createLocation(
  admin: SupabaseClient,
  input: { name: string; kind: LocationKind; dueDate?: string | null; by: string | null },
): Promise<IntakeResult<{ location: TrackLocation; created: boolean }>> {
  if (!isLocationKind(input.kind)) return { ok: false, status: 400, error: "Pick what kind of place it is." };
  if (input.kind === "station") return { ok: false, status: 400, error: "Add station slots by type and count (e.g. 20 clamps)." };
  if (input.kind === "shelf") {
    if (!input.dueDate || !isDay(input.dueDate)) return { ok: false, status: 400, error: "A shelf slot needs its due date." };
    try {
      const { location, created } = await ensureShelfSlotRow(admin, input.dueDate, input.by);
      return { ok: true, location, created };
    } catch (e) {
      return { ok: false, status: 500, error: `Couldn't add the shelf slot. (${errText(e)})` };
    }
  }
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, status: 400, error: "Give the place a name." };
  if (name.length > MAX_NAME) return { ok: false, status: 400, error: `Keep the name under ${MAX_NAME} characters.` };

  const candidates = locationCodeCandidates(name);
  const { data: taken, error: readErr } = await admin.from("locations").select("code").in("code", candidates);
  if (readErr) return { ok: false, status: 500, error: `Couldn't add the place. (${readErr.message})` };
  const used = new Set((taken ?? []).map((r) => r.code as string));
  for (const code of candidates.filter((c) => !used.has(c))) {
    const { data, error } = await admin.from("locations")
      .insert({ code, name, kind: input.kind, capacity: holdsOneCard({ kind: input.kind, code }) ? ONE_CARD : null, sort: 0, active: true, created_by: input.by })
      .select(LOCATION_COLUMNS).single();
    if (!error && data) return { ok: true, location: locationView(data as LocationRow), created: true };
    // Taken in the meantime: try the next code
    if (error && error.code !== "23505") return { ok: false, status: 500, error: `Couldn't add the place. (${error.message})` };
  }
  return { ok: false, status: 409, error: "Too many places have that name. Pick another name." };
}

/**
 * Rename a place, switch it off or on, change its capacity (null = no limit)
 * or sort. The code and number never change. Only a place that isn't a
 * one-card holder (a desk, a shelf, Done, Shipping, the Open bags box) can
 * change its capacity: a slot or other place stays at one card (400 for any
 * other value; 1 is accepted, so a stored "no limit" can be tidied).
 */
export async function updateLocation(
  admin: SupabaseClient,
  input: { id: string; name?: string; active?: boolean; capacity?: number | null; sort?: number },
): Promise<IntakeResult<{ location: TrackLocation }>> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = String(input.name).trim().replace(/\s+/g, " ");
    if (!name) return { ok: false, status: 400, error: "Give the place a name." };
    if (name.length > MAX_NAME) return { ok: false, status: 400, error: `Keep the name under ${MAX_NAME} characters.` };
    patch.name = name;
  }
  if (input.active !== undefined) patch.active = !!input.active;
  if (input.capacity !== undefined) {
    if (input.capacity !== null && (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 10000)) {
      return { ok: false, status: 400, error: "Capacity is a whole number of cards (or no limit)." };
    }
    patch.capacity = input.capacity;
  }
  if (input.capacity !== undefined && input.capacity !== ONE_CARD) {
    let row: LocationRow | null;
    try {
      row = await getLocationById(admin, input.id);
    } catch (e) {
      return { ok: false, status: 500, error: `Couldn't read the place. (${errText(e)})` };
    }
    if (!row) return { ok: false, status: 404, error: "Place not found" };
    if (holdsOneCard(row)) return { ok: false, status: 400, error: `${row.name} holds one card (the owner's rule), so its limit can't change.` };
  }
  if (input.sort !== undefined) {
    if (!Number.isInteger(input.sort) || Math.abs(input.sort) > 1e9) return { ok: false, status: 400, error: "Invalid sort." };
    patch.sort = input.sort;
  }
  if (!Object.keys(patch).length) return { ok: false, status: 400, error: "Nothing to change." };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)) return { ok: false, status: 404, error: "Place not found" };
  const { data, error } = await admin.from("locations").update(patch).eq("id", input.id).select(LOCATION_COLUMNS).maybeSingle();
  if (error) return { ok: false, status: 500, error: `Couldn't save the place. (${error.message})` };
  if (!data) return { ok: false, status: 404, error: "Place not found" };
  return { ok: true, location: locationView(data as LocationRow) };
}
