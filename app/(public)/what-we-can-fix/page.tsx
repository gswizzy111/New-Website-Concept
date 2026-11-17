import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { canonical } from "@/lib/seo";
import { ArrowDown, ArrowRight, Camera, Check, X } from "lucide-react";
import { PageHero } from "@/components/marketing/page-hero";
import { CtaPanel, Print, Seamless, cta } from "@/components/brand";
import { RESULTS } from "@/lib/about";
import { cn } from "@/lib/utils";
import mantlePair from "@/public/home/mantle-pair.jpg";
import mantleDetail from "@/public/about/mantle-detail-before.jpg";
import garchomp from "@/public/home/garchomp.jpg";
import charmanderPair from "@/public/home/charmander-pair.jpg";

export const metadata: Metadata = {
  alternates: canonical("/what-we-can-fix"),
  title: "What We Can Fix | The Card Doc",
  description:
    "What The Card Doc can and can't fix on sports cards and TCG cards like Pokémon, One Piece, Magic and Yu-Gi-Oh!.",
};

const INSTAGRAM = "https://www.instagram.com/the_card_doc";

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
function ItemText({ item, dark = false }: { item: Item; dark?: boolean }) {
  const [main, ...rest] = item.text.split(" — ");
  return (
    <span className={item.strong ? "font-extrabold" : undefined}>
      {main}
      {rest.length > 0 && <span className={dark ? "text-on-dark-muted" : "text-ink-soft"}> — {rest.join(" — ")}</span>}
    </span>
  );
}

