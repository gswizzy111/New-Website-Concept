import { Check, X } from "lucide-react";

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
          className={`py-6 border-b border-rule md:pr-8 ${i % 2 === 1 ? "md:pl-8 md:border-l" : ""}`}
        >
          <h3 className="font-heading text-lg font-bold text-ink mb-1.5">{item.title}</h3>
          <p className="text-[15px] text-muted-foreground leading-relaxed">{item.description}</p>
        </div>
      ))}
    </div>
  );
}

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-paper">
      {/* Hero Section */}
      <div className="max-w-5xl mx-auto px-4 md:px-10 pt-12 pb-10 md:pt-16 md:pb-14">
        <h1 className="font-heading text-4xl md:text-6xl font-extrabold tracking-[-0.03em] text-ink mb-4 max-w-3xl [font-variation-settings:'wdth'_82]">
          How Card Restoration Works
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl">
          Understand what we can restore and what limitations we face in bringing your cards back to life.
        </p>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 md:px-10 pb-20 flex flex-col gap-14 md:gap-16">
        {/* What We Can Reduce */}
        <section>
          <div className="flex items-start gap-4 mb-6">
            <div className="w-10 h-10 rounded-md bg-rx-soft text-rx flex items-center justify-center flex-shrink-0">
              <Check className="w-5 h-5" strokeWidth={2.25} />
            </div>
            <div>
              <h2 className="font-heading text-2xl md:text-3xl font-extrabold tracking-tight text-ink mb-1.5">What We Can Restore</h2>
              <p className="text-muted-foreground">
                Our restoration process can significantly reduce or eliminate the following damage:
              </p>
            </div>
          </div>
          <ItemGrid items={CAN_RESTORE} />
        </section>

        {/* What We Cannot Fix */}
        <section>
          <div className="flex items-start gap-4 mb-6">
            <div className="w-10 h-10 rounded-md bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0">
              <X className="w-5 h-5" strokeWidth={2.25} />
            </div>
            <div>
              <h2 className="font-heading text-2xl md:text-3xl font-extrabold tracking-tight text-ink mb-1.5">Limitations</h2>
              <p className="text-muted-foreground">
                Unfortunately, the following types of damage cannot be restored:
              </p>
            </div>
          </div>
          <ItemGrid items={LIMITATIONS} />
        </section>

        {/* CTA Section */}
        <section className="bg-white border border-rule rounded-lg p-8 md:p-10 md:flex md:items-center md:justify-between md:gap-10">
          <div className="mb-6 md:mb-0">
            <h3 className="font-heading text-2xl font-extrabold tracking-tight text-ink mb-2">Ready to restore your collection?</h3>
            <p className="text-muted-foreground max-w-xl">
              Submit your cards for restoration and see the difference professional care can make.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <a
              href="/restoration"
              className="inline-flex h-11 items-center justify-center px-6 bg-rx text-primary-foreground font-semibold rounded-md hover:bg-rx/90 transition-colors"
            >
              Book Restoration
            </a>
            <a
              href="/shop"
              className="inline-flex h-11 items-center justify-center px-6 border border-ink/70 text-ink font-semibold rounded-md hover:border-ink hover:bg-secondary transition-colors"
            >
              Browse Kits
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
