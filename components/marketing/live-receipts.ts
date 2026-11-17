import { cache } from "react";
import { getTestimonials } from "@/lib/testimonials";
import { RECEIPTS, type Receipt } from "./receipts";

// The bundled screenshots' addresses in lib/testimonials.ts ("/testimonial-3.jpeg")
const BUNDLED = /^\/testimonial-(\d+)\.(?:jpe?g|png|webp)$/i;
// testimonial-2 shows a customer's first name; the owner asked for no
// customer names on the site, so the bundled copy stays off (receipts.ts)
const HIDDEN_BUNDLED = new Set(["t2"]);

export type LiveReceipts = {
  /** The admin's list, in the admin's order, as receipts. */
  items: Receipt[];
  /** Every item is one of the bundled screenshots (none uploaded). */
  bundledOnly: boolean;
};

/**
 * The customer reviews the admin manages on /admin/testimonials
 * (getTestimonials(): the saved list, else the bundled defaults), as the
 * redesign's receipts. A bundled screenshot keeps its static import and
 * written-out alt text; an uploaded one shows from its storage address.
 * Null when the list can't be read or comes back empty, so the strip shows
 * its own static set.
 */
export const liveReceipts = cache(async (): Promise<LiveReceipts | null> => {
  let images: Awaited<ReturnType<typeof getTestimonials>>;
  try {
    images = await getTestimonials();
  } catch {
    return null;
  }
  const items: Receipt[] = [];
  let bundledOnly = true;
  for (const img of images ?? []) {
    if (!img?.url) continue;
    const m = BUNDLED.exec(img.url);
    if (m) {
      const id = `t${m[1]}`;
      if (HIDDEN_BUNDLED.has(id)) continue;
      const known = RECEIPTS.find((r) => r.id === id);
      if (known) { items.push(known); continue; }
    }
    bundledOnly = false;
    items.push({
      id: img.id || img.url,
      src: img.url,
      alt: img.alt?.trim() || "Customer review",
      matte: "#000000",
    });
  }
  return items.length ? { items, bundledOnly } : null;
});
