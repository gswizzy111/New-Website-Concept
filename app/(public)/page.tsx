import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  Ban,
  BadgeCheck,
  Clock,
  Eye,
  Hand,
  Microscope,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { CountUp } from "@/components/motion/count-up";
import { ScrollFan } from "@/components/motion/scroll-fan";
import { VelocityMarquee } from "@/components/motion/velocity-marquee";
import { BeforeAfter } from "@/components/motion/before-after";
import { TrustedBy } from "@/components/marketing/trusted-by";
import { getCardsRestoredStat } from "@/lib/site-stats";
import { ORG_ID, SITE, INSTAGRAM_URL, canonical } from "@/lib/seo";
import { JsonLd } from "@/components/seo/json-ld";
import { ReviewsBand } from "@/components/marketing/comic-reviews";
import { TrustPills } from "@/components/marketing/trust-pills";
import { HERO, PROCESS, REASONS, RESULTS } from "@/lib/about";
import mantleBefore from "@/public/specimen-mantle-before.jpg";
import mantleAfter from "@/public/specimen-mantle-after.jpg";
import mantlePair from "@/public/before-after-mickey-mantle.png";
import charmander from "@/public/specimen-charmander.png";
import garchomp from "@/public/before-after-garchomp.png";
import doctor from "@/public/card-doctor.jpg";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: canonical("/"),
};

const TAGLINE = "Expert card restoration & PSA prep — every card treated like it's worth a fortune.";
const INSTAGRAM = INSTAGRAM_URL;

const FIXES = ["Creases", "Dents", "Dimples", "Edge lifts", "Corner lifts", "Minor bends", "Holo polishing", "Surface cleaning"];

const FAQ = [
  {
    q: "What's the difference between Restoration and Prep?",
    a: "Restoration improves how your card looks — cleaning surfaces, softening corners, reducing scuffs and scratches. PSA Prep is specifically for submitting to graders: we clean, sleeve, and organize your submission for the best possible grade. Most collectors do prep before grading, restoration before or after.",
  },
  {
    q: "Will restoration affect my card's PSA grade?",
    a: "There is a risk — we're fully transparent about that. If you plan to grade your card, restoration may affect how it's received. We'll always be upfront with you about what's realistic for your card.",
  },
  {
    q: "How do I ship my cards to you?",
    a: "You can choose to have us generate a prepaid label (we email it to you — print and drop off), or ship on your own using any tracked, insured method. We recommend USPS Priority Mail.",
  },
  {
    q: "What types of cards do you work on?",
    a: "All trading cards — Pokémon, sports cards (baseball, basketball, football, hockey), Magic: The Gathering, Yu-Gi-Oh!, and more. Vintage or modern, raw or graded.",
  },
  {
    q: "How long does it take?",
    a: "Prep typically turns around in 10–15 business days. Restorations range from 2–3 months (Bronze) down to 5–10 business days (Diamond) depending on the tier you choose, or skip the queue with Fast Pass.",
  },
];

const TOS_HIGHLIGHTS = [
  {
    title: "Turnaround times are estimates",
    body: "All turnaround times shown are rough estimates and not guaranteed. Actual processing may be affected by order volume, card condition, shipping delays, or circumstances outside our control.",
    Icon: Clock,
  },
  {
    title: "You assume shipping risk",
    body: "You are responsible for selecting your shipping method and carrier. The Card Doc assumes no responsibility for loss or damage in transit until items are physically received and confirmed.",
    Icon: Truck,
  },
  {
    title: "Alteration Risk",
    body: "Cards can be flagged as altered: professional graders can detect restoration and may give an 'Altered' designation. If your card is damaged during restoration, our liability is limited to the service fee paid — not the card's market value.",
    Icon: ShieldAlert,
  },
  {
    title: "No refunds after work begins",
    body: "All sales are final once restoration work has commenced. If we believe a card won't respond well to treatment, we will contact you before proceeding.",
    Icon: Ban,
  },
];

const SERVICES = [
  {
    href: "/tier-selection",
    code: "Service",
    name: "Restoration",
    line: "Surfaces, corners & edges — cleaned and restored to their best.",
    price: "From $75 / card",
    action: "View Tiers",
    Icon: Sparkles,
    band: "bg-rx text-white",
    dots: "halftone-light",
  },
  {
    href: "/prep",
    code: "Service",
    name: "Prep",
    line: "Grade-ready submission prep for PSA, BGS & CGC.",
    price: "From $25 / card",
    action: "View Pricing",
    Icon: Microscope,
    band: "bg-ink text-white",
    dots: "halftone-light",
  },
  {
    href: "/shop",
    code: "Shop",
    name: "DIY Kits",
    line: "The same pro-grade tools The Card Doc uses — delivered to you.",
    price: "US shipping at cost + $2 handling",
    action: "Shop Now",
    Icon: Wrench,
    band: "bg-peach text-ink",
    dots: "halftone",
  },
];

