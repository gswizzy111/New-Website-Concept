import { stripe } from "@/lib/stripe";
import { CHECKOUT_SESSION_ID } from "@/lib/tracking-guard";

/**
 * What a Stripe return page (kits, gift cards, Kit Club) reads from its
 * ?session_id=: the ID when it looks like one, and the amount paid when the
 * checkout is complete, for the Meta Purchase event (components/purchase-pixel.tsx).
 * `complete` is null when there is no ID or the lookup failed. The page's
 * first script takes the ID out of the address before analytics run
 * (lib/tracking-guard.ts), so a reload has none.
 */
export async function readCheckoutReturn(raw: string | undefined, page: string) {
  const sessionId = raw && CHECKOUT_SESSION_ID.test(raw) ? raw : undefined;
  let amountCents: number | null = null;
  let currency = "usd";
  let complete: boolean | null = null;
  if (sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      complete = session.status === "complete";
      // Only a completed checkout is a purchase
      if (complete && session.amount_total != null) {
        amountCents = session.amount_total;
        currency = session.currency ?? "usd";
      }
    } catch (err) {
      console.error(`${page}: Stripe session lookup failed:`, err instanceof Error ? err.message : err);
    }
  }
  return { sessionId, amountCents, currency, complete };
}
