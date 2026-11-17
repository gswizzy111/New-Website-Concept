import Image from "next/image";
import { cn } from "@/lib/utils";
import type { Photo } from "@/lib/about";

/**
 * A genuine photo from lib/about.ts as a white-bordered print (8px corners,
 * the layered print shadow) with an optional caption. `bare` drops the
 * border for a photo that already sits inside a frame. Renders nothing for
 * an empty slot, so the page never shows a placeholder.
 */
export function PhotoFigure({
  photo,
  sizes,
  aspect,
  preload,
  bare = false,
  className = "",
}: {
  photo: Photo | null;
  sizes: string;
  /** Crop to a fixed ratio (e.g. "aspect-[4/5]"); otherwise the photo's own. */
  aspect?: string;
  preload?: boolean;
  /** No border or shadow: for a photo inside another frame. */
  bare?: boolean;
  className?: string;
}) {
  if (!photo) return null;
  return (
    <figure className={cn("m-0", className)}>
      <div className={cn(bare ? "overflow-hidden rounded-[8px]" : "print")}>
        <div className={cn("relative overflow-hidden rounded-[3px]", aspect)}>
          <Image
            src={photo.src}
            alt={photo.alt}
            sizes={sizes}
            preload={preload}
            className={aspect ? "h-full w-full object-cover" : "block h-auto w-full"}
          />
        </div>
      </div>
      {photo.caption && (
        <figcaption className="mt-3 text-[13px] font-medium leading-snug text-ink-soft">{photo.caption}</figcaption>
      )}
    </figure>
  );
}