// One side of the chart: what we can work on (white, green checks) or what we
// can't fix (ink, crossed out in sun).
function FixList({ kind, items }: { kind: "can" | "cannot"; items: Item[] }) {
  const can = kind === "can";
  const Icon = can ? Check : X;
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl",
        can ? "bg-white text-ink shadow-[0_0_0_1px_var(--line),var(--panel-shadow)]" : "surface-ink"
      )}
    >
      <div className={cn("flex items-center gap-3 px-6 pt-6 pb-4 md:px-7", can ? "border-b-2 border-ink" : "border-b border-line-dark")}>
        <span
          aria-hidden
          className={cn("grid size-8 shrink-0 place-items-center rounded-full", can ? "bg-success-tint text-success" : "bg-sun text-ink")}
        >
          <Icon className="size-4" strokeWidth={2.75} />
        </span>
        <h3 className={cn("font-display text-[28px] font-black leading-none md:text-[30px]", can ? "text-ink" : "text-white")}>
          {can ? "Things We CAN Work on" : "Things we CANNOT fix"}
        </h3>
      </div>
      <ul className={cn("divide-y", can ? "divide-line" : "divide-line-dark")}>
        {items.map((item) => (
          <li key={item.text} className="flex items-start gap-3 px-6 py-3.5 text-[15px] leading-relaxed md:px-7 md:text-base">
            <Icon
              aria-hidden
              className={cn("mt-[0.3rem] size-4 shrink-0", can ? "text-success" : "text-sun")}
              strokeWidth={2.5}
            />
            <ItemText item={item} dark={!can} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A small label pinned to a gallery photo (the owner's own words). */
function Tag({ children, tone = "ink", className }: { children: React.ReactNode; tone?: "ink" | "sun"; className?: string }) {
  return (
    <span
      className={cn(
        "label-caps absolute z-[2] rounded-[5px] px-2.5 py-1.5 text-[15px]",
        tone === "sun" ? "bg-sun text-ink" : "bg-ink/85 text-white",
        className
      )}
    >
      {children}
    </span>
  );
}

export default function WhatWeCanFixPage() {
  const mantle = RESULTS.find((r) => r.id === "mickey-mantle");
  const charmander = RESULTS.find((r) => r.id === "charmander");
  const tcg = CATEGORIES.find((c) => c.id === "tcg");
  // The gallery's labels, taken word for word from the owner's lists.
  // TCG "Creases — light/moderate …": the label keeps only the main point.
  const creases = tcg?.can.find((i) => i.text.startsWith("Creases"))?.text.split(" — ")[0];
  const lifts = tcg?.can.find((i) => i.text === "Edge lifts and corner lifts")?.text;

  return (
    <div className="min-h-screen overflow-x-clip">
      {/* Header */}
      <section className="surface-chalk">
        <div className="wrap grid items-center gap-x-16 gap-y-12 pt-12 pb-14 md:pt-20 md:pb-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
          <div className="min-w-0">
          <PageHero
            eyebrow="What We Can Fix"
            title="What we can (and can't) fix"
            lines={["What we can", "(and can't) fix"]}
            lead={<>Restoration has real limits. Here&apos;s an honest breakdown.</>}
          />
          <nav aria-label="Card types" className="hero-in mt-9 flex flex-wrap gap-3.5" style={{ ["--d" as string]: 380 }}>
            {CATEGORIES.map((c) => (
              <a key={c.id} href={`#${c.id}`} className={cta({ tone: "outline", size: "md" })}>
                {c.title}
                <ArrowDown aria-hidden className="size-4" strokeWidth={2} />
              </a>
            ))}
          </nav>
          </div>
          {/* The Mantle's cracking, up close, as a print */}
          <Print
            src={mantleDetail}
            alt="A close-up of the cracking across the Mickey Mantle card's cap, face and jersey"
            aspect="880/760"
            position="38% 32%"
            tilt={3.5}
            border="lg"
            enterDelay={160}
            priority
            caption={
              mantle && (
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span>{mantle.card}</span>
                  <span className="font-sans text-[12px] font-bold tracking-[0.08em] text-cobalt">{mantle.detail}</span>
                </span>
              )
            }
            sizes="(min-width: 1024px) 400px, 80vw"
            className="mx-auto w-full max-w-[min(100%,19rem,calc((46vh-4rem)*1.16))] md:max-w-[22rem] lg:max-w-none"
          />
        </div>
      </section>

      {/* The gallery: real cards, real damage, each crop different */}
      <section aria-label="Before and after" className="surface-ink">
        <div className="wrap py-14 md:py-20">
          <div className="grid gap-5 md:grid-cols-12 md:gap-6">
            <figure data-reveal className="m-0 md:col-span-7">
              <Seamless
                src={mantlePair}
                alt="A cracked Mickey Mantle card in a black glove next to the same card after restoration in a blue glove"
                aspect="1446/902"
                inset="4% 4% 3%"
                sizes="(min-width: 1280px) 720px, (min-width: 768px) 56vw, 92vw"
              >
                <span className="ba-label left-4">Before</span>
                <span className="ba-label right-4" style={{ background: "var(--sun)", color: "var(--ink)" }}>After</span>
              </Seamless>
              {mantle && (
                <figcaption className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="caps font-display text-[26px] font-black leading-none text-white">{mantle.card}</span>
                  <span className="text-sm font-bold text-sun">{mantle.detail}</span>
                  <span className="mt-2 block w-full max-w-[60ch] text-[15px] leading-relaxed text-on-dark-muted">{mantle.caption}</span>
                </figcaption>
              )}
            </figure>

            <div className="grid gap-5 md:col-span-5 md:gap-6">
            <figure data-reveal style={{ transitionDelay: "80ms" }} className="m-0">
              <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-black">
                <Image
                  src={charmanderPair}
                  alt="A Charmander card before restoration, worn and bent, beside the same card after"
                  fill
                  sizes="(min-width: 768px) 40vw, 92vw"
                  className="object-cover object-[50%_30%] transition-transform duration-700 ease-[var(--ease-out)] hover:scale-[1.04] motion-reduce:transition-none"
                />
                {creases && <Tag className="bottom-4 left-4">{creases}</Tag>}
              </div>
              {charmander && (
                <figcaption className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="caps font-display text-[26px] font-black leading-none text-white">{charmander.card}</span>
                  <span className="text-sm font-bold text-sun">{charmander.detail}</span>
                  <span className="mt-2 block w-full max-w-[60ch] text-[15px] leading-relaxed text-on-dark-muted">{charmander.caption}</span>
                </figcaption>
              )}
            </figure>

            <figure data-reveal style={{ transitionDelay: "140ms" }} className="relative m-0">
              <Seamless
                src={garchomp}
                alt="A Garchomp holo card corner, before and after"
                aspect="16/10"
                backdrop="chalk"
                inset="4% 6% 7%"
                sizes="(min-width: 768px) 40vw, 92vw"
              >
                {lifts && <Tag className="bottom-4 left-4">{lifts}</Tag>}
              </Seamless>
            </figure>
            </div>
          </div>

          <div className="mt-8 flex md:mt-10 md:justify-end">
            <Link href="/tier-selection" className={cta({ size: "lg" })}>
              Book Restoration
              <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
            </Link>
          </div>
        </div>
      </section>

      {/* One section per card type */}
      {CATEGORIES.map((c, i) => (
        <section
          key={c.id}
          id={c.id}
          aria-labelledby={`${c.id}-title`}
          className={cn("scroll-mt-24", i % 2 === 0 ? "surface-chalk" : "surface-white")}
        >
          <div className="wrap section-y">
            <div data-reveal className="mb-10 md:mb-14">
              <div className="flex items-baseline gap-3 md:gap-5">
                <span aria-hidden className="font-display text-[56px] font-black leading-none tracking-[-0.02em] text-cobalt md:text-[96px]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h2 id={`${c.id}-title`} className="min-w-0 display-lg text-ink">
                  {c.title}
                </h2>
              </div>
              {c.subtitle && (
                <p className="mt-3 font-sans text-base font-semibold leading-snug text-ink-soft md:text-lg">{c.subtitle}</p>
              )}
            </div>
            <div data-reveal="stagger" className="grid gap-6 md:grid-cols-2 md:items-stretch md:gap-7">
              <FixList kind="can" items={c.can} />
              <FixList kind="cannot" items={c.cannot} />
            </div>
          </div>
        </section>
      ))}

      {/* Closing call to action */}
      <section className={CATEGORIES.length % 2 === 0 ? "surface-chalk" : "surface-white"}>
        <div className="wrap py-16 md:py-24">
          <CtaPanel
            tone="cobalt"
            title="Not sure if your card qualifies?"
            lead={
              <>
                DM us a photo on Instagram at{" "}
                <a href={INSTAGRAM} target="_blank" rel="noopener noreferrer" className="font-bold text-white underline decoration-sun decoration-2 underline-offset-4 hover:decoration-white">
                  @the_card_doc
                </a>{" "}
                before placing an order.
              </>
            }
            actions={
              <>
                <Link href="/tier-selection" className={cta({ size: "lg" })}>
                  Book Restoration
                  <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
                </Link>
                <a href={INSTAGRAM} target="_blank" rel="noopener noreferrer" className={cta({ tone: "outline-light", size: "lg" })}>
                  <Camera aria-hidden className="size-5" strokeWidth={1.75} />
                  DM us on Instagram
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </>
            }
          />
        </div>
      </section>
    </div>
  );
}
