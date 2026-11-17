"use client";

import { useState } from "react";
import Image from "next/image";
import { Camera, Play } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { REELS, embedUrl, type Reel } from "@/lib/reels";

/** The sun play button with its white die-cut edge. */
function PlayBadge() {
  return (
    <span
      aria-hidden
      className="grid size-14 place-items-center rounded-full bg-sun text-ink shadow-[0_0_0_3px_var(--white),0_10px_22px_-8px_rgba(8,12,40,0.6)] transition-transform duration-300 ease-[var(--ease-out)] group-hover:scale-110 group-focus-visible:scale-110 motion-reduce:transition-none md:size-16"
    >
      <Play className="size-6 translate-x-0.5 fill-ink md:size-7" strokeWidth={1.75} />
    </span>
  );
}

/** The platform the video lives on, as a small white chip. */
function PlatformChip({ platform }: { platform: Reel["platform"] }) {
  return (
    <span
      aria-hidden
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white px-3 text-[13px] font-extrabold text-ink shadow-[0_6px_14px_-6px_rgba(8,12,40,0.55)]"
    >
      {platform === "YouTube" ? (
        <Play className="size-4 fill-ink" strokeWidth={1.75} />
      ) : (
        <Camera className="size-4" strokeWidth={1.75} />
      )}
      {platform}
    </span>
  );
}

// Alternate slight tilts, like prints laid on the table.
const TILT = [-1.6, 1.2, -0.8];

function Tile({ reel, index, onPlay }: { reel: Reel; index: number; onPlay: (reel: Reel, src: string) => void }) {
  const src = embedUrl(reel);
  const body = (
    <>
      <span className="relative block aspect-[1137/2000] overflow-hidden rounded-[3px] bg-white">
        <Image
          src={reel.cover}
          alt={reel.alt}
          fill
          sizes="(min-width: 1280px) 300px, (min-width: 768px) 28vw, 62vw"
          className="object-cover"
        />
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-ink/70 to-transparent" />
        <span className="absolute inset-0 grid place-items-center">
          <PlayBadge />
        </span>
        <span className="absolute bottom-3 left-3">
          <PlatformChip platform={reel.platform} />
        </span>
      </span>
      <span className="caps mt-3 block px-1 font-display text-xl font-extrabold leading-none tracking-[0.02em] text-ink md:text-[22px]">
        {reel.title}
      </span>
      {reel.views && (
        <span className="mt-1.5 block px-1 pb-0.5 text-[15px] font-bold text-ink-soft tabular-nums">{reel.views}</span>
      )}
    </>
  );
  const cls = "print print-lift group block w-full text-left p-2 md:p-2.5 focus-visible:outline-offset-4";
  const style = { ["--tilt" as string]: `${TILT[index % TILT.length]}deg` };

  if (src) {
    return (
      <button type="button" onClick={() => onPlay(reel, src)} className={cls} style={style} aria-label={`Play ${reel.title} (${reel.platform})`}>
        {body}
      </button>
    );
  }
  return (
    <a href={reel.href} target="_blank" rel="noopener noreferrer" className={cls} style={style} aria-label={`Watch ${reel.title} on ${reel.platform} (opens in a new tab)`}>
      {body}
    </a>
  );
}

/**
 * "Watch the work": three videos as portrait prints with their cover, the
 * platform and the view count. Each plays in a dialog (YouTube's or
 * Instagram's own player, loaded only on open), with a link out to the
 * original. Phones get a sideways swipe row. Videos come from lib/reels.ts.
 */
export function WatchTheWork() {
  const [playing, setPlaying] = useState<{ reel: Reel; src: string } | null>(null);

  return (
    <>
      <ul
        data-reveal="stagger"
        aria-label="Videos"
        // Phones scroll this row sideways, so keyboards can reach it too.
        tabIndex={0}
        className="no-scrollbar focus-visible:outline-offset-[-3px] -mx-[var(--gut)] flex snap-x snap-mandatory gap-5 overflow-x-auto px-[var(--gut)] pt-3 pb-8 md:mx-auto md:grid md:max-w-[60rem] md:grid-cols-3 md:gap-7 md:overflow-visible md:px-0 lg:gap-9"
      >
        {REELS.map((reel, i) => (
          <li key={reel.id} className="w-[62%] max-w-[260px] shrink-0 snap-center md:w-auto md:max-w-none">
            <Tile reel={reel} index={i} onPlay={(r, src) => setPlaying({ reel: r, src })} />
          </li>
        ))}
      </ul>

      <Dialog open={playing !== null} onOpenChange={(open) => { if (!open) setPlaying(null); }}>
        <DialogContent className="w-auto max-w-[calc(100%-2rem)] gap-3 p-3 pt-12 sm:max-w-none md:p-4 md:pt-12">
          <DialogTitle className="absolute top-3 left-4 max-w-[calc(100%-4rem)] truncate text-base">
            {playing?.reel.title}
          </DialogTitle>
          {playing && (
            <>
              <iframe
                src={playing.src}
                title={`${playing.reel.title} (${playing.reel.platform} video)`}
                loading="lazy"
                allow="autoplay; encrypted-media; picture-in-picture; web-share"
                allowFullScreen
                style={{ width: "min(calc(100vw - 3.5rem), calc(min(78dvh, 46rem) * 9 / 16))" }}
                className="block aspect-[9/16] h-auto rounded-lg border-0 bg-ink"
              />
              <a
                href={playing.reel.href}
                target="_blank"
                rel="noopener noreferrer"
                className="tlink self-center text-sm font-bold text-ink"
              >
                Open on {playing.reel.platform}
              </a>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
