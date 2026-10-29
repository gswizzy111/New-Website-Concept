import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe, invoiceSubscriptionId } from "@/lib/stripe";
import { getSubscriptionPriceCents } from "@/lib/store-config";

// Runs daily at 8am UTC via netlify/functions/cron-subscription-orders.mjs.
// Finds any subscription invoices paid in the last 48 hours that don't yet
// have a shop_order, and creates them. Acts as a safety net if the
// invoice.paid webhook missed an event.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const since = Math.floor(Date.now() / 1000) - 48 * 60 * 60;

  // Page through all invoices paid in last 48h
  let created = 0;
  // Database errors: logged with the invoice or subscription, and reported in
  // the answer, so a failed run shows in the log instead of passing as done
  let failed = 0;
  let startingAfter: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const invoices = await stripe.invoices.list({
      status: "paid",
      created: { gte: since },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const invoice of invoices.data as Stripe.Invoice[]) {
      // The first month's kit order comes from checkout.session.completed
      if (invoice.billing_reason === "subscription_create") continue;
      const subscriptionId = invoiceSubscriptionId(invoice);
      if (!subscriptionId) continue;

      // Already have a shop_order for this invoice?
      const { data: existing, error: existingError } = await admin
        .from("shop_orders")
        .select("id")
        .eq("stripe_session_id", invoice.id)
        .maybeSingle();
      if (existingError) {
        console.error(`[cron/subscription-orders] could not look up the kit order for invoice ${invoice.id}:`, existingError.message);
        failed++;
        continue;
      }
      if (existing) continue;

      // Look up subscriber record
      const { data: sub, error: subError } = await admin
        .from("subscriptions")
        .select("*")
        .eq("stripe_subscription_id", subscriptionId)
        .maybeSingle();
      if (subError) {
        console.error(`[cron/subscription-orders] could not look up subscription ${subscriptionId} (invoice ${invoice.id}):`, subError.message);
        failed++;
        continue;
      }
      if (!sub) continue;

      // What Stripe charged; the Kit Club price is only a fallback
      const cronPriceCents = typeof invoice.amount_paid === "number" ? invoice.amount_paid : await getSubscriptionPriceCents();
      // One kit order per invoice: if the invoice.paid webhook saves it at the
      // same moment, theirs stands and nothing is added here
      const { data: inserted, error: insertError } = await admin.from("shop_orders").upsert(
        {
          stripe_session_id: invoice.id,
          customer_name: sub.customer_name,
          customer_email: sub.customer_email,
          customer_phone: sub.customer_phone ?? "",
          shipping_address: sub.shipping_address,
          items: [{ product_id: "subscription", product_name: "Monthly Kit Club", quantity: 1, price_cents: cronPriceCents }],
          subtotal_cents: cronPriceCents,
          shipping_cents: 0,
          total_cents: cronPriceCents,
          status: "paid",
        },
        { onConflict: "stripe_session_id", ignoreDuplicates: true },
      ).select("id");
      if (insertError) {
        console.error(`[cron/subscription-orders] kit order not saved for invoice ${invoice.id}:`, insertError.message);
        failed++;
        continue;
      }
      if (inserted?.length) created++;
    }

    if (!invoices.has_more) break;
    startingAfter = invoices.data[invoices.data.length - 1]?.id;
  }

  // Mark subscriptions cancelled in Stripe as cancelled here too, in case the
  // customer.subscription.deleted webhook never arrived
  let cancelled = 0;
  const { data: activeSubs, error: activeError } = await admin
    .from("subscriptions")
    .select("id, stripe_subscription_id")
    .eq("status", "active");
  if (activeError) {
    console.error("[cron/subscription-orders] could not read active subscriptions:", activeError.message);
    failed++;
  }
  for (const sub of activeSubs ?? []) {
    if (!sub.stripe_subscription_id) continue;
    try {
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
      if (stripeSub.status === "canceled") {
        const { error: cancelError } = await admin
          .from("subscriptions")
          .update({
            status: "cancelled",
            cancelled_at: new Date((stripeSub.canceled_at ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
          })
          .eq("id", sub.id);
        if (cancelError) {
          console.error(`[cron/subscription-orders] could not mark subscription ${sub.stripe_subscription_id} cancelled:`, cancelError.message);
          failed++;
        } else {
          cancelled++;
        }
      }
    } catch (err) {
      console.error("[cron/subscription-orders] could not check", sub.stripe_subscription_id, err);
    }
  }

  const summary = `created ${created} kit order(s), marked ${cancelled} subscription(s) cancelled`;
  if (failed) {
    console.error(`[cron/subscription-orders] ${summary}; ${failed} database error(s), see above`);
    return Response.json({ ok: false, created, cancelled, failed }, { status: 500 });
  }
  console.log(`[cron/subscription-orders] ${summary}`);
  return Response.json({ ok: true, created, cancelled });
}
