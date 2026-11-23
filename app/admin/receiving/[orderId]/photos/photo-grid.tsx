"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Expand, ExternalLink, X } from "lucide-react";

/**
 * One card's photos on the order photo page, big enough to check a card on a
 * phone (two across), each opening full screen on tap. The full-screen viewer
 * steps through all of the card's photos (Previous / Next, arrow keys, or a
 * swipe; it wraps around) and links the original. Only the open photo loads
 * at full size: tiles are lazy and the viewer has no image until it opens, so
 * a 40-card order doesn't pull every original over a phone connection.
 *
 * Image addresses (resized copies on Netlify) are made on the server
 * (lib/thumbnail.ts reads a server-only setting) and passed in.
 */

export type PhotoKind = "receiving" | "customer" | "reference";
type Img = { src: string; srcSet?: string };
export type GridPhoto = {
  url: string;
  kind: PhotoKind;
  /** The tile's image (srcSet when resized copies exist). */
  tile: Img;
  /** The viewer's image. */
  full: Img;
  /** "Receiving photo 1 of CD-2549-03 Charizard" */
  alt: string;
  /**
   * "Receiving photo 1 of 2". Not shown: the viewer's title names the kind of
   * photo and its one counter runs across all of the card's photos.
   */
  position?: string;
};
export type PhotoGroup = { kind: PhotoKind; title: string; photos: GridPhoto[] };

// Two across on a phone, then 3 / 4 / 5 (the admin sidebar takes 224px from lg up)
const TILE_SIZES = "(min-width: 1024px) 210px, (min-width: 640px) 31vw, 50vw";
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2";
const SWIPE_PX = 50;

/** The viewer's title: what kind of photo is open. */
const KIND_TITLE: Record<PhotoKind, string> = {
  receiving: "Receiving photo",
  customer: "Customer photo",
  reference: "Reference photo, not the customer's card",
};

