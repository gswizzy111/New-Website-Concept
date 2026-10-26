import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { ArrowUpRight, X } from "lucide-react";
import { SplitReveal } from "@/components/motion/split-reveal";
import { ExpandingStage } from "@/components/motion/expanding-stage";
import { CountUp } from "@/components/motion/count-up";
import { CustomerReviews } from "@/components/marketing/customer-reviews";
import { PhotoFigure } from "@/components/about/photo-figure";
import { ResultsGallery } from "@/components/about/results-gallery";
import { getCardsFinishedStat } from "@/lib/site-stats";
import { FOUNDERS, FOUNDERS_MESSAGE, HERO, PROCESS, REASONS, RESULTS, STORY } from "@/lib/about";
import { siteUrl } from "@/lib/site-url";

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

const sectionTitle = "font-heading text-4xl md:text-6xl tracking-[-0.02em] leading-[0.95]";

export default async function AboutPage() {
  const cardsFinished = await getCardsFinishedStat();

  return (
    <>
      {/* ── A. Hero: the headline, and a restored card in a gloved hand ── */}
      <section className="page-glow relative overflow-x-clip border-b border-rule">
        <div className="max-w-7xl mx-auto px-4 md:px-10 pt-12 pb-16 md:pt-20 md:pb-24 lg:pt-24 lg:pb-28 grid gap-14 lg:gap-x-10 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-7">
            <p className="hero-in rx-label text-rx mb-6 md:mb-8">About Us</p>
            <h1 className="font-heading text-ink tracking-[-0.022em] leading-[0.9] text-[clamp(2.9rem,13.4vw,4.75rem)] md:text-[clamp(4.5rem,9.5vw,5.75rem)] lg:text-[clamp(4rem,6vw,5.75rem)]">
              <span className="block">
                <SplitReveal text={HERO.headline[0]} lines={["Built by", "Collectors."]} step={80} />
              </span>
              <span className="block mt-[0.14em] sm:pl-[0.9em]">
                <SplitReveal text={HERO.headline[1]} lines={["Trusted with", "Collections."]} delay={240} step={80} />
              </span>
            </h1>
            <p className="hero-in mt-8 md:mt-10 text-lg md:text-xl text-muted-foreground max-w-xl leading-relaxed" style={{ ["--d" as string]: 520 }}>
              {HERO.subheadline}
            </p>
            <div className="hero-in mt-9 flex flex-col sm:flex-row gap-3" style={{ ["--d" as string]: 620 }}>
              <Link
                href="/tier-selection"
                className="btn-depth btn-sheen nudge-arrow inline-flex h-12 items-center justify-center gap-1 rounded-md bg-rx px-7 text-[15px] font-semibold text-primary-foreground hover:bg-rx/90 transition-colors"
              >
                Explore Restoration Services <span className="arrow" aria-hidden>→</span>
              </Link>
              <a
                href="#founders"
                className="inline-flex h-12 items-center justify-center rounded-md border border-ink/70 bg-white px-7 text-[15px] font-semibold text-ink hover:bg-paper transition-colors"
              >
                Meet the Founders
              </a>
            </div>
          </div>

          <figure className="relative mx-auto w-full max-w-[19rem] sm:max-w-[23rem] lg:max-w-[25rem] lg:col-span-5 lg:col-start-8 lg:justify-self-end">
            <div className="specimen-land">
              <div className="rotate-[2.5deg] rounded-lg bg-white p-2 md:p-2.5 ring-1 ring-ink/15 shadow-[0_40px_80px_-40px_oklch(0.25_0.006_70/0.55)]">
                <Image
                  src={HERO.photo.src}
                  alt={HERO.photo.alt}
                  preload
                  sizes="(min-width: 1024px) 400px, (min-width: 640px) 368px, 304px"
                  className="block w-full h-auto rounded-[5px]"
                />
                <figcaption className="flex items-baseline justify-between gap-3 px-1 pt-3 pb-1">
                  <span className="font-heading text-lg text-ink">Mickey Mantle</span>
                  <span className="rx-label">After restoration</span>
                </figcaption>
              </div>
            </div>
          </figure>
        </div>
      </section>

      {/* ── B. How it all started ── */}
      <section className="py-20 md:py-32">
        <div className="max-w-6xl mx-auto px-4 md:px-10 grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-32">
              <h2 className={`${sectionTitle} text-ink`}>{STORY.title}</h2>
              <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-md">{STORY.lead}</p>
            </div>
          </div>
          <ol data-reveal="stagger" className="lg:col-span-7 relative border-t border-ink/80">
            {/* The thread through the chapters */}
            <span aria-hidden className="absolute left-[4px] top-0 bottom-10 w-px bg-rule" />
            {STORY.chapters.map((c, i) => (
              <li key={c.title} className="relative grid grid-cols-[auto_1fr] gap-x-6 md:gap-x-9 py-8 md:py-10 border-b border-rule last:border-b-0">
                <span
                  aria-hidden
                  className={`relative mt-[0.6rem] h-[9px] w-[9px] rounded-full ${i === STORY.chapters.length - 1 ? "bg-ink" : "bg-white ring-1 ring-ink/60"}`}
                />
                <div>
                  <h3 className="font-heading text-2xl md:text-[1.75rem] leading-[1.15] tracking-[-0.01em] text-ink">{c.title}</h3>
                  <p className="mt-3 text-base md:text-[17px] leading-relaxed text-muted-foreground max-w-[56ch]">{c.body}</p>
                </div>
              </li>
            ))}
          </ol>
          {STORY.photos.some((s) => s.photo) && (
            <div data-reveal="stagger" className="lg:col-span-12 grid gap-6 md:grid-cols-[3fr_2fr] md:items-end">
              {STORY.photos.map((s, i) => (
                <PhotoFigure key={i} photo={s.photo} aspect={i === 0 ? "aspect-[3/2]" : "aspect-[4/5]"} sizes="(min-width: 768px) 50vw, 92vw" />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── C. Meet the founders ── */}
      <section id="founders" className="bg-paper border-y border-rule py-20 md:py-32 overflow-x-clip">
        <div className="max-w-6xl mx-auto px-4 md:px-10">
          <h2 data-reveal className={`${sectionTitle} text-ink`}>Meet the founders</h2>
          <div data-reveal="stagger" className="mt-12 md:mt-16 grid sm:grid-cols-2 border-t border-ink/80 sm:divide-x divide-rule">
            {FOUNDERS.map((f, i) => (
              <article key={f.name} className={`pt-8 pb-10 sm:pb-2 md:pt-12 ${i === 0 ? "sm:pr-8 md:pr-12 border-b border-rule sm:border-b-0" : "sm:pl-8 md:pl-12"}`}>
                <PhotoFigure photo={f.portrait} aspect="aspect-[4/5]" sizes="(min-width: 640px) 45vw, 92vw" className="mb-8" />
                <h3 className="font-heading text-[clamp(4.5rem,24vw,8.5rem)] sm:text-[clamp(4.5rem,13vw,8.5rem)] leading-[0.82] tracking-[-0.025em] text-ink">
                  {f.name}
                </h3>
                <p className="mt-6 rx-label">{f.facts.join(" · ")}</p>
              </article>
            ))}
          </div>
          <p data-reveal className="mt-16 md:mt-24 lg:ml-[calc(100%/12*3)] font-heading text-[clamp(1.85rem,4.4vw,3.25rem)] leading-[1.08] tracking-[-0.015em] text-ink max-w-4xl [text-wrap:balance]">
            {FOUNDERS_MESSAGE}
          </p>
        </div>
      </section>

      {/* ── D. Why collectors choose us: written up like the label on a prescription ── */}
      <section className="py-20 md:py-32">
        <div className="max-w-6xl mx-auto px-4 md:px-10 grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <h2 className={`${sectionTitle} text-ink`}>{REASONS.title}</h2>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-md">{REASONS.lead}</p>
          </div>
          <div data-reveal className="lg:col-span-7 overflow-hidden rounded-xl bg-white ring-1 ring-rule">
            <div aria-hidden className="h-1.5 bg-rx" />
            <div className="mx-5 md:mx-8 flex items-baseline justify-between gap-4 pt-5 pb-3 md:pt-6 border-b-2 border-ink">
              <span className="font-heading text-xl text-ink">The Card Doc</span>
              <span className="rx-label">{FOUNDERS.map((f) => f.name).join(" & ")}</span>
            </div>
            <dl className="mx-5 md:mx-8 divide-y divide-rule">
              {REASONS.items.map((r) => (
                <div key={r.title} className="py-6 md:py-7">
                  <dt className="font-heading text-2xl leading-[1.15] tracking-[-0.01em] text-ink">{r.title}</dt>
                  <dd className="mt-2 text-[15px] leading-relaxed text-muted-foreground max-w-[52ch]">{r.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* ── E. Behind the restoration: the close-up leads; phones read title, photo, methods ── */}
      <section className="bg-paper border-t border-rule pt-20 pb-24 md:pt-32 md:pb-36">
        <div className="max-w-6xl mx-auto px-4 md:px-10 grid gap-y-10 md:gap-y-12 lg:grid-cols-12 lg:gap-x-16">
          <div className="lg:col-span-6 lg:col-start-7 lg:row-start-1">
            <h2 className={`${sectionTitle} text-ink`}>{PROCESS.title}</h2>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-lg">{PROCESS.lead}</p>
          </div>

          <div className="lg:col-span-6 lg:col-start-1 lg:row-start-1 lg:row-span-2">
            <div className="lg:sticky lg:top-28">
              <PhotoFigure photo={PROCESS.photo} sizes="(min-width: 1152px) 520px, (min-width: 1024px) 45vw, 92vw" />
            </div>
          </div>

          <div className="lg:col-span-6 lg:col-start-7 lg:row-start-2">
            <ul data-reveal="stagger" className="border-t border-ink/80 divide-y divide-rule">
              {PROCESS.methods.map((m) => (
                <li key={m.id} className="py-5 md:py-6">
                  <p className="font-heading text-xl md:text-2xl leading-[1.15] tracking-[-0.01em] text-ink">{m.name}</p>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{m.body}</p>
                  <PhotoFigure photo={m.photo} aspect="aspect-[4/3]" sizes="(min-width: 1024px) 480px, 92vw" className="mt-4 max-w-sm" />
                </li>
              ))}
            </ul>

            <div className="mt-10 grid gap-8 sm:grid-cols-2 sm:gap-10">
              <div>
                <p className="rx-label text-ink">We never</p>
                <ul className="mt-3 space-y-2">
                  {PROCESS.never.map((n) => (
                    <li key={n} className="flex items-center gap-2.5 text-[15px] text-ink">
                      <X className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[15px] leading-relaxed text-ink">{PROCESS.honesty}</p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Before you order, see{" "}
                  <Link href="/what-we-can-fix" className="font-semibold text-rx hover:underline">what we can fix</Link>, the{" "}
                  <Link href="/faq" className="font-semibold text-rx hover:underline">FAQ</Link> and our{" "}
                  <Link href="/terms" className="font-semibold text-rx hover:underline">Terms of Service</Link>.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── F to H on the ink stage: real results, what customers say, the close ── */}
      <section className="bg-paper">
        <ExpandingStage className="stage stage-light overflow-hidden">
          {/* F. Real results */}
          <div className="max-w-6xl mx-auto px-4 md:px-10 pt-20 pb-20 md:pt-32 md:pb-28">
            <div data-reveal className="max-w-2xl">
              <h2 className={`${sectionTitle} text-stage-fg`}>Real results</h2>
              <p className="mt-6 text-lg text-stage-muted leading-relaxed [text-wrap:pretty]">
                Genuine before and after photos of cards we restored. Nothing here is a mock-up.
              </p>
            </div>
            <div className="mt-12 md:mt-16">
              <ResultsGallery cases={RESULTS} />
            </div>
          </div>

          {/* G. Trust: the customers' own words and a figure counted live */}
          <div className="max-w-6xl mx-auto px-4 md:px-10">
            <div className="border-t border-white/12 pt-20 md:pt-28 grid gap-10 lg:grid-cols-12 lg:items-end">
              <h2 data-reveal className={`${sectionTitle} text-stage-fg lg:col-span-7`}>What our customers say</h2>
              {cardsFinished && (
                <div data-reveal className="lg:col-span-5 lg:justify-self-end lg:text-right">
                  <p className="font-heading text-[clamp(3.5rem,9vw,5.5rem)] leading-[0.9] tracking-[-0.015em] text-stage-fg [font-feature-settings:'lnum'_1,'tnum'_1]">
                    <CountUp value={cardsFinished} />
                  </p>
                  <p className="mt-3 rx-label text-stage-muted">Cards restored and prepped</p>
                  <p className="mt-1 text-[13px] text-stage-muted">Counted live from finished website orders.</p>
                </div>
              )}
            </div>
          </div>
          <div className="max-w-6xl mx-auto px-4 md:px-10 pt-12 md:pt-16 pb-24 md:pb-32">
            <CustomerReviews compact />
          </div>

          {/* H. The close */}
          <div className="border-t border-white/12">
            <div className="max-w-5xl mx-auto px-4 md:px-10 py-24 md:py-36 text-center">
              <h2 data-reveal className="font-heading text-[clamp(2.15rem,9vw,5.75rem)] leading-[0.94] tracking-[-0.022em] text-stage-fg">
                <span className="block">Your Collection Means Something.</span>
                <span className="block">We Understand Why.</span>
              </h2>
              <p data-reveal className="mt-7 md:mt-9 text-lg md:text-xl text-stage-muted max-w-xl mx-auto leading-relaxed">
                From childhood favorites to prized collectibles, every card deserves thoughtful care.
              </p>
              <div data-reveal className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
                <Link
                  href="/tier-selection"
                  className="btn-depth btn-sheen nudge-arrow inline-flex h-12 items-center justify-center gap-1 rounded-md bg-rx px-8 text-[15px] font-semibold text-primary-foreground hover:bg-rx/90 transition-colors"
                >
                  Explore Restoration Services <span className="arrow" aria-hidden>→</span>
                </Link>
                <a
                  href={INSTAGRAM}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="nudge-arrow inline-flex h-12 items-center justify-center gap-1.5 rounded-md border border-white/25 px-8 text-[15px] font-semibold text-stage-fg hover:border-white/60 hover:bg-white/5 transition-colors"
                >
                  Contact Us
                  <ArrowUpRight className="arrow h-4 w-4" strokeWidth={1.75} aria-hidden />
                  <span className="sr-only">on Instagram (opens in a new tab)</span>
                </a>
              </div>
              <p className="mt-8 text-sm text-stage-muted">
                Questions first? Read the{" "}
                <Link href="/faq" className="font-semibold text-rx-bright hover:underline">FAQ</Link>{" "}or DM{" "}
                <a href={INSTAGRAM} target="_blank" rel="noopener noreferrer" className="font-semibold text-rx-bright hover:underline">@the_card_doc</a>.
              </p>
            </div>
          </div>
        </ExpandingStage>
      </section>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }} />
    </>
  );
}
