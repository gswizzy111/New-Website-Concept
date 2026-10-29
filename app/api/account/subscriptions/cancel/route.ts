import { createAdminClient } from "@/lib/supabase/admin";
import { likeExact } from "@/lib/like-exact";
import { cancelKitClubSubscription, signedInEmail, type KitClubSubscription } from "@/lib/kit-club-link";

// Cancels the signed-in customer's Kit Club subscription (their account's
// confirmed email). Same steps as the manage page: Stripe first, then the
// record, and the dated confirmation email only when this request's Stripe
// cancel went through.
export async function POST() {
  const email = await signedInEmail();
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await createAdminClient()
    .from("subscriptions")
    .select("id, stripe_subscription_id, status, customer_email, customer_name, created_at, cancelled_at")
    .ilike("customer_email", likeExact(email))
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) console.error("Account Kit Club cancel lookup failed:", error.message);
  const sub = (data?.[0] ?? null) as KitClubSubscription | null;

  if (!sub) return Response.json({ error: "No active subscription found." }, { status: 404 });

  const result = await cancelKitClubSubscription(sub);
  if ("error" in result) return Response.json({ error: result.error }, { status: 500 });
  // The cancellation stands even when its email didn't go out
  // (cancelKitClubSubscription logs that)
  return Response.json({ ok: true });
}
