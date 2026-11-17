import Link from "next/link";
import type { Metadata } from "next";
import type { StaticImageData } from "next/image";
import { ArrowRight, Clock, MessageCircle, Package, ShieldAlert, type LucideIcon } from "lucide-react";
import { canonical } from "@/lib/seo";
import { PageHero } from "@/components/marketing/page-hero";
import { CtaPanel, Print, cta } from "@/components/brand";
import { SeamlessPrint } from "../seamless-print";
import { StickyStepPhoto } from "./sticky-step-photo";
import mantlePair from "@/public/home/mantle-pair.jpg";
import garchomp from "@/public/home/garchomp.jpg";
import mantleBeforeHeld from "@/public/home/mantle-before-held.jpg";
import charmanderPair from "@/public/home/charmander-pair.jpg";
import charmanderAfter from "@/public/home/charmander-after.jpg";

export const metadata: Metadata = {
  alternates: canonical("/how-it-works"),
  title: "How It Works — The Card Doc",
  description:
    "The Card Doc is a trading card restoration and grading-prep shop in Ridgewood, New Jersey. Mail us your cards from anywhere in the US, we do the work by hand in our shop, and we ship them back ready for grading or your personal collection.",
};

function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="mt-3 flex flex-col gap-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="mt-[0.4em] h-[14px] w-[10px] shrink-0 rounded-[2px] bg-sun" aria-hidden />
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
            <><strong className="font-bold text-white">Order notes:</strong> Let us know if a card is strictly for your Personal Collection (not being graded) so we know which techniques are on the table.</>,
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
            <><strong className="font-bold text-white">No upside, no charge:</strong> If we can&apos;t improve a restoration card, we refund the service cost and ship it back untouched (you only cover round-trip shipping).</>,
            <><strong className="font-bold text-white">No unnecessary work:</strong> If a card booked for restoration only needs a clean, we downgrade it to Prep so you don&apos;t overpay.</>,
            <><strong className="font-bold text-white">No surprise charges:</strong> If we spot fixable damage during a Prep order, we always contact you for permission before doing restoration work.</>,
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


const POLICIES: { icon: LucideIcon; title: string; body: string }[] = [
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
    icon: ShieldAlert,
    title: "Alteration risk:",
    body: "Prep is a surface clean, with nothing restorative. Restoration carries a risk, low but not zero, that a grader detects it or returns a card as altered.",
  },
  {
    icon: Package,
    title: "DIY Kits:",
    body: "Ordering a restoration kit from our shop ships like a standard retail order.",
  },
];


// A real card beside some steps (decorative; the photos never stand in for a
// step they don't show). Each photo is used once. `steps` is the run of steps
// the sticky desktop column shows it for; the phone shows it inline at the
// first of those steps.
type StepPhoto = { src: StaticImageData; alt: string; aspect: string; cutout?: boolean; steps: string[] };
const STEP_PHOTOS: StepPhoto[] = [
  { src: charmanderPair, alt: "A Charmander card before and after restoration, side by side", aspect: "576/513", steps: ["1", "2", "3"] },
  { src: garchomp, alt: "A Garchomp holo card corner, before and after", aspect: "538/520", cutout: true, steps: ["4"] },
  { src: mantlePair, alt: "A Mickey Mantle card cracked in a black glove, and the same card restored in a blue glove", aspect: "1446/902", cutout: true, steps: ["5", "6"] },
];

