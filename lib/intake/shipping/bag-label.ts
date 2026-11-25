import "server-only";
import { shippo as shippoSdk, businessAddress } from "@/lib/shippo";
import { ratesWithPaidService } from "@/lib/paid-shipping-rate";
import { shippoRateInfo } from "@/lib/tracking-carrier";
import type { ShipRate } from "@/lib/intake/shipping/types";

/**
 * Buying a return label with Shippo: the address, parcel, customs for
 * international orders, the rate the customer paid for and the purchase.
 * Moved unchanged out of POST/GET /api/admin/orders/[id]/return-label (the
 * order page's "Buy return label") so that route and the per-bag label
 * (bag-shipments.ts) buy labels the same way. Server only.
 *
 * Shippo is reached through a `ShippoPort` (the SDK for shipments and rates,
 * the REST API for transactions, so `extra` insurance isn't stripped by the
 * SDK) so tests can stand in for it; `liveShippo` is the real one.
 */

type SdkRate = {
  objectId: string;
  provider: string;
  amount: string;
  currency: string;
  estimatedDays?: number | null;
  servicelevel?: { name?: string | null; token?: string | null } | null;
};

export type ShippoPort = {
  /** shippo.shipments.create(...) */
  createShipment(input: Record<string, unknown>): Promise<{ rates?: SdkRate[] | null }>;
  /** POST https://api.goshippo.com/transactions/: the HTTP status and the JSON answer. */
  createTransaction(body: Record<string, unknown>): Promise<{ httpStatus: number; body: Record<string, unknown> }>;
  /** GET /rates/<id>: provider, service and price; never throws. */
  rateInfo(rateId: string): Promise<{ provider: string | null; service: string | null; amount: string | null }>;
};

