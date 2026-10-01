import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, BadgeCheck, Ban, Clock, MessageCircle, Microscope, Plus, ShieldAlert, ShieldCheck, Sparkles, Star, Truck, Wrench } from "lucide-react";
import { CountUp } from "@/components/motion/count-up";
import { ExpandingStage } from "@/components/motion/expanding-stage";
import { HoloSpecimen } from "@/components/motion/holo-specimen";
import { ParallaxWall } from "@/components/motion/parallax-wall";
import { ScanReveal } from "@/components/motion/scan-reveal";
import { ScrollFan } from "@/components/motion/scroll-fan";
import { SplitReveal } from "@/components/motion/split-reveal";
import { getTestimonials } from "@/lib/testimonials";
import mickeyMantle from "@/public/before-after-mickey-mantle.png";
import charmander from "@/public/specimen-charmander.png";

export const dynamic = "force-dynamic";

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
    a: "Prep typically turns around in 10–15 business days. Restorations range from 2–3 months (Bronze) down to 3–5 business days (Ultra Premium) depending on the tier you choose.",
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
    title: "Restoration alters your card",
    body: "Restoration is detectable by professional graders and results in an 'Altered' designation. If your card is damaged during restoration, our liability is limited to the service fee paid — not the card's market value.",
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

export default async function HomePage() {
  let testimonials: Awaited<ReturnType<typeof getTestimonials>> = [];
  try {
    testimonials = await getTestimonials();
  } catch {
    testimonials = [];
  }

  const services = [
    {
      href: "/tier-selection",
      code: "Service",
      name: "Restoration",
      line: <>Surfaces, corners &amp; edges — cleaned and restored to their best.</>,
      price: <>From <span className="text-ink font-semibold">$75</span> / card</>,
      action: "View Tiers →",
      Icon: Sparkles,
    },
    {
      href: "/prep",
      code: "Service",
      name: "Prep",
      line: <>Grade-ready submission prep for PSA, BGS &amp; CGC.</>,
      price: <>From <span className="text-ink font-semibold">$25</span> / card</>,
      action: "View Pricing →",
      Icon: Microscope,
    },
    {
      href: "/shop",
      code: "Shop",
      name: "DIY Kits",
      line: <>The same pro-grade tools The Card Doc uses — delivered to you.</>,
      price: <><span className="text-ink font-semibold">Free shipping</span> on all kits</>,
      action: "Shop Now →",
      Icon: Wrench,
    },
  ];

  const stats = [
    { stat: "500+", label: "Cards Restored" },
    { stat: "4.9★", label: "Avg. Rating" },
    { stat: "100%", label: "Documented" },
  ];

  return (
    <div className="min-h-screen bg-background">

      {/* ── Hero: the light table ── */}
      <section className="light-table relative overflow-x-clip border-b border-rule">
        <div className="max-w-7xl mx-auto px-4 md:px-10 pt-6 pb-12 md:pt-12 md:pb-20 lg:pt-14 lg:pb-20 grid gap-10 lg:gap-x-12 lg:gap-y-10 lg:grid-cols-12 items-start">
          <div className="lg:col-span-7 lg:row-start-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/card-doctor.jpg" alt="The Card Doc" className="hero-in hidden sm:block lg:hidden w-12 h-12 rounded-md object-cover ring-1 ring-rule mb-8" />
            {/* Desktop: the Doc's mark and the subline sit on the "Doc" line, right-aligned, like a label beside the name */}
            <div className="grid">
              <h1 className="col-start-1 row-start-1 font-heading font-extrabold text-ink tracking-[-0.045em] leading-[0.84] text-[clamp(4.25rem,21vw,6.5rem)] sm:text-[clamp(6rem,15vw,8.5rem)] lg:text-[clamp(7rem,10vw,9.25rem)] [font-variation-settings:'wdth'_74]">
                <SplitReveal text="The Card Doc" lines={["The Card", "Doc"]} step={110} />
              </h1>
              <div
                className="hero-in hidden lg:flex col-start-1 row-start-1 justify-self-end self-end items-start gap-4 max-w-[26.5rem] pb-[0.3rem]"
                style={{ ["--d" as string]: 420 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/card-doctor.jpg" alt="" className="w-11 h-11 shrink-0 rounded-md object-cover ring-1 ring-rule mt-1" />
                <p className="text-lg text-muted-foreground leading-relaxed">
                  Expert card restoration &amp; PSA prep — every card treated like it&apos;s worth a fortune.
                </p>
              </div>
            </div>
            <p className="hero-in lg:hidden mt-6 text-lg md:text-xl text-muted-foreground max-w-md leading-relaxed" style={{ ["--d" as string]: 300 }}>
              Expert card restoration &amp; PSA prep — every card treated like it&apos;s worth a fortune.
            </p>
          </div>

          {/* Specimens on the light table: the Charmander case sits behind and fans out on scroll */}
          <figure className="relative mx-auto w-full max-w-[34rem] lg:max-w-none lg:col-span-5 lg:col-start-8 lg:row-start-1 lg:row-span-2 lg:self-center mt-24 sm:mt-20 lg:mt-0">
            <div className="absolute -top-[30%] sm:-top-[24%] lg:-top-[30%] left-[4%] sm:left-auto sm:-right-[1%] lg:-right-[2%] w-[40%] lg:w-[44%] -rotate-[10deg] sm:rotate-[8deg] z-0">
              <div className="fan-in">
                <ScrollFan>
                  <div className="rounded-lg bg-white p-2 md:p-2.5 ring-1 ring-ink/15 shadow-[0_24px_50px_-24px_oklch(0.25_0.05_165/0.5)]">
                    <div className="rounded-md bg-[oklch(0.96_0.008_165)] px-3 py-4">
                      <Image
                        src={charmander}
                        alt="A Charmander card before and after restoration"
                        sizes="(min-width: 1024px) 220px, 45vw"
                        className="w-full h-auto"
                        loading="eager"
                      />
                    </div>
                  </div>
                </ScrollFan>
              </div>
            </div>

            <div className="specimen-land relative z-10">
              <HoloSpecimen>
                <div className="rounded-lg border border-ink/70 bg-white overflow-hidden shadow-[0_40px_80px_-40px_oklch(0.25_0.05_165/0.55)]">
                  <div className="p-2 md:p-3">
                    <Image
                      src={mickeyMantle}
                      alt="A Mickey Mantle card before and after restoration"
                      sizes="(min-width: 1280px) 520px, (min-width: 1024px) 40vw, 92vw"
                      className="w-full h-auto rounded-md"
                      loading="eager"
                      fetchPriority="high"
                    />
                  </div>
                  <div className="bg-rx px-4 py-2">
                    <span className="rx-label text-primary-foreground">The Card Doc</span>
                  </div>
                </div>
              </HoloSpecimen>
            </div>
          </figure>

          {/* Services, laid out like the lines of a prescription label */}
          <ul className="lg:col-span-7 lg:row-start-2 border-t-[6px] border-rx border-b border-b-ink/80 divide-y divide-rule">
            {services.map(({ href, code, name, line, price, action, Icon }, i) => (
              <li key={href} className="rx-reveal" style={{ ["--i" as string]: i + 3 }}>
                <Link
                  href={href}
                  className="group nudge-arrow grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto] items-center gap-x-4 md:gap-x-5 gap-y-3 py-5 sm:py-6 -mx-3 px-3 rounded-md transition-colors duration-300 hover:bg-white/80"
                >
                  <Icon className="h-5 w-5 text-rx self-start mt-1.5" strokeWidth={1.75} />
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-3">
                      <span className="font-heading text-2xl font-extrabold tracking-[-0.02em] text-ink [font-variation-settings:'wdth'_84]">{name}</span>
                      <span className="rx-label">{code}</span>
                    </span>
                    <span className="block text-sm md:text-[15px] text-muted-foreground leading-snug mt-1">{line}</span>
                    <span className="block font-mono text-xs text-muted-foreground mt-2">{price}</span>
                  </span>
                  <span className="btn-depth btn-sheen col-start-2 sm:col-start-auto inline-flex h-10 items-center justify-center gap-1 rounded-md bg-rx px-4 text-sm font-semibold text-primary-foreground transition-colors group-hover:bg-rx/90 whitespace-nowrap justify-self-start sm:justify-self-end">
                    {action.replace(" →", "")}<span className="arrow" aria-hidden>→</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Trust strip: the owner's own facts, at a glance ── */}
      <section aria-label="Why collectors trust The Card Doc" className="border-b border-rule bg-white">
        <ul data-reveal="stagger" className="max-w-7xl mx-auto grid grid-cols-2 lg:grid-cols-4 divide-rule [&>li]:border-rule">
          {[
            { Icon: BadgeCheck, strong: "500+", text: "Cards Restored" },
            { Icon: Star, strong: "4.9★", text: "Avg. Rating" },
            { Icon: ShieldCheck, strong: null, text: "All cards are insured during transit." },
            { Icon: MessageCircle, strong: null, text: "We reply within 1 business day." },
          ].map(({ Icon, strong, text }, i) => (
            <li
              key={text}
              className={`flex items-center gap-3 px-4 md:px-10 py-5 md:py-6 ${i % 2 === 1 ? "border-l" : ""} ${i < 2 ? "border-b lg:border-b-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}
            >
              <Icon className="h-5 w-5 shrink-0 text-rx" strokeWidth={1.75} />
              <span className="text-[13px] md:text-sm leading-snug text-ink">
                {strong && <span className="font-heading text-base md:text-lg font-extrabold tracking-[-0.01em] mr-1">{strong}</span>}
                <span className={strong ? "text-muted-foreground" : "font-medium"}>{text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Proof: the ink stage ── */}
      <section className="bg-paper pt-5 md:pt-8">
        <ExpandingStage className="stage stage-light overflow-hidden">
          <div className="max-w-6xl mx-auto px-4 md:px-10 pt-20 pb-12 md:pt-32 md:pb-20">
            <div className="grid gap-14 lg:gap-16 lg:grid-cols-[1fr_1fr] lg:items-center">
              <div data-reveal>
                <p className="rx-label text-rx-bright mb-5">Why Collectors Trust Us</p>
                <h2 className="font-heading text-5xl md:text-7xl font-extrabold tracking-[-0.04em] leading-[0.92] text-stage-fg mb-7 [font-variation-settings:'wdth'_78]">
                  Proven Results,<br className="hidden md:block" /> Every Time
                </h2>
                <p className="text-lg text-stage-muted max-w-xl leading-relaxed mb-10">
                  Hundreds of cards restored and prepped — documented with before &amp; after photos for every submission. We don&apos;t just claim results, we show them.
                </p>
                <Link
                  href="/tier-selection"
                  className="btn-depth btn-sheen nudge-arrow inline-flex h-12 items-center gap-1 rounded-md bg-rx px-7 text-[15px] font-semibold text-primary-foreground hover:bg-rx/90 transition-colors"
                >
                  See Our Services <span className="arrow" aria-hidden>→</span>
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

            <dl className="mt-20 md:mt-32 grid grid-cols-1 sm:grid-cols-3 border-t border-white/12">
              {stats.map((s, i) => (
                <div
                  key={s.stat}
                  data-reveal
                  style={{ transitionDelay: `${i * 90}ms` }}
                  className={`flex flex-col-reverse gap-3 py-8 md:py-10 border-b border-white/12 sm:border-b-0 ${i > 0 ? "sm:border-l sm:pl-8 md:pl-10" : ""}`}
                >
                  <dt className="rx-label text-stage-muted">{s.label}</dt>
                  <dd className="font-heading text-7xl md:text-8xl lg:text-[7.5rem] font-extrabold tracking-[-0.05em] leading-[0.9] text-stage-fg [font-variation-settings:'wdth'_76]">
                    <CountUp value={s.stat} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* ── Reviews ── */}
          {testimonials.length > 0 && (
            <div className="max-w-7xl mx-auto px-4 md:px-10 pb-16 md:pb-24">
              <h2 data-reveal className="max-w-6xl mx-auto font-heading text-4xl md:text-6xl font-extrabold tracking-[-0.035em] leading-[0.95] text-stage-fg mt-8 md:mt-12 mb-4 [font-variation-settings:'wdth'_80]">
                What our customers say
              </h2>
              <ParallaxWall items={testimonials} />
            </div>
          )}
        </ExpandingStage>
      </section>

      {/* ── FAQ ── */}
      <section className="max-w-6xl mx-auto px-4 md:px-10 py-20 md:py-32 grid gap-10 md:gap-16 md:grid-cols-[1fr_1.5fr]">
        <div className="md:sticky md:top-28 md:self-start">
          <h2 className="font-heading text-4xl md:text-6xl font-extrabold tracking-[-0.035em] leading-[0.95] text-ink mb-6 [font-variation-settings:'wdth'_80]">
            Frequently asked questions
          </h2>
          <Link href="/faq" className="nudge-arrow draw-underline pb-0.5 text-sm font-semibold text-rx">
            See all FAQs <span className="arrow" aria-hidden>→</span>
          </Link>
        </div>
        <div data-reveal className="border-t border-ink/80">
          {FAQ.map((item) => (
            <details key={item.q} className="group relative border-b border-rule">
              <summary className="flex items-center justify-between gap-6 py-6 cursor-pointer list-none select-none font-heading text-lg md:text-xl font-bold tracking-[-0.01em] text-ink [font-variation-settings:'wdth'_92] [&::-webkit-details-marker]:hidden">
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
      </section>

      {/* ── Terms of Service ── */}
      <section className="border-t border-rule bg-paper py-20 md:py-32">
        <div className="max-w-6xl mx-auto px-4 md:px-10">
          <div className="mb-12 md:mb-16 max-w-2xl">
            <h2 className="font-heading text-4xl md:text-6xl font-extrabold tracking-[-0.035em] leading-[0.95] text-ink mb-5 [font-variation-settings:'wdth'_80]">
              Terms of Service
            </h2>
            <p className="text-base text-muted-foreground leading-relaxed">
              By placing an order you agree to these terms. Key points are summarized below.{" "}
              <Link href="/terms" className="text-rx font-semibold hover:underline">Read the full terms →</Link>
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
            <strong>Important:</strong> All sales are final. Turnaround times are estimates only and are not guaranteed.
            The Card Doc LLC is not responsible for loss or damage during transit. Restoration results vary by card condition.
            By submitting an order, you acknowledge and agree to the full{" "}
            <Link href="/terms" className="font-semibold underline hover:text-amber-800">Terms and Conditions</Link>.
          </div>
        </div>
      </section>

      {/* ── Quick links: an index ── */}
      <section className="border-t border-rule">
        <div className="max-w-6xl mx-auto px-4 md:px-10 py-14 md:py-20">
          <ul data-reveal="stagger" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 sm:gap-x-10 md:gap-x-14 border-t border-ink/80">
            {QUICK_LINKS.map((l) => (
              <li key={l.href} className="border-b border-rule">
                <Link
                  href={l.href}
                  className="group flex items-center justify-between gap-4 py-5 md:py-6 pr-2 font-heading text-lg md:text-xl font-bold tracking-[-0.01em] text-ink transition-colors duration-200 hover:text-rx [font-variation-settings:'wdth'_90]"
                >
                  {l.label}
                  <ArrowUpRight className="h-5 w-5 text-muted-foreground transition-[transform,color] duration-300 ease-[var(--ease-out)] group-hover:text-rx group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={1.75} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
