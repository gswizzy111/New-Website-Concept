import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PREVIEW_MESSAGE, PREVIEW_MODE } from "@/lib/preview";
import { DONE_STATUSES, emailCompletionNotesOnce } from "@/lib/completion-notes-email";
import {
  findLabelByMetadata, liveShippo, paidReturnInsuranceCents, purchaseReturnLabel, returnInsuranceCents,
  type BoughtLabel, type CustomsCard, type ShippoPort,
} from "@/lib/intake/shipping/bag-label";
import { sendReturnShippedEmail } from "@/lib/intake/shipping/shipped-email";
import {
  atTime, bagLabelsLive, boughtOnClaim, dropClaim, isMissingShipmentsTable, keepUnsavedLabel, readOrderClaim, releaseClaim,
  type OrderClaimRow,
} from "@/lib/intake/shipping/bag-shipments";
import { appendNote, CLAIM_STALE_MS, SHIPMENT_COLUMNS } from "@/lib/intake/shipping/types";

/**
 * POST /api/admin/orders/<id>/return-label: the order page's "Buy return
 * label" for the WHOLE order, moved here unchanged from the route so it can
 * claim the order first (and be tested). The one addition: before buying it
 * claims the order (a bag_shipments row with no bag, unique per order while
 * live), so a double tap buys one label, and it never buys while a bag of
 * the order has its own label on the packing page. The bag route checks for
 * this claim after writing its own, and this checks for bag claims after
 * writing this one, so the two never both buy.
 *
 * Answers are the route's: 200 { labelUrl, trackingNumber, notesEmailed? }
 * (or { labelUrl } when the order already has one), 400 / 404 / 422 / 500
 * { error }, plus 409 { error, inProgress } while another tap is buying and
 * 409 { error, staleClaim, claimedAt } for a purchase that never finished
 * and can't be checked in Shippo (POST again with retryStaleClaim: true
 * after checking Shippo). A stale purchase Shippo's history shows as bought
 * ("Order <number>" metadata) is saved, not bought again; one it shows as
 * never bought is released and bought. Before the bag_shipments migration it
 * buys without a claim, exactly as before.
 */

type Deps = { shippo?: ShippoPort; preview?: boolean; now?: () => Date };
export type RouteAnswer = { status: number; body: Record<string, unknown> };

type Order = Record<string, unknown> & {
  id: string;
  order_number: string;
  status: string;
  customer_email?: string | null;
  return_label_url?: string | null;
};

const orderMetadata = (order: { order_number: unknown }) => `Order ${String(order.order_number)}`;
const IN_PROGRESS = "This order's return label is being bought right now. Wait a few seconds, then reload.";

async function readCards(admin: SupabaseClient, orderId: string): Promise<CustomsCard[]> {
  const { data } = await admin
    .from("cards")
    .select("card_name, estimated_value_cents")
    .eq("order_id", orderId);
  return data ?? [];
}

type Claim =
  | { kind: "claimed"; row: OrderClaimRow | null }
  | { kind: "recover"; row: OrderClaimRow; label: BoughtLabel }
  | { kind: "refused"; answer: RouteAnswer };

const refused = (status: number, body: Record<string, unknown>): Claim => ({ kind: "refused", answer: { status, body } });

/** Claim the order for its whole-order label, or say why not (or which bought label to save instead). */
async function claimOrder(admin: SupabaseClient, order: Order, opts: { retryStaleClaim: boolean; port: ShippoPort; now: () => Date }): Promise<Claim> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await admin.from("bag_shipments")
      .insert({ bag_id: null, order_id: order.id, status: "claimed", claimed_at: opts.now().toISOString() })
      .select(SHIPMENT_COLUMNS)
      .single();
    if (!error && data) return { kind: "claimed", row: data as OrderClaimRow };
    // Before the migration: buy exactly as before, without a claim (only the bag flow says "not set up yet")
    if (isMissingShipmentsTable(error)) {
      console.warn("[restoration return-label] bag_shipments isn't in the database (20261125_bag_shipments.sql not applied): buying without the order claim, as before.");
      return { kind: "claimed", row: null };
    }
    if (error?.code !== "23505") {
      return refused(500, { error: `Couldn't start the purchase (${error?.message ?? "no row"}). Nothing was bought.` });
    }

    // Another tap holds the order
    const held = await readOrderClaim(admin, order.id);
    if (held.error) return refused(500, { error: `Couldn't check the purchase in progress (${held.error}). Nothing was bought.` });
    if (!held.row) continue; // released meanwhile: claim again
    const row = held.row;
    const kept = boughtOnClaim(row);
    if (kept) return { kind: "recover", row, label: kept };
    if (opts.now().getTime() - Date.parse(row.claimed_at) < CLAIM_STALE_MS) return refused(409, { error: IN_PROGRESS, inProgress: true });

    // Never finished: Shippo's history says whether it bought a label
    const lookup = await findLabelByMetadata(opts.port, orderMetadata(order), row.claimed_at);
    if (lookup.kind === "found") return { kind: "recover", row, label: lookup.label };
    if (lookup.kind === "pending") return refused(409, { error: "Shippo is still making this order's label. Wait a minute, then reload.", inProgress: true });
    if (lookup.kind === "unknown" && !opts.retryStaleClaim) {
      return refused(409, {
        error: `A label purchase for this order started at ${atTime(row.claimed_at)} and never finished, so it may or may not have been bought (${lookup.error}). Check Shippo's label history first; if this order has no label there, buy again.`,
        staleClaim: true,
        claimedAt: row.claimed_at,
      });
    }
    const released = await releaseClaim(admin, row,
      lookup.kind === "none" ? "Never finished; Shippo had no label for it, released to buy again." : "Never finished; released by staff to buy again.");
    if (!released.ok) return refused(500, { error: `Couldn't release the unfinished purchase (${released.error}). Nothing was bought.` });
  }
  return refused(409, { error: IN_PROGRESS, inProgress: true });
}

