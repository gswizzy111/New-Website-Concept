"use client";

import { useEffect } from "react";
import { ImageOff } from "lucide-react";
import { PhotoViewer, usePhotoViewer, type GridPhoto } from "@/app/admin/receiving/[orderId]/photos/photo-grid";
import type { TrackCardPhoto, TrackCardSummary } from "@/lib/intake/tracking/types";

/**
 * A card's photos on the Scan page, big enough to tell the card by eye on a
 * phone: up to 3 white-framed thumbnails (its receiving photos, then the
 * customer's; the catalog's picture, labelled "Reference photo", only when
 * it has neither), each opening the photos page's full-screen viewer, which
 * steps through all of them. Thumbnails are small resized copies made on the
 * server (TrackCardSummary.photos, lib/intake/tracking/summaries.ts
 * cardPhotos) and load lazily, so a bag of 20 cards never pulls 20
 * originals. No photo: a small "No photo yet".
 *
 *   <CardPhotos photos={card.photos} label={cardPhotoLabel(card)} />            under a card in a list (112 px tall)
 *   <CardPhotos photos={card.photos} label={cardPhotoLabel(card)} size="large" /> a holder's own card (a third of the width each, up to 160 px wide)
 */

/** Thumbnails shown; the rest open from the last one ("+2"). */
const SHOWN = 3;

/** The Scan page sends this on every scan: an open photo closes, so the answer to the scan shows. */
export const SCAN_READ_EVENT = "intake:scan-read";

const NOUN: Record<TrackCardPhoto["kind"], string> = {
  receiving: "Receiving photo",
  customer: "Customer photo",
  reference: "Reference photo",
};

/** "CD-2549-01 Charizard": what CardPhotos' `label` names (the list, each photo, the viewer). */
export function cardPhotoLabel(card: Pick<TrackCardSummary, "code" | "name">): string {
  return [card.code, card.name?.trim()].filter(Boolean).join(" ") || "the card";
}

/** The viewer's photos, with what a screen reader says for each ("Receiving photo 1 of CD-2549-01 Charizard"). */
function viewerPhotos(photos: readonly TrackCardPhoto[], label: string): GridPhoto[] {
  const seen = { receiving: 0, customer: 0, reference: 0 };
  return photos.map((p) => {
    seen[p.kind] += 1;
    const alt = p.kind === "reference"
      ? `Reference photo of ${label} from the card catalog, not the customer's card`
      : `${NOUN[p.kind]} ${seen[p.kind]} of ${label}`;
    return { url: p.url, kind: p.kind, tile: p.tile, full: p.full, alt };
  });
}

const SIZES = {
  // 112 px tall, 84 px wide
  list: { list: "flex flex-wrap gap-2", item: "shrink-0", tile: "h-28 w-[84px]", sizes: "84px" },
  // three across, each a third of the width up to 160 px wide (about 136 px tall on a phone)
  large: { list: "grid max-w-[30rem] grid-cols-3 gap-2", item: "min-w-0", tile: "aspect-[3/4] w-full", sizes: "(min-width: 640px) 160px, 33vw" },
} as const;

export function CardPhotos({
  photos,
  label,
  size = "list",
  className = "",
}: {
  /** TrackCardSummary.photos (missing in older answers: no photo). */
  photos: readonly TrackCardPhoto[] | null | undefined;
  /** "CD-2549-01 Charizard" (cardPhotoLabel): names the list ("Photos of …"), each photo and the viewer. */
  label: string;
  /** list: under a card in a list; large: a holder's own card. */
  size?: "list" | "large";
  className?: string;
}) {
  const viewer = usePhotoViewer();
  const { setIndex } = viewer;

  // A scan while a photo is open: close it, so the answer to the scan is what shows
  useEffect(() => {
    const close = () => setIndex(null);
    window.addEventListener(SCAN_READ_EVENT, close);
    return () => window.removeEventListener(SCAN_READ_EVENT, close);
  }, [setIndex]);

  if (!photos?.length) {
    return (
      <p className={`inline-flex items-center gap-1.5 self-start rounded-lg border border-dashed border-border bg-secondary/40 px-2.5 py-1.5 text-xs font-semibold text-muted-foreground ${className}`}>
        <ImageOff className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        No photo yet
      </p>
    );
  }

  const look = SIZES[size];
  const all = viewerPhotos(photos, label);
  const shown = all.slice(0, SHOWN);
  const more = all.length - shown.length;
  const reference = all.length === 1 && all[0].kind === "reference";

  return (
    <div className={`flex gap-x-3 gap-y-2 ${size === "large" ? "flex-col" : "items-center"} ${className}`}>
      <ul className={look.list} aria-label={`Photos of ${label}`}>
        {shown.map((p, i) => {
          const last = i === shown.length - 1 && more > 0;
          return (
            <li key={`${i}-${p.url}`} className={look.item}>
              <button
                type="button"
                onClick={(e) => viewer.show(i, e.currentTarget)}
                aria-haspopup="dialog"
                className={`relative block ${look.tile} overflow-hidden rounded-lg bg-white p-1 shadow-sm transition-colors motion-reduce:transition-none ${
                  p.kind === "reference" ? "border-2 border-dashed border-amber-400" : "border border-border hover:border-primary/60"
                } focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.tile.src}
                  srcSet={p.tile.srcSet}
                  sizes={p.tile.srcSet ? look.sizes : undefined}
                  alt={p.alt}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full rounded-[5px] bg-secondary/40 object-contain"
                />
                {last && (
                  <span aria-hidden="true" className="absolute inset-x-1 bottom-1 rounded-b-[5px] bg-black/70 py-0.5 text-center text-xs font-bold text-white">
                    +{more}
                  </span>
                )}
                <span className="sr-only">{last ? `, and ${more} more: open full screen` : ", open full screen"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {reference && (
        <p className="min-w-0 text-xs font-bold leading-snug text-amber-900">
          Reference photo
          <span className="block font-semibold text-amber-800">Not the customer&apos;s card</span>
        </p>
      )}
      <PhotoViewer photos={all} cardLabel={label} viewer={viewer} />
    </div>
  );
}
