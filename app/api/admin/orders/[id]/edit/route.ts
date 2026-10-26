import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { isAdmin } from "@/lib/admin-auth";

const BodySchema = z.object({
  // Only sent to reprice a manual order (no Stripe payment). Orders paid
  // through Stripe keep the totals and service lines they were charged.
  price_per_card_cents: z.number().int().positive().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().nullable().optional(),
  cards: z.array(z.object({
    id: z.string().nullable(),
    name: z.string().min(1),
  })).min(1),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: orderId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
  }

  const d = parsed.data;
  const admin = createAdminClient();

  const { data: order } = await admin.from("orders").select("id, stripe_session_id").eq("id", orderId).maybeSingle();
  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
  const paidThroughStripe = !!order.stripe_session_id;
  if (paidThroughStripe && d.price_per_card_cents !== undefined) {
    return Response.json({ error: "This order was paid through Stripe, so its prices and total can't be changed here. Use Refund to give money back." }, { status: 409 });
  }

  const { data: existingCards, error: cardsErr } = await admin
    .from("cards")
    .select("id, completed, status, cleaning_started_at, slab_opening_started_at, refunded_cents")
    .eq("order_id", orderId);
  if (cardsErr) return Response.json({ error: "Couldn't read the order's cards. Nothing was changed." }, { status: 500 });

  const currentIds = new Set((existingCards ?? []).map((c) => c.id));
  if (d.cards.some((c) => c.id && !currentIds.has(c.id))) {
    return Response.json({ error: "A card in the list is no longer on this order. Reload the page and try again." }, { status: 409 });
  }
  const keptIds = new Set(d.cards.map((c) => c.id).filter((cardId): cardId is string => !!cardId));
  const removed = (existingCards ?? []).filter((c) => !keptIds.has(c.id));

  if (removed.length > 0) {
    if (paidThroughStripe) {
      return Response.json({ error: "Cards on an order paid through Stripe stay on it. To cancel one, use its Refund button." }, { status: 409 });
    }
    // A card with a signed authorization stays on the order (refund it instead)
    const { count: signed, error: sigErr } = await admin.from("signatures").select("id", { count: "exact", head: true }).in("order_item_id", removed.map((c) => c.id));
    if (sigErr) return Response.json({ error: "Couldn't check the cards' signatures. Nothing was changed." }, { status: 500 });
    if ((signed ?? 0) > 0) {
      return Response.json({ error: "A card you removed has a signed authorization, so it stays on the order. Use its Refund button instead." }, { status: 409 });
    }
    // ...and so does one that's finished, being worked on, or refunded
    if (removed.some((c) => c.completed || c.cleaning_started_at || c.slab_opening_started_at || c.status === "refunded" || (c.refunded_cents ?? 0) > 0)) {
      return Response.json({ error: "A card you removed is done, has work started, or was refunded, so it stays on the order." }, { status: 409 });
    }
  }

  const reprice = d.price_per_card_cents !== undefined;
  const totalCents = reprice ? d.price_per_card_cents! * d.cards.length : null;

  // Notes always; totals only when a manual order is repriced
  const { error: orderErr } = await admin
    .from("orders")
    .update({
      customer_notes: d.notes ?? null,
      ...(reprice ? { subtotal_cents: totalCents, total_cents: totalCents } : {}),
    })
    .eq("id", orderId);

  if (orderErr) {
    console.error("Failed to update order:", orderErr);
    return Response.json({ error: "Failed to update order" }, { status: 500 });
  }

  // Update due_date separately — silently skipped if the column doesn't exist yet
  // Run: alter table orders add column if not exists due_date date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("orders").update({ due_date: d.due_date ?? null }).eq("id", orderId);

  const problems: string[] = [];

  // A manual order's single price line follows its new price and card count
  if (reprice) {
    const { error: delErr } = await admin.from("order_services").delete().eq("order_id", orderId);
    const { error: insErr } = delErr ? { error: null } : await admin.from("order_services").insert({
      order_id: orderId,
      service_name: "Manual Restoration Order",
      price_cents: d.price_per_card_cents!,
      quantity: d.cards.length,
    });
    if (delErr || insErr) problems.push("the price line");
  }

  // Sync cards: rename the ones kept (keeping their photos and details), add new
  // ones, remove the ones taken out of the list
  if (removed.length > 0) {
    const { error } = await admin.from("cards").delete().in("id", removed.map((c) => c.id)).eq("order_id", orderId);
    if (error) problems.push("removing cards");
  }
  for (const c of d.cards) {
    if (c.id && keptIds.has(c.id)) {
      const { error } = await admin.from("cards").update({ card_name: c.name }).eq("id", c.id).eq("order_id", orderId);
      if (error) problems.push(`renaming ${c.name}`);
    }
  }
  const newCards = d.cards.filter((c) => !c.id);
  if (newCards.length > 0) {
    const { error } = await admin.from("cards").insert(
      newCards.map((c) => ({
        order_id: orderId,
        card_name: c.name,
        photo_urls: [],
        service_ids: [],
      }))
    );
    if (error) problems.push("adding cards");
  }

  // Log the change
  await admin.from("order_events").insert({
    order_id: orderId,
    event_type: "order_edited",
    description: reprice
      ? `Order updated by admin — ${d.cards.length} card${d.cards.length !== 1 ? "s" : ""} @ $${(d.price_per_card_cents! / 100).toFixed(2)}/card — new total $${(totalCents! / 100).toFixed(2)}`
      : `Order updated by admin — ${d.cards.length} card${d.cards.length !== 1 ? "s" : ""}, total unchanged`,
    is_customer_visible: false,
  });

  if (problems.length) {
    return Response.json({ error: `Saved, except ${problems.join(", ")}. Reload the page and check the order.` }, { status: 500 });
  }
  return Response.json({ ok: true });
}
