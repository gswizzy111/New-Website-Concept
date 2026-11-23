import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { isAdmin } from "@/lib/admin-auth";

// Address lines come back as null for orders whose address was saved with an
// empty field (street2 is stored as null), so every optional field takes null too.
const optionalText = z.string().nullish().transform((v) => (v ?? "").trim());

const Schema = z.object({
  customer_name: z.string().trim().min(1, "Name is required."),
  // Any email the admin types is saved as typed (the owner's call): only an empty one is refused
  customer_email: z.string().trim().min(1, "Email is required."),
  // Drop-offs are often entered without a phone: it may stay empty (the column is not null, so "")
  customer_phone: optionalText,
  street1: optionalText,
  street2: optionalText,
  city: optionalText,
  state: optionalText,
  zip: optionalText,
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: orderId } = await params;
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid data" }, { status: 400 });
  }

  const { customer_name, customer_email, customer_phone, street1, street2, city, state, zip } = parsed.data;
  const admin = createAdminClient();

  // Address: keep what the order already has (its country, any other fields) and
  // change only the lines edited here; an international address stays international
  const hasAddress = street1 || city || state || zip;
  let addressUpdate: Record<string, unknown> = {};
  if (hasAddress) {
    const { data: current, error: readError } = await admin.from("orders").select("ship_from_address").eq("id", orderId).maybeSingle();
    if (readError) {
      console.error("Failed to read order address:", readError);
      return Response.json({ error: "Couldn't load the order. Try again." }, { status: 500 });
    }
    if (!current) return Response.json({ error: "Order not found" }, { status: 404 });
    const existing = (current.ship_from_address && typeof current.ship_from_address === "object" ? current.ship_from_address : {}) as Record<string, unknown>;
    addressUpdate = {
      ship_from_address: {
        ...existing,
        name: customer_name,
        street1,
        street2: street2 || null,
        city,
        state,
        zip,
        country: typeof existing.country === "string" && existing.country ? existing.country : "US",
      },
    };
  }

  const { data: updated, error } = await admin
    .from("orders")
    .update({ customer_name, customer_email, customer_phone, ...addressUpdate })
    .eq("id", orderId)
    .select("id");

  if (error) {
    console.error("Failed to update customer:", error);
    return Response.json({ error: "Failed to update customer" }, { status: 500 });
  }
  if (!updated?.length) return Response.json({ error: "Order not found" }, { status: 404 });

  return Response.json({ ok: true });
}
