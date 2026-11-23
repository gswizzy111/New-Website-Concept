import { z } from "zod";
import { isAdmin, getAdminSession } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { changeBagDueDate } from "@/lib/intake/due-dates";

const Body = z.object({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(1).max(500),
});

/**
 * PATCH { dueDate: "YYYY-MM-DD", reason: string } → { bag }
 * Changes a bag's due date by hand. The reason is required and kept, with the
 * old and new date and who changed it, in tier_bag_due_changes; the bag's
 * due date is then marked manual (never recalculated).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Bag not found" }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Pick the new due date and give a reason for the change." }, { status: 400 });
  }

  const by = (await getAdminSession())?.username ?? null;
  const result = await changeBagDueDate(createAdminClient(), {
    bagId: id,
    newDue: parsed.data.dueDate,
    reason: parsed.data.reason,
    by,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ bag: result.bag });
}
