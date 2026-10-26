import { shippo, businessAddress } from "@/lib/shippo";
import {
  WeightUnitEnum,
  DistanceUnitEnum,
  CustomsDeclarationContentsTypeEnum,
  CustomsDeclarationNonDeliveryOptionEnum,
  CustomsDeclarationEelPfcEnum,
} from "shippo/models/components";
import type { ShippingAddress } from "@/lib/shipping-address";

/**
 * Kit shipping is priced from live carrier rates for the customer's address
 * and the speed they pick, plus handling: $2 in the US (the owner's call),
 * $10 abroad (as before). The rate they pick is bought as the outbound label
 * when they pay (the Stripe webhook, from metadata.kit_rate_object_id).
 */
export const DOMESTIC_HANDLING_CENTS = 200;
export const INTERNATIONAL_HANDLING_CENTS = 1000;

const BOX_KEYWORDS = ["official", "essential", "clamp"];

/** The parcel the admin label routes use: a box for kits with tools, else a mailer. */
export function kitParcel(itemNames: string[]) {
  const needsBox = itemNames.some((n) => BOX_KEYWORDS.some((kw) => n.toLowerCase().includes(kw)));
  return needsBox
    ? { massUnit: WeightUnitEnum.Lb, weight: "4", distanceUnit: DistanceUnitEnum.In, length: "10", width: "7", height: "7" }
    : { massUnit: WeightUnitEnum.Oz, weight: "6", distanceUnit: DistanceUnitEnum.In, length: "8", width: "5", height: "1" };
}

export type KitRate = {
  id: string;
  provider: string;
  service: string;
  days: number | null;
  postageCents: number;
  /** What the customer pays: postage plus handling. */
  priceCents: number;
};

function handlingFor(country: string) {
  return country === "US" ? DOMESTIC_HANDLING_CENTS : INTERNATIONAL_HANDLING_CENTS;
}

/** Live rates for a kit order, cheapest first, one per carrier service (up to 5). */
export async function quoteKitRates(opts: {
  address: ShippingAddress;
  name: string;
  phone?: string;
  email?: string;
  itemNames: string[];
  declaredValueCents: number;
}): Promise<KitRate[]> {
  const { address: a } = opts;
  const parcel = kitParcel(opts.itemNames);
  const international = a.country !== "US";
  const shipment = await shippo.shipments.create({
    addressFrom: businessAddress,
    addressTo: {
      name: opts.name || "Customer",
      street1: a.street1,
      street2: a.street2 ?? "",
      city: a.city,
      state: a.state ?? "",
      zip: a.zip,
      country: a.country,
      ...(opts.phone ? { phone: opts.phone } : {}),
      ...(opts.email ? { email: opts.email } : {}),
    },
    parcels: [parcel],
    // Abroad, the label can only be bought later if the quote carries customs
    ...(international ? {
      customsDeclaration: {
        certify: true,
        certifySigner: businessAddress.name || "TCD",
        contentsType: CustomsDeclarationContentsTypeEnum.Merchandise,
        nonDeliveryOption: CustomsDeclarationNonDeliveryOptionEnum.Return,
        eelPfc: CustomsDeclarationEelPfcEnum.NOEEI3037A,
        items: [{
          description: "Card restoration kit supplies",
          quantity: 1,
          netWeight: parcel.weight,
          massUnit: parcel.massUnit,
          valueAmount: (Math.max(100, opts.declaredValueCents) / 100).toFixed(2),
          valueCurrency: "USD",
          originCountry: "US",
        }],
      },
    } : {}),
    async: false,
  });

  const handling = handlingFor(a.country);
  const seen = new Set<string>();
  return [...(shipment.rates ?? [])]
    .filter((r) => parseFloat(r.amount) > 0)
    .sort((x, y) => parseFloat(x.amount) - parseFloat(y.amount))
    .filter((r) => {
      const key = `${r.provider}|${r.servicelevel?.name ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5)
    .map((r) => {
      const postageCents = Math.round(parseFloat(r.amount) * 100);
      return {
        id: r.objectId,
        provider: r.provider,
        service: r.servicelevel?.name ?? "",
        days: r.estimatedDays ?? null,
        postageCents,
        priceCents: postageCents + handling,
      };
    });
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Looks the chosen rate up at Shippo (never trusting the price the browser
 * sends) and checks it was quoted for this order's address.
 */
export async function verifyKitRate(rateId: string, address: ShippingAddress): Promise<KitRate | null> {
  try {
    const rate = await shippo.rates.get(rateId);
    const shipment = await shippo.shipments.get(rate.shipment);
    const to = shipment.addressTo;
    const sameAddress = norm(to?.street1) === norm(address.street1)
      && norm(to?.zip).slice(0, 5) === norm(address.zip).slice(0, 5)
      && (to?.country ?? "US").toUpperCase() === address.country;
    if (!sameAddress) return null;
    const postageCents = Math.round(parseFloat(rate.amount) * 100);
    return {
      id: rate.objectId,
      provider: rate.provider,
      service: rate.servicelevel?.name ?? "",
      days: rate.estimatedDays ?? null,
      postageCents,
      priceCents: postageCents + handlingFor(address.country),
    };
  } catch (err) {
    console.error("Kit rate lookup failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export type KitLabel = {
  labelUrl: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  /** The rate's carrier (Shippo provider, e.g. "USPS", "UPS"), when the caller knows it. */
  carrier: string | null;
  /** Commercial invoice for customs, when the carrier makes one (international). */
  customsUrl: string | null;
};

/**
 * Buys the rate the customer picked at checkout as the outbound label.
 * Called once per paid order by the Stripe webhook. REST rather than the SDK
 * so the response's messages come back whole for the admin email.
 */
export async function buyKitLabel(rateId: string, international: boolean, carrier: string | null = null): Promise<{ label: KitLabel } | { error: string }> {
  try {
    const res = await fetch("https://api.goshippo.com/transactions/", {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${process.env.SHIPPO_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      // US: a 4x6 for the thermal printer; abroad: the full page the admin label route uses
      body: JSON.stringify({ rate: rateId, label_file_type: international ? "PDF" : "PDF_4x6", async: false }),
    });
    const tx = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (tx.status !== "SUCCESS" || !tx.label_url) {
      const messages = (tx.messages as { text?: string }[] | undefined) ?? [];
      const detail = messages.map((m) => m.text).filter(Boolean).join("; ") || (tx.detail as string | undefined) || `Shippo status ${tx.status ?? res.status}`;
      return { error: detail };
    }
    return {
      label: {
        labelUrl: tx.label_url as string,
        trackingNumber: (tx.tracking_number as string | undefined) || null,
        trackingUrl: (tx.tracking_url_provider as string | undefined) || null,
        carrier: carrier?.trim() || null,
        customsUrl: (tx.commercial_invoice_url as string | undefined) || null,
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