/** The order page's label is on the order: the claim has done its job. */
async function endClaim(admin: SupabaseClient, row: OrderClaimRow | null) {
  if (!row) return;
  const { error } = await admin.from("bag_shipments").delete().eq("id", row.id);
  if (!error) return;
  // Can't delete: at least stop it holding the order
  const { error: e2 } = await admin.from("bag_shipments")
    .update({ status: "failed", error: appendNote(row.error, "Done: the label is saved on the order.") }).eq("id", row.id);
  if (e2) console.error("[restoration return-label] order claim not cleared:", e2.message);
}

/**
 * Save the label on the order exactly as the route always has (shipped
 * back, the event, the customer's shipped email, the completion notes once),
 * then end the claim. A label that can't be saved stays on the claim, so the
 * next tap saves it instead of buying another.
 */
async function saveOnOrder(admin: SupabaseClient, order: Order, label: BoughtLabel, claim: OrderClaimRow | null): Promise<RouteAnswer> {
  const id = order.id;
  const { labelUrl, trackingNumber, trackingUrl, carrier: rateCarrier } = label;
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
    if (claim) await keepUnsavedLabel(admin, claim.id, label, null);
    return { status: 500, body: { error: `The label was bought but couldn't be saved on the order (${saveErr.message}). Don't buy another: open it here and keep the link: ${labelUrl}` } };
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

  await endClaim(admin, claim);
  return { status: 200, body: { labelUrl, trackingNumber, ...(notesEmailed ? { notesEmailed } : {}) } };
}

export async function buyOrderReturnLabel(
  admin: SupabaseClient,
  input: { orderId: string; body: Record<string, unknown> },
  deps: Deps = {},
): Promise<RouteAnswer> {
  const id = input.orderId;
  const port = deps.shippo ?? liveShippo;
  const now = () => deps.now?.() ?? new Date();

  const { data } = await admin.from("orders").select("*").eq("id", id).single();
  const order = data as Order | null;
  if (!order) return { status: 404, body: { error: "Order not found" } };

  if (order.return_label_url) return { status: 200, body: { labelUrl: order.return_label_url } };

  const { rateObjectId, insuranceDeclaredValueCents: adminInsuranceCents } = input.body;
  if (!rateObjectId) return { status: 400, body: { error: "Missing rateObjectId" } };
  if (deps.preview ?? PREVIEW_MODE) return { status: 503, body: { error: PREVIEW_MESSAGE } };

  // Claim the order first: a double tap buys one label
  const claimed = await claimOrder(admin, order, { retryStaleClaim: input.body.retryStaleClaim === true, port, now });
  if (claimed.kind === "refused") return claimed.answer;
  // A purchase that never finished bought this label: save it, buy nothing new
  if (claimed.kind === "recover") return saveOnOrder(admin, order, claimed.label, claimed.row);
  const claim = claimed.row;

  // A bag of this order is getting its own label on the packing page (ship
  // each bag when done): a whole-order label now would be a second one.
  // Checked after our claim (the bag route checks for ours after its own)
  const bags = await bagLabelsLive(admin, id);
  if (bags.error || bags.live) {
    if (claim) await dropClaim(admin, claim, bags.error ? "Released: the bag labels couldn't be checked." : "Released: a bag label is live.");
    return bags.error
      ? { status: 500, body: { error: `Couldn't check this order's bag labels (${bags.error}). Nothing was bought.` } }
      : { status: 409, body: { error: "A return label for one of this order's bags is being bought on the packing page. Reload to see it; each bag ships with its own label." } };
  }

  // The customer's paid return insurance (round trip, or return only) is the floor:
  // an admin amount can raise it, never lower it
  const insuranceCents = returnInsuranceCents(paidReturnInsuranceCents(order), adminInsuranceCents);

  // International: a fresh shipment+transaction with customs; domestic: the
  // chosen rate with the insurance (lib/intake/shipping/bag-label.ts). The
  // metadata finds this label in Shippo's history if the answer is lost
  const bought = await purchaseReturnLabel({
    order, rateObjectId: String(rateObjectId), insuranceCents, customsCards: () => readCards(admin, id), metadata: orderMetadata(order),
  }, port);
  if (!bought.ok) {
    if (claim) {
      if (bought.definite) {
        // Shippo said no: nothing was bought, tapping again retries
        const released = await releaseClaim(admin, claim, bought.error.slice(0, 1000));
        if (!released.ok) console.error("[restoration return-label] claim not released:", released.error);
      } else {
        // No clear answer: keep the claim, so the next tap checks Shippo before buying
        const { error } = await admin.from("bag_shipments")
          .update({ error: appendNote(claim.error, bought.error.slice(0, 1000)) }).eq("id", claim.id).eq("status", "claimed");
        if (error) console.error("[restoration return-label] claim note not saved:", error.message);
        return { status: bought.status, body: { error: `${bought.error} Shippo didn't answer clearly, so a label may or may not have been bought: tap again in a few minutes and it is checked in Shippo first.` } };
      }
    }
    return { status: bought.status, body: { error: bought.error } };
  }
  return saveOnOrder(admin, order, bought, claim);
}
