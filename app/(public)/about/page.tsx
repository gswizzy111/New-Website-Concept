import Link from "next/link";
import type { Metadata } from "next";
import { canonical } from "@/lib/seo";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Droplets,
  Flame,
  ScanSearch,
  Sparkles,
  Star,
  UserRound,
  Waves,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { SplitReveal } from "@/components/motion/split-reveal";
import { CountUp } from "@/components/motion/count-up";
import { FeaturedReview, ReviewBubbles } from "@/components/marketing/comic-reviews";
import { PhotoFigure } from "@/components/about/photo-figure";
import { AcrylicHolder, SectionHead, StatBlock, cta } from "@/components/brand";
import { getCardsFinishedStat } from "@/lib/site-stats";
import { FOUNDERS, FOUNDERS_MESSAGE, HERO, PROCESS, REASONS, STORY } from "@/lib/about";
import { siteUrl } from "@/lib/site-url";
import { cn } from "@/lib/utils";
import gyaradosBefore from "@/public/specimen-gyarados-before.jpg";
import gyaradosAfter from "@/public/specimen-gyarados-after.jpg";
import { BeforeAfter } from "@/components/motion/before-after";

// The finished-cards figure is read from the database; refresh it hourly.
export const revalidate = 3600;

// The site's own address (set in Netlify), so the share image and structured
// data point at the domain the page is served from.
const SITE = siteUrl();
// The root layout has no metadataBase, so the share image needs a full URL.
const OG_IMAGE = { url: `${SITE}/og-image.png`, width: 1254, height: 1254 };
const INSTAGRAM = "https://www.instagram.com/the_card_doc";
const DESCRIPTION =
  "Built by collectors, trusted with collections. Meet Owen and Gavin, the collectors behind The Card Doc, with 30+ years of combined collecting experience.";

export const metadata: Metadata = {
  alternates: canonical("/about"),
  title: "About Us | The Card Doc",
  description: DESCRIPTION,
  openGraph: {
    title: "About The Card Doc",
    description: DESCRIPTION,
    url: `${SITE}/about`,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary",
    title: "About The Card Doc",
    description: DESCRIPTION,
    images: [OG_IMAGE.url],
  },
};

// Only what's true: the two founders by first name, the shop's town (as on
// How It Works), the US service area and the Instagram the site points to.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  name: "About The Card Doc",
  url: `${SITE}/about`,
  description: DESCRIPTION,
  mainEntity: {
    "@type": "Organization",
    "@id": `${SITE}/#organization`,
    name: "The Card Doc",
    url: SITE,
    description: "Trading card restoration and grading prep, done by hand.",
    founder: FOUNDERS.map((f) => ({ "@type": "Person", name: f.name })),
    address: { "@type": "PostalAddress", addressLocality: "Ridgewood", addressRegion: "NJ", addressCountry: "US" },
    areaServed: { "@type": "Country", name: "United States" },
    sameAs: [INSTAGRAM],
  },
};

const REASON_ICONS: LucideIcon[] = [UserRound, Star, ScanSearch, BadgeCheck];
const METHOD_ICONS: LucideIcon[] = [Sparkles, Waves, Droplets, Flame, Wrench];

/** Instagram link label: the new-tab note for screen readers. */
function InstagramNote() {
  return <span className="sr-only">on Instagram (opens in a new tab)</span>;
}

function BookCta({ tone = "sun", className }: { tone?: "sun" | "ink"; className?: string }) {
  return (
    <Link href="/tier-selection" className={cta({ tone, size: "lg", className })}>
      Book a Restoration
      <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
    </Link>
  );
}

