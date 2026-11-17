import { cn } from "@/lib/utils";

export type StickerTone = "sun" | "cobalt" | "ink" | "white";

export type StickerProps = {
  children: React.ReactNode;
  tone?: StickerTone;
  size?: "sm" | "md" | "lg" | "xl";
  /** Rotation in degrees, usually between -6 and 6. */
  tilt?: number;
  /** Pops in once after `popDelay` ms (spring). Static under reduced motion. */
  pop?: boolean;
  popDelay?: number;
  as?: "span" | "li" | "p" | "div";
  className?: string;
};

/**
 * A die-cut label: Big Shoulders uppercase on a 6px rectangle with a white
 * cut edge. At most about two per screen, never over a headline or the
 * holder. Text must be the owner's words.
 */
export function Sticker({
  children,
  tone = "sun",
  size = "md",
  tilt = 0,
  pop = false,
  popDelay = 1100,
  as: Tag = "span",
  className,
}: StickerProps) {
  return (
    <Tag
      className={cn(
        "sticker",
        `sticker-${tone}`,
        size !== "md" && `sticker-${size}`,
        pop && "sticker-pop",
        className
      )}
      style={{
        ["--tilt" as string]: `${tilt}deg`,
        ...(pop ? { ["--d" as string]: popDelay } : null),
      }}
    >
      {children}
    </Tag>
  );
}