export const liveShippo: ShippoPort = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createShipment: (input) => shippoSdk.shipments.create(input as any) as unknown as Promise<{ rates?: SdkRate[] | null }>,
  async createTransaction(body) {
    const txRes = await fetch("https://api.goshippo.com/transactions/", {
      method: "POST",
      headers: {
        "Authorization": `ShippoToken ${process.env.SHIPPO_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { httpStatus: txRes.status, body: await txRes.json() as Record<string, unknown> };
  },
  rateInfo: shippoRateInfo,
};

/** The order fields a return label reads (an orders row). */
export type ReturnLabelOrder = {
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  ship_from_address?: unknown;
  inbound_carrier?: string | null;
  inbound_service_level?: string | null;
  return_carrier?: string | null;
  return_service_level?: string | null;
  insurance_type?: string | null;
  insurance_declared_value_cents?: number | null;
};

export type CustomsCard = { card_name: string; estimated_value_cents: number | null };

export const PARCEL = {
  massUnit: "lb" as const,
  weight: "1",
  distanceUnit: "in" as const,
  length: "7",
  width: "5",
  height: "1",
};

/** The customer's address on the order (where the cards came from: they go back there). */
export function returnAddress(order: ReturnLabelOrder): Record<string, string> | null {
  return (order.ship_from_address as Record<string, string> | null) ?? null;
}

/** Anything but a US address needs customs. */
export function isInternational(addr: Record<string, string> | null | undefined): boolean {
  return !!(addr?.country && addr.country !== "US");
}

export function buildAddressTo(order: ReturnLabelOrder, addr: Record<string, string>) {
  return {
    name: (order.customer_name as string) ?? "",
    street1: addr.street1,
    street2: addr.street2 ?? "",
    city: addr.city ?? "",
    state: addr.state ?? "",
    zip: addr.zip ?? "",
    country: addr.country ?? "US",
    phone: (order.customer_phone as string) ?? "",
    email: (order.customer_email as string) ?? "",
  };
}

/** The customs declaration for the cards going back (one item per card; $50 a card when no value was declared). */
export function buildCustomsDeclaration(cards: readonly CustomsCard[]) {
  // Sum customer-declared card values; fall back to $50/card if none set
  const totalValueCents = cards.reduce(
    (sum, c) => sum + (c.estimated_value_cents ?? 5000),
    0
  );
  const totalValue = Math.max(totalValueCents / 100, 10); // minimum $10
  const cardCount = Math.max(cards.length, 1);

  // Build one customs item per card so the declaration is detailed
  const items = cards.length > 0
    ? cards.map((c) => ({
        description: c.card_name.slice(0, 25),
        quantity: 1,
        netWeight: "0.1",
        massUnit: "oz",
        valueAmount: ((c.estimated_value_cents ?? 5000) / 100).toFixed(2),
        valueCurrency: "USD",
        originCountry: "US",
      }))
    : [{
        description: "Returned trading cards",
        quantity: cardCount,
        netWeight: "8",
        massUnit: "oz",
        valueAmount: totalValue.toFixed(2),
        valueCurrency: "USD",
        originCountry: "US",
      }];

  return {
    contentsType: "RETURN_MERCHANDISE",
    contentsExplanation: "Returned goods",
    nonDeliveryOption: "RETURN",
    certify: true,
    certifySigner: process.env.BUSINESS_SHIPPING_NAME ?? businessAddress.name ?? "TCD",
    eelPfc: "NOEEI_30_37_a",
    items,
  };
}

/**
 * The service the customer paid for: a prepaid label covers the trip in and
 * back (inbound_*); self-ship orders pay for the trip back (return_*).
 */
export function paidServiceOf(order: ReturnLabelOrder): { carrier: string | null; service: string } | null {
  return order.inbound_service_level
    ? { carrier: order.inbound_carrier as string | null, service: order.inbound_service_level as string }
    : order.return_service_level
      ? { carrier: order.return_carrier as string | null, service: order.return_service_level as string }
      : null;
}

/** The customer's paid return insurance (round trip, or return only), in cents; 0 when none. */
export function paidReturnInsuranceCents(order: ReturnLabelOrder): number {
  return (order.insurance_type === "round_trip" || order.insurance_type === "return") && (order.insurance_declared_value_cents ?? 0) > 0
    ? (order.insurance_declared_value_cents as number)
    : 0;
}

/** The paid floor is kept: an admin amount can raise it, never lower it. */
export function returnInsuranceCents(paidFloorCents: number, adminInsuranceCents: unknown): number {
  const adminCents = typeof adminInsuranceCents === "number" && Number.isFinite(adminInsuranceCents) && adminInsuranceCents > 0
    ? Math.round(adminInsuranceCents)
    : 0;
  return Math.max(adminCents, paidFloorCents);
}

export type RatesResult =
  | { ok: true; rates: ShipRate[]; isInternational: boolean }
  | { ok: false; status: number; error: string };

/**
 * The rates for a return label without buying (the order page's GET):
 * cheapest first, at most 5, the service the customer paid for flagged.
 * Throws when Shippo can't be reached (the callers answer "Failed to get rates").
 * `customsCards` is read only for an international address.
 */
export async function getReturnRates(
  input: { order: ReturnLabelOrder; customsCards: () => Promise<readonly CustomsCard[]> },
  port: ShippoPort = liveShippo,
): Promise<RatesResult> {
  const { order } = input;
  const addr = returnAddress(order);
  if (!addr?.street1) return { ok: false, status: 400, error: "No customer address on file" };

  const international = isInternational(addr);
  const customsDeclaration = international ? buildCustomsDeclaration(await input.customsCards()) : undefined;

  const shipment = await port.createShipment({
    addressFrom: businessAddress,
    addressTo: buildAddressTo(order, addr),
    parcels: [PARCEL],
    ...(customsDeclaration ? { customsDeclaration } : {}),
    async: false,
  });

  const rates = ratesWithPaidService(shipment.rates ?? [], paidServiceOf(order))
    .map(({ rate: r, paid }) => ({
      objectId: r.objectId,
      provider: r.provider,
      service: r.servicelevel?.name ?? "",
      amount: r.amount,
      currency: r.currency,
      days: r.estimatedDays ?? null,
      paid,
    }));

  if (rates.length === 0) return { ok: false, status: 500, error: "No rates available from Shippo" };
  return { ok: true, rates, isInternational: international };
}

export type PurchaseResult =
  | {
      ok: true;
      labelUrl: string;
      trackingNumber: string | null;
      trackingUrl: string | null;
      carrier: { provider: string | null; service: string | null };
      transactionId: string | null;
      rateId: string;
      /** What the label cost, when Shippo said. */
      amountCents: number | null;
      international: boolean;
    }
  | {
      ok: false;
      status: number;
      error: string;
      /**
       * true: Shippo refused (or was never asked), so nothing was bought and
       * trying again is safe. false: no clear answer after the purchase was
       * sent; a label may exist.
       */
      definite: boolean;
    };

const toCents = (amount: unknown): number | null => {
  const n = typeof amount === "string" || typeof amount === "number" ? Number.parseFloat(String(amount)) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

function failureDetail(transaction: Record<string, unknown>): string {
  const messages = (transaction.messages as { text: string }[] | undefined) ?? [];
  return messages.map((m) => m.text).join("; ") || JSON.stringify(transaction);
}

/**
 * Buy the return label for the chosen rate, exactly as the order page's
 * POST did: international addresses get a fresh shipment with customs (the
 * chosen rate, else the cheapest; no insurance), domestic ones buy the rate
 * as is with the insurance amount, if any. Never throws.
 *
 * `metadata` (optional, at most 100 characters) is stored on the Shippo
 * transaction so a label can be found in Shippo's history; the order page's
 * route sends none, as before.
 */
export async function purchaseReturnLabel(
  input: {
    order: ReturnLabelOrder;
    rateObjectId: string;
    insuranceCents: number;
    customsCards: () => Promise<readonly CustomsCard[]>;
    metadata?: string;
    /** The rate's price when the caller already has it (picked from a quote). */
    knownAmount?: string | null;
  },
  port: ShippoPort = liveShippo,
): Promise<PurchaseResult> {
  const { order, rateObjectId, insuranceCents } = input;
  const addr = returnAddress(order);
  const international = isInternational(addr);
  const hasRoundTripInsurance = insuranceCents > 0; // keep legacy var name for the payload below
  const meta = input.metadata ? { metadata: input.metadata.slice(0, 100) } : {};
  // Until the transaction is sent, nothing can have been bought
  let sent = false;

  try {
    // International: create a fresh shipment+transaction so customs is attached to the label
    // (Shippo requires customs on the shipment, not just the rate)
    if (international && addr) {
      const customsDeclaration = buildCustomsDeclaration(await input.customsCards());

      const shipment = await port.createShipment({
        addressFrom: businessAddress,
        addressTo: buildAddressTo(order, addr),
        parcels: [PARCEL],
        customsDeclaration,
        async: false,
      });

      const rates = (shipment.rates ?? []).sort(
        (a, b) => parseFloat(a.amount) - parseFloat(b.amount)
      );

      // Find the rate matching the one the admin selected (by provider+service),
      // falling back to the cheapest if the exact rate expired
      const selectedRateObj = rates.find((r) => r.objectId === rateObjectId) ?? rates[0];
      if (!selectedRateObj) {
        return { ok: false, status: 422, error: "No shipping rates available for this address", definite: true };
      }

      sent = true;
      const { httpStatus, body: transaction } = await port.createTransaction({
        rate: selectedRateObj.objectId, label_file_type: "PDF_4x6", async: false, ...meta,
      });
      if (transaction.status !== "SUCCESS" || !transaction.label_url) {
        return { ok: false, status: 500, error: `Label purchase failed: ${failureDetail(transaction)}`, definite: refused(httpStatus, transaction) };
      }

      return {
        ok: true,
        labelUrl: transaction.label_url as string,
        trackingNumber: (transaction.tracking_number as string) ?? null,
        trackingUrl: (transaction.tracking_url_provider as string) ?? null,
        carrier: { provider: selectedRateObj.provider ?? null, service: selectedRateObj.servicelevel?.name ?? null },
        transactionId: (transaction.object_id as string) ?? null,
        rateId: selectedRateObj.objectId,
        amountCents: toCents(selectedRateObj.amount),
        international: true,
      };
    }

    // Domestic — use direct REST API so `extra` (insurance, signature) isn't stripped by the SDK
    const txBody: Record<string, unknown> = {
      rate: rateObjectId,
      label_file_type: "PDF_4x6",
      async: false,
      ...meta,
    };
    if (hasRoundTripInsurance) {
      txBody.extra = {
        insurance: {
          amount: (insuranceCents / 100).toFixed(2),
          currency: "USD",
          provider: "SHIPPO",
          content: "Trading cards",
        },
      };
    }
    sent = true;
    const { httpStatus, body: transaction } = await port.createTransaction(txBody);
    if (transaction.status !== "SUCCESS" || !transaction.label_url) {
      return { ok: false, status: 500, error: `Label purchase failed: ${failureDetail(transaction)}`, definite: refused(httpStatus, transaction) };
    }

    const info = await port.rateInfo(rateObjectId);
    return {
      ok: true,
      labelUrl: transaction.label_url as string,
      trackingNumber: (transaction.tracking_number as string) ?? null,
      trackingUrl: (transaction.tracking_url_provider as string) ?? null,
      carrier: { provider: info.provider, service: info.service },
      transactionId: (transaction.object_id as string) ?? null,
      rateId: rateObjectId,
      amountCents: toCents(input.knownAmount ?? info.amount),
      international: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[return-label purchase]", msg);
    return { ok: false, status: 500, error: `Failed to purchase label: ${msg}`, definite: !sent };
  }
}

/** Shippo said no for certain: an ERROR transaction, or the request itself was refused (4xx). */
function refused(httpStatus: number, transaction: Record<string, unknown>): boolean {
  return transaction.status === "ERROR" || (httpStatus >= 400 && httpStatus < 500);
}
