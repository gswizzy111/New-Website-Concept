import {
  CLAIM_STALE_MS, orderStatusBlock,
  type BagShipment, type BagShipmentStatus, type PackageSummary, type PackingResponse, type ShipRate,
} from "@/lib/intake/shipping/types";
import type { ShipCheckCard, ShipCheckResponse } from "@/lib/intake/tracking/types";
import { packCodePath } from "@/lib/intake/codes";
import { trackingLink } from "@/lib/tracking-carrier";

/**
 * The packing page (app/admin/receiving/pack/[code], one bag: "ship each bag
 * when done", owner, Nov 25 2026) in plain words, without the database: the
 * ship check by eye, the one thing to press next, what the API's answers
 * mean, and each package of the order. Pure: safe in client components and
 * tests (tests/intake/packing-view.test.ts). The ship queue and the admin
 * order page use the package words too.
 */

/** What the page shows beyond the packing API, read on the server (pack/[code]/_lib/load.ts). */
export type PackCardExtra = {
  /** A small photo (receiving photo, else the customer's, else the catalog picture), or null. */
  photo: string | null;
  /** "1999 · Base Set · #4/102" */
  details: string;
  /** The card page: /admin/receiving/card/<id>. */
  cardUrl: string;
};

export type PackLinks = {
  /** The admin order page. */
  order: string;
  /** The order page's Shipping card (#shipping). */
  shipping: string;
  /** The ship check page for this bag (Mark done, Taken out). */
  shipCheck: string;
  /** The scan landing of this bag (/admin/receiving/open/<Bag ID>). */
  open: string;
};

export type PackExtras = {
  customerEmail: string | null;
  /** "Philadelphia, PA, US" (city, state, country of the return address), or null. */
  shipTo: string | null;
  /** "USPS Priority Mail": the service the customer paid for, or null. */
  paidService: string | null;
  cards: Record<string, PackCardExtra>;
  links: PackLinks;
};

export const cardsText = (n: number) => `${n} ${n === 1 ? "card" : "cards"}`;

/** "Philadelphia, PA, US" from the order's return address (city, state, country), or null. */
export function shipToText(addr: Record<string, string | null | undefined> | null | undefined): string | null {
  if (!addr || typeof addr !== "object") return null;
  const country = addr.country || (addr.street1 ? "US" : "");
  const text = [addr.city, addr.state, country].map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).join(", ");
  return text || null;
}

// ─── The check ──────────────────────────────────────────────────────────

export type CheckTone = "ok" | "bad" | "warn" | "refunded";

/** A card's big ✓ / ✗ in words: "Done", "Still in CLAMP 07", "Not done", "Refunded". */
export function checkMark(card: Pick<ShipCheckCard, "status" | "location">): { tone: CheckTone; text: string } {
  if (card.status === "ok") return { tone: "ok", text: "Done" };
  if (card.status === "in_slot") return { tone: "warn", text: `Still in ${card.location?.name ?? "a holder"}` };
  if (card.status === "not_done") return { tone: "bad", text: "Not done" };
  return { tone: "refunded", text: "Refunded" };
}

/** The cards that go in the package, and the refunded ones (listed apart). */
export function splitCheck<C extends Pick<ShipCheckCard, "status">>(cards: readonly C[]): { live: C[]; refunded: C[] } {
  return { live: cards.filter((c) => c.status !== "refunded"), refunded: cards.filter((c) => c.status === "refunded") };
}

/** "All 3 done", "The card is done", "2 of 3 ready", "Every card was refunded". */
export function checkSummary(check: Pick<ShipCheckResponse, "cards">): string {
  const { live } = splitCheck(check.cards);
  if (live.length === 0) return "Every card was refunded";
  const ok = live.filter((c) => c.status === "ok").length;
  if (ok === live.length) return live.length === 1 ? "The card is done" : `All ${live.length} done`;
  return `${ok} of ${live.length} ready`;
}

// ─── Money, rates, services ─────────────────────────────────────────────

