import { cn } from "@/lib/utils";

export type AcrylicHolderProps = {
  children: React.ReactNode;
  /** Rotation in degrees (the hero uses 2.5). Keep it at 0 when the child is a drag slider on phones. */
  tilt?: number;
  /** "glass" (default) reads on cobalt/ink; "light" is a frosted version for chalk/white sections. */
  tone?: "glass" | "light";
  /** Bold uppercase name under the card, e.g. "Mickey Mantle". */
  title?: React.ReactNode;
  /** Small detail line on the right of the caption. */
  detail?: React.ReactNode;
  /** Four corner screws (default true). */
  screws?: boolean;
  className?: string;
  /** Classes for the inner card window (radius 4px, clips the child). */
  cardClassName?: string;
};

/**
 * A clear acrylic one-touch holder around a card: frosted edge, corner
 * screws, a glare streak that never catches the pointer, and an optional
 * caption. The child (a photo or a <BeforeAfter/> slider) keeps all its own
 * interaction; labels inside the child are never clipped by the frame.
 */
export function AcrylicHolder({
  children,
  tilt = 0,
  tone = "glass",
  title,
  detail,
  screws = true,
  className,
  cardClassName,
}: AcrylicHolderProps) {
  return (
    <div
      className={cn("holder", tone === "light" && "holder-light", className)}
      style={{ ["--tilt" as string]: `${tilt}deg` }}
    >
      {screws && (
        <>
          <span aria-hidden className="holder-screw" style={{ left: 7, top: 7 }} />
          <span aria-hidden className="holder-screw" style={{ right: 7, top: 7 }} />
          <span aria-hidden className="holder-screw" style={{ left: 7, bottom: 7 }} />
          <span aria-hidden className="holder-screw" style={{ right: 7, bottom: 7 }} />
        </>
      )}
      <div className={cn("holder-card", cardClassName)}>{children}</div>
      {(title || detail) && (
        <div className="holder-caption">
          {title && <b>{title}</b>}
          {detail && <span>{detail}</span>}
        </div>
      )}
    </div>
  );
}
