import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";
import { emailCompletionNotesOnce } from "@/lib/completion-notes-email";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  // A missing or malformed body must not wipe the notes
  if (typeof body?.notes !== "string") return Response.json({ error: "Invalid notes" }, { status: 400 });
  const notes: string = body.notes;

  const admin = createAdminClient();

  const { data: order, error: fetchError } = await admin
    .from("orders")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !order) return Response.json({ error: fetchError?.message ?? "Order not found" }, { status: fetchError ? 500 : 404 });

  const { error } = await admin.from("orders").update({ admin_notes: notes }).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Saving doesn't email the customer by itself: the notes go out once, when
  // the order is Completed (or now, if it already is)
  const emailed = notes.trim() ? await emailCompletionNotesOnce(admin, id, { savedNow: true }) : "no_notes";

  return Response.json({ ok: true, emailed });
}
