import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { shippo } from "@/lib/shippo";
import { MAX_CARD_PHOTOS } from "@/lib/site-config";
import { applyDbOverride, getCardPriceCents, RESTORATION_TIERS, type RestorationTierId } from "@/lib/restoration-tiers";
import { formatCurrency } from "@/lib/utils";
import { z } from "zod";

const CardPatch = z.object({
  card_name: z.string().min(1).max(200),
  // The card editor sends null for blank fields
  card_set: z.string().max(200).nullable().optional(),
  card_year: z.string().max(10).nullable().optional(),
  card_number: z.string().max(50).nullable().optional(),
  estimated_value_cents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  // Checked below: new photos must be our own uploads, and no more than
  // MAX_CARD_PHOTOS (cards from before the limit may keep the extra photos
  // they already have, but can't add more)
  photo_urls: z.array(z.string().max(2000)).max(20).nullable(),
});

const Body = z.object({
  cards: z.array(CardPatch.extend({ id: z.string().uuid() })).max(200),
});

type ExistingCard = {
  id: string;
  card_name: string | null;
  card_set: string | null;
  card_year: string | null;
  card_number: string | null;
  estimated_value_cents: number | null;
  notes: string | null;
  photo_urls: string[] | null;
  tier: string | null;
  status: string | null;
  cleaning_started_at: string | null;
  slab_opening_started_at: string | null;
};

// Prep pricing (app/api/prep/checkout/route.ts): a flat fee below $1,500,
// 2% of the declared value from $1,500 up. The flat fee is the same either
// side of a change, so only the 2% part can move the price.
const PREP_HIGH_VALUE_CENTS = 150000;
const prepValuePriceKey = (cents: number) => (cents >= PREP_HIGH_VALUE_CENTS ? Math.round(cents * 0.02) : -1);

const isRestorationTier = (t: string | null): t is RestorationTierId => !!t && t in RESTORATION_TIERS;
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;

function shippoCarrierToken(carrier: string) {
  const map: Record<string, string> = {
    USPS: "usps", FedEx: "fedex", UPS: "ups", DHL: "dhl", DHLExpress: "dhl_express",
  };
  return map[carrier] ?? carrier.toLowerCase().replace(/\s+/g, "_");
}

