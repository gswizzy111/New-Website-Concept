import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { isAdmin } from "@/lib/admin-auth";

// Saved addresses keep empty lines as null (street2 most often), so optional fields take null too
const optionalText = z.string().nullish().transform((v) => (v ?? "").trim());

const Schema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  email: z.string().trim().email("That email address doesn't look right."),
  phone: optionalText,
  street1: optionalText,
  street2: optionalText,
  city: optionalText,
  state: optionalText,
  zip: optionalText,
  country: z.string().nullish().transform((v) => (v ?? "").trim() || "US"),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid data" }, { status: 400 });

  const { name, email, phone, street1, street2, city, state, zip, country } = parsed.data;
  const admin = createAdminClient();

  const shippingAddress = street1
    ? { street1, street2: street2 || null, city, state, zip, country }
    : null;

  const updatePayload: Record<string, unknown> = {
    customer_name: name,
    customer_email: email,
    customer_phone: phone,
  };
  if (shippingAddress) updatePayload.shipping_address = shippingAddress;

  const { error } = await admin.from("shop_orders").update(updatePayload).eq("id", id);
  if (error) return Response.json({ error: "Failed to update" }, { status: 500 });

  return Response.json({ ok: true });
}
