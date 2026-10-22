import Link from "next/link";
import type { Metadata } from "next";
import { Clock, Hammer, Microscope, MessageCircle, Package, ShieldCheck, ShieldAlert } from "lucide-react";
import { PageHero } from "@/components/marketing/page-hero";
import { StepWalkthrough } from "@/components/motion/step-walkthrough";

export const metadata: Metadata = {
  title: "How It Works — The Card Doc",
  description:
    "The Card Doc is a trading card restoration and grading-prep shop in Ridgewood, New Jersey. Mail us your cards from anywhere in the US, we do the work by hand in our shop, and we ship them back ready for grading or your personal collection.",
};

const INSTAGRAM = "https://www.instagram.com/the_card_doc";

function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="mt-2.5 flex flex-col gap-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-rx" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

const STEPS = [
  {
    n: "1",
    title: "Choose Your Service, Tier, and Add-Ons",
    note: "(Tiers, services, and add-ons lock at checkout and cannot be changed afterward)",
    body: "Pick Restoration or Prep based on your card's current declared value (what it's worth right now, not its projected graded value). Every tier gets the exact same care—you are only paying for turnaround speed and the card value each tier accepts.",
  },
  {
    n: "2",
    title: "Book Your Order at theonethatsaveditall.com",
    note: "(Payment is collected in full at checkout)",
    body: (
      <>
        <p>Add each card individually to your order with:</p>
        <List
          items={[
            "Card details & current declared value",
            "1 to 4 clear photos (required)",
            <><strong className="font-semibold text-ink">Order notes:</strong> Let us know if a card is strictly for your Personal Collection (not being graded) so we know which techniques are on the table.</>,
          ]}
        />
      </>
    ),
  },
  {
    n: "3",
    title: "Pack and Ship Your Cards",
    note: "(US & Puerto Rico orders only)",
    body: (
      <>
        <p>How to pack safely:</p>
        <List
          items={[
            "Place each card in a penny sleeve, then inside a Card Saver 1 or toploader.",
            "Sandwich the holders between two pieces of rigid cardboard.",
            "Wrap in bubble wrap and seal inside a padded mailer or small box so nothing shifts.",
          ]}
        />
      </>
    ),
  },
  {
    n: "4",
    title: "Arrival, Check-In, and Evaluation",
    note: "(Allow 1–3 business days after carrier delivery for check-in)",
    body: (
      <>
        <p>
          We collect from our PO Box once daily. Note that carrier tracking saying &ldquo;Delivered&rdquo; means it reached our PO Box; your order status switches to Cards Received once we open your box, log every card, and take &ldquo;before&rdquo; photos.
        </p>
        <p className="mt-3">Our Evaluation Promises:</p>
        <List
          items={[
            <><strong className="font-semibold text-ink">No upside, no charge:</strong> If we can&apos;t improve a restoration card, we refund the service cost and ship it back untouched (you only cover round-trip shipping).</>,
            <><strong className="font-semibold text-ink">No unnecessary work:</strong> If a card booked for restoration only needs a clean, we downgrade it to Prep so you don&apos;t overpay.</>,
            <><strong className="font-semibold text-ink">No surprise charges:</strong> If we spot fixable damage during a Prep order, we always contact you for permission before doing restoration work.</>,
          ]}
        />
      </>
    ),
  },
  {
    n: "5",
    title: "Hands-On Work",
    note: "(Order status: In Progress to Completed)",
    body: "Cards go through gentle rounds of humidity, specialized tool work, pressing, and resting in clamps to coax the card's original fibers back into place. Multiple rounds are normal and built into your turnaround estimate. Every restoration finishes with full Prep.",
  },
  {
    n: "6",
    title: "Return Shipping",
    note: "(Order status: Shipped Back to Delivered)",
    body: "Your cards are placed in fresh penny sleeves and Card Savers (cracked slabs return raw in Card Savers, ready to resubmit), sandwiched between protective plates in a bubble mailer, and shipped home.",
  },
];

