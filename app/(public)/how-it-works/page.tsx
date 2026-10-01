import { Check, X } from "lucide-react";
import { PageHero } from "@/components/marketing/page-hero";

const CAN_RESTORE = [
  {
    title: "Creases",
    description: "We can smooth out creases and fold lines using specialized techniques to restore the card's flatness.",
  },
  {
    title: "Edge Lifts",
    description: "Lifted edges can be carefully addressed to restore the card's structural integrity.",
  },
  {
    title: "Dings & Indents",
    description: "Minor dings and indents can be reduced or removed through our restoration process.",
  },
  {
    title: "Surface Dirt & Grime",
    description: "We professionally clean away surface dirt, dust, and grime while protecting the card's original finish.",
  },
];

const LIMITATIONS = [
  {
    title: "Whitening",
    description:
      "Whitening around the edges or corners is permanent. Our restoration cannot restore the original coloring once bleached.",
  },
  {
    title: "Deep Scratching",
    description:
      "Deep scratches that penetrate the card's surface or print cannot be fully repaired. Minor surface scratches may be reduced.",
  },
];

function ItemGrid({ items }: { items: { title: string; description: string }[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 border-t border-ink/70">
      {items.map((item, i) => (
        <div
          key={item.title}
          className={`py-7 border-b border-rule md:pr-8 ${i % 2 === 1 ? "md:pl-8 md:border-l" : ""}`}
        >
          <h3 className="font-heading text-xl md:text-2xl font-extrabold tracking-[-0.02em] text-ink mb-2 [font-variation-settings:'wdth'_86]">{item.title}</h3>
          <p className="text-[15px] text-muted-foreground leading-relaxed">{item.description}</p>
        </div>
      ))}
    </div>
  );
}

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen page-glow">
      {/* Hero Section */}
      <div className="max-w-5xl mx-auto px-4 md:px-10 pt-12 pb-12 md:pt-20 md:pb-20">
        <PageHero
          title="How Card Restoration Works"
          lines={["How Card", "Restoration Works"]}
          lead="Understand what we can restore and what limitations we face in bringing your cards back to life."
        />
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 md:px-10 pb-20 flex flex-col gap-14 md:gap-16">
        {/* What We Can Reduce */}
        <section data-reveal>
          <div className="flex items-start gap-4 mb-6">
            <Check className="w-6 h-6 mt-1 flex-shrink-0 text-rx" strokeWidth={2.25} />
            <div>
              <h2 className="font-heading text-3xl md:text-5xl font-extrabold tracking-[-0.035em] leading-[0.95] text-ink mb-3 [font-variation-settings:'wdth'_80]">What We Can Restore</h2>
              <p className="text-muted-foreground">
                Our restoration process can significantly reduce or eliminate the following damage:
              </p>
            </div>
          </div>
          <ItemGrid items={CAN_RESTORE} />
        </section>

        {/* What We Cannot Fix */}
        <section data-reveal>
          <div className="flex items-start gap-4 mb-6">
            <X className="w-6 h-6 mt-1 flex-shrink-0 text-red-600" strokeWidth={2.25} />
            <div>
              <h2 className="font-heading text-3xl md:text-5xl font-extrabold tracking-[-0.035em] leading-[0.95] text-ink mb-3 [font-variation-settings:'wdth'_80]">Limitations</h2>
              <p className="text-muted-foreground">
                Unfortunately, the following types of damage cannot be restored:
              </p>
            </div>
          </div>
          <ItemGrid items={LIMITATIONS} />
        </section>

        {/* CTA Section */}
        <section data-reveal className="stage stage-light overflow-hidden rounded-2xl p-8 md:p-12 md:flex md:items-center md:justify-between md:gap-10">
          <div className="mb-8 md:mb-0">
            <h3 className="font-heading text-3xl md:text-4xl font-extrabold tracking-[-0.03em] leading-[1] text-stage-fg mb-3 [font-variation-settings:'wdth'_82]">Ready to restore your collection?</h3>
            <p className="text-stage-muted max-w-xl">
              Submit your cards for restoration and see the difference professional care can make.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <a
              href="/restoration"
              className="btn-depth btn-sheen inline-flex h-12 items-center justify-center px-7 bg-rx text-primary-foreground font-semibold rounded-md hover:bg-rx/90 transition-colors"
            >
              Book Restoration
            </a>
            <a
              href="/shop"
              className="inline-flex h-12 items-center justify-center px-7 border border-white/25 text-stage-fg font-semibold rounded-md hover:border-white/60 hover:bg-white/5 transition-colors"
            >
              Browse Kits
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