export default async function AboutPage() {
  const cardsFinished = await getCardsFinishedStat();
  const [lineOne, lineTwo] = HERO.headline;

  return (
    <div className="overflow-x-clip">
      {/* ── Hero: cobalt, the founders' line, before and after in hand ─────── */}
      <section aria-labelledby="about-heading" className="surface-cobalt relative isolate overflow-hidden">
        <span aria-hidden className="halftone-dots -right-[8%] -top-[14%] h-[120%] w-[64%]" />
        <span aria-hidden className="halftone-dots -bottom-[34%] -left-[22%] h-[70%] w-[56%] opacity-70" />
        <div className="wrap grid items-center gap-x-14 gap-y-12 pt-12 pb-20 md:pt-20 md:pb-28 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <p className="hero-in eyebrow mb-6 inline-flex items-center gap-2.5 text-sun">
              <span aria-hidden className="h-[3px] w-6 rounded-full bg-sun" />
              About Us
            </p>
            <h1
              id="about-heading"
              className="font-display text-[clamp(3.25rem,14vw,6rem)] font-black leading-[0.86] tracking-[-0.012em] lg:text-[clamp(4.5rem,7vw,7rem)]"
            >
              <span className="block text-white">
                <SplitReveal text={lineOne} step={70} />
              </span>
              <span className="block text-sun">
                <SplitReveal text={lineTwo} delay={200} step={70} />
              </span>
            </h1>
            <p
              className="hero-in mt-8 max-w-[34rem] text-[clamp(1.125rem,1.6vw,1.375rem)] font-medium leading-[1.5] text-[#e6ebff] [text-wrap:pretty]"
              style={{ ["--d" as string]: 420 }}
            >
              {HERO.subheadline}
            </p>
            <div className="hero-in mt-9 flex flex-col gap-3.5 sm:flex-row sm:flex-wrap sm:gap-4" style={{ ["--d" as string]: 520 }}>
              <Link href="/tier-selection" className={cta({ size: "lg" })}>
                Explore Restoration Services
                <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
              </Link>
              <a href="#founders" className={cta({ tone: "outline-light", size: "lg" })}>
                Meet the Founders
              </a>
            </div>
          </div>

          {/* The Gyarados, drag to compare, in its one-touch holder (as on the home page). */}
          <div className="relative mx-auto w-full max-w-[30rem] lg:max-w-none">
            <div className="hero-in relative z-[1] lg:rotate-[1.5deg]" style={{ ["--d" as string]: 160 }}>
              <AcrylicHolder title="Gyarados" detail="Delta Species">
                <BeforeAfter
                  before={gyaradosBefore}
                  after={gyaradosAfter}
                  beforeAlt="Close-up of a Gyarados holo card before restoration: a crease runs from the top edge through the name bar into the artwork, and the colors are dull"
                  afterAlt="The same corner of the Gyarados card after restoration: the crease is gone and the colors are bright"
                  sizes="(min-width: 1280px) 560px, (min-width: 1024px) 44vw, 92vw"
                  priority
                />
              </AcrylicHolder>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it all started ───────────────────────────────────────────── */}
      <section aria-labelledby="story-heading" className="surface-chalk">
        <div className="wrap section-y grid gap-x-16 gap-y-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <div data-reveal>
              <SectionHead id="story-heading" title={STORY.title} lead={STORY.lead} />
            </div>
          </div>

          <div className="min-w-0">
            <ol data-reveal="stagger" className="relative flex flex-col">
              {STORY.chapters.map((c, i) => {
                const last = i === STORY.chapters.length - 1;
                return (
                  <li key={c.title} className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-5 border-t border-line py-8 first:border-t-0 first:pt-0 md:grid-cols-[6rem_minmax(0,1fr)] md:gap-x-8 md:py-10">
                    <span
                      aria-hidden
                      className={cn(
                        "font-display text-[56px] font-black leading-[0.8] tabular-nums md:text-[80px]",
                        last ? "text-cobalt" : "text-ink/50"
                      )}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 pt-1">
                      <h3 className="caps font-display text-[26px] font-extrabold leading-none text-ink md:text-[32px]">
                        <span className="sr-only">{`Step ${i + 1}: `}</span>
                        {c.title}
                      </h3>
                      <p className="mt-3 max-w-[54ch] text-[16px] leading-relaxed text-ink-soft md:text-[17px]">{c.body}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {STORY.photos.some((s) => s.photo) && (
              <div data-reveal="stagger" className="mt-10 grid gap-8 md:grid-cols-[3fr_2fr] md:items-end">
                {STORY.photos.map((s, i) => (
                  <PhotoFigure key={i} photo={s.photo} aspect={i === 0 ? "aspect-[3/2]" : "aspect-[4/5]"} sizes="(min-width: 768px) 40vw, 92vw" />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Meet the founders ────────────────────────────────────────────── */}
      <section id="founders" aria-labelledby="founders-heading" className="surface-ink scroll-mt-[calc(var(--header-h)+16px)]">
        <div className="wrap section-y">
          <h2 id="founders-heading" data-reveal className="display-lg text-white">
            Meet the founders
          </h2>
          {/* Founders as a ledger until their photos arrive (about/owen.jpg, about/gavin.jpg). */}
          <ul data-reveal="stagger" className="mt-10 grid border-t border-line-dark sm:grid-cols-2 md:mt-12">
            {FOUNDERS.map((f, i) => (
              <li
                key={f.name}
                className="flex flex-col gap-4 border-b border-line-dark py-6 sm:py-8 sm:odd:border-r sm:odd:pr-8 sm:even:pl-8"
              >
                {f.portrait && (
                  <PhotoFigure photo={f.portrait} aspect="aspect-[4/5]" sizes="(min-width: 640px) 45vw, 92vw" className="max-w-[16rem]" />
                )}
                <div className="flex items-baseline gap-4">
                  <span aria-hidden className="label-caps text-[15px] text-sun">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="caps font-display text-[clamp(48px,7vw,80px)] font-black leading-[0.85] text-white">{f.name}</h3>
                </div>
                <ul aria-label={`About ${f.name}`} className="flex flex-wrap gap-2">
                  {f.facts.map((fact) => (
                    <li
                      key={fact}
                      className="inline-flex min-h-9 items-center rounded-full bg-white/[0.06] px-3.5 text-sm font-bold text-white shadow-[inset_0_0_0_1px_var(--line-dark)]"
                    >
                      {fact}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          <figure data-reveal className="mt-12 grid gap-8 md:mt-16 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:gap-14">
            <blockquote className="m-0 max-w-4xl">
              <p className="font-display text-[clamp(2rem,4.6vw,3.75rem)] font-extrabold leading-[1.02] text-white [text-wrap:balance]">
                <span aria-hidden className="mr-1 text-sun">&ldquo;</span>
                {FOUNDERS_MESSAGE}
                <span aria-hidden className="text-sun">&rdquo;</span>
              </p>
            </blockquote>
            <BookCta className="self-start md:self-end" />
          </figure>
        </div>
      </section>

      {/* ── Why collectors choose us ─────────────────────────────────────── */}
      <section aria-labelledby="reasons-heading" className="surface-white">
        <div className="wrap section-y">
          <div data-reveal>
            <SectionHead id="reasons-heading" title={REASONS.title} lead={REASONS.lead} />
          </div>
          <ul data-reveal="stagger" className="mt-12 grid gap-px overflow-hidden rounded-[22px] bg-line shadow-[0_0_0_1px_var(--line)] sm:grid-cols-2 md:mt-16">
            {REASONS.items.map((r, i) => {
              const Icon = REASON_ICONS[i % REASON_ICONS.length];
              return (
                <li key={r.title} className="flex flex-col gap-5 bg-white p-7 md:p-10">
                  <span aria-hidden className="grid size-12 place-items-center rounded-[14px] bg-cobalt-wash text-cobalt">
                    <Icon className="size-6" strokeWidth={1.75} />
                  </span>
                  <div>
                    <h3 className="caps font-display text-[26px] font-extrabold leading-[0.95] text-ink md:text-[30px]">{r.title}</h3>
                    <p className="m-0 mt-3 max-w-[46ch] text-[16px] leading-relaxed text-ink-soft">{r.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* ── Behind the restoration: the heading, the methods beside it ─── */}
      <section aria-labelledby="process-heading" className="surface-chalk">
        <div className="wrap section-y grid gap-x-16 gap-y-12 lg:grid-cols-12">
          <div className="lg:col-span-5 lg:col-start-1 lg:row-start-1 lg:sticky lg:top-[calc(var(--header-h)+40px)] lg:self-start">
            <div data-reveal>
              <SectionHead id="process-heading" title={PROCESS.title} lead={PROCESS.lead} />
            </div>
          </div>

          <div className="min-w-0 lg:col-span-7 lg:col-start-6 lg:row-start-1">
            <ol data-reveal="stagger" className="flex flex-col">
              {PROCESS.methods.map((m, i) => {
                const Icon = METHOD_ICONS[i % METHOD_ICONS.length];
                return (
                  <li key={m.id} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-5 border-t border-line py-6 last:border-b">
                    <span aria-hidden className="grid size-12 place-items-center rounded-[14px] bg-white text-cobalt shadow-[0_0_0_1px_var(--line)]">
                      <Icon className="size-6" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <p className="caps font-display text-[24px] font-extrabold leading-none text-ink md:text-[28px]">{m.name}</p>
                      <p className="mt-2 text-[16px] leading-relaxed text-ink-soft">{m.body}</p>
                      <PhotoFigure photo={m.photo} aspect="aspect-[4/3]" sizes="(min-width: 1024px) 480px, 92vw" className="mt-4 max-w-sm" />
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="mt-10 grid gap-5 sm:grid-cols-2">
              <div className="surface-ink rounded-[22px] p-6 md:p-7">
                <p className="label-caps text-[18px] text-sun">We never</p>
                <ul className="mt-5 flex flex-col gap-3">
                  {PROCESS.never.map((n) => (
                    <li key={n} className="flex items-center gap-3 text-[15px] font-bold text-white">
                      <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-sun text-ink">
                        <X className="size-3.5" strokeWidth={3} />
                      </span>
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="surface-sun flex flex-col justify-between gap-5 rounded-[22px] p-6 md:p-7">
                <p className="text-[17px] font-bold leading-snug text-ink">{PROCESS.honesty}</p>
                <p className="text-sm leading-relaxed text-ink">
                  Before you order, see{" "}
                  <Link href="/what-we-can-fix" className="font-bold underline decoration-2 underline-offset-4 hover:decoration-cobalt">what we can fix</Link>, the{" "}
                  <Link href="/faq" className="font-bold underline decoration-2 underline-offset-4 hover:decoration-cobalt">FAQ</Link> and our{" "}
                  <Link href="/terms" className="font-bold underline decoration-2 underline-offset-4 hover:decoration-cobalt">Terms of Service</Link>.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── What our customers say ───────────────────────────────────────── */}
      <section aria-labelledby="reviews-heading" className="surface-white">
        <div className="wrap section-y">
          <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
            <h2 id="reviews-heading" data-reveal className="display-lg text-ink lg:col-span-7">
              What our customers say
            </h2>
            {cardsFinished ? (
              <div data-reveal className="lg:col-span-5 lg:justify-self-end">
                <StatBlock
                  tone="cobalt"
                  value={<CountUp value={cardsFinished} />}
                  label="Cards restored and prepped"
                  className="min-h-0 min-w-[18rem]"
                >
                  <p className="mt-1 text-[13px] text-cobalt-tint">Counted live from finished website orders.</p>
                </StatBlock>
              </div>
            ) : null}
          </div>
          <FeaturedReview className="mt-12 max-w-5xl md:mt-14" />
          <div className="mt-14 md:mt-20">
            <ReviewBubbles />
          </div>
          <div className="mt-10 flex md:mt-12 md:justify-center">
            <BookCta tone="ink" />
          </div>
        </div>
      </section>

      {/* ── Closing ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="closing-heading" className="surface-cobalt relative isolate overflow-hidden">
        <span aria-hidden className="halftone-dots -left-[10%] -top-[30%] h-[140%] w-[60%]" />
        <div className="wrap section-y text-center">
          <h2 id="closing-heading" data-reveal className="display-lg mx-auto max-w-5xl">
            <span className="block text-white">Your Collection Means Something.</span>
            <span className="block text-sun">We Understand Why.</span>
          </h2>
          <p data-reveal className="lead mx-auto mt-7 text-[#e6ebff] md:mt-9">
            From childhood favorites to prized collectibles, every card deserves thoughtful care.
          </p>
          <div data-reveal className="mt-10 flex flex-col justify-center gap-4 sm:flex-row">
            <Link href="/tier-selection" className={cta({ size: "lg" })}>
              Explore Restoration Services
              <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
            </Link>
            <a href={INSTAGRAM} target="_blank" rel="noopener noreferrer" className={cta({ tone: "outline-light", size: "lg" })}>
              Contact Us
              <ArrowUpRight aria-hidden className="size-5" strokeWidth={2} />
              <InstagramNote />
            </a>
          </div>
          <p className="mt-9 text-[15px] text-[#e6ebff]">
            Questions first? Read the{" "}
            <Link href="/faq" className="font-bold text-white underline decoration-sun decoration-2 underline-offset-4 hover:text-sun">FAQ</Link>{" "}or DM{" "}
            <a href={INSTAGRAM} target="_blank" rel="noopener noreferrer" className="font-bold text-white underline decoration-sun decoration-2 underline-offset-4 hover:text-sun">
              @the_card_doc
            </a>
            .
          </p>
        </div>
      </section>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }} />
    </div>
  );
}
