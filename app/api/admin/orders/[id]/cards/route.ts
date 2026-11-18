import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";
import { checkCatalogPicks, missingCatalogColumns } from "@/lib/card-catalog-pick";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: orderId } = await params;
  const admin = createAdminClient();

  // Confirm the order exists
  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("id, restoration_tier")
    .eq("id", orderId)
    .single();

  if (orderErr || !order) {
    return Response.json({ error: "Order not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    card_name,
    card_set,
    card_year,
    card_number,
    estimated_value_cents,
    notes,
    photo_urls,
    tier,
  } = body;

  if (!card_name?.trim()) {
    return Response.json({ error: "card_name is required" }, { status: 400 });
  }
  if (card_number != null && (typeof card_number !== "string" || card_number.length > 40)) {
    return Response.json({ error: "Card number is too long." }, { status: 400 });
  }

  // The card picked from the card catalog, if any (lib/card-catalog-pick.ts)
  const picks = await checkCatalogPicks(admin, [body]);
  if (!picks.ok) return Response.json({ error: picks.error }, { status: 400 });
  const catalog = picks.fields[0];

  const row = {
    order_id: orderId,
    card_name: card_name.trim(),
    card_set: card_set ?? null,
    card_year: card_year ?? null,
    ...(card_number?.trim() ? { card_number: card_number.trim() } : {}),
    estimated_value_cents: estimated_value_cents ?? null,
    notes: notes ?? null,
    photo_urls: photo_urls ?? [],
    service_ids: [],
    completed: false,
  };
  const insertCard = (withCatalog: boolean) => admin
    .from("cards")
    .insert(withCatalog && catalog ? { ...row, ...catalog } : row)
    .select("id, card_name")
    .single();
  let { data: card, error: insertErr } = await insertCard(true);
  if (insertErr && catalog && missingCatalogColumns(insertErr)) {
    // A database without the catalog columns still gets the card
    ({ data: card, error: insertErr } = await insertCard(false));
  }

  if (insertErr || !card) {
    console.error("[add card] insert error:", insertErr);
    return Response.json({ error: insertErr?.message ?? "Failed to add card" }, { status: 500 });
  }

  return Response.json({ card });
}
