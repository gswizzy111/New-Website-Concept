/**
 * The kits, tools and supplies as listed on https://thecarddoc1.com/shop,
 * with their photos saved in /public/shop. The shop shows these whenever the
 * database returns no products (this preview has no database), so the
 * shelves always populate. Names, prices and ratings are copied as listed.
 */
export type CatalogProduct = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  images: string[];
  category: "Kits" | "Tools" | "Supplies";
  inventory_count: number;
  rating?: { value: string; count: number };
};

const item = (
  slug: string,
  name: string,
  price_cents: number,
  category: CatalogProduct["category"],
  rating?: CatalogProduct["rating"],
): CatalogProduct => ({
  id: slug,
  name,
  slug,
  description: null,
  price_cents,
  images: [`/shop/${slug}.webp`],
  category,
  inventory_count: 100,
  rating,
});

export const SHOP_CATALOG: CatalogProduct[] = [
  item("the-card-doc-restoration-kit", "The Official Card Doc Restoration Kit", 9999, "Kits", { value: "4.97", count: 89 }),
  item("card-doc-official-crease-kit", "Card Doc Official Crease Kit", 4999, "Kits", { value: "4.97", count: 89 }),
  item("essential-restoration-kit", "Essential Restoration Kit", 4999, "Kits", { value: "4.8", count: 24 }),
  item("the-starter-kit", "The Starter Kit", 2999, "Kits", { value: "4.7", count: 51 }),
  item("the-card-doc-roller-tool", "The Card Doc Roller Tool", 2399, "Tools"),
  item("2-crease-tools", "2 Crease Tools", 1399, "Tools", { value: "4.75", count: 13 }),
  item("docs-crease-tool", "Doc's Crease Tool", 2299, "Tools"),
  item("dragons-breath-tool", "Dragons Breath Tool", 499, "Tools"),
  item("spray-and-polish-combo", "Spray and Polish Combo", 3799, "Supplies", { value: "4.8", count: 22 }),
  item("the-card-doc-card-polish", "The Card Doc Card Polish", 2397, "Supplies", { value: "4.8", count: 22 }),
  item("the-card-doc-card-cleaning-spray", "The Card Doc Card Cleaning Spray", 2399, "Supplies", { value: "4.9", count: 16 }),
  item("the-docs-parchment-paper-8-count", "The Docs Clamping Paper (8 count)", 499, "Supplies", { value: "4.9", count: 17 }),
  item("exam-gloves", "The Doc's Exam Gloves — Latex-Free, Card-Safe (4- Pair)", 499, "Supplies"),
  item("card-doc-clamp-kit", "Card Doc Clamp Kit", 3999, "Supplies", { value: "4.9", count: 17 }),
];

export function catalogProduct(slug: string): CatalogProduct | undefined {
  return SHOP_CATALOG.find((p) => p.slug === slug);
}
