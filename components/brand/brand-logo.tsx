import Image from "next/image";
import { cn } from "@/lib/utils";

export type BrandLogoProps = {
  /** Frame size in px (nav 44-48, footer 56). */
  size?: number;
  /** "light" frames in ink (white/chalk surfaces); "dark" frames in white (ink surfaces). */
  surface?: "light" | "dark";
  /** Show "The Card Doc" beside the mark. */
  wordmark?: boolean;
  wordmarkClassName?: string;
  /** Alt text for the mark. Leave "" when a visible wordmark or link label names it. */
  alt?: string;
  priority?: boolean;
  className?: string;
};

/**
 * The owner's brand mark (/card-doctor.jpg, PRODUCT.md), cropped to the head
 * inside a rounded-square frame, with the "The Card Doc" wordmark in Big
 * Shoulders. Not a link by itself: wrap it.
 */
export function BrandLogo({
  size = 46,
  surface = "light",
  wordmark = true,
  wordmarkClassName,
  alt = "",
  priority,
  className,
}: BrandLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <span
        className="relative block shrink-0 overflow-hidden bg-white"
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size / 4),
          boxShadow:
            surface === "dark"
              ? "0 0 0 2px var(--ink), 0 0 0 4px var(--white)"
              : "0 0 0 2px var(--white), 0 0 0 4px var(--ink), 0 6px 12px -6px rgba(8,12,40,.5)",
        }}
      >
        <Image
          src="/card-doctor.jpg"
          alt={alt}
          fill
          sizes={`${size * 2}px`}
          priority={priority}
          className="object-cover"
          style={{ objectPosition: "52% 0%", transform: "scale(1.9)", transformOrigin: "52% 12%" }}
        />
      </span>
      {wordmark && (
        <span
          className={cn(
            "font-display text-[26px] font-black uppercase leading-none tracking-[-0.005em] whitespace-nowrap md:text-[30px]",
            wordmarkClassName
          )}
        >
          The Card Doc
        </span>
      )}
    </span>
  );
}
