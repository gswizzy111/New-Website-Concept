import { createAdminClient } from "@/lib/supabase/admin";
import { createLocation, createSlots, listLocations, updateLocation } from "@/lib/intake/tracking/locations";
import { STATION_TYPES } from "@/lib/intake/tracking/stations";
import { json, readJson, trackAdmin } from "@/lib/intake/tracking/http";
import type { LocationKind } from "@/lib/intake/tracking/types";

export const dynamic = "force-dynamic";

/**
 * GET [?all=1] [?station=clamp]
 *   → 200 LocationsResponse { locations: TrackLocationWithCount[] (cardCount, bagCount, free, capacity
 *     with the one-card rule applied, cardCodes for a one-card holder with a card), stations: StationType[] }
 */
export async function GET(request: Request) {
  const admin = await trackAdmin();
  if ("response" in admin) return admin.response;
  const sp = new URL(request.url).searchParams;
  const station = sp.get("station");
  if (station !== null && !/^[a-z0-9-]{1,40}$/.test(station)) return json({ error: "Invalid station" }, 400);
  const result = await listLocations(createAdminClient(), { includeInactive: sp.get("all") === "1", station });
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ locations: result.locations, stations: STATION_TYPES });
}

/**
 * POST { station, count, startAt? } → 201 CreateSlotsResponse { created, skipped } (CLAMP 01..N)
 * POST { name, kind: 'done' | 'shipping' | 'other' | 'shelf', dueDate? } → 201 { location } (200 when
 *   a shelf slot for that day already existed)
 * → 400 / 409 { error }
 */
export async function POST(request: Request) {
  const admin = await trackAdmin();
  if ("response" in admin) return admin.response;
  const body = await readJson(request);
  if (!body) return json({ error: "Invalid request" }, 400);
  const db = createAdminClient();
  if (typeof body.station === "string") {
    const count = Number(body.count);
    const startAt = body.startAt === undefined || body.startAt === null || body.startAt === "" ? null : Number(body.startAt);
    const result = await createSlots(db, { station: body.station, count, startAt, by: admin.by });
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ created: result.created, skipped: result.skipped }, 201);
  }
  if (typeof body.name !== "string" || typeof body.kind !== "string") return json({ error: "Invalid request" }, 400);
  const result = await createLocation(db, {
    name: body.name,
    kind: body.kind as LocationKind,
    dueDate: typeof body.dueDate === "string" ? body.dueDate : null,
    by: admin.by,
  });
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ location: result.location }, result.created ? 201 : 200);
}

/**
 * PATCH { id, name?, active?, capacity?: number | null, sort? } → 200 { location }; 400 / 404 { error }
 * Rename, switch off/on, change capacity. The code and number never change (labels are printed).
 * A slot or an other place that isn't a desk holds one card: its capacity can't change (400).
 */
export async function PATCH(request: Request) {
  const admin = await trackAdmin();
  if ("response" in admin) return admin.response;
  const body = await readJson(request);
  if (!body || typeof body.id !== "string") return json({ error: "Invalid request" }, 400);
  if (body.name !== undefined && typeof body.name !== "string") return json({ error: "Invalid request" }, 400);
  if (body.active !== undefined && typeof body.active !== "boolean") return json({ error: "Invalid request" }, 400);
  if (body.capacity !== undefined && body.capacity !== null && typeof body.capacity !== "number") return json({ error: "Invalid request" }, 400);
  if (body.sort !== undefined && typeof body.sort !== "number") return json({ error: "Invalid request" }, 400);
  const result = await updateLocation(createAdminClient(), {
    id: body.id,
    name: body.name as string | undefined,
    active: body.active as boolean | undefined,
    capacity: body.capacity as number | null | undefined,
    sort: body.sort as number | undefined,
  });
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ location: result.location });
}
