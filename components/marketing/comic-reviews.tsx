import { Print } from "@/components/brand";
import { ReceiptStrip } from "./receipt-strip";
import { receipt } from "./receipts";
import { CASE_STUDY, FEATURED_REVIEW, REVIEWS, type Review } from "@/lib/reviews";
import { cn } from "@/lib/utils";

const COMPACT_PICKS = ["Charmander", "Sold on TCGplayer", "7 cards to grading"];

/** Each compact band's own text message (by heading id), so the service pages don't end the same way. */
const PAGE_PICKS: Record<string, string[]> = {
  "tier-reviews-heading": ["7 cards to grading"],
  "prep-reviews-heading": ["Sold on TCGplayer"],
};
/** The prep page leads its receipts strip with the kit and grading messages. */
const PAGE_STRIP: Record<string, string[]> = {
  "prep-reviews-heading": ["t6", "t4", "t5", "t12", "t13", "t1", "t3", "t11"],
};

/**
 * The headline review set as a pull quote in the poster face: the lead in
 * soft ink, the closing phrase in full ink with a sun highlight, and a big
 * cobalt quote mark. `tone="dark"` for ink sections.
 */
export function FeaturedReview({ className = "", tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const dark = tone === "dark";
  return (
    <figure data-reveal className={cn("relative m-0", className)}>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none block select-none font-display text-[120px] font-black leading-[0.6] md:text-[168px]",
          dark ? "text-sun" : "text-cobalt"
        )}
      >
        “
      </span>
      <blockquote className="-mt-4 md:-mt-6">
        <p className="font-display text-[clamp(2.5rem,5.6vw,5rem)] font-extrabold leading-[0.95] tracking-[-0.005em] [text-wrap:balance]">
          <span className={dark ? "text-on-dark-muted" : "text-ink-soft"}>{FEATURED_REVIEW.lead}</span>
          <span
            className={
              dark
                ? "text-white"
                : "box-decoration-clone bg-[linear-gradient(transparent_64%,var(--sun)_64%,var(--sun)_90%,transparent_90%)] px-1 text-ink"
            }
          >
            {FEATURED_REVIEW.emphasis}
          </span>
        </p>
      </blockquote>
      <figcaption className={cn("mt-7 flex items-center gap-3 text-base font-bold", dark ? "text-on-dark-muted" : "text-ink-soft")}>
        <span aria-hidden className={cn("h-[3px] w-8 rounded-full", dark ? "bg-sun" : "bg-cobalt")} />
        {FEATURED_REVIEW.from}
      </figcaption>
    </figure>
  );
}

