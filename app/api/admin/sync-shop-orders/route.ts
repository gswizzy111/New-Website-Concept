import { addressFromSession } from "@/lib/shipping-address";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type Stripe from "stripe";
import { isAdmin } from "@/lib/admin-auth";

// Sessions newer than this are left to the Stripe webhook. It creates the kit
// order and also buys the label, takes stock and gift-card balance and sends the
// emails, and Stripe keeps retrying it for up to 3 days after payment, which can
// come up to 24 hours after the session was created. A row made here first
// would make it skip all of that (it treats an existing row as already handled).
const WEBHOOK_WINDOW_SECONDS = 4 * 86_400;
// How far back the sync looks, so a press stays quick as Stripe's history grows
// (an older gap has to be filled by hand)
const LOOKBACK_SECONDS = 60 * 86_400;

type MetaItem = { id: string; qty: number };

/** The table isn't there yet (supabase/migrations/20261027_webhook.sql not applied). */
function missingTable(err: { code?: string } | null | undefined) {
  return !!err && ["PGRST205", "42P01"].includes(err.code ?? "");
}

function metaItems(session: Stripe.Checkout.Session): MetaItem[] {
  try {
    const items = JSON.parse(session.metadata?.items ?? "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    console.error("[sync kit orders] unreadable items metadata on", session.id);
    return [];
  }
}

export async function POST() {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = Math.floor(Date.now() / 1000);
  const createdBefore = now - WEBHOOK_WINDOW_SECONDS;
  const createdAfter = now - LOOKBACK_SECONDS;

  // Page through completed Stripe sessions between the lookback and the webhook
  // window. Each page's missing orders are saved before the next page is read,
  // so a press that runs out of time keeps what it already added.
  let synced = 0;
  let startingAfter: string | undefined;

  while (true) {
    const sessions = await stripe.checkout.sessions.list({
      limit: 100,
      status: "complete",
      created: { gte: createdAfter, lt: createdBefore },
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    const shopSessions = sessions.data.filter((s) =>
      s.metadata?.type === "shop" && (s.payment_status === "paid" || s.payment_status === "no_payment_required"));

    if (shopSessions.length > 0) {
      // Only this page's sessions are looked up, so the check never runs into
      // the API's 1,000-row limit
      const { data: existing, error: existingErr } = await admin
        .from("shop_orders")
        .select("stripe_session_id")
        .in("stripe_session_id", shopSessions.map((s) => s.id));
      if (existingErr) {
        console.error("Sync lookup error:", existingErr);
        return Response.json({ error: existingErr.message }, { status: 500 });
      }
      const existingIds = new Set((existing ?? []).map((o) => o.stripe_session_id));

      // A session the webhook has claimed (stripe_webhook_claims), finished,
      // still running or let go for Stripe's next try, is the webhook's: a bare
      // row made here would make its retry skip the label, stock and emails
      const { data: claims, error: claimsErr } = await admin
        .from("stripe_webhook_claims")
        .select("stripe_session_id")
        .in("stripe_session_id", shopSessions.map((s) => s.id));
      if (claimsErr && !missingTable(claimsErr)) {
        console.error("Sync claims lookup error:", claimsErr);
        return Response.json({ error: claimsErr.message, synced }, { status: 500 });
      }
      for (const c of claims ?? []) existingIds.add(c.stripe_session_id);

      const missing = shopSessions.filter((s) => !existingIds.has(s.id));

      // Fetch product names from DB
      const productIds = [...new Set(missing.flatMap((s) => metaItems(s).map((i) => i.id).filter(Boolean)))];
      const { data: products } = productIds.length > 0
        ? await admin.from("products").select("id, name, price_cents").in("id", productIds)
        : { data: [] };
      const productMap = Object.fromEntries((products ?? []).map((p) => [p.id, p]));

      const toInsert: Record<string, unknown>[] = [];
      for (const session of missing) {
        const itemsForDb = metaItems(session).map((i) => ({
          product_id: i.id,
          product_name: productMap[i.id]?.name ?? "Unknown product",
          quantity: i.qty,
          price_cents: productMap[i.id]?.price_cents ?? 0,
        }));

        // The address checked in the cart (older orders: the one Stripe collected)
        const shippingAddress = addressFromSession(session);
        const isInternational = session.metadata?.is_international === "true";

        const totalCents = session.amount_total ?? 0;
        // Same as the webhook: live-rate checkouts record what shipping cost;
        // older ones were $5.99 in the US (abroad: what the total holds beyond the items)
        const kitShippingCents = parseInt(session.metadata?.kit_shipping_cents ?? "", 10);
        const shippingCents = Number.isFinite(kitShippingCents)
          ? kitShippingCents
          : isInternational
            ? totalCents - (session.amount_subtotal ?? totalCents - 599)
            : 599;

        toInsert.push({
          stripe_session_id: session.id,
          customer_name: session.metadata?.customer_name ?? session.customer_details?.name ?? "",
          customer_email: session.customer_email ?? session.customer_details?.email ?? "",
          customer_phone: session.metadata?.customer_phone ?? "",
          shipping_address: shippingAddress,
          items: itemsForDb,
          subtotal_cents: Math.max(0, totalCents - shippingCents),
          shipping_cents: shippingCents,
          total_cents: totalCents,
          status: "paid",
          affiliate_code: session.metadata?.affiliate_code || null,
        });
      }

      if (toInsert.length > 0) {
        // If the webhook saves one of these meanwhile (an event resent from the
        // Stripe Dashboard), its row wins and this one is skipped
        const { data: inserted, error } = await admin
          .from("shop_orders")
          .upsert(toInsert, { onConflict: "stripe_session_id", ignoreDuplicates: true })
          .select("id");
        if (error) {
          console.error("Sync insert error:", error);
          return Response.json({ error: error.message, synced }, { status: 500 });
        }
        synced += inserted?.length ?? 0;
      }
    }

    if (!sessions.has_more) break;
    startingAfter = sessions.data[sessions.data.length - 1]?.id;
    if (synced >= 500) break; // safety cap
  }

  return Response.json({ synced });
}
