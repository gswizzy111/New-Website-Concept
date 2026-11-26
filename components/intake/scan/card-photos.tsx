"use client";

import { useEffect } from "react";
import { ImageOff } from "lucide-react";
import { PhotoViewer, usePhotoViewer, type GridPhoto } from "@/app/admin/receiving/[orderId]/photos/photo-grid";
import type { TrackCardPhoto, TrackCardSummary } from "@/lib/intake/tracking/types";

/**
 * A card's photos under its name on the Scan page, big enough to tell the
 * card by eye on a phone: up to 3 white-framed thumbnails in a row (its
 * receiving photos, then the customer's; the catalog's picture, labelled
 * "Reference photo", only when it has neither), each opening the photos
 * page's full-screen viewer, which steps through all of them. Thumbnails are
 * small resized copies made on the server (TrackCardSummary.photos) and load
 * lazily, so a bag of 20 cards never pulls 20 originals. No photo: a small
 * "No photo yet".
 */

/** Thumbnails in the row; the rest open from the third ("+2"). */
const SHOWN = 3;

/** The Scan page sends this on every scan: an open photo closes, so the answer to the scan shows. */
export const SCAN_READ_EVENT = "intake:scan-read";

const NOUN: Record<TrackCardPhoto["kind"], string> = {
  receiving: "Receiving photo",
  customer: "Customer photo",
  reference: "Reference photo",
};

function cardLabel(card: Pick<TrackCardSummary, "code" | "name">): string {
  return [card.code, card.name?.trim()].filter(Boolean).join(" ") || "the card";
}

/** The viewer's photos, with what a screen reader says for each ("Receiving photo 1 of CD-2549-01 Charizard"). */
function viewerPhotos(photos: TrackCardPhoto[], label: string, name: string): GridPhoto[] {
  const seen = { receiving: 0, customer: 0, reference: 0 };
  return photos.map((p) => {
    seen[p.kind] += 1;
    const alt = p.kind === "reference"
      ? `Reference photo of ${name} from the card catalog, not the customer's card`
      : `${NOUN[p.kind]} ${seen[p.kind]} of ${label}`;
    return { url: p.url, kind: p.kind, tile: p.tile, full: p.full, alt };
  });
}

export function CardPhotos({
  card,
  size = "md",
  className = "",
}: {
  card: Pick<TrackCardSummary, "code" | "name" | "photos">;
  /** md: 112 px tall; sm: 96 px (a stack of several cards in one holder). */
  size?: "md" | "sm";
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

  const photos = card.photos ?? [];
  if (!photos.length) {
    return (
      <p className={`inline-flex items-center gap-1.5 self-start rounded-lg border border-dashed border-border bg-secondary/40 px-2.5 py-1.5 text-xs font-semibold text-muted-foreground ${className}`}>
        <ImageOff className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        No photo yet
      </p>
    );
  }

  const label = cardLabel(card);
  const all = viewerPhotos(photos, label, card.name?.trim() || "this card");
  const shown = all.slice(0, SHOWN);
  const more = all.length - shown.length;
  const reference = all.length === 1 && all[0].kind === "reference";
  const box = size === "sm" ? "h-24 w-[72px]" : "h-28 w-[84px]";

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <ul className="flex flex-wrap gap-2" aria-label={`Photos of ${label}`}>
        {shown.map((p, i) => {
          const last = i === shown.length - 1 && more > 0;
          return (
            <li key={`${i}-${p.url}`} className="shrink-0">
              <button
                type="button"
                onClick={(e) => viewer.show(i, e.currentTarget)}
                aria-haspopup="dialog"
                className={`relative block ${box} overflow-hidden rounded-lg bg-white p-1 shadow-sm transition-colors motion-reduce:transition-none ${
                  p.kind === "reference" ? "border-2 border-dashed border-amber-400" : "border border-border hover:border-primary/60"
                } focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.tile.src}
                  srcSet={p.tile.srcSet}
                  sizes={p.tile.srcSet ? (size === "sm" ? "72px" : "84px") : undefined}
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
