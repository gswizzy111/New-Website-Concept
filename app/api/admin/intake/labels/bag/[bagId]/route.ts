import { z } from "zod";
import { isAdminOrWorkshop } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLabelSettings, loadLabelBags } from "@/lib/intake/labels/data";
import { labelResponse } from "@/lib/intake/labels/respond";

/**
 * GET → PDF of the bag's label: exactly one page at the label stock's size,
 * whatever its card count. ?format=json → the laid-out page for the
 * on-screen preview. (?tag=1 is ignored: there is no reusable tag any more.)
 */
export async function GET(request: Request, { params }: { params: Promise<{ bagId: string }> }) {
  if (!(await isAdminOrWorkshop())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { bagId } = await params;
  if (!z.string().uuid().safeParse(bagId).success) return Response.json({ error: "Bag not found" }, { status: 404 });

  const admin = createAdminClient();
  const [{ bags, error }, settings] = await Promise.all([loadLabelBags(admin, { bagId }), getLabelSettings(admin)]);
  if (error) return Response.json({ error }, { status: 500 });
  if (!bags.length) return Response.json({ error: "Bag not found" }, { status: 404 });
  return labelResponse(request, bags, settings, bags[0].bagCode);
}