function StepPhotoPrint({ photo, tilt, aspect, sizes }: { photo: StepPhoto; tilt: number; aspect?: string; sizes: string }) {
  return photo.cutout ? (
    <SeamlessPrint src={photo.src} alt={photo.alt} aspect={aspect ?? photo.aspect} inset={aspect ? "4%" : "0"} tilt={tilt} dark sizes={sizes} />
  ) : (
    <Print src={photo.src} alt={photo.alt} aspect={aspect ?? photo.aspect} tilt={tilt} surface="dark" border="lg" sizes={sizes} />
  );
}

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen overflow-x-clip">
      {/* Header */}
      <section className="surface-chalk">
        <div className="wrap grid items-center gap-x-16 gap-y-10 pt-12 pb-16 md:pt-20 md:pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <PageHero
            eyebrow="How It Works"
            title="How It Works"
            lead="The Card Doc is a trading card restoration and grading-prep shop in Ridgewood, New Jersey. Mail us your cards from anywhere in the US, we do the work by hand in our shop, and we ship them back ready for grading or your personal collection."
            actions={
              <>
                <Link href="/restoration" className={cta({ size: "lg" })}>
                  Book Restoration
                  <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
                </Link>
                <Link href="/shop" className={cta({ tone: "outline", size: "lg" })}>
                  Browse Kits
                </Link>
              </>
            }
          />
          <div aria-hidden className="relative hidden aspect-[1/1.05] lg:block">
            <Print
              src={charmanderAfter}
              alt=""
              aspect="364/503"
              tilt={-7}
              border="sm"
              enterDelay={220}
              sizes="170px"
              className="absolute top-[18%] left-0 w-[44%]"
            />
            <Print
              src={mantleBeforeHeld}
              alt=""
              aspect="720/902"
              position="50% 20%"
              tilt={4}
              enterDelay={80}
              priority
              sizes="230px"
              className="absolute top-0 right-0 w-[62%]"
            />
          </div>
        </div>
      </section>

      {/* The step-by-step process: big numerals, the owner's words, a real card beside some steps */}
      <section aria-labelledby="steps-heading" className="surface-ink">
        <div className="wrap section-y">
          <h2 id="steps-heading" data-reveal className="display-lg text-white">
            The <span className="whitespace-nowrap">Step-by-Step</span> Process
          </h2>

          <div className="mt-12 grid gap-x-14 md:mt-16 lg:grid-cols-[minmax(0,1fr)_380px]">
            <ol id="steps-list" className="border-t border-line-dark">
              {STEPS.map((step, i) => {
                const photo = STEP_PHOTOS.find((p) => p.steps[0] === step.n);
                return (
                  <li
                    key={step.n}
                    data-reveal
                    data-step={step.n}
                    className="grid gap-x-10 gap-y-6 border-b border-line-dark py-10 md:grid-cols-[7.5rem_minmax(0,1fr)] md:py-14 xl:grid-cols-[9rem_minmax(0,1fr)]"
                  >
                    <span aria-hidden className="font-display text-[88px] font-black leading-[0.78] tracking-[-0.02em] text-sun md:text-[120px] xl:text-[140px]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display text-[32px] font-extrabold leading-[0.98] text-white [overflow-wrap:anywhere] hyphens-none md:text-[44px]">
                        <span className="sr-only">Step {step.n}: </span>
                        {step.title}
                      </h3>
                      <p className="mt-3 text-[15px] font-semibold text-sun">{step.note}</p>
                      <div className="mt-5 max-w-[62ch] text-[16px] leading-relaxed text-on-dark-muted md:text-[17px]">
                        {typeof step.body === "string" ? <p>{step.body}</p> : step.body}
                      </div>
                    </div>
                    {photo && (
                      <div className="md:col-start-2 lg:hidden">
                        <StepPhotoPrint photo={photo} tilt={0} aspect="4/3" sizes="(min-width: 768px) 80vw, 92vw" />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>

            <aside aria-label="Cards from our bench" className="hidden lg:block">
              <div className="sticky top-28 pt-14">
                <StickyStepPhoto
                  listId="steps-list"
                  layers={STEP_PHOTOS.map((photo, i) => ({
                    steps: photo.steps,
                    node: <StepPhotoPrint photo={photo} tilt={i % 2 ? 3 : -3} sizes="380px" />,
                  }))}
                />
              </div>
            </aside>
          </div>

          <div className="mt-12 flex flex-col gap-4 sm:flex-row sm:flex-wrap md:mt-14">
            <Link href="/restoration" className={cta({ size: "lg" })}>
              Book Restoration
              <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
            </Link>
            <Link href="/shop" className={cta({ tone: "outline-light", size: "lg" })}>
              Browse Kits
            </Link>
          </div>
        </div>
      </section>

      {/* Statuses and policies */}
      <section aria-labelledby="status-heading" className="surface-chalk">
        <div className="wrap section-y">
          <h2 id="status-heading" data-reveal className="display-md max-w-3xl text-ink">
            Tracking Statuses &amp; Key Policies
          </h2>

          <div data-reveal className="mt-10 overflow-hidden rounded-2xl bg-white shadow-[0_0_0_1px_var(--line),var(--panel-shadow)] md:mt-12">
            <table className="w-full text-left">
              <thead className="bg-ink text-white">
                <tr>
                  <th scope="col" className="label-caps w-[44%] px-5 py-4 text-[15px] md:w-[34%] md:px-8">Order Status</th>
                  <th scope="col" className="label-caps px-5 py-4 text-[15px] md:px-8">What It Means</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {STATUSES.map(([status, meaning], i) => (
                  <tr key={status}>
                    <td className="px-5 py-4 align-top md:px-8 md:py-5">
                      <span className="flex items-start gap-3 font-bold text-ink">
                        <span aria-hidden className="mt-px font-display text-[17px] font-black leading-none text-cobalt tabular-nums">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        {status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-[15px] leading-relaxed text-ink-soft md:px-8 md:py-5">{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul data-reveal="stagger" className="mt-14 grid grid-cols-1 gap-x-12 gap-y-9 sm:grid-cols-2">
            {POLICIES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="border-t-2 border-ink pt-6">
                <span aria-hidden className="grid size-11 place-items-center rounded-xl bg-cobalt-wash text-cobalt">
                  <Icon className="size-5" strokeWidth={1.75} />
                </span>
                <h3 className="mt-4 font-display text-[26px] font-extrabold leading-none text-ink">{title}</h3>
                <p className="mt-2.5 text-[15px] leading-relaxed text-ink-soft">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Closing call to action */}
      <section className="surface-white">
        <div className="wrap py-16 md:py-24">
          <CtaPanel
            tone="sun"
            title="Ready to restore your collection?"
            lead="Submit your cards for restoration and see the difference professional care can make."
            actions={
              <>
                <Link href="/restoration" className={cta({ tone: "ink", size: "lg" })}>
                  Book Restoration
                  <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
                </Link>
                <Link href="/shop" className={cta({ tone: "outline", size: "lg" })}>
                  Browse Kits
                </Link>
              </>
            }
          />
        </div>
      </section>
    </div>
  );
}
