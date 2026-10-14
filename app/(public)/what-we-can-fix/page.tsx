import Link from "next/link";
import type { Metadata } from "next";
import { ArrowDown, Check, X } from "lucide-react";
import { PageHero } from "@/components/marketing/page-hero";

export const metadata: Metadata = {
  title: "What We Can Fix | The Card Doc",
  description:
    "What The Card Doc can and can't fix on sports cards and TCG cards like Pokémon, One Piece, Magic and Yu-Gi-Oh!.",
};

type Item = { text: string; strong?: boolean };

// The owner's lists, word for word.
const CATEGORIES: {
  id: string;
  title: string;
  subtitle?: string;
  can: Item[];
  cannot: Item[];
}[] = [
  {
    id: "sports",
    title: "Sports cards",
    can: [
      { text: "Edge lifts and corner lifts (not wear)" },
      { text: "Dents/dimples" },
      { text: "Creases" },
      { text: "Surface dirt, fingerprints, film/residue — cleaned off/improved" },
      { text: "Minor stains — only if the stain is on the surface" },
      { text: "Minor bends — reduced with humidity work" },
      { text: "Water damage/warping" },
    ],
    cannot: [
      { text: "Whitening / silvering, including edge and corner whitening" },
      { text: "Centering / off-centering" },
      { text: "Corner dings and corner wear" },
      { text: "Edge wear and edge chipping" },
      { text: "Chrome-surface damage: roller lines, deep scratches, and indentations" },
      { text: "Most Factory Defects" },
      { text: "Deep scratches" },
    ],
  },
  {
    id: "tcg",
    title: "TCG",
    subtitle: "(Pokémon, One Piece, Magic, Yu-Gi-Oh!, etc.)",
    can: [
      { text: "Edge lifts and corner lifts" },
      { text: "Dents, dimples, dings" },
      { text: "Surface cleaning — dirt, dust, grime, fingerprints, residue" },
      { text: "Creases — light/moderate reduced or eliminated; deep only reduced" },
      { text: "Holo lifting/blistering" },
      { text: "Holo polishing" },
      { text: "Water damage/warping" },
    ],
    cannot: [
      { text: "Whitening", strong: true },
      { text: "Deep Scratching" },
      { text: "Centering" },
      { text: "Deep creases; creases that fully extend through the card" },
      { text: "Chipping where material is gone" },
      { text: "Print lines / factory defects, tears, delamination, fading" },
    ],
  },
];

// "Main point — detail": the detail after the dash reads one step quieter.
function ItemText({ item }: { item: Item }) {
  const [main, ...rest] = item.text.split(" — ");
  return (
    <span className={item.strong ? "font-semibold" : undefined}>
      {main}
      {rest.length > 0 && <span className="text-muted-foreground"> — {rest.join(" — ")}</span>}
    </span>
  );
}

