// Card and product photos are full-size uploads (card photos often 100–400 KB,
// shop product PNGs 1.6–2.6 MB) that pages show as small squares or tiles. On
// Netlify, a Supabase storage photo is served resized by Netlify's image CDN
// (allowed in netlify.toml); anywhere else, unchanged.
const STORAGE_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/`;

function viaCdn(url: string) {
  return process.env.IMAGE_CDN === "netlify" && url.startsWith(STORAGE_PREFIX);
}

/** A square thumbnail of `url` for display at `size` CSS pixels. */
export function thumbnail(url: string, size: number) {
  if (!viaCdn(url)) return url;
  const px = size * 2; // sharp on high-density screens
  return `/.netlify/images?url=${encodeURIComponent(url)}&w=${px}&h=${px}&fit=cover`;
}

/**
 * A product photo resized to `width` real pixels, keeping its shape. Netlify
 * picks AVIF or WebP for the browser on its own.
 */
function resized(url: string, width: number) {
  return `/.netlify/images?url=${encodeURIComponent(url)}&w=${width}`;
}

/** A product photo for link previews: 1200px JPEG, which every preview reads. */
export function shareImage(url: string) {
  if (!viaCdn(url)) return url;
  return `${resized(url, 1200)}&fm=jpg`;
}

/**
 * `src` and `srcSet` for a product photo, resized to each of `widths` real
 * pixels. Spread onto an <img> along with a `sizes` that matches its rendered
 * width; off Netlify or for non-storage photos it is just the original `src`.
 */
export function productImage(url: string, widths: number[]): { src: string; srcSet?: string } {
  if (!viaCdn(url)) return { src: url };
  return {
    src: resized(url, Math.max(...widths)),
    srcSet: widths.map((w) => `${resized(url, w)} ${w}w`).join(", "),
  };
}