const REASON_ICONS = [Users, BadgeCheck, Eye, ShieldCheck];

function structuredData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Service",
        name: "Card Restoration",
        serviceType: "Trading card restoration",
        description: SERVICES[0].line,
        url: `${SITE}/tier-selection`,
        provider: { "@id": ORG_ID },
        areaServed: ["US", "PR"],
        offers: {
          "@type": "Offer",
          priceSpecification: { "@type": "UnitPriceSpecification", minPrice: 75, priceCurrency: "USD", unitText: "card" },
        },
      },
      {
        "@type": "Service",
        name: "PSA Prep",
        serviceType: "Trading card grading submission prep",
        description: SERVICES[1].line,
        url: `${SITE}/prep`,
        provider: { "@id": ORG_ID },
        areaServed: ["US", "PR"],
        offers: {
          "@type": "Offer",
          priceSpecification: { "@type": "UnitPriceSpecification", minPrice: 25, priceCurrency: "USD", unitText: "card" },
        },
      },
      {
        "@type": "FAQPage",
        "@id": `${SITE}/#faq`,
        mainEntity: FAQ.map(({ q, a }) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
    ],
  };
}

function Eyebrow({ children, tone = "rx" }: { children: React.ReactNode; tone?: "rx" | "light" }) {
  return (
    <p className={`flex items-center gap-3 font-heading text-xs md:text-[13px] font-extrabold uppercase tracking-[0.14em] ${tone === "rx" ? "text-rx" : "text-white"}`}>
      <span aria-hidden className={`h-[3px] w-8 rounded-full ${tone === "rx" ? "bg-rx" : "bg-white"}`} />
      {children}
    </p>
  );
}

function Frame({
  children,
  label,
  detail,
  className = "",
  tilt = "0deg",
}: {
  children: React.ReactNode;
  label: string;
  detail?: string;
  className?: string;
  tilt?: string;
}) {
  return (
    <figure
      className={`comic-lift rounded-2xl bg-white comic-border comic-shadow overflow-hidden ${className}`}
      style={{ transform: `rotate(${tilt})`, ["--tilt" as string]: tilt }}
    >
      {children}
      <figcaption className="flex items-baseline justify-between gap-3 border-t-[3px] border-ink bg-bone px-4 py-3">
        <span className="font-heading text-sm md:text-base font-extrabold uppercase tracking-[0.02em] text-ink">{label}</span>
        {detail && <span className="text-xs text-muted-foreground text-right">{detail}</span>}
      </figcaption>
    </figure>
  );
}

