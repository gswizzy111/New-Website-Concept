import Image from "next/image";
import type { Photo } from "@/lib/about";

/**
 * A genuine photo from lib/about.ts in a white print frame with an optional
 * caption. Renders nothing for an empty slot, so the page never shows a
 * placeholder.
 */
export function PhotoFigure({
  photo,
  sizes,
  aspect,
  preload,
  className = "",
}: {
  photo: Photo | null;
  sizes: string;
  /** Crop to a fixed ratio (e.g. "aspect-[4/5]"); otherwise the photo's own. */
  aspect?: string;
  preload?: boolean;
  className?: string;
}) {
  if (!photo) return null;
  return (
    <figure className={className}>
      <div className="rounded-lg bg-white p-2 md:p-2.5 ring-1 ring-ink/12">
        <div className={`overflow-hidden rounded-[5px] ${aspect ?? ""}`}>
          <Image
            src={photo.src}
            alt={photo.alt}
            sizes={sizes}
            preload={preload}
            className={aspect ? "h-full w-full object-cover" : "block h-auto w-full"}
          />
        </div>
      </div>
      {photo.caption && <figcaption className="mt-3 text-[13px] text-muted-foreground">{photo.caption}</figcaption>}
    </figure>
  );
}