/** `eager`: the first card on the page; its first two photos load at once (the rest lazily). */
export function PhotoGrid({ groups, cardLabel, eager = false }: { groups: PhotoGroup[]; cardLabel: string; eager?: boolean }) {
  const photos = groups.flatMap((g) => g.photos);
  const starts = groups.map((_, gi) => groups.slice(0, gi).reduce((n, g) => n + g.photos.length, 0));

  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [imageState, setImageState] = useState<{ url: string; status: "loaded" | "failed" } | null>(null);

  const current = index === null ? null : photos[index] ?? null;
  const isOpen = current !== null;
  const many = photos.length > 1;

  // Open the dialog once its content is there, and focus Close (Esc also closes).
  // If the photo goes away while open (new props), close it rather than leave an empty black screen.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (!isOpen) {
      if (d.open) d.close();
      return;
    }
    if (d.open) return;
    d.showModal();
    closeButton.current?.focus();
  }, [isOpen]);

  // The page behind doesn't scroll while a photo is open
  useEffect(() => {
    if (!isOpen) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [isOpen]);

  function show(i: number, from: HTMLElement) {
    opener.current = from;
    setIndex(i);
  }

  // Wraps around: Next on the last photo goes back to the first
  function go(delta: number) {
    const n = photos.length;
    setIndex((i) => (i === null || n < 2 ? i : (i + delta + n) % n));
  }

  function onClosed() {
    setIndex(null);
    touch.current = null;
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  }

  // A one-finger sideways swipe steps through the photos; pinch zoom (or a zoomed-in page) is left alone
  function onTouchStart(e: React.TouchEvent) {
    const zoomed = (window.visualViewport?.scale ?? 1) > 1.01;
    if (e.touches.length !== 1 || zoomed) {
      touch.current = null;
      return;
    }
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length > 1) touch.current = null;
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touch.current;
    touch.current = null;
    const end = e.changedTouches[0];
    if (!start || !end) return;
    const dx = end.clientX - start.x;
    const dy = end.clientY - start.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  }

  const status = current && imageState?.url === current.url ? imageState.status : "loading";

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g, gi) => (
        <div key={g.kind}>
          <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-widest ${g.kind === "reference" ? "text-amber-800" : "text-muted-foreground"}`}>{g.title}</p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-label={`${g.title} of ${cardLabel}`}>
            {g.photos.map((p, pi) => {
              const reference = p.kind === "reference";
              const at = starts[gi] + pi;
              const now = eager && at < 2;
              return (
                <li key={`${pi}-${p.url}`} className="min-w-0">
                  <button
                    type="button"
                    onClick={(e) => show(at, e.currentTarget)}
                    aria-haspopup="dialog"
                    className={`relative block w-full aspect-[3/4] overflow-hidden rounded-lg transition-colors hover:border-primary/60 motion-reduce:transition-none ${reference ? "border-2 border-dashed border-amber-400 bg-white" : "border border-border bg-secondary/40"} focus-visible:outline-primary ${focusRing}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.tile.src}
                      srcSet={p.tile.srcSet}
                      sizes={p.tile.srcSet ? TILE_SIZES : undefined}
                      alt={p.alt}
                      loading={now ? "eager" : "lazy"}
                      fetchPriority={now && at === 0 ? "high" : undefined}
                      decoding="async"
                      className="absolute inset-0 h-full w-full object-contain"
                    />
                    {reference && (
                      <span aria-hidden="true" className="absolute left-1.5 top-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                        Reference
                      </span>
                    )}
                    <span aria-hidden="true" className="absolute bottom-1.5 right-1.5 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-foreground shadow-sm">
                      <Expand className="h-4 w-4" strokeWidth={1.75} />
                    </span>
                    <span className="sr-only">, open full screen</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <dialog
        ref={dialog}
        aria-label={current ? current.alt : `Photos of ${cardLabel}`}
        onClose={onClosed}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            go(1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            go(-1);
          }
        }}
        className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-black p-0 text-white backdrop:bg-black"
      >
        {current && index !== null && (
          <div className="flex h-full flex-col pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
            <div className="flex items-center gap-2 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold" aria-live="polite">{KIND_TITLE[current.kind]}</p>
                <p className="truncate text-xs text-white/70">{cardLabel}</p>
              </div>
              <a
                href={current.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-bold text-white hover:bg-white/10 focus-visible:outline-white ${focusRing}`}
              >
                <ExternalLink className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                Original
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <button
                ref={closeButton}
                type="button"
                onClick={() => dialog.current?.close()}
                className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-white px-4 text-sm font-bold text-gray-900 hover:bg-white/90 focus-visible:outline-white ${focusRing}`}
              >
                <X className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                Close
              </button>
            </div>
            {current.kind === "reference" && (
              <p className="px-3 pb-2 text-xs font-bold text-amber-300">Reference photo from the card catalog, not the customer&apos;s card</p>
            )}

            <div className="relative min-h-0 flex-1" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
              {status !== "loaded" && (
                <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-white/70" aria-hidden={status === "loading"}>
                  {status === "failed" ? "This photo couldn't load. Try Original." : "Loading photo…"}
                </p>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={current.url}
                src={current.full.src}
                srcSet={current.full.srcSet}
                sizes={current.full.srcSet ? "100vw" : undefined}
                alt={current.alt}
                decoding="async"
                onLoad={() => setImageState({ url: current.url, status: "loaded" })}
                onError={() => setImageState({ url: current.url, status: "failed" })}
                className={`absolute inset-0 h-full w-full object-contain ${status === "failed" ? "invisible" : ""}`}
              />
            </div>

            {many && (
              <div className="flex items-center justify-between gap-2 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                <button
                  type="button"
                  onClick={() => go(-1)}
                  className={`inline-flex min-h-11 min-w-28 items-center justify-center gap-1 rounded-lg border border-white/30 px-3 text-sm font-bold hover:bg-white/10 focus-visible:outline-white ${focusRing}`}
                >
                  <ChevronLeft className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  Previous
                </button>
                <span className="text-sm font-semibold tabular-nums" aria-live="polite">
                  {index + 1} of {photos.length}
                </span>
                <button
                  type="button"
                  onClick={() => go(1)}
                  className={`inline-flex min-h-11 min-w-28 items-center justify-center gap-1 rounded-lg border border-white/30 px-3 text-sm font-bold hover:bg-white/10 focus-visible:outline-white ${focusRing}`}
                >
                  Next
                  <ChevronRight className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>
            )}
            {!many && <div className="pb-[max(0.5rem,env(safe-area-inset-bottom))]" />}
          </div>
        )}
      </dialog>
    </div>
  );
}
