import { z } from "zod";
import { isAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLabelSettings, loadLabelBags } from "@/lib/intake/labels/data";
import { labelResponse } from "@/lib/intake/labels/respond";

/**
 * GET → PDF of the labels of every bag of the order, bag after bag.
 * ?tag=1 → one reusable tag per bag instead. ?format=json → the laid-out
 * pages for the on-screen preview.
 */
export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { orderId } = await params;
  if (!z.string().uuid().safeParse(orderId).success) return Response.json({ error: "Order not found" }, { status: 404 });

  const admin = createAdminClient();
  const [{ bags, error }, settings] = await Promise.all([loadLabelBags(admin, { orderId }), getLabelSettings(admin)]);
  if (error) return Response.json({ error }, { status: 500 });
  if (!bags.length) {
    if (new URL(request.url).searchParams.get("format") === "json") return labelResponse(request, [], settings, "order");
    return Response.json({ error: "This order has no bags yet." }, { status: 404 });
  }
  return labelResponse(request, bags, settings, bags[0].orderNumber || "order");
}
