import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BadgeCheck, Ban, Clock, MessageCircle, Microscope, Plus, ScanSearch, ShieldAlert, Sparkles, Truck, Wrench } from "lucide-react";
import { CountUp } from "@/components/motion/count-up";
import { ExpandingStage } from "@/components/motion/expanding-stage";
import { ScanReveal } from "@/components/motion/scan-reveal";
import { ScrollFan } from "@/components/motion/scroll-fan";
import { SplitReveal } from "@/components/motion/split-reveal";
import { TrustedBy } from "@/components/marketing/trusted-by";
import { getCardsRestoredStat } from "@/lib/site-stats";
import { SITE_URL_FALLBACK } from "@/lib/site-url";
import { CustomerReviews } from "@/components/marketing/customer-reviews";
import { BeforeAfter } from "@/components/motion/before-after";
import mantleBefore from "@/public/specimen-mantle-before.jpg";
import mantleAfter from "@/public/specimen-mantle-after.jpg";
import charmander from "@/public/specimen-charmander.png";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: `${SITE_URL_FALLBACK}/` },
};

const TAGLINE = "Expert card restoration & PSA prep — every card treated like it's worth a fortune.";

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

const QUICK_LINKS = [
  { href: "/tier-selection", label: "Restoration Pricing" },
  { href: "/prep", label: "PSA Prep Pricing" },
  { href: "/shop", label: "Shop Kits" },
  { href: "/track", label: "Track My Order" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/faq", label: "FAQ" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/gift-cards", label: "Gift Cards" },
  { href: "/account", label: "My Account" },
];

const SERVICES = [
  {
    href: "/tier-selection",
    code: "Service",
    name: "Restoration",
    line: "Surfaces, corners & edges — cleaned and restored to their best.",
    price: <>From <span className="text-ink font-semibold">$75</span> / card</>,
    action: "View Tiers",
    Icon: Sparkles,
  },
  {
    href: "/prep",
    code: "Service",
    name: "Prep",
    line: "Grade-ready submission prep for PSA, BGS & CGC.",
    price: <>From <span className="text-ink font-semibold">$25</span> / card</>,
    action: "View Pricing",
    Icon: Microscope,
  },
  {
    href: "/shop",
    code: "Shop",
    name: "DIY Kits",
    line: "The same pro-grade tools The Card Doc uses — delivered to you.",
    price: <>US shipping at cost + <span className="text-ink font-semibold">$2</span> handling</>,
    action: "Shop Now",
    Icon: Wrench,
  },
];

function structuredData() {
  const base = SITE_URL_FALLBACK;
  const org = `${base}/#organization`;
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": org,
        name: "The Card Doc",
        url: `${base}/`,
        logo: `${base}/card-doctor.jpg`,
        image: `${base}/og-image.png`,
        description: TAGLINE,
        sameAs: ["https://www.instagram.com/the_card_doc"],
      },
      {
        "@type": "WebSite",
        "@id": `${base}/#website`,
        name: "The Card Doc",
        url: `${base}/`,
        publisher: { "@id": org },
      },
      {
        "@type": "Service",
        name: "Card Restoration",
        serviceType: "Trading card restoration",
        description: SERVICES[0].line,
        url: `${base}/tier-selection`,
        provider: { "@id": org },
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
        url: `${base}/prep`,
        provider: { "@id": org },
        areaServed: ["US", "PR"],
        offers: {
          "@type": "Offer",
          priceSpecification: { "@type": "UnitPriceSpecification", minPrice: 25, priceCurrency: "USD", unitText: "card" },
        },
      },
      {
        "@type": "FAQPage",
        "@id": `${base}/#faq`,
        mainEntity: FAQ.map(({ q, a }) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
    ],
  };
  return JSON.stringify(graph).replace(/</g, "\\u003c");
}

