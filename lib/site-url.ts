/**
 * The site's public address for links in emails, Stripe return URLs and
 * metadata: NEXT_PUBLIC_APP_URL (set in Netlify), else the business domain.
 * Never localhost, and never a trailing slash.
 */
export const SITE_URL_FALLBACK = "https://thecarddoc1.com";

export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (!raw) return SITE_URL_FALLBACK;
  try {
    return new URL(raw).origin === "null" ? SITE_URL_FALLBACK : raw;
  } catch {
    // A bare host or a typo would break every link (and new URL() in metadata)
    return SITE_URL_FALLBACK;
  }
}
