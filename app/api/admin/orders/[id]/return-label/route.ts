import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";
import { DONE_STATUSES, emailCompletionNotesOnce } from "@/lib/completion-notes-email";
import {
  getReturnRates, paidReturnInsuranceCents, purchaseReturnLabel, returnInsuranceCents, type CustomsCard,
} from "@/lib/intake/shipping/bag-label";
import { sendReturnShippedEmail } from "@/lib/intake/shipping/shipped-email";
import { bagLabelInFlight } from "@/lib/intake/shipping/bag-shipments";

// The Shippo purchase (address, parcel, customs, paid service) and the
// shipped email live in lib/intake/shipping, shared with the per-bag labels
// of the packing page; this route's behaviour is unchanged.

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

// POST — purchase the chosen rate
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!await authed()) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const order = await getOrder(id);
    if (!order) return Response.json({ error: "Order not found" }, { status: 404 });

    if (order.return_label_url) return Response.json({ labelUrl: order.return_label_url });

    const body = await req.json().catch(() => ({}));
    const { rateObjectId, insuranceDeclaredValueCents: adminInsuranceCents } = body;
    if (!rateObjectId) return Response.json({ error: "Missing rateObjectId" }, { status: 400 });

    const admin = createAdminClient();
    // A bag of this order is getting its own label on the packing page (ship
    // each bag when done): a whole-order label now would be a second one
    if (await bagLabelInFlight(admin, id)) {
      return Response.json({ error: "A return label for one of this order's bags is being bought on the packing page. Reload to see it; each bag ships with its own label." }, { status: 409 });
    }

    // The customer's paid return insurance (round trip, or return only) is the floor:
    // an admin amount can raise it, never lower it
    const insuranceCents = returnInsuranceCents(paidReturnInsuranceCents(order), adminInsuranceCents);

    // International: a fresh shipment+transaction with customs; domestic: the
    // chosen rate with the insurance (lib/intake/shipping/bag-label.ts)
    const bought = await purchaseReturnLabel({ order, rateObjectId, insuranceCents, customsCards: () => getCards(id) });
    if (!bought.ok) return Response.json({ error: bought.error }, { status: bought.status });
    const { labelUrl, trackingNumber, trackingUrl, carrier: rateCarrier } = bought;
    const carrier = { provider: rateCarrier.provider, service: rateCarrier.service };

    const labelFields = {
      return_label_url: labelUrl,
      tracking_number: trackingNumber ?? null,
      status: "shipped_back",
    };
    // The carrier goes with the label (and the tracking number it belongs to),
    // so tracking is looked up with the right one, not always USPS
    let { error: saveErr } = await admin
      .from("orders")
      .update({
        ...labelFields,
        outbound_tracking_number: trackingNumber ?? null,
        outbound_carrier: carrier.provider,
        outbound_service_level: carrier.service,
        outbound_tracking_url: trackingUrl,
      })
      .eq("id", id);
    if (saveErr) {
      console.error("[restoration return-label] saving with carrier failed, retrying without:", saveErr.message);
      ({ error: saveErr } = await admin.from("orders").update(labelFields).eq("id", id));
    }
    if (saveErr) {
      console.error("[restoration return-label] label bought but not saved:", saveErr.message, labelUrl);
      return Response.json({ error: `The label was bought but couldn't be saved on the order (${saveErr.message}). Don't buy another: open it here and keep the link: ${labelUrl}` }, { status: 500 });
    }

    await admin.from("order_events").insert({
      order_id: id,
      event_type: "status_updated",
      description: trackingNumber
        ? `Return label purchased — marked Shipped Back. Tracking: ${trackingNumber}`
        : "Return label purchased — marked Shipped Back.",
      is_customer_visible: true,
    });

    if (order.customer_email && trackingNumber) {
      await sendReturnShippedEmail(order, { trackingNumber, trackingUrl });
    }

    // Shipping it back means the work is done: the customer gets the restoration notes (once)
    const notesEmailed = DONE_STATUSES.includes(order.status as string) ? null : await emailCompletionNotesOnce(admin, id);

    return Response.json({ labelUrl, trackingNumber, ...(notesEmailed ? { notesEmailed } : {}) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[restoration return-label POST]", msg);
    return Response.json({ error: `Failed to purchase label: ${msg}` }, { status: 500 });
  }
}
