import type { StaticImageData } from "next/image";
import { Seamless } from "@/components/brand";
import { cn } from "@/lib/utils";

/**
 * A cut-out-on-white photo (Garchomp corner, Mantle glove pair) as a physical
 * print: white border, tilt and the print shadow around a studio seamless, so
 * the photo's white canvas melts into the sweep instead of reading as a pasted
 * rectangle. Page-level helper for the inner pages' heroes and bands.
 */
export function SeamlessPrint({
  src,
  alt,
  aspect,
  tilt = 0,
  caption,
  inset = "0",
  backdrop = "studio",
  dark = false,
  sizes,
  priority,
  className,
}: {
  src: string | StaticImageData;
  alt: string;
  aspect: string;
  tilt?: number;
  caption?: React.ReactNode;
  inset?: string;
  backdrop?: "studio" | "chalk" | "white";
  dark?: boolean;
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <figure
      className={cn("print print-lg m-0", dark && "print-dark", className)}
      style={{ ["--tilt" as string]: `${tilt}deg` }}
    >
      <Seamless
        src={src}
        alt={alt}
        aspect={aspect}
        backdrop={backdrop}
        inset={inset}
        floor={false}
        sizes={sizes}
        priority={priority}
        className="rounded-[3px]"
      />
      {caption && <figcaption className="print-caption">{caption}</figcaption>}
    </figure>
  );
}
