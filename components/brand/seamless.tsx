import Image, { type StaticImageData } from "next/image";
import { cn } from "@/lib/utils";

export type SeamlessProps = {
  /** A cut-out-on-white photo (e.g. the Mantle glove pair, the Garchomp corner). */
  src: string | StaticImageData;
  alt: string;
  /** CSS aspect-ratio of the backdrop, e.g. "4/3". */
  aspect?: string;
  /** studio (default): white centre falling to a cool grey sweep. chalk: softer. white: flat. */
  backdrop?: "studio" | "chalk" | "white";
  /** Inner padding around the photo, as a CSS length (default 8%). */
  inset?: string;
  /** A soft contact shadow under the object (default true). */
  floor?: boolean;
  /** object-position for the contained photo. */
  position?: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
  children?: React.ReactNode;
};

/**
 * Studio seamless: sets a photo shot on white onto a soft studio sweep. The
 * photo is multiplied, so its white ground disappears into the backdrop and
 * the object (hands, card) reads as shot in place. 22px corners.
 */
export function Seamless({
  src,
  alt,
  aspect = "4/3",
  backdrop = "studio",
  inset = "8%",
  floor = true,
  position,
  sizes = "(max-width: 768px) 92vw, 640px",
  priority,
  className,
  children,
}: SeamlessProps) {
  return (
    <div
      className={cn(
        "seamless",
        backdrop === "chalk" && "seamless-chalk",
        backdrop === "white" && "seamless-white",
        className
      )}
      style={{ aspectRatio: aspect }}
    >
      {floor && <span aria-hidden className="seamless-floor" />}
      <div className="absolute" style={{ inset }}>
        <div className="relative h-full w-full">
          <Image
            src={src}
            alt={alt}
            fill
            sizes={sizes}
            priority={priority}
            className="seamless-img"
            style={position ? { objectPosition: position } : undefined}
          />
        </div>
      </div>
      {children}
    </div>
  );
}
