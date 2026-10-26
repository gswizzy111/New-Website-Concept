import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import {
  cancelKitClubSubscription,
  claimKitClubToken,
  releaseKitClubToken,
  signedInEmail,
  type KitClubSubscription,
} from "@/lib/kit-club-link";

const Schema = z.object({
  /** The emailed manage link's token; without it, the signed-in account's email is used */
  token: z.string().max(200).optional(),
  subscriptionId: z.string().uuid(),
});

const LINK_EXPIRED = "This link has expired or was already used. Enter your email to get a new one.";

// Cancels a Kit Club subscription for someone who proved the inbox: the
// emailed link (used up by the cancellation) or a signed-in account with a
// confirmed email that matches the subscription.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const { token, subscriptionId } = parsed.data;
  let email: string | null;
  if (token) {
    email = await claimKitClubToken(token);
    if (!email) return Response.json({ error: LINK_EXPIRED, code: "LINK_EXPIRED" }, { status: 403 });
  } else {
    email = await signedInEmail();
    if (!email) return Response.json({ error: "Please use the link we emailed you." }, { status: 401 });
  }
  // The link is given back whenever nothing was cancelled
  const refuse = async (error: string, status: number) => {
    if (token) await releaseKitClubToken(token);
    return Response.json({ error }, { status });
  };

  // Verify the subscription belongs to this email
  const { data, error } = await createAdminClient()
    .from("subscriptions")
    .select("id, stripe_subscription_id, status, customer_email, customer_name, created_at, cancelled_at")
    .eq("id", subscriptionId)
    .maybeSingle();
  const sub = data as KitClubSubscription | null;
  if (error) console.error("Kit Club cancel lookup failed:", error.message);
  if (error || !sub || sub.customer_email.trim().toLowerCase() !== email) {
    return refuse("Subscription not found", 404);
  }
  if (sub.status === "cancelled") return refuse("Already cancelled", 400);

  const result = await cancelKitClubSubscription(sub);
  if ("error" in result) return refuse(result.error, 500);
  // The cancellation stands even when its email didn't go out
  // (cancelKitClubSubscription logs that)
  return Response.json({ ok: true });
}
