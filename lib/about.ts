import type { StaticImageData } from "next/image";
import mantleBefore from "@/public/specimen-mantle-before.jpg";
import mantleAfter from "@/public/specimen-mantle-after.jpg";
import mantleInHand from "@/public/about/mantle-in-hand.jpg";
import mantleDetailBefore from "@/public/about/mantle-detail-before.jpg";
import charmander from "@/public/specimen-charmander.png";

/**
 * Everything the About page (app/(public)/about/page.tsx) says and shows,
 * kept here so the founders' text, figures, photos and results can be edited
 * without touching the layout.
 *
 * Rules for this file:
 * - Facts only. The founders are Owen and Gavin, with 30+ years of combined
 *   collecting experience; both still work on customer cards. Don't add a
 *   founding year, surnames, credentials, team size or separate roles unless
 *   the owner confirms them.
 * - Photos must be genuine. A before/after case must show the same card,
 *   correctly paired. No stock, AI or placeholder images: an empty photo slot
 *   (`photo: null`) simply renders nothing.
 *
 * ── Adding photos ──────────────────────────────────────────────────────────
 * Put the file in public/about/, import it at the top of this file and set it
 * on the slot. Recommended sizes (JPEG, quality ~85, sRGB; Next serves
 * resized AVIF/WebP automatically):
 *
 *   Slot                         File name                      Size (px)     Ratio
 *   Story: the workshop          about/workshop.jpg             2400 x 1600   3:2 landscape
 *   Story: work in progress      about/in-progress.jpg          1600 x 2000   4:5 portrait
 *   Founder portrait: Owen       about/owen.jpg                 1600 x 2000   4:5 portrait
 *   Founder portrait: Gavin      about/gavin.jpg                1600 x 2000   4:5 portrait
 *   Method photos (one each)     about/method-<id>.jpg          1600 x 1200   4:3 landscape
 *   Before/after slider pair     about/results/<card>-before.jpg and -after.jpg
 *                                                               1600 x 1600   same size, same framing
 *
 * A slider pair must be the same card photographed (or aligned) to the same
 * framing, so the divider wipes between two states of one picture. A single
 * image that already shows both states side by side is a `composite` case.
 */

export type Photo = {
  src: StaticImageData;
  alt: string;
  /** Short factual caption under the photo, or none. */
  caption?: string;
};

export type PhotoSlot = {
  /** What belongs here, for whoever adds the photo. */
  purpose: string;
  photo: Photo | null;
};

// ── Hero ───────────────────────────────────────────────────────────────────

export const HERO = {
  headline: ["Built by Collectors.", "Trusted with Collections."],
  subheadline: "30+ years of combined collecting experience. A shared passion for preserving the cards that matter.",
  /** The restored Mickey Mantle in a gloved hand: the right half of
   * public/before-after-mickey-mantle.png (the owner's photo), cropped
   * above the drawn arrow. */
  photo: {
    src: mantleInHand,
    alt: "A restored Mickey Mantle card held in a blue nitrile glove",
    caption: "Mickey Mantle, after restoration",
  } satisfies Photo,
};

// ── How it all started ─────────────────────────────────────────────────────

export const STORY = {
  title: "How it all started",
  lead: "The Card Doc didn't start as a business. It started with two collectors and their own cards.",
  chapters: [
    {
      title: "Two collectors",
      body: "Owen and Gavin are collectors first. Between them, they have more than 30 years of collecting experience, and they know what a card can mean to the person who owns it.",
    },
    {
      title: "Our own cards, first",
      body: "Before anyone else's, we restored the cards in our own collections. One at a time, carefully, learning what each card needed.",
    },
    {
      title: "Sharing the results",
      body: "We posted the before and after photos online, so other collectors could see the work for themselves.",
    },
    {
      title: "Collectors started asking",
      body: "People noticed, and then they started asking whether we would work on their cards too.",
    },
    {
      title: "The Card Doc",
      body: "That interest grew into The Card Doc, and both of us still work on customer cards ourselves.",
    },
  ],
  /** Shown beside the chapters once they exist. */
  photos: [
    { purpose: "The workshop: the bench, tools and light where the cards are worked on (about/workshop.jpg, 2400 x 1600)", photo: null },
    { purpose: "A card mid-restoration, in hand or on the bench (about/in-progress.jpg, 1600 x 2000)", photo: null },
  ] satisfies PhotoSlot[],
};

// ── Meet the founders ──────────────────────────────────────────────────────

