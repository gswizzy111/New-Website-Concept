import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPartner } from "@/lib/partner-portal";

const Body = z.object({
  client_name: z.string().max(200).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export async function POST(request: Request) {
  const partner = await getPartner();
  if (!partner) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid data" }, { status: 400 });
  const { client_name, notes } = parsed.data;

  const { error } = await createAdminClient().from("partner_referrals").insert({
    partner_id: partner.id,
    client_name: client_name?.trim() || null,
    notes: notes?.trim() || null,
  });

  if (error) {
    console.error("Logging a partner referral failed:", error.message);
    return Response.json({ error: "Could not log the referral. Please try again." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
