import Link from "next/link";
import { getAllTiers, applyDbOverride, type RestorationTier } from "@/lib/restoration-tiers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRestorationsOpen, getSlotsOpenedAt } from "@/lib/store-config";
import { TIER_MAX_SLOTS } from "@/lib/site-config";
import { AlertTriangle, Check, CheckCircle, ChevronDown, Zap, Star, Crown, Rocket } from "lucide-react";
import { WaitlistModal } from "./waitlist-modal";
import { CountdownBanner } from "./countdown-banner";
import { DiamondCard } from "./diamond-card";
import { FACT_ROW } from "./fact-row";
import { BulkSwitch } from "./bulk-switch";
import { BULK_PLANS, bulkPriceCents, isBulkEligible } from "@/lib/bulk-pricing";
import { SnapDeck } from "@/components/motion/snap-deck";
import { ReviewsPanel } from "@/components/marketing/customer-reviews";
import { PixelViewContent } from "@/components/pixel-view-content";
import { PageHero } from "@/components/marketing/page-hero";

export const dynamic = "force-dynamic";

const ICON_MAP = {
  regular:       CheckCircle,
  expedited:     Zap,
  premium:       Star,
  ultra_premium: Crown,
  elite:         Crown,    // replaced by DiamondCard client component
  fast_pass:     Rocket,
} as const;

