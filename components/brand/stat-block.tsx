import { cn } from "@/lib/utils";

export type StatBlockProps = {
  /** The figure, exactly as the owner states it (e.g. "5000+", "Free"). Never invent one. */
  value: React.ReactNode;
  /** The label under it (e.g. "Cards Restored"). */
  label: React.ReactNode;
  tone?: "sun" | "cobalt" | "ink" | "white";
  className?: string;
  children?: React.ReactNode;
};

const TONE = {
  sun: "bg-sun text-ink",
  cobalt: "bg-cobalt text-white",
  ink: "bg-ink-2 text-white shadow-[inset_0_0_0_1px_var(--line-dark)]",
  white: "bg-white text-ink shadow-[0_0_0_1px_var(--line)]",
} as const;

/**
 * An oversized number over its label on a 22px tile. Use in a bento next to
 * a photo tile; one sun, one cobalt at most per row.
 */
export function StatBlock({ value, label, tone = "sun", className, children }: StatBlockProps) {
  return (
    <div className={cn("stat-block", TONE[tone], className)}>
      <p className="stat-value m-0">{value}</p>
      <div>
        <p className="stat-label m-0">{label}</p>
        {children}
      </div>
    </div>
  );
}
