import Link from "next/link";
import { ArrowUpRight, Check } from "lucide-react";
import { BrandLogo, cta } from "@/components/brand";
import { cn } from "@/lib/utils";

/**
 * The look of the private areas (customer account, order pages, creator and
 * partner portals, accountant setup, support cases, unsubscribe): chalk
 * pages, a slim white header with the brand mark, white 22px panels and
 * Big Shoulders headings. Presentational only.
 */

/** A white panel. */
export const PANEL = "rounded-[22px] bg-white p-5 text-ink shadow-[0_0_0_1px_var(--line),var(--panel-shadow)] sm:p-6";
/** A panel's heading ("Order Summary", "Your Cards"). */
export const PANEL_TITLE = "font-heading text-[1.6rem] leading-none font-extrabold text-ink";
/** A small caps label inside a panel ("Status", "Shipping Label"). */
export const PANEL_LABEL = "label-caps mb-4 text-[15px] text-ink-soft";
/** A field label. */
export const FIELD_LABEL = "mb-1.5 block text-sm font-semibold text-ink";
/** A full-width primary button for portal forms. */
export const PORTAL_BUTTON = cta({ tone: "sun", size: "md", className: "w-full" });
/** A quiet text link. */
export const PORTAL_LINK = "font-semibold text-cobalt underline-offset-4 hover:underline";
/** A page heading. */
export const PAGE_TITLE = "font-heading text-[2.75rem] leading-[0.9] font-black tracking-[-0.01em] text-ink md:text-[3.5rem]";

/** The eyebrow over a page heading, with its short rule. */
export function Eyebrow({ children, className, as: Tag = "p" }: { children: React.ReactNode; className?: string; as?: "p" | "h2" | "h3" }) {
  return (
    <Tag className={cn("eyebrow caps mb-3 inline-flex items-center gap-2.5 text-cobalt", className)}>
      <span aria-hidden className="h-[3px] w-6 rounded-full bg-cobalt" />
      {children}
    </Tag>
  );
}

/** The slim header on private pages: the brand mark (home link), an optional label, and a right-hand slot. */
export function PortalHeader({
  label,
  children,
  width = "max-w-5xl",
  sticky = true,
}: {
  label?: React.ReactNode;
  children?: React.ReactNode;
  width?: string;
  sticky?: boolean;
}) {
  return (
    <header className={cn("z-20 border-b border-line bg-white", sticky && "sticky top-0")}>
      <div className={cn("mx-auto flex min-h-16 items-center justify-between gap-4 px-4 py-2 sm:px-6", width)}>
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/" className="inline-flex min-h-11 shrink-0 items-center rounded-[14px] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cobalt">
            <BrandLogo size={38} wordmarkClassName={children ? "hidden text-[1.35rem] sm:inline" : "text-[1.25rem] sm:text-[1.35rem]"} />
            <span className="sr-only">The Card Doc home</span>
          </Link>
          {label && (
            <span className="label-caps hidden border-l border-line pl-4 text-[15px] text-ink-soft sm:inline">{label}</span>
          )}
        </div>
        {children && <div className="flex min-w-0 items-center gap-2 sm:gap-4">{children}</div>}
      </div>
    </header>
  );
}

/** A centered card for sign-in and set-password screens, under the brand mark. */
export function PortalCard({
  eyebrow,
  title,
  children,
  width = "max-w-md",
}: {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <div className="surface-chalk relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-14">
      <span aria-hidden className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full bg-cobalt-wash" />
      <span aria-hidden className="pointer-events-none absolute -bottom-48 -left-32 size-[420px] rounded-full bg-sun-tint" />
      <div className={cn("relative w-full", width)}>
        <div className="mb-7 flex justify-center">
          <Link href="/" className="inline-flex min-h-11 items-center rounded-[14px] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cobalt">
            <BrandLogo size={46} wordmarkClassName="text-[1.6rem]" />
          </Link>
        </div>
        <div className="rounded-[22px] bg-white p-6 text-ink shadow-[0_0_0_1px_var(--line),var(--pop-shadow)] sm:p-8">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          {title && <h1 className="mb-5 font-heading text-[2.25rem] leading-[0.95] font-black text-ink">{title}</h1>}
          {children}
        </div>
      </div>
    </div>
  );
}

export type StepState = "done" | "current" | "next";

/** A vertical status track: done steps cobalt with a check, the current one sun. */
export function StatusTrack({ steps, size = "md" }: { steps: { key: string; label: React.ReactNode; state: StepState }[]; size?: "sm" | "md" }) {
  return (
    <ol className="relative flex flex-col">
      {steps.map((s, i) => (
        <li key={s.key} className="relative flex items-center gap-3 pb-3.5 last:pb-0" aria-current={s.state === "current" ? "step" : undefined}>
          {i < steps.length - 1 && (
            <span aria-hidden className={cn("absolute top-6 left-[11px] h-[calc(100%-12px)] w-0.5 rounded-full", s.state === "done" ? "bg-cobalt" : "bg-ink/10")} />
          )}
          <span
            aria-hidden
            className={cn(
              "relative grid size-6 shrink-0 place-items-center rounded-full",
              s.state === "done" && "bg-cobalt text-white",
              s.state === "current" && "bg-sun shadow-[0_0_0_2px_var(--ink)]",
              s.state === "next" && "bg-white shadow-[inset_0_0_0_1.5px_var(--line-strong)]"
            )}
          >
            {s.state === "done" && <Check className="size-3.5" strokeWidth={3} />}
            {s.state === "current" && <span className="size-2 rounded-full bg-ink" />}
          </span>
          <span
            className={cn(
              size === "sm" ? "text-sm" : "text-[15px]",
              s.state === "current" ? "font-bold text-ink" : s.state === "done" ? "font-medium text-ink-soft" : "text-ink-soft/70"
            )}
          >
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A small rounded status label. Tones: ink, cobalt, sun, success, danger, muted. */
export function StatusPill({ tone = "muted", children, className }: { tone?: "ink" | "cobalt" | "sun" | "success" | "danger" | "muted" | "wash"; children: React.ReactNode; className?: string }) {
  const TONE = {
    ink: "bg-ink text-white",
    cobalt: "bg-cobalt text-white",
    sun: "bg-sun text-ink",
    success: "bg-success-tint text-success",
    danger: "bg-red-50 text-destructive",
    muted: "bg-chalk text-ink-soft shadow-[inset_0_0_0_1px_var(--line)]",
    wash: "bg-cobalt-wash text-cobalt-deep",
  } as const;
  return (
    <span className={cn("inline-flex min-h-7 items-center rounded-full px-3 text-[13px] font-bold whitespace-nowrap", TONE[tone], className)}>
      {children}
    </span>
  );
}

/** A tracking number in an ink panel, with its carrier link. */
export function TrackingPanel({
  label,
  number,
  href,
  chip,
  children,
  className,
}: {
  label: React.ReactNode;
  number: string;
  href?: string | null;
  chip?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("surface-ink rounded-[22px] p-5 sm:p-6", className)}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="label-caps text-[15px] text-sun">{label}</p>
        {chip}
      </div>
      {children}
      <p className="mb-4 font-mono text-lg font-bold tracking-wider break-all text-white">{number}</p>
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className={cta({ tone: "sun", size: "sm" })}>
          Track Package
          <ArrowUpRight aria-hidden className="size-4" strokeWidth={2.25} />
        </a>
      )}
    </div>
  );
}
