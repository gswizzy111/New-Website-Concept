/**
 * Star ratings for the shop's products, as thecarddoc1.com shows them: the
 * first entry whose keyword is in the product's name (lower case).
 */
const RATINGS: { keywords: string[]; stars: number; count: number }[] = [
  { keywords: ["official"],   stars: 4.97, count: 89 },
  { keywords: ["essential"],  stars: 4.8,  count: 24 },
  { keywords: ["starter"],    stars: 4.7,  count: 51 },
  { keywords: ["clamp"],      stars: 4.9,  count: 17 },
  { keywords: ["wrinkle"],    stars: 4.85, count: 9  },
  { keywords: ["tools"],      stars: 4.75, count: 13 },
  { keywords: ["polish"],     stars: 4.8,  count: 22 },
  { keywords: ["spray"],      stars: 4.9,  count: 16 },
];

/** The product's rating ({ value: "4.97", count: 89 }), or undefined when none matches. */
export function productRating(name: string): { value: string; count: number } | undefined {
  const lower = name.toLowerCase();
  const r = RATINGS.find((x) => x.keywords.some((k) => lower.includes(k)));
  return r ? { value: String(r.stars), count: r.count } : undefined;
}
