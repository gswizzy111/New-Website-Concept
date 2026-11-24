import { z } from "zod";
import { isAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadLabelPlaces } from "@/lib/intake/labels/data";
import { placeSignResponse } from "@/lib/intake/labels/respond";

/**
 * GET → PDF of one place's label or sign (a slot "CLAMP 07", a shelf slot
 * "DUE MON DEC 7", Done, Shipping): one page, 50 x 80 mm unless ?stock=4x6
 * (or another stock) is asked for. ?format=json → { settings, page }.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Place not found" }, { status: 404 });

  const admin = createAdminClient();
  const { places, error } = await loadLabelPlaces(admin, { ids: [id] });
  if (error) return Response.json({ error }, { status: 500 });
  if (!places.length) return Response.json({ error: "Place not found" }, { status: 404 });
  return placeSignResponse(request, places[0]);
}
