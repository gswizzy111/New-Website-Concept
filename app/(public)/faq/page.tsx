import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { canonical } from "@/lib/seo";
import { PageHero } from "@/components/marketing/page-hero";
import { Print, cta } from "@/components/brand";
import charmanderAfter from "@/public/home/charmander-after.jpg";
import mantleBeforeHeld from "@/public/home/mantle-before-held.jpg";
import charmanderPair from "@/public/home/charmander-pair.jpg";
import { FAQ_SECTIONS } from "./faq-data";
import { FaqSearch } from "./faq-search";

export const metadata: Metadata = {
  alternates: canonical("/faq"),
  title: "FAQ | The Card Doc",
  description: "Answers about restoration and prep: tiers, declared value, slabs, grading, shipping, drop-off and the cards we work on.",
};

const INSTAGRAM = "https://www.instagram.com/the_card_doc";

// FAQ rich results for search engines
const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_SECTIONS.flatMap((s) =>
    s.items.map((it) => ({ "@type": "Question", name: it.q, acceptedAnswer: { "@type": "Answer", text: it.a } }))
  ),
};

/** Before you order: the owner's Free Photo Review, compact enough for the topics column. */
function FreePhotoReview({ id }: { id: string }) {
  return (
    <section aria-labelledby={id} className="surface-ink relative overflow-hidden rounded-[22px] p-5 md:p-6">
      <div className="flex items-start gap-4">
        <Print
          src={charmanderPair}
          alt="A Charmander card before and after restoration, side by side"
          aspect="576/513"
          surface="dark"
          border="sm"
          tilt={-4}
          sizes="128px"
          className="mt-1 w-[7.5rem] shrink-0 lg:w-[6.5rem]"
        />
        <div className="min-w-0">
          <p className="eyebrow text-[15px] text-sun">Before You Order</p>
          <h2 id={id} className="mt-2 font-display text-[30px] font-black leading-[0.92] text-white">
            Free Photo Review
          </h2>
        </div>
      </div>
      <p className="mt-4 text-[15px] leading-relaxed text-on-dark-muted">
        Message @the_card_doc with the front, back, and close-ups of any damage, and we&apos;ll give you an honest read on what&apos;s possible before you spend anything.
      </p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row lg:flex-col">
        <Link href="/tier-selection" className={cta({ size: "md", className: "justify-center" })}>
          Book a Restoration
          <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
        </Link>
        <a href={INSTAGRAM} target="_blank" rel="noopener noreferrer" className={cta({ tone: "outline-light", size: "md", className: "justify-center" })}>
          @the_card_doc
          <ArrowUpRight aria-hidden className="size-5" strokeWidth={2} />
          <span className="sr-only">on Instagram (opens in a new tab)</span>
        </a>
      </div>
    </section>
  );
}

export default function FAQPage() {
  return (
    <div className="overflow-x-clip">
      {/* Hero: the question, with two real cards at the edge on wide screens */}
      <section className="surface-chalk relative">
        <div className="wrap relative pt-14 pb-12 md:pt-24 md:pb-16">
          <PageHero
            eyebrow="FAQ"
            title="Common questions."
            lead="Everything you need to know before placing your first order."
            className="relative z-[1] max-w-3xl"
          />
          <div aria-hidden className="pointer-events-none absolute top-14 right-[var(--gut)] hidden w-[22rem] lg:block xl:w-[26rem]">
            <div className="relative aspect-[6/5]">
              <Print
                src={mantleBeforeHeld}
                alt=""
                aspect="4/5"
                position="50% 22%"
                tilt={-7}
                enterDelay={200}
                sizes="200px"
                className="absolute top-[6%] left-0 w-[48%]"
              />
              <Print
                src={charmanderAfter}
                alt=""
                aspect="364/503"
                tilt={6}
                enterDelay={340}
                sizes="200px"
                className="absolute top-0 right-[4%] w-[44%]"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Questions, searchable */}
      <section className="surface-chalk pb-20 md:pb-28">
        <div className="wrap">
          <FaqSearch sections={FAQ_SECTIONS} aside={<FreePhotoReview id="photo-review-heading" />} asideWide={<FreePhotoReview id="photo-review-heading-wide" />} />
        </div>
      </section>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD).replace(/</g, "\\u003c") }} />
    </div>
  );
}
