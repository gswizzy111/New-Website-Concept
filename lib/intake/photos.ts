import { MAX_CARD_PHOTOS } from "@/lib/site-config";

// Card photos must be our own uploads. /api/upload stores each one under a
// random name at the top of the public card-photos bucket and answers with
// getPublicUrl(): `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/card-photos/<name>`.
const CARD_PHOTOS_PATH = "/storage/v1/object/public/card-photos/";

/** True only for a photo /api/upload stored in our card-photos bucket. */
export function isOurCardPhoto(value: string): boolean {
  let url: URL;
  let supabase: URL;
  try {
    url = new URL(value);
    supabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  } catch {
    return false;
  }
  return url.protocol === "https:"
    && url.host === supabase.host
    && !url.username && !url.password && !url.search && !url.hash
    && url.pathname.startsWith(CARD_PHOTOS_PATH)
    && /^[A-Za-z0-9-]{1,100}\.[a-z]{3,4}$/.test(url.pathname.slice(CARD_PHOTOS_PATH.length));
}

/**
 * Receiving photos staff take of each card when it arrives
 * (cards.receiving_photo_urls). They are kept apart from the customer's own
 * photos (cards.photo_urls), which receiving never changes. Same limit per
 * card as the customer's photos.
 */
export const MAX_RECEIVING_PHOTOS = MAX_CARD_PHOTOS;
