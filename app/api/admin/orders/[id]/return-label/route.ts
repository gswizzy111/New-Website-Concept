import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";
import { getReturnRates, type CustomsCard } from "@/lib/intake/shipping/bag-label";
import { buyOrderReturnLabel } from "@/lib/intake/shipping/order-label";

// The Shippo purchase (address, parcel, customs, paid service) and the
// shipped email live in lib/intake/shipping, shared with the per-bag labels
// of the packing page. The POST claims the order before buying
// (lib/intake/shipping/order-label.ts); otherwise its behaviour is unchanged.

async function authed() {
  return isAdmin();
}

async function getOrder(id: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("orders").select("*").eq("id", id).single();
  return data;
}

async function getCards(orderId: string): Promise<CustomsCard[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("cards")
    .select("card_name, estimated_value_cents")
    .eq("order_id", orderId);
  return data ?? [];
}

// GET — return rates without purchasing
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!await authed()) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const order = await getOrder(id);
    if (!order) return Response.json({ error: "Order not found" }, { status: 404 });

    if (order.return_label_url) return Response.json({ labelUrl: order.return_label_url });

    const quoted = await getReturnRates({ order, customsCards: () => getCards(id) });
    if (!quoted.ok) return Response.json({ error: quoted.error }, { status: quoted.status });

    return Response.json({ rates: quoted.rates, isInternational: quoted.isInternational });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[restoration return-label GET]", msg);
    return Response.json({ error: `Failed to get rates: ${msg}` }, { status: 500 });
  }
}

// POST — purchase the chosen rate. The purchase (claim the order first, so a
// double tap or a bag label on the packing page never makes it a second
// label; then exactly as before) is lib/intake/shipping/order-label.ts
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!await authed()) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const answer = await buyOrderReturnLabel(createAdminClient(), {
      orderId: id,
      body: body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {},
    });
    return Response.json(answer.body, { status: answer.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[restoration return-label POST]", msg);
    return Response.json({ error: `Failed to purchase label: ${msg}` }, { status: 500 });
  }
}
