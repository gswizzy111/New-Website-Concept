import type { StaticImageData } from "next/image";
import charizard from "@/public/reels/charizard.jpg";
import messi from "@/public/reels/messi.jpg";
import brady from "@/public/reels/brady.jpg";

/**
 * "Watch the work" on the home page: three videos, each with its own cover.
 * Covers share one shape (1137:2000, the Charizard cover's), saved in
 * /public/reels. `views` is shown under the title when set.
 */
export type Reel = {
  id: string;
  title: string;
  href: string;
  platform: "YouTube" | "Instagram";
  views?: string;
  cover: StaticImageData;
  alt: string;
};

export const REELS: Reel[] = [
  {
    id: "charizard",
    title: "Charizard Gold Star",
    href: "https://youtube.com/shorts/UzuPoCmcv8k",
    platform: "YouTube",
    views: "8M Views",
    cover: charizard,
    alt: "A Charizard Gold Star card in a PSA slab, held in a blue glove",
  },
  {
    id: "messi",
    title: "Lionel Messi",
    href: "https://www.instagram.com/reel/DeXAmOXRtIQ/",
    platform: "Instagram",
    views: "400K Views",
    cover: messi,
    alt: "A Lionel Messi card in a Beckett slab, held in a hand over a steel bench",
  },
  {
    id: "brady",
    title: "Tom Brady",
    href: "https://www.instagram.com/reel/DeKl_T2yC-8/",
    platform: "Instagram",
    views: "100K Views",
    cover: brady,
    alt: "A 2000 Bowman Tom Brady rookie card in a PSA slab, held in black gloves",
  },
];

/** The address that plays a video inside the page, or null if it can't be embedded. */
export function embedUrl(reel: Reel): string | null {
  const yt = reel.href.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]+)|youtu\.be\/([A-Za-z0-9_-]+)|[?&]v=([A-Za-z0-9_-]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1] ?? yt[2] ?? yt[3]}?autoplay=1&playsinline=1`;
  const ig = reel.href.match(/^https:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/);
  if (ig) return `https://www.instagram.com/reel/${ig[1]}/embed`;
  return null;
}
