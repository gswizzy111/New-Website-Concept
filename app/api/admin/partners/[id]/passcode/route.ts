import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";
import { endSessionsForPartner, PARTNER_PASSCODE_MIN, passcodeColumns, passcodeInUse } from "@/lib/partner-portal";

const Body = z.object({ passcode: z.string().trim().min(1).max(200) });

/** Sets a partner's new passcode (stored hashed) and signs them out of the portal everywhere. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Partner not found" }, { status: 404 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Enter a passcode." }, { status: 400 });
  const { passcode } = parsed.data;
  if (passcode.length < PARTNER_PASSCODE_MIN) {
    return Response.json({ error: `The passcode needs at least ${PARTNER_PASSCODE_MIN} characters.` }, { status: 400 });
  }

  const admin = createAdminClient();
  try {
    if (await passcodeInUse(admin, passcode, id)) {
      return Response.json({ error: "That passcode is already in use. Choose another." }, { status: 409 });
    }
  } catch (err) {
    console.error("Checking partner passcodes failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Could not save the passcode. Please try again." }, { status: 500 });
  }

  const { data, error } = await admin
    .from("partners")
    .update(await passcodeColumns(passcode))
    .eq("id", id)
    .select("id");
  if (error) {
    if (error.code === "23505") {
      return Response.json({ error: "That passcode is already in use. Choose another." }, { status: 409 });
    }
    console.error("Saving a partner passcode failed:", error.message);
    return Response.json({ error: "Could not save the passcode. Please try again." }, { status: 500 });
  }
  if (!data?.length) return Response.json({ error: "Partner not found" }, { status: 404 });

  // The old passcode's sessions end with it
  await endSessionsForPartner(admin, id);
  return Response.json({ ok: true });
}
