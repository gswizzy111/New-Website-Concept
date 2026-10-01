import Link from "next/link";
import { getAllTiers, applyDbOverride, type RestorationTier } from "@/lib/restoration-tiers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRestorationsOpen, getSlotsOpenedAt } from "@/lib/store-config";
import { TIER_MAX_SLOTS } from "@/lib/site-config";
import { AlertTriangle, Check, CheckCircle, ChevronDown, Zap, Star, Crown, Rocket } from "lucide-react";
import { WaitlistModal } from "./waitlist-modal";
import { CountdownBanner } from "./countdown-banner";
import { DiamondCard } from "./diamond-card";
import { getTestimonials } from "@/lib/testimonials";
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
  wide = false,
}: {
  tier: RestorationTier;
  settingsMap: Record<string, { is_open?: boolean; max_slots?: number | null; display_slots_remaining?: number | null }>;
  slotCounts: Record<string, number>;
  restorationsOpen: boolean;
  wide?: boolean;
}) {
  const swatch = SWATCH[tier.id] ?? SWATCH.regular;
  const Icon = ICON_MAP[tier.id as keyof typeof ICON_MAP] ?? CheckCircle;

  const s = settingsMap[tier.id];
  // DB max_slots takes priority; fall back to site-config TIER_MAX_SLOTS constant
  const maxSlots = (s?.max_slots ?? null) ?? TIER_MAX_SLOTS[tier.id] ?? null;
  const usedSlots = slotCounts[tier.id] ?? 0;
  const slotsLeft = maxSlots !== null ? Math.max(0, maxSlots - usedSlots) : null;
  const isSoldOut = s?.is_open === false || (slotsLeft !== null && slotsLeft === 0);

  const bannerLabel: string | null = isSoldOut
    ? "SOLD OUT"
    : slotsLeft !== null && restorationsOpen
    ? `${slotsLeft} slot${slotsLeft !== 1 ? "s" : ""} left`
    : (tier.badge ?? null);

  const bannerCls: string = isSoldOut
    ? "bg-secondary text-muted-foreground"
    : slotsLeft !== null
    ? slotsLeft <= 3 ? "bg-red-50 text-red-700 ring-1 ring-red-200" : "bg-rx-soft text-rx"
    : "bg-rx-soft text-rx";

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
    <dl className="divide-y divide-rule border-t border-rule">
      <div className="flex justify-between gap-4 py-2.5 text-sm">
        <dt className="rx-label self-center">Turnaround</dt>
        <dd className="font-medium text-ink text-right">
          {formatTurnaround(tier)}{" "}
          <span className="text-xs text-muted-foreground">(est.)</span>
        </dd>
      </div>
      <div className="flex justify-between gap-4 py-2.5 text-sm items-center">
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
      {tier.id === "fast_pass" && (
        <div className="flex items-center gap-2 py-2.5 text-sm">
          <Check className="h-4 w-4 text-rx" strokeWidth={2.25} />
          <span className="text-muted-foreground">Skips the restoration queue</span>
        </div>
      )}
    </dl>
  );

  return (
    <div className={`lift spotlight lit-border relative rounded-xl border border-rule bg-card flex flex-col shadow-[0_1px_2px_oklch(0.25_0.04_165/0.06)] ${(isSoldOut || !restorationsOpen) ? "opacity-70" : ""}`}>
      <div className="flex items-center justify-between gap-3 px-6 pt-6">
        <span className={`metal h-3.5 w-11 rounded-[3px] ${swatch}`} aria-hidden />
        {bannerLabel && (
          <span className={`font-mono text-[11px] uppercase tracking-wide rounded-full px-2.5 py-0.5 ${bannerCls}`}>
            {bannerLabel}
          </span>
        )}
      </div>

      <div className={`p-6 pt-4 flex-1 ${wide ? "grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-end" : "flex flex-col"}`}>
        <div className={wide ? "" : "flex flex-col flex-1"}>
          <div className="flex items-start gap-3 mb-5">
            <Icon className="w-5 h-5 flex-shrink-0 mt-1.5 text-muted-foreground" strokeWidth={1.75} />
            <div>
              <h3 className="font-heading text-[1.75rem] font-extrabold tracking-[-0.025em] text-ink leading-tight [font-variation-settings:'wdth'_84]">{tier.name}</h3>
              <p className="text-sm text-muted-foreground mt-0.5">{tier.description}</p>
            </div>
          </div>

          <div className="mb-6">
            <div className="font-heading text-5xl font-extrabold tracking-[-0.04em] text-ink tabular-nums [font-variation-settings:'wdth'_80]">{price}</div>
            <p className="font-mono text-xs text-muted-foreground mt-1">{priceNote}</p>
          </div>

          {!wide && <div className="mb-5">{facts}</div>}
          {!wide && <div className="mt-auto">{action}</div>}
        </div>

        {wide && (
          <div className="flex flex-col gap-5">
            {facts}
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

export default async function TierSelectionPage() {
  const [restorationsOpen, slotsOpenedAt, testimonials] = await Promise.all([
    getRestorationsOpen(),
    getSlotsOpenedAt(),
    getTestimonials(),
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

        {/* All tiers on one 3-column track so card edges align */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6 items-start">
          {[...topTiers, ...midTiers].map((tier, i) => (
            <div key={tier.id} className="rx-reveal" style={{ ["--i" as string]: i }}>
              <div>
                <TierCard tier={tier} {...sharedProps} />
              </div>
            </div>
          ))}
          {eliteTier && (
            <div className="rx-reveal" style={{ ["--i" as string]: topTiers.length + midTiers.length }}>
              <div>
                <DiamondCard
                  slotsLeft={eliteSlotsLeft}
                  isSoldOut={eliteIsSoldOut}
                  restorationsOpen={restorationsOpen}
                />
              </div>
            </div>
          )}
        </div>

        {/* Fast Pass — bottom */}
        {fastPass && (
          <div>
            <div className="flex items-center gap-3 mt-14 mb-4">
              <span className="rx-label text-rx flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" strokeWidth={2} />Express Option</span>
              <div className="h-px flex-1 bg-rule" />
            </div>
            <TierCard tier={fastPass} {...sharedProps} wide />
          </div>
        )}

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
        {testimonials.length > 0 && (
          <div className="mt-24 md:mt-32">
            <div className="mb-10">
              <h2 data-reveal className="font-heading text-4xl md:text-6xl font-extrabold tracking-[-0.035em] leading-[0.95] text-ink [font-variation-settings:'wdth'_80]">What Our Customers Say</h2>
            </div>
            <div data-reveal="stagger" className="columns-2 md:columns-3 gap-3 md:gap-4 [&>*]:mb-3 md:[&>*]:mb-4">
              {testimonials.map((t) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={t.id}
                  src={t.url}
                  alt={t.alt ?? "Customer review"}
                  loading="lazy"
                  className="w-full h-auto break-inside-avoid rounded-xl ring-1 ring-rule shadow-[0_18px_40px_-28px_oklch(0.25_0.04_165/0.5)]"
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
