import { SplitReveal } from "@/components/motion/split-reveal";
import { cn } from "@/lib/utils";

/**
 * An inner page's header: a Big Shoulders eyebrow, a big mixed-case
 * headline whose words rise in once, and the lead. Place it inside the
 * page's own section (it sets no background).
 * - `tone="dark"` for an ink or cobalt section (sun eyebrow, white text).
 * - `actions` adds a row of pill buttons under the lead.
 * - `sprite` and `portrait` are accepted for older callers and no longer drawn.
 */
export function PageHero({
  eyebrow,
  title,
  lines,
  lead,
  className = "",
  tone = "light",
  actions,
}: {
  eyebrow?: string;
  title: string;
  lines?: string[];
  lead?: React.ReactNode;
  className?: string;
  tone?: "light" | "dark";
  actions?: React.ReactNode;
  /** @deprecated no longer drawn */
  sprite?: React.ReactNode;
  /** @deprecated no longer drawn */
  portrait?: boolean;
}) {
  const dark = tone === "dark";
  return (
    <div className={className}>
      {eyebrow && (
        <p className={cn("hero-in eyebrow mb-5 inline-flex items-center gap-2.5", dark ? "text-sun" : "text-cobalt")}>
          <span aria-hidden className={cn("h-[3px] w-6 rounded-full", dark ? "bg-sun" : "bg-cobalt")} />
          {eyebrow}
        </p>
      )}
      <h1
        className={cn(
          "max-w-5xl font-heading text-[clamp(3rem,12vw,4.25rem)] leading-[0.9] font-black tracking-[-0.01em] md:text-[clamp(4.25rem,7vw,6.5rem)]",
          dark ? "text-white" : "text-ink"
        )}
      >
        <SplitReveal text={title} lines={lines} step={60} />
      </h1>
      {lead && (
        <p
          className={cn(
            "hero-in lead mt-6 md:mt-8 md:text-[21px]",
            dark ? "text-on-dark-muted" : "text-ink-soft"
          )}
          style={{ ["--d" as string]: 220 }}
        >
          {lead}
        </p>
      )}
      {actions && (
        <div className="hero-in mt-8 flex flex-wrap gap-4" style={{ ["--d" as string]: 320 }}>
          {actions}
        </div>
      )}
    </div>
  );
}
