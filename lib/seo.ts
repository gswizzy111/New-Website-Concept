import type { Metadata } from "next";
import { SITE_URL_FALLBACK } from "@/lib/site-url";

export const SITE = SITE_URL_FALLBACK;
export const ORG_ID = `${SITE}/#organization`;
export const INSTAGRAM_URL = "https://www.instagram.com/the_card_doc";

export function canonical(path: string) {
  return { canonical: `${SITE}${path}` };
}

/** The share image: the site badge, 1080px square, as an optimized JPEG. */
export const OG_IMAGE = { url: "/og-image.jpg", width: 1080, height: 1080 };

/**
 * A page's metadata with matching share-preview tags. Next does not copy a
 * page's title or description into openGraph, so without this every page
 * shares with the site-wide title and description. og:url stays relative so
 * metadataBase (siteUrl()) supplies the domain.
 */
export function withOg(path: string, meta: Metadata): Metadata {
  const t = meta.title;
  const title =
    typeof t === "string" ? t
    : t && typeof t === "object" && "absolute" in t ? t.absolute
    : t && typeof t === "object" && "default" in t ? t.default
    : undefined;
  // A page's openGraph replaces the root one whole, so a page with no title of
  // its own keeps the root's share tags.
  if (!title) return meta;
  const description = typeof meta.description === "string" ? meta.description : undefined;
  return {
    ...meta,
    openGraph: {
      title,
      ...(description ? { description } : {}),
      url: path,
      images: [OG_IMAGE],
      ...meta.openGraph,
    },
  };
}

/**
 * A product's stored description as one search-snippet line: its own words
 * with line breaks and tabs folded into spaces, cut at a word near 155
 * characters. A very short one is introduced with the product's name.
 */
export function productMetaDescription(name: string, description: string | null | undefined) {
  const text = (description ?? "").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  const full = text.length < 60 ? `${name} from The Card Doc. ${text}` : text;
  if (full.length <= 155) return full;
  const cut = full.slice(0, 155);
  const space = cut.lastIndexOf(" ");
  return `${(space > 100 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

export function breadcrumbs(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [{ name: "Home", path: "/" }, ...items].map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${SITE}${item.path}`,
    })),
  };
}

export const ORGANIZATION = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": ORG_ID,
      name: "The Card Doc",
      url: `${SITE}/`,
      logo: `${SITE}/card-doctor.jpg`,
      image: `${SITE}/og-image.jpg`,
      description: "Expert card restoration & PSA prep — every card treated like it's worth a fortune.",
      sameAs: [INSTAGRAM_URL],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE}/#website`,
      name: "The Card Doc",
      url: `${SITE}/`,
      publisher: { "@id": ORG_ID },
    },
  ],
};