// Tier identity lives in a small polished-metal swatch, not in recoloring the card.
const SWATCH: Record<string, string> = {
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
  slotCounts: Record<string, number>;
  restorationsOpen: boolean;
  label?: React.ReactNode;
}) {
  const swatch = SWATCH[tier.id] ?? SWATCH.regular;
  const Icon = ICON_MAP[tier.id as keyof typeof ICON_MAP] ?? CheckCircle;

  const s = settingsMap[tier.id];
  // DB max_slots takes priority; fall back to site-config TIER_MAX_SLOTS constant
  const maxSlots = (s?.max_slots ?? null) ?? TIER_MAX_SLOTS[tier.id] ?? null;
  const usedSlots = slotCounts[tier.id] ?? 0;
  const slotsLeft = maxSlots !== null ? Math.max(0, maxSlots - usedSlots) : null;
  const isSoldOut = s?.is_open === false || (slotsLeft !== null && slotsLeft === 0);

  // Corner pill: sold out, else the owner's badge (or the card's own label).
  // Slots left sit in the facts beside the action, the same row on every card.
  const bannerLabel: React.ReactNode = isSoldOut ? "SOLD OUT" : (label ?? tier.badge ?? null);
  const bannerCls: string = isSoldOut ? "bg-secondary text-muted-foreground" : "bg-rx-soft text-rx";
  const showSlots = !isSoldOut && slotsLeft !== null && restorationsOpen;

  const price = tier.pricing_type === "percentage"
    ? `${((tier.pricing_rate ?? 0) * 100).toFixed(0)}%`
    : `$${(tier.price_cents / 100).toFixed(2)}`;

  const priceNote = tier.pricing_type === "percentage"
    ? `of declared card value · cards $${((tier.min_card_value_cents ?? 0) / 100).toFixed(0)}+`
    : tier.id === "fast_pass"
    ? "per card · cards under $5,000"
    : "per card";

  const action = isSoldOut ? (
    <div className="w-full h-12 flex items-center justify-center rounded-md font-semibold text-[15px] bg-secondary text-muted-foreground cursor-not-allowed">
      Sold Out
    </div>
  ) : !restorationsOpen ? (
    <div className="w-full h-12 flex items-center justify-center rounded-md font-semibold text-[15px] bg-secondary text-muted-foreground cursor-not-allowed">
      Currently Closed
    </div>
  ) : (
    <Link
      href={`/restoration?tier=${tier.id}`}
      className="btn-depth btn-sheen w-full h-12 flex items-center justify-center rounded-md font-semibold text-[15px] bg-rx text-primary-foreground hover:bg-rx/90 transition-colors duration-150"
    >
      Select {tier.name}
    </Link>
  );

  const facts = (
    <dl className="@container divide-y divide-rule border-t border-rule">
      <div className={FACT_ROW}>
        <dt className="rx-label @min-[16.5rem]:self-center">Turnaround</dt>
        <dd className="font-medium text-ink @min-[16.5rem]:text-right">
          {formatTurnaround(tier)}{" "}
          <span className="text-xs text-muted-foreground">(est.)</span>
        </dd>
      </div>
      <div className={`${FACT_ROW} @min-[16.5rem]:items-center`}>
        <dt className="rx-label">Card value</dt>
        <dd className="font-medium text-ink flex items-center gap-1">
          {tier.id === "fast_pass"
            ? "Under $5,000"
            : tier.max_card_value_cents === null
            ? "Unlimited"
            : `Up to $${(tier.max_card_value_cents / 100).toLocaleString()}`}
          <span className="relative group">
            <span className="text-xs text-muted-foreground cursor-help">*</span>
            <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 w-max max-w-[180px] rounded-md bg-ink px-2.5 py-1.5 text-xs text-paper opacity-0 group-hover:opacity-100 transition-opacity z-20 leading-snug">
              Current value, raw or graded
            </span>
          </span>
        </dd>
      </div>
      {showSlots && (
        <div className={FACT_ROW}>
          <dt className="rx-label @min-[16.5rem]:self-center">Slots</dt>
          <dd className={`tabular-nums @min-[16.5rem]:text-right ${slotsLeft! <= 3 ? "font-semibold text-red-700" : "font-medium text-ink"}`}>
            {slotsLeft} left
          </dd>
        </div>
      )}
      {tier.id === "fast_pass" && (
        <div className="flex items-center gap-2 py-2.5 text-sm">
          <Check className="h-4 w-4 text-rx" strokeWidth={2.25} />
          <span className="text-muted-foreground">Skips the restoration queue</span>
        </div>
      )}
    </dl>
  );

  return (
    <div className={`lift spotlight lit-border relative h-full rounded-xl border border-rule bg-card flex flex-col shadow-[0_1px_2px_oklch(0.25_0.006_70/0.06)] ${(isSoldOut || !restorationsOpen) ? "opacity-70" : ""}`}>
      {/* Fixed height, so a card with a corner pill lines up with one without */}
      <div className="flex h-12 items-end justify-between gap-3 px-6">
        <span className={`metal mb-[5px] h-3.5 w-11 rounded-[3px] ${swatch}`} aria-hidden />
        {bannerLabel && (
          <span className={`inline-flex items-center gap-1 whitespace-nowrap font-mono text-[11px] leading-4 uppercase tracking-wide rounded-full px-2.5 py-1 ${bannerCls}`}>
            {bannerLabel}
          </span>
        )}
      </div>

      <div className="p-6 pt-4 flex flex-col flex-1">
        <div className="flex items-start gap-3 mb-5">
          <Icon className="w-5 h-5 flex-shrink-0 mt-1.5 text-muted-foreground" strokeWidth={1.75} />
          <div className="min-w-0">
            <h3 className="font-heading text-[1.75rem] font-extrabold tracking-[-0.01em] text-ink leading-tight">{tier.name}</h3>
            {/* Two lines reserved, so prices line up across a row */}
            <p className="text-sm text-muted-foreground mt-0.5 min-h-10">{tier.description}</p>
          </div>
        </div>

        <div className="mb-6">
          {tier.pricing_type !== "percentage" && isBulkEligible(tier.id) ? (
            // One price per plan; the BulkSwitch above the grid shows the chosen one
            BULK_PLANS.map((p) => (
              <div key={p.id} data-plan={p.id} className="flex flex-wrap items-baseline gap-x-2.5">
                <span className="font-heading text-5xl font-extrabold tracking-[-0.02em] text-ink tabular-nums">
                  ${(bulkPriceCents(tier.price_cents, p.percent) / 100).toFixed(2)}
                </span>
                {p.percent > 0 && (
                  <span className="text-sm text-muted-foreground line-through tabular-nums" aria-label={`was ${price}`}>{price}</span>
                )}
              </div>
            ))
          ) : (
            <div className="font-heading text-5xl font-extrabold tracking-[-0.02em] text-ink tabular-nums">{price}</div>
          )}
          <p className="font-mono text-xs text-muted-foreground mt-1">{priceNote}</p>
        </div>

        {facts}

        {/* The action sits on the card's floor, level across a row */}
        <div className="mt-auto pt-6">{action}</div>
      </div>
    </div>
  );
}