/** "$9.85", or null when unknown. */
export function money(cents: number | null | undefined): string | null {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/** "USPS Priority Mail" (carrier and service), or null. */
export function serviceName(s: { carrier?: string | null; service?: string | null } | null | undefined): string | null {
  const text = [s?.carrier, s?.service].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
  return text || null;
}

/** A Shippo rate's price: "$9.85" (US dollars), "12.40 CAD" otherwise. */
export function ratePrice(r: Pick<ShipRate, "amount" | "currency">): string {
  const n = Number.parseFloat(r.amount);
  if (!Number.isFinite(n)) return r.amount;
  return !r.currency || r.currency === "USD" ? `$${n.toFixed(2)}` : `${n.toFixed(2)} ${r.currency}`;
}

/** "USPS Priority Mail · 2 days · $9.85" */
export function rateText(r: ShipRate): string {
  const days = typeof r.days === "number" && r.days > 0 ? `${r.days} ${r.days === 1 ? "day" : "days"}` : null;
  return [serviceName({ carrier: r.provider, service: r.service }), days, ratePrice(r)].filter(Boolean).join(" · ");
}

/** The rate one tap buys: the one the customer paid for, else the cheapest (rates come cheapest first). */
export function defaultRate(rates: readonly ShipRate[]): ShipRate | null {
  return rates.find((r) => r.paid) ?? rates[0] ?? null;
}

/** Under "Buy return label": what one tap buys, before the rates are asked for. */
export function oneTapText(paidService: string | null): string {
  return paidService
    ? `Buys ${paidService}, what the customer paid for.`
    : "Buys the cheapest rate (the order has no shipping service saved).";
}

// ─── What to press next ─────────────────────────────────────────────────

/** A purchase that started more than 2 minutes ago and never finished. */
export function isStaleClaim(s: Pick<BagShipment, "status" | "claimedAt"> | null | undefined, now: number): boolean {
  if (!s || s.status !== "claimed") return false;
  const t = Date.parse(s.claimedAt);
  return Number.isFinite(t) && now - t >= CLAIM_STALE_MS;
}

export type PackFix = { href: string; text: string; external?: boolean };

export type PackState =
  | { kind: "buy" }
  | { kind: "print_and_ship"; shipment: BagShipment }
  | { kind: "shipped"; shipment: BagShipment; delivered: boolean }
  | {
      kind: "wait";
      reason: string;
      stale: boolean;
      /** A label Shippo sold that the bag didn't keep: show it and offer "Save this label" (POST {}: buys nothing). */
      unsavedLabel: string | null;
    }
  | { kind: "blocked"; reason: string; fixes: PackFix[] };

/** Where to fix what stops the label, in the order the API checks it (lib/intake/shipping/bag-shipments.ts loadPacking). */
export function blockFixes(p: Pick<PackingResponse, "shipmentsReady" | "orderLabel" | "order" | "check">, links: PackLinks): PackFix[] {
  if (!p.shipmentsReady) return [];
  if (p.orderLabel) {
    return [
      { href: p.orderLabel.labelUrl, text: "Open the order's label", external: true },
      { href: links.shipping, text: "Open the order's shipping" },
    ];
  }
  if (orderStatusBlock(p.order.status)) return [{ href: links.order, text: "Open the order" }];
  if (!p.check.ready) {
    // Every card refunded: nothing to fix here
    if (splitCheck(p.check.cards).live.length === 0) return [{ href: links.order, text: "Open the order" }];
    return [
      { href: links.shipCheck, text: "Fix it on the ship check" },
      { href: links.open, text: "Open the bag" },
    ];
  }
  if (!p.order.hasAddress) return [{ href: links.order, text: "Add the address on the order page" }];
  return [{ href: links.order, text: "Open the order" }];
}

/** The page's one step, from the API's `next`. */
export function packState(p: PackingResponse, links: PackLinks, now: number): PackState {
  const s = p.shipment;
  if (p.next === "buy") return { kind: "buy" };
  if (p.next === "print_and_ship" && s) return { kind: "print_and_ship", shipment: s };
  if ((p.next === "shipped" || p.next === "delivered") && s) return { kind: "shipped", shipment: s, delivered: p.next === "delivered" };
  if (p.next === "wait") {
    const unsaved = p.unsavedLabel?.labelUrl;
    return {
      kind: "wait",
      reason: p.blocked ?? "This bag's label is being bought right now. Wait a few seconds, then try again.",
      stale: isStaleClaim(s, now),
      unsavedLabel: typeof unsaved === "string" && /^https?:\/\//i.test(unsaved) ? unsaved : null,
    };
  }
  return { kind: "blocked", reason: p.blocked ?? "This bag can't ship yet.", fixes: blockFixes(p, links) };
}

// ─── The API's answers ──────────────────────────────────────────────────

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export type BuyOutcome =
  | { ok: true; message: string; shipment: BagShipment }
  | {
      ok: false;
      message: string;
      /** 409 staleClaim: offer "Try again" with retryStaleClaim (after the warning). */
      stale: boolean;
      /** 500 unsaved: the label Shippo sold but the bag didn't keep: show it, never buy another. */
      labelUrl: string | null;
    };

/** POST /api/admin/intake/bags/<id>/ship-label's answer for the page (errors shown as the API words them). */
export function buyOutcome(status: number, body: unknown): BuyOutcome {
  const b = obj(body);
  if (status === 200 && b.shipment && typeof b.shipment === "object") {
    return { ok: true, message: typeof b.message === "string" && b.message ? b.message : "Label bought.", shipment: b.shipment as BagShipment };
  }
  return {
    ok: false,
    message: typeof b.error === "string" && b.error ? b.error : `Couldn't buy the label (HTTP ${status}). Nothing was changed on this page: reload to check.`,
    stale: b.staleClaim === true,
    labelUrl: typeof b.labelUrl === "string" && /^https?:\/\//i.test(b.labelUrl) ? b.labelUrl : null,
  };
}

/** POST /api/admin/intake/bags/<id>/shipped's answer: the ready-to-show sentence, or the error as is. */
export function shipOutcome(status: number, body: unknown): { ok: boolean; message: string } {
  const b = obj(body);
  if (status === 200 && b.shipment) {
    return { ok: true, message: typeof b.message === "string" && b.message ? b.message : "Marked shipped." };
  }
  return { ok: false, message: typeof b.error === "string" && b.error ? b.error : `Couldn't mark it shipped (HTTP ${status}). Reload to check.` };
}

/** GET's error (the page then keeps what it showed). */
export function readError(status: number, body: unknown): string {
  const b = obj(body);
  return typeof b.error === "string" && b.error ? b.error : `Couldn't check this bag again (HTTP ${status}).`;
}

/** Mark shipped's question: says the customer will be emailed the tracking. */
export function markShippedQuestion(email: string | null): string {
  return email
    ? `Mark this bag shipped? The customer will be emailed the tracking number (${email}).`
    : "Mark this bag shipped? This order has no email address, so the customer won't be emailed the tracking.";
}

/** Before buying again after a purchase that never finished. */
export const STALE_RETRY_QUESTION =
  "Only try again if Shippo's label history has no label for this bag. If the first purchase did go through, trying again buys a second label and you pay for both.";

/** "Nov 25, 3:10 PM" (New York), or null. */
export function whenText(iso: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

/** The carrier's tracking page for a package (the one Shippo gave, else one built from the number), or null. */
export function trackingHref(s: { trackingNumber: string | null; carrier?: string | null; trackingUrl?: string | null }): string | null {
  return s.trackingNumber ? trackingLink(s.trackingNumber, s.carrier ?? null, s.trackingUrl ?? null) : null;
}

// ─── The order's packages ───────────────────────────────────────────────

export type PackageTone = "done" | "label" | "ready" | "work";

/** A package's state in words: "Shipped", "Label bought, not shipped", "Ready to pack", "2 of 3 done". */
export function packageStatus(p: { status: BagShipmentStatus | "none"; cardCount: number; doneCount: number }): { text: string; tone: PackageTone } {
  if (p.status === "delivered") return { text: "Delivered", tone: "done" };
  if (p.status === "shipped") return { text: "Shipped", tone: "done" };
  if (p.status === "purchased") return { text: "Label bought, not shipped", tone: "label" };
  if (p.status === "claimed") return { text: "Label being bought", tone: "label" };
  if (p.cardCount > 0 && p.doneCount >= p.cardCount) return { text: "Ready to pack", tone: "ready" };
  return { text: `${p.doneCount} of ${p.cardCount} done`, tone: "work" };
}

export type PackageRow = {
  bagId: string;
  bagCode: string;
  tierName: string;
  status: { text: string; tone: PackageTone };
  trackingNumber: string | null;
  /** Its packing page. */
  href: string;
  /** The bag this page is about. */
  here: boolean;
};

export function packageRows(packages: readonly PackageSummary[], currentBagId: string | null = null): PackageRow[] {
  return packages.map((p) => ({
    bagId: p.bagId, bagCode: p.bagCode, tierName: p.tierName, status: packageStatus(p),
    trackingNumber: p.trackingNumber, href: packCodePath(p.bagCode), here: p.bagId === currentBagId,
  }));
}

/** "1 of 2 packages shipped" (shipped or delivered). */
export function packagesHeadline(packages: readonly Pick<PackageSummary, "status">[]): string {
  const sent = packages.filter((p) => p.status === "shipped" || p.status === "delivered").length;
  return `${sent} of ${packages.length} ${packages.length === 1 ? "package" : "packages"} shipped`;
}
