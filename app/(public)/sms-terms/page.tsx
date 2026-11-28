import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { canonical, withOg } from "@/lib/seo";
import { PageHero } from "@/components/marketing/page-hero";
import { SMS_ORDER_CONSENT_TEXT, SMS_WAITLIST_CONSENT_TEXT } from "@/lib/sms/consent-text";

/**
 * The SMS Terms for the 10DLC text program (Telnyx): what carriers check
 * when they vet the campaign. Laid out like /privacy. The opt-in wording is
 * quoted from lib/sms/consent-text.ts, so it always matches the checkboxes.
 */

/** The terms' sections, in order, for the Contents list (their headings as written below). */
const SECTIONS = [
  { id: "overview", text: "Overview" },
  { id: "what-we-text", text: "1. What We Text" },
  { id: "sign-up", text: "2. How You Sign Up" },
  { id: "frequency", text: "3. How Often We Text" },
  { id: "cost", text: "4. Cost" },
  { id: "stop-help", text: "5. Stop, Start and Help" },
  { id: "delivery", text: "6. Delivery" },
  { id: "privacy", text: "7. Privacy" },
  { id: "changes", text: "8. Changes to These Terms" },
  { id: "contact", text: "9. Contact Us" },
];

const LINK = "font-bold text-cobalt underline decoration-2 underline-offset-4 hover:text-ink";
const H2 = "caps mb-5 font-display text-[28px] font-black leading-[1] text-ink md:text-[36px] [text-wrap:balance]";

function SectionLinks() {
  return (
    <>
      <p className="label-caps mb-3 hidden text-[16px] text-cobalt lg:block">Contents</p>
      <ol className="flex flex-col text-[14px]">
        {SECTIONS.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className="flex min-h-10 items-center rounded-[8px] py-1.5 leading-snug text-ink-soft transition-colors duration-150 hover:text-cobalt focus-visible:text-ink lg:-mx-2 lg:px-2 lg:hover:bg-cobalt-wash"
            >
              <span>{h.text}</span>
            </a>
          </li>
        ))}
      </ol>
    </>
  );
}

/** One opt-in wording, quoted word for word. */
function ConsentQuote({ where, text }: { where: string; text: string }) {
  return (
    <figure className="max-w-[68ch] rounded-[14px] bg-chalk px-5 py-4 shadow-[inset_0_0_0_1px_var(--line)]">
      <figcaption className="label-caps mb-2 text-[14px] text-cobalt">{where}</figcaption>
      <blockquote className="text-[15px] leading-relaxed text-ink md:text-[16px]">&ldquo;{text}&rdquo;</blockquote>
    </figure>
  );
}

export const metadata: Metadata = withOg("/sms-terms", {
  title: "SMS Terms | The Card Doc",
  description:
    "Terms for The Card Doc text updates: order updates and restoration-spot alerts by text, how to sign up, how often we text, and how to stop.",
  robots: { index: true, follow: true },
  alternates: canonical("/sms-terms"),
});

