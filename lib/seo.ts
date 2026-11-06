import { SITE_URL_FALLBACK } from "@/lib/site-url";

export const SITE = SITE_URL_FALLBACK;
export const ORG_ID = `${SITE}/#organization`;
export const INSTAGRAM_URL = "https://www.instagram.com/the_card_doc";

export function canonical(path: string) {
  return { canonical: `${SITE}${path}` };
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
      image: `${SITE}/og-image.png`,
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