async function isLockedByCarrier(order: Record<string, unknown>): Promise<boolean> {
  const trackingNum = order.inbound_tracking_number as string | null;
  const carrier = order.inbound_carrier as string | null;
  if (!trackingNum) return false;

  try {
    const track = await shippo.trackingStatus.get(
      trackingNum,
      carrier ? shippoCarrierToken(carrier) : "usps"
    );
    const st = track.trackingStatus?.status ?? "UNKNOWN";
    return ["TRANSIT", "DELIVERED", "RETURNED", "FAILURE"].includes(st);
  } catch {
    return false; // fail open — if Shippo is down, don't block the customer
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid data" }, { status: 400 });

  const admin = createAdminClient();

  // Verify order belongs to this user's email
  const { data: order } = await admin
    .from("orders")
    .select("id, customer_email, status, restoration_tier, inbound_tracking_number, inbound_carrier")
    .eq("id", id)
    .single();

  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
  if (order.customer_email?.toLowerCase() !== user.email?.toLowerCase()) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Only allow editing on awaiting_cards (before we receive, work on or ship anything)
  if (!["awaiting_cards"].includes(order.status)) {
    return Response.json({ error: "Order cannot be edited at this stage" }, { status: 403 });
  }

  // Lock check — carrier has picked up the package
  const locked = await isLockedByCarrier(order);
  if (locked) {
    return Response.json({ error: "Your package is already in transit and can no longer be edited." }, { status: 403 });
  }

  // Update each card — only cards that belong to this order
  const { data: existingCards, error: cardsErr } = await admin
    .from("cards")
    .select("id, card_name, card_set, card_year, card_number, estimated_value_cents, notes, photo_urls, tier, status, cleaning_started_at, slab_opening_started_at")
    .eq("order_id", id)
    .order("created_at");
  if (cardsErr) {
    console.error("Card editor: loading cards failed:", cardsErr.message);
    return Response.json({ error: "Save failed. Please try again." }, { status: 500 });
  }

  const cards = (existingCards ?? []) as ExistingCard[];
  const byId = new Map(cards.map((c) => [c.id, c]));
  const position = new Map(cards.map((c, i) => [c.id, i + 1]));

  // New photos must be ones our uploader stored (/api/upload: a random name at
  // the top of the public card-photos bucket)
  const photoPrefix = admin.storage.from("card-photos").getPublicUrl("x").data.publicUrl.replace(/x$/, "");
  const isOurUpload = (u: string) =>
    u.startsWith(photoPrefix) && /^[A-Za-z0-9-]{1,100}\.[a-z]{3,4}$/.test(u.slice(photoPrefix.length));

  // Price overrides for value-priced tiers (Diamond's rate is set in admin),
  // read only when a declared value changes
  type TierRow = { price_cents?: number | null; pricing_rate?: number | null; min_card_value_cents?: number | null };
  let settingsMap: Record<string, TierRow> | null = null;
  async function tierSettings(): Promise<Record<string, TierRow>> {
    if (settingsMap) return settingsMap;
    const { data } = await admin
      .from("restoration_settings")
      .select("tier, price_cents, pricing_rate, min_card_value_cents");
    const map: Record<string, TierRow> = Object.fromEntries((data ?? []).map((s) => [s.tier, s]));
    settingsMap = map;
    return map;
  }

  type Change = { field: string; from: unknown; to: unknown };
  const planned: { card: ExistingCard; update: Record<string, unknown>; changes: Change[] }[] = [];

  const seen = new Set<string>();
  for (const { id: cardId, ...fields } of parsed.data.cards) {
    const card = byId.get(cardId);
    // Only this order's cards, each once
    if (!card || seen.has(cardId)) continue;
    seen.add(cardId);
    const label = card.card_name?.trim() || `Card ${position.get(cardId)}`;

    const next = {
      card_name: fields.card_name,
      card_set: fields.card_set ?? null,
      card_year: fields.card_year ?? null,
      card_number: fields.card_number ?? null,
      estimated_value_cents: fields.estimated_value_cents ?? null,
      notes: fields.notes ?? null,
      photo_urls: [...new Set(fields.photo_urls ?? [])],
    };
    const before = {
      card_name: card.card_name,
      card_set: card.card_set ?? null,
      card_year: card.card_year ?? null,
      card_number: card.card_number ?? null,
      estimated_value_cents: card.estimated_value_cents ?? null,
      notes: card.notes ?? null,
      photo_urls: card.photo_urls ?? [],
    };

    const changes: Change[] = [];
    for (const key of Object.keys(next) as (keyof typeof next)[]) {
      const same = key === "photo_urls"
        ? JSON.stringify(next.photo_urls) === JSON.stringify(before.photo_urls)
        : next[key] === before[key];
      if (!same) changes.push({ field: key, from: before[key], to: next[key] });
    }
    if (changes.length === 0) continue;

    // Nothing changes once work on the card has started or it was refunded
    if (card.cleaning_started_at || card.slab_opening_started_at || card.status === "refunded") {
      return Response.json({ error: `${label} can no longer be edited. Please contact us about it.` }, { status: 409 });
    }

    // Photos: only our own uploads, and no more than MAX_CARD_PHOTOS once any are added
    const added = next.photo_urls.filter((u) => !before.photo_urls.includes(u));
    if (!added.every(isOurUpload)) {
      return Response.json({ error: "Please upload photos with the upload button." }, { status: 400 });
    }
    if (added.length > 0 && next.photo_urls.length > MAX_CARD_PHOTOS) {
      return Response.json({ error: `Maximum ${MAX_CARD_PHOTOS} photos per card.` }, { status: 400 });
    }

    // The declared value is what the card was priced and insured on (Terms Section 4)
    if (next.estimated_value_cents !== before.estimated_value_cents) {
      const value = next.estimated_value_cents;
      if (value == null || value <= 0) {
        return Response.json({ error: `Please enter a declared value for ${label}.` }, { status: 400 });
      }
      // The order's tier first: an upgrade paid through the old site's webhook
      // moves the order but not its cards. Mixed-tier orders have no order tier.
      const tierId = order.restoration_tier ?? card.tier ?? null;
      const priceChange = () => Response.json({
        error: `Changing ${label}'s declared value would change its price. Please contact us to change it.`,
        code: "PRICE_CHANGE",
      }, { status: 400 });
      if (isRestorationTier(tierId)) {
        const tier = applyDbOverride(RESTORATION_TIERS[tierId], (await tierSettings())[tierId] ?? null);
        const max = RESTORATION_TIERS[tierId].max_card_value_cents;
        // Same eligibility rule as checkout (Terms 9.2)
        if (max !== null && value > max) {
          return Response.json({
            error: `${label} is declared at ${usd(value)}, above the ${RESTORATION_TIERS[tierId].name} tier's ${usd(max)} cap. Please contact us to change it.`,
            code: "TIER_CAP",
          }, { status: 400 });
        }
        if (getCardPriceCents(tier, value) !== getCardPriceCents(tier, before.estimated_value_cents ?? 0)) {
          return priceChange();
        }
      } else if (tierId === "prep") {
        if (prepValuePriceKey(value) !== prepValuePriceKey(before.estimated_value_cents ?? 0)) {
          return priceChange();
        }
      } else {
        // No tier to check the cap and price against (older orders): only we change it
        return priceChange();
      }
    }

    planned.push({ card, update: next, changes });
  }

  if (planned.length === 0) return Response.json({ ok: true });

  // Each customer edit goes in the order's history so the admin sees it (not
  // shown to the customer). The full before/after is in the event's metadata.
  // Recorded before the cards are saved, so no change is ever saved without
  // its record; a record whose change then didn't save is taken back.
  const describe = (c: Change, withText: boolean) => {
    const quoted = (v: unknown) => (withText ? ` "${v ?? ""}"` : "");
    switch (c.field) {
      case "estimated_value_cents":
        return `declared value ${c.from == null ? "none" : formatCurrency(c.from as number)} to ${formatCurrency(c.to as number)}`;
      case "card_name": return `name${quoted(c.from)} to${quoted(c.to)}`.replace(/ to$/, "");
      case "card_set": return `set${quoted(c.from)} to${quoted(c.to)}`.replace(/ to$/, "");
      case "card_year": return `year${quoted(c.from)} to${quoted(c.to)}`.replace(/ to$/, "");
      case "card_number": return `card number${quoted(c.from)} to${quoted(c.to)}`.replace(/ to$/, "");
      case "notes": return "notes";
      case "photo_urls": return `photos (${(c.from as string[]).length} to ${(c.to as string[]).length})`;
      default: return c.field;
    }
  };
  const description = (card: ExistingCard, changes: Change[]) => {
    const full = `Customer edited card "${card.card_name ?? ""}": ${changes.map((c) => describe(c, true)).join("; ")}`;
    // Admin pages find status changes by their wording ("Cards Received" and
    // the like), so customer-typed text that reads like one is left out
    return /received|shipped|status updated|delivered|refund/i.test(full)
      ? `Customer edited a card: ${changes.map((c) => describe(c, false)).join("; ")}`
      : full;
  };
  const { data: events, error: eventErr } = await admin
    .from("order_events")
    .insert(
      planned.map(({ card, changes }) => ({
        order_id: id,
        event_type: "customer_card_edit",
        description: description(card, changes),
        is_customer_visible: false,
        metadata: { card_id: card.id, changes },
      }))
    )
    .select("id, metadata");
  if (eventErr) {
    console.error("Card editor: recording the edit failed:", eventErr.message);
    return Response.json({ error: "Save failed. Please try again." }, { status: 500 });
  }
  const eventIdFor = new Map(
    (events ?? []).map((e) => [(e.metadata as { card_id?: string } | null)?.card_id, e.id as string])
  );

  // Saved only while work on the card still hasn't started (checked again in
  // the update itself, in case it started a moment ago)
  const results = await Promise.all(
    planned.map(({ card, update }) =>
      admin.from("cards").update(update)
        .eq("id", card.id).eq("order_id", id)
        .is("cleaning_started_at", null).is("slab_opening_started_at", null)
        .or("status.is.null,status.neq.refunded")
        .select("id")
    )
  );
  const failed = planned.filter((_, i) => results[i].error || !results[i].data?.length);
  const dbErrors = results.filter((r) => r.error);
  if (dbErrors.length > 0) {
    console.error("Card editor: saving cards failed:", dbErrors.map((r) => r.error?.message).join("; "));
  }

  // Take back the records of changes that didn't save
  const unsavedEvents = failed.map(({ card }) => eventIdFor.get(card.id)).filter((e): e is string => !!e);
  if (unsavedEvents.length > 0) {
    const { error: undoErr } = await admin.from("order_events").delete().in("id", unsavedEvents);
    if (undoErr) console.error("Card editor: removing the record of an unsaved edit failed:", undoErr.message);
  }

  if (failed.length > 0) {
    return Response.json({ error: "Some changes didn't save. Please try again." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
