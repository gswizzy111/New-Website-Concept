import { CountUp } from "@/components/motion/count-up";
import { ScrollLitText } from "@/components/motion/scroll-lit-text";
import { CASE_STUDY, FEATURED_REVIEW, REVIEWS } from "@/lib/reviews";

// Phones show the first few quotes so the page stays short.
const PHONE_LIMIT = 6;

/**
 * Customer reviews on the home ink stage: the convention quote at headline
 * size, lighting up word by word as it scrolls in with its closing phrase in
 * full white, beside the Charizard case (the one raised panel, figures
 * counting up), then the rest of the messages as a masonry of hairline cards
 * whose edge lights under the pointer. Every quote is the customer's own
 * words (lib/reviews.ts).
 */
export function CustomerReviews() {
  const steps = [
    { label: "Bought for", value: CASE_STUDY.paid, muted: true },
    { label: "Came back", value: CASE_STUDY.grade, muted: false },
    { label: "Worth over", value: CASE_STUDY.worth, muted: false },
  ];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="grid gap-12 lg:gap-16 lg:grid-cols-12 lg:items-center">
        <figure className="lg:col-span-7">
          <blockquote className="font-heading text-[1.85rem] sm:text-[2.35rem] lg:text-[2.75rem] leading-[1.1] tracking-[-0.015em] text-stage-fg [text-wrap:pretty]">
            <p className="-indent-[0.42em]">
              <ScrollLitText
                segments={[
                  { text: `“${FEATURED_REVIEW.lead}`, lit: 0.62 },
                  { text: `${FEATURED_REVIEW.emphasis}”`, lit: 1 },
                ]}
              />
            </p>
          </blockquote>
          <figcaption data-reveal className="mt-7 flex items-center gap-3 text-sm text-stage-muted">
            <span aria-hidden className="h-px w-8 bg-white/30" />
            <span className="font-semibold text-stage-fg">{FEATURED_REVIEW.from}</span>
          </figcaption>
        </figure>

        <figure
          data-reveal
          style={{ transitionDelay: "120ms" }}
          className="lg:col-span-5 rounded-xl bg-stage-raise ring-1 ring-white/10 p-6 md:p-8 shadow-[0_40px_70px_-50px_oklch(0_0_0/0.8)]"
        >
          <h3 className="font-heading text-[1.75rem] leading-[1.1] tracking-[-0.01em] text-stage-fg">
            The {CASE_STUDY.paid} {CASE_STUDY.card}
          </h3>
          <p className="mt-2 text-[15px] leading-relaxed text-stage-muted">
            Bought “damaged” with an edge lift. Sent it in. Got back a {CASE_STUDY.grade}.
          </p>
          <dl className="mt-7 border-t border-white/12">
            {steps.map((s) => (
              <div key={s.label} className="flex items-baseline justify-between gap-4 border-b border-white/12 py-4">
                <dt className="rx-label text-stage-muted">{s.label}</dt>
                <dd
                  className={`font-heading text-4xl md:text-5xl leading-none tracking-[-0.02em] [font-feature-settings:'lnum'_1,'tnum'_1] ${s.muted ? "text-stage-muted" : "text-stage-fg"}`}
                >
                  <CountUp value={s.value} />
                </dd>
              </div>
            ))}
          </dl>
        </figure>
      </div>

      <ul className="mt-16 md:mt-24 columns-1 sm:columns-2 lg:columns-3 gap-4 md:gap-5">
        {REVIEWS.map((r, i) => (
          <li
            key={r.quote}
            data-reveal
            style={{ transitionDelay: `${(i % 3) * 80}ms` }}
            className={`lit-border relative mb-4 md:mb-5 break-inside-avoid rounded-xl ring-1 ring-white/12 p-6 transition-colors duration-300 hover:bg-white/[0.025] ${i >= PHONE_LIMIT ? "max-sm:hidden" : ""}`}
          >
            <figure>
              {r.card && <p className="rx-label text-stage-muted">{r.card}</p>}
              <blockquote className="mt-3 text-base md:text-[17px] leading-relaxed text-stage-fg">
                <p>“{r.quote}”</p>
              </blockquote>
              <figcaption className="mt-4 text-[13px] text-stage-muted">{r.from}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </div>
  );
}
