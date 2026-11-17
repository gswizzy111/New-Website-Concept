import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Check, Clock, Plus, Zap } from "lucide-react";
import { TrustPills } from "@/components/marketing/trust-pills";
import { ReviewsBand } from "@/components/marketing/comic-reviews";
import { JsonLd } from "@/components/seo/json-ld";
import { ORG_ID, SITE, breadcrumbs, canonical } from "@/lib/seo";
import { getAllTiers, applyDbOverride, type RestorationTier } from "@/lib/restoration-tiers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRestorationsOpen, getSlotsOpenedAt } from "@/lib/store-config";
import { TIER_MAX_SLOTS } from "@/lib/site-config";
import { tierSlotUsage } from "@/lib/tier-slots";
import { WaitlistModal } from "./waitlist-modal";
import { DiamondCard } from "./diamond-card";
import { CLOSED_ACTION } from "./fact-row";
import { ValueNote } from "./value-note";
import { BulkSwitch } from "./bulk-switch";
import { BULK_PLANS, bulkPriceCents, isBulkEligible } from "@/lib/bulk-pricing";
import { PixelViewContent } from "@/components/pixel-view-content";
import { PageHero } from "@/components/marketing/page-hero";
import { cta } from "@/components/brand";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Restoration Pricing | The Card Doc",
  description: "Surfaces, corners & edges — cleaned and restored to their best. From $75 / card.",
  alternates: canonical("/tier-selection"),
};

// A tier fact on phones: label over value, two facts to a row. From md, the
// shared FACT_ROW behaviour (side by side when the card is wide enough).
const FACT =
  "flex flex-col gap-0.5 py-3 text-[15px] md:@min-[16.5rem]:flex-row md:@min-[16.5rem]:justify-between md:@min-[16.5rem]:gap-3";
const FACT_DT_CENTER = "label-caps text-[14px] text-ink-soft md:@min-[16.5rem]:self-center";

// Each tier's metal: a card-shaped swatch beside its name and a hairline
// band along the card's top edge (the highlight slides on hover).
const METAL: Record<string, string> = {
  regular:       "metal-bronze",
  expedited:     "metal-silver",
  premium:       "metal-gold",
  ultra_premium: "metal-platinum",
  fast_pass:     "metal-rx",
};

function formatTurnaround(tier: RestorationTier): string {
  if (tier.turnaround_label) return tier.turnaround_label;
  return `${tier.turnaround_min_days}–${tier.turnaround_max_days} days`;
}

