import Link from "next/link";
import { BarChart3, Hammer, Microscope, PauseCircle, X } from "lucide-react";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { PixelViewContent } from "@/components/pixel-view-content";

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
    <div className="min-h-screen bg-paper">
      <PixelViewContent contentName="PSA Prep" contentCategory="Prep" />
      <div className="max-w-5xl mx-auto px-4 md:px-10 py-12 md:py-16">

        <div className="mb-10 md:mb-12 max-w-2xl">
          <p className="rx-label text-rx mb-3">Prep Service</p>
          <h1 className="font-heading text-4xl md:text-6xl font-extrabold tracking-[-0.03em] text-ink mb-4 [font-variation-settings:'wdth'_82]">
            Get Your Cards Grade-Ready
          </h1>
          <p className="text-lg text-muted-foreground">
            We surface-clean and prep your cards so they&apos;re submission-ready. Prep is grader-legal and won&apos;t affect your numeric grade.
          </p>
        </div>

        {!prices.isOpen && (
          <div className="mb-8 bg-amber-50 border border-amber-300 rounded-md px-5 py-4 text-sm font-semibold text-amber-900 flex items-center gap-2.5">
            <PauseCircle className="h-4 w-4 shrink-0" strokeWidth={2} />
            Prep is temporarily paused — check back soon.
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:items-start">
          <div className="flex flex-col gap-8">
            {/* Pricing */}
            <div className="bg-white border border-ink/70 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-ink/70">
                <div>
                  <h2 className="font-heading text-2xl font-extrabold text-ink">Prep Pricing</h2>
                  <p className="font-mono text-xs text-muted-foreground mt-1">Per card — price based on declared value</p>
                </div>
                <span className="flex h-11 w-11 items-center justify-center rounded-md bg-rx-soft text-rx">
                  <Microscope className="h-5 w-5" strokeWidth={1.75} />
                </span>
              </div>
              <div className="divide-y divide-rule">
                <div className="flex items-center justify-between gap-4 px-6 py-5">
                  <div>
                    <p className="font-semibold text-ink">Cards under $1,500</p>
                    <p className="text-sm text-muted-foreground mt-0.5">Surface clean, penny sleeve + semi-rigid holder</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-heading text-3xl font-bold tracking-tight text-ink tabular-nums">{fmt(prices.standardPriceCents)}</p>
                    <p className="font-mono text-xs text-muted-foreground">per card</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 px-6 py-5">
                  <div>
                    <p className="font-semibold text-ink">Cards $1,500 and over</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      e.g. $2,000 card = $40.00 &nbsp;·&nbsp; $5,000 card = $100.00
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-heading text-3xl font-bold tracking-tight text-ink tabular-nums">2%</p>
                    <p className="font-mono text-xs text-muted-foreground">of declared value</p>
                  </div>
                </div>
              </div>
              <div className="px-6 py-5 bg-paper border-t border-rule">
                {prices.isOpen ? (
                  <Link
                    href="/prep/order"
                    className="w-full h-12 rounded-md font-semibold text-[15px] flex items-center justify-center bg-rx text-primary-foreground hover:bg-rx/90 transition-colors"
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
            {/* How it works */}
            <div className="bg-white border border-rule rounded-lg p-6">
              <h2 className="font-heading font-extrabold text-xl text-ink mb-5">How Prep Works</h2>
              <ol className="flex flex-col">
                {[
                  { n: "1", title: "Place your order", body: "Add your cards, choose your add-ons, and choose how to ship them to us." },
                  { n: "2", title: "Ship your cards", body: "Use our prepaid label or ship yourself. We recommend USPS Priority Mail with tracking." },
                  { n: "3", title: "We prep your cards", body: "Our team surface-cleans, inspects, and submission-readies every card — penny sleeve + semi-rigid." },
                  { n: "4", title: "Cards returned", body: "We return your prepped cards ready for submission. Typical turnaround is 10–15 business days." },
                ].map((step, i, all) => (
                  <li key={step.n} className="relative flex items-start gap-4 pb-5 last:pb-0">
                    {i < all.length - 1 && <span className="absolute left-[13px] top-8 bottom-1 w-px bg-rule" aria-hidden />}
                    <div className="w-7 h-7 rounded-md bg-ink text-paper font-mono text-xs flex items-center justify-center shrink-0">
                      {step.n}
                    </div>
                    <div>
                      <p className="font-semibold text-[15px] text-ink">{step.title}</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* Not included */}
            <div className="border border-red-200 bg-red-50/60 rounded-lg px-6 py-5">
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
    </div>
  );
}