/**
 * The Charizard case as a ruled lot sheet: white ledger paper with blue rules
 * and a margin line, the card's name at the top, then what it was bought
 * for, how it came back and what it is worth now, figures set right.
 */
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
      className={cn("relative m-0 overflow-hidden rounded-lg bg-white text-ink shadow-[var(--print-shadow)]", className)}
    >
      {/* The margin line of ledger paper. */}
      <span aria-hidden className="absolute inset-y-0 left-7 w-[2px] bg-cobalt/35 md:left-9" />
      <div className="relative border-b-2 border-ink px-6 pt-6 pb-5 pl-12 md:px-8 md:pl-14">
        <h3 className="caps font-display text-[40px] font-black leading-[0.9] tracking-[0.005em] text-ink md:text-[48px]">
          {CASE_STUDY.card}
        </h3>
        <p className="mt-3 max-w-[38ch] text-[15px] leading-relaxed text-ink-soft">
          Bought “damaged” with an edge lift. Sent it in. Got back a {CASE_STUDY.grade}.
        </p>
      </div>
      <dl className="relative m-0 pl-12 pr-6 md:pl-14 md:pr-8">
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={cn("flex items-baseline gap-3 py-4 md:py-5", i > 0 && "border-t border-cobalt/25")}
          >
            <dt className="label-caps shrink-0 text-[15px] text-ink-soft md:text-base">{row.label}</dt>
            <span aria-hidden className="mb-1 min-w-4 flex-1 border-b-2 border-dotted border-ink/25" />
            <dd
              className={cn(
                "m-0 font-display text-[44px] font-black leading-[0.85] tabular-nums md:text-[56px]",
                i === 2 ? "text-cobalt" : "text-ink"
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}

/**
 * Two or three DM screenshots as overlapping tilted prints, beside the pull
 * quote. Real messages, shown as they arrived.
 */
export function ReceiptPrints({ ids = ["t3", "t6", "t1"], className = "" }: { ids?: string[]; className?: string }) {
  const list = ids.map(receipt).slice(0, 3);
  const SPOTS = [
    { tilt: -4, cls: "left-0 top-0 z-[1]" },
    { tilt: 2, cls: "right-0 top-[27%] z-[2]" },
    { tilt: 5, cls: "left-[6%] bottom-0 z-[3]" },
  ];
  return (
    <div data-reveal="stagger" className={cn("relative mx-auto aspect-[1/1.3] w-full max-w-[24rem] sm:max-w-[28rem]", className)}>
      {list.map((r, i) => (
        <Print
          key={r.id}
          src={r.src}
          alt={r.alt}
          aspect="1"
          fit="contain"
          matte={r.matte}
          border="sm"
          tilt={SPOTS[i].tilt}
          lift
          sizes="(min-width: 1024px) 300px, 60vw"
          className={cn("absolute w-[56%]", SPOTS[i].cls)}
        />
      ))}
    </div>
  );
}

/** Up to three messages as text, so their words stay readable as text. */
function TextPicks({ picks = COMPACT_PICKS, className = "" }: { picks?: string[]; className?: string }) {
  const list: Review[] = picks
    .map((card) => REVIEWS.find((r) => r.card === card))
    .filter((r): r is Review => !!r)
    .slice(0, 3);
  if (list.length === 0) return null;
  return (
    <ul
      aria-label="Customer messages"
      className={cn("grid gap-4 md:gap-6", list.length === 1 ? "max-w-2xl" : "md:grid-cols-3", className)}
    >
      {list.map((r) => (
        <li key={r.quote}>
          <figure className="m-0 h-full rounded-[14px] bg-white p-5 shadow-[0_0_0_1px_var(--line),var(--panel-shadow)] md:p-6">
            {r.card && (
              <p className="label-caps m-0 inline-flex items-center gap-2 text-[13px] text-cobalt">
                <span aria-hidden className="inline-block h-3.5 w-2.5 rounded-[2px] border-2 border-cobalt" />
                {r.card}
              </p>
            )}
            <blockquote className={cn("relative m-0 rounded-[18px] rounded-bl-[6px] bg-chalk px-4 py-3.5", r.card && "mt-3")}>
              <p className="m-0 text-[15px] leading-relaxed text-ink md:text-base">“{r.quote}”</p>
            </blockquote>
            <figcaption className="mt-3 pl-1 text-[13px] font-bold text-ink-soft">{r.from}</figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}

/**
 * The messages: the real DM screenshots as one "receipts" strip, then three
 * of them as text. `exclude` drops screenshots already shown on the page.
 */
export function ReviewBubbles({
  exclude = [],
  ids,
  picks,
  textOnPhone = true,
  className = "",
}: {
  /** Which receipts, in order (default: all). */
  ids?: string[];
  /** Which text messages to show, by their card label (default: three). */
  picks?: string[];
  /** False hides the text messages below md (the home page, where phones get the strip only). */
  textOnPhone?: boolean;
  /** Kept for older callers. */
  compact?: boolean;
  /** Kept for older callers. */
  phoneLimit?: number;
  exclude?: string[];
  className?: string;
}) {
  return (
    <div className={className}>
      <ReceiptStrip ids={ids} exclude={exclude} />
      <div className={cn("mt-10 md:mt-12", !textOnPhone && "hidden md:block")}>
        <TextPicks picks={picks} />
      </div>
    </div>
  );
}

/**
 * Reviews on white. Compact (the service pages): the receipts strip and
 * three messages as text, so the pull quote and lot sheet are not repeated
 * word for word. Full: the headline quote beside the Charizard lot sheet,
 * then the messages. Every quote is the customer's own words (lib/reviews.ts).
 * The heading is shown in sentence case on every page, whatever its source
 * casing (screen readers get the owner's text as written).
 */
export function ReviewsBand({
  title,
  compact = false,
  id = "reviews-heading",
  picks,
}: {
  title: string;
  compact?: boolean;
  id?: string;
  /** Compact pages each pick their own text message, so pages don't end the same way. */
  picks?: string[];
}) {
  return (
    <section aria-labelledby={id} className="surface-white relative overflow-hidden">
      <div className="wrap section-y">
        <h2 id={id} data-reveal className="display-lg max-w-4xl text-ink">
          <span className="block lowercase first-letter:uppercase">{title}</span>
        </h2>
        {!compact && (
          <div className="mt-12 grid gap-12 md:mt-16 lg:grid-cols-12 lg:items-start lg:gap-14">
            <FeaturedReview className="lg:col-span-7" />
            <CaseCard className="lg:col-span-5" />
          </div>
        )}
        <div className={compact ? "mt-10 md:mt-14" : "mt-16 md:mt-20"}>
          <ReviewBubbles
            ids={compact ? PAGE_STRIP[id] : undefined}
            picks={picks ?? (compact ? PAGE_PICKS[id] : undefined)}
          />
        </div>
      </div>
    </section>
  );
}