function TierCard({
  tier,
  settingsMap,
  slotCounts,
  restorationsOpen,
  label,
}: {
  tier: RestorationTier;
  settingsMap: Record<string, { is_open?: boolean; max_slots?: number | null; display_slots_remaining?: number | null }>;
  /** null: the count couldn't be read, so slots left are unknown */
  slotCounts: Record<string, number> | null;
  restorationsOpen: boolean;
  label?: React.ReactNode;
}) {
  const metal = METAL[tier.id] ?? METAL.regular;

  const s = settingsMap[tier.id];
  // DB max_slots takes priority; fall back to site-config TIER_MAX_SLOTS constant
  const maxSlots = (s?.max_slots ?? null) ?? TIER_MAX_SLOTS[tier.id] ?? null;
  const slotsLeft = maxSlots !== null && slotCounts ? Math.max(0, maxSlots - (slotCounts[tier.id] ?? 0)) : null;
  const isSoldOut = s?.is_open === false || (slotsLeft !== null && slotsLeft === 0);

  // Corner chip: sold out, else the owner's badge (or the card's own label).
  // Slots left sit in the facts beside the action, the same row on every card.
  const bannerLabel: React.ReactNode = isSoldOut ? "SOLD OUT" : (label ?? tier.badge ?? null);
  const showSlots = !isSoldOut && slotsLeft !== null && restorationsOpen;
  const closed = isSoldOut || !restorationsOpen;
  const featured = !!tier.badge && tier.id === "premium";

  const price = tier.pricing_type === "percentage"
    ? `${((tier.pricing_rate ?? 0) * 100).toFixed(0)}%`
    : `$${(tier.price_cents / 100).toFixed(2)}`;

  const priceNote = tier.pricing_type === "percentage"
    ? `of declared card value · cards $${((tier.min_card_value_cents ?? 0) / 100).toFixed(0)}+`
    : tier.id === "fast_pass"
    ? "per card · cards under $5,000"
    : "per card";

  const action = isSoldOut ? (
    <div className={CLOSED_ACTION}>Sold Out</div>
  ) : !restorationsOpen ? (
    <div className={CLOSED_ACTION}>Currently Closed</div>
  ) : (
    <Link
      href={`/restoration?tier=${tier.id}`}
      className={cta({ tone: featured ? "sun" : "ink", size: "lg", className: "w-full" })}
    >
      Select {tier.name}
      <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
    </Link>
  );

  const facts = (
    <div className="@container border-t-2 border-ink">
      <dl className="grid grid-cols-2 gap-x-4 md:block md:divide-y md:divide-line">
        <div className={FACT}>
          <dt className={FACT_DT_CENTER}>Turnaround</dt>
          <dd className="font-bold text-ink md:@min-[16.5rem]:text-right">
            {formatTurnaround(tier)}{" "}
            <span className="text-xs font-medium text-ink-soft">(est.)</span>
          </dd>
        </div>
        <div className={`${FACT} md:@min-[16.5rem]:items-center`}>
          <dt className="label-caps text-[14px] text-ink-soft">Card value</dt>
          <dd className="flex flex-wrap items-center gap-x-1 font-bold text-ink">
            {tier.id === "fast_pass"
              ? "Under $5,000"
              : tier.max_card_value_cents === null
              ? "Unlimited"
              : `Up to $${(tier.max_card_value_cents / 100).toLocaleString()}`}
            <ValueNote />
          </dd>
        </div>
        {showSlots && (
          <div className={cn(FACT, "max-md:col-span-2 max-md:border-t max-md:border-line")}>
            <dt className={FACT_DT_CENTER}>Slots</dt>
            <dd className={cn("tabular-nums md:@min-[16.5rem]:text-right", slotsLeft! <= 3 ? "font-extrabold text-red-700" : "font-bold text-ink")}>
              {slotsLeft} left
            </dd>
          </div>
        )}
      </dl>
      {/* Not a term/value pair, so it sits under the list, not inside it */}
      {tier.id === "fast_pass" && (
        <p className="flex items-center gap-2.5 border-t border-line py-3 text-[15px]">
          <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-success-tint text-success">
            <Check className="size-3.5" strokeWidth={2.75} />
          </span>
          <span className="font-semibold text-ink">Skips the restoration queue</span>
        </p>
      )}
    </div>
  );

  return (
    <article
      id={`tier-${tier.id}`}
      className={cn(
        "lift relative isolate flex h-full scroll-mt-[calc(var(--header-h)+5.5rem)] flex-col overflow-hidden rounded-2xl bg-white",
        featured
          ? "shadow-[0_0_0_3px_var(--sun),0_30px_60px_-34px_rgba(13,18,51,0.55)]"
          : "shadow-[0_0_0_1px_var(--line),var(--panel-shadow)]"
      )}
    >
      <span aria-hidden className={cn("metal absolute inset-x-0 top-0 h-1.5", metal, closed && "grayscale")} />
      <div className="flex flex-1 flex-col p-5 md:p-7">
        {/* The tier's metal swatch and its chip. Fixed height, so a card with a
            chip lines up with one without. */}
        <div className="flex min-h-9 items-center justify-between gap-3">
          <span
            aria-hidden
            className={cn(
              "metal block h-9 w-[26px] -rotate-6 rounded-[5px] shadow-[0_0_0_2px_var(--white),0_4px_10px_-4px_rgba(13,18,51,0.45)]",
              metal,
              closed && "grayscale"
            )}
          />
          {bannerLabel && (
            <span
              className={cn(
                "inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-extrabold uppercase tracking-[0.06em]",
                isSoldOut ? "bg-chalk text-ink-soft" : featured ? "bg-sun text-ink" : "bg-cobalt text-white"
              )}
            >
              {bannerLabel}
            </span>
          )}
        </div>

        <h3 className="caps mt-3 font-display text-[36px] font-black leading-[0.9] text-ink md:mt-5 md:text-[40px]">{tier.name}</h3>
        {/* Two lines reserved, so prices line up across a row */}
        <p className="mt-1.5 mb-4 text-[15px] leading-snug text-ink-soft md:mt-2 md:mb-6 md:min-h-12">{tier.description}</p>

        <div className="mb-5 md:mb-6">
          {tier.pricing_type !== "percentage" && isBulkEligible(tier.id) ? (
            // One price per plan; the BulkSwitch above the grid shows the chosen one
            BULK_PLANS.map((p) => (
              <div key={p.id} data-plan={p.id} className="flex flex-wrap items-end gap-x-3 gap-y-1">
                <span className="font-display text-[56px] font-black leading-[0.82] md:text-[72px] tracking-[-0.01em] text-ink tabular-nums lining-nums">
                  ${(bulkPriceCents(tier.price_cents, p.percent) / 100).toFixed(2)}
                </span>
                {p.percent > 0 && (
                  <span className="mb-1 text-base font-semibold text-ink-soft line-through" aria-label={`was ${price}`}>{price}</span>
                )}
              </div>
            ))
          ) : (
            <div className="font-display text-[56px] font-black leading-[0.82] md:text-[72px] tracking-[-0.01em] text-ink tabular-nums lining-nums">{price}</div>
          )}
          <p className="label-caps mt-3 text-[13px] text-cobalt">{priceNote}</p>
        </div>

        {facts}

        {/* The action sits on the card's floor, level across a row */}
        <div className="mt-auto pt-5 md:pt-7">{action}</div>
      </div>
    </article>
  );
}

