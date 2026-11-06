import { CountUp } from "@/components/motion/count-up";
import { CASE_STUDY, FEATURED_REVIEW, REVIEWS, type Review } from "@/lib/reviews";

const TILTS = ["-1.2deg", "0.9deg", "-0.6deg", "1.3deg", "-1deg", "0.7deg", "-0.8deg", "1deg", "-1.1deg"];
const COMPACT_PICKS = ["Charmander", "Sold on TCGplayer", "7 cards to grading"];

export function FeaturedReview({ className = "" }: { className?: string }) {
  return (
    <figure data-reveal className={className}>
      <blockquote className="speech px-6 py-8 text-ink md:px-10 md:py-12">
        <p className="font-heading text-[1.7rem] font-extrabold leading-[1.12] tracking-[-0.015em] sm:text-[2.2rem] lg:text-[2.6rem] [text-wrap:pretty]">
          <span className="text-ink/55">“{FEATURED_REVIEW.lead}</span>
          <span>{FEATURED_REVIEW.emphasis}”</span>
        </p>
      </blockquote>
      <figcaption className="mt-8 ml-14 font-heading text-sm font-extrabold uppercase tracking-[0.08em] text-white">
        {FEATURED_REVIEW.from}
      </figcaption>
    </figure>
  );
}

export function CaseCard({ className = "" }: { className?: string }) {
  const rows = [
    { label: "Bought for", value: CASE_STUDY.paid },
    { label: "Came back", value: CASE_STUDY.grade },
    { label: "Worth over", value: CASE_STUDY.worth },
  ];
  return (
    <figure
      data-reveal
      style={{ transitionDelay: "120ms" }}
      className={`rotate-[1.5deg] overflow-hidden rounded-2xl comic-border comic-shadow bg-bone text-ink ${className}`}
    >
      <div className="relative border-b-[3px] border-ink bg-ink px-6 py-5 text-white">
        <div aria-hidden className="absolute inset-0 halftone-light" />
        <h3 className="relative font-heading text-2xl font-black uppercase leading-none tracking-[-0.01em] md:text-[1.9rem]">
          The {CASE_STUDY.paid} {CASE_STUDY.card}
        </h3>
        <p className="relative mt-2 text-[15px] leading-relaxed text-white/75">
          Bought “damaged” with an edge lift. Sent it in. Got back a {CASE_STUDY.grade}.
        </p>
      </div>
      <dl className="px-6 py-2">
        {rows.map((row, i) => (
          <div key={row.label} className={`flex items-baseline justify-between gap-4 py-4 ${i > 0 ? "border-t-2 border-dashed border-ink/25" : ""}`}>
            <dt className="font-heading text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">{row.label}</dt>
            <dd
              className={`font-heading text-4xl font-black leading-none tracking-[-0.02em] tabular-nums md:text-5xl ${
                i === 0 ? "text-ink/45 line-through decoration-rx decoration-[3px]" : i === 2 ? "text-rx" : "text-ink"
              }`}
            >
              <CountUp value={row.value} />
            </dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}

export function ReviewBubbles({ compact = false, phoneLimit = 6 }: { compact?: boolean; phoneLimit?: number }) {
  const list: Review[] = compact ? REVIEWS.filter((r) => r.card && COMPACT_PICKS.includes(r.card)) : REVIEWS;
  return (
    <ul className={compact ? "grid gap-x-6 md:grid-cols-3" : "columns-1 gap-6 sm:columns-2 lg:columns-3"}>
      {list.map((r, i) => (
        <li
          key={r.quote}
          data-reveal
          style={{ transitionDelay: `${(i % 3) * 80}ms` }}
          className={`mb-12 inline-block w-full break-inside-avoid align-top ${!compact && i >= phoneLimit ? "max-sm:hidden" : ""}`}
        >
          <figure style={{ transform: `rotate(${TILTS[i % TILTS.length]})` }}>
            <blockquote className="speech p-5 text-ink md:p-6">
              {r.card && (
                <p className="mb-3 inline-block rounded-md bg-ink px-2 py-0.5 font-heading text-[11px] font-extrabold uppercase tracking-[0.1em] text-white">
                  {r.card}
                </p>
              )}
              <p className="text-base font-medium leading-relaxed md:text-[17px]">“{r.quote}”</p>
            </blockquote>
            <figcaption className="mt-7 ml-14 font-heading text-xs font-extrabold uppercase tracking-[0.1em] text-white">{r.from}</figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}

export function ReviewsBand({ title, compact = false, id = "reviews-heading" }: { title: string; compact?: boolean; id?: string }) {
  return (
    <section aria-labelledby={id} className="relative overflow-hidden border-y-[3px] border-ink bg-rx text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0 halftone-light" />
      <div className="relative mx-auto max-w-7xl px-4 py-20 md:px-10 md:py-28">
        <h2
          id={id}
          data-reveal
          className="font-heading font-black uppercase leading-[0.9] tracking-[-0.025em] text-[clamp(2.6rem,8vw,5.5rem)] [text-shadow:4px_4px_0_var(--ink)]"
        >
          {title}
        </h2>
        <div className="mt-12 grid gap-10 md:mt-16 lg:grid-cols-12 lg:items-start lg:gap-12">
          <FeaturedReview className="lg:col-span-7" />
          <CaseCard className="lg:col-span-5" />
        </div>
        <div className="mt-16 md:mt-20">
          <ReviewBubbles compact={compact} />
        </div>
      </div>
    </section>
  );
}
