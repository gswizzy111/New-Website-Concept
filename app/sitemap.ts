import type { MetadataRoute } from "next";

// The business domain, as in public/robots.txt and the /privacy canonical,
// whichever address serves this copy of the site (not NEXT_PUBLIC_APP_URL:
// before the domain switch that is the temporary domain)
const BASE = "https://thecarddoc1.com";

// No lastModified: the site doesn't track when each page last changed, and a
// date that is always "now" teaches search engines to ignore it.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1.0 },
    { url: `${BASE}/privacy`, changeFrequency: "monthly", priority: 1.0 },
    { url: `${BASE}/tier-selection`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/shop`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/prep`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/how-it-works`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/terms`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/faq`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/what-we-can-fix`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/about`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/gift-cards`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/track`, changeFrequency: "monthly", priority: 0.5 },
  ];
}
