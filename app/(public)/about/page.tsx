import { Check, Plus, X } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { PageHero } from "@/components/marketing/page-hero";

export const metadata: Metadata = {
  title: "About Us | The Card Doc",
  description: "Learn about The Card Doc — expert PSA prep and card restoration for collectors.",
};

const canFix = [
  "Surface dirt, dust, and fingerprints",
  "Soft or dinged corners",
  "Light surface scratches and scuffs",
  "Dull or hazy surfaces",
  "Minor stains or residue",
  "Light creases (partial reduction possible)",
  "Slight print lines on the surface",
];

const cannotFix = [
  "Deep or permanent creases and folds",
  "Torn, cut, or ripped cards",
  "Water damage and warping",
  "Delamination or missing layers",
  "Factory print defects (miscuts, misprints)",
  "Trimmed or altered edges",
  "Major structural damage",
  "Heavy ink loss or fading",
];

const faqItems = [
  {
    q: "What types of cards do you work on?",
    a: "We restore all trading cards — Pokémon, sports cards (baseball, basketball, football, hockey), Magic: The Gathering, Yu-Gi-Oh!, and more. Vintage or modern, we handle them all.",
  },
  {
    q: "Will restoration affect PSA/BGS grading?",
    a: "Yes. Professional graders can detect restoration and will designate the card as 'Altered' or 'Authentic' rather than giving a numeric grade. We're fully transparent about this — restoration is for collectors who want their cards to look their best, not for preparing cards for numeric grades.",
  },
  {
    q: "How do I ship my cards safely?",
    a: "Sleeve each card in a penny sleeve, then a toploader. Sandwich the toploaders between two pieces of rigid cardboard taped together, then place inside a padded envelope or small box. Always use a tracked, insured service.",
  },
  {
    q: "What if my card can't be fully restored?",
    a: "We'll contact you before starting work if we believe a card won't respond well to treatment. You'll decide whether to proceed, and we'll refund the service portion if we can't meet a reasonable standard.",
  },
  {
    q: "How long does restoration take?",
    a: "Turnaround varies by tier: Regular is 12–15 business days, Expedited is 7–10 business days, Premium is 5–7 business days, and Ultra Premium is 3–5 business days. All times start from when we physically receive your cards.",
  },
  {
    q: "Do you offer refunds?",
    a: "If we determine a card can't be restored to a reasonable standard, we refund the service cost (shipping is non-refundable). Once restoration is complete, refunds aren't offered — but if you're unsatisfied with the result we'll work with you to make it right.",
  },
];

