/**
 * Which carrier a tracking number belongs to, for Shippo tracking lookups and
 * "Track Package" links. Labels can be bought at any carrier (return labels,
 * kit labels), so never assume USPS: use the carrier saved with the label when
 * there is one, else tell it from the number's format.
 */

export type Carrier = { token: string; name: string; url: (tracking: string) => string };

const enc = encodeURIComponent;

const CARRIERS: Record<string, Carrier> = {
  usps: { token: "usps", name: "USPS", url: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${enc(n)}` },
  ups: { token: "ups", name: "UPS", url: (n) => `https://www.ups.com/track?tracknum=${enc(n)}` },
  fedex: { token: "fedex", name: "FedEx", url: (n) => `https://www.fedex.com/fedextrack/?trknbr=${enc(n)}` },
  dhl_express: { token: "dhl_express", name: "DHL", url: (n) => `https://www.dhl.com/en/express/tracking.html?AWB=${enc(n)}` },
  canada_post: { token: "canada_post", name: "Canada Post", url: (n) => `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${enc(n)}` },
};

/** A Shippo provider name or a saved carrier ("USPS", "UPS", "FedEx", "DHL Express", "dhl_express"...). */
function fromName(name: string | null | undefined): Carrier | null {
  const key = (name ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!key) return null;
  if (key === "usps") return CARRIERS.usps;
  if (key === "ups") return CARRIERS.ups;
  if (key === "fedex") return CARRIERS.fedex;
  if (key.startsWith("dhl")) return CARRIERS.dhl_express;
  if (key === "canadapost" || key === "canada") return CARRIERS.canada_post;
  return null;
}

/** Tell the carrier from the tracking number's format. */
export function detectCarrier(tracking: string): Carrier {
  const n = tracking.replace(/\s+/g, "").toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return CARRIERS.ups;
  if (/^(\d{12}|\d{15})$/.test(n)) return CARRIERS.fedex;
  if (/^\d{10}$/.test(n)) return CARRIERS.dhl_express;
  return CARRIERS.usps;
}

/** The carrier for a label: the saved one when known, else from the number. */
export function trackingCarrier(tracking: string, savedCarrier?: string | null): Carrier {
  return fromName(savedCarrier) ?? detectCarrier(tracking);
}

/** A link to follow the package: the carrier's own page Shippo gave us, else one built for the carrier. */
export function trackingLink(tracking: string, savedCarrier?: string | null, savedUrl?: string | null): string {
  if (savedUrl && /^https:\/\//i.test(savedUrl)) return savedUrl;
  if (savedCarrier?.trim().toLowerCase() === "other") {
    return `https://parcelsapp.com/en/tracking/${enc(tracking)}`;
  }
  return trackingCarrier(tracking, savedCarrier).url(tracking);
}

/** The carrier and service of a Shippo rate (server only), so a bought label's tracking uses the right carrier. */
export async function shippoRateCarrier(rateId: string): Promise<{ provider: string | null; service: string | null }> {
  try {
    const res = await fetch(`https://api.goshippo.com/rates/${encodeURIComponent(rateId)}`, {
      headers: { "Authorization": `ShippoToken ${process.env.SHIPPO_API_TOKEN}` },
    });
    if (!res.ok) return { provider: null, service: null };
    const rate = await res.json() as { provider?: string; servicelevel?: { name?: string; token?: string } };
    return { provider: rate.provider ?? null, service: rate.servicelevel?.name ?? rate.servicelevel?.token ?? null };
  } catch {
    return { provider: null, service: null };
  }
}
