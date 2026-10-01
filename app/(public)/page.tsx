import Link from "next/link";
import { Microscope, Plus, Sparkles, Wrench } from "lucide-react";
import { CountUp } from "@/components/motion/count-up";
import { HoloSpecimen } from "@/components/motion/holo-specimen";
import { Marquee } from "@/components/motion/marquee";
import { SplitReveal } from "@/components/motion/split-reveal";
import { getTestimonials } from "@/lib/testimonials";

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
  },
  {
    title: "You assume shipping risk",
    body: "You are responsible for selecting your shipping method and carrier. The Card Doc assumes no responsibility for loss or damage in transit until items are physically received and confirmed.",
  },
  {
    title: "Restoration alters your card",
    body: "Restoration is detectable by professional graders and results in an 'Altered' designation. If your card is damaged during restoration, our liability is limited to the service fee paid — not the card's market value.",
  },
  {
    title: "No refunds after work begins",
    body: "All sales are final once restoration work has commenced. If we believe a card won't respond well to treatment, we will contact you before proceeding.",
  },
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

  return (
    <div className="min-h-screen bg-background">

      {/* ── Hero ── */}
      <section className="bg-paper border-b border-rule">
        <div className="max-w-7xl mx-auto px-4 md:px-10 pt-8 pb-12 md:pt-16 md:pb-20 grid gap-6 md:gap-8 lg:gap-x-14 lg:gap-y-8 lg:grid-cols-[1.05fr_1fr] lg:grid-rows-[auto_1fr] items-start">
          <div className="lg:col-start-1 lg:row-start-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/card-doctor.jpg" alt="The Card Doc" className="hidden sm:block w-12 h-12 rounded-md object-cover ring-1 ring-rule mb-6" />
            <h1 className="font-heading text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-[-0.035em] leading-[0.95] text-ink mb-4 md:mb-5 [font-variation-settings:'wdth'_80]">
              <SplitReveal text="The Card Doc" />
            </h1>
            <p className="hero-in text-lg md:text-xl text-muted-foreground max-w-md leading-relaxed" style={{ ["--d" as string]: 260 }}>
              Expert card restoration &amp; PSA prep — every card treated like it&apos;s worth a fortune.
            </p>
          </div>

          {/* Before / after specimen, labelled like a sample */}
          <figure className="lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-center specimen-in">
            <HoloSpecimen>
            <div className="rounded-lg border border-ink/70 bg-white overflow-hidden">
              <div className="p-2 md:p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/before-after-mickey-mantle.png"
                  alt="A Mickey Mantle card before and after restoration"
                  width={1446}
                  height={1087}
                  className="w-full h-auto rounded-md"
                  fetchPriority="high"
                />
              </div>
              <figcaption className="bg-rx px-4 py-2">
                <span className="rx-label text-primary-foreground">The Card Doc</span>
              </figcaption>
            </div>
            </HoloSpecimen>
          </figure>

          {/* Services, laid out like the lines of a prescription label */}
          <ul className="lg:col-start-1 lg:row-start-2 border-t-[6px] border-rx border-b border-b-ink/80 divide-y divide-rule">
            {services.map(({ href, code, name, line, price, action, Icon }, i) => (
              <li key={href} className="rx-reveal" style={{ ["--i" as string]: i }}>
                <Link
                  href={href}
                  className="group nudge-arrow grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-2 py-4 sm:py-5 -mx-3 px-3 rounded-md transition-colors duration-200 hover:bg-rx-soft/50"
                >
                  <Icon className="h-5 w-5 text-rx self-start mt-1" strokeWidth={1.75} />
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-3">
                      <span className="font-heading text-xl font-bold text-ink">{name}</span>
                      <span className="rx-label">{code}</span>
                    </span>
                    <span className="block text-sm text-muted-foreground leading-snug mt-0.5">{line}</span>
                    <span className="block font-mono text-xs text-muted-foreground mt-1.5">{price}</span>
                  </span>
                  <span className="col-start-2 sm:col-start-auto inline-flex h-9 items-center justify-center rounded-md bg-rx px-4 text-sm font-semibold text-primary-foreground transition-colors group-hover:bg-rx/90 whitespace-nowrap justify-self-start sm:justify-self-end">
                    {action.replace(" →", "")}{" "}<span className="arrow" aria-hidden>→</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Proven Results ── */}
      <section className="border-b border-rule py-16 md:py-24">
        <div data-reveal className="max-w-6xl mx-auto px-4 md:px-10 grid gap-10 md:grid-cols-[1.2fr_1fr] md:items-end">
          <div>
            <p className="rx-label text-rx mb-4">Why Collectors Trust Us</p>
            <h2 className="font-heading text-4xl md:text-5xl font-extrabold tracking-tight text-ink mb-5 leading-[1.02]">
              Proven Results,<br className="hidden md:block" /> Every Time
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl leading-relaxed mb-8">
              Hundreds of cards restored and prepped — documented with before &amp; after photos for every submission. We don&apos;t just claim results, we show them.
            </p>
            <Link
              href="/tier-selection"
              className="nudge-arrow inline-flex h-11 items-center rounded-md bg-rx px-6 text-[15px] font-semibold text-primary-foreground hover:bg-rx/90 transition-colors"
            >
              See Our Services <span className="arrow ml-1" aria-hidden>→</span>
            </Link>
          </div>
          <dl className="border-t border-ink/80 divide-y divide-rule">
            {[
              { stat: "500+", label: "Cards Restored" },
              { stat: "4.9★", label: "Avg. Rating" },
              { stat: "100%", label: "Documented" },
            ].map((s) => (
              <div key={s.stat} className="flex items-baseline justify-between py-4">
                <dt className="rx-label">{s.label}</dt>
                <dd className="font-heading text-3xl md:text-4xl font-bold text-ink tabular-nums"><CountUp value={s.stat} /></dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── Reviews ── */}
      {testimonials.length > 0 && (
        <section className="bg-paper border-b border-rule py-16 md:py-24">
          <div className="max-w-6xl mx-auto px-4 md:px-10">
            <h2 data-reveal className="font-heading text-3xl md:text-4xl font-extrabold tracking-tight text-ink mb-10">
              What our customers say
            </h2>
          </div>
          <div data-reveal>
            <Marquee seconds={80}>
              {testimonials.map((t) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={t.id}
                  src={t.url}
                  alt={t.alt ?? "Customer review"}
                  loading="lazy"
                  className="h-[300px] md:h-[380px] w-auto shrink-0 rounded-md ring-1 ring-rule"
                />
              ))}
            </Marquee>
          </div>
        </section>
      )}

      {/* ── FAQ ── */}
      <section data-reveal className="max-w-6xl mx-auto px-4 md:px-10 py-16 md:py-24 grid gap-8 md:grid-cols-[1fr_1.6fr]">
        <div>
          <h2 className="font-heading text-3xl md:text-4xl font-extrabold tracking-tight text-ink mb-4 md:sticky md:top-28">
            Frequently asked questions
          </h2>
          <Link href="/faq" className="text-sm font-semibold text-rx hover:underline">
            See all FAQs →
          </Link>
        </div>
        <div className="border-t border-ink/80 divide-y divide-rule border-b border-b-rule">
          {FAQ.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex items-center justify-between gap-6 py-5 cursor-pointer list-none select-none font-semibold text-[15px] text-ink hover:text-rx transition-colors [&::-webkit-details-marker]:hidden">
                <span>{item.q}</span>
                <Plus className="h-4 w-4 shrink-0 text-rx transition-transform duration-200 group-open:rotate-45" strokeWidth={2} />
              </summary>
              <div className="pb-5 pr-10 text-[15px] text-muted-foreground leading-relaxed max-w-[65ch]">
                {item.a}
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* ── Terms of Service ── */}
      <section className="border-t border-rule bg-paper py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-4 md:px-10">
          <div className="mb-10 max-w-2xl">
            <h2 className="font-heading text-3xl md:text-4xl font-extrabold tracking-tight text-ink mb-3">
              Terms of Service
            </h2>
            <p className="text-[15px] text-muted-foreground">
              By placing an order you agree to these terms. Key points are summarized below.{" "}
              <Link href="/terms" className="text-rx font-semibold hover:underline">Read the full terms →</Link>
            </p>
          </div>
          <div data-reveal="stagger" className="grid grid-cols-1 md:grid-cols-2 border-t border-ink/80">
            {TOS_HIGHLIGHTS.map((item, i) => (
              <div
                key={item.title}
                className={`py-6 border-b border-rule md:pr-10 ${i % 2 === 1 ? "md:pl-10 md:border-l" : ""}`}
              >
                <h3 className="font-heading font-bold text-lg text-ink mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 bg-amber-50 border border-amber-200 rounded-md p-5 text-sm text-amber-950 leading-relaxed">
            <strong>Important:</strong> All sales are final. Turnaround times are estimates only and are not guaranteed.
            The Card Doc LLC is not responsible for loss or damage during transit. Restoration results vary by card condition.
            By submitting an order, you acknowledge and agree to the full{" "}
            <Link href="/terms" className="font-semibold underline hover:text-amber-800">Terms and Conditions</Link>.
          </div>
        </div>
      </section>

      {/* ── Quick links ── */}
      <section className="border-t border-rule py-8">
        <div className="max-w-6xl mx-auto px-4 md:px-10">
          <div className="flex flex-wrap gap-x-7 gap-y-3 text-sm">
            <Link href="/tier-selection" className="text-muted-foreground hover:text-ink font-medium transition-colors">Restoration Pricing</Link>
            <Link href="/prep" className="text-muted-foreground hover:text-ink font-medium transition-colors">PSA Prep Pricing</Link>
            <Link href="/shop" className="text-muted-foreground hover:text-ink font-medium transition-colors">Shop Kits</Link>
            <Link href="/track" className="text-muted-foreground hover:text-ink font-medium transition-colors">Track My Order</Link>
            <Link href="/how-it-works" className="text-muted-foreground hover:text-ink font-medium transition-colors">How It Works</Link>
            <Link href="/faq" className="text-muted-foreground hover:text-ink font-medium transition-colors">FAQ</Link>
            <Link href="/terms" className="text-muted-foreground hover:text-ink font-medium transition-colors">Terms of Service</Link>
            <Link href="/gift-cards" className="text-muted-foreground hover:text-ink font-medium transition-colors">Gift Cards</Link>
            <Link href="/account" className="text-muted-foreground hover:text-ink font-medium transition-colors">My Account</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
