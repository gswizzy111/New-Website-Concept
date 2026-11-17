import { cn } from "@/lib/utils";

export type CtaTone = "sun" | "ink" | "cobalt" | "outline" | "outline-light" | "white" | "ghost";
export type CtaSize = "sm" | "md" | "lg";

/**
 * Class string for a pill button on a link or any element:
 *   <Link href="/restoration" className={cta({ tone: "sun", size: "lg" })}>Book a Restoration <ArrowRight /></Link>
 * sun is the single action colour (ink text, white die-cut edge). ink is the
 * dark primary; outline is the ink-ringed secondary on light; outline-light
 * the white-ringed secondary on cobalt/ink. A trailing svg nudges 3px on hover.
 * For real <button>s use components/ui/button (variants sun/ink/outline...).
 */
export function cta({
  tone = "sun",
  size = "md",
  className,
}: { tone?: CtaTone; size?: CtaSize; className?: string } = {}) {
  return cn("btn", `btn-${tone}`, size === "sm" && "btn-sm", size === "lg" && "btn-lg", className);
}