function FixList({ kind, items }: { kind: "can" | "cannot"; items: Item[] }) {
  const can = kind === "can";
  const Icon = can ? Check : X;
  return (
    <div className="relative bg-white border border-ink/70 rounded-xl shadow-[0_40px_70px_-50px_oklch(0.25_0.006_70/0.6)]">
      <div
        className={`flex items-center justify-between gap-4 px-6 md:px-7 py-5 border-b border-ink/70 border-t-[6px] rounded-t-xl ${
          can ? "border-t-rx" : "border-t-ink"
        }`}
      >
        <h3 className="font-heading text-xl md:text-2xl font-extrabold tracking-[-0.01em] text-ink">
          {can ? "Things We CAN Work on" : "Things we CANNOT fix"}
        </h3>
        <Icon className={`h-6 w-6 shrink-0 ${can ? "text-rx" : "text-red-600"}`} strokeWidth={2} />
      </div>
      <ul className="divide-y divide-rule">
        {items.map((item) => (
          <li key={item.text} className="flex items-start gap-3 px-6 md:px-7 py-3.5 text-[15px] leading-relaxed text-ink">
            <Icon className={`h-4 w-4 mt-[0.3rem] shrink-0 ${can ? "text-rx" : "text-red-600"}`} strokeWidth={2.25} />
            <ItemText item={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function WhatWeCanFixPage() {
  return (
    <div className="min-h-screen page-glow">
      {/* Hero */}
      <div className="max-w-6xl mx-auto px-4 md:px-10 pt-12 pb-10 md:pt-20 md:pb-16">
        <PageHero
          eyebrow="What We Can Fix"
          title="What we can (and can't) fix"
          lines={["What we can", "(and can't) fix"]}
          lead={<>Restoration has real limits. Here&apos;s an honest breakdown.</>}
        />
        <nav aria-label="Card types" className="hero-in mt-8 flex flex-wrap gap-2.5" style={{ ["--d" as string]: 380 }}>
          {CATEGORIES.map((c) => (
            <a
              key={c.id}
              href={`#${c.id}`}
              className="press group inline-flex h-11 items-center gap-2 rounded-md border border-rule bg-white/70 px-4 text-[15px] font-semibold text-ink hover:border-ink/40 hover:bg-white transition-colors duration-150"
            >
              {c.title}
              <ArrowDown className="h-4 w-4 text-rx transition-transform duration-200 group-hover:translate-y-0.5" strokeWidth={2} />
            </a>
          ))}
        </nav>
      </div>

      {/* One section per card type */}
      <div className="max-w-6xl mx-auto px-4 md:px-10 pb-20 md:pb-28 flex flex-col gap-16 md:gap-24">
        {CATEGORIES.map((c, i) => (
          <section key={c.id} id={c.id} aria-labelledby={`${c.id}-title`}>
            <div data-reveal className="mb-7 md:mb-9 border-t border-ink/80 pt-5 md:pt-6">
              <p className="rx-label text-rx mb-3 tabular-nums">{String(i + 1).padStart(2, "0")}</p>
              <h2
                id={`${c.id}-title`}
                className="font-heading text-4xl md:text-6xl font-extrabold tracking-[-0.02em] leading-[0.95] text-ink"
              >
                {c.title}
                {c.subtitle && (
                  <span className="block mt-3 font-sans text-base md:text-lg font-medium tracking-normal leading-snug text-muted-foreground">
                    {c.subtitle}
                  </span>
                )}
              </h2>
            </div>
            <div data-reveal="stagger" className="grid gap-5 md:grid-cols-2 md:items-start">
              <FixList kind="can" items={c.can} />
              <FixList kind="cannot" items={c.cannot} />
            </div>
          </section>
        ))}

        {/* Closing call to action */}
        <section
          data-reveal
          className="stage stage-light overflow-hidden rounded-2xl p-8 md:p-12 md:flex md:items-center md:justify-between md:gap-10"
        >
          <div className="mb-8 md:mb-0">
            <h2 className="font-heading text-3xl md:text-4xl font-extrabold tracking-[-0.015em] leading-[1] text-stage-fg mb-3">
              Not sure if your card qualifies?
            </h2>
            <p className="text-stage-muted max-w-xl">
              Email us a photo at{" "}
              <a href="mailto:thecarddoc1@gmail.com" className="underline text-stage-fg hover:text-rx-bright">
                thecarddoc1@gmail.com
              </a>{" "}
              before placing an order.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <Link
              href="/tier-selection"
              className="btn-depth btn-sheen inline-flex h-12 items-center justify-center px-7 bg-rx text-primary-foreground font-semibold rounded-md hover:bg-rx/90 transition-colors"
            >
              Book Restoration
            </Link>
            <a
              href="mailto:thecarddoc1@gmail.com"
              className="inline-flex h-12 items-center justify-center px-7 border border-white/25 text-stage-fg font-semibold rounded-md hover:border-white/60 hover:bg-white/5 transition-colors"
            >
              Email us
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
