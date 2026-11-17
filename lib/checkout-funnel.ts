import { fbq } from "@/lib/pixel";
import { isInAppBrowser } from "@/lib/in-app-browser";

/**
 * Checkout funnel tracking (browser side). Every checkout reports where the
 * customer is, so the admin can see which step people leave at.
 *
 * Each call goes three places:
 * 1. Our own database, through POST /api/checkout/funnel (counts only: the
 *    flow, the event, the step, a random ID for this browser tab, phone or
 *    desktop, and whether it is an in-app browser; never a name, email,
 *    address or card detail).
 * 2. Google Analytics, as the event `checkout_<event>`, when GA is on.
 * 3. The Meta pixel, as the custom event `CheckoutStep`, when the pixel is on
 *    (lib/pixel.ts already skips private pages and Global Privacy Control).
 *
 * Never throws and never waits: tracking must not slow or break a checkout.
 */
export type CheckoutFlow = "restoration" | "prep" | "kits" | "gift_card" | "kit_club";

export type CheckoutEvent =
  /** A step (or the checkout page itself) came into view. */
  | "step_view"
  /** A card photo finished uploading. */
  | "photo_added"
  /** A card photo failed to upload. */
  | "photo_failed"
  /** Continue / Sign was pressed but something required is missing or wrong (`code` says what). */
  | "blocked"
  /** Passed every check in the browser and was sent to the server. */
  | "submit"
  /** The server answered with a Stripe address; leaving for payment. */
  | "redirect"
  /** The server refused the checkout (`code` is the server's error code). */
  | "rejected"
  /** The "open this in Safari or Chrome" notice was shown. */
  | "in_app_notice";

export type CheckoutEventData = {
  /** Step number within the flow (restoration 1-4; prep 1; kits: cart 1, upsell 2, checkout 3). */
  step?: number;
  /** Short machine code, e.g. "missing_fields", "TIER_FULL", "invalid_email". Letters, digits, _ and - only. */
  code?: string;
  /** Restoration tier id, when one applies. */
  tier?: string;
  /** Number of cards (or items) in the order so far. */
  cards?: number;
};

const SID_KEY = "cd_checkout_sid";

/** A random ID for this browser tab, so steps can be joined into one visit. Not tied to a person. */
function tabId(): string {
  try {
    let id = sessionStorage.getItem(SID_KEY);
    if (!id) {
      id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      sessionStorage.setItem(SID_KEY, id);
    }
    return id;
  } catch {
    return "none";
  }
}

export function trackCheckout(flow: CheckoutFlow, event: CheckoutEvent, data: CheckoutEventData = {}): void {
  if (typeof window === "undefined") return;
  try {
    const payload = {
      flow,
      event,
      ...data,
      sid: tabId(),
      device: window.matchMedia("(max-width: 767px)").matches ? "phone" : "desktop",
      inApp: isInAppBrowser(),
    };
    const body = JSON.stringify(payload);
    const sent =
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon("/api/checkout/funnel", new Blob([body], { type: "application/json" }));
    if (!sent) {
      fetch("/api/checkout/funnel", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  } catch {
    // ignore: tracking never breaks checkout
  }
  try {
    const w = window as unknown as { gtag?: (...args: unknown[]) => void; __noTrack?: boolean };
    if (w.__noTrack !== true && typeof w.gtag === "function") {
      w.gtag("event", `checkout_${event}`, { checkout_flow: flow, ...data });
    }
  } catch {
    // ignore
  }
  try {
    fbq("trackCustom", "CheckoutStep", { flow, event, ...data });
  } catch {
    // ignore
  }
}
