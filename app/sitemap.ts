import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

// No lastModified: the site doesn't track when each page last changed, and a
// date that is always "now" teaches search engines to ignore it.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1.0 },
    { url: `${base}/privacy`, changeFrequency: "monthly", priority: 1.0 },
    { url: `${base}/tier-selection`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/shop`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/prep`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/how-it-works`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/terms`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/faq`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/what-we-can-fix`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/about`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/gift-cards`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/track`, changeFrequency: "monthly", priority: 0.5 },
  ];
}
