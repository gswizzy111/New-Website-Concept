import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";
import { checkCatalogPicks, missingCatalogColumns } from "@/lib/card-catalog-pick";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();

  const admin = createAdminClient();

  // Read current card first — we snapshot original_data on first edit
  const { data: current } = await admin.from("cards").select("*").eq("id", id).single();
  if (!current) return Response.json({ error: "Card not found" }, { status: 404 });

  const allowed = ["card_name", "card_set", "card_year", "card_number", "estimated_value_cents", "notes", "photo_urls"];
  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }
  if ("card_number" in update && update.card_number !== null && (typeof update.card_number !== "string" || update.card_number.length > 40)) {
    return Response.json({ error: "Card number is too long." }, { status: 400 });
  }

  // The card picked from the card catalog, or the link cleared (lib/card-catalog-pick.ts)
  const picks = await checkCatalogPicks(admin, [body]);
  if (!picks.ok) return Response.json({ error: picks.error }, { status: 400 });
  const catalog = picks.fields[0];
  if (catalog) Object.assign(update, catalog);

  if (Object.keys(update).length === 0) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }

  // First-time edit: freeze the customer's original values so we can show them permanently
  if (!(current as Record<string, unknown>).original_data) {
    update.original_data = {
      card_name: current.card_name,
      card_set: current.card_set ?? null,
      card_year: (current as Record<string, unknown>).card_year ?? null,
      card_number: (current as Record<string, unknown>).card_number ?? null,
      estimated_value_cents: current.estimated_value_cents ?? null,
      notes: current.notes ?? null,
      photo_urls: (current.photo_urls as string[] | null) ?? [],
    };
  } else {
    // Copies frozen before the card number could be edited don't hold it:
    // add the customer's number the first time it changes
    const snapshot = (current as Record<string, unknown>).original_data as Record<string, unknown>;
    if ("card_number" in update && typeof snapshot === "object" && !("card_number" in snapshot)) {
      update.original_data = { ...snapshot, card_number: (current as Record<string, unknown>).card_number ?? null };
    }
  }

  let { error } = await admin.from("cards").update(update).eq("id", id);
  if (error && catalog && missingCatalogColumns(error)) {
    // A database without the catalog columns still saves the rest
    delete update.catalog_card_id;
    delete update.catalog_image_url;
    ({ error } = await admin.from("cards").update(update).eq("id", id));
  }
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
