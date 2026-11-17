import { Camera, MessageCircle, Sparkle, Star, UserRound, type LucideIcon } from "lucide-react";
import { REASONS } from "@/lib/about";
import { Marquee } from "@/components/brand";

/**
 * The cards-restored figure the site shows, set by the owner ("5000+").
 * Display only: lib/site-stats.ts still counts the live number.
 */
export const CARDS_RESTORED_DISPLAY = "5000+";

type Pill = { icon: LucideIcon; text: string; /** A leading figure set big in the display face. */ figure?: string; rest?: string };

function pillsFor(cardsRestored: string): Pill[] {
  const years = REASONS.items[1].title; // "30+ years of combined collecting"
  const yearsMatch = years.match(/^(\S+\+)\s(.*)$/);
  return [
    { icon: Star, text: `${cardsRestored} Cards Restored`, figure: cardsRestored, rest: "Cards Restored" },
    { icon: Camera, text: "Free Photo Review" },
    { icon: MessageCircle, text: "We reply within 1 business day." },
    yearsMatch
      ? { icon: UserRound, text: years, figure: yearsMatch[1], rest: yearsMatch[2] }
      : { icon: UserRound, text: years },
  ];
}

/**
 * The four quiet facts (cards restored, free photo review, reply time, years
 * collecting): a clean two-by-two grid, so every fact shows without
 * swiping and none is left alone on a second line. Used on the service pages.
 */
export function TrustPills({
  cardsRestored = CARDS_RESTORED_DISPLAY,
  className = "",
  align = "center",
}: {
  cardsRestored?: string;
  className?: string;
  align?: "center" | "start";
}) {
  const pills = pillsFor(cardsRestored);
  return (
    <div className={`relative ${className}`}>
      <ul
        aria-label="Why collectors trust The Card Doc"
        className={`grid grid-cols-2 gap-x-4 gap-y-3 py-1 sm:w-fit sm:gap-x-8 sm:gap-y-2 ${align === "center" ? "sm:mx-auto" : ""}`}
      >
        {pills.map(({ icon: Icon, text }) => (
          <li
            key={text}
            className="flex min-h-9 min-w-0 items-center gap-2 text-[13px] leading-snug font-bold text-ink sm:h-9 sm:shrink-0 sm:whitespace-nowrap sm:text-sm"
          >
            <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-cobalt-wash text-cobalt">
              <Icon className="size-4" strokeWidth={1.75} />
            </span>
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The same four facts as a slim ink band that slides left forever (CSS, the
 * brand <Marquee/>). Screen readers get one plain list; the moving track is
 * decorative. It pauses under a mouse pointer, on focus and with its pause
 * button, and under reduced motion it
 * stands still as a centred, wrapping row.
 */
export function TrustMarquee({
  cardsRestored = CARDS_RESTORED_DISPLAY,
  className = "",
}: {
  cardsRestored?: string;
  className?: string;
}) {
  const pills = pillsFor(cardsRestored);
  const item = ({ text, figure, rest }: Pill) =>
    figure ? (
      <span key={text} className="inline-flex items-baseline gap-2">
        <span className="font-display text-[33px] font-black leading-none tracking-[0.01em] text-sun md:text-[36px]">{figure}</span>
        <span>{rest}</span>
      </span>
    ) : (
      <span key={text}>{text}</span>
    );
  // Twice over, so one copy of the track is always wider than a wide screen
  // and the loop never shows a gap.
  const items = [...pills, ...pills].map(item);
  return (
    <div className={`relative overflow-hidden bg-ink text-white ${className}`}>
      <ul aria-label="Why collectors trust The Card Doc" className="sr-only">
        {pills.map(({ text }) => <li key={text}>{text}</li>)}
      </ul>
      {/* Reduced motion: one still, centred row of the four facts. */}
      <ul aria-hidden className="hidden flex-wrap items-center justify-center gap-x-6 gap-y-0.5 px-4 py-1.5 text-[13px] font-bold motion-reduce:flex md:gap-x-7 md:text-sm">
        {pills.map((p) => <li key={p.text} className="flex min-h-12 items-center whitespace-nowrap">{item(p)}</li>)}
      </ul>
      <div className="motion-reduce:hidden">
        <Marquee
          items={items}
          decorative
          tone="dark"
          speed={46}
          separator={<Sparkle className="size-3.5 fill-sun text-sun" strokeWidth={1.75} />}
          itemClassName="h-14 px-5 text-[13px] font-bold tracking-[0.01em] md:h-16 md:px-7 md:text-sm"
        />
      </div>
    </div>
  );
}
