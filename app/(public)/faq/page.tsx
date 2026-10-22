import type { Metadata } from "next";
import { Check, X } from "lucide-react";
import { PageHero } from "@/components/marketing/page-hero";
import { FAQ_SECTIONS } from "./faq-data";
import { FaqSearch } from "./faq-search";

export const metadata: Metadata = {
  title: "FAQ | The Card Doc",
  description: "Answers about restoration and prep: tiers, declared value, slabs, grading, shipping, drop-off and the cards we work on.",
};

// FAQ rich results for search engines
const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_SECTIONS.flatMap((s) =>
    s.items.map((it) => ({ "@type": "Question", name: it.q, acceptedAnswer: { "@type": "Answer", text: it.a } }))
  ),
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

export default function FAQPage() {
  return (
    <>
      {/* Hero */}
      <section className="page-glow border-b border-border pt-14 pb-16 md:pt-24 md:pb-24">
        <div className="max-w-6xl mx-auto px-4 md:px-10">
          <PageHero
            eyebrow="FAQ"
            title="Common questions."
            lead="Everything you need to know before placing your first order."
          />
        </div>
      </section>

      {/* Questions, searchable */}
      <section className="py-14 md:py-20 bg-background">
        <div className="max-w-3xl mx-auto px-6 md:px-8">
          <FaqSearch sections={FAQ_SECTIONS} />
        </div>
      </section>

      {/* Can / Cannot fix */}
      <section className="py-14 md:py-20 bg-white border-t border-border">
        <div className="max-w-4xl mx-auto px-6 md:px-8">
          <h2 className="font-heading text-3xl font-extrabold tracking-[-0.01em] text-ink mb-2 text-center">What we can (and can&apos;t) fix</h2>
          <p className="text-muted-foreground text-sm text-center mb-10">Restoration has real limits. Here&apos;s an honest breakdown.</p>
          <div data-reveal="stagger" className="grid md:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg border border-green-200 p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-7 h-7 rounded-md bg-rx-soft flex items-center justify-center text-rx"><Check className="h-4 w-4" strokeWidth={2.5} /></div>
                <h3 className="font-medium text-foreground">We CAN help with</h3>
              </div>
              <ul className="flex flex-col gap-2.5">
                {canFix.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                    <Check className="h-4 w-4 mt-0.5 shrink-0 text-rx" strokeWidth={2.25} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-white rounded-lg border border-red-200 p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-7 h-7 rounded-md bg-red-50 flex items-center justify-center text-red-600"><X className="h-4 w-4" strokeWidth={2.5} /></div>
                <h3 className="font-medium text-foreground">We CANNOT fix</h3>
              </div>
              <ul className="flex flex-col gap-2.5">
                {cannotFix.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                    <X className="h-4 w-4 mt-0.5 shrink-0 text-red-700" strokeWidth={2.25} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-6">
            Not sure if your card qualifies? DM a photo to{" "}
            <a href="https://www.instagram.com/the_card_doc" target="_blank" rel="noopener noreferrer" className="underline">@the_card_doc</a>{" "}
            on Instagram before ordering.
          </p>
        </div>
      </section>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD).replace(/</g, "\\u003c") }} />
    </>
  );
}