export default async function TierSelectionPage() {
  const [restorationsOpen, slotsOpenedAt] = await Promise.all([
    getRestorationsOpen(),
    getSlotsOpenedAt(),
  ]);
  const defaultTiers = getAllTiers();
  const admin = createAdminClient();

  // Count paid orders + recent in-progress checkouts (pending, < 30 min old = active reservation)
  // This matches the same logic enforced at checkout so the display is accurate.
  // Note: stripe_session_id filter removed — that column may not exist yet in the DB.
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  let paidQuery = admin.from("orders").select("restoration_tier").eq("payment_status", "paid").not("restoration_tier", "is", null);
  if (slotsOpenedAt) paidQuery = paidQuery.gte("created_at", slotsOpenedAt);

  let pendingQuery = admin.from("orders").select("restoration_tier")
    .eq("payment_status", "pending")
    .not("restoration_tier", "is", null)
    .gte("created_at", thirtyMinAgo);
  if (slotsOpenedAt) pendingQuery = pendingQuery.gte("created_at", slotsOpenedAt);

  const [{ data: paidOrders }, { data: pendingOrders }] = await Promise.all([paidQuery, pendingQuery]);

  const { data: extSettings, error: extErr } = await admin
    .from("restoration_settings")
    .select("tier, is_open, max_slots, display_slots_remaining, display_name, price_cents, pricing_rate, min_card_value_cents, turnaround_min_days, turnaround_max_days, description, includes_notes, includes_video, badge");

  const settingsRaw = extErr
    ? ((await admin.from("restoration_settings").select("tier, is_open, max_slots")).data ?? [])
    : (extSettings ?? []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settingsMap = Object.fromEntries((settingsRaw as any[]).map((s) => [s.tier, s]));

  const slotCounts: Record<string, number> = {};
  if (restorationsOpen) {
    for (const row of paidOrders ?? []) {
      if (row.restoration_tier) slotCounts[row.restoration_tier] = (slotCounts[row.restoration_tier] ?? 0) + 1;
    }
    for (const row of pendingOrders ?? []) {
      if (row.restoration_tier) slotCounts[row.restoration_tier] = (slotCounts[row.restoration_tier] ?? 0) + 1;
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
  const eliteUsed = slotCounts["elite"] ?? 0;
  const eliteSlotsLeft = eliteMaxSlots !== null ? Math.max(0, eliteMaxSlots - eliteUsed) : null;
  const eliteIsSoldOut = settingsMap["elite"]?.is_open === false || (eliteSlotsLeft !== null && eliteSlotsLeft === 0);

  return (
    <div className="min-h-screen page-glow">
      <PixelViewContent contentName="Restoration Tiers" contentCategory="Restoration" />
      {/* Countdown — shown when shop is closed */}
      {!restorationsOpen && <CountdownBanner />}

      {/* Closed text banner */}
      {!restorationsOpen && (
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="max-w-5xl mx-auto px-4 md:px-6 py-4 text-center">
            <p className="text-sm font-semibold text-amber-900">
              We&apos;re not accepting new restoration orders right now — but you can still browse our pricing below.
            </p>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 md:px-10 py-12 md:py-20">
        <PageHero
          className="mb-12 md:mb-16"
          title="Choose Your Restoration Level"
          lines={["Choose Your", "Restoration Level"]}
          lead={restorationsOpen
            ? "Select the tier that best fits your cards' needs."
            : "We're temporarily closed. Browse our pricing below and join the waitlist to be notified when we reopen."}
        />

        {/* All six tiers on one track, equal heights per row: 3 x 2 from 1072px (where
            a card's facts fit side by side, see fact-row.ts), 2 x 3 below that */}
        <BulkSwitch>
        <SnapDeck
          labels={[...topTiers, ...midTiers, ...(eliteTier ? [eliteTier] : []), ...(fastPass ? [fastPass] : [])].map((t) => t.name)}
          gridClassName="md:grid md:grid-cols-2 min-[67rem]:grid-cols-3 md:gap-5 min-[67rem]:gap-6"
        >
          {[...topTiers, ...midTiers].map((tier, i) => (
            <div key={tier.id} className="rx-reveal h-full" style={{ ["--i" as string]: i }}>
              <TierCard tier={tier} {...sharedProps} />
            </div>
          ))}
          {eliteTier && (
            <div className="rx-reveal h-full" style={{ ["--i" as string]: topTiers.length + midTiers.length }}>
              <DiamondCard
                slotsLeft={eliteSlotsLeft}
                isSoldOut={eliteIsSoldOut}
                restorationsOpen={restorationsOpen}
              />
            </div>
          )}
          {fastPass && (
            <div className="rx-reveal h-full" style={{ ["--i" as string]: topTiers.length + midTiers.length + 1 }}>
              <TierCard
                tier={fastPass}
                {...sharedProps}
                label={<><Zap className="h-3 w-3" strokeWidth={2.25} aria-hidden />Express Option</>}
              />
            </div>
          )}
        </SnapDeck>
        </BulkSwitch>

        {/* Turnaround disclaimer */}
        <details className="mt-8 border border-amber-200 bg-amber-50 rounded-md group">
          <summary className="flex items-center justify-between px-5 py-4 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-700" strokeWidth={2} />
              <span className="text-sm font-semibold text-amber-900">About our turnaround time estimates</span>
            </div>
            <ChevronDown className="h-4 w-4 text-amber-700 group-open:rotate-180 transition-transform duration-150" />
          </summary>
          <div className="px-5 pb-5 text-sm text-amber-900 space-y-2 leading-relaxed border-t border-amber-200 pt-4">
            <p>
              All turnaround times shown are <strong>rough estimates only</strong> and are not a guarantee or promise of completion within any specific timeframe.
            </p>
            <p>
              Actual processing times may be affected by order volume, card condition, shipping delays, holidays, or other circumstances outside our control. We will always do our best to meet or beat the estimated range, but <strong>The Card Doc cannot be held liable</strong> for delays.
            </p>
            <p className="text-xs text-amber-700">
              By placing an order you acknowledge that turnaround times are estimates and agree that delays do not entitle you to a refund or cancellation. See our{" "}
              <Link href="/terms" className="underline hover:text-amber-900">Terms of Service</Link> for full details.
            </p>
          </div>
        </details>

        {/* Waitlist modal — auto-opens when closed */}
        {!restorationsOpen && <WaitlistModal />}

        {/* Footer info */}
        <div className="mt-8 border-y border-rule py-6">
          <p className="text-muted-foreground">
            Not sure which tier fits?{" "}
            <Link href="/how-it-works" className="text-rx hover:underline font-semibold">
              Learn what we can restore
            </Link>
            .
          </p>
        </div>

        {/* Customer Reviews */}
        <div className="mt-24 md:mt-32">
          <ReviewsPanel title="What Our Customers Say" />
        </div>
      </div>
    </div>
  );
}
