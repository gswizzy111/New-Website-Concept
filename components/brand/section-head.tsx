import { cn } from "@/lib/utils";

export type SectionTone = "light" | "dark" | "cobalt" | "sun";

export type SectionHeadProps = {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lead?: React.ReactNode;
  /** light: chalk/white sections. dark: ink. cobalt: cobalt. sun: sun yellow. */
  tone?: SectionTone;
  /** Headline scale: xl (closing / hero-size), lg (default section), md (inner pages, sub-sections). */
  size?: "xl" | "lg" | "md";
  align?: "left" | "center";
  /** Heading level. Use "h1" only for a page's own header. */
  as?: "h1" | "h2" | "h3";
  /** Buttons or a link shown beside the lead on wide screens, under it on phones. */
  actions?: React.ReactNode;
  id?: string;
  className?: string;
  titleClassName?: string;
};

const EYEBROW: Record<SectionTone, string> = {
  light: "text-cobalt",
  dark: "text-sun",
  cobalt: "text-sun",
  sun: "text-ink",
};
const TITLE: Record<SectionTone, string> = {
  light: "text-ink",
  dark: "text-white",
  cobalt: "text-white",
  sun: "text-ink",
};
const LEAD: Record<SectionTone, string> = {
  light: "text-ink-soft",
  dark: "text-on-dark-muted",
  cobalt: "text-[#e6ebff]",
  sun: "text-ink",
};
const SIZE = { xl: "display-xl", lg: "display-lg", md: "display-md" } as const;

/**
 * Eyebrow + headline + lead, in the poster type. With `actions`, the lead
 * and actions sit to the right of the headline on wide screens (the
 * "results" header pattern). Words must be the owner's own.
 */
export function SectionHead({
  eyebrow,
  title,
  lead,
  tone = "light",
  size = "lg",
  align = "left",
  as: Tag = "h2",
  actions,
  id,
  className,
  titleClassName,
}: SectionHeadProps) {
  const center = align === "center";
  const split = !!actions && !center;
  return (
    <header
      className={cn(
        split ? "flex flex-wrap items-end justify-between gap-x-14 gap-y-7" : "flex flex-col",
        center && "items-center text-center",
        className
      )}
    >
      <div className={cn("min-w-0", split && "max-w-3xl")}>
        {eyebrow && <p className={cn("eyebrow mb-4", EYEBROW[tone])}>{eyebrow}</p>}
        <Tag id={id} className={cn(SIZE[size], TITLE[tone], titleClassName)}>
          {title}
        </Tag>
        {lead && !split && (
          <p className={cn("lead mt-5 md:mt-6", LEAD[tone], center && "mx-auto")}>{lead}</p>
        )}
      </div>
      {split ? (
        <div className="max-w-[26rem]">
          {lead && <p className={cn("mb-6 text-[17px] leading-relaxed md:text-[19px]", LEAD[tone])}>{lead}</p>}
          <div className="flex flex-wrap gap-4">{actions}</div>
        </div>
      ) : (
        actions && <div className={cn("mt-8 flex flex-wrap gap-4", center && "justify-center")}>{actions}</div>
      )}
    </header>
  );
}