export default async function HomePage() {
  const cardsRestored = await getCardsRestoredStat();
  const mantle = RESULTS.find((r) => r.id === "mickey-mantle");
  const charmanderCase = RESULTS.find((r) => r.id === "charmander");
  return (
    <div className="min-h-screen bg-cream">
      <JsonLd data={structuredData()} />

      <section className="relative overflow-hidden border-b-[3px] border-ink bg-cream">
        <div aria-hidden className="pointer-events-none absolute inset-0 halftone halftone-fade" />

        <TrustPills cardsRestored={cardsRestored} className="hero-in relative z-20 mx-auto max-w-7xl px-4 pt-5 md:px-10 md:pt-6" />

        <div className="relative mx-auto grid max-w-7xl gap-x-10 gap-y-14 px-4 pt-10 pb-16 md:px-10 md:pt-14 lg:grid-cols-12 lg:items-center lg:pb-24">
          <div className="relative z-10 lg:col-span-6">
            <h1 className="hero-in font-heading font-black uppercase leading-[0.9] tracking-[-0.025em] text-[clamp(2.5rem,11vw,4.6rem)] lg:text-[clamp(3.4rem,5.1vw,4.75rem)]">
              <span className="block text-ink">{HERO.headline[0]}</span>
              <span className="block text-rx">{HERO.headline[1]}</span>
            </h1>
            <div aria-hidden className="hero-in mt-7 flex max-w-md items-center gap-3" style={{ ["--d" as string]: 160 }}>
              <span className="h-[3px] flex-1 rounded-full bg-ink" />
              <span className="h-3 w-3 rotate-45 border-[3px] border-ink bg-rx" />
              <span className="h-[3px] flex-1 rounded-full bg-ink" />
            </div>
            <p className="hero-in mt-6 max-w-[32rem] text-lg md:text-xl font-medium leading-relaxed text-ink/80 [text-wrap:pretty]" style={{ ["--d" as string]: 260 }}>
              {TAGLINE}
            </p>
            <div className="hero-in mt-8 flex flex-col gap-4 sm:flex-row" style={{ ["--d" as string]: 360 }}>
              <Link href="/tier-selection" className="comic-btn press">Restoration Pricing</Link>
              <Link href="/prep" className="comic-btn comic-btn-light press">PSA Prep Pricing</Link>
            </div>

            <div className="hero-in relative mt-10 max-w-xl" style={{ ["--d" as string]: 460 }}>
              <span className="absolute -top-3.5 left-4 z-10 rounded-md border-2 border-ink bg-ink px-2.5 py-0.5 font-heading text-[11px] font-extrabold uppercase tracking-[0.12em] text-white">
                We never
              </span>
              <ul className="grid rounded-xl border-[2.5px] border-ink bg-bone pt-3 sm:grid-cols-3 sm:pt-0">
                {PROCESS.never.map((item, i) => (
                  <li key={item} className={`flex items-center gap-2.5 px-4 py-3 sm:pt-6 sm:pb-4 ${i > 0 ? "border-t-2 border-ink/15 sm:border-t-0 sm:border-l-[2.5px] sm:border-ink" : ""}`}>
                    <X className="h-4 w-4 shrink-0 text-rx" strokeWidth={3} />
                    <span className="font-heading text-xs font-extrabold uppercase leading-tight tracking-[0.03em] text-ink">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="relative lg:col-span-6 lg:self-stretch">
            <div
              aria-hidden
              className="wordmark-pattern absolute -inset-x-4 -top-6 -bottom-16 rounded-[2.5rem] border-[3px] border-ink sm:-inset-x-10 lg:inset-y-[-7rem] lg:left-6 lg:-right-[40vw] lg:rounded-[46%_0_0_42%/58%_0_0_44%] lg:border-r-0"
            />
            <div className="relative mx-auto flex min-h-[25rem] max-w-[34rem] items-center justify-center py-8 sm:min-h-[30rem] lg:min-h-[34rem] lg:py-0">
              <div className="absolute -top-2 right-0 z-0 w-[44%] sm:right-2 lg:-top-4 lg:-right-4">
                <div className="fan-in">
                  <ScrollFan>
                    <figure className="rotate-[9deg] rounded-xl comic-border bg-peach p-2.5 comic-shadow-sm">
                      <Image
                        src={charmander}
                        alt="A Charmander card before and after restoration"
                        sizes="(min-width: 1024px) 240px, 44vw"
                        className="h-auto w-full"
                        loading="eager"
                      />
                    </figure>
                  </ScrollFan>
                </div>
              </div>

              <figure className="specimen-land relative z-10 mt-24 w-[94%] -rotate-[2.5deg] rounded-2xl bg-white comic-border comic-shadow sm:mt-28 lg:mt-24">
                <div className="overflow-hidden rounded-t-[13px] bg-white">
                  <Image
                    src={mantlePair}
                    alt="A cracked Mickey Mantle card in a black glove next to the same card after restoration in a blue glove"
                    sizes="(min-width: 1024px) 520px, 92vw"
                    className="h-auto w-full"
                    priority
                  />
                </div>
                <figcaption className="rounded-b-[13px] border-t-[3px] border-ink bg-rx px-4 py-2.5">
                  <span className="font-heading text-sm font-extrabold uppercase tracking-[0.04em] text-white">{mantle?.card ?? "Mickey Mantle"}</span>
                </figcaption>
              </figure>

              <div className="absolute top-6 left-0 z-20 h-20 w-20 sm:top-4 sm:h-28 sm:w-28 lg:top-2 lg:-left-4">
                <div className="sticker relative h-full w-full overflow-hidden bg-bone -rotate-6">
                  <Image src={doctor} alt="" sizes="112px" className="h-full w-full object-cover object-[50%_18%]" />
                </div>
              </div>

              <div className="absolute -bottom-10 right-0 z-20 rotate-[8deg] sm:-bottom-8 sm:right-2 lg:-bottom-12 lg:-right-4">
                <div className="burst grid h-[7.5rem] w-[7.5rem] place-items-center bg-ink sm:h-32 sm:w-32">
                  <div className="burst grid h-[6.9rem] w-[6.9rem] place-items-center bg-rx-pop sm:h-[7.4rem] sm:w-[7.4rem]">
                    <span className="px-4 text-center font-heading text-[13px] font-black uppercase leading-[1.05] text-ink sm:text-sm">
                      Free<br />Photo<br />Review
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <TrustedBy />

      <ReviewsBand title="What our customers say" />

      <section aria-label="What we can fix" className="overflow-hidden border-b-[3px] border-ink bg-ink py-6 md:py-9">
        <VelocityMarquee>
          {[0, 1].map((copy) => (
            <ul key={copy} aria-hidden={copy === 1 || undefined} className={`flex items-center ${copy === 1 ? "marquee-dupe" : ""}`}>
              {FIXES.map((word, i) => (
                <li key={word} className="flex items-center">
                  <span className={`ticker-word whitespace-nowrap text-[clamp(2.75rem,8vw,6.5rem)] ${i % 2 ? "outline-word" : "text-white"}`}>{word}</span>
                  <span aria-hidden className="mx-6 h-4 w-4 shrink-0 rounded-full bg-rx md:mx-12 md:h-6 md:w-6" />
                </li>
              ))}
            </ul>
          ))}
        </VelocityMarquee>
      </section>

      <section aria-labelledby="results-heading" className="relative overflow-hidden bg-cream">
        <div aria-hidden className="pointer-events-none absolute inset-0 halftone halftone-fade-r" />
        <div className="relative mx-auto max-w-7xl px-4 py-20 md:px-10 md:py-28">
          <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
            <div data-reveal className="lg:col-span-7">
              <Eyebrow>Why Collectors Trust Us</Eyebrow>
              <h2 id="results-heading" className="mt-4 font-heading font-black uppercase leading-[0.9] tracking-[-0.025em] text-ink text-[clamp(2.6rem,8vw,5.5rem)]">
                Proven Results
              </h2>
            </div>
            <div data-reveal className="lg:col-span-5">
              <p className="text-lg font-medium leading-relaxed text-ink/75">
                Hundreds of cards restored and prepped. We don&apos;t just claim results, we show them.
              </p>
              <Link href="/tier-selection" className="comic-btn press mt-6">See Our Services</Link>
            </div>
          </div>

          <div className="mt-14 grid gap-10 md:mt-16 lg:grid-cols-12 lg:gap-12">
            <div data-reveal className="lg:col-span-7">
              <Frame label={mantle?.card ?? "Mickey Mantle"} detail={mantle?.detail} tilt="-1deg">
                <div className="bg-white p-2.5 md:p-3">
                  <BeforeAfter
                    before={mantleBefore}
                    after={mantleAfter}
                    beforeAlt="A Mickey Mantle card before restoration, cracked across the face and jersey"
                    afterAlt="The same Mickey Mantle card after restoration"
                    sizes="(min-width: 1280px) 700px, (min-width: 1024px) 56vw, 92vw"
                  />
                </div>
              </Frame>
              {mantle && <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-ink/70">{mantle.caption}</p>}
            </div>

            <div className="grid gap-10 sm:grid-cols-2 lg:col-span-5 lg:grid-cols-1">
              <div data-reveal style={{ transitionDelay: "100ms" }}>
                <Frame label={charmanderCase?.card ?? "Charmander"} detail={charmanderCase?.detail} tilt="1.5deg">
                  <div className="bg-peach px-6 py-5">
                    <Image src={charmander} alt="A Charmander card before and after restoration" sizes="(min-width: 1024px) 420px, 45vw" className="mx-auto h-auto w-full max-w-[22rem]" />
                  </div>
                </Frame>
              </div>
              <div data-reveal style={{ transitionDelay: "180ms" }}>
                <Frame label="Garchomp" tilt="-1.5deg">
                  <div className="relative bg-ink px-6 py-4">
                    <div aria-hidden className="absolute inset-0 halftone-light" />
                    <Image src={garchomp} alt="A Garchomp card corner before and after restoration" sizes="(min-width: 1024px) 420px, 45vw" className="relative mx-auto h-auto w-full max-w-[20rem]" />
                  </div>
                </Frame>
              </div>
            </div>
          </div>

          <dl className="mt-16 grid gap-6 sm:grid-cols-2 md:mt-20">
            {[
              { stat: cardsRestored, label: "Cards Restored", tone: "bg-ink text-white" },
              { stat: "Free", label: "Photo Review", tone: "bg-rx text-white" },
            ].map((s, i) => (
              <div
                key={s.label}
                data-reveal
                style={{ transitionDelay: `${i * 90}ms` }}
                className={`relative flex flex-col-reverse gap-2 overflow-hidden rounded-2xl comic-border comic-shadow px-7 py-7 md:px-9 md:py-9 ${s.tone}`}
              >
                <div aria-hidden className="absolute inset-0 halftone-light" />
                <dt className="relative font-heading text-xs font-extrabold uppercase tracking-[0.14em] text-white/80 md:text-sm">{s.label}</dt>
                <dd className="relative font-heading text-[clamp(3.5rem,9vw,6.5rem)] font-black leading-[0.9] tracking-[-0.03em] tabular-nums">
                  <CountUp value={s.stat} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section aria-labelledby="reasons-heading" className="relative overflow-hidden border-y-[3px] border-ink bg-peach py-16 md:py-24">
        <div aria-hidden className="pointer-events-none absolute inset-0 halftone" />
        <div className="relative mx-auto max-w-7xl px-4 md:px-10">
          <div className="relative overflow-hidden rounded-3xl comic-border bg-ink px-6 py-10 text-white comic-shadow-rx md:px-12 md:py-14">
            <div aria-hidden className="absolute inset-0 halftone-light opacity-60" />
            <h2 id="reasons-heading" data-reveal className="relative font-heading font-black uppercase leading-[0.92] tracking-[-0.02em] text-[clamp(2.1rem,5vw,3.75rem)]">
              {REASONS.title}
            </h2>
            <ul data-reveal="stagger" className="relative mt-10 grid gap-8 md:grid-cols-2 lg:grid-cols-4 lg:gap-0">
              {REASONS.items.map((item, i) => {
                const Icon = REASON_ICONS[i] ?? Hand;
                return (
                  <li key={item.title} className={`lg:px-7 ${i === 0 ? "lg:pl-0" : "lg:border-l-2 lg:border-white/15"} ${i === REASONS.items.length - 1 ? "lg:pr-0" : ""}`}>
                    <span className="grid h-11 w-11 place-items-center rounded-full border-2 border-white/80 text-rx-bright">
                      <Icon className="h-5 w-5" strokeWidth={2} />
                    </span>
                    <h3 className="mt-5 font-heading text-base font-extrabold uppercase leading-tight tracking-[0.02em]">{item.title}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-white/70">{item.body}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </section>

      <section aria-labelledby="services-heading" className="bg-cream">
        <div className="mx-auto max-w-7xl px-4 py-20 md:px-10 md:py-28">
          <h2 id="services-heading" data-reveal className="font-heading font-black uppercase leading-[0.9] tracking-[-0.025em] text-ink text-[clamp(2.6rem,8vw,5.5rem)]">
            Services
          </h2>
          <ul className="mt-12 grid gap-8 md:mt-14 lg:grid-cols-3">
            {SERVICES.map(({ href, code, name, line, price, action, Icon, band, dots }, i) => (
              <li key={href} data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
                <Link href={href} className="comic-lift group flex h-full flex-col overflow-hidden rounded-2xl comic-border comic-shadow bg-bone">
                  <span className={`relative flex h-36 items-center justify-between border-b-[3px] border-ink px-6 md:h-40 ${band}`}>
                    <span aria-hidden className={`absolute inset-0 ${dots}`} />
                    <Icon className="relative h-14 w-14 md:h-16 md:w-16" strokeWidth={1.5} />
                    <span className="relative rounded-full border-2 border-current px-3 py-1 font-heading text-[11px] font-extrabold uppercase tracking-[0.12em]">
                      {code}
                    </span>
                  </span>
                  <span className="flex flex-1 flex-col p-6 md:p-7">
                    <span className="font-heading text-3xl font-black uppercase leading-none tracking-[-0.02em] text-ink md:text-[2.4rem]">{name}</span>
                    <span className="mt-3 text-[15px] leading-relaxed text-ink/70">{line}</span>
                    <span className="mt-5 mb-7 inline-flex self-start rounded-md border-2 border-ink bg-white px-2.5 py-1 font-heading text-xs font-extrabold uppercase tracking-[0.06em] text-ink tabular-nums">
                      {price}
                    </span>
                    <span className="comic-btn mt-auto w-full">{action}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="faq-heading" className="relative overflow-hidden border-t-[3px] border-ink bg-bone">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 md:grid-cols-[1fr_1.5fr] md:gap-16 md:px-10 md:py-28">
          <div className="md:sticky md:top-28 md:self-start">
            <Eyebrow>Before You Order</Eyebrow>
            <h2 id="faq-heading" className="mt-4 mb-7 font-heading font-black uppercase leading-[0.92] tracking-[-0.02em] text-ink text-[clamp(2.3rem,5vw,3.75rem)]">
              Frequently asked questions
            </h2>
            <Link href="/faq" className="comic-btn comic-btn-light press h-12 text-[13px]">See all FAQs</Link>
          </div>
          <div data-reveal className="border-t-[3px] border-ink">
            {FAQ.map((item) => (
              <details key={item.q} className="group border-b-2 border-ink/80">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 font-heading text-base font-extrabold text-ink select-none md:text-lg [&::-webkit-details-marker]:hidden">
                  <span>{item.q}</span>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-[2.5px] border-ink bg-white transition-colors duration-200 group-open:bg-rx group-hover:bg-peach group-open:group-hover:bg-rx">
                    <Plus className="h-4 w-4 text-ink transition-transform duration-300 ease-[var(--ease-out)] group-open:rotate-45 group-open:text-white" strokeWidth={3} />
                  </span>
                </summary>
                <div className="max-w-[62ch] pr-14 pb-7 text-base leading-relaxed text-ink/75">{item.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="terms-heading" className="border-t-[3px] border-ink bg-cream py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-4 md:px-10">
          <div className="mb-12 max-w-2xl md:mb-14">
            <h2 id="terms-heading" className="mb-5 font-heading font-black uppercase leading-[0.92] tracking-[-0.02em] text-ink text-[clamp(2.3rem,5vw,3.75rem)]">
              Terms of Service
            </h2>
            <p className="text-base leading-relaxed text-ink/75">
              By placing an order you agree to these terms. Key points are summarized below.{" "}
              <Link href="/terms" className="font-semibold text-rx underline decoration-2 underline-offset-2">Read the full terms</Link>
            </p>
          </div>
          <div data-reveal="stagger" className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {TOS_HIGHLIGHTS.map(({ title, body, Icon }) => (
              <div key={title} className="rounded-2xl border-[2.5px] border-ink bg-bone p-6 md:p-8">
                <span className="mb-5 grid h-10 w-10 place-items-center rounded-full border-2 border-ink bg-peach">
                  <Icon className="h-5 w-5 text-ink" strokeWidth={2} />
                </span>
                <h3 className="mb-2 font-heading text-lg font-extrabold uppercase tracking-[0.01em] text-ink">{title}</h3>
                <p className="text-sm leading-relaxed text-ink/70 md:text-[15px]">{body}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm leading-relaxed text-amber-950 md:p-6">
            <strong>Important:</strong> All sales are final once work begins. Turnaround times are estimates only and are not guaranteed.
            The Card Doc LLC is not responsible for loss or damage during transit. Restoration results vary by card condition.
            By submitting an order, you acknowledge and agree to the full{" "}
            <Link href="/terms" className="font-semibold underline hover:text-amber-800">Terms and Conditions</Link>.
          </div>
        </div>
      </section>

      <section aria-labelledby="close-heading" className="border-t-[3px] border-ink bg-peach px-4 py-16 md:px-10 md:py-24">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl comic-border comic-shadow bg-rx px-6 py-14 text-center text-white md:px-12 md:py-20">
          <div aria-hidden className="absolute inset-0 halftone-light" />
          <h2 id="close-heading" data-reveal className="relative font-heading font-black uppercase leading-[0.92] tracking-[-0.025em] text-[clamp(2.1rem,6vw,4.5rem)] [text-shadow:4px_4px_0_var(--ink)]">
            <span className="block">Your Collection Means Something.</span>
            <span className="block">We Understand Why.</span>
          </h2>
          <p data-reveal className="relative mx-auto mt-6 max-w-xl text-lg font-medium leading-relaxed text-white/90 md:text-xl">
            From childhood favorites to prized collectibles, every card deserves thoughtful care.
          </p>
          <div data-reveal className="relative mt-10 flex flex-col justify-center gap-4 sm:flex-row">
            <Link href="/tier-selection" className="comic-btn comic-btn-ink press">Explore Restoration Services</Link>
            <a href={INSTAGRAM} target="_blank" rel="noopener noreferrer" className="comic-btn comic-btn-light press">
              Contact Us
              <span className="sr-only">on Instagram (opens in a new tab)</span>
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