export type Founder = {
  name: string;
  /** Short facts set as a line under the name. Keep both founders' lines true. */
  facts: string[];
  /** 4:5 portrait (about/<name>.jpg, 1600 x 2000). Null shows the name alone. */
  portrait: Photo | null;
};

export const FOUNDERS: Founder[] = [
  { name: "Owen", facts: ["Co-founder", "Collector", "Works on customer cards"], portrait: null },
  { name: "Gavin", facts: ["Co-founder", "Collector", "Works on customer cards"], portrait: null },
];

export const FOUNDERS_MESSAGE = "The same collectors who started The Card Doc are still the ones working on your cards.";

// ── Why collectors choose us ───────────────────────────────────────────────

export const REASONS = {
  title: "Why collectors choose us",
  lead: "What changes when the collectors who started the business are the ones doing the work.",
  items: [
    {
      title: "Founder-operated restoration",
      body: "Owen and Gavin started The Card Doc, and they still work on customer cards themselves.",
    },
    {
      title: "30+ years of combined collecting",
      body: "Collectors first. We know why a card matters before we pick up a tool.",
    },
    {
      title: "Individual assessment and care",
      body: "Each card is looked at for what it is and what it needs. If restoration isn't right for it, we say so.",
    },
    {
      title: "Genuine work, transparent expectations",
      body: "The results we show are our own work. We're upfront about what restoration can do, and what it can't.",
    },
  ],
};

// ── Behind the restoration ─────────────────────────────────────────────────

export type Method = { id: string; name: string; body: string; photo: Photo | null };

export const PROCESS = {
  title: "Behind the restoration",
  lead: "Restoration here is careful, hands-on work. We choose the methods card by card, and not every card needs every one.",
  /** Lead image: a close-up crop of public/specimen-mantle-before.jpg. */
  photo: {
    src: mantleDetailBefore,
    alt: "Close-up of a Mickey Mantle card before restoration, with cracks across the cap, face and jersey",
    caption: "Mickey Mantle, before restoration",
  } satisfies Photo,
  methods: [
    { id: "surface-cleaning", name: "Surface cleaning", body: "Lifting dirt, grime and residue from the card's surface.", photo: null },
    { id: "crease-reduction", name: "Crease reduction", body: "Reducing the look of creases and dents.", photo: null },
    { id: "humidity", name: "Controlled humidity treatment", body: "Measured moisture that helps the card's fibers settle back into place.", photo: null },
    { id: "heat-pressing", name: "Precision heat pressing", body: "Heat and pressure, applied with care, to flatten and settle the card.", photo: null },
    { id: "tool-work", name: "Precision tool work", body: "Fine hand tools for dents, and for edge and corner lifts.", photo: null },
  ] satisfies Method[],
  never: ["Recolor or repaint", "Apply adhesives", "Add or replace material"],
  honesty: "Every card responds differently. Results vary, and restoration is never risk-free.",
};

// ── Real results ───────────────────────────────────────────────────────────

/**
 * Genuine before/after results, in the order they're shown.
 * - `slider`: two aligned photos of the same card (same size and framing).
 * - `composite`: one photo that already shows both states side by side.
 */
export type ResultCase =
  | {
      kind: "slider";
      id: string;
      card: string;
      detail?: string;
      caption: string;
      before: StaticImageData;
      after: StaticImageData;
      beforeAlt: string;
      afterAlt: string;
    }
  | {
      kind: "composite";
      id: string;
      card: string;
      detail?: string;
      caption: string;
      image: StaticImageData;
      alt: string;
    };

export const RESULTS: ResultCase[] = [
  {
    kind: "slider",
    id: "mickey-mantle",
    card: "Mickey Mantle",
    detail: "Banner, cap, face and jersey",
    caption: "Cracking across the face, cap and jersey, before and after. Fine lines are still visible up close: restoration reduces damage, it doesn't erase a card's history.",
    // Cut and aligned from public/before-after-mickey-mantle.png (DESIGN.md, Specimen Stack).
    before: mantleBefore,
    after: mantleAfter,
    beforeAlt: "A Mickey Mantle card before restoration, cracked across the face and jersey",
    afterAlt: "The same Mickey Mantle card after restoration",
  },
  {
    kind: "composite",
    id: "charmander",
    card: "Charmander",
    detail: "Base Set, 46/102",
    caption: "Before and after restoration, side by side.",
    image: charmander,
    alt: "A Charmander card before and after restoration",
  },
];