const STATUSES: [string, string][] = [
  ["Awaiting Cards", "Order is paid; we're waiting for your package."],
  ["Cards Received", "Picked up from our PO Box, opened, logged, and photographed."],
  ["In Progress", "Your cards are actively on the workbench."],
  ["Completed", "Final quality check; prepping for return mail."],
  ["Shipped Back", "Return label printed—tracking is live on your order page."],
  ["Delivered", "Back in your hands."],
];

const POLICIES = [
  {
    icon: MessageCircle,
    title: "Getting updates:",
    body: "Log in at theonethatsaveditall.com and hit Request an Update on your order page. The technician working on your card will reply within 1–2 business days.",
  },
  {
    icon: Clock,
    title: "Turnaround times:",
    body: "Estimates start when your status hits Cards Received (or upon arrival for Fast Pass) and do not include shipping transit time.",
  },
  {
    icon: ShieldCheck,
    title: "Alteration risk:",
    body: "Prep is a surface clean, with nothing restorative. Restoration carries a risk, low but not zero, that a grader detects it or returns a card as altered.",
  },
  {
    icon: Package,
    title: "DIY Kits:",
    body: "Ordering a restoration kit from our shop ships like a standard retail order.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen page-glow">
      <div className="max-w-5xl mx-auto px-4 md:px-10 py-12 md:py-20">
        <PageHero
          className="mb-12 md:mb-16"
          eyebrow="How It Works"
          title="How It Works"
          lead="The Card Doc is a trading card restoration and grading-prep shop in Ridgewood, New Jersey. Mail us your cards from anywhere in the US, we do the work by hand in our shop, and we ship them back ready for grading or your personal collection."
        />

        <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:items-start hero-in" style={{ ["--d" as string]: 120 }}>
          {/* Services at a glance */}
          <div className="lit-border relative bg-white border border-ink/70 rounded-xl shadow-[0_40px_70px_-50px_oklch(0.25_0.006_70/0.6)]">
            <div className="px-6 md:px-7 py-5 border-b border-ink/70 border-t-[6px] border-t-rx rounded-t-xl">
              <h2 className="font-heading text-2xl md:text-3xl font-extrabold tracking-[-0.01em] text-ink">Our Services at a Glance</h2>
            </div>
            <div className="divide-y divide-rule">
              <div className="flex items-start gap-4 px-6 md:px-7 py-6">
                <Hammer className="h-6 w-6 mt-0.5 shrink-0 text-rx" strokeWidth={1.75} />
                <div>
                  <h3 className="font-heading text-lg font-bold text-ink">Restoration (includes Prep):</h3>
                  <p className="text-[15px] text-muted-foreground mt-1 leading-relaxed">
                    Hands-on work to fix dents, creases, edge/corner lifts, and surface grime using humidity, specialized tools, and clamps—never harsh chemicals or added materials.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4 px-6 md:px-7 py-6">
                <Microscope className="h-6 w-6 mt-0.5 shrink-0 text-rx" strokeWidth={1.75} />
                <div>
                  <h3 className="font-heading text-lg font-bold text-ink">Prep Only:</h3>
                  <p className="text-[15px] text-muted-foreground mt-1 leading-relaxed">
                    A gentle surface clean, inspection under bright light, and fresh sleeving into a Card Saver. Nothing restorative, and no grade is guaranteed.
                  </p>
                </div>
              </div>
            </div>
            <div className="px-6 md:px-7 py-5 bg-paper border-t border-rule rounded-b-xl grid grid-cols-2 gap-3">
              <Link
                href="/tier-selection"
                className="btn-depth btn-sheen h-12 rounded-md font-semibold text-[15px] flex items-center justify-center bg-rx text-primary-foreground hover:bg-rx/90 transition-colors"
              >
                Restoration →
              </Link>
              <Link
                href="/prep"
                className="h-12 rounded-md font-semibold text-[15px] flex items-center justify-center border border-ink/70 text-ink hover:bg-white transition-colors"
              >
                Prep →
              </Link>
            </div>
          </div>

          <div className="flex flex-col gap-8">
            {/* The one rule */}
            <div className="border border-rx/40 bg-rx-soft rounded-xl px-6 py-5">
              <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.06em] text-rx mb-3">
                <ShieldAlert className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                One rule up front:
              </p>
              <p className="text-[15px] text-ink leading-relaxed">
                We never submit cards to grading companies for you. Repeated submissions from one shop address can trigger flags with graders—returning cards directly to you protects everyone.
              </p>
            </div>

            <div className="text-sm text-muted-foreground">
              Not sure what your card needs? DM photos to{" "}
              <a href={INSTAGRAM} target="_blank" rel="noopener noreferrer" className="text-rx font-semibold hover:underline">
                @the_card_doc
              </a>{" "}
              on Instagram.
            </div>
          </div>
        </div>

        {/* The step-by-step process: sticky scroll walkthrough */}
        <section className="mt-20 md:mt-32 border-t border-ink/80 pt-12 md:pt-20">
          <StepWalkthrough title="The Step-by-Step Process" steps={STEPS} />
        </section>

        {/* Statuses and policies */}
        <section className="mt-20 md:mt-28 border-t border-ink/80 pt-12 md:pt-20" data-reveal>
          <h2 className="font-heading text-4xl md:text-6xl font-extrabold tracking-[-0.02em] leading-[0.95] text-ink mb-10">
            Tracking Statuses &amp; Key Policies
          </h2>

          <div className="lit-border relative bg-white border border-ink/70 rounded-xl overflow-hidden">
            <table className="w-full text-left">
              <thead className="border-b border-ink/70 border-t-[6px] border-t-rx">
                <tr>
                  <th scope="col" className="px-6 md:px-7 py-4 font-mono text-xs font-normal uppercase tracking-[0.06em] text-muted-foreground w-[38%] md:w-[30%]">Order Status</th>
                  <th scope="col" className="px-6 md:px-7 py-4 font-mono text-xs font-normal uppercase tracking-[0.06em] text-muted-foreground">What It Means</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {STATUSES.map(([status, meaning], i) => (
                  <tr key={status}>
                    <td className="px-6 md:px-7 py-4 align-top">
                      <span className="inline-flex items-center gap-2 font-semibold text-ink">
                        <span className="font-mono text-xs text-rx tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                        {status}
                      </span>
                    </td>
                    <td className="px-6 md:px-7 py-4 text-[15px] text-muted-foreground leading-relaxed">{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 border-t border-ink/70">
            {POLICIES.map((p, i) => (
              <div
                key={p.title}
                className={`flex items-start gap-3 py-6 border-b border-rule ${i % 2 === 0 ? "sm:pr-6" : "sm:pl-6 sm:border-l"}`}
              >
                <p.icon className="h-5 w-5 mt-0.5 shrink-0 text-rx" strokeWidth={1.75} />
                <div>
                  <h3 className="font-heading font-bold text-base text-ink">{p.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{p.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section data-reveal className="mt-20 md:mt-28 stage stage-light overflow-hidden rounded-2xl p-8 md:p-12 md:flex md:items-center md:justify-between md:gap-10">
          <div className="mb-8 md:mb-0">
            <h3 className="font-heading text-3xl md:text-4xl font-extrabold tracking-[-0.015em] leading-[1] text-stage-fg mb-3">Ready to restore your collection?</h3>
            <p className="text-stage-muted max-w-xl">
              Submit your cards for restoration and see the difference professional care can make.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <Link
              href="/restoration"
              className="btn-depth btn-sheen inline-flex h-12 items-center justify-center px-7 bg-rx text-primary-foreground font-semibold rounded-md hover:bg-rx/90 transition-colors"
            >
              Book Restoration
            </Link>
            <Link
              href="/shop"
              className="inline-flex h-12 items-center justify-center px-7 border border-white/25 text-stage-fg font-semibold rounded-md hover:border-white/60 hover:bg-white/5 transition-colors"
            >
              Browse Kits
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
