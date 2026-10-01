import { Star } from "lucide-react";
import { PageHero } from "@/components/marketing/page-hero";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/utils";
import { AddToCartButton } from "./add-to-cart-button";
import { isSoldOut } from "@/lib/site-config";

export const dynamic = "force-dynamic";

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

function getRating(name: string) {
  const lower = name.toLowerCase();
  return RATINGS.find((r) => r.keywords.some((k) => lower.includes(k)));
}

function StarRating({ stars, count }: { stars: number; count: number }) {
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <span className="flex gap-0.5" aria-label="5 star rating">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star key={i} className="h-3 w-3 fill-amber-500 text-amber-500" strokeWidth={1.5} />
        ))}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">{stars} ({count})</span>
    </div>
  );
}


type Product = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  images: string[] | null;
  category: string | null;
  inventory_count: number;
};

function ProductCard({ product }: { product: Product }) {
  const rating = getRating(product.name);
  const isKit = product.name.toLowerCase().includes("official");
  return (
    <div className="bg-card flex flex-col group relative">
      {isKit && (
        <span className="absolute top-3 left-3 z-10 bg-rx text-primary-foreground font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-0.5 rounded-full">
          Most Popular
        </span>
      )}
      <a href={`/shop/${product.slug}`} className="block">
        <div className="aspect-square bg-secondary overflow-hidden relative">
          {product.images?.[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.images[0]}
              alt={product.name}
              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500 ease-out"
            />
          ) : (
            <div className="w-full h-full bg-secondary" />
          )}
          {isSoldOut() && (
            <div className="absolute inset-0 flex items-center justify-center bg-paper/70">
              <span className="bg-ink text-paper font-mono uppercase tracking-[0.12em] text-[11px] px-3 py-1 rounded-sm">
                Sold Out
              </span>
            </div>
          )}
        </div>
      </a>
      <div className="p-4 flex flex-col flex-1 gap-3">
        <a href={`/shop/${product.slug}`} className="block flex-1">
          <p className="font-heading font-bold text-ink text-[15px] leading-tight group-hover:text-rx transition-colors">{product.name}</p>
          {rating && <StarRating stars={rating.stars} count={rating.count} />}
        </a>
        <div className="flex items-center justify-between">
          <span className="font-semibold text-ink text-sm tabular-nums">{formatCurrency(product.price_cents)}</span>
          {isSoldOut() || product.inventory_count === 0 ? (
            <span className="text-xs text-muted-foreground font-semibold">Sold Out</span>
          ) : (
            <AddToCartButton
              product={{
                id: product.id,
                name: product.name,
                price_cents: product.price_cents,
                slug: product.slug,
                image: product.images?.[0],
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const SECTION_GRID: Record<number, string> = {
  1: "grid-cols-1 md:grid-cols-1",
  2: "grid-cols-2 md:grid-cols-2",
  3: "grid-cols-2 md:grid-cols-3",
  4: "grid-cols-2 md:grid-cols-4",
  5: "grid-cols-2 md:grid-cols-3",
  6: "grid-cols-2 md:grid-cols-3",
  7: "grid-cols-2 md:grid-cols-4",
  8: "grid-cols-2 md:grid-cols-4",
  9: "grid-cols-2 md:grid-cols-3",
  12: "grid-cols-2 md:grid-cols-4",
};

function getSectionGridClass(count: number): string {
  return SECTION_GRID[count] ?? "grid-cols-2 md:grid-cols-4";
}

function ProductSection({ title, products }: { title: string; products: Product[] }) {
  if (products.length === 0) return null;
  return (
    <div>
      <div className="mb-6">
        <h2 className="font-heading text-2xl md:text-3xl font-extrabold tracking-tight text-ink">{title}</h2>
      </div>
      <div data-reveal="stagger" className={`grid ${getSectionGridClass(products.length)} bg-rule border border-rule rounded-lg overflow-hidden`} style={{ gap: "1px" }}>
        {products.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </div>
  );
}

export default async function ShopPage() {
  const admin = createAdminClient();

  const { data } = await admin
    .from("products")
    .select("id, name, slug, description, price_cents, images, category, inventory_count")
    .eq("active", true)
    .order("display_order", { ascending: true });

  const products: Product[] = (data ?? []) as Product[];

  const kits = products.filter((p) => p.category === "Kits");
  const tools = products.filter((p) => p.category === "Tools");
  const supplies = products.filter((p) => p.category === "Supplies" || p.category === "Cleaning" || p.category === "Storage");

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-10 py-12 md:py-16 pb-28 md:pb-16">
      {/* Header */}
      <PageHero className="mb-12 md:mb-16" eyebrow="The Card Doc" title="Shop" />

      {products.length === 0 && (
        <div className="border border-rule rounded-xl bg-paper py-24 text-center">
          <p className="font-heading text-xl text-muted-foreground">Products coming soon.</p>
        </div>
      )}

      {products.length > 0 && (
        <div className="flex flex-col gap-16">
          <ProductSection title="Kits" products={kits} />
          <ProductSection title="Tools" products={tools} />
          <ProductSection title="Supplies" products={supplies} />
        </div>
      )}
    </div>
  );
}
