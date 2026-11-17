import Link from "next/link";
import { ArrowRight, ClipboardCheck, Clock, Hammer, X } from "lucide-react";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { PixelViewContent } from "@/components/pixel-view-content";
import { PageHero } from "@/components/marketing/page-hero";
import { ReviewsBand } from "@/components/marketing/comic-reviews";
import { TrustPills } from "@/components/marketing/trust-pills";
import { JsonLd } from "@/components/seo/json-ld";
import { ORG_ID, SITE, breadcrumbs, canonical } from "@/lib/seo";
import { BulkSwitch } from "@/app/(public)/tier-selection/bulk-switch";
import { BULK_PLANS, bulkPriceCents } from "@/lib/bulk-pricing";
import { Print, cta } from "@/components/brand";
import bulbasaurDelta from "@/public/home/prep-bulbasaur-delta.jpg";


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
  const prices = await getPrepPrices();
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

  const NOT_INCLUDED = ["Crease work", "Edge & corner work", "Dent removal", "Any restorative work"];
  const priceCls = "font-display text-[64px] font-black leading-[0.82] tracking-[-0.01em] text-ink tabular-nums lining-nums md:text-[80px]";
  const wasCls = "mb-1 text-base font-semibold text-ink-soft line-through tabular-nums";

  return (
    <div className="min-h-screen overflow-x-clip">
      <JsonLd data={structured} />
      <PixelViewContent contentName="PSA Prep" contentCategory="Prep" />

      {/* Paused: a sun notice across the top of the page */}
      {!prices.isOpen && (
        <div className="surface-sun border-b border-ink/10">
          <div className="wrap flex items-center gap-4 py-5 md:py-6">
            <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-sun">
              <Clock className="size-5" strokeWidth={1.75} />
            </span>
            <p className="text-base font-bold leading-snug text-ink md:text-lg">Prep is temporarily paused — check back soon.</p>
          </div>
        </div>
      )}

      <section aria-labelledby="prep-pricing-heading" className="surface-chalk">
        <div className="wrap pt-6 pb-16 md:pt-10 md:pb-24">
          {/* Header, with the cleaning warning and the Bulbasaur Delta Species photo */}
          <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-x-16 gap-y-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
            <div>
              <PageHero
                eyebrow="Prep Service"
                title="Get Your Cards Grade-Ready"
                lines={["Get Your Cards", "Grade-Ready"]}
                lead={<>We surface-clean and prep your cards so they&apos;re submission-ready. Graders make their own call, so no grade is ever guaranteed.</>}
              />
              <TrustPills align="start" className="hero-in mt-8 hidden md:block" />
            </div>
            {/* The warning, then the Ditto (Bulbasaur, EX Delta Species) photo. */}
            {/* Side by side and compact, so the prices start in the first screen. */}
            <figure className="hero-in m-0 grid w-full grid-cols-[minmax(0,1fr)_7.5rem] items-center gap-x-5 sm:grid-cols-[minmax(0,1fr)_9.5rem] lg:grid-cols-[minmax(0,1fr)_15.5rem]">
              <h2 className="caps font-display text-[clamp(1.5rem,6vw,2.125rem)] font-black leading-[0.95] tracking-[0.005em] text-ink [text-wrap:balance]">
                <span className="mb-3 block h-1.5 w-14 rounded-full bg-sun" aria-hidden />
                DONT LEAVE <span className="text-cobalt">DIRT or RESIDUE</span> on your card before Grading!
              </h2>
              <Print
                src={bulbasaurDelta}
                alt="A Ditto card (Bulbasaur, EX Delta Species) held in a black glove, with a cotton swab and cloth beside it"
                aspect="900/1200"
                tilt={2.5}
                lift
                priority
                sizes="(min-width: 1024px) 248px, 152px"
                className="w-full"
              />
            </figure>
          </div>

          <div className="mt-8 grid gap-10 md:mt-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start lg:gap-12">
            {/* Pricing, per number of cards (bulk pricing, lib/bulk-pricing.ts), as on the Restorations page */}
            <BulkSwitch stacked note="Bulk pricing is applied automatically at checkout to every card. Add-ons and shipping aren't discounted.">
              <div className="overflow-hidden rounded-2xl bg-white shadow-[0_0_0_1px_var(--line),var(--panel-shadow)]">
                <div className="surface-ink px-6 py-6 md:px-8 md:py-7">
                  <h2 id="prep-pricing-heading" className="display-md text-white">Prep Pricing</h2>
                  <p className="mt-2.5 text-[15px] font-medium text-on-dark-muted">Per card — price based on declared value</p>
                </div>

                <div className="divide-y divide-line">
                  <div className="flex flex-col gap-5 px-6 py-7 sm:flex-row sm:items-end sm:justify-between sm:gap-6 md:px-8">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2.5 font-display text-[28px] font-extrabold leading-none text-ink">
                        <span aria-hidden className="h-[18px] w-[13px] shrink-0 rounded-[3px] bg-cobalt" />
                        Cards under $1,500
                      </p>
                      <p className="mt-2.5 text-[15px] leading-relaxed text-ink-soft">Surface clean, penny sleeve + semi-rigid holder</p>
                    </div>
                    <div className="shrink-0 sm:text-right">
                      {/* One price per plan; the switch above shows the chosen one */}
                      {BULK_PLANS.map((p) => (
                        <div key={p.id} data-plan={p.id} className="flex flex-wrap items-end gap-x-3 sm:justify-end">
                          {p.percent > 0 && (
                            <span className={wasCls} aria-label={`was ${fmt(prices.standardPriceCents)}`}>{fmt(prices.standardPriceCents)}</span>
                          )}
                          <span className={priceCls}>{fmt(bulkPriceCents(prices.standardPriceCents, p.percent))}</span>
                        </div>
                      ))}
                      <p className="label-caps mt-2.5 text-[13px] text-cobalt">per card</p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-5 px-6 py-7 sm:flex-row sm:items-end sm:justify-between sm:gap-6 md:px-8">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2.5 font-display text-[28px] font-extrabold leading-none text-ink">
                        <span aria-hidden className="h-[18px] w-[13px] shrink-0 rounded-[3px] bg-sun-deep" />
                        Cards $1,500 and over
                      </p>
                      {/* The examples per plan; the switch above shows the chosen one */}
                      {BULK_PLANS.map((p) => (
                        <p key={p.id} data-plan={p.id} className="mt-2.5 text-[15px] leading-relaxed text-ink-soft">
                          {/* One inline box (the shown plan's <p> is display: flex): a wrap
                              falls after the dot, never before it; from md up each example stays on one line */}
                          <span>
                            e.g. <span className="md:whitespace-nowrap">$2,000 card = {fmt(bulkPriceCents(HIGH_VALUE_EXAMPLES_CENTS[0], p.percent))}&nbsp;&nbsp;·</span>{" "}
                            <span className="md:whitespace-nowrap">$5,000 card = {fmt(bulkPriceCents(HIGH_VALUE_EXAMPLES_CENTS[1], p.percent))}</span>
                          </span>
                        </p>
                      ))}
                    </div>
                    <div className="shrink-0 sm:text-right">
                      {/* One rate per plan (2% of value, less the bulk percent) */}
                      {BULK_PLANS.map((p) => (
                        <div key={p.id} data-plan={p.id} className="flex flex-wrap items-end gap-x-3 sm:justify-end">
                          {p.percent > 0 && (
                            <span className={wasCls} aria-label="was 2%">2%</span>
                          )}
                          <span className={priceCls}>{valueRate(p.percent)}</span>
                        </div>
                      ))}
                      <p className="label-caps mt-2.5 text-[13px] text-cobalt">of declared value</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-line bg-chalk/60 px-6 py-6 md:px-8">
                  {prices.isOpen ? (
                    <Link href="/prep/order" className={cta({ size: "lg", className: "w-full" })}>
                      Order Prep
                      <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
                    </Link>
                  ) : (
                    <div className="flex min-h-[58px] w-full cursor-not-allowed items-center justify-center rounded-full bg-white font-display text-lg font-extrabold uppercase tracking-[0.05em] text-ink-soft shadow-[inset_0_0_0_1.5px_var(--line)]">
                      Currently Paused
                    </div>
                  )}
                </div>
              </div>
            </BulkSwitch>

            <div className="flex flex-col gap-8">
              {/* Not included */}
              <div className="rounded-2xl bg-white p-6 shadow-[0_0_0_1px_var(--line)] md:p-8">
                <p className="eyebrow text-cobalt">Prep does not include:</p>
                <ul className="mt-5 grid gap-x-6 gap-y-3 min-[400px]:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {NOT_INCLUDED.map((item) => (
                    <li key={item} className="flex items-center gap-3 text-[15px] font-bold text-ink">
                      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-chalk text-ink">
                        <X className="size-3.5" strokeWidth={2.75} />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
                <p className="mt-7 border-t border-line pt-6 text-[15px] text-ink">
                  Need restoration?{" "}
                  <Link href="/tier-selection" className="tlink font-bold text-cobalt">
                    See our Restoration tiers
                  </Link>
                </p>
              </div>

              {/* Add-ons */}
              <div>
                <h2 className="display-sm text-ink">Available Add-Ons</h2>
                <ul className="mt-5 grid gap-4">
                  {[
                    {
                      Icon: ClipboardCheck,
                      title: "Pre-Grade Assessment",
                      price: prices.preGradePriceCents,
                      body: "We assess each card and give you an estimated grade before you submit — so you know what to expect.",
                    },
                    {
                      Icon: Hammer,
                      title: "Slab Crack",
                      price: prices.slabCrackPriceCents,
                      body: "Already graded? We carefully crack the slab and include the raw card in your prep order.",
                    },
                  ].map(({ Icon, title, price, body }) => (
                    <li key={title} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-4 rounded-2xl bg-white p-5 shadow-[0_0_0_1px_var(--line)] md:p-6">
                      <span aria-hidden className="grid size-11 place-items-center rounded-xl bg-cobalt-wash text-cobalt">
                        <Icon className="size-5" strokeWidth={1.75} />
                      </span>
                      <div>
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <h3 className="font-display text-[24px] font-extrabold leading-none text-ink">{title}</h3>
                          <span className="font-display text-[24px] font-black leading-none text-cobalt tabular-nums">+{fmt(price)}/card</span>
                        </div>
                        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-sm text-ink-soft">Add-ons are selected during the order process.</p>
              </div>
            </div>
          </div>
          {/* Phones: the trust facts follow the prices, as on the Restorations page. */}
          <TrustPills align="start" className="mt-10 md:hidden" />
        </div>
      </section>

      <ReviewsBand title="What Our Customers Say" compact id="prep-reviews-heading" />
    </div>
  );
}
