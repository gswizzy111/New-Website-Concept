import { after } from "next/server";
import { recordSmsConsent } from "@/lib/sms/consents";
import type { OrderSmsConsent } from "@/lib/sms-checkout";

/**
 * Saves an order's text-updates consent (from orderSmsConsent() in
 * lib/sms-checkout.ts) after the response has gone out (Next.js after()), so
 * it never holds up or fails the order. recordSmsConsent never throws and
 * does nothing in preview mode; a failure (for one, the SMS migration not
 * applied yet) is logged and ignored: the order simply gets no texts.
 */
export function recordOrderSmsConsentLater(consent: OrderSmsConsent | null): void {
  if (!consent) return;
  const task = async () => {
    try {
      const { error } = await recordSmsConsent(consent);
      if (error) console.error(`[sms] order ${consent.orderId}: text consent not saved:`, error);
    } catch (err) {
      console.error(`[sms] order ${consent.orderId}: text consent not saved:`, err instanceof Error ? err.message : err);
    }
  };
  try {
    after(task);
  } catch (err) {
    // Not inside a request (never expected in a route): still save it, unawaited
    console.error("[sms] after() unavailable, saving the text consent now:", err instanceof Error ? err.message : err);
    void task();
  }
}
