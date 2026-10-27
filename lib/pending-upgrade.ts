import { stripe } from "@/lib/stripe";
import { UPGRADE_LADDER, type RestorationTierId } from "@/lib/restoration-tiers";

/** A Checkout session lasts at most 24 hours, so a paid upgrade is at most this old when it is paid. */
const LOOKBACK_SECONDS = 24 * 60 * 60;
/** The order page and the upgrade route wait no longer than this for Stripe. */
const TIMEOUT_MS = 4000;

const ladderRank = (tier: string | null | undefined) => UPGRADE_LADDER.indexOf(tier as RestorationTierId);

/**
 * Whether the order has a tier upgrade that was paid but isn't on the order
 * yet: a completed, paid upgrade checkout for this order from the last day, to
 * a tier above the order's. The webhook moves the order to that tier, so once
 * it has run the checkout no longer counts. Offering or opening another
 * upgrade before then would let the customer pay twice.
 *
 * Found by the order's email, which the upgrade route locks in Checkout. When
 * Stripe can't be asked in time the answer is null (unknown), and the caller
 * decides: the webhook still catches a second payment for the same upgrade
 * (TIER_UPGRADE_INCOMPLETE).
 */
export async function hasUnappliedUpgrade(order: { id: string; customer_email: string | null; restoration_tier: string | null }): Promise<boolean | null> {
  const current = ladderRank(order.restoration_tier);
  const email = order.customer_email?.trim();
  // Not on the ladder, or at its top: nothing to upgrade to
  if (current < 0 || current >= UPGRADE_LADDER.length - 1 || !email) return false;
  const since = Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS;

  const lookup = async () => {
    const emails = [...new Set([email, email.toLowerCase()])];
    const pages = await Promise.all(emails.map((e) =>
      stripe.checkout.sessions.list({ customer_details: { email: e }, status: "complete", created: { gte: since }, limit: 100 })));
    return pages.some((page) => page.data.some((s) =>
      s.payment_status === "paid"
      && s.metadata?.type === "tier_upgrade"
      && s.metadata?.order_id === order.id
      && ladderRank(s.metadata?.new_tier) > current));
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), TIMEOUT_MS); }),
    ]);
  } catch (err) {
    console.error("Paid upgrade lookup failed:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