export default async function TierSelectionPage() {
  const [restorationsOpen, slotsOpenedAt] = await Promise.all([
    getRestorationsOpen(),
    getSlotsOpenedAt(),
  ]);
  const defaultTiers = getAllTiers();
  const admin = createAdminClient();

  const { data: extSettings, error: extErr } = await admin
    .from("restoration_settings")
    .select("tier, is_open, max_slots, display_slots_remaining, display_name, price_cents, pricing_rate, min_card_value_cents, turnaround_min_days, turnaround_max_days, description, includes_notes, includes_video, badge");

  const settingsRaw = extErr
    ? ((await admin.from("restoration_settings").select("tier, is_open, max_slots")).data ?? [])
    : (extSettings ?? []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settingsMap = Object.fromEntries((settingsRaw as any[]).map((s) => [s.tier, s]));

  // Slots taken, one per order: paid orders plus checkouts in progress (under
  // 30 minutes old), counted the way checkout enforces them (lib/tier-slots.ts).
  // null: the count failed, so no tier shows a number of slots left.
  let slotCounts: Record<string, number> | null = {};
  if (restorationsOpen) {
    try {
      slotCounts = await tierSlotUsage(admin, slotsOpenedAt);
    } catch (err) {
      console.error("Tier slot count failed:", err);
      slotCounts = null;
    }
  }

  const tiers = defaultTiers.map((t) =>
    !extErr ? applyDbOverride(t, settingsMap[t.id] ?? null) : t
  );

  const topTiers  = tiers.filter((t) => ["regular", "expedited", "premium"].includes(t.id));
  const midTiers  = tiers.filter((t) => t.id === "ultra_premium");
  const fastPass  = tiers.find((t) => t.id === "fast_pass");
  const eliteTier = tiers.find((t) => t.id === "elite");

  const sharedProps = { settingsMap, slotCounts, restorationsOpen };

  // Diamond slot info for client component
  const eliteMaxSlots = (settingsMap["elite"]?.max_slots ?? null) ?? TIER_MAX_SLOTS["elite"] ?? null;
  const eliteSlotsLeft = eliteMaxSlots !== null && slotCounts ? Math.max(0, eliteMaxSlots - (slotCounts["elite"] ?? 0)) : null;
  const eliteIsSoldOut = settingsMap["elite"]?.is_open === false || (eliteSlotsLeft !== null && eliteSlotsLeft === 0);

  const offerTiers = [...topTiers, ...midTiers, ...(fastPass ? [fastPass] : [])].filter((t) => t.pricing_type !== "percentage");
  const structured = [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: "Card Restoration",
      serviceType: "Trading card restoration",
      description: "Surfaces, corners & edges — cleaned and restored to their best.",
      url: `${SITE}/tier-selection`,
      provider: { "@id": ORG_ID },
      areaServed: ["US", "PR"],
      hasOfferCatalog: {
        "@type": "OfferCatalog",
        name: "Restoration tiers",
        itemListElement: offerTiers.map((t) => ({
          "@type": "Offer",
          name: t.name,
          description: t.description,
          price: (t.price_cents / 100).toFixed(2),
          priceCurrency: "USD",
          url: `${SITE}/tier-selection`,
        })),
      },
    },
    breadcrumbs([{ name: "Restoration Pricing", path: "/tier-selection" }]),
  ];

  // Phones: the tiers stack at their natural height (no equal-height stretch),
  // under a sticky row of price chips that jumps to each card. From md they
  // fall into the grid, equal heights per row.
  const slot = "rx-reveal flex flex-col md:[&>article]:flex-1";
  const deck = [...topTiers, ...midTiers];

  // The chip row: every tier's name and price, as on its card.
  const chipTiers = [...deck, ...(fastPass ? [fastPass] : []), ...(eliteTier ? [eliteTier] : [])];
  const chipPrice = (t: RestorationTier) =>
    t.pricing_type === "percentage"
      ? <span>{`${((t.pricing_rate ?? 0) * 100).toFixed(0)}%`}</span>
      : isBulkEligible(t.id)
      ? BULK_PLANS.map((p) => (
          <span key={p.id} data-plan={p.id}>${(bulkPriceCents(t.price_cents, p.percent) / 100).toFixed(2)}</span>
        ))
      : <span>${(t.price_cents / 100).toFixed(2)}</span>;

  return (
    <div className="min-h-screen overflow-x-clip">
      <JsonLd data={structured} />
      <PixelViewContent contentName="Restoration Tiers" contentCategory="Restoration" />

      {/* Closed: a sun notice across the top of the page */}
      {!restorationsOpen && (
        <div className="surface-sun border-b border-ink/10">
          <div className="wrap flex items-start gap-4 py-5 md:items-center md:py-6">
            <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-sun">
              <Clock className="size-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="caps font-display text-[26px] font-black leading-[0.95] text-ink md:text-[32px]">Restorations are currently closed.</p>
              <p className="mt-1.5 text-[15px] font-medium leading-relaxed text-ink md:text-base">
                We&apos;re not accepting new restoration orders right now — but you can still browse our pricing below.
              </p>
            </div>
          </div>
        </div>
      )}

      <section aria-labelledby="tiers-heading" className="surface-chalk relative">
        <div className="wrap pt-6 pb-16 md:pt-10 md:pb-24">
          {/* Header: the headline and lead, kept short so the prices show in the first screen.
              Phones go straight from the lead to the prices (the trust facts follow the tiers). */}
          <div>
            <div>
              <PageHero
                eyebrow="Restoration Pricing"
                title="Choose Your Restoration Level"
                lines={["Choose Your", "Restoration Level"]}
                lead={restorationsOpen
                  ? "Select the tier that best fits your cards' needs."
                  : "We're temporarily closed. Browse our pricing below and join the waitlist to be notified when we reopen."}
              />
              </div>

          </div>

          {/* The tiers. The id anchors the heading for screen readers. */}
          <h2 id="tiers-heading" className="sr-only">Restoration tiers</h2>
          <div className="mt-6 md:mt-10">
            <BulkSwitch>
              <nav
                aria-label="Jump to a tier"
                className="sticky top-[var(--header-h)] z-20 -mx-5 mb-4 bg-chalk/95 py-2.5 shadow-[0_1px_0_var(--line)] backdrop-blur-sm md:hidden"
              >
                <ul className="flex gap-2 overflow-x-auto px-5 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {chipTiers.map((t) => (
                    <li key={t.id} className="shrink-0">
                      <a
                        href={`#tier-${t.id}`}
                        className="group inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white px-3.5 text-[14px] font-extrabold whitespace-nowrap text-ink shadow-[0_0_0_1px_var(--line)] transition-colors hover:bg-ink hover:text-white focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-cobalt motion-reduce:transition-none"
                      >
                        {t.name}
                        <span className="text-cobalt tabular-nums group-hover:text-sun">{chipPrice(t)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
              <div className="flex flex-col gap-5 md:grid md:grid-cols-2 md:gap-7 min-[67rem]:grid-cols-3 min-[67rem]:gap-8">
                {deck.map((tier, i) => (
                  <div key={tier.id} className={slot} style={{ ["--i" as string]: i }}>
                    <TierCard tier={tier} {...sharedProps} />
                  </div>
                ))}
                {fastPass && (
                  <div className={slot} style={{ ["--i" as string]: deck.length }}>
                    <TierCard
                      tier={fastPass}
                      {...sharedProps}
                      label={<><Zap className="size-3.5" strokeWidth={2.25} aria-hidden />Express Option</>}
                    />
                  </div>
                )}
                {eliteTier && (
                  <div className={slot} style={{ ["--i" as string]: deck.length + 1 }}>
                    <DiamondCard
                      slotsLeft={eliteSlotsLeft}
                      isSoldOut={eliteIsSoldOut}
                      restorationsOpen={restorationsOpen}
                    />
                  </div>
                )}
              </div>
            </BulkSwitch>
            <TrustPills align="start" className="mt-10 md:mt-12" />
          </div>

          {/* Turnaround disclaimer: the fine print, folded */}
          <details className="group mt-12 rounded-2xl bg-white shadow-[0_0_0_1px_var(--line)] md:mt-16">
            <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-4 select-none md:px-7 [&::-webkit-details-marker]:hidden">
              <span className="text-lg font-extrabold leading-snug text-ink transition-colors group-hover:text-cobalt md:text-xl">About our turnaround time estimates</span>
              <span
                aria-hidden
                className="grid size-10 shrink-0 place-items-center rounded-full bg-chalk text-ink transition-[rotate,background-color] duration-300 ease-[var(--ease-out)] group-open:rotate-45 group-open:bg-sun motion-reduce:transition-none"
              >
                <Plus className="size-5" strokeWidth={2} />
              </span>
            </summary>
            <div className="space-y-3 border-t border-line px-5 pt-5 pb-6 text-[15px] leading-relaxed text-ink md:px-7">
              <p>
                All turnaround times shown are <strong>rough estimates only</strong> and are not a guarantee or promise of completion within any specific timeframe.
              </p>
              <p>
                Actual processing times may be affected by order volume, card condition, shipping delays, holidays, or other circumstances outside our control. We will always do our best to meet or beat the estimated range, but <strong>The Card Doc cannot be held liable</strong> for delays.
              </p>
              <p className="text-sm text-ink-soft">
                By placing an order you acknowledge that turnaround times are estimates and agree that delays do not entitle you to a refund or cancellation. See our{" "}
                <Link href="/terms" className="tlink font-semibold text-cobalt">Terms of Service</Link> for full details.
              </p>
            </div>
          </details>
        </div>
      </section>

      {/* Waitlist modal — auto-opens when closed */}
      {!restorationsOpen && <WaitlistModal />}

      {/* Not sure which tier fits: the question and the pointer */}
      <section aria-labelledby="fit-heading" className="surface-ink">
        <div className="wrap py-14 md:py-20">
          <div data-reveal className="flex flex-col items-start gap-x-10 gap-y-7 md:flex-row md:items-center md:justify-between">
            <h2 id="fit-heading" className="display-md text-white">Not sure which tier fits?</h2>
            <Link href="/how-it-works" className={cta({ size: "lg", className: "shrink-0" })}>
              Learn what we can restore
              <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
            </Link>
          </div>
        </div>
      </section>

      <ReviewsBand title="What Our Customers Say" compact id="tier-reviews-heading" />
    </div>
  );
}
