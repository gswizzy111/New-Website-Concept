import { z } from "zod";
import { isAdminOrWorkshop } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadLabelPlaces } from "@/lib/intake/labels/data";
import { placeLabelsResponse } from "@/lib/intake/labels/respond";

/** The most labels one print makes. */
const MAX_LABELS = 200;

const Query = z.union([
  z.object({ ids: z.array(z.string().uuid()).min(1).max(MAX_LABELS) }),
  z
    .object({
      station: z.string().regex(/^[a-z0-9-]{1,40}$/),
      from: z.coerce.number().int().min(0).max(9999).optional(),
      to: z.coerce.number().int().min(0).max(9999).optional(),
    })
    .refine((q) => q.from == null || q.to == null || q.from <= q.to, { message: "from is after to" }),
]);

/**
 * GET → PDF of slot and place labels, one page each (50 x 80 mm unless
 * ?stock=4x6 or another stock is asked for):
 *   ?ids=<locationId>,<locationId>…           those places, in that order
 *   ?station=clamp[&from=1&to=20]             the station type's active slots by serial number
 * ?format=json → { settings, pages: [{ id, code, name, page }] } (the laid-out pages, for the preview and PNGs).
 */
export async function GET(request: Request) {
  if (!(await isAdminOrWorkshop())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const idsParam = params.get("ids");
  const parsed = Query.safeParse(
    idsParam != null
      ? { ids: idsParam.split(",").map((s) => s.trim()).filter(Boolean) }
      : { station: params.get("station") ?? "", from: params.get("from") || undefined, to: params.get("to") || undefined },
  );
  if (!parsed.success) {
    return Response.json({ error: idsParam != null ? `Pick 1 to ${MAX_LABELS} places.` : "Pick a station type and a range of slot numbers." }, { status: 400 });
  }

  const admin = createAdminClient();
  // One more than the most a print makes: enough to tell a range that is too long
  const { places, error } = await loadLabelPlaces(admin, "ids" in parsed.data ? parsed.data : { ...parsed.data, limit: MAX_LABELS + 1 });
  if (error) return Response.json({ error }, { status: 500 });
  if (!places.length) return Response.json({ error: "No places to print." }, { status: 404 });
  if (places.length > MAX_LABELS) return Response.json({ error: `That is more than ${MAX_LABELS} labels: print at most ${MAX_LABELS} at a time.` }, { status: 400 });

  const q = parsed.data;
  const first = places[0];
  const last = places[places.length - 1];
  // "LOC-CLAMP-01-to-LOC-CLAMP-20" for a station range, else the first place's code
  const name = "station" in q && places.length > 1 ? `${first.code}-to-${last.code}` : first.code;
  return placeLabelsResponse(request, places, name);
}