export default function AboutPage() {
  return (
    <>
      {/* Hero */}
      <section className="page-glow border-b border-rule pt-14 pb-16 md:pt-24 md:pb-28">
        <div className="max-w-6xl mx-auto px-4 md:px-10">
          <PageHero
            eyebrow="About Us"
            title="We treat every card like it's worth a fortune."
            lines={["We treat every card", "like it's worth a fortune."]}
            lead={<>The Card Doc is a professional card restoration service built for collectors who care about how their cards look. We don&apos;t cut corners.</>}
          />
        </div>
      </section>


      {/* Can / Cannot fix */}
      <section className="py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-4 md:px-10">
          <h2 className="font-heading text-4xl md:text-6xl font-extrabold tracking-[-0.035em] leading-[0.95] text-ink mb-5 [font-variation-settings:'wdth'_80]">What we can (and can&apos;t) fix</h2>
          <p className="text-muted-foreground mb-10 max-w-xl">
            Restoration has real limits. Here&apos;s an honest breakdown of what our process can address.
          </p>
          <div data-reveal="stagger" className="grid md:grid-cols-2 gap-5">
            {/* Can fix */}
            <div className="rounded-xl bg-white ring-1 ring-rule p-6 md:p-8">
              <div className="flex items-center gap-2.5 mb-4">
                <Check className="h-5 w-5 text-rx" strokeWidth={2.25} />
                <h3 className="font-heading text-xl font-bold text-ink">We CAN help with</h3>
              </div>
              <ul className="border-t border-ink/80 divide-y divide-rule">
                {canFix.map((item) => (
                  <li key={item} className="flex items-start gap-3 py-3 text-[15px] text-ink">
                    <Check className="h-4 w-4 mt-1 shrink-0 text-rx" strokeWidth={2.25} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            {/* Cannot fix */}
            <div className="rounded-xl bg-white ring-1 ring-rule p-6 md:p-8">
              <div className="flex items-center gap-2.5 mb-4">
                <X className="h-5 w-5 text-red-600" strokeWidth={2.25} />
                <h3 className="font-heading text-xl font-bold text-ink">We CANNOT fix</h3>
              </div>
              <ul className="border-t border-ink/80 divide-y divide-rule">
                {cannotFix.map((item) => (
                  <li key={item} className="flex items-start gap-3 py-3 text-[15px] text-ink">
                    <X className="h-4 w-4 mt-1 shrink-0 text-red-600" strokeWidth={2.25} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-8">
            Not sure if your card qualifies? Email us a photo at{" "}
            <a href="mailto:thecarddoc1@gmail.com" className="underline hover:text-ink">thecarddoc1@gmail.com</a>{" "}
            before placing an order.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 md:py-24 bg-paper border-y border-rule">
        <div data-reveal className="max-w-6xl mx-auto px-4 md:px-10 grid gap-8 md:grid-cols-[1fr_1.6fr]">
          <div>
            <h2 className="font-heading text-4xl md:text-6xl font-extrabold tracking-[-0.035em] leading-[0.95] text-ink mb-5 [font-variation-settings:'wdth'_80]">Frequently asked questions</h2>
            <p className="text-muted-foreground mb-5">Everything you need to know before placing your first order.</p>
            <p className="text-sm text-muted-foreground">
              Still have questions?{" "}
              <a href="mailto:thecarddoc1@gmail.com" className="text-rx font-semibold hover:underline">Email us</a>{" "}
              or DM us on{" "}
              <a href="https://www.instagram.com/the_card_doc" target="_blank" rel="noopener noreferrer" className="text-rx font-semibold hover:underline">Instagram</a>.
            </p>
          </div>
          <div className="border-t border-ink/80 border-b border-b-rule divide-y divide-rule">
            {faqItems.map((item) => (
              <details key={item.q} className="group relative">
                <summary className="flex items-center justify-between gap-6 py-6 cursor-pointer list-none select-none font-heading text-lg md:text-xl font-bold tracking-[-0.01em] text-ink [font-variation-settings:'wdth'_92] [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full ring-1 ring-rule transition-[background-color,box-shadow] duration-300 group-hover:ring-rx group-open:bg-rx group-open:ring-rx">
                    <Plus className="h-4 w-4 text-rx transition-transform duration-300 ease-[var(--ease-out)] group-open:rotate-45 group-open:text-primary-foreground" strokeWidth={2} />
                  </span>
                </summary>
                <div className="pb-7 pr-14 text-base text-muted-foreground leading-relaxed max-w-[62ch]">
                  {item.a}
                </div>
                <span aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-px h-px origin-left scale-x-0 bg-rx transition-transform duration-500 ease-[var(--ease-out)] group-hover:scale-x-100 group-open:scale-x-100" />
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Terms & Conditions summary */}
      <section className="py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-4 md:px-10">
          <h2 className="font-heading text-4xl md:text-6xl font-extrabold tracking-[-0.035em] leading-[0.95] text-ink mb-5 [font-variation-settings:'wdth'_80]">Terms & Conditions</h2>
          <p className="text-muted-foreground mb-10">The key points — plain English. Read the full version before submitting.</p>
          <div data-reveal="stagger" className="grid grid-cols-1 md:grid-cols-2 border-t border-ink/80">
            {[
              {
                title: "You assume shipping risk",
                body: "We're not responsible for loss, damage, or theft while cards are in transit to or from us. Use tracked, insured shipping and pack your cards properly.",
              },
              {
                title: "Restoration isn't grading",
                body: "Restored cards will be marked 'Altered' by professional graders (PSA, BGS, etc.) and will not receive a numeric grade. Do not send cards for restoration if you plan to grade them.",
              },
              {
                title: "Results vary",
                body: "Restoration involves subjective judgment. We'll contact you if we don't think we can improve your card. If damage occurs during the process, our liability is limited to the service fee paid.",
              },
              {
                title: "Payment is upfront",
                body: "Full payment is collected at checkout. Service fees are non-refundable once work has begun, except in cases where we cannot restore the card.",
              },
              {
                title: "Inspect within 5 days",
                body: "You must report any issues with returned cards within 5 calendar days of receipt. Claims made after this window are waived.",
              },
              {
                title: "Submit only authentic cards",
                body: "By submitting a card you confirm it's genuine and unaltered. Submitting doctored, trimmed, or counterfeit cards is prohibited. Service fees are non-refundable on such submissions.",
              },
            ].map(({ title, body }, i) => (
              <div key={title} className={`py-6 border-b border-rule md:pr-10 ${i % 2 === 1 ? "md:pl-10 md:border-l" : ""}`}>
                <p className="font-heading text-lg font-bold text-ink mb-1.5">{title}</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <Link
              href="/terms"
              className="inline-flex items-center gap-2 text-sm font-semibold text-rx hover:underline"
            >
              Read the full Terms & Conditions →
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="stage stage-light overflow-hidden py-24 md:py-36">
        <div className="max-w-4xl mx-auto px-6 md:px-10 text-center">
          <h2 data-reveal className="font-heading text-5xl md:text-7xl font-extrabold tracking-[-0.04em] leading-[0.92] text-stage-fg mb-6 [font-variation-settings:'wdth'_78]">Ready to restore your cards?</h2>
          <p className="text-lg text-stage-muted mb-10">Book a restoration or grab a kit and get started today.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/restoration"
              className="btn-depth btn-sheen inline-flex h-12 items-center justify-center px-8 bg-rx text-primary-foreground font-semibold rounded-md hover:bg-rx/90 transition-colors"
            >
              Book Restoration
            </Link>
            <Link
              href="/shop"
              className="inline-flex h-12 items-center justify-center px-8 border border-white/25 text-stage-fg font-semibold rounded-md hover:border-white/60 hover:bg-white/5 transition-colors"
            >
              Browse Kits
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
