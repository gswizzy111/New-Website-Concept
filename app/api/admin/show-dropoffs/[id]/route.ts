import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";

const PatchSchema = z.object({
  status: z.enum(["new", "cancelled"]).optional(),
  admin_notes: z.string().max(4000).nullable().optional(),
});

/**
 * Admin changes to a show drop-off: cancel it or put it back to "To enter",
 * and the admin notes. "Entered" is only set by creating its order
 * (/api/admin/orders with show_dropoff_id). The signed details never change.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid data" }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin.from("show_dropoffs").select("status").eq("id", id).maybeSingle();
  if (!row) return Response.json({ error: "Drop-off not found" }, { status: 404 });
  if (parsed.data.status && row.status === "entered") {
    return Response.json({ error: "This drop-off already has an order. Change the order instead." }, { status: 409 });
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.status) {
    update.status = parsed.data.status;
    update.processed_at = parsed.data.status === "cancelled" ? new Date().toISOString() : null;
  }
  if (parsed.data.admin_notes !== undefined) update.admin_notes = parsed.data.admin_notes?.trim() || null;
  if (!Object.keys(update).length) return Response.json({ ok: true });

  const { error } = await admin.from("show_dropoffs").update(update).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
