import { cn } from "@/lib/utils";

export type CtaPanelProps = {
  /** sun: the action/risk panel (ink text). cobalt and ink: white text. */
  tone?: "sun" | "cobalt" | "ink";
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  /** Heading level (default h2). */
  as?: "h2" | "h3";
  lead?: React.ReactNode;
  /** Buttons: on sun use btn-ink + btn-outline; on cobalt/ink use btn-sun + btn-outline-light. */
  actions?: React.ReactNode;
  /** Extra content (a print, a list) placed beside the copy on wide screens. */
  aside?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
};

const SURFACE = {
  sun: "surface-sun",
  cobalt: "surface-cobalt",
  ink: "surface-ink",
} as const;

/**
 * A solid colour block with a headline, a line of copy and the actions: the
 * call to action that recurs every one or two screens. 22px corners.
 */
export function CtaPanel({
  tone = "sun",
  eyebrow,
  title,
  as: Tag = "h2",
  lead,
  actions,
  aside,
  align = "left",
  className,
}: CtaPanelProps) {
  const center = align === "center";
  return (
    <section className={cn("cta-panel", SURFACE[tone], className)}>
      {tone === "cobalt" && <span aria-hidden className="halftone-dots -right-[8%] -top-[30%] h-[160%] w-[60%]" />}
      <div
        className={cn(
          "grid items-center gap-10",
          aside && !center && "md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]",
          center && "text-center"
        )}
      >
        <div className={cn(center && "mx-auto max-w-3xl")}>
          {eyebrow && (
            <p className={cn("eyebrow mb-4", tone === "sun" ? "text-cobalt-deep" : "text-sun")}>{eyebrow}</p>
          )}
          <Tag className="display-md">{title}</Tag>
          {lead && (
            <p
              className={cn(
                "mt-5 max-w-[46ch] text-[17px] leading-relaxed md:text-[19px]",
                tone === "sun" ? "text-ink" : "text-on-dark-muted",
                center && "mx-auto"
              )}
            >
              {lead}
            </p>
          )}
          {actions && <div className={cn("mt-8 flex flex-wrap gap-4", center && "justify-center")}>{actions}</div>}
        </div>
        {aside && <div className="min-w-0">{aside}</div>}
      </div>
    </section>
  );
}