export default function SmsTermsPage() {
  const EFFECTIVE_DATE = "November 28, 2026";
  const CONTACT_EMAIL = "thecarddoc1@gmail.com";

  return (
    <div className="surface-chalk min-h-screen">
      <div className="wrap pt-14 pb-10 md:pt-24 md:pb-14">
        <PageHero eyebrow="Legal" title="SMS Terms" lead={`Effective Date: ${EFFECTIVE_DATE}`} />
        <p className="hero-in mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft" style={{ ["--d" as string]: 280 }}>
          Published by <strong className="text-ink">The Card Doc LLC</strong>, a New Jersey limited liability company
          doing business as &ldquo;The Card Doc&rdquo;
        </p>
      </div>

      <div className="wrap pb-24 md:pb-32">
        <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[19rem_minmax(0,1fr)]">
          <nav
            aria-label="Sections"
            className="lg:sticky lg:top-[calc(var(--header-h)+24px)] lg:max-h-[calc(100vh-var(--header-h)-48px)] lg:self-start lg:overflow-y-auto lg:rounded-[22px] lg:bg-white lg:p-6 lg:shadow-[0_0_0_1px_var(--line)] lg:[scrollbar-width:thin]"
          >
            {/* On a phone the contents fold away so the terms start right below */}
            <details className="group rounded-[18px] bg-white shadow-[0_0_0_1px_var(--line)] lg:hidden">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-[15px] font-bold text-ink [&::-webkit-details-marker]:hidden">
                <span>Contents ({SECTIONS.length} sections)</span>
                <span
                  aria-hidden
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-chalk transition-[transform,background-color] duration-300 ease-[var(--ease-out)] group-open:rotate-45 group-open:bg-sun motion-reduce:transition-none"
                >
                  <Plus className="size-4" strokeWidth={2.5} />
                </span>
              </summary>
              <div className="border-t border-line px-5 py-4">
                <SectionLinks />
              </div>
            </details>
            <div className="hidden lg:block">
              <SectionLinks />
            </div>
          </nav>

        <article className="min-w-0 rounded-[22px] bg-white px-5 py-8 font-sans text-[16px] leading-[1.7] text-ink-soft shadow-[0_0_0_1px_var(--line),var(--panel-shadow)] sm:px-8 md:px-12 md:py-14 md:text-[17px] lg:px-16 space-y-6 [&_p+p]:mt-4 [&_p+ul]:mt-4 [&_ul+p]:mt-4 [&_section]:scroll-mt-[calc(var(--header-h)+24px)] [&_section>h2]:mt-12 [&_section>h2]:border-t [&_section>h2]:border-line [&_section>h2]:pt-9 [&_section:first-child>h2]:mt-0 [&_section:first-child>h2]:border-0 [&_section:first-child>h2]:pt-0 [&_h2]:text-ink [&_h3]:text-ink [&_ul]:max-w-[66ch] [&_ol]:max-w-[66ch] [&_li]:marker:text-cobalt [&_strong]:text-ink [&_p]:max-w-[68ch]">

          {/* ─── Overview ──────────────────────────────────────────────────────── */}
          <section id="overview">
            <h2 className={H2}>Overview</h2>
            <p>
              These SMS Terms cover <strong>The Card Doc text updates</strong>, the text message
              (SMS) program run by <strong>The Card Doc LLC</strong> (&ldquo;The Card Doc,&rdquo;
              &ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;). They explain which texts we
              send, how you sign up, how often we text and how to stop. They apply along with our{" "}
              <Link href="/terms" className={LINK}>Terms of Service</Link> and{" "}
              <Link href="/privacy" className={LINK}>Privacy Policy</Link>.
            </p>
          </section>

          {/* ─── 1. What We Text ───────────────────────────────────────────────── */}
          <section id="what-we-text">
            <h2 className={H2}>1. What We Text</h2>
            <p>We only text people who ask for it, and only about these two things:</p>
            <ul className="list-disc space-y-2.5 pl-6">
              <li>
                <strong>Order updates:</strong> if you sign up when you place a restoration, PSA
                prep or card-show drop-off order, we text you when we receive your cards, when they
                are finished, and when they ship back to you, with a tracking link.
              </li>
              <li>
                <strong>Restoration spots alert:</strong> if you sign up on the restoration
                waitlist, we text you when restoration spots open.
              </li>
            </ul>
            <p>
              If you text us back, a member of our team reads your message and may reply by text
              or email.
            </p>
          </section>

          {/* ─── 2. How You Sign Up ────────────────────────────────────────────── */}
          <section id="sign-up">
            <h2 className={H2}>2. How You Sign Up</h2>
            <p>
              Texts are opt-in. You sign up by ticking a box that stays unchecked until you tick
              it, next to these exact words:
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <ConsentQuote where="At checkout" text={SMS_ORDER_CONSENT_TEXT} />
              <ConsentQuote where="On the restoration waitlist" text={SMS_WAITLIST_CONSENT_TEXT} />
            </div>
            <p className="mt-4">
              If you drop off cards with us in person, we sign you up for order updates only when
              you tell us yes, and we note it on your order.
            </p>
            <p>
              You never have to sign up: consent is not a condition of purchase. We keep a record
              of each sign-up with the phone number, the exact words you agreed to, and the date
              and time.
            </p>
          </section>

          {/* ─── 3. How Often We Text ──────────────────────────────────────────── */}
          <section id="frequency">
            <h2 className={H2}>3. How Often We Text</h2>
            <p>Message frequency varies:</p>
            <ul className="list-disc space-y-2.5 pl-6">
              <li>
                <strong>Order updates:</strong> about 3 texts per order (cards received, finished
                and shipped back).
              </li>
              <li>
                <strong>Restoration spots alert:</strong> one text each time restoration spots
                open.
              </li>
            </ul>
          </section>

          {/* ─── 4. Cost ───────────────────────────────────────────────────────── */}
          <section id="cost">
            <h2 className={H2}>4. Cost</h2>
            <p>
              <strong>Msg &amp; data rates may apply.</strong> We don&rsquo;t charge for our texts,
              but your mobile carrier may charge you for texts you send and receive, depending on
              your plan.
            </p>
          </section>

          {/* ─── 5. Stop, Start and Help ───────────────────────────────────────── */}
          <section id="stop-help">
            <h2 className={H2}>5. Stop, Start and Help</h2>
            <ul className="list-disc space-y-2.5 pl-6">
              <li>
                <strong>To stop:</strong> reply <strong>STOP</strong> to any text from us, at any
                time, to cancel. CANCEL, END, QUIT and UNSUBSCRIBE work too. We send one text to
                confirm, and after that we send no more texts to that number, neither order updates
                nor alerts.
              </li>
              <li>
                <strong>To start again:</strong> reply <strong>START</strong> to rejoin and get the
                texts you signed up for.
              </li>
              <li>
                <strong>For help:</strong> reply <strong>HELP</strong> to any text from us, or
                email us at{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className={LINK}>
                  {CONTACT_EMAIL}
                </a>
                .
              </li>
            </ul>
          </section>

          {/* ─── 6. Delivery ───────────────────────────────────────────────────── */}
          <section id="delivery">
            <h2 className={H2}>6. Delivery</h2>
            <p>
              <strong>Carriers are not liable for delayed or undelivered messages.</strong> Texts
              depend on your carrier and your phone&rsquo;s signal, so a text can arrive late or
              not at all. You can always check an order on our{" "}
              <Link href="/track" className={LINK}>Track Order</Link> page.
            </p>
          </section>

          {/* ─── 7. Privacy ────────────────────────────────────────────────────── */}
          <section id="privacy">
            <h2 className={H2}>7. Privacy</h2>
            <p>
              We use your phone number only to send the texts you asked for and to answer texts
              you send us. We never sell it.
            </p>
            <p>
              No mobile information will be shared with third parties or affiliates for marketing
              or promotional purposes. Text messaging originator opt-in data and consent are not
              shared with any third parties, except the service providers that deliver our texts
              (Telnyx).
            </p>
            <p>
              Our{" "}
              <Link href="/privacy#text-messages" className={LINK}>Privacy Policy</Link> explains
              how we handle your information, including your phone number and texts.
            </p>
          </section>

          {/* ─── 8. Changes ────────────────────────────────────────────────────── */}
          <section id="changes">
            <h2 className={H2}>8. Changes to These Terms</h2>
            <p>
              We may update these SMS Terms. When we do, we change the effective date at the top
              of this page.
            </p>
          </section>

          {/* ─── 9. Contact ────────────────────────────────────────────────────── */}
          <section id="contact">
            <h2 className={H2}>9. Contact Us</h2>
            <p>Questions about our texts? Reach us any of these ways:</p>
            <ul className="list-disc space-y-2.5 pl-6">
              <li>
                <strong>Email:</strong>{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className={LINK}>
                  {CONTACT_EMAIL}
                </a>
              </li>
              <li>
                <strong>Text:</strong> reply HELP to any text from us
              </li>
              <li>
                <strong>Instagram DM:</strong>{" "}
                <a
                  href="https://www.instagram.com/the_card_doc"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={LINK}
                >
                  @the_card_doc
                </a>
              </li>
              <li>
                <strong>Legal name:</strong> The Card Doc LLC, New Jersey, USA
              </li>
            </ul>
          </section>

          <div className="mt-12 rounded-[18px] bg-sun p-6 text-ink md:p-8">
            <p className="label-caps mb-3 text-[18px] text-ink">Quick reference</p>
            <p className="text-[16px] leading-relaxed text-ink">
              Reply <strong>STOP</strong> to cancel. Reply <strong>HELP</strong> for help. Reply{" "}
              <strong>START</strong> to rejoin. Msg frequency varies. Msg &amp; data rates may
              apply.
            </p>
          </div>

          <p className="mt-12 !max-w-none text-center text-[13px] text-ink-soft">
            &copy; {new Date().getFullYear()} The Card Doc LLC. All rights reserved.
          </p>
        </article>
        </div>
      </div>
    </div>
  );
}
