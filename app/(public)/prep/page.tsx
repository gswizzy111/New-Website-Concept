import Link from "next/link";
import { BarChart3, Hammer, Microscope, PauseCircle, X } from "lucide-react";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { PixelViewContent } from "@/components/pixel-view-content";
import { PageHero } from "@/components/marketing/page-hero";
import { ReviewsBand } from "@/components/marketing/comic-reviews";
import { TrustPills } from "@/components/marketing/trust-pills";
import { JsonLd } from "@/components/seo/json-ld";
import { ORG_ID, SITE, breadcrumbs, canonical } from "@/lib/seo";
import { getCardsRestoredStat } from "@/lib/site-stats";
import { BulkSwitch } from "@/app/(public)/tier-selection/bulk-switch";
import { BULK_PLANS, bulkPriceCents } from "@/lib/bulk-pricing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "PSA Prep Pricing | The Card Doc",
  description: "Professional card submission prep. $25/card for cards under $1,500. 2% of declared value for high-value cards.",
  alternates: canonical("/prep"),
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

// Cards $1,500 and over are priced at 2% of declared value; bulk pricing takes
// its percent off that too (10% off 2% = 1.8%, 15% off = 1.7%)
const HIGH_VALUE_EXAMPLES_CENTS = [Math.round(200000 * 0.02), Math.round(500000 * 0.02)] as const;

function valueRate(percent: number) {
  return `${Number((2 * (100 - percent) / 100).toFixed(2))}%`;
}

