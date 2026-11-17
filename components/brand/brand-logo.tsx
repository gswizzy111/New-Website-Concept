import Image from "next/image";
import { cn } from "@/lib/utils";

export type BrandLogoProps = {
  /** Frame size in px (nav 44-48, footer 56). */
  size?: number;
  /** Frame size from md up, when it differs (one image, resized by CSS). */
  mdSize?: number;
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
  mdSize,
  surface = "light",
  wordmark = true,
  wordmarkClassName,
  alt = "",
  priority,
  className,
}: BrandLogoProps) {
  const largest = Math.max(size, mdSize ?? size);
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <span
        className={cn(
          "relative block size-[var(--logo)] shrink-0 overflow-hidden rounded-[calc(var(--logo)/4)] bg-white",
          mdSize && "md:size-[var(--logo-md)] md:rounded-[calc(var(--logo-md)/4)]"
        )}
        style={{
          ["--logo" as string]: `${size}px`,
          ...(mdSize ? { ["--logo-md" as string]: `${mdSize}px` } : {}),
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
          // The photo is 1.4x wider than tall, cropped square, then scaled
          // 1.9x to the face: ask for a file that wide, so it stays sharp.
          sizes={`${Math.round(largest * 1.4 * 1.9)}px`}
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
