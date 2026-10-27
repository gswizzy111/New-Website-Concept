import Link from "next/link";
import { BarChart3, Hammer, Microscope, PauseCircle, X } from "lucide-react";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { PixelViewContent } from "@/components/pixel-view-content";
import { PageHero } from "@/components/marketing/page-hero";
import { ReviewsPanel } from "@/components/marketing/customer-reviews";
import { BulkSwitch } from "@/app/(public)/tier-selection/bulk-switch";
import { BULK_PLANS, bulkPriceCents } from "@/lib/bulk-pricing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Prep | The Card Doc",
  description: "Professional card submission prep. $25/card for cards under $1,500. 2% of declared value for high-value cards.",
};

async function getPrepPrices() {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("store_config")
      .select("key, value")
      .in("key", ["prep_standard_price_cents", "prep_pre_grade_price_cents", "prep_slab_crack_price_cents", "prep_open"]);
    const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    return {
      standardPriceCents: parseInt(map.prep_standard_price_cents ?? "2500", 10),
      preGradePriceCents: parseInt(map.prep_pre_grade_price_cents ?? "500", 10),
      slabCrackPriceCents: parseInt(map.prep_slab_crack_price_cents ?? "700", 10),
      isOpen: (map.prep_open ?? "true") !== "false",
    };
  } catch {
    return { standardPriceCents: 2500, preGradePriceCents: 500, slabCrackPriceCents: 700, isOpen: true };
  }
}

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function PrepPage() {
  const prices = await getPrepPrices();

  return (
    <div className="min-h-screen page-glow">
      <PixelViewContent contentName="PSA Prep" contentCategory="Prep" />
      <div className="max-w-5xl mx-auto px-4 md:px-10 py-12 md:py-20">

        <PageHero
          className="mb-12 md:mb-16"
          eyebrow="Prep Service"
          title="Get Your Cards Grade-Ready"
          lines={["Get Your Cards", "Grade-Ready"]}
          lead={<>We surface-clean and prep your cards so they&apos;re submission-ready. Graders make their own call, so no grade is ever guaranteed.</>}
        />

        {!prices.isOpen && (
          <div className="mb-8 bg-amber-50 border border-amber-300 rounded-md px-5 py-4 text-sm font-semibold text-amber-900 flex items-center gap-2.5">
            <PauseCircle className="h-4 w-4 shrink-0" strokeWidth={2} />
            Prep is temporarily paused — check back soon.
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:items-start hero-in" style={{ ["--d" as string]: 120 }}>
          <div className="flex flex-col gap-8">
            {/* Pricing, per number of cards (bulk pricing, lib/bulk-pricing.ts), as on the Restorations page */}
            <BulkSwitch stacked note="Bulk pricing is applied automatically at checkout to cards under $1,500. Cards $1,500 and over, add-ons and shipping aren't discounted.">
            <div className="lit-border relative bg-white border border-ink/70 rounded-xl shadow-[0_40px_70px_-50px_oklch(0.25_0.006_70/0.6)]">
              <div className="flex items-center justify-between gap-4 px-6 md:px-7 py-5 border-b border-ink/70 border-t-[6px] border-t-rx rounded-t-xl">
                <div>
                  <h2 className="font-heading text-2xl md:text-3xl font-extrabold tracking-[-0.01em] text-ink">Prep Pricing</h2>
                  <p className="font-mono text-xs text-muted-foreground mt-1">Per card — price based on declared value</p>
                </div>
                <Microscope className="h-6 w-6 text-rx" strokeWidth={1.75} />
              </div>
              <div className="divide-y divide-rule">
                <div className="flex items-center justify-between gap-4 px-6 md:px-7 py-6">
                  <div>
                    <p className="font-semibold text-ink">Cards under $1,500</p>
                    <p className="text-sm text-muted-foreground mt-0.5">Surface clean, penny sleeve + semi-rigid holder</p>
                  </div>
                  <div className="text-right shrink-0">
                    {/* One price per plan; the switch above shows the chosen one */}
                    {BULK_PLANS.map((p) => (
                      <div key={p.id} data-plan={p.id} className="flex flex-wrap items-baseline justify-end gap-x-2">
                        {p.percent > 0 && (
                          <span className="text-sm text-muted-foreground line-through tabular-nums" aria-label={`was ${fmt(prices.standardPriceCents)}`}>{fmt(prices.standardPriceCents)}</span>
                        )}
                        <span className="font-heading text-4xl md:text-5xl font-extrabold tracking-[-0.02em] text-ink tabular-nums">{fmt(bulkPriceCents(prices.standardPriceCents, p.percent))}</span>
                      </div>
                    ))}
                    <p className="font-mono text-xs text-muted-foreground">per card</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 px-6 md:px-7 py-6">
                  <div>
                    <p className="font-semibold text-ink">Cards $1,500 and over</p>
                    {/* Not bulk discounted (priced as a share of value, as Diamond is), so the same on every plan */}
                    <p className="text-sm text-muted-foreground mt-0.5">
                      e.g. $2,000 card = $40.00 &nbsp;·&nbsp; $5,000 card = $100.00
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-heading text-4xl md:text-5xl font-extrabold tracking-[-0.02em] text-ink tabular-nums">2%</p>
                    <p className="font-mono text-xs text-muted-foreground">of declared value</p>
                  </div>
                </div>
              </div>
              <div className="px-6 md:px-7 py-5 bg-paper border-t border-rule rounded-b-xl">
                {prices.isOpen ? (
                  <Link
                    href="/prep/order"
                    className="btn-depth btn-sheen w-full h-12 rounded-md font-semibold text-[15px] flex items-center justify-center bg-rx text-primary-foreground hover:bg-rx/90 transition-colors"
                  >
                    Order Prep →
                  </Link>
                ) : (
                  <div className="w-full h-12 rounded-md font-semibold text-[15px] flex items-center justify-center bg-secondary text-muted-foreground cursor-not-allowed">
                    Currently Paused
                  </div>
                )}
              </div>
            </div>
            </BulkSwitch>

            {/* Add-ons */}
            <div>
              <h2 className="font-heading font-extrabold text-xl text-ink mb-4">Available Add-Ons</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 border-t border-ink/70">
                <div className="flex items-start gap-3 py-5 sm:pr-5 border-b border-rule">
                  <BarChart3 className="h-5 w-5 mt-0.5 shrink-0 text-rx" strokeWidth={1.75} />
                  <div>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <h3 className="font-heading font-bold text-base text-ink">Pre-Grade Assessment</h3>
                      <span className="font-mono text-xs text-rx">+{fmt(prices.preGradePriceCents)}/card</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                      We assess each card and give you an estimated grade before you submit — so you know what to expect.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 py-5 sm:pl-5 sm:border-l border-b border-rule">
                  <Hammer className="h-5 w-5 mt-0.5 shrink-0 text-rx" strokeWidth={1.75} />
                  <div>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <h3 className="font-heading font-bold text-base text-ink">Slab Crack</h3>
                      <span className="font-mono text-xs text-rx">+{fmt(prices.slabCrackPriceCents)}/card</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                      Already graded? We carefully crack the slab and include the raw card in your prep order.
                    </p>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">Add-ons are selected during the order process.</p>
            </div>
          </div>

          <div className="flex flex-col gap-8">
            {/* Not included */}
            <div className="border border-red-200 bg-red-50/60 rounded-xl px-6 py-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-red-800 mb-3">Prep does not include:</p>
              <ul className="grid grid-cols-2 gap-x-6 gap-y-2">
                {["Crease work", "Edge & corner work", "Dent removal", "Any restorative work"].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-red-800">
                    <X className="h-3.5 w-3.5 shrink-0 text-red-600" strokeWidth={2.5} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-red-800 mt-4">
                Need restoration?{" "}
                <Link href="/tier-selection" className="font-semibold underline hover:text-red-900">
                  See our Restoration tiers →
                </Link>
              </p>
            </div>

            <div className="text-sm text-muted-foreground">
              Questions?{" "}
              <a href="https://www.instagram.com/the_card_doc" target="_blank" rel="noopener noreferrer" className="text-rx font-semibold hover:underline">
                DM us @the_card_doc
              </a>
            </div>
          </div>
        </div>

      </div>

      {/* Customer Reviews: the same panel, at the same width, as the Restorations page */}
      <div className="max-w-6xl mx-auto px-4 md:px-10 pt-4 md:pt-12 pb-12 md:pb-20">
        <ReviewsPanel title="What Our Customers Say" />
      </div>
    </div>
  );
}