export default async function PrepPage() {
  const [prices, cardsRestored] = await Promise.all([getPrepPrices(), getCardsRestoredStat()]);
  const structured = [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: "PSA Prep",
      serviceType: "Trading card grading submission prep",
      description: "Grade-ready submission prep for PSA, BGS & CGC.",
      url: `${SITE}/prep`,
      provider: { "@id": ORG_ID },
      areaServed: ["US", "PR"],
      offers: {
        "@type": "Offer",
        name: "Cards under $1,500",
        price: (prices.standardPriceCents / 100).toFixed(2),
        priceCurrency: "USD",
        url: `${SITE}/prep`,
      },
    },
    breadcrumbs([{ name: "PSA Prep Pricing", path: "/prep" }]),
  ];

  return (
    <div className="min-h-screen page-glow">
      <JsonLd data={structured} />
      <PixelViewContent contentName="PSA Prep" contentCategory="Prep" />
      <div className="max-w-5xl mx-auto px-4 md:px-10 py-12 md:py-20">

        <PageHero
          className="mb-8"
          eyebrow="Prep Service"
          title="Get Your Cards Grade-Ready"
          lines={["Get Your Cards", "Grade-Ready"]}
          lead={<>We surface-clean and prep your cards so they&apos;re submission-ready. Graders make their own call, so no grade is ever guaranteed.</>}
        />

        <TrustPills cardsRestored={cardsRestored} align="start" className="hero-in mb-12 md:mb-14" />

        {!prices.isOpen && (
          <div className="mb-8 bg-amber-50 border border-amber-300 rounded-md px-5 py-4 text-sm font-semibold text-amber-900 flex items-center gap-2.5">
            <PauseCircle className="h-4 w-4 shrink-0" strokeWidth={2} />
            Prep is temporarily paused — check back soon.
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:items-start hero-in" style={{ ["--d" as string]: 120 }}>
          <div className="flex flex-col gap-8">
            {/* Pricing, per number of cards (bulk pricing, lib/bulk-pricing.ts), as on the Restorations page */}
            <BulkSwitch stacked note="Bulk pricing is applied automatically at checkout to every card. Add-ons and shipping aren't discounted.">
            <div className="relative overflow-hidden rounded-2xl comic-border comic-shadow bg-bone">
              <div className="relative flex items-center justify-between gap-4 border-b-[3px] border-ink bg-rx px-6 py-5 text-white md:px-7">
                <div aria-hidden className="absolute inset-0 halftone-light" />
                <div className="relative">
                  <h2 className="font-heading text-2xl font-black uppercase tracking-[-0.015em] md:text-3xl">Prep Pricing</h2>
                  <p className="mt-1 text-xs font-medium text-white/85">Per card — price based on declared value</p>
                </div>
                <Microscope className="relative h-8 w-8" strokeWidth={1.75} />
              </div>
              <div className="divide-y-2 divide-dashed divide-ink/15">
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
                        <span className="font-heading text-4xl md:text-5xl font-black tracking-[-0.03em] text-ink tabular-nums">{fmt(bulkPriceCents(prices.standardPriceCents, p.percent))}</span>
                      </div>
                    ))}
                    <p className="font-mono text-xs text-muted-foreground">per card</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 px-6 md:px-7 py-6">
                  <div>
                    <p className="font-semibold text-ink">Cards $1,500 and over</p>
                    {/* The examples per plan; the switch above shows the chosen one */}
                    {BULK_PLANS.map((p) => (
                      <p key={p.id} data-plan={p.id} className="text-sm text-muted-foreground mt-0.5">
                        {/* One inline box (the shown plan's <p> is display: flex): a wrap
                            falls after the dot, never before it; from md up each example stays on one line */}
                        <span>
                          e.g. <span className="md:whitespace-nowrap">$2,000 card = {fmt(bulkPriceCents(HIGH_VALUE_EXAMPLES_CENTS[0], p.percent))}&nbsp;&nbsp;·</span>{" "}
                          <span className="md:whitespace-nowrap">$5,000 card = {fmt(bulkPriceCents(HIGH_VALUE_EXAMPLES_CENTS[1], p.percent))}</span>
                        </span>
                      </p>
                    ))}
                  </div>
                  <div className="text-right shrink-0">
                    {/* One rate per plan (2% of value, less the bulk percent) */}
                    {BULK_PLANS.map((p) => (
                      <div key={p.id} data-plan={p.id} className="flex flex-wrap items-baseline justify-end gap-x-2">
                        {p.percent > 0 && (
                          <span className="text-sm text-muted-foreground line-through tabular-nums" aria-label="was 2%">2%</span>
                        )}
                        <span className="font-heading text-4xl md:text-5xl font-black tracking-[-0.03em] text-ink tabular-nums">{valueRate(p.percent)}</span>
                      </div>
                    ))}
                    <p className="font-mono text-xs text-muted-foreground">of declared value</p>
                  </div>
                </div>
              </div>
              <div className="px-6 md:px-7 py-5 bg-cream border-t-[3px] border-ink">
                {prices.isOpen ? (
                  <Link
                    href="/prep/order"
                    className="comic-btn press w-full"
                  >
                    Order Prep
                  </Link>
                ) : (
                  <div className="w-full h-14 rounded-[0.7rem] border-2 border-ink/25 font-heading font-extrabold uppercase tracking-[0.03em] text-sm flex items-center justify-center bg-secondary text-muted-foreground cursor-not-allowed">
                    Currently Paused
                  </div>
                )}
              </div>
            </div>
            </BulkSwitch>

            {/* Add-ons */}
            <div>
              <h2 className="font-heading font-black uppercase tracking-[-0.01em] text-2xl text-ink mb-4">Available Add-Ons</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex items-start gap-3 rounded-2xl border-[2.5px] border-ink bg-bone p-5">
                  <BarChart3 className="h-5 w-5 mt-0.5 shrink-0 text-rx" strokeWidth={1.75} />
                  <div>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <h3 className="font-heading font-extrabold uppercase tracking-[0.01em] text-sm text-ink">Pre-Grade Assessment</h3>
                      <span className="rounded-md bg-rx px-1.5 py-0.5 font-heading text-[11px] font-extrabold text-white">+{fmt(prices.preGradePriceCents)}/card</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                      We assess each card and give you an estimated grade before you submit — so you know what to expect.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border-[2.5px] border-ink bg-bone p-5">
                  <Hammer className="h-5 w-5 mt-0.5 shrink-0 text-rx" strokeWidth={1.75} />
                  <div>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <h3 className="font-heading font-extrabold uppercase tracking-[0.01em] text-sm text-ink">Slab Crack</h3>
                      <span className="rounded-md bg-rx px-1.5 py-0.5 font-heading text-[11px] font-extrabold text-white">+{fmt(prices.slabCrackPriceCents)}/card</span>
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
            <div className="rounded-2xl border-[2.5px] border-red-800/60 bg-red-50 px-6 py-5">
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
                  See our Restoration tiers
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

      <ReviewsBand title="What Our Customers Say" compact id="prep-reviews-heading" />
    </div>
  );
}