export default async function HomePage() {
  const cardsRestored = await getCardsRestoredStat();
  const stats = [
    { stat: cardsRestored, label: "Cards Restored" },
    { stat: "Free", label: "Photo Review" },
  ];
  const proof = [
    { Icon: BadgeCheck, strong: cardsRestored, text: "Cards Restored" },
    { Icon: ScanSearch, strong: "Free", text: "Photo Review" },
    { Icon: MessageCircle, strong: null, text: "We reply within 1 business day." },
  ];

  return (
    <div className="min-h-screen bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData() }} />

      <section className="light-table relative overflow-x-clip border-b border-rule">
        <div className="max-w-7xl mx-auto px-4 md:px-10 pt-8 pb-14 md:pt-14 md:pb-20 lg:pt-16 lg:pb-24 grid gap-x-12 gap-y-10 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-7 lg:row-start-1 lg:self-end">
            <h1 className="font-heading font-extrabold text-ink tracking-[-0.025em] leading-[0.84] text-[clamp(3.75rem,19.5vw,6.5rem)] sm:text-[clamp(6rem,15vw,8.5rem)] lg:text-[clamp(6rem,8.6vw,8.25rem)]">
              <SplitReveal text="The Card Doc" lines={["The Card", "Doc"]} step={110} />
            </h1>
            <p className="hero-in mt-6 md:mt-8 max-w-[34rem] text-lg md:text-xl text-muted-foreground leading-relaxed [text-wrap:pretty]" style={{ ["--d" as string]: 300 }}>
              {TAGLINE}
            </p>
            <div className="hero-in mt-8 grid grid-cols-2 sm:flex gap-3" style={{ ["--d" as string]: 420 }}>
              <Link
                href="/tier-selection"
                className="press btn-depth btn-sheen inline-flex h-14 items-center justify-center rounded-md bg-rx px-4 sm:px-8 text-[15px] sm:text-base font-semibold text-primary-foreground transition-colors hover:bg-rx/90"
              >
                Restoration Pricing
              </Link>
              <Link
                href="/prep"
                className="press inline-flex h-14 items-center justify-center rounded-md bg-white px-4 sm:px-8 text-[15px] sm:text-base font-semibold text-ink ring-1 ring-inset ring-ink/70 transition-colors hover:bg-ink hover:text-paper"
              >
                PSA Prep Pricing
              </Link>
            </div>
          </div>

          <figure className="relative mx-auto w-full max-w-[30rem] sm:max-w-[34rem] lg:max-w-none lg:col-span-5 lg:col-start-8 lg:row-start-1 lg:row-span-2 mt-16 sm:mt-20 lg:mt-14">
            <div className="absolute -top-[22%] sm:-top-[24%] lg:-top-[13%] left-[2%] sm:left-auto sm:-right-[1%] lg:-right-[3%] w-[38%] lg:w-[42%] -rotate-[10deg] sm:rotate-[8deg] z-0">
              <div className="fan-in">
                <ScrollFan>
                  <div className="rounded-lg bg-white p-2 md:p-2.5 ring-1 ring-ink/15 shadow-[0_24px_50px_-24px_oklch(0.25_0.006_70/0.5)]">
                    <div className="rounded-md bg-[oklch(0.96_0.003_80)] px-3 py-4">
                      <Image
                        src={charmander}
                        alt="A Charmander card before and after restoration"
                        sizes="(min-width: 1024px) 220px, 40vw"
                        className="w-full h-auto"
                        loading="eager"
                      />
                    </div>
                  </div>
                </ScrollFan>
              </div>
            </div>

            <div className="specimen-land relative z-10">
              <div className="rounded-lg border border-ink/70 bg-white overflow-hidden shadow-[0_40px_80px_-40px_oklch(0.25_0.006_70/0.55)]">
                <div className="p-2 md:p-3">
                  <BeforeAfter
                    before={mantleBefore}
                    after={mantleAfter}
                    beforeAlt="A Mickey Mantle card before restoration, cracked across the face and jersey"
                    afterAlt="The same Mickey Mantle card after restoration"
                    sizes="(min-width: 1280px) 440px, (min-width: 1024px) 34vw, 92vw"
                    priority
                  />
                </div>
                <div className="bg-rx px-4 py-2">
                  <span className="rx-label text-primary-foreground">The Card Doc</span>
                </div>
              </div>
            </div>
          </figure>

          <ul
            aria-label="Why collectors trust The Card Doc"
            className="hero-in lg:col-span-7 lg:row-start-2 lg:self-start grid grid-cols-2 sm:grid-cols-3 rounded-xl bg-white ring-1 ring-rule"
            style={{ ["--d" as string]: 540 }}
          >
            {proof.map(({ Icon, strong, text }, i) => (
              <li
                key={text}
                className={`flex items-center gap-3 px-4 py-4 md:px-5 md:py-5 ${i === 1 ? "border-l border-rule" : ""} ${i === 2 ? "col-span-2 sm:col-span-1 border-t sm:border-t-0 sm:border-l border-rule" : ""}`}
              >
                <Icon className="h-5 w-5 shrink-0 text-rx" strokeWidth={1.75} />
                <span className="text-[13px] md:text-sm leading-snug text-ink">
                  {strong && (
                    <span className="block font-heading text-lg md:text-xl leading-tight tracking-[-0.01em] [font-feature-settings:'lnum'_1,'tnum'_1]">
                      {strong}
                    </span>
                  )}
                  <span className={strong ? "text-muted-foreground" : "font-medium"}>{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <TrustedBy />

      <section className="bg-paper pt-5 md:pt-8">
        <ExpandingStage className="stage stage-light overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 md:px-10 pt-20 pb-20 md:pt-32 md:pb-28">
            <h2 data-reveal className="max-w-6xl mx-auto font-heading text-4xl md:text-6xl font-extrabold tracking-[-0.02em] leading-[0.95] text-stage-fg mb-12 md:mb-16">
              What our customers say
            </h2>
            <CustomerReviews />
          </div>

          <div className="max-w-6xl mx-auto px-4 md:px-10 pb-24 md:pb-36">
            <div className="border-t border-white/12 pt-20 md:pt-28 grid gap-14 lg:gap-16 lg:grid-cols-[1fr_1fr] lg:items-center">
              <div data-reveal>
                <p className="rx-label text-rx-bright mb-5">Why Collectors Trust Us</p>
                <h2 className="font-heading text-5xl md:text-[4rem] font-extrabold tracking-[-0.02em] leading-[0.92] text-stage-fg mb-7">
                  Proven Results
                </h2>
                <p className="text-lg text-stage-muted max-w-xl leading-relaxed mb-10">
                  Hundreds of cards restored and prepped. We don&apos;t just claim results, we show them.
                </p>
                <Link
                  href="/tier-selection"
                  className="press btn-depth btn-sheen inline-flex h-14 items-center rounded-md bg-rx px-8 text-base font-semibold text-primary-foreground hover:bg-rx/90 transition-colors"
                >
                  See Our Services
                </Link>
              </div>
              <div className="relative mx-auto w-full max-w-[30rem]">
                <ScanReveal
                  src={charmander}
                  alt="A Charmander card before and after restoration"
                  sizes="(min-width: 1024px) 480px, 90vw"
                />
              </div>
            </div>

            <dl className="@container mt-20 md:mt-28 grid grid-cols-1 sm:grid-cols-2 border-t border-white/12">
              {stats.map((s, i) => (
                <div
                  key={s.stat}
                  data-reveal
                  style={{ transitionDelay: `${i * 90}ms` }}
                  className={`flex flex-col-reverse gap-3 py-8 md:py-10 border-b border-white/12 sm:border-b-0 ${i > 0 ? "sm:border-l sm:pl-8 md:pl-10" : ""}`}
                >
                  <dt className="rx-label text-stage-muted">{s.label}</dt>
                  <dd className="font-heading text-[clamp(4rem,21cqi,6rem)] sm:text-[clamp(2.75rem,9cqi,6.75rem)] font-extrabold tracking-[-0.015em] leading-[0.9] whitespace-nowrap text-stage-fg">
                    <CountUp value={s.stat} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </ExpandingStage>
      </section>

      <section aria-labelledby="services-heading" className="max-w-7xl mx-auto px-4 md:px-10 py-20 md:py-28">
        <h2 id="services-heading" className="sr-only">Services</h2>
        <ul data-reveal="stagger" className="grid lg:grid-cols-3 rounded-b-xl bg-white border-t-[6px] border-rx ring-1 ring-rule">
          {SERVICES.map(({ href, code, name, line, price, action, Icon }, i) => (
            <li key={href} className={`flex ${i > 0 ? "border-t lg:border-t-0 lg:border-l border-rule" : ""}`}>
              <Link href={href} className="group flex w-full flex-col p-6 md:p-8 transition-colors duration-300 hover:bg-paper/60">
                <span className="flex items-center gap-3">
                  <Icon className="h-5 w-5 text-rx" strokeWidth={1.75} />
                  <span className="rx-label">{code}</span>
                </span>
                <span className="mt-5 font-heading text-3xl md:text-[2.25rem] leading-none tracking-[-0.015em] text-ink">{name}</span>
                <span className="mt-3 text-[15px] text-muted-foreground leading-relaxed">{line}</span>
                <span className="mt-4 mb-7 block font-mono text-xs text-muted-foreground tabular-nums">{price}</span>
                <span className="press btn-depth btn-sheen mt-auto inline-flex h-12 w-full items-center justify-center rounded-md bg-rx px-5 text-[15px] font-semibold text-primary-foreground transition-colors group-hover:bg-rx/90">
                  {action}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-rule">
        <div className="max-w-6xl mx-auto px-4 md:px-10 py-20 md:py-32 grid gap-10 md:gap-16 md:grid-cols-[1fr_1.5fr]">
          <div className="md:sticky md:top-28 md:self-start">
            <h2 className="font-heading text-4xl md:text-6xl font-extrabold tracking-[-0.02em] leading-[0.95] text-ink mb-6">
              Frequently asked questions
            </h2>
            <Link href="/faq" className="draw-underline pb-0.5 text-sm font-semibold text-rx">
              See all FAQs
            </Link>
          </div>
          <div data-reveal className="border-t border-ink/80">
            {FAQ.map((item) => (
              <details key={item.q} className="group relative border-b border-rule">
                <summary className="flex items-center justify-between gap-6 py-6 cursor-pointer list-none select-none font-heading text-lg md:text-xl font-bold tracking-[-0.01em] text-ink [&::-webkit-details-marker]:hidden">
                  <span>{item.q}</span>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full ring-1 ring-rule transition-[background-color,box-shadow] duration-300 group-hover:ring-rx group-open:bg-rx group-open:ring-rx">
                    <Plus className="h-4 w-4 text-rx transition-transform duration-300 ease-[var(--ease-out)] group-open:rotate-45 group-open:text-primary-foreground" strokeWidth={2} />
                  </span>
                </summary>
                <div className="pb-7 pr-14 text-base text-muted-foreground leading-relaxed max-w-[62ch]">
                  {item.a}
                </div>
                <span aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-px h-px origin-left scale-x-0 bg-rx transition-transform duration-500 ease-[var(--ease-out)] group-hover:scale-x-100 group-open:scale-x-100" />
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-rule bg-paper py-20 md:py-32">
        <div className="max-w-6xl mx-auto px-4 md:px-10">
          <div className="mb-12 md:mb-16 max-w-2xl">
            <h2 className="font-heading text-4xl md:text-6xl font-extrabold tracking-[-0.02em] leading-[0.95] text-ink mb-5">
              Terms of Service
            </h2>
            <p className="text-base text-muted-foreground leading-relaxed">
              By placing an order you agree to these terms. Key points are summarized below.{" "}
              <Link href="/terms" className="text-rx font-semibold hover:underline">Read the full terms</Link>
            </p>
          </div>
          <div data-reveal="stagger" className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {TOS_HIGHLIGHTS.map(({ title, body, Icon }) => (
              <div key={title} className="lit-border relative rounded-xl bg-white ring-1 ring-rule p-6 md:p-8">
                <Icon className="h-5 w-5 text-rx mb-5" strokeWidth={1.75} />
                <h3 className="font-heading font-bold text-xl text-ink mb-2">{title}</h3>
                <p className="text-sm md:text-[15px] text-muted-foreground leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-5 md:p-6 text-sm text-amber-950 leading-relaxed">
            <strong>Important:</strong> All sales are final once work begins. Turnaround times are estimates only and are not guaranteed.
            The Card Doc LLC is not responsible for loss or damage during transit. Restoration results vary by card condition.
            By submitting an order, you acknowledge and agree to the full{" "}
            <Link href="/terms" className="font-semibold underline hover:text-amber-800">Terms and Conditions</Link>.
          </div>
        </div>
      </section>

      <section className="border-t border-rule">
        <nav aria-label="Quick links" className="max-w-6xl mx-auto px-4 md:px-10 py-14 md:py-20">
          <ul data-reveal="stagger" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 sm:gap-x-10 md:gap-x-14 border-t border-ink/80">
            {QUICK_LINKS.map((l) => (
              <li key={l.href} className="border-b border-rule">
                <Link
                  href={l.href}
                  className="block py-5 md:py-6 font-heading text-lg md:text-xl font-bold tracking-[-0.01em] text-ink transition-colors duration-200 hover:text-rx"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </section>
    </div>
  );
}
