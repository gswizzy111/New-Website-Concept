import type { Metadata } from "next";
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

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD).replace(/</g, "\\u003c") }} />
    </>
  );
}
